import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserCatalogCache, runCatalogJobs } from '../src/catalog-client.ts';

const source = { id: 'fixture', name: '影片来源', type: 'html', url: 'https://films.example/', kind: '电影', enabled: true, status: { state: 'ok', message: '' } };
const page = name => ({ items: [{ id: name, title: name, tags: [] }], warnings: [], page: 1, hasMore: false });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('browser catalog restores immediately, expires and invalidates edited sources without touching favorites', () => {
  const values = new Map([['coplay:favorites', 'keep']]);
  const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  let clock = 1000;
  const cache = createBrowserCatalogCache(storage, () => clock);
  cache.setSources([source]); cache.set(source, '', 1, page('movie'));
  const restored = createBrowserCatalogCache(storage, () => clock);
  assert.equal(restored.get(source, '', 1).result.items[0].title, 'movie');
  clock += 700000; assert.equal(restored.get(source, '', 1).stale, true);
  restored.setSources([{ ...source, url: 'https://new.example/' }]);
  assert.equal(restored.get(source, '', 1), undefined);
  restored.set(source, '', 1, page('movie'));
  clock += 8 * 86400000; assert.equal(restored.get(source, '', 1), undefined);
  restored.clear(); assert.equal(restored.info().pages, 0); assert.equal(values.get('coplay:favorites'), 'keep');
});
test('browser cache stays bounded and survives unavailable storage', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const cache = createBrowserCatalogCache(storage, Date.now, 2000);
  for (let n = 0; n < 20; n++) cache.set(source, String(n), 1, page('影片'.repeat(40) + n));
  assert.ok(cache.info().bytes <= 2000); assert.ok(cache.info().pages < 20); assert.match(cache.info().error, /存储/);
});
test('fast source is delivered while another is pending; failures do not block the remaining queue', async () => {
  const slow = deferred(); const delivered = deferred(); const results = []; const errors = [];
  const loading = runCatalogJobs(['slow', 'fast', 'failed', 'last'], {
    signal: new AbortController().signal, concurrency: 2,
    run: async name => { if (name === 'slow') return slow.promise; if (name === 'failed') throw new Error('offline'); return name; },
    onResult: (job, result) => { results.push(result); if (job === 'last') delivered.resolve(); },
    onError: (_job, error) => errors.push(error.message),
  });
  await delivered.promise;
  assert.deepEqual(results, ['fast', 'last']); assert.deepEqual(errors, ['offline']);
  slow.resolve('slow'); await loading; assert.deepEqual(results, ['fast', 'last', 'slow']);
});
test('search changes and cache clearing cancel queued work and discard late responses', async () => {
  const pending = deferred(); const controller = new AbortController(); let requests = 0; const results = [];
  const loading = runCatalogJobs(['old', 'queued'], { signal: controller.signal, concurrency: 1, run: () => { requests++; return pending.promise; }, onResult: (_job, result) => results.push(result), onError: () => assert.fail('cancelled callback') });
  controller.abort(); pending.resolve('old data'); await loading;
  assert.equal(requests, 1); assert.deepEqual(results, []);
});
