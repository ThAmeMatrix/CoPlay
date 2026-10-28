import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api } from './hooks';

type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement; makingOffer: boolean; ignoreOffer: boolean; candidates: RTCIceCandidateInit[]; sender: RTCRtpSender };
export function useVoice(socket: Socket | null, notify: (message: string) => void) {
  const peers = useRef(new Map<string, Peer>());
  const stream = useRef<MediaStream | null>(null);
  const config = useRef<RTCConfiguration>({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(true);
  const listeningRef = useRef(true);
  const generation = useRef(0);
  const notifier = useRef(notify); notifier.current = notify;
  useEffect(() => { api<RTCConfiguration>('/api/rtc-config').then(c => { config.current = c; }).catch(() => {}); }, []);
  useEffect(() => {
    if (!socket) return;
    let alive = true;
    const dispose = (id: string) => { const p = peers.current.get(id); if (p) { p.pc.close(); p.audio.srcObject = null; p.audio.remove(); peers.current.delete(id); } };
    const makePeer = (id: string) => {
      const existing = peers.current.get(id); if (existing) return existing;
      const pc = new RTCPeerConnection(config.current);
      const audio = new Audio(); audio.autoplay = true; audio.muted = !listeningRef.current;
      const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const peer: Peer = { pc, audio, sender: transceiver.sender, makingOffer: false, ignoreOffer: false, candidates: [] };
      peers.current.set(id, peer);
      if (stream.current) void peer.sender.replaceTrack(stream.current.getAudioTracks()[0]);
      pc.onicecandidate = ({ candidate }) => { if (candidate) socket.emit('voice:signal', { target: id, candidate: candidate.toJSON() }); };
      pc.ontrack = ({ track, streams }) => {
        audio.srcObject = streams[0] || new MediaStream([track]);
        if (listeningRef.current) audio.play().catch(() => { if (alive) { setListening(false); listeningRef.current = false; notifier.current('点击「收听语音」听见朋友的声音'); } });
      };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') notifier.current('语音连接失败，可重新进入房间重试；跨网络连接可能需要 TURN 服务'); };
      pc.onnegotiationneeded = async () => {
        try { peer.makingOffer = true; await pc.setLocalDescription(); socket.emit('voice:signal', { target: id, description: pc.localDescription }); }
        catch { /* The peer may have left while negotiation was pending. */ }
        finally { peer.makingOffer = false; }
      };
      return peer;
    };
    const onState = (room: { members: { id: string }[] }) => {
      if (!window.RTCPeerConnection) return;
      const ids = room.members.filter(m => m.id !== socket.id).map(m => m.id);
      for (const id of ids) makePeer(id);
      for (const id of peers.current.keys()) if (!ids.includes(id)) dispose(id);
    };
    const onSignal = async (payload: { from: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      if (!window.RTCPeerConnection) return;
      const peer = makePeer(payload.from); const pc = peer.pc;
      try {
        if (payload.description) {
          const collision = payload.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
          const polite = (socket.id || '') > payload.from;
          peer.ignoreOffer = !polite && collision;
          if (peer.ignoreOffer) return;
          await pc.setRemoteDescription(payload.description);
          for (const c of peer.candidates.splice(0)) await pc.addIceCandidate(c);
          if (payload.description.type === 'offer') { await pc.setLocalDescription(); socket.emit('voice:signal', { target: payload.from, description: pc.localDescription }); }
        } else if (payload.candidate) {
          if (peer.ignoreOffer) return;
          if (pc.remoteDescription) await pc.addIceCandidate(payload.candidate); else peer.candidates.push(payload.candidate);
        }
      } catch { if (alive && pc.connectionState !== 'closed') notifier.current('语音协商暂时失败，可以重新进入放映室'); }
    };
    const onLeft = ({ id }: { id: string }) => dispose(id);
    const onDisconnect = () => { generation.current++; for (const id of peers.current.keys()) dispose(id); stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setEnabled(false); };
    socket.on('room:state', onState); socket.on('voice:signal', onSignal); socket.on('peer:left', onLeft); socket.on('disconnect', onDisconnect);
    return () => { alive = false; generation.current++; socket.off('room:state', onState); socket.off('voice:signal', onSignal); socket.off('peer:left', onLeft); socket.off('disconnect', onDisconnect); for (const id of peers.current.keys()) dispose(id); stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  }, [socket]);
  const toggleMic = async () => {
    if (busy || !socket?.connected) return;
    if (enabled) {
      for (const p of peers.current.values()) void p.sender.replaceTrack(null);
      stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setEnabled(false); socket.emit('voice:state', { enabled: false }); return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { notify('麦克风需要 HTTPS 或 localhost 环境，请通过安全地址访问'); return; }
    setBusy(true); const currentGeneration = generation.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (currentGeneration !== generation.current || !socket.connected) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      await Promise.all([...peers.current.values()].map(p => p.sender.replaceTrack(media.getAudioTracks()[0])));
      setEnabled(true); socket.emit('voice:state', { enabled: true });
    } catch (e) { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; notify((e as DOMException).name === 'NotAllowedError' ? '麦克风未获授权，可在浏览器地址栏中允许使用' : '无法打开麦克风，请检查设备是否可用'); }
    finally { setBusy(false); }
  };
  const toggleListening = () => {
    const next = !listeningRef.current; listeningRef.current = next; setListening(next);
    for (const p of peers.current.values()) { p.audio.muted = !next; if (next) p.audio.play().catch(() => notify('无法播放语音，请检查浏览器声音权限')); }
  };
  return { enabled, busy, listening, toggleMic, toggleListening };
}
