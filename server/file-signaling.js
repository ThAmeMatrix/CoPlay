import { randomBytes } from 'node:crypto';

export function addFileSignaling(io, socket, rooms, { rate, broadcast }) {
  const memberRoom = () => { const r = rooms.get(socket.data.roomId); return r?.members.has(socket.id) && r.media.playbackType === 'local' ? r : null; };
  socket.on('file:available', (payload = {}, ack = () => {}) => {
    if (!payload || typeof ack !== 'function') return;
    const r = memberRoom(); if (!r) return ack({ error: '请先加入本地影片放映室' });
    // The seed capability belongs to the original file owner, independently of
    // whoever currently controls playback. Viewers cannot nominate themselves.
    if (!r.seedKey || payload.seedKey !== r.seedKey || payload.fingerprint !== r.media.localFile.fingerprint) return ack({ error: '文件提供者或文件指纹不匹配' });
    r.seedId = socket.id; broadcast(r); ack({ ok: true });
  });
  socket.on('file:signal', (payload = {}) => {
    if (!payload || typeof payload !== 'object') return;
    const r = memberRoom();
    if (!r || !r.members.has(payload.target) || socket.id === payload.target || !r.seedId) return;
    if (socket.id !== r.seedId && payload.target !== r.seedId) return;
    if (!rate(`file-signal:${socket.id}`, 500)) return;
    if (payload.description && (!['offer', 'answer'].includes(payload.description.type) || typeof payload.description.sdp !== 'string' || payload.description.sdp.length > 24000)) return;
    if (payload.candidate && JSON.stringify(payload.candidate).length > 3000) return;
    io.to(payload.target).emit('file:signal', { from: socket.id, description: payload.description, candidate: payload.candidate, request: payload.request === true });
  });
}
export function newSeedKey() { return randomBytes(24).toString('hex'); }
