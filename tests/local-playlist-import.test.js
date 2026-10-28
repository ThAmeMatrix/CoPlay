import test from 'node:test';
import assert from 'node:assert/strict';
import { addLocalFile, prepareLocalFile, getLocalAsset, restoreLocalFile } from '../src/local-media.ts';

test('preparing local files for selection creates no playable asset; committing the selection makes it available', async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'preview-only.wav', { type: 'audio/wav' });
  const prepared = await prepareLocalFile(file);
  assert.equal(prepared.media.kind, '音乐'); assert.equal(prepared.media.playbackType, 'local');
  assert.equal(getLocalAsset(prepared.media.id), undefined);
  assert.equal(JSON.stringify(prepared.media).includes('blob:'), false);
  prepared.attach();
  assert.equal(getLocalAsset(prepared.media.id).file, file);
  assert.match(getLocalAsset(prepared.media.id).url, /^blob:/);
});
test('local selection uses stable file identities, rejects invalid entries, and preserves the existing restore workflow', async () => {
  const file = new File([new Uint8Array([3, 2, 1])], 'selected.wav', { type: 'audio/wav' });
  const prepared = await prepareLocalFile(file), duplicate = await prepareLocalFile(file);
  assert.equal(prepared.media.id, duplicate.media.id);
  const imported = await addLocalFile(file); assert.equal(imported.id, prepared.media.id);
  await assert.rejects(prepareLocalFile(new File([], 'empty.mp3')), /非空/);
  await assert.rejects(prepareLocalFile(new File(['text'], 'note.txt')), /视频或音频/);
  await assert.rejects(restoreLocalFile(imported, new File(['other'], 'selected.wav')), /不匹配/);
  await restoreLocalFile(imported, file); assert.equal(getLocalAsset(imported.id).file, file);
});
