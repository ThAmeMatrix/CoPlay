import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCatalogCache } from '../server/catalog-cache.js';
import { createCatalogReader } from '../server/catalog-reader.js';

const page = (name, at = Date.now()) => ({ items: [{ id: name, title: name }], hasMore: false, fetchedAt: at });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('catalog survives restart, expires, stays bounded and clears on disk', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'coplay-catalog-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let clock = 1000;
  const options = { dataDir, maxEntries: 2, maxAge: 5000, now: () => clock };
  const cache = await createCatalogCache(options);
  cache.set('a', page('a', clock)); cache.set('b', page('b', clock));
  cache.get('a'); cache.set('c', page('c', clock));
  assert.equal(cache.get('b'), undefined);
  await cache.flush();
  const restored = await createCatalogCache(options);
  assert.equal(restored.get('a').items[0].title, 'a');
  assert.equal(restored.info().pages, 2);
  clock = 7000; assert.equal(restored.get('a'), undefined);
  await restored.clear();
  assert.equal((await createCatalogCache(options)).info().pages, 0);
  await writeFile(path.join(dataDir, 'catalog-cache.json'), 'broken');
  assert.equal((await createCatalogCache(options)).info().pages, 0);
});

test('fresh/stale cache reads are instant, refresh is explicit, and failure preserves cached content', async () => {
  let clock = 1000; let requests = 0; let fail = false;
  const cache = await createCatalogCache({ persist: false, now: () => clock });
  const reader = createCatalogReader({ cache, now: () => clock, fetchPage: async () => { requests++; if (fail) throw new Error('upstream offline'); return page('movie', clock); } });
  const source = { id: 'fixture' };
  await reader.get(source, 'key', '', 1);
  clock += 700000;
  const cached = await reader.get(source, 'key', '', 1);
  assert.equal(cached.cache.stale, true); assert.equal(requests, 1);
  fail = true;
  const fallback = await reader.get(source, 'key', '', 1, true);
  assert.equal(fallback.items[0].id, 'movie'); assert.equal(fallback.warning, 'upstream offline');
  assert.equal(requests, 2);
  await assert.rejects(reader.get(source, 'other', '', 2), /offline/);
  assert.equal(requests, 2);
});

test('clear invalidates late results and does not let old cleanup remove a newer request', async () => {
  const first = deferred(); const second = deferred(); let requests = 0;
  const cache = await createCatalogCache({ persist: false });
  const reader = createCatalogReader({ cache, fetchPage: () => ++requests === 1 ? first.promise : second.promise });
  const source = { id: 'fixture' };
  const old = reader.get(source, 'key', '', 1);
  const rejected = assert.rejects(old, { code: 'CATALOG_INVALIDATED' });
  await reader.clear();
  const current = reader.get(source, 'key', '', 1);
  first.resolve(page('old')); await rejected;
  assert.equal(cache.get('key'), undefined); assert.equal(reader.status(source.id), undefined);
  const duplicate = reader.get(source, 'key', '', 1);
  assert.equal(requests, 2);
  second.resolve(page('new'));
  assert.equal((await current).items[0].id, 'new');
  assert.equal((await duplicate).items[0].id, 'new');
  assert.equal(cache.get('key').items[0].id, 'new');
});
