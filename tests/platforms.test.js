import test from 'node:test';
import assert from 'node:assert/strict';
import { biliMedia, importPlatform, platformCatalog, platformReference, resolveReference } from '../server/platforms.js';

const bvid = 'BV1B7411m7LV';
const song = { id: 186016, name: '晴天', duration: 269000, artists: [{ name: '周杰伦' }], album: { name: '叶惠美', picUrl: 'https://example.com/cover.jpg' } };
const reply = data => ({ body: Buffer.from(JSON.stringify(data)) });
test('BV, share links, multipart URLs and music link variants identify the correct platform', async () => {
  assert.equal(platformReference(bvid).bvid, bvid);
  assert.equal(platformReference(`https://www.bilibili.com/video/${bvid}/?p=2&share_source=copy`).page, 2);
  for (const url of ['https://music.163.com/#/song?id=186016', 'https://music.163.com/song?id=186016', 'https://music.163.com/m/song?id=186016']) assert.equal(platformReference(url).id, '186016');
  assert.equal(platformReference('https://music.163.com/#/playlist?id=123').playlist, true);
  for (const url of ['https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV', 'https://y.qq.com/n/yqq/song/0039MnYb0qxYhV.html', 'https://i.y.qq.com/v8/playsong.html?songmid=0039MnYb0qxYhV']) assert.equal(platformReference(url).key, '0039MnYb0qxYhV');
  const ref = await resolveReference('https://b23.tv/abc', async () => ({ url: `https://www.bilibili.com/video/${bvid}/?p=2` }));
  assert.equal(ref.bvid, bvid); assert.equal(ref.page, 2);
  await assert.rejects(resolveReference('https://b23.tv/abc', async () => ({ url: 'https://evil.example/video' })), /未跳转/);
  for (const url of ['http://127.0.0.1/a', 'https://user:secret@www.bilibili.com/', 'file:///a']) assert.throws(() => platformReference(url));
  assert.equal(platformReference(`https://bilibili.com.evil.example/video/${bvid}`).platform, '');
});
test('multipart video uses the requested part for both playback and download', () => {
  const data = { bvid, title: '演奏合集', pages: [{ cid: 11, page: 1, part: '第一首' }, { cid: 22, page: 2, part: '第二首' }], rights: { download: 1 }, stat: { danmaku: 17 } };
  const media = biliMedia(data, 2);
  assert.equal(media.defaultEpisode, 1); assert.equal(media.download.page, 2);
  assert.equal(media.episodes[1].page, 2); assert.equal(new URL(media.playbackUrl).searchParams.get('p'), '2');
  assert.equal(media.stats.danmaku, 17); assert.equal(media.download.available, true);
  assert.equal(biliMedia({ ...data, rights: { download: 1, pay: 1 } }).download.available, false);
  assert.throws(() => biliMedia(data, 3), /没有指定的分 P/);
});
test('music imports retain actual titles, singers, art and selectable playlist tracks', async () => {
  const single = await importPlatform(platformReference('https://music.163.com/song?id=186016'), async () => reply({ code: 200, songs: [song] }));
  assert.equal(single.resource.title, '晴天'); assert.equal(single.resource.subtitle, '周杰伦'); assert.equal(single.resource.duration, '4:29');
  const playlist = await importPlatform(platformReference('https://music.163.com/playlist?id=123'), async () => reply({ code: 200, result: { name: '我的歌单', tracks: [song], trackCount: 1 } }));
  assert.equal(playlist.resource.episodes.length, 1); assert.match(playlist.resource.episodes[0].url, /id=186016/);
  const qq = await importPlatform(platformReference('https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV'), async url => {
    const param = JSON.parse(new URL(url).searchParams.get('data')).song.param;
    assert.equal(param.song_mid, '0039MnYb0qxYhV');
    return reply({ code: 0, song: { code: 0, data: { track_info: { id: 97773, mid: param.song_mid, name: '晴天', interval: 269, singer: [{ name: '周杰伦' }], album: { mid: 'album', name: '叶惠美' } } } } });
  });
  assert.equal(qq.resource.platform, 'QQ音乐'); assert.match(qq.resource.playbackUrl, /songid=97773/);
  assert.equal(new URL(qq.resource.playbackUrl).pathname, '/n2/m/outchain/player/index.html');
  await assert.rejects(importPlatform(platformReference(bvid), async () => reply({ code: -404, message: '视频不存在' })), /视频不存在/);
});
test('Bilibili episode redirects use the official episode player and canonical episode link', () => {
  const data = { bvid, title: '番剧测试', redirect_url: 'https://www.bilibili.com/bangumi/play/ep12345', rights: { pay: 1 } };
  const media = biliMedia(data);
  assert.equal(media.url, 'https://www.bilibili.com/bangumi/play/ep12345');
  assert.equal(new URL(media.playbackUrl).searchParams.get('episodeId'), '12345');
  assert.equal(new URL(media.playbackUrl).searchParams.has('bvid'), false);
  assert.equal(media.download.available, false);
  for (const redirect_url of ['https://www.bilibili.com.evil.example/bangumi/play/ep12345', 'https://user@www.bilibili.com/bangumi/play/ep12345', 'javascript:alert(1)']) {
    assert.match(biliMedia({ ...data, redirect_url }).playbackUrl, /bvid=/);
  }
});
test('music browse catalogs paginate without duplicate pages', async () => {
  const tracks = Array.from({ length: 50 }, (_, i) => ({ ...song, id: i + 1, name: `歌曲${i}` }));
  const source = { id: 'netease', type: 'netease' };
  const fetcher = async () => reply({ code: 200, result: { tracks } });
  const first = await platformCatalog(source, '', 1, fetcher), second = await platformCatalog(source, '', 2, fetcher);
  assert.equal(first.items.length, 24); assert.equal(second.items.length, 24); assert.equal(second.items[0].id, 'netease-25');
  assert.equal((await platformCatalog(source, '', 3, fetcher)).hasMore, false);
});
