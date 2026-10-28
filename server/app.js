import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { importResource } from './importers.js';
import { createSources } from './sources.js';
import { localAdmin } from './local-access.js';
import { addFileSignaling, newSeedKey } from './file-signaling.js';
import { createRoomStore } from './room-store.js';
import { createDownloads } from './downloads.js';
import { createPlayback } from './playback.js';
import { createCollections } from './collections.js';
import { createDownloadedLibrary } from './downloaded-library.js';

const clean = (value, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function safeUrl(value) { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }
export function validateMedia(media) {
  if (!media || !clean(media.title) || !['video', 'audio', 'embed', 'local'].includes(media.playbackType)) return null;
  if (media.playbackType === 'local') {
    const f = media.localFile;
    if (!f || !Number.isSafeInteger(f.size) || f.size <= 0 || f.size > 100 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(f.fingerprint || '') || !/^(video|audio)\/[a-zA-Z0-9.+-]+$/.test(f.mime || '')) return null;
    return { id: clean(media.id), title: clean(media.title, 150), subtitle: clean(media.subtitle), kind: f.mime.startsWith('audio/') ? '音乐' : clean(media.kind) || '电影', platform: '本地文件', cover: '', duration: clean(media.duration), url: '', playbackType: 'local', tags: ['本地文件', 'P2P'], description: '由文件提供者的浏览器通过 P2P 按需分享，媒体文件不上传服务器。', localFile: { name: clean(f.name, 180), size: f.size, mime: f.mime, fingerprint: f.fingerprint, lastModified: Number(f.lastModified) || 0 } };
  }
  if (!safeUrl(media.playbackUrl)) return null;
  if (media.playbackType === 'embed') {
    const u = new URL(media.playbackUrl);
    if (u.protocol !== 'https:' || !['www.youtube.com', 'player.bilibili.com', 'music.163.com', 'i.y.qq.com'].includes(u.hostname)) return null;
  }
  return { id: clean(media.id), title: clean(media.title, 150), subtitle: clean(media.subtitle), kind: clean(media.kind), platform: clean(media.platform), cover: safeUrl(media.cover) ? media.cover : '', playbackUrl: media.playbackUrl.slice(0, 2048), playbackType: media.playbackType, duration: clean(media.duration), url: safeUrl(media.url) ? media.url : '', tags: Array.isArray(media.tags) ? media.tags.slice(0, 8).map(t => clean(t, 30)) : [], description: clean(media.description, 1500), attribution: clean(media.attribution, 500), demo: !!media.demo };
}
export async function createApplication({ dataDir = path.resolve('data'), test = false } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { maxHttpBufferSize: 64 * 1024, allowRequest: (req, allow) => allow(null, test && localAdmin(req)) });
  const rooms = new Map();
  const sources = await createSources({ dataDir, test });
  const downloadedLibrary = await createDownloadedLibrary({ dataDir });
  const downloads = createDownloads({ library: downloadedLibrary });
  const collections = createCollections();
  const playback = createPlayback();
  const instanceId = randomUUID();
  const roomStore = await createRoomStore(rooms, dataDir, validateMedia, true);
  const limits = new Map();
  let comments = {};
  let writes = Promise.resolve();
  if (!test) {
    await mkdir(dataDir, { recursive: true });
    try { comments = JSON.parse(await readFile(path.join(dataDir, 'comments.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error('Could not load comments:', e.message); }
  }
  function persist() {
    if (test) return Promise.resolve();
    const snapshot = JSON.stringify(comments);
    const current = writes.catch(() => {}).then(async () => { await writeFile(path.join(dataDir, 'comments.tmp'), snapshot); await rename(path.join(dataDir, 'comments.tmp'), path.join(dataDir, 'comments.json')); });
    writes = current;
    return current;
  }
  function rate(key, count = 60, window = 60000) {
    const now = Date.now();
    const entry = limits.get(key);
    if (!entry || now - entry.at > window) { limits.set(key, { at: now, count: 1 }); return true; }
    return ++entry.count <= count;
  }
  const serialize = (room) => ({ id: room.id, name: room.name, media: room.media, public: room.public, hostId: room.hostId, seedId: room.seedId || '', members: [...room.members.values()], messages: room.messages, playback: room.playback, serverTime: Date.now() });
  const broadcast = (room) => { roomStore.schedule(); io.to(room.id).emit('room:state', serialize(room)); };
  app.use((req, res, next) => localAdmin(req) ? next() : res.status(403).json({ error: '此服务仅限本机访问' }));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!rate(`http:${req.ip}`, 150)) return res.status(429).json({ error: '操作太频繁，请稍后再试' });
    if (req.method !== 'GET' && req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: '请求来源不匹配' }); } catch { return res.status(403).json({ error: '请求来源无效' }); }
    }
    next();
  });
  app.get('/api/health', (_, res) => res.json({ ok: true, service: 'CoPlay', instanceId, localOnly: true, roomsEnabled: false }));
  app.get('/api/rtc-config', (_, res) => {
    res.json({ iceServers: [] });
  });
  const manage = (req, res, next) => localAdmin(req) ? next() : res.status(403).json({ error: '请在服务器本机 localhost 页面管理来源' });
  app.get('/api/network', (_req, res) => res.json({ localOnly: true, publicUrl: '', roomsEnabled: false }));
  app.use('/api/share', (_req, res) => res.status(410).json({ error: '公网分享已停用，仅限本地测试' }));
  if (!test) app.use('/api/rooms', (_req, res) => res.status(410).json({ error: '放映室功能已暂停，请使用资源广场或本地资源' }));
  app.get('/api/sources', (_req, res) => res.json(sources.list()));
  app.get('/api/catalog-cache', (_req, res) => res.json(sources.cacheInfo()));
  app.delete('/api/catalog-cache', manage, async (_req, res) => { try { await sources.clearCache(); res.json(sources.cacheInfo()); } catch { res.status(500).json({ error: '缓存清理未完成，请重试' }); } });
  app.post('/api/sources', manage, async (req, res) => { try { res.json(await sources.save(req.body)); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.get('/api/catalog', async (req, res) => {
    if (!rate(`catalog:${req.ip}`, 100)) return res.status(429).json({ error: '搜索太频繁，请稍后重试' });
    try { res.json(await sources.search({ query: clean(req.query.q, 100), sourceId: clean(req.query.source, 60) || 'all', page: Math.min(500, Math.max(1, Math.floor(Number(req.query.page) || 1))), refresh: req.query.refresh === '1' })); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/sources/resolve', async (req, res) => { try { res.json(await sources.resolve(clean(req.body?.sourceId, 60), clean(req.body?.key, 2048))); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/import', async (req, res) => {
    if (!rate(`import:${req.ip}`, 15)) return res.status(429).json({ error: '导入过于频繁，请一分钟后重试' });
    try { res.json(await importResource(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/collections', async (req, res) => {
    try { res.json(req.body?.session ? await collections.page(clean(req.body.session, 48), Number(req.body.cursor)) : await collections.start(clean(req.body?.url, 2048))); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.get('/api/downloaded-media', async (_req, res) => { try { res.json(await downloadedLibrary.list()); } catch (error) { res.status(500).json({ error: error.message }); } });
  app.get('/api/downloaded-media/:id/file', (req, res) => downloadedLibrary.send(req, res));
  app.post('/api/downloads/prepare', async (req, res) => {
    if (!rate(`download:${req.ip}`, 12)) return res.status(429).json({ error: '下载准备太频繁，请稍后再试' });
    const abort = new AbortController(); res.once('close', () => abort.abort());
    try { res.json(await downloads.prepare(req.body || {}, abort.signal)); } catch (e) { if (!res.destroyed) res.status(400).json({ error: e.message }); }
  });
  app.get('/api/downloads/:token/file', (req, res) => downloads.send(req, res));
  app.post('/api/playback/bilibili', async (req, res) => {
    if (!rate(`playback:${req.ip}`, 30)) return res.status(429).json({ error: '播放请求过于频繁，请稍后重试' });
    const abort = new AbortController(); res.once('close', () => abort.abort());
    try { res.json(await playback.prepare(req.body || {}, abort.signal)); } catch (e) { if (!res.destroyed) res.status(400).json({ error: e.message }); }
  });
  app.get('/api/playback/:token/video', (req, res) => playback.send(req, res));
  app.get('/api/rooms', (_, res) => res.json([...rooms.values()].filter(r => r.public && r.members.size).map(r => ({ id: r.id, name: r.name, media: r.media, count: r.members.size, createdAt: r.createdAt }))));
  app.post('/api/rooms', (req, res) => {
    const media = validateMedia(req.body?.media);
    if (!media) return res.status(400).json({ error: '请选择可播放的资源，或先导入媒体链接' });
    if (!rate(`create:${req.ip}`, 10) || rooms.size >= 500) return res.status(429).json({ error: '创建房间过于频繁，请稍后再试' });
    const id = randomBytes(4).toString('hex');
    const hostKey = randomBytes(24).toString('hex');
    const seedKey = media.playbackType === 'local' ? newSeedKey() : '';
    const now = Date.now();
    rooms.set(id, { id, hostKey, seedKey, seedId: '', name: clean(req.body.name, 60) || '一起看一场电影', media, public: !!req.body.public, hostId: '', members: new Map(), messages: [], playback: { playing: false, time: 0, updatedAt: now }, createdAt: now, emptySince: now });
    roomStore.schedule();
    res.status(201).json({ id, hostKey, seedKey });
  });
  app.get('/api/rooms/:id', (req, res) => {
    const r = rooms.get(req.params.id);
    if (!r) return res.status(404).json({ error: '放映室不存在或已结束，请检查邀请链接' });
    res.json({ id: r.id, name: r.name, media: r.media, count: r.members.size });
  });
  app.get('/api/resources/:id/comments', (req, res) => res.json(comments[req.params.id] || []));
  app.post('/api/resources/:id/comments', async (req, res) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(req.params.id)) return res.status(400).json({ error: '资源编号无效' });
    const text = clean(req.body?.text, 1000);
    if (!text) return res.status(400).json({ error: '写点什么再发送吧' });
    if (!rate(`comment:${req.ip}`, 8)) return res.status(429).json({ error: '评论太快了，稍等一下吧' });
    const comment = { id: randomUUID(), nickname: clean(req.body.nickname, 24) || '共映访客', text, at: Date.now() };
    comments[req.params.id] = [...(comments[req.params.id] || []), comment].slice(-200);
    try { await persist(); res.status(201).json(comment); } catch { res.status(500).json({ error: '评论暂时无法保存，请稍后重试' }); }
  });

  io.on('connection', (socket) => {
    const leaveRoom = () => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      room.members.delete(socket.id);
      if (room.seedId === socket.id) room.seedId = '';
      if (room.hostId === socket.id) room.hostId = room.members.keys().next().value || '';
      if (!room.members.size) room.emptySince = Date.now();
      socket.leave(room.id);
      socket.to(room.id).emit('peer:left', { id: socket.id });
      socket.data.roomId = undefined;
      broadcast(room);
    };
    socket.on('room:join', (payload = {}, ack = () => {}) => {
      if (typeof ack !== 'function' || !payload || typeof payload !== 'object') return;
      if (!rate(`join:${socket.id}`, 15)) return ack({ error: '加入过于频繁，请稍后重试' });
      const room = rooms.get(payload.id);
      if (!room) return ack({ error: '放映室不存在或已结束' });
      if (room.members.size >= 12 && !room.members.has(socket.id)) return ack({ error: '放映室已满（最多 12 人）' });
      if (socket.data.roomId && socket.data.roomId !== room.id) leaveRoom();
      socket.data.roomId = room.id;
      const member = { id: socket.id, nickname: clean(payload.nickname, 24) || '共映访客', mic: false };
      room.members.set(socket.id, member);
      if (!room.hostId || payload.hostKey === room.hostKey) room.hostId = socket.id;
      socket.join(room.id);
      ack({ room: serialize(room), selfId: socket.id });
      socket.to(room.id).emit('peer:joined', member);
      broadcast(room);
    });
    socket.on('room:leave', leaveRoom);
    socket.on('playback:update', (payload = {}) => {
      if (!payload || typeof payload !== 'object') return;
      const room = rooms.get(socket.data.roomId);
      if (!room || room.hostId !== socket.id || !['video', 'audio', 'local'].includes(room.media.playbackType)) return;
      if (!Number.isFinite(payload.time) || payload.time < 0 || payload.time > 604800 || typeof payload.playing !== 'boolean') return;
      if (!rate(`play:${socket.id}`, 80, 10000)) return;
      room.playback = { time: payload.time, playing: payload.playing, updatedAt: Date.now() };
      roomStore.schedule();
      socket.to(room.id).emit('playback:sync', { ...room.playback, serverTime: Date.now() });
    });
    socket.on('chat:send', (payload = {}, ack = () => {}) => {
      if (typeof ack !== 'function' || !payload || typeof payload !== 'object') return;
      const room = rooms.get(socket.data.roomId);
      if (!room) return ack({ error: '请先加入放映室' });
      const text = clean(payload.text, 500);
      if (!text) return ack({ error: '请输入消息' });
      if (!rate(`chat:${socket.id}`, 8, 10000)) return ack({ error: '发送太快了，稍等一下吧' });
      const message = { id: randomUUID(), nickname: room.members.get(socket.id).nickname, sender: socket.id, text, at: Date.now(), type: payload.type === 'danmaku' ? 'danmaku' : 'chat' };
      room.messages.push(message);
      room.messages = room.messages.slice(-200);
      roomStore.schedule();
      io.to(room.id).emit('chat:message', message);
      ack({ ok: true });
    });
    socket.on('voice:state', (payload = {}) => {
      if (!payload || typeof payload !== 'object') return;
      const room = rooms.get(socket.data.roomId);
      if (!room?.members.has(socket.id)) return;
      room.members.get(socket.id).mic = !!payload.enabled;
      io.to(room.id).emit('voice:state', { id: socket.id, enabled: !!payload.enabled });
    });
    socket.on('voice:signal', (payload = {}) => {
      if (!payload || typeof payload !== 'object') return;
      const room = rooms.get(socket.data.roomId);
      if (!room?.members.has(payload.target) || socket.id === payload.target) return;
      if (!rate(`signal:${socket.id}`, 300)) return;
      if (payload.description && (!['offer', 'answer'].includes(payload.description.type) || typeof payload.description.sdp !== 'string' || payload.description.sdp.length > 20000)) return;
      if (payload.candidate && JSON.stringify(payload.candidate).length > 3000) return;
      io.to(payload.target).emit('voice:signal', { from: socket.id, description: payload.description, candidate: payload.candidate });
    });
    addFileSignaling(io, socket, rooms, { rate, broadcast });
    socket.on('disconnect', leaveRoom);
  });
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '提交的内容过大' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: '请求内容格式不正确' });
    console.error(error);
    res.status(500).json({ error: '服务暂时不可用，请稍后重试' });
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) if (!room.members.size && now - room.emptySince > 15 * 60000) { rooms.delete(id); roomStore.schedule(); }
    for (const [key, value] of limits) if (now - value.at > 120000) limits.delete(key);
  }, 60000);
  cleanup.unref();
  httpServer.on('close', () => { clearInterval(cleanup); void roomStore.flush().catch(() => {}); void sources.flush().catch(() => {}); });
  return { app, httpServer, io, rooms, sources, roomStore, downloadedLibrary };
}
