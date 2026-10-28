export type PlaybackMode = 'list' | 'shuffle' | 'loop' | 'single';
export const playbackModes: { value: PlaybackMode; label: string; description: string }[] = [
  { value: 'list', label: '列表播放', description: '按顺序播放，最后一项结束后停止' },
  { value: 'shuffle', label: '随机播放', description: '随机播放全部内容后重新打乱，避免连续重复' },
  { value: 'loop', label: '列表循环', description: '按顺序播放，最后一项结束后回到第一项' },
  { value: 'single', label: '单曲循环', description: '重复当前内容；上一项、下一项仍可切换' },
];
export function normalizePlaybackMode(value: unknown): PlaybackMode {
  return playbackModes.some(mode => mode.value === value) ? value as PlaybackMode : 'list';
}
export interface QueueState {
  index: number;
  version: number;
  remaining: number[];
  history: number[];
  cursor: number;
  finished: boolean;
}
const others = (count: number, index: number) => Array.from({ length: count }, (_, i) => i).filter(i => i !== index);
export function createQueue(count: number, mode: PlaybackMode, initialIndex?: number, random = Math.random): QueueState {
  const index = count ? Math.max(0, Math.min(count - 1, initialIndex ?? (mode === 'shuffle' ? Math.floor(random() * count) : 0))) : -1;
  return { index, version: 0, remaining: others(count, index), history: index < 0 ? [] : [index], cursor: 0, finished: count === 0 };
}
export function selectQueueItem(state: QueueState, index: number, count: number): QueueState {
  if (index < 0 || index >= count) return state;
  const history = index === state.index ? state.history.slice(0, state.cursor + 1) : [...state.history.slice(0, state.cursor + 1), index].slice(-200);
  return { index, version: state.version + 1, remaining: state.remaining.filter(i => i !== index), history, cursor: history.length - 1, finished: false };
}
export function changeQueueMode(state: QueueState, count: number): QueueState {
  return { ...state, remaining: others(count, state.index), history: [state.index], cursor: 0 };
}
export function canStepQueue(state: QueueState, count: number, mode: PlaybackMode, direction: 'next' | 'previous') {
  if (!count) return false;
  if (direction === 'previous' && mode === 'shuffle') return state.cursor > 0;
  return mode !== 'list' || (direction === 'next' ? state.index < count - 1 : state.index > 0);
}
export function stepQueue(state: QueueState, count: number, mode: PlaybackMode, reason: 'ended' | 'next' | 'previous', random = Math.random): QueueState {
  if (!count) return state;
  if (reason === 'ended' && mode === 'single') return selectQueueItem(state, state.index, count);
  if (mode === 'shuffle') {
    const cursor = state.cursor + (reason === 'previous' ? -1 : 1);
    if (cursor < 0) return state;
    if (cursor < state.history.length) return { ...state, index: state.history[cursor], cursor, version: state.version + 1, finished: false };
    const remaining = state.remaining.length ? state.remaining : Array.from({ length: count }, (_, i) => i);
    const candidates = remaining.filter(index => index !== state.index);
    const index = candidates.length ? candidates[Math.floor(random() * candidates.length)] : state.index;
    return selectQueueItem({ ...state, remaining }, index, count);
  }
  const index = state.index + (reason === 'previous' ? -1 : 1);
  if (mode === 'list' && (index < 0 || index >= count)) return reason === 'ended' ? { ...state, finished: true } : state;
  return selectQueueItem(state, (index + count) % count, count);
}

export function reorderPlaylist(ids: string[], from: string, to: string) {
  const start = ids.indexOf(from), end = ids.indexOf(to);
  if (start < 0 || end < 0 || start === end) return ids;
  const result = [...ids]; result.splice(start, 1); result.splice(end, 0, from); return result;
}
