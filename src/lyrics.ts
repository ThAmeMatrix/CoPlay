import { useEffect, useMemo, useState } from 'react';
import { api } from './hooks';
import type { Media } from './types';
import { EMPTY_LYRICS, type LyricLine, type LyricsResult } from './lyrics-core';

export type { LyricLine, LyricsResult } from './lyrics-core';
export { activeLineIndex, EMPTY_LYRICS } from './lyrics-core';

interface Resolved extends LyricsResult { status: 'loading' | 'ready' | 'none' | 'error' }
const cache = new Map<string, LyricsResult>();

/** Fetch (and cache) lyrics for the current media. Missing lyrics are not an error. */
export function useLyrics(media: Media | null): Resolved {
  const key = media ? `${media.id}|${media.url}|${media.playbackUrl || ''}` : '';
  const [state, setState] = useState<Resolved>(() => key && cache.has(key)
    ? { ...cache.get(key)!, status: cache.get(key)!.lines.length ? 'ready' : 'none' }
    : { ...EMPTY_LYRICS, status: media ? 'loading' : 'none' });
  useEffect(() => {
    if (!media) { setState({ ...EMPTY_LYRICS, status: 'none' }); return; }
    if (cache.has(key)) {
      const value = cache.get(key)!;
      setState({ ...value, status: value.lines.length ? 'ready' : 'none' });
      return;
    }
    const abort = new AbortController();
    setState({ ...EMPTY_LYRICS, status: 'loading' });
    const query = new URLSearchParams({
      key: media.id, id: media.id, url: media.url || '', playbackUrl: media.playbackUrl || '',
      platform: media.platform || '', title: media.title || '',
    });
    void api<LyricsResult>(`/api/lyrics?${query}`, { signal: abort.signal }).then(value => {
      if (abort.signal.aborted) return;
      const result: LyricsResult = {
        lines: Array.isArray(value.lines) ? value.lines.slice(0, 2000).filter(line => Number.isFinite(line.time) && typeof line.text === 'string').map(line => ({ time: line.time, text: line.text.slice(0, 300), ...(line.translation ? { translation: line.translation.slice(0, 300) } : {}) })) : [],
        source: String(value.source || '').slice(0, 60), reason: String(value.reason || '').slice(0, 180),
      };
      if (cache.size > 120) cache.clear();
      cache.set(key, result);
      setState({ ...result, status: result.lines.length ? 'ready' : 'none' });
    }).catch(() => { if (!abort.signal.aborted) setState({ ...EMPTY_LYRICS, status: 'error', reason: '歌词暂时无法读取' }); });
    return () => abort.abort();
  }, [key, media]);
  return state;
}

/** Publish lyrics and the enabled flag to the desktop lyrics window. */
export function useDesktopLyrics(media: Media | null, result: LyricsResult, enabled: boolean) {
  const lines = result.lines;
  const payload = useMemo(() => ({
    enabled, mediaId: media?.id || '', title: media?.title || '', subtitle: media?.subtitle || '',
    source: result.source, lines: lines.map(line => ({ time: line.time, text: line.text, translation: line.translation || '' })),
  }), [enabled, media?.id, media?.title, media?.subtitle, result.source, lines]);
  useEffect(() => {
    window.coplayDesktop?.publishLyrics?.(payload);
  }, [payload]);
  // When the player closes, make sure the floating window goes away too.
  useEffect(() => () => {
    window.coplayDesktop?.publishLyrics?.({ enabled: false, mediaId: '', title: '', subtitle: '', source: '', lines: [] });
  }, []);
}
