import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionReference, createCollections } from '../server/collections.js';
import { appendPlaylistItems, mergeImportedResources, transferPlaylistItem } from '../src/playlist-actions.ts';
const response = body => ({ body: Buffer.from(JSON.stringify(body)) });
const video = (id, title = '测试') => ({ type: 2, bvid: `BV${String(id).padStart(10, '0')}`, id, title, duration: 30, attr: 0 });

test('collection URLs accept favorites, hash playlists and multipart videos, rejecting foreign/private hosts', () => {
  assert.equal(collectionReference('https://www.bilibili.com/list/ml716471605').id, '716471605');
  assert.equal(collectionReference('https://space.bilibili.com/123/favlist?fid=716471605').type, 'bili-favorites');
  assert.equal(collectionReference('https://music.163.com/#/playlist?id=446097951').id, '446097951');
  assert.equal(collectionReference('https://www.bilibili.com/video/BV1B7411m7LV/').type, 'bili-parts');
  for (const url of ['https://music.163.com.evil.example/#/playlist?id=1', 'http://127.0.0.1/list/ml1', 'file:///a', 'https://user:secret@music.163.com/playlist?id=1']) assert.throws(() => collectionReference(url));
});
test('favorite collections page through native order and report inaccessible and unreturned items', async () => {
  const requests = [];
  const reader = createCollections({ fetcher: async url => {
    const page = Number(new URL(url).searchParams.get('pn')); requests.push(page);
    return response({ code: 0, data: { info: { title: '收藏夹', media_count: 4 }, medias: page === 1 ? [video(1), { ...video(2), title: '已失效视频' }] : [video(3)], has_more: page === 1 } });
  } });
  const first = await reader.start('https://www.bilibili.com/list/ml123'); assert.equal(first.nextCursor, 1); assert.equal(first.items.length, 2); assert.ok(first.items[1].unavailable);
  assert.equal(first.items[0].download.available, undefined);
  const last = await reader.page(first.session, 1); assert.equal(last.complete, true); assert.match(last.warnings.join(), /实际公开返回 3 项/);
  assert.deepEqual((await reader.page(first.session, 1)).items, last.items); assert.deepEqual(requests, [1, 2]);
  await assert.rejects(reader.page(first.session, 4), /按顺序/);
});
test('NetEase imports all trackIds in batches rather than the ten preview tracks, preserving source order', async () => {
  const ids = Array.from({ length: 117 }, (_, i) => i + 1), details = [];
  const song = id => ({ id, name: `歌${id}`, dt: 60000, ar: [{ name: '作者' }] });
  const reader = createCollections({ fetcher: async url => {
    if (url.includes('/playlist/detail')) return response({ code: 200, playlist: { name: '全部歌曲', trackCount: 117, tracks: ids.slice(0, 10).map(song), trackIds: ids.map(id => ({ id })) } });
    const requested = JSON.parse(new URL(url).searchParams.get('ids')); details.push(requested);
    return response({ code: 200, songs: requested.filter(id => id !== '55').reverse().map(song) });
  } });
  const first = await reader.start('https://music.163.com/#/playlist?id=123');
  const second = await reader.page(first.session, 1), third = await reader.page(first.session, 2);
  const all = [...first.items, ...second.items, ...third.items];
  assert.equal(all.length, 117); assert.equal(all[0].title, '歌1'); assert.equal(all[116].title, '歌117');
  assert.ok(all[54].unavailable); assert.equal(third.nextCursor, null); assert.equal(details.flat().length, 107); assert.ok(details.every(batch => batch.length <= 50));
});
test('failed collection batch can retry without dropping prior pages; private/expired sessions are explicit', async () => {
  let fail = true, clock = 0;
  const reader = createCollections({ now: () => clock, fetcher: async url => {
    if (new URL(url).searchParams.get('pn') === '2' && fail) { fail = false; throw new Error('网络中断'); }
    const first = new URL(url).searchParams.get('pn') === '1';
    return response({ code: 0, data: { info: { title: '片单', media_count: 2 }, medias: [video(first ? 1 : 2)], has_more: first } });
  } });
  const first = await reader.start('https://www.bilibili.com/list/ml1');
  await assert.rejects(reader.page(first.session, 1), /网络中断/); assert.equal((await reader.page(first.session, 1)).complete, true);
  clock = 31 * 60000; await assert.rejects(reader.page(first.session, 0), /过期/);
  await assert.rejects(createCollections({ fetcher: async () => response({ code: -403 }) }).start('https://www.bilibili.com/list/ml1'), /私密|登录/);
});
test('multipart collection imports independent identities with the correct page, so copies do not collide', async () => {
  const reader = createCollections({ fetcher: async () => response({ code: 0, data: { bvid: 'BV1B7411m7LV', title: '合集', pages: [{ page: 1, cid: 1, part: '一' }, { page: 2, cid: 2, part: '二' }] } }) });
  const result = await reader.start('https://www.bilibili.com/video/BV1B7411m7LV/');
  assert.equal(result.items.length, 2); assert.notEqual(result.items[0].id, result.items[1].id);
  assert.equal(result.items[1].download.page, 2); assert.equal(new URL(result.items[1].playbackUrl).searchParams.get('p'), '2');
});
test('copy/move is atomic, avoids duplicates and preserves ordering without touching unrelated lists', () => {
  const lists = [{ id: 'a', ids: ['x','y'] }, { id: 'b', ids: ['z','x'] }, { id: 'c', ids: [] }];
  assert.deepEqual(transferPlaylistItem(lists, 'a', 'b', 'x', false), lists);
  const moved = transferPlaylistItem(lists, 'a', 'b', 'x', true); assert.deepEqual(moved[0].ids, ['y']); assert.deepEqual(moved[1].ids, ['z','x']); assert.equal(moved[2], lists[2]);
  assert.equal(transferPlaylistItem(lists, 'a', 'missing', 'x', true), lists);
  assert.equal(transferPlaylistItem(lists, 'a', 'a', 'x', true), lists);
  assert.deepEqual(appendPlaylistItems(lists, 'a', [{ id:'x' },{ id:'z' },{ id:'z' }])[0].ids, ['x','y','z']);
  const rich = { id:'x', title:'已编辑', episodes:[1,2] };
  assert.equal(mergeImportedResources([rich], [{id:'x',title:'集合标题'},{id:'z'}])[0], rich);
});


test('playlist import accepts a bare BV, full video URL, mobile URL and shared link as the same single video', async () => {
  const bvid = 'BV1B7411m7LV';
  const fetcher = async url => url.includes('b23.tv') ? { url: `https://www.bilibili.com/video/${bvid}/` }
    : response({ code: 0, data: { bvid, title: '单个视频', pages: [{ page: 1, cid: 1 }], rights: { download: 1 } } });
  const reader = createCollections({ fetcher });
  for (const url of [bvid, `https://www.bilibili.com/video/${bvid}/`, `https://m.bilibili.com/video/${bvid}`, 'https://b23.tv/test']) {
    const result = await reader.start(url);
    assert.equal(result.items.length, 1); assert.equal(result.items[0].id, `bili-${bvid}`);
    assert.equal(result.items[0].download.available, true); assert.equal(result.source, '哔哩哔哩');
    assert.equal(result.total, 1); assert.equal(result.complete, true); assert.equal(result.nextCursor, null);
    assert.deepEqual(await reader.page(result.session, 0), result);
  }
});

test('an explicit Bilibili part imports only that part, with the same identity as the full collection', async () => {
  const bvid = 'BV1B7411m7LV';
  const reader = createCollections({ fetcher: async url => url.includes('b23.tv') ? { url: `https://www.bilibili.com/video/${bvid}/?p=2` }
    : response({ code: 0, data: { bvid, title: '分集', pages: [{ page: 1, cid: 1, part: '第一集' }, { page: 2, cid: 2, part: '第二集' }] } }) });
  const full = await reader.start(bvid), second = await reader.start(`https://www.bilibili.com/video/${bvid}/?p=2`);
  assert.equal(full.items.length, 2); assert.equal(second.items.length, 1); assert.equal(second.total, 1);
  assert.equal(second.items[0].id, full.items[1].id); assert.equal(second.items[0].defaultEpisode, 1);
  assert.equal(second.items[0].download.page, 2); assert.match(second.items[0].playbackUrl, /p=2/);
  const short = await reader.start('https://b23.tv/part'); assert.equal(short.items[0].id, second.items[0].id);
  await assert.rejects(reader.start(`https://www.bilibili.com/video/${bvid}/?p=3`), /没有指定的分 P/);
  await assert.rejects(reader.start(`https://www.bilibili.com/video/${bvid}/?p=0`), /有效的分 P/);
});

test('NetEase and QQ single songs use platform metadata and stable identities for deduplicated playlist insertion', async () => {
  const reader = createCollections({ fetcher: async url => url.includes('music.163.com')
    ? response({ code: 200, songs: [{ id: 186016, name: '单曲', artists: [{ name: '歌手' }], duration: 180000 }] })
    : response({ code: 0, song: { code: 0, data: { track_info: { id: 123, mid: '0039MnYb0qxYhV', name: '另一首歌', singer: [{ name: '作者' }], interval: 200 } } } }) });
  for (const url of ['https://music.163.com/#/song?id=186016', 'https://music.163.com/song?id=186016']) {
    const result = await reader.start(url);
    assert.equal(result.source, '网易云音乐'); assert.equal(result.items.length, 1); assert.equal(result.items[0].id, 'netease-186016');
    assert.equal(result.items[0].subtitle, '歌手'); assert.match(result.items[0].playbackUrl, /type=2&id=186016/);
  }
  for (const url of ['https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV', 'https://y.qq.com/n/ryqq/songDetail/123']) {
    const result = await reader.start(url);
    assert.equal(result.source, 'QQ音乐'); assert.equal(result.total, 1); assert.equal(result.items[0].id, 'qqmusic-0039MnYb0qxYhV');
    assert.equal(result.items[0].subtitle, '作者'); assert.match(result.items[0].playbackUrl, /songid=123/);
  }
});

test('individual audio/video links and YouTube fallback previews import through the same endpoint', async () => {
  const reader = createCollections({ fetcher: async () => { throw new Error('metadata offline'); } });
  const audio = await reader.start('https://cdn.example.com/Sunset.mp3'), video = await reader.start('https://cdn.example.com/film.mp4');
  assert.equal(audio.items[0].playbackType, 'audio'); assert.equal(audio.source, '媒体链接'); assert.equal(audio.title, 'Sunset.mp3');
  assert.equal(video.items[0].playbackType, 'video'); assert.equal(video.items[0].playbackUrl, 'https://cdn.example.com/film.mp4');
  const youtube = await reader.start('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(youtube.items[0].platform, 'YouTube'); assert.match(youtube.warnings[0], /元数据暂不可用/);
});

test('unified playlist import rejects invalid/private URLs before fetching and reports unavailable songs', async () => {
  let requests = 0;
  const reader = createCollections({ fetcher: async () => { requests++; return response({ code: 200, songs: [] }); } });
  for (const url of ['', 'not a link', 'BV123', 'file:///music.mp3', 'http://localhost/test.mp4', 'http://127.0.0.1/song', 'https://user:secret@music.163.com/song?id=1']) await assert.rejects(reader.start(url));
  assert.equal(requests, 0);
  await assert.rejects(reader.start('https://music.163.com/#/song?id=999999999999'), /没有找到这首歌/);
  assert.equal(requests, 1);
});
