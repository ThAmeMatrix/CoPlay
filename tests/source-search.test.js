import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readStaticAssignment } from '../server/static-data.js';
import { platformCatalog, parseBiliSearch } from '../server/platforms.js';
import { createSources, defaultSources } from '../server/sources.js';
import { createCatalogCache } from '../server/catalog-cache.js';
import { createBrowserCatalogCache } from '../src/catalog-client.ts';

const json = data => ({ body: Buffer.from(JSON.stringify(data)) });
const track = (id, name, extra = {}) => ({ id, name, duration: 60000, artists: [{ name: '冷门歌手' }], album: { name: '首张专辑', picUrl: 'https://art.example/cover.jpg' }, ...extra });
const video = { type: 'video', bvid: 'BV1B7411m7LV', title: '<em class="keyword">命中作品</em> &amp; 合集', author: '作者名', pic: '//i0.hdslb.com/test.jpg', duration: '5:12', play: 8 };
const biliPage = (page, results, total = 80, pages = 2) => `<script>window.__pinia=(function(a,b){return {searchTypeResponse:{searchTypeResponse:{page:a,numResults:${total},numPages:${pages},result:b}}}})(${page},${JSON.stringify(results)});</script>`;

test('Bilibili searches its result page and keeps native order, counts and pagination', async () => {
  const requests = [];
  const result = await platformCatalog({ id: 'bilibili', type: 'bilibili' }, '作者名 & 合集', 2, async url => {
    requests.push(url); const u = new URL(url);
    assert.equal(u.hostname, 'search.bilibili.com'); assert.equal(u.searchParams.get('keyword'), '作者名 & 合集'); assert.equal(u.searchParams.get('page'), '2');
    return { body: Buffer.from(biliPage(2, [{ type: 'video_ad', bvid: video.bvid, title: '广告' }, video])) };
  });
  assert.equal(requests.length, 1); assert.equal(result.items.length, 1); assert.equal(result.items[0].title, '命中作品 & 合集');
  assert.equal(result.items[0].cover, 'https://i0.hdslb.com/test.jpg'); assert.equal(result.items[0].duration, '5:12');
  assert.equal(result.total, 80); assert.equal(result.hasMore, false);
  assert.equal(parseBiliSearch(Buffer.from(biliPage(1, [video])), 1).hasMore, true);
  assert.throws(() => parseBiliSearch(Buffer.from(biliPage(1, [video])), 2), /页码/);
  assert.throws(() => parseBiliSearch(Buffer.from('<html>请完成验证</html>'), 1), /验证/);
  assert.deepEqual(parseBiliSearch(Buffer.from(biliPage(1, [], 0, 0)), 1).items, []);
});

test('SSR data decoding never executes scripts, getters, parameter calls or prototype setters', () => {
  globalThis.searchDecoderExecuted = false;
  const scripts = [
    'window.__pinia=(function(){globalThis.searchDecoderExecuted=true;return {}})()',
    'window.__pinia=(function(a){return {result:a}})((globalThis.searchDecoderExecuted=true))',
    'window.__pinia={get result(){globalThis.searchDecoderExecuted=true;return []}}',
    'window.__pinia={result:Function("globalThis.searchDecoderExecuted=true")()}',
    'window.__pinia={result:process.env}',
    'window.__pinia={ ["dynamic"]: 1 }',
  ];
  for (const script of scripts) assert.throws(() => readStaticAssignment(script, '__pinia'));
  const value = readStaticAssignment('window.__pinia={"__proto__":{polluted:true},value:[-2,void 0,!0]}', '__pinia');
  assert.equal(Object.getPrototypeOf(value), null); assert.equal({}.polluted, undefined);
  assert.deepEqual(value.value, [-2, undefined, true]); assert.equal(globalThis.searchDecoderExecuted, false);
  delete globalThis.searchDecoderExecuted;
});

test('NetEase queries the source with offset and preserves matches outside the popular chart', async () => {
  const result = await platformCatalog({ id: 'netease', type: 'netease' }, '冷门歌手', 2, async url => {
    const u = new URL(url); assert.equal(u.pathname, '/api/search/get');
    assert.equal(u.searchParams.get('s'), '冷门歌手'); assert.equal(u.searchParams.get('offset'), '24'); assert.equal(u.searchParams.get('limit'), '24');
    return json({ code: 200, result: { songCount: 80, hasMore: true, songs: [track(11, '不含搜索词的作品')] } });
  });
  assert.equal(result.items[0].title, '不含搜索词的作品'); assert.equal(result.total, 80); assert.equal(result.hasMore, true);
});

test('NetEase artwork is batched without replacing the source ranking; artwork failure keeps results', async () => {
  let calls = 0;
  const search = { code: 200, result: { songCount: 2, hasMore: false, songs: [track(11, '第一首', { album: {} }), track(12, '第二首', { album: {} })] } };
  const fetcher = async url => {
    calls++;
    if (url.includes('/search/')) return json(search);
    assert.deepEqual(JSON.parse(new URL(url).searchParams.get('ids')), [11, 12]);
    return json({ code: 200, songs: [track(12, '第二首'), track(11, '第一首')] });
  };
  const found = await platformCatalog({ id: 'netease', type: 'netease' }, '冷门歌手', 1, fetcher);
  assert.equal(calls, 2); assert.deepEqual(found.items.map(s => s.id), ['netease-11', 'netease-12']); assert.ok(found.items.every(s => s.cover));
  const fallback = await platformCatalog({ id: 'netease', type: 'netease' }, '冷门歌手', 1, async url => { if (url.includes('/search/')) return json(search); throw new Error('art offline'); });
  assert.equal(fallback.items.length, 2); assert.equal(fallback.items[0].title, '第一首');
});

test('QQ Music sends the keyword and page to native search, with no chart fallback', async () => {
  let calls = 0;
  const result = await platformCatalog({ id: 'qqmusic', type: 'qqmusic' }, '冷门歌手', 3, async url => {
    calls++; const req = JSON.parse(new URL(url).searchParams.get('data')).req;
    assert.equal(req.module, 'music.search.SearchCgiService'); assert.equal(req.param.query, '冷门歌手'); assert.equal(req.param.page_num, 3); assert.equal(req.param.num_per_page, 24);
    return json({ code: 0, req: { code: 0, data: { meta: { sum: 49, curpage: 3 }, body: { song: { list: [{ id: 9, mid: '0039MnYb0qxYhV', name: '独立单曲', singer: [{ name: '冷门歌手' }], interval: 120 }] } } } } });
  });
  assert.equal(calls, 1); assert.equal(result.items[0].title, '独立单曲'); assert.equal(result.hasMore, false); assert.equal(result.total, 49);
  calls = 0;
  await assert.rejects(platformCatalog({ id: 'qqmusic', type: 'qqmusic' }, '冷门歌手', 1, async () => { calls++; return json({ code: 0, req: { code: 2001 } }); }), /搜索/);
  assert.equal(calls, 1);
});

test('empty native results stay empty and do not fetch a popular catalog', async () => {
  let calls = 0;
  const result = await platformCatalog({ id: 'netease', type: 'netease' }, '无匹配词', 1, async url => {
    calls++; assert.match(url, /\/api\/search\/get/); return json({ code: 200, result: { songCount: 0 } });
  });
  assert.equal(result.items.length, 0); assert.equal(result.hasMore, false); assert.equal(calls, 1);
});

test('website searches preserve aliases; missing search configuration does not search a home page', async () => {
  const source = { id: 'fixture', name: '测试站点', type: 'html', kind: '动漫', url: 'https://films.example/', searchUrl: 'https://films.example/search?q={query}&page={page}' };
  const requests = [];
  const sources = await createSources({ test: true, fetcher: async url => { requests.push(url); const u = new URL(url); assert.equal(u.searchParams.get('q'), '海贼王'); assert.equal(u.searchParams.get('page'), '2'); return { url, body: Buffer.from('<a href="/detail/1"><img alt="航海王" src="/poster.jpg"></a>') }; } });
  await sources.save(source);
  const result = await sources.search({ sourceId: 'fixture', query: '海贼王', page: 2 });
  assert.equal(result.items[0].title, '航海王');
  await sources.save({ ...source, searchUrl: '' });
  const missing = await sources.search({ sourceId: 'fixture', query: '海贼王' });
  assert.equal(missing.items.length, 0); assert.match(missing.warnings[0], /尚未配置搜索/); assert.equal(requests.length, 1);
});

test('Renren search is scoped to result cards including titles with missing posters', async () => {
  const sources = await createSources({ test: true, fetcher: async url => ({ url, body: Buffer.from('<ul id="movielist"><li><a href="/movie/1"><img alt="别名匹配影片" src="/poster.jpg"></a></li><li><h2><a title="没有封面的搜索结果" href="/movie/2">没有封面的搜索结果</a></h2></li></ul><aside><a href="/movie/3"><img alt="热门推荐" src="/hot.jpg"></a></aside>') }) });
  const result = await sources.search({ sourceId: 'renren', query: '原始片名' });
  assert.deepEqual(result.items.map(m => m.title), ['别名匹配影片', '没有封面的搜索结果']); assert.equal(result.items[1].cover, '');
});

test('Apple uses remote keyword search and returns only movies, with bounded pagination', async () => {
  const sources = await createSources({ test: true, fetcher: async url => {
    const u = new URL(url); assert.equal(u.pathname, '/search'); assert.equal(u.searchParams.get('term'), 'Interstellar');
    return json({ resultCount: 27, results: [{ kind: 'song', trackId: 1, trackName: '歌曲' }, ...Array.from({ length: 26 }, (_, i) => ({ kind: 'feature-movie', trackId: i + 2, trackName: `影片 ${i}`, trackViewUrl: 'https://itunes.apple.com/movie/' + i }))] });
  } });
  const result = await sources.search({ sourceId: 'apple-movies', query: 'Interstellar', page: 2 });
  assert.equal(result.items.length, 2); assert.equal(result.total, 26); assert.equal(result.hasMore, false); assert.equal(result.items[0].title, '影片 24');
});

test('old browser search caches are ignored while home catalogs remain reusable', () => {
  const source = { ...defaultSources.find(s => s.id === 'age'), status: { state: 'ok', message: '' } };
  const result = { items: [{ id: 'old', title: '旧内容', tags: [] }], warnings: [], page: 1, hasMore: false };
  const key = q => JSON.stringify([source.id, source.type, source.url, source.searchUrl || '', source.name, source.kind, q, 1]);
  let stored = JSON.stringify({ version: 1, sources: [source], pages: ['', '海贼王'].map(query => ({ key: key(query), sourceId: source.id, result, updatedAt: Date.now() })) });
  const cache = createBrowserCatalogCache({ getItem: () => stored, setItem: (_k, value) => { stored = value; }, removeItem: () => {} });
  assert.equal(cache.get(source, '海贼王', 1), undefined); assert.equal(cache.get(source, '', 1).result.items[0].id, 'old');
  cache.set(source, '海贼王', 1, { ...result, items: [{ id: 'new', title: '源站结果', tags: [] }] });
  assert.equal(cache.get(source, '海贼王', 1).result.items[0].id, 'new');
});

test('disk caches from the former local filter cannot mask native search results after upgrade', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'coplay-search-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const source = defaultSources.find(s => s.id === 'apple-movies');
  const hash = createHash('sha256').update(JSON.stringify([source.type, source.url, source.searchUrl, source.name, source.kind])).digest('hex').slice(0, 16);
  const cache = await createCatalogCache({ dataDir });
  cache.set(`${source.id}:${hash}:Interstellar:1`, { items: [], hasMore: false, fetchedAt: Date.now() }); await cache.flush();
  let requests = 0;
  const sources = await createSources({ dataDir, fetcher: async () => { requests++; return json({ resultCount: 1, results: [{ kind: 'feature-movie', trackId: 7, trackName: '星际穿越' }] }); } });
  const result = await sources.search({ sourceId: source.id, query: 'Interstellar' });
  assert.equal(requests, 1); assert.equal(result.items[0].title, '星际穿越'); assert.equal(result.cache.hit, false);
  await sources.flush();
});
