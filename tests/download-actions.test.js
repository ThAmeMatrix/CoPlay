import test from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_CHUNK_SIZE, MAX_BATCH_REQUEST, chunkItems, canDownloadMedia, downloadKey, downloadPage, downloadRequest, hasLocalCopy } from '../src/download-rules.ts';

const bvid = 'BV1B7411m7LV';
const media = (patch = {}) => ({
  id: 'video-a', title: '测试视频', subtitle: '作者', kind: '视频', platform: '哔哩哔哩',
  cover: '', duration: '1:00', tags: [], description: '', url: `https://www.bilibili.com/video/${bvid}/`,
  playbackType: 'embed', download: { provider: 'bilibili', bvid, page: 3, available: true }, ...patch,
});

test('only B 站公开视频 with a valid BV 号 can be downloaded', () => {
  assert.equal(canDownloadMedia(media()), true);
  assert.equal(canDownloadMedia(media({ download: undefined })), false);
  assert.equal(canDownloadMedia(media({ download: { provider: 'bilibili', bvid: 'BV_invalid', page: 1 } })), false);
  assert.equal(canDownloadMedia(media({ download: { provider: 'bilibili', bvid, page: 1, available: false } })), false);
  assert.equal(canDownloadMedia(media({ download: { provider: 'other', bvid, page: 1 } })), false);
});

test('download page follows the selected episode and keys match the downloaded library', () => {
  assert.equal(downloadPage(media()), 3);
  assert.equal(downloadPage(media({ defaultEpisode: 1, episodes: [{ title: 'P1', url: '', page: 1 }, { title: 'P5', url: '', page: 5 }] })), 5);
  assert.equal(downloadKey(media()), `bili:${bvid}:p3`);
  assert.deepEqual(downloadRequest(media()), { key: `bili:${bvid}:p3`, bvid, page: 3 });
  assert.deepEqual(downloadRequest(media({ download: undefined })), { key: `bili:undefined:p1`, bvid: '', page: 1 },
    'media without download metadata must not throw');
  assert.equal(BATCH_CHUNK_SIZE, 10);
  assert.equal(MAX_BATCH_REQUEST, 25);
});

test('a whole selection is chunked without any cap or lost items', () => {
  assert.deepEqual(chunkItems([]), []);
  for (const total of [1, 3, 10, 11, 20, 37, 250]) {
    const items = Array.from({ length: total }, (_, i) => i);
    const chunks = chunkItems(items);
    assert.deepEqual(chunks.flat(), items, `${total} items must all be downloaded`);
    assert.ok(chunks.every(chunk => chunk.length > 0 && chunk.length <= MAX_BATCH_REQUEST));
  }
  assert.equal(chunkItems(Array.from({ length: 40 }, (_, i) => i)).length, 4);
  assert.equal(chunkItems([1, 2, 3], 100).length, 1, 'chunk size is capped by the server ceiling');
});

test('completed local copies are never offered for re-download', () => {
  const key = downloadKey(media());
  assert.equal(hasLocalCopy([], media()), false);
  assert.equal(hasLocalCopy([{ key, complete: false }], media()), false, 'incomplete copy still needs the download');
  assert.equal(hasLocalCopy([{ key: `bili:${bvid}:p9`, complete: true }], media()), false, 'a different episode is not a copy');
  assert.equal(hasLocalCopy([{ key, complete: true }], media()), true);
  assert.equal(hasLocalCopy([{ key, complete: true }], media({ download: undefined })), false);
});
