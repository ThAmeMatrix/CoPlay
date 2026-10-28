import { mkdir, readFile, writeFile, rename, open, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';

export async function createDownloadedLibrary({ dataDir }) {
  const root = path.resolve(dataDir, 'downloaded-media'), manifest = path.join(root, 'index.json');
  const records = new Map(), active = new Set(); let writes = Promise.resolve();
  await mkdir(root, { recursive: true });
  try { const saved = JSON.parse(await readFile(manifest, 'utf8')); for (const item of saved) if (/^bili:BV[a-zA-Z0-9]{10}:p\d+$/.test(item.key) && Array.isArray(item.files)) records.set(item.key, item); } catch (error) { if (error.code !== 'ENOENT') console.error('Downloaded library could not be read:', error.message); }
  const filePath = id => /^[a-f0-9]{48}$/.test(id || '') ? path.join(root, `${id}.mp4`) : null;
  const persist = () => {
    const snapshot = JSON.stringify([...records.values()]);
    writes = writes.catch(() => {}).then(async () => { await writeFile(manifest + '.tmp', snapshot); await rename(manifest + '.tmp', manifest); });
    return writes;
  };
  async function accessible(file) { try { const location = filePath(file.id); if (!location) return false; const info = await stat(location); return info.isFile() && info.size === file.size; } catch { return false; } }
  return {
    async list() {
      return Promise.all([...records.values()].map(async record => {
        const files = await Promise.all(record.files.map(async file => ({ id: file.id, filename: file.filename, size: file.size, segment: file.segment, url: `/api/downloaded-media/${file.id}/file`, available: await accessible(file) })));
        return { key: record.key, title: record.title, page: record.page, savedAt: record.savedAt, files, complete: files.length === record.segmentCount && files.every(file => file.available) };
      }));
    },
    async begin(ticket) {
      const lock = `${ticket.key}:${ticket.segment}`;
      if (!ticket.key || active.has(lock)) return null;
      active.add(lock);
      const id = randomBytes(24).toString('hex'), destination = filePath(id), temporary = destination + '.part';
      let handle;
      try { handle = await open(temporary, 'wx'); } catch (error) { active.delete(lock); throw error; }
      let bytes = 0, closed = false, committed = false;
      const close = async () => { if (!closed) { closed = true; await handle.close(); } };
      const transform = new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > ticket.size) return done(new Error('下载长度超过预期'));
        handle.writeFile(chunk).then(() => done(null, chunk), done);
      } });
      return {
        transform,
        async commit() {
          try {
            await close();
            if (bytes !== ticket.size) throw new Error('下载未完整完成，不会作为本地副本播放');
            await rename(temporary, destination);
            const previous = records.get(ticket.key);
            const record = previous?.group === ticket.group ? { ...previous, files: [...previous.files] } : { key: ticket.key, title: ticket.title, page: ticket.page, group: ticket.group, segmentCount: ticket.segmentCount, files: [] };
            record.files = [...record.files.filter(file => file.segment !== ticket.segment), { id, segment: ticket.segment, filename: ticket.filename, size: ticket.size }].sort((a, b) => a.segment - b.segment);
            record.savedAt = Date.now(); records.set(ticket.key, record);
            try { await persist(); } catch (error) { if (records.get(ticket.key) === record) previous ? records.set(ticket.key, previous) : records.delete(ticket.key); throw error; }
            committed = true;
            const retained = new Set([...records.values()].flatMap(item => item.files.map(file => file.id)));
            for (const old of previous?.files || []) if (!retained.has(old.id) && filePath(old.id)) await unlink(filePath(old.id)).catch(() => {});
          } finally { active.delete(lock); }
        },
        async abort() { active.delete(lock); await close().catch(() => {}); if (!committed) { await unlink(temporary).catch(() => {}); await unlink(destination).catch(() => {}); } },
      };
    },
    async send(req, res) {
      const record = [...records.values()].flatMap(item => item.files).find(file => file.id === req.params.id);
      if (!record || !await accessible(record)) return res.status(404).json({ error: '下载副本已被删除或不完整，请重新下载或使用在线播放' });
      res.set('X-Content-Type-Options', 'nosniff'); res.set('Cross-Origin-Resource-Policy', 'same-origin'); res.type('video/mp4');
      if (req.query.download === '1') res.set('Content-Disposition', `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(record.filename).replace(/'/g, '%27')}`);
      res.sendFile(filePath(record.id), { acceptRanges: true, cacheControl: false }, error => { if (error && !res.headersSent) res.status(error.status || 500).end(); });
    },
    flush: () => writes,
  };
}
