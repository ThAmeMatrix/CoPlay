import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApplication } from '../server/app.js';
import { parseLrc, createLyrics } from '../server/lyrics.js';
import { activeLineIndex } from '../src/lyrics-core.ts';
import { createDownloads } from '../server/downloads.js';
import { Readable } from 'node:stream';

const LRC = `[ti:测试歌曲]
[ar:测试歌手]
[00:03.50]第一句
[00:08.00]第二句
[00:08.00][00:12.25]重复的一句
[00:20.00]最后一句`;
const TRANSLATION = '[00:03.50]First line\n[00:08.00]Second line\n[00:20.00]Last line';

test('LRC parser sorts timestamps, expands repeated tags and merges translations', () => {
  const lines = parseLrc(LRC, TRANSLATION);
  assert.equal(lines.length, 5);
  assert.equal(lines[0].time, 3.5);
  assert.equal(lines[0].text, '第一句');
  assert.equal(lines[0].translation, 'First line');
  assert.equal(lines[1].text, '第二句');
  assert.equal(lines[2].text, '重复的一句');
  assert.equal(lines[3].time, 12.25);
  assert.equal(lines[4].time, 20);
  assert.equal(lines[4].translation, 'Last line');
  assert.equal(parseLrc('[offset:500][00:20.00]x')[0].time, 20.5, 'offset shifts the whole sheet');
  assert.equal(parseLrc('纯文本没有时间标签').length, 0);
  assert.equal(parseLrc('[99:99]越界').length, 0);
  assert.equal(parseLrc('', '[00:01.00]只有翻译').length, 0);
});

test('activeLineIndex picks the last line at or before the playhead', () => {
  const lines = [{ time: 0, text: 'a' }, { time: 3.5, text: 'b' }, { time: 8, text: 'c' }];
  assert.equal(activeLineIndex(lines, -1), -1);
  assert.equal(activeLineIndex(lines, 0), 0);
  assert.equal(activeLineIndex(lines, 3.49), 0);
  assert.equal(activeLineIndex(lines, 3.5), 1);
  assert.equal(activeLineIndex(lines, 100), 2);
  assert.equal(activeLineIndex([], 5), -1);
  assert.equal(activeLineIndex(lines, NaN), -1);
});

test('lyrics resolver only calls allowlisted platform endpoints and degrades gracefully', async () => {
  const urls = [];
  const fetcher = async url => {
    urls.push(url);
    return { body: Buffer.from(JSON.stringify({ lrc: { lyric: LRC }, tlyric: { lyric: TRANSLATION } })) };
  };
  const service = createLyrics({ fetcher });
  const netease = await service.resolve({ key: 'n1', media: { id: 'netease-123456', url: 'https://music.163.com/song?id=123456' } });
  assert.equal(netease.source, '网易云音乐');
  assert.equal(netease.lines.length, 5);
  assert.match(urls[0], /^https:\/\/music\.163\.com\/api\/song\/lyric\?id=123456/);
  assert.equal((await service.resolve({ key: 'n1', media: { id: 'netease-123456' } })).lines.length, 5);
  assert.equal(urls.length, 1, 'results are cached per media key');

  const unknown = await service.resolve({ key: 'x', media: { id: 'local-file', url: '', playbackUrl: '' } });
  assert.deepEqual(unknown.lines, []);
  assert.match(unknown.reason, /没有可用歌词/);
  assert.equal(urls.length, 1, 'unknown media never triggers a network request');

  const evil = await service.resolve({ key: 'y', media: { id: 'netease-1', url: 'http://127.0.0.1/secret' } });
  assert.match(urls.at(-1), /^https:\/\/music\.163\.com\//, 'id still comes from the allowlisted media id');
  assert.equal(evil.lines.length, 5);

  const direct = await service.resolve({ key: 'd', lrc: LRC });
  assert.equal(direct.source, '内嵌歌词');
  assert.equal(direct.lines.length, 5);
  assert.equal(direct.lines[0].translation, undefined, 'no translation when omitted');
});

test('QQ music lyrics endpoint is allowlisted and failures are reported as no lyrics', async () => {
  const urls = [];
  const service = createLyrics({ fetcher: async url => { urls.push(url); return { body: Buffer.from(JSON.stringify({ lyric: '[00:01.00]你好', trans: '[00:01.00]Hello' })) }; } });
  const result = await service.resolve({ media: { id: 'qqmusic-002AbCdEfGhIjK', url: 'https://y.qq.com/n/ryqq/songDetail/002AbCdEfGhIjK' } });
  assert.equal(result.source, 'QQ音乐');
  assert.equal(result.lines[0].translation, 'Hello');
  assert.match(urls[0], /^https:\/\/c\.y\.qq\.com\/lyric\//);
  const failing = createLyrics({ fetcher: async () => { throw new Error('上游不可用'); } });
  const missing = await failing.resolve({ media: { id: 'netease-999' } });
  assert.deepEqual(missing.lines, []);
  assert.match(missing.reason, /上游不可用/);
});

test('batch download preparation validates items and keeps long-lived tickets', async () => {
  const { app, httpServer } = await createApplication({ test: true });
  httpServer.listen(0, '127.0.0.1'); await once(httpServer, 'listening');
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  const post = body => fetch(base + '/api/downloads/prepare-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json() }));
  try {
    assert.equal((await post({ items: [] })).status, 400);
    // The selection itself is unbounded now; only a single request is capped.
    const tooLarge = await post({ items: Array.from({ length: 26 }, () => ({ bvid: 'BV1B7411m7LV' })) });
    assert.equal(tooLarge.status, 400);
    assert.match(tooLarge.data.error, /25/);
    const invalid = await post({ items: [{ key: 'bad', bvid: 'javascript:alert(1)' }, { key: 'good', bvid: 'not-a-bvid' }] });
    assert.equal(invalid.status, 200);
    assert.deepEqual(invalid.data.results.map(r => r.ok), [false, false]);
    assert.match(invalid.data.results[0].error, /BV 号无效/);
  } finally { httpServer.closeAllConnections(); httpServer.close(); }

  // Long-lived tickets: the batch endpoint asks the downloader for a 1 hour TTL.
  const bvid = 'BV1B7411m7LV';
  const media = { bvid, title: '测试', cid: 1, duration: 60, rights: { download: 1 }, pages: [{ page: 1, cid: 1, duration: 60 }] };
  const play = { format: 'mp4', quality: 16, durl: [{ url: 'https://upos.bilivideo.com/v.mp4', size: 10, length: 60000 }] };
  const now = Date.now();
  const service = createDownloads({
    fetcher: async url => ({ body: Buffer.from(JSON.stringify({ code: 0, data: url.includes('playurl') ? play : media })) }),
    streamer: async () => Object.assign(Readable.from([Buffer.from('x')]), { statusCode: 206, headers: { 'content-type': 'video/mp4' } }),
  });
  const shortPlan = await service.prepare({ bvid });
  const longPlan = await service.prepare({ bvid }, undefined, { ttlMs: 60 * 60 * 1000 });
  assert.ok(longPlan.expiresAt - shortPlan.expiresAt > 45 * 60 * 1000);
  assert.ok(longPlan.expiresAt - now <= 60 * 60 * 1000 + 5000);
});

test('lyrics API parses supplied LRC without contacting any external host', async () => {
  const { app, httpServer } = await createApplication({ test: true });
  httpServer.listen(0, '127.0.0.1'); await once(httpServer, 'listening');
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  try {
    const response = await fetch(base + '/api/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'inline', lrc: LRC, translation: TRANSLATION }) });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.source, '内嵌歌词');
    assert.equal(data.lines[0].translation, 'First line');
    const missing = await fetch(base + '/api/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media: { id: 'unknown', url: 'https://example.com/' } }) });
    assert.deepEqual((await missing.json()).lines, []);
    const viaGet = await fetch(`${base}/api/lyrics?${new URLSearchParams({ key: 'inline-get', lrc: '[00:02.00]GET 歌词' })}`);
    assert.equal(viaGet.status, 200);
    assert.equal((await viaGet.json()).lines[0].text, 'GET 歌词');
    const unknownGet = await fetch(`${base}/api/lyrics?${new URLSearchParams({ id: 'unknown', url: 'https://example.com/' })}`);
    assert.deepEqual((await unknownGet.json()).lines, []);
  } finally { httpServer.closeAllConnections(); httpServer.close(); }
  void app;
});
