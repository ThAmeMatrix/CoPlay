import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, mediaMatchesSearch, playlistMatchesSearch } from '../src/playlist-search.ts';

test('list search trims input, normalizes case/full width and combines terms across media fields', () => {
  const media = { title: 'Night 雨后', subtitle: 'Alice', platform: '网易云音乐', kind: '音乐', tags: ['钢琴'] };
  assert.equal(mediaMatchesSearch(media, '  ＮＩＧＨＴ  alice  '), true);
  assert.equal(mediaMatchesSearch(media, '钢琴 网易云'), true);
  assert.equal(mediaMatchesSearch(media, '雨后 BOB'), false);
  assert.equal(mediaMatchesSearch(media, '  \t '), true);
});
test('playlist names and descriptions are searchable without including unrelated resource titles', () => {
  const list = { title: '夜航 MIX', description: '通勤时的城市声景' };
  assert.equal(playlistMatchesSearch(list, 'mix 通勤'), true);
  assert.equal(playlistMatchesSearch(list, '不存在'), false);
  assert.equal(playlistMatchesSearch({ title: '收藏' }, '收藏'), true);
  assert.equal(matchesSearch('.*[', 'literal .*['), true);
});
