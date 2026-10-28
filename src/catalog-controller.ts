import type { CatalogSource } from './types';
import { runCatalogJobs } from './catalog-client.ts';
import type { CatalogResult, createBrowserCatalogCache } from './catalog-client.ts';

export type CatalogEntry = { pages: Record<number, CatalogResult>; page: number; hasMore: boolean; loading: boolean; cached: boolean; updatedAt: number; warning: string; failedPage?: number };
export type DiskCacheInfo = { pages: number; items: number; bytes: number; updatedAt: number; error: string };
type Cache = ReturnType<typeof createBrowserCatalogCache>;
type Job = { source: CatalogSource; page: number; force?: boolean };
type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
const emptyEntry = (): CatalogEntry => ({ pages: {}, page: 0, hasMore: false, loading: false, cached: false, updatedAt: 0, warning: '' });
const signature = (sources: CatalogSource[]) => JSON.stringify(sources.map(s => [s.id, s.name, s.type, s.url, s.searchUrl, s.kind, s.enabled]));

export function createCatalogController({ cache, request, initialQuery = '', debounceMs = 350 }: { cache: Cache; request: Request; initialQuery?: string; debounceMs?: number }) {
  let state = { sources: cache.sources(), sourceId: 'all', query: initialQuery.trim(), entries: {} as Record<string, CatalogEntry>, loadingSources: true, clearing: false, error: '', notice: '', cacheInfo: cache.info(), diskInfo: undefined as DiskCacheInfo | undefined };
  const listeners = new Set<() => void>();
  let active = false;
  let cycle = new AbortController();
  let admin = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight = new Set<string>();
  const selected = () => state.sourceId === 'local' ? [] : state.sources.filter(s => state.sourceId === 'all' ? s.enabled : s.id === state.sourceId);
  const emit = (patch: Partial<typeof state> = {}) => { state = { ...state, ...patch, cacheInfo: cache.info() }; listeners.forEach(fn => fn()); };
  const current = (signal: AbortSignal) => active && !signal.aborted;
  function cancel() { clearTimeout(timer); cycle.abort(); inflight = new Set(); }
  function seed(refresh: boolean) {
    const entries: Record<string, CatalogEntry> = {}; const jobs: Job[] = [];
    for (const source of selected()) {
      const saved = cache.get(source, state.query, 1);
      const needsFetch = refresh || !saved || saved.stale;
      entries[source.id] = saved ? { ...emptyEntry(), pages: { 1: saved.result }, page: 1, hasMore: saved.result.hasMore, cached: true, updatedAt: saved.updatedAt, loading: needsFetch } : { ...emptyEntry(), loading: needsFetch };
      if (needsFetch) jobs.push({ source, page: 1, force: refresh });
    }
    state = { ...state, entries };
    return jobs;
  }
  seed(false);
  async function diskInfo(signal: AbortSignal) {
    try { const info = await request<DiskCacheInfo>('/api/catalog-cache', { signal }); if (current(signal)) emit({ diskInfo: info }); } catch { /* Browser cache remains usable when the local server is offline. */ }
  }
  async function fetchJobs(jobs: Job[]) {
    const signal = cycle.signal; const query = state.query; const running = inflight;
    const accepted = jobs.filter(j => !running.has(`${j.source.id}:${j.page}`));
    if (!current(signal) || !accepted.length) return;
    const entries = { ...state.entries };
    for (const job of accepted) { running.add(`${job.source.id}:${job.page}`); entries[job.source.id] = { ...(entries[job.source.id] || emptyEntry()), loading: true, warning: '' }; }
    emit({ entries });
    const apply = (job: Job, result?: CatalogResult, failure = '', stillLoading = false) => {
      if (!current(signal)) return;
      if (!stillLoading) running.delete(`${job.source.id}:${job.page}`);
      const old = state.entries[job.source.id] || emptyEntry();
      const warning = failure || result?.warnings.join('；') || '';
      const usable = result && (!warning || result.items.length > 0);
      const keepOld = !!warning && !!old.pages[job.page]?.items.length;
      if (result && !warning) cache.set(job.source, query, job.page, result);
      const next: CatalogEntry = {
        ...old, loading: stillLoading, warning, failedPage: warning ? job.page : undefined,
        pages: usable && !keepOld ? { ...old.pages, [job.page]: result } : old.pages,
        page: usable ? Math.max(old.page, job.page) : old.page,
        hasMore: usable ? result.hasMore : old.hasMore,
        cached: keepOld || !!result?.cache?.hit,
        updatedAt: usable && !keepOld ? result.cache?.fetchedAt || Date.now() : old.updatedAt,
      };
      emit({ entries: { ...state.entries, [job.source.id]: next } });
    };
    await runCatalogJobs(accepted, {
      signal,
      run: async (job, requestSignal) => {
        const url = `/api/catalog?q=${encodeURIComponent(query)}&source=${encodeURIComponent(job.source.id)}&page=${job.page}`;
        const result = await request<CatalogResult>(url + (job.force ? '&refresh=1' : ''), { signal: requestSignal });
        if (current(signal) && !job.force && result.cache?.stale && !result.warnings.length) {
          apply(job, result, '', true);
          return request<CatalogResult>(url + '&refresh=1', { signal: requestSignal });
        }
        return result;
      },
      onResult: (job, result) => apply(job, result),
      onError: (job, error) => apply(job, undefined, error.message),
    });
    if (current(signal)) void diskInfo(signal);
  }
  function select(sourceId: string, query: string, refresh = false, reset = false) {
    if (state.clearing) return;
    query = query.trim();
    if (!reset && !refresh && sourceId === state.sourceId && query === state.query) return;
    cancel(); cycle = new AbortController();
    state = { ...state, sourceId, query, error: '', notice: '' };
    const jobs = seed(refresh); emit();
    if (active) timer = setTimeout(() => { void fetchJobs(jobs); }, query && !refresh ? debounceMs : 0);
  }
  async function loadSources(force = false) {
    const signal = admin.signal;
    try {
      const sources = await request<CatalogSource[]>('/api/sources', { signal });
      if (!current(signal)) return;
      const changed = signature(sources) !== signature(state.sources);
      cache.setSources(sources); emit({ sources, loadingSources: false });
      if (changed || force) select(state.sourceId, state.query, force, true);
    } catch (error) { if (current(signal)) emit({ loadingSources: false, error: '来源列表读取失败：' + (error as Error).message }); }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    start() { active = true; admin = new AbortController(); state = { ...state, clearing: false, loadingSources: true }; select(state.sourceId, state.query, false, true); void loadSources(); void diskInfo(admin.signal); },
    stop() { active = false; cancel(); admin.abort(); },
    select,
    refresh() { if (!state.clearing) { select(state.sourceId, state.query, true); if (!state.sources.length) void loadSources(); } },
    retry(sourceId: string) { const source = selected().find(s => s.id === sourceId); if (source && !state.entries[sourceId]?.loading && !state.clearing) void fetchJobs([{ source, page: state.entries[sourceId]?.failedPage || 1, force: true }]); },
    loadMore() {
      if (state.clearing) return;
      const jobs: Job[] = []; const entries = { ...state.entries };
      for (const source of selected()) {
        const old = entries[source.id]; if (!old?.hasMore || old.loading) continue;
        const page = old.page + 1; const saved = cache.get(source, state.query, page);
        if (saved) entries[source.id] = { ...old, pages: { ...old.pages, [page]: saved.result }, page, hasMore: saved.result.hasMore, cached: true, updatedAt: saved.updatedAt };
        if (!saved || saved.stale) jobs.push({ source, page });
      }
      emit({ entries }); void fetchJobs(jobs);
    },
    async clear() {
      if (state.clearing) return;
      cancel(); admin.abort(); admin = new AbortController();
      const signal = admin.signal;
      cache.clear(); emit({ entries: {}, clearing: true, loadingSources: false, error: '', notice: '' });
      try { const info = await request<DiskCacheInfo>('/api/catalog-cache', { method: 'DELETE', signal }); if (current(signal)) emit({ diskInfo: info, notice: '目录缓存已清理，点击刷新重新获取。' }); }
      catch (error) { if (current(signal)) emit({ error: '浏览器缓存已清理，服务端缓存清理失败：' + (error as Error).message }); }
      finally { if (current(signal)) { cycle = new AbortController(); emit({ clearing: false }); } }
    },
    async configured() { if (state.clearing) return; cancel(); admin.abort(); admin = new AbortController(); cache.clear(); emit({ entries: {}, loadingSources: true }); await loadSources(true); },
  };
}
