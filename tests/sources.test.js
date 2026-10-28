import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, publicUrl } from '../server/safe-fetch.js';
import { catalogNextPage, parseHtmlCatalog, parseMacCMS, parsePage, validateSource } from '../server/sources.js';
import { localAdmin, publicOrigin } from '../server/network.js';

const source = { id: 'fixture', name: '测试来源', url: 'https://films.example/', type: 'html', kind: '动漫' };
test('website catalog reads real card links without treating scripts/ads as episodes', () => {
  const items = parseHtmlCatalog(`<a href="/detail/1" title="测试动画"><img data-src="/cover.jpg" /></a><a href="/detail/1"><img alt="重复卡片" src="/a.jpg" /></a><a href="https://ads.example/a"><img alt="广告" src="/b.jpg" /></a><a href="javascript:alert(1)"><img alt="注入脚本" src="/c.jpg" /></a>`, source, source.url);
  assert.equal(items.length, 1); assert.equal(items[0].title, '测试动画'); assert.equal(items[0].url, 'https://films.example/detail/1'); assert.equal(items[0].cover, 'https://films.example/cover.jpg');
  const media = parsePage(`<html><head><meta property="og:title" content="电影详情"><meta property="og:image" content="/poster.jpg"></head><body><video><source src="https://cdn.example/episode1.m3u8" /></video><a href="/episode2.mp4">第二集</a><script>malicious()</script></body></html>`, 'https://films.example/detail/1', source);
  assert.equal(media.playbackType, 'video'); assert.equal(media.episodes.length, 2); assert.equal(media.episodes[1].url, 'https://films.example/episode2.mp4'); assert.equal(media.title, '电影详情');
});
test('Chinese site lazy posters, section categories and pagination are read without loading page scripts', () => {
  const html = `<div class="stui-pannel"><h3>最新电视剧</h3><li><a href="/plus/view.php?aid=1" title="一部剧集" data-original="/poster.jpg"></a><div class="stui-vodlist__detail"><p>第一季介绍</p></div></li></div><a href="/movie/2" title="第二部电影" style="background: url('/second.jpg')"></a><a href="/" title="网站 logo"><img src="/logo.png"></a><div class="pagination"><a href="https://evil.example/">下一页</a><a href="/list?page=2">下一页</a></div>`;
  const items = parseHtmlCatalog(html, source, source.url);
  assert.equal(items.length, 2); assert.equal(items[0].kind, '电视剧'); assert.equal(items[0].description, '第一季介绍'); assert.equal(items[1].cover, 'https://films.example/second.jpg');
  assert.equal(catalogNextPage(html, source.url), 'https://films.example/list?page=2');
  assert.equal(catalogNextPage('<a rel="next" href="javascript:evil()">下一页</a>', source.url), '');
  assert.equal(parsePage(Buffer.from('<html><h1>中文影片标题</h1><meta name="description" content="{dede:field.description}"></html>'), source.url, source).title, '中文影片标题');
});
test('JSON catalog parses episode groups and ignores executable/non-direct player strings', () => {
  const [m] = parseMacCMS({ list: [{ vod_id: 12, vod_name: '剧集', vod_content: '<p>真实剧情</p>', vod_play_url: '第一集$https://cdn.example/a.m3u8#第二集$https://cdn.example/b.mp4$$$恶意$javascript:evil()#网站$https://site.example/embed', type_name: '电视剧' }] }, source);
  assert.equal(m.episodes.length, 2); assert.equal(m.kind, '电视剧'); assert.equal(m.description, '真实剧情'); assert.equal(m.playbackUrl, 'https://cdn.example/a.m3u8'); assert.equal(m.cover, ''); assert.equal(m.url, source.url);
  const [empty] = parseMacCMS({ list: [{ vod_id: 13, vod_name: '只有目录' }] }, source); assert.equal(empty.playbackType, 'external'); assert.equal(empty.episodes.length, 0);
});
test('AGE sibling posters stay within each card; HTTPS links and search pagination are preserved', () => {
  const html = `<div class="video_item"><div class="video_item--image"><img src="/placeholder.png" data-original="/first.jpg"><span class="video_item--info">第3集</span></div><div class="video_item-title"><a href="http://films.example/detail/1">第一部动漫</a></div></div><div class="video_item"><div class="video_item--image"><img data-original="/second.jpg"></div><div class="video_item-title"><a href="/detail/2">第二部动漫</a></div></div><a href="/login">登录</a><ul class="pagination"><li><a href="http://films.example/search?query=动漫&page=2">下一页</a></li></ul>`;
  const items = parseHtmlCatalog(html, source, source.url);
  assert.equal(items.length, 2); assert.equal(items[0].title, '第一部动漫');
  assert.equal(items[0].cover, 'https://films.example/first.jpg'); assert.equal(items[1].cover, 'https://films.example/second.jpg');
  assert.equal(items[0].duration, '第3集'); assert.equal(items[0].url, 'https://films.example/detail/1');
  assert.equal(new URL(catalogNextPage(html, source.url)).searchParams.get('page'), '2');
});
test('remote metadata requests and custom sources reject internal addressing', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '::1', '::ffff:127.0.0.1', 'fc00::1', '0.0.0.0']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('1.1.1.1'), true);
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1/a', 'http://[::1]/a', 'https://user:password@example.com', 'http://192.168.0.1/', 'http://localhost/', 'http://server.local/']) assert.throws(() => publicUrl(url));
  assert.throws(() => validateSource({ ...source, searchUrl: 'https://other.example/?q={query}' }));
  assert.throws(() => validateSource({ ...source, searchUrl: 'https://films.example/search' }));
  assert.equal(validateSource({ ...source, searchUrl: 'https://films.example/search?q={query}&page={page}' }).enabled, true);
});
test('public invitation requires HTTPS; local admin cannot be impersonated through tunnel headers', () => {
  for (const url of ['http://example.com', 'http://localhost:3000', 'https://127.0.0.1', 'https://example.com/path']) assert.throws(() => publicOrigin(url));
  assert.equal(publicOrigin('https://coplay.example.com/'), 'https://coplay.example.com');
  assert.equal(localAdmin({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:3000' } }), true);
  assert.equal(localAdmin({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'public.example' } }), false);
  assert.equal(localAdmin({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:3000', 'cf-connecting-ip': '1.2.3.4' } }), false);
  assert.equal(localAdmin({ socket: { remoteAddress: '192.168.1.2' }, headers: { host: 'localhost:3000' } }), false);
});
