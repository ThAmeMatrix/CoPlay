// Pure lyric helpers. Keep this file free of runtime imports so both Vite and
// the Node test runner can load it directly.
export interface LyricLine { time: number; text: string; translation?: string }
export interface LyricsResult { lines: LyricLine[]; source: string; reason: string }

export const EMPTY_LYRICS: LyricsResult = { lines: [], source: '', reason: '' };

/** Index of the line that should be highlighted at `time` (binary search). */
export function activeLineIndex(lines: LyricLine[], time: number): number {
  if (!lines.length || !Number.isFinite(time)) return -1;
  let low = 0, high = lines.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= time) { found = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return found;
}
