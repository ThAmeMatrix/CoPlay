import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRoomStore } from '../server/room-store.js';
import { validateMedia } from '../server/app.js';

test('restart restores the room and capabilities but pauses playback and clears live connections', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'coplay-rooms-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const room = { id: '1234abcd', name: '本地放映室', hostKey: 'a'.repeat(48), seedKey: 'b'.repeat(48), seedId: 'old-socket', hostId: 'old-socket', members: new Map([['old-socket', {}]]), messages: [{ text: '保存的消息' }], createdAt: Date.now(), playback: { time: 120, playing: true, updatedAt: Date.now() }, media: { id: 'local', title: '本地视频', playbackType: 'local', localFile: { name: 'film.mp4', size: 999, mime: 'video/mp4', fingerprint: 'c'.repeat(64) } } };
  const store = await createRoomStore(new Map([[room.id, room]]), dir, validateMedia);
  await store.flush();
  const disk = JSON.parse(await readFile(path.join(dir, 'rooms.json'), 'utf8'));
  assert.equal(disk[0].members, undefined); assert.equal(disk[0].seedId, undefined);
  disk.push({ ...disk[0], id: '8765abcd', savedAt: Date.now() - 25 * 60 * 60000 });
  await writeFile(path.join(dir, 'rooms.json'), JSON.stringify(disk));
  const restored = new Map(); await createRoomStore(restored, dir, validateMedia);
  assert.equal(restored.size, 1); const r = restored.get(room.id);
  assert.equal(r.hostKey, room.hostKey); assert.equal(r.seedKey, room.seedKey); assert.equal(r.seedId, ''); assert.equal(r.hostId, ''); assert.equal(r.members.size, 0);
  assert.equal(r.playback.time, 120); assert.equal(r.playback.playing, false); assert.equal(r.messages[0].text, '保存的消息');
});
