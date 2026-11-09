import { useEffect, useRef, useState } from 'react';
import { Captions, X } from 'lucide-react';
import type { Media } from './types';
import { activeLineIndex, useDesktopLyrics, useLyrics, type LyricLine, type LyricsResult } from './lyrics';
import { usePlayback, type PlaybackSnapshot } from './playback';
import type { DesktopLyricsPayload, DesktopLyricsState } from './desktop-api';

/** Shared lyric renderer: previous / active / next lines with an optional translation. */
export function LyricsLines({ lines, time, compact = false }: { lines: LyricLine[]; time: number; compact?: boolean }) {
  const active = activeLineIndex(lines, time);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const current = box.current?.querySelector<HTMLElement>('.lyric-line.active');
    if (current && box.current) box.current.scrollTop = current.offsetTop - box.current.clientHeight / 2 + current.clientHeight / 2;
  }, [active, lines]);
  if (!lines.length) return <p className="lyric-empty">这首作品暂时没有可用歌词</p>;
  const from = Math.max(0, active - 2), to = Math.min(lines.length, from + (compact ? 5 : 7));
  return <div ref={box} className={`lyric-lines ${compact ? 'compact' : ''}`} aria-label="歌词">
    {lines.slice(from, to).map((line, offset) => {
      const index = from + offset;
      return <p key={`${line.time}-${index}`} className={`lyric-line ${index === active ? 'active' : ''}`}>
        <span>{line.text || '♪'}</span>{line.translation && index === active && <small>{line.translation}</small>}
      </p>;
    })}
  </div>;
}

/**
 * Playback control: show a toggle only when lyrics are available, keep an
 * in-app overlay for the web build and publish to the desktop floating window.
 */
export default function LyricsControl({ media, enabled, onToggle }: { media: Media | null; enabled: boolean; onToggle: () => void }) {
  const live = usePlayback();
  const result = useLyrics(media);
  const desktop = !!window.coplayDesktop?.publishLyrics;
  useDesktopLyrics(media, result as LyricsResult, enabled);
  const available = result.status === 'ready' && result.lines.length > 0;
  return <>
    {available && <button className={`button button-outline lyrics-toggle ${enabled ? 'active' : ''}`} aria-pressed={enabled}
      onClick={onToggle} title={enabled ? '关闭桌面歌词' : '在桌面显示歌词'}><Captions size={15} />{enabled ? '关闭歌词' : '桌面歌词'}</button>}
    {enabled && available && !desktop && <div className="lyrics-overlay" aria-live="off"><LyricsLines lines={result.lines} time={live.currentTime} />
      <span className="lyrics-overlay-source">歌词由 {result.source} 提供 · 网页版显示在应用内</span></div>}
  </>;
}

const EMPTY_STATE: DesktopLyricsState = {
  playback: { active: false, meta: null, playing: false, currentTime: 0, duration: 0, volume: 1, muted: false, controllable: false, embedded: false } as PlaybackSnapshot,
  lyrics: { enabled: false, mediaId: '', title: '', subtitle: '', source: '', lines: [] } as DesktopLyricsPayload,
};

/** Rendered only in the independent frameless desktop lyrics window. */
export function LyricsWindow() {
  const [state, setState] = useState<DesktopLyricsState>(EMPTY_STATE);
  useEffect(() => {
    const off = window.coplayDesktop?.onLyricsData?.(next => { if (next) setState(next); });
    window.coplayDesktop?.lyricsReady?.();
    return () => { off?.(); };
  }, []);
  const { playback, lyrics } = state;
  return <div className="lyrics-window" aria-label="桌面歌词">
    <header className="lyrics-head" aria-label="拖动歌词窗口">
      <span>{lyrics.title || '共映 · 桌面歌词'}</span>
      <button className="plain-icon" aria-label="关闭桌面歌词" onClick={() => window.coplayDesktop?.lyricsClose?.()}><X size={14} /></button>
    </header>
    <LyricsLines lines={lyrics.lines} time={playback.currentTime} compact />
    <footer>{playback.meta ? `${playback.meta.title} · ${playback.meta.subtitle}` : '正在等待播放'}{lyrics.source && ` · 歌词来自${lyrics.source}`}</footer>
  </div>;
}
