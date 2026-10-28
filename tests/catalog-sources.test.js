import test from 'node:test';
import assert from 'node:assert/strict';
import { createSources } from '../server/sources.js';
const source = { id: 'fixture', name: '测试', url: 'https://films.example/', type: 'html', kind: '电影' };
const response = (url, title) => ({ url, body: Buffer.from(`<a href="/detail/1" title="${title}"><img src="/poster.jpg"></a>`) });
test('single-source cache refresh does not fetch unrelated sources', async () => {
  let requests = 0;
  const sources = await createSources({ test: true, fetcher: async url => { requests++; assert.equal(url, source.url); return response(url, '影片' + requests); } });
  await sources.save(source);
  assert.equal((await sources.search({ sourceId: source.id })).items[0].title, '影片1');
  assert.equal((await sources.search({ sourceId: source.id })).cache.hit, true);
  assert.equal(requests, 1);
  assert.equal((await sources.search({ sourceId: source.id, refresh: true })).items[0].title, '影片2');
  assert.equal(requests, 2);
});
test('editing a source invalidates late responses and uses the new address', async () => {
  let finishOld;
  const sources = await createSources({ test: true, fetcher: url => url === source.url ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(response(url, '新目录')) });
  await sources.save(source);
  const old = sources.search({ sourceId: source.id });
  await sources.save({ ...source, url: 'https://new.example/' });
  finishOld(response(source.url, '旧目录'));
  const discarded = await old;
  assert.equal(discarded.items.length, 0); assert.match(discarded.warnings[0], /失效/);
  assert.equal(sources.cacheInfo().pages, 0);
  assert.equal((await sources.search({ sourceId: source.id })).items[0].title, '新目录');
});
test('AGE search keeps titles matched through aliases and sends the requested page', async () => {
  const sources = await createSources({ test: true, fetcher: async url => {
    const u = new URL(url); assert.equal(u.hostname, 'www.agedm.io');
    assert.equal(u.searchParams.get('query'), '海贼王'); assert.equal(u.searchParams.get('page'), '2');
    return response(url, '航海王');
  } });
  const found = await sources.search({ sourceId: 'age', query: '海贼王', page: 2 });
  assert.equal(found.items[0].title, '航海王'); assert.deepEqual(found.warnings, []);
});
