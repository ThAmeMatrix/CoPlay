import test from 'node:test';
import assert from 'node:assert/strict';
import { canStepQueue, changeQueueMode, createQueue, normalizePlaybackMode, reorderPlaylist, selectQueueItem, stepQueue } from '../src/playback-queue.ts';
import { musicEmbedUrl, requiresMusicPlayClick } from '../src/music-player.ts';

test('list playback follows order and stops at the end without restarting the player', () => {
  let state = createQueue(3, 'list');
  assert.equal(canStepQueue(state, 3, 'list', 'previous'), false);
  state = stepQueue(state, 3, 'list', 'ended'); assert.equal(state.index, 1);
  state = stepQueue(state, 3, 'list', 'ended'); assert.equal(state.index, 2);
  const version = state.version;
  state = stepQueue(state, 3, 'list', 'ended');
  assert.equal(state.index, 2); assert.equal(state.finished, true); assert.equal(state.version, version);
  assert.equal(canStepQueue(state, 3, 'list', 'next'), false);
  assert.equal(selectQueueItem(state, 0, 3).finished, false);
});
test('list loop wraps both ways and single repeat restarts the current item but permits manual navigation', () => {
  assert.equal(stepQueue(createQueue(3, 'loop', 2), 3, 'loop', 'ended').index, 0);
  assert.equal(stepQueue(createQueue(3, 'loop'), 3, 'loop', 'previous').index, 2);
  const state = createQueue(3, 'single', 1), repeat = stepQueue(state, 3, 'single', 'ended');
  assert.equal(repeat.index, 1); assert.equal(repeat.version, state.version + 1);
  assert.equal(stepQueue(repeat, 3, 'single', 'next').index, 2);
  assert.equal(stepQueue(repeat, 3, 'single', 'previous').index, 0);
});
test('shuffle visits every item before a new cycle and never repeats adjacent tracks', () => {
  let state = createQueue(5, 'shuffle', undefined, () => 0.6);
  assert.equal(state.index, 3);
  const visited = [state.index];
  for (let n = 0; n < 4; n++) { state = stepQueue(state, 5, 'shuffle', 'ended', () => 0.4); visited.push(state.index); }
  assert.equal(new Set(visited).size, 5);
  for (let cycle = 0; cycle < 6; cycle++) {
    const nextCycle = [];
    for (let n = 0; n < 5; n++) { const previous = state.index; state = stepQueue(state, 5, 'shuffle', 'next', () => n % 2 ? 0.99 : 0); assert.notEqual(state.index, previous); nextCycle.push(state.index); }
    assert.equal(new Set(nextCycle).size, 5);
  }
});
test('shuffle previous and next follow actual playback history; clicking a track branches history', () => {
  let state = createQueue(4, 'shuffle', 0);
  assert.equal(canStepQueue(state, 4, 'shuffle', 'previous'), false);
  state = stepQueue(state, 4, 'shuffle', 'next', () => 0.99);
  assert.equal(state.index, 3);
  state = stepQueue(state, 4, 'shuffle', 'next', () => 0);
  assert.equal(state.index, 1);
  state = stepQueue(state, 4, 'shuffle', 'previous'); assert.equal(state.index, 3);
  state = stepQueue(state, 4, 'shuffle', 'previous'); assert.equal(state.index, 0);
  state = stepQueue(state, 4, 'shuffle', 'next'); assert.equal(state.index, 3);
  state = selectQueueItem(state, 2, 4); assert.deepEqual(state.history, [0, 3, 2]);
  assert.equal(stepQueue(state, 4, 'shuffle', 'previous').index, 3);
});
test('switching modes preserves playback position; empty and single-item queues are safe', () => {
  const state = selectQueueItem(createQueue(3, 'list'), 2, 3), switched = changeQueueMode(state, 3);
  assert.equal(switched.index, 2); assert.equal(switched.version, state.version); assert.deepEqual(switched.remaining, [0, 1]);
  assert.equal(stepQueue(createQueue(0, 'list'), 0, 'list', 'ended').finished, true);
  for (const mode of ['shuffle', 'loop', 'single']) {
    const next = stepQueue(createQueue(1, mode), 1, mode, 'ended');
    assert.equal(next.index, 0); assert.equal(next.version, 1); assert.equal(next.finished, false);
  }
  assert.equal(normalizePlaybackMode('bad persisted value'), 'list');
});
test('playlist moves preserve all items, work in both directions, and ignore stale drag targets', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(reorderPlaylist(ids, 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(reorderPlaylist(ids, 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
  assert.equal(reorderPlaylist(ids, 'a', 'missing'), ids);
  assert.equal(reorderPlaylist(ids, 'missing', 'b'), ids);
});
test('cached NetEase songs and playlists honor autoplay without mutating unrelated players', () => {
  for (const type of [0, 2]) {
    const src = `https://music.163.com/outchain/player?type=${type}&id=123&auto=0&height=66`;
    const enabled = new URL(musicEmbedUrl(src, true));
    assert.equal(enabled.searchParams.get('auto'), '1'); assert.equal(enabled.searchParams.get('type'), String(type));
    assert.equal(new URL(musicEmbedUrl(enabled.href, false)).searchParams.get('auto'), '0');
  }
  const other = 'https://music.163.com.evil.example/outchain/player?auto=0';
  assert.equal(musicEmbedUrl(other, true), other);
  assert.equal(musicEmbedUrl(undefined, true), undefined);
});
test('saved QQ players migrate to the working endpoint without inventing autoplay support', () => {
  const src = musicEmbedUrl('https://i.y.qq.com/n2/m/outchain/player.html?songid=97773&songtype=0', true);
  assert.equal(new URL(src).pathname, '/n2/m/outchain/player/index.html');
  assert.equal(new URL(src).searchParams.get('songid'), '97773');
  assert.equal(requiresMusicPlayClick(src), true);
  assert.equal(requiresMusicPlayClick('https://i.y.qq.com.evil.example/n2/m/outchain/player/index.html'), false);
});
