// Cache reads never start background work. The client explicitly revalidates
// stale pages, so each source can update independently.
export function createCatalogReader({ cache, fetchPage, now = Date.now }) {
  const pending = new Map();
  const failures = new Map();
  const statuses = new Map();
  let revision = 0;
  const assertCurrent = started => {
    if (started !== revision) throw Object.assign(new Error('目录请求已失效，请重新加载'), { code: 'CATALOG_INVALIDATED' });
  };
  const decorate = (value, hit, warning = '') => ({ ...value, warning, cache: { hit, stale: now() - value.fetchedAt >= 600000 || !!warning, fetchedAt: value.fetchedAt } });
  async function get(source, key, query, page, refresh = false) {
    const old = cache.get(key);
    if (old && !refresh) return decorate(old, true);
    if (pending.has(key)) return pending.get(key);
    const failed = failures.get(source.id);
    if (!refresh && failed?.until > now()) throw failed.error;
    const started = revision;
    const promise = (async () => {
      try {
        const result = await fetchPage(source, query, page);
        assertCurrent(started);
        cache.set(key, result);
        failures.delete(source.id);
        statuses.set(source.id, { state: 'ok', count: result.items.length, checkedAt: now(), message: result.items.length ? `已读取 ${result.items.length} 条内容` : '没有匹配的内容' });
        return decorate(result, false);
      } catch (error) {
        assertCurrent(started);
        const until = now() + Math.min(300, Math.max(60, error.retryAfter || 60)) * 1000;
        failures.set(source.id, { error, until });
        statuses.set(source.id, { state: 'error', message: error.message, checkedAt: now(), retryAt: until });
        if (old) return decorate(old, true, error.message);
        throw error;
      }
    })();
    pending.set(key, promise);
    try { return await promise; }
    finally { if (pending.get(key) === promise) pending.delete(key); }
  }
  return {
    get,
    status: sourceId => statuses.get(sourceId),
    async clear() {
      // Invalidate both cache writes AND results of requests already in flight.
      revision++; pending.clear(); failures.clear(); statuses.clear();
      await cache.clear();
    },
  };
}
