import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { RoomState } from './types';
import { api } from './hooks';
import { useLocalAsset } from './local-media';
import { FilePeer } from './p2p-transport';

async function workerReady() {
  if (!isSecureContext || !('serviceWorker' in navigator)) throw new Error('P2P 边传边播需要 HTTPS；请使用公网分享地址或在本机 localhost 打开');
  await navigator.serviceWorker.register('/p2p-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', done); resolve(); };
    const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', done); reject(new Error('播放器桥接尚未就绪，请刷新页面')); }, 7000);
    navigator.serviceWorker.addEventListener('controllerchange', done);
  });
}
export function useFileShare(socket: Socket | null, room: RoomState | null, selfId: string) {
  const local = useLocalAsset(room?.media.id);
  const [state, setState] = useState('idle'); const [error, setError] = useState(''); const [url, setUrl] = useState('');
  const [received, setReceived] = useState(0); const [sent, setSent] = useState(0); const [retry, setRetry] = useState(0);
  const seedKey = room ? sessionStorage.getItem(`coplay:seed:${room.id}`) : null;
  const isLocal = room?.media.playbackType === 'local';
  const roomRef = useRef(room); roomRef.current = room;
  // Re-register the original file owner after every Socket.IO reconnect.
  useEffect(() => {
    if (!socket || !isLocal || !local || !seedKey || !room?.media.localFile) return;
    socket.emit('file:available', { seedKey, fingerprint: room.media.localFile.fingerprint }, (result: { error?: string }) => { if (result.error) setError(result.error); });
  }, [socket, selfId, isLocal, local, seedKey, room?.id, room?.seedId]);
  useEffect(() => {
    if (!socket || !room || !isLocal || !selfId) return;
    let alive = true; const peers = new Map<string, FilePeer>(); let token = ''; let viewer: FilePeer | undefined;
    let started = false; let config: RTCConfiguration;
    const queuedSignals: { from: string; request?: boolean; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }[] = [];
    const cache = new Map<string, ArrayBuffer>(); const inflight = new Map<string, Promise<ArrayBuffer>>(); let cachedBytes = 0;
    setUrl(''); setError(''); setReceived(0); setSent(0); setState(local ? 'local' : room.seedId ? 'connecting' : 'waiting');
    const progress = () => { if (alive) { setReceived([...peers.values()].reduce((n, p) => n + p.received, 0)); setSent([...peers.values()].reduce((n, p) => n + p.sent, 0)); } };
    const read = async (start: number, length: number) => {
      const key = `${start}:${length}`; const cached = cache.get(key); if (cached) { cache.delete(key); cache.set(key, cached); return cached.slice(0); }
      let pending = inflight.get(key);
      if (!pending) { pending = viewer!.read(start, length).then(data => { while (cachedBytes + data.byteLength > 32 * 1024 * 1024 && cache.size) { const first = cache.keys().next().value!; cachedBytes -= cache.get(first)!.byteLength; cache.delete(first); } cache.set(key, data); cachedBytes += data.byteLength; return data; }).finally(() => inflight.delete(key)); inflight.set(key, pending); }
      return (await pending).slice(0);
    };
    const onWorker = (event: MessageEvent) => {
      if (!token || event.data?.type !== 'p2p:read' || event.data.token !== token || !event.ports[0]) return;
      const port = event.ports[0]; const { start, length } = event.data;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length < 1 || length > 256 * 1024 || start < 0 || start + length > room.media.localFile!.size) { port.postMessage({ error: '无效的片段范围' }); port.close(); return; }
      void read(start, length).then(buffer => port.postMessage({ buffer }, [buffer])).catch(e => { port.postMessage({ error: e.message }); if (alive) setError(e.message); }).finally(() => port.close());
    };
    const attachStream = async () => {
      if (started) return; started = true;
      try {
        await workerReady(); if (!alive) return;
        token = [...crypto.getRandomValues(new Uint8Array(16))].map(v => v.toString(16).padStart(2, '0')).join('');
        const channel = new MessageChannel();
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { channel.port1.close(); reject(new Error('播放器桥接响应超时')); }, 5000);
          channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(); };
          navigator.serviceWorker.controller!.postMessage({ type: 'p2p:register', token, size: room.media.localFile!.size, mime: room.media.localFile!.mime }, [channel.port2]);
        });
        if (alive) { setUrl(`/_p2p/${token}/media`); setState('ready'); }
      } catch (e) { if (alive) { setError((e as Error).message); setState('error'); } }
    };
    const make = (id: string, file?: File) => {
      const peer = new FilePeer(socket, id, config, file, status => {
        if (!alive || file) return;
        if (status === 'ready') void attachStream();
        else if (['failed', 'closed', 'disconnected'].includes(status)) { setState('error'); setError('文件连接中断，请确认提供者在线后重连；跨网连接可能需要 TURN'); }
      }, progress); peers.set(id, peer); return peer;
    };
    const onSignal = (message: { from: string; request?: boolean; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      if (!alive) return;
      if (!config) { if (queuedSignals.length < 100) queuedSignals.push(message); return; }
      if (local && room.seedId === selfId && message.request && roomRef.current?.members.some(m => m.id === message.from)) {
        peers.get(message.from)?.close(); const peer = make(message.from, local.file); void peer.offer().catch(e => { if (alive) setError(e.message); }); return;
      }
      let peer = peers.get(message.from);
      if (!local && message.from === room.seedId && !peer) { peer = make(message.from); viewer = peer; }
      if (peer) void peer.signalReceived(message).catch(e => { if (alive) setError(e.message); });
    };
    const onLeft = ({ id }: { id: string }) => { peers.get(id)?.close(); peers.delete(id); };
    const disconnect = () => { for (const p of peers.values()) p.close(); if (alive) { setState('waiting'); setUrl(''); } };
    navigator.serviceWorker?.addEventListener('message', onWorker);
    socket.on('file:signal', onSignal); socket.on('peer:left', onLeft); socket.on('disconnect', disconnect);
    void api<RTCConfiguration>('/api/rtc-config').then(c => {
      if (!alive) return; config = c;
      for (const message of queuedSignals.splice(0)) onSignal(message);
      if (local) { setUrl(local.url); setState(room.seedId === selfId ? 'seeding' : 'local'); }
      else if (room.seedId) {
        if (!isSecureContext || !('serviceWorker' in navigator)) { setState('error'); setError('请使用 HTTPS 邀请地址进行 P2P 边传边播'); return; }
        socket.emit('file:signal', { target: room.seedId, request: true });
      }
    }).catch(e => { if (alive) { setError(e.message); setState('error'); } });
    const timeout = setTimeout(() => { if (alive && !local && !started && room.seedId) { setState('error'); setError('P2P 连接超时，请重连；跨网络无法直连时需要配置 TURN'); } }, 25000);
    return () => { alive = false; clearTimeout(timeout); socket.off('file:signal', onSignal); socket.off('peer:left', onLeft); socket.off('disconnect', disconnect); navigator.serviceWorker?.removeEventListener('message', onWorker); if (token) navigator.serviceWorker?.controller?.postMessage({ type: 'p2p:unregister', token }); for (const peer of peers.values()) peer.close(); cache.clear(); };
  }, [socket, room?.id, room?.media.id, room?.seedId, selfId, local, retry]);
  return { url, state, error, received, sent, local, canProvide: !!seedKey, reconnect: () => setRetry(n => n + 1) };
}
