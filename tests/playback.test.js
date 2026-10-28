import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createPlayback, playbackRange } from '../server/playback.js';
import { bilibiliPlaybackTarget, bilibiliEmbedUrl } from '../src/bilibili-player.ts';

const bvid = 'BV1B7411m7LV';
const media = { bvid, title: '可观看但不开放下载的视频', cid: 11, duration: 60, rights: { download: 0 }, pages: [{ page: 1, cid: 11, duration: 60 }, { page: 2, cid: 22, duration: 60 }] };
const play = { format: 'mp4', quality: 16, durl: [{ url: 'https://upos.example.bilivideo.com/video.mp4', size: 10, length: 60000 }] };
const reply = (data, code = 0) => ({ body: Buffer.from(JSON.stringify({ code, data })) });
const fixture = (info = media, playback = play) => async url => reply(url.includes('/playurl?') ? playback : info);
const bytes = Buffer.from('0123456789');
const stream = (body, statusCode = 200, headers = {}) => Object.assign(Readable.from([body]), { statusCode, headers: { 'content-type': 'video/mp4', 'content-length': String(body.length), ...headers } });
const streamer = async (_url, { range }) => {
  if (!range) return stream(bytes);
  const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range);
  return stream(bytes.subarray(Number(start), Number(end) + 1), 206, { 'content-range': `bytes ${start}-${end}/10` });
};
async function serve(t, service) {
  const app = express(); app.get('/api/playback/:token/video', (req, res) => service.send(req, res));
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('public playback resolves the selected part and does not require download permission', async () => {
  let cid; let probe;
  const service = createPlayback({ fetcher: async url => { if (url.includes('/playurl?')) cid = new URL(url).searchParams.get('cid'); return fixture()(url); }, streamer: async (url, options) => { probe = options; return streamer(url, options); } });
  const plan = await service.prepare({ bvid, page: 2 });
  assert.equal(cid, '22'); assert.equal(plan.page, 2); assert.equal(plan.duration, 60); assert.equal(plan.quality, '360P');
  assert.match(plan.url, /^\/api\/playback\/[a-f0-9]{48}\/video$/);
  assert.equal(probe.range, 'bytes=0-0'); assert.equal(probe.referer, 'https://www.bilibili.com/');
  assert.equal(probe.allowHost('evil.example'), false);
  await assert.rejects(service.prepare({ bvid, page: 3 }), /分 P/);
  await assert.rejects(service.prepare({ bvid: 'https://127.0.0.1/video' }), /BV/);
});

test('playback rejects paid, restricted, preview, DRM and unsupported media instead of bypassing the platform', async () => {
  for (const info of [{ ...media, state: -4 }, ...['pay', 'ugc_pay', 'arc_pay'].map(key => ({ ...media, rights: { [key]: 1 } }))]) {
    await assert.rejects(createPlayback({ fetcher: fixture(info), streamer }).prepare({ bvid }), /播放权限/);
  }
  for (const variant of [{ ...play, is_preview: true }, { ...play, is_drm: true }, { ...play, format: 'dash', durl: undefined }, { ...play, durl: [...play.durl, ...play.durl] }]) {
    await assert.rejects(createPlayback({ fetcher: fixture(media, variant), streamer }).prepare({ bvid }), /公开 MP4/);
  }
  await assert.rejects(createPlayback({ fetcher: fixture(media, { ...play, durl: [{ ...play.durl[0], length: 20000 }] }), streamer }).prepare({ bvid }), /试看片段/);
  for (const url of ['http://127.0.0.1/video.mp4', 'https://bilivideo.com.evil.example/video.mp4']) {
    await assert.rejects(createPlayback({ fetcher: fixture(media, { ...play, durl: [{ ...play.durl[0], url }] }), streamer }).prepare({ bvid }), /内网|媒体地址/);
  }
  await assert.rejects(createPlayback({ fetcher: fixture(), streamer: async () => stream(Buffer.from('denied'), 200, { 'content-type': 'text/html' }) }).prepare({ bvid }), /视频数据/);
});

test('playback supports inline streaming, suffix and seek ranges without an attachment download', async t => {
  const calls = [];
  const service = createPlayback({ fetcher: fixture(), streamer: async (url, options) => { calls.push(options.range); return streamer(url, options); } });
  const base = await serve(t, service); const plan = await service.prepare({ bvid });
  const url = base + plan.url;
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '10'); assert.equal(calls.length, 1);
  for (const [range, expected, contentRange] of [['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=6-', '6789', 'bytes 6-9/10'], ['bytes=0-999', '0123456789', 'bytes 0-9/10']]) {
    const response = await fetch(url, { headers: { Range: range } });
    assert.equal(response.status, 206); assert.equal(await response.text(), expected);
    assert.equal(response.headers.get('content-range'), contentRange); assert.equal(response.headers.get('content-disposition'), 'inline');
    assert.equal(response.headers.get('content-type'), 'video/mp4'); assert.equal(response.headers.get('accept-ranges'), 'bytes');
  }
  const full = await fetch(url); assert.equal(full.status, 200); assert.equal(await full.text(), bytes.toString());
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,4-5']) assert.equal((await fetch(url, { headers: { Range: range } })).status, 416);
  assert.equal(playbackRange('bytes=9007199254740993-', 10), null);
  assert.equal((await fetch(url, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

test('expired tickets, cancellation and inconsistent upstream ranges fail explicitly', async t => {
  let now = 1; let bad = false;
  const service = createPlayback({ now: () => now, fetcher: fixture(), streamer: async (url, options) => bad ? stream(bytes, 200) : streamer(url, options) });
  const base = await serve(t, service); const plan = await service.prepare({ bvid });
  bad = true;
  const invalid = await fetch(base + plan.url, { headers: { Range: 'bytes=3-5' } });
  assert.equal(invalid.status, 502); assert.match((await invalid.json()).error, /视频片段/);
  now += 2 * 60 * 60 * 1000;
  assert.equal((await fetch(base + plan.url)).status, 410);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(service.prepare({ bvid }, abort.signal), /取消/);
  const pending = new AbortController();
  await assert.rejects(createPlayback({ fetcher: async url => { pending.abort(); return fixture()(url); }, streamer }).prepare({ bvid }, pending.signal), /取消/);
});

test('cached Bilibili links retain selected parts and official fallback honors autoplay', () => {
  const saved = `https://player.bilibili.com/player.html?bvid=${bvid}&p=2&autoplay=0&danmaku=1`;
  const target = bilibiliPlaybackTarget(saved);
  assert.equal(target.page, 2); assert.equal(target.bvid, bvid); assert.equal(new URL(target.source).searchParams.get('p'), '2');
  assert.equal(new URL(bilibiliEmbedUrl(saved, true)).searchParams.get('autoplay'), '1');
  assert.equal(new URL(bilibiliEmbedUrl(saved, false)).searchParams.get('autoplay'), '0');
  assert.equal(bilibiliPlaybackTarget(`https://player.bilibili.com/player.html?bvid=${bvid}&page=3`).page, 3);
  assert.equal(bilibiliPlaybackTarget('https://player.bilibili.com/player.html?episodeId=12').source, 'https://www.bilibili.com/bangumi/play/ep12');
  assert.equal(bilibiliPlaybackTarget('https://player.bilibili.com/player.html?seasonId=4').bvid, '');
  for (const value of [undefined, 'https://player.bilibili.com.evil.example/player.html', 'https://user@player.bilibili.com/player.html', 'https://www.youtube.com/embed/x']) assert.equal(bilibiliPlaybackTarget(value), null);
});
