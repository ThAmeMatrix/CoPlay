/* A byte-range bridge only. No media is cached or sent to the HTTP server. */
const sessions = new Map();
const BLOCK = 256 * 1024;
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  const m = event.data;
  if (!m || !event.source?.id || !/^[a-f0-9]{32}$/.test(m.token || '')) return;
  if (m.type === 'p2p:register' && Number.isSafeInteger(m.size) && m.size > 0 && /^(video|audio)\/[\w.+-]+$/.test(m.mime || '')) {
    sessions.set(m.token, { clientId: event.source.id, size: m.size, mime: m.mime });
    event.ports[0]?.postMessage({ ok: true });
  }
  if (m.type === 'p2p:unregister' && sessions.get(m.token)?.clientId === event.source.id) sessions.delete(m.token);
});
async function read(session, token, start, length, signal) {
  const client = await self.clients.get(session.clientId);
  if (!client) { sessions.delete(token); throw new Error('文件播放页面已关闭'); }
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = () => { clearTimeout(timer); channel.port1.close(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new Error('请求已取消')); };
    const timer = setTimeout(() => { finish(); reject(new Error('P2P 读取超时')); }, 30000);
    channel.port1.onmessage = ({ data }) => { finish(); if (data?.error || !(data?.buffer instanceof ArrayBuffer) || data.buffer.byteLength !== length) reject(new Error(data?.error || '文件片段不完整')); else resolve(new Uint8Array(data.buffer)); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    client.postMessage({ type: 'p2p:read', token, start, length }, [channel.port2]);
  });
}
self.addEventListener('fetch', event => {
  const u = new URL(event.request.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith('/_p2p/')) return;
  event.respondWith((async () => {
    const token = u.pathname.split('/')[2]; const session = sessions.get(token);
    if (!session) return new Response('P2P 会话已结束，请重新连接', { status: 410 });
    if (!['GET', 'HEAD'].includes(event.request.method)) return new Response('', { status: 405 });
    let start = 0, end = session.size - 1; const range = event.request.headers.get('range');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || !m[1] && !m[2]) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${session.size}` } });
      if (!m[1]) start = Math.max(0, session.size - Number(m[2]));
      else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${session.size}` } });
    }
    const headers = { 'Content-Type': session.mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${session.size}`;
    const abort = new AbortController(); event.request.signal.addEventListener('abort', () => abort.abort(), { once: true });
    let offset = start;
    const stream = new ReadableStream({
      async pull(controller) {
        if (offset > end) { controller.close(); return; }
        try { const length = Math.min(BLOCK, end - offset + 1); const chunk = await read(session, token, offset, length, abort.signal); offset += chunk.length; controller.enqueue(chunk); }
        catch (e) { controller.error(e); }
      },
      cancel() { abort.abort(); },
    }, { highWaterMark: 1 });
    return new Response(event.request.method === 'HEAD' ? null : stream, { status: range ? 206 : 200, headers });
  })());
});
