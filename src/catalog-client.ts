import type { CatalogSource, Media } from './types';

export type CatalogResult = { items: Media[]; warnings: string[]; page: number; hasMore: boolean; total?: number; cache?: { hit: boolean; stale: boolean; fetchedAt: number } };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type CachedPage = { key: string; sourceId: string; result: CatalogResult; updatedAt: number };
const storageKey = 'coplay:catalog-cache:v1';
const week = 7 * 86400000;
const keyFor = (source: CatalogSource, query: string, page: number) => JSON.stringify([source.id, source.type, source.url, source.searchUrl || '', source.name, source.kind, query.trim(), page, ...(query.trim() ? ['remote-search-v2'] : [])]);

export function createBrowserCatalogCache(storage?: StorageLike, now = Date.now, maxBytes = 2 * 1024 ** 2) {
  let sources: CatalogSource[] = [];
  let pages: CachedPage[] = [];
  let error = '';
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  const encode = () => JSON.stringify({ version: 1, sources, pages });
  const prune = () => { pages = pages.filter(p => now() - p.updatedAt <= week).slice(-40); while (pages.length && bytes(encode()) > maxBytes) pages.shift(); };
  try {
    const raw = storage?.getItem(storageKey);
    if (raw && bytes(raw) <= maxBytes) {
      const saved = JSON.parse(raw);
      if (saved.version === 1) {
        sources = Array.isArray(saved.sources) ? saved.sources.filter((s: CatalogSource) => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.url === 'string' && s.status).slice(0, 20) : [];
        pages = Array.isArray(saved.pages) ? saved.pages.filter((p: CachedPage) => p && typeof p.key === 'string' && Number.isFinite(p.updatedAt) && Array.isArray(p.result?.items) && p.result.items.length <= 300 && p.result.items.every(m => m && typeof m.id === 'string' && typeof m.title === 'string' && Array.isArray(m.tags)) && Array.isArray(p.result.warnings)) : [];
        prune();
      }
    }
  } catch { error = '本地目录缓存无法读取，将重新获取'; }
  const persist = () => {
    prune();
    try { storage?.setItem(storageKey, encode()); error = storage ? '' : '浏览器未开放存储，本次目录仅临时保留'; }
    catch { error = '浏览器存储空间不足，本次目录仅临时保留'; }
  };
  return {
    sources: () => sources,
    setSources(next: CatalogSource[]) { sources = next; pages = pages.filter(p => next.some(s => s.id === p.sourceId && p.key.startsWith(JSON.stringify([s.id, s.type, s.url, s.searchUrl || '', s.name, s.kind]).slice(0, -1) + ','))); persist(); },
    get(source: CatalogSource, query: string, page: number) {
      const item = pages.find(p => p.key === keyFor(source, query, page));
      if (!item || now() - item.updatedAt > week) return undefined;
      return { ...item, stale: now() - item.updatedAt >= 600000 };
    },
    set(source: CatalogSource, query: string, page: number, result: CatalogResult) {
      if (result.warnings.length) return;
      const key = keyFor(source, query, page);
      pages = pages.filter(p => p.key !== key);
      pages.push({ key, sourceId: source.id, result, updatedAt: result.cache?.fetchedAt || now() });
      persist();
    },
    clear() { pages = []; persist(); },
    info() { prune(); return { pages: pages.length, items: new Set(pages.flatMap(p => p.result.items.map(m => m.id))).size, bytes: bytes(encode()), updatedAt: Math.max(0, ...pages.map(p => p.updatedAt)), error }; },
  };
}

// Each completion is delivered immediately; cancellation discards late replies
// and stops queued jobs. Slow or failed sources never hold back completed ones.
export async function runCatalogJobs<T, R>(jobs: T[], options: { signal: AbortSignal; run: (job: T, signal: AbortSignal) => Promise<R>; onResult: (job: T, result: R) => void; onError: (job: T, error: Error) => void; concurrency?: number }) {
  let index = 0;
  async function worker() {
    while (!options.signal.aborted && index < jobs.length) {
      const job = jobs[index++];
      try { const result = await options.run(job, options.signal); if (!options.signal.aborted) options.onResult(job, result); }
      catch (error) { if (!options.signal.aborted) options.onError(job, error as Error); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs.length, options.concurrency || 3) }, worker));
}
