import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createDownloads, downloadFilename, biliMediaHost } from '../server/downloads.js';
import { safeStream } from '../server/safe-fetch.js';

const bvid = 'BV1B7411m7LV';
const media = { bvid, title: '视频:测试/标题', cid: 1, duration: 60, rights: { download: 1 }, pages: [{ page: 1, cid: 1, duration: 60 }, { page: 2, cid: 2, duration: 60 }] };
const playback = { format: 'mp4', quality: 16, durl: [{ url: 'https://upos.example.bilivideo.com/video.mp4', size: 10, length: 60000 }] };
const fixture = (data = media, play = playback) => async url => {
  if (url.includes('/playurl')) { assert.match(url, /cid=\d/); return { body: Buffer.from(JSON.stringify({ code: 0, data: play })) }; }
  return { body: Buffer.from(JSON.stringify({ code: 0, data })) };
};
const streamed = (buffer, statusCode = 200, headers = {}) => Object.assign(Readable.from([buffer]), { statusCode, headers: { 'content-type': 'video/mp4', 'content-length': String(buffer.length), ...headers } });
test('download preparation honors rights, complete media, trusted CDN, and selected part', async () => {
  let cid; let probed = false;
  const service = createDownloads({ fetcher: async url => { if (url.includes('playurl')) cid = new URL(url).searchParams.get('cid'); return fixture()(url); }, streamer: async (_url, options) => { assert.equal(options.range, 'bytes=0-0'); probed = true; return streamed(Buffer.from('x'), 206); } });
  const plan = await service.prepare({ bvid, page: 2 });
  assert.equal(cid, '2'); assert.equal(probed, true); assert.equal(plan.quality, '360P'); assert.match(plan.downloads[0].filename, /-P2.mp4$/);
  assert.equal(plan.downloads[0].filename.includes('/'), false); assert.match(plan.downloads[0].url, /^\/api\/downloads\/[a-f0-9]{48}\/file$/);
  for (const data of [{ ...media, rights: { download: 0 } }, { ...media, rights: { download: 1, pay: 1 } }]) await assert.rejects(createDownloads({ fetcher: fixture(data) }).prepare({ bvid }), /未开放/);
  await assert.rejects(createDownloads({ fetcher: fixture(media, { ...playback, is_preview: true }) }).prepare({ bvid }), /没有提供/);
  await assert.rejects(createDownloads({ fetcher: fixture(media, { ...playback, durl: [{ ...playback.durl[0], length: 20000 }] }) }).prepare({ bvid }), /试看片段/);
  await assert.rejects(createDownloads({ fetcher: fixture(media, { ...playback, durl: [{ ...playback.durl[0], url: 'http://127.0.0.1/file' }] }) }).prepare({ bvid }), /本地|内网/);
  await assert.rejects(createDownloads({ fetcher: fixture() }).prepare({ bvid, page: 9 }), /分 P/);
});
test('downloads stream partial content with attachment name; bad ranges and expired tickets fail', async t => {
  let now = 1, upstreamRanges = [];
  const service = createDownloads({ now: () => now, fetcher: fixture(), streamer: async (_url, { range }) => {
    upstreamRanges.push(range);
    const bytes = Buffer.from('0123456789');
    const match = /^bytes=(\d+)-(\d*)$/.exec(range || '');
    if (!match) return streamed(bytes);
    const start = Number(match[1]), end = match[2] ? Number(match[2]) : bytes.length - 1;
    return streamed(bytes.subarray(start, end + 1), 206, { 'content-range': `bytes ${start}-${end}/10` });
  } });
  const app = express(); app.get('/api/downloads/:token/file', (req, res) => service.send(req, res));
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const root = `http://127.0.0.1:${server.address().port}`;
  const plan = await service.prepare({ bvid }); const url = root + plan.downloads[0].url;
  const response = await fetch(url, { headers: { Range: 'bytes=2-5' } });
  assert.equal(response.status, 206); assert.equal(await response.text(), '2345'); assert.match(response.headers.get('content-disposition'), /attachment;.*UTF-8/);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10'); assert.deepEqual(upstreamRanges, ['bytes=0-0', 'bytes=2-5']);
  assert.equal((await fetch(url, { headers: { Range: 'bytes=10-20' } })).status, 416);
  assert.equal((await fetch(url, { headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  now += 600001; assert.equal((await fetch(url)).status, 410);
});
test('streaming rejects local URLs and foreign CDNs before connecting; filenames are safe', async () => {
  await assert.rejects(safeStream('http://127.0.0.1/'), /本地|内网/);
  await assert.rejects(safeStream('https://example.com/', { allowHost: biliMediaHost }), /不属于/);
  assert.equal(biliMediaHost('bilivideo.com.evil.example'), false); assert.equal(biliMediaHost('upos.bilivideo.com'), true);
  assert.equal(downloadFilename('CON'), '_CON.mp4'); assert.equal(downloadFilename('..\\file\n"x'), '.._file__x.mp4');
});
