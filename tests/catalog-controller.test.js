import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserCatalogCache } from '../src/catalog-client.ts';
import { createCatalogController } from '../src/catalog-controller.ts';

const source = id => ({ id, name: id, url: `https://${id}.example/`, type: 'html', kind: '电影', enabled: true, status: { state: 'idle', message: '' } });
const result = name => ({ items: [{ id: name, title: name, tags: [] }], warnings: [], page: 1, hasMore: false });
const info = { pages: 0, items: 0, bytes: 0, updatedAt: 0, error: '' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function when(controller, predicate) {
  if (predicate(controller.getSnapshot())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('state transition timed out')); }, 2000);
    const off = controller.subscribe(() => { if (predicate(controller.getSnapshot())) { clearTimeout(timer); off(); resolve(); } });
  });
}
test('UI lifecycle delivers fast sources, ignores previous searches and stops updates after unmount', async t => {
  const sources = [source('slow'), source('fast')]; const old = deferred(); const unmounted = deferred();
  const cache = createBrowserCatalogCache(); cache.setSources(sources);
  const controller = createCatalogController({ cache, debounceMs: 0, request: async url => {
    if (url === '/api/sources') return sources;
    if (url === '/api/catalog-cache') return info;
    const u = new URL(url, 'http://localhost');
    if (u.searchParams.get('q') === 'unmount') return unmounted.promise;
    if (u.searchParams.get('q') === 'new') return result('new-' + u.searchParams.get('source'));
    return u.searchParams.get('source') === 'slow' ? old.promise : result('fast');
  } });
  t.after(() => controller.stop()); controller.start();
  await when(controller, s => !!s.entries.fast?.page);
  assert.equal(controller.getSnapshot().entries.slow.loading, true);
  controller.select('all', 'new');
  await when(controller, s => s.entries.slow?.pages[1]?.items[0].id === 'new-slow');
  old.resolve(result('old')); await tick();
  assert.equal(controller.getSnapshot().entries.slow.pages[1].items[0].id, 'new-slow');
  assert.equal(cache.get(sources[0], '', 1), undefined);
  controller.select('all', 'unmount'); await tick();
  controller.stop(); const before = controller.getSnapshot(); unmounted.resolve(result('late')); await tick();
  assert.equal(controller.getSnapshot(), before);
});
test('clear cancels pending source-list and page requests so neither can restore cleared cache', async t => {
  const sources = [source('first')]; const list = deferred(); const page = deferred();
  const cache = createBrowserCatalogCache(); cache.setSources(sources);
  const controller = createCatalogController({ cache, debounceMs: 0, request: async (url, options) => {
    if (url === '/api/sources') return list.promise;
    if (url === '/api/catalog-cache') return info;
    return page.promise;
  } });
  t.after(() => controller.stop()); controller.start(); await tick();
  await controller.clear();
  list.resolve([source('changed')]); page.resolve(result('late')); await tick();
  assert.equal(controller.getSnapshot().clearing, false);
  assert.deepEqual(controller.getSnapshot().entries, {});
  assert.equal(cache.info().pages, 0); assert.equal(cache.sources()[0].id, 'first');
});
test('stale disk content appears before revalidation; refresh failure keeps content and retry recovers', async t => {
  const sources = [source('first')]; const fresh = deferred(); let refreshes = 0;
  const cache = createBrowserCatalogCache(); cache.setSources(sources);
  const controller = createCatalogController({ cache, request: async url => {
    if (url === '/api/sources') return sources;
    if (url === '/api/catalog-cache') return info;
    if (url.includes('refresh=1')) { refreshes++; if (refreshes === 1) return fresh.promise; return result('recovered'); }
    return { ...result('cached'), cache: { hit: true, stale: true, fetchedAt: Date.now() - 700000 } };
  } });
  t.after(() => controller.stop()); controller.start();
  await when(controller, s => s.entries.first?.pages[1]?.items[0].id === 'cached');
  assert.equal(controller.getSnapshot().entries.first.loading, true);
  fresh.resolve({ ...result('cached'), warnings: ['first：暂时离线'], cache: { hit: true, stale: true, fetchedAt: Date.now() - 700000 } });
  await when(controller, s => !!s.entries.first?.warning);
  assert.equal(controller.getSnapshot().entries.first.loading, false);
  assert.equal(controller.getSnapshot().entries.first.pages[1].items[0].id, 'cached');
  controller.retry('first');
  await when(controller, s => s.entries.first?.pages[1]?.items[0].id === 'recovered');
  assert.equal(controller.getSnapshot().entries.first.warning, '');
});
test('fresh browser content is available before start and does not re-fetch catalogs', async t => {
  const s = source('first'); const cache = createBrowserCatalogCache(); cache.setSources([s]); cache.set(s, '', 1, result('instant'));
  let catalogCalls = 0;
  const controller = createCatalogController({ cache, request: async url => { if (url === '/api/sources') return [s]; if (url === '/api/catalog-cache') return info; catalogCalls++; return result('unexpected'); } });
  assert.equal(controller.getSnapshot().entries.first.pages[1].items[0].id, 'instant');
  t.after(() => controller.stop()); controller.start(); await when(controller, s => !s.loadingSources); await tick();
  assert.equal(catalogCalls, 0);
});
