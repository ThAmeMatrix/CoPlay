import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as client } from 'socket.io-client';
import { createApplication, validateMedia } from '../server/app.js';
import { importResource } from '../server/importers.js';

const media = { id: 'test-media', title: 'Open film', kind: '电影', platform: '媒体链接', playbackType: 'video', playbackUrl: 'https://media.w3.org/2010/05/bunny/movie.mp4', url: 'https://media.w3.org/', tags: ['可同步'] };
const event = (socket, name, timeout = 2500) => new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out waiting for ${name}`)); }, timeout); const handler = data => { clearTimeout(timer); resolve(data); }; socket.once(name, handler); });
const ack = (socket, name, body) => new Promise((resolve, reject) => socket.timeout(2500).emit(name, body, (error, value) => error ? reject(error) : resolve(value)));

test('media validation excludes executable URLs and unapproved embeds', () => {
  assert.ok(validateMedia(media));
  assert.equal(validateMedia({ ...media, playbackUrl: 'javascript:alert(1)' }), null);
  assert.equal(validateMedia({ ...media, playbackType: 'embed', playbackUrl: 'https://attacker.example/iframe' }), null);
  assert.ok(validateMedia({ ...media, playbackType: 'embed', playbackUrl: 'https://player.bilibili.com/player.html?bvid=BV1B7411m7LV' }));
});

test('imports direct audio/video and rejects unsupported URL schemes/hosts', async () => {
  const audio = await importResource({ url: 'https://example.com/music.mp3?token=abc', title: 'My song' });
  assert.equal(audio.resource.playbackType, 'audio');
  assert.equal(audio.resource.kind, '音乐');
  assert.equal(audio.resource.title, 'My song');
  assert.equal(audio.resource.playbackUrl, 'https://example.com/music.mp3?token=abc');
  const video = await importResource({ url: media.playbackUrl, kind: '电影' });
  assert.equal(video.resource.kind, '电影');
  await assert.rejects(importResource({ url: 'file:///etc/passwd' }));
  await assert.rejects(importResource({ url: 'http://127.0.0.1/private' }));
  await assert.rejects(importResource({ url: 'http://localhost/video/BV1B7411m7LV' }));
  await assert.rejects(importResource({ url: 'https://music.163.com/#/song?id=invalid' }));
  await assert.rejects(importResource({ url: 'ftp://example.com/', title: 'no media' }));
});

test('two clients share playback, messages, presence and host succession; signals remain inside room', async t => {
  const { app, httpServer, io } = await createApplication({ test: true });
  httpServer.listen(0, '127.0.0.1'); await once(httpServer, 'listening');
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  const clients = [];
  t.after(() => { clients.forEach(s => s.disconnect()); io.close(); httpServer.close(); });
  const request = async (route, body) => { const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  const connect = async () => { const socket = client(base, { transports: ['websocket'], forceNew: true }); clients.push(socket); await event(socket, 'connect'); return socket; };
  assert.equal((await request('/api/health')).data.ok, true);
  assert.equal((await request('/api/rooms', null)).status, 400);
  assert.equal((await request('/api/rooms', { media: { ...media, playbackType: 'external' } })).status, 400);
  const { data: created } = await request('/api/rooms', { name: 'Test room', media, public: true });
  assert.match(created.id, /^[0-9a-f]{8}$/);
  assert.equal((await request('/api/rooms')).data.length, 0, 'unoccupied rooms are not listed');
  const host = await connect(); const guest = await connect(); const outsider = await connect();
  for (const name of ['room:join', 'playback:update', 'chat:send', 'voice:state', 'voice:signal']) outsider.emit(name, null);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await request('/api/health')).data.ok, true, 'malformed socket messages do not crash the server');
  const hostJoin = await ack(host, 'room:join', { id: created.id, nickname: 'Host', hostKey: created.hostKey });
  assert.equal(hostJoin.room.hostId, host.id);
  assert.equal(hostJoin.room.hostKey, undefined, 'host capability is never broadcast');
  const guestJoin = await ack(guest, 'room:join', { id: created.id, nickname: 'Guest' });
  assert.equal(guestJoin.room.members.length, 2);
  assert.equal((await request('/api/rooms')).data[0].count, 2);
  const metadata = (await request(`/api/rooms/${created.id}`)).data;
  assert.equal(metadata.hostKey, undefined);
  assert.ok((await ack(outsider, 'room:join', { id: 'missing' })).error);

  let unauthorized = false;
  host.once('playback:sync', () => { unauthorized = true; });
  guest.emit('playback:update', { time: 900, playing: true });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(unauthorized, false, 'guests cannot override host playback');
  const sync = event(guest, 'playback:sync');
  host.emit('playback:update', { time: 42.5, playing: true });
  const synced = await sync;
  assert.equal(synced.time, 42.5); assert.equal(synced.playing, true);
  const pause = event(guest, 'playback:sync'); host.emit('playback:update', { time: 46, playing: false }); assert.equal((await pause).playing, false);

  const chat = event(host, 'chat:message');
  assert.equal((await ack(guest, 'chat:send', { text: 'We are watching together!', type: 'danmaku' })).ok, true);
  const message = await chat; assert.equal(message.nickname, 'Guest'); assert.equal(message.type, 'danmaku');
  const mic = event(guest, 'voice:state'); host.emit('voice:state', { enabled: true }); assert.equal((await mic).enabled, true);
  const signal = event(guest, 'voice:signal'); host.emit('voice:signal', { target: guest.id, description: { type: 'offer', sdp: 'test-sdp' } }); assert.equal((await signal).from, host.id);
  let leaked = false; guest.once('voice:signal', () => { leaked = true; }); outsider.emit('voice:signal', { target: guest.id, description: { type: 'offer', sdp: 'malicious' } }); await new Promise(r => setTimeout(r, 80)); assert.equal(leaked, false);

  const comment = await request('/api/resources/test-media/comments', { nickname: 'Test user', text: 'Great shared moment' }); assert.equal(comment.status, 201);
  const saved = await request('/api/resources/test-media/comments'); assert.equal(saved.data[0].text, 'Great shared moment');
  assert.equal((await request('/api/resources/test-media/comments', { text: '   ' })).status, 400);

  const migrated = event(guest, 'room:state'); host.disconnect(); assert.equal((await migrated).hostId, guest.id);
  const newHostJoin = await ack(outsider, 'room:join', { id: created.id, nickname: 'Late arrival' });
  assert.equal(newHostJoin.room.playback.time, 46, 'late arrival receives current progress');
  assert.equal(newHostJoin.room.messages.length, 1, 'late arrival receives room history');
  const transferredSync = event(outsider, 'playback:sync'); guest.emit('playback:update', { time: 54, playing: true }); assert.equal((await transferredSync).time, 54);
});
