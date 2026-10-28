import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export async function createRoomStore(rooms, dataDir, validateMedia, test = false) {
  let pending; let writes = Promise.resolve();
  if (!test) {
    try {
      const saved = JSON.parse(await readFile(path.join(dataDir, 'rooms.json'), 'utf8'));
      for (const r of Array.isArray(saved) ? saved : []) {
        const media = validateMedia(r.media);
        if (!media || !/^[a-f0-9]{8}$/.test(r.id || '') || !/^[a-f0-9]{48}$/.test(r.hostKey || '') || Date.now() - r.savedAt > 24 * 60 * 60000) continue;
        rooms.set(r.id, { ...r, media, members: new Map(), hostId: '', seedId: '', emptySince: Date.now(), messages: Array.isArray(r.messages) ? r.messages.slice(-200) : [], playback: { time: Math.max(0, Number(r.playback?.time) || 0), playing: false, updatedAt: Date.now() } });
      }
    } catch (e) { if (e.code !== 'ENOENT') console.error('Room snapshot load failed:', e.message); }
  }
  const flush = () => {
    clearTimeout(pending); pending = undefined;
    if (test) return Promise.resolve();
    const snapshot = JSON.stringify([...rooms.values()].map(r => ({ id: r.id, hostKey: r.hostKey, seedKey: r.seedKey || '', name: r.name, media: r.media, public: r.public, messages: r.messages.slice(-200), playback: r.playback, createdAt: r.createdAt, savedAt: Date.now() })));
    const current = writes.catch(() => {}).then(async () => { await mkdir(dataDir, { recursive: true }); await writeFile(path.join(dataDir, 'rooms.tmp'), snapshot); await rename(path.join(dataDir, 'rooms.tmp'), path.join(dataDir, 'rooms.json')); });
    writes = current; return current;
  };
  const schedule = () => { if (!test && !pending) { pending = setTimeout(() => { void flush().catch(e => console.error('Room snapshot save failed:', e.message)); }, 2000); pending.unref(); } };
  return { schedule, flush };
}
