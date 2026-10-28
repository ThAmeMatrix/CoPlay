import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export async function createCatalogCache({ dataDir, persist = true, maxEntries = 100, maxBytes = 12 * 1024 ** 2, maxAge = 7 * 86400000, now = Date.now }) {
  const entries = new Map();
  const file = path.join(dataDir || '.', 'catalog-cache.json');
  let timer; let writes = Promise.resolve(); let persistenceError = '';
  const size = value => Buffer.byteLength(JSON.stringify(value));
  const valid = value => value && Array.isArray(value.items) && value.items.length <= 300 && Number.isFinite(value.fetchedAt) && now() - value.fetchedAt <= maxAge;
  const prune = () => {
    for (const [key, value] of entries) if (!valid(value)) entries.delete(key);
    let bytes = size([...entries]);
    while (entries.size && (entries.size > maxEntries || bytes > maxBytes)) { const key = entries.keys().next().value; bytes -= size([key, entries.get(key)]) + 1; entries.delete(key); }
  };
  if (persist) {
    try {
      if ((await stat(file)).size <= maxBytes + 1024) {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        if (saved.version === 1 && Array.isArray(saved.entries)) for (const [key, value] of saved.entries) if (typeof key === 'string' && valid(value)) entries.set(key, value);
        prune();
      }
    } catch (e) { if (e.code !== 'ENOENT') persistenceError = '目录缓存无法读取，已重新建立'; }
  }
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (!persist) return Promise.resolve();
    const content = JSON.stringify({ version: 1, entries: [...entries] });
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file + '.tmp', content); await rename(file + '.tmp', file); persistenceError = '';
    }).catch(e => { persistenceError = '目录缓存暂时无法保存到磁盘'; throw e; });
    return writes;
  };
  const schedule = () => { if (persist && !timer) { timer = setTimeout(() => { void flush().catch(() => {}); }, 250); timer.unref(); } };
  return {
    get(key) { const value = entries.get(key); if (!valid(value)) { entries.delete(key); return undefined; } entries.delete(key); entries.set(key, value); return value; },
    set(key, value) { if (!valid(value)) return; entries.delete(key); entries.set(key, value); prune(); schedule(); },
    async clear() { entries.clear(); await flush(); },
    info() { prune(); return { pages: entries.size, items: new Set([...entries.values()].flatMap(v => v.items.map(m => m.id))).size, bytes: size([...entries]), updatedAt: Math.max(0, ...[...entries.values()].map(v => v.fetchedAt)), maxBytes, retentionDays: maxAge / 86400000, error: persistenceError }; },
    flush,
  };
}
