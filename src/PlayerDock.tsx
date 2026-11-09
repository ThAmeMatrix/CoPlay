import { useEffect, useRef, useState } from 'react';
import { ListMusic, Maximize2, Play, X } from 'lucide-react';
import { Cover, PlatformIcon } from './components';
import { ResourcePlayer } from './MediaPlayer';
import PlaybackControls from './PlaybackControls';
import PlaybackModeSelect from './PlaybackModeSelect';
import { DownloadButton } from './DownloadActions';
import LyricsControl from './LyricsView';
import { usePlaybackSource, useQueueHandlers, usePlaybackMode, playbackMeta } from './playback';
import { playbackModes, type PlaybackMode } from './playback-queue';
import type { ShortcutMap } from './shortcuts';
import type { Media } from './types';

export interface PlayerSession {
  title: string; items: Media[]; index: number; version: number; mode: PlaybackMode;
}

/**
 * Persistent bottom player bar. When no modal / theater player is open it owns
 * the real media element, so closing a playback view never stops the music.
 */
export default function PlayerDock({ session, ownsPlayer, onStep, onSelect, onModeChange, onOpenPlaylist, onTheater, onStop, lyricsEnabled, onToggleLyrics, notify, shortcuts }: {
  session: PlayerSession; ownsPlayer: boolean;
  onStep: (reason: 'ended' | 'next' | 'previous') => void;
  onSelect: (index: number) => void;
  onModeChange: (mode: PlaybackMode) => void;
  onOpenPlaylist: () => void; onTheater: () => void; onStop: () => void;
  lyricsEnabled: boolean; onToggleLyrics: () => void; notify?: (text: string) => void; shortcuts?: ShortcutMap;
}) {
  const media = session.items[session.index];
  const label = playbackModes.find(value => value.value === session.mode)?.label || '列表播放';
  const [listOpen, setListOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  usePlaybackSource(media ? playbackMeta(media) : null, 'dock', ownsPlayer);
  usePlaybackMode(label, ownsPlayer);
  const nextMode = () => {
    const list = playbackModes.map(value => value.value);
    onModeChange(list[(list.indexOf(session.mode) + 1) % list.length]);
  };
  useQueueHandlers(() => onStep('previous'), () => onStep('next'), ownsPlayer, nextMode);
  useEffect(() => {
    if (!listOpen) return;
    const onOutside = (event: Event) => { if (!listRef.current?.contains(event.target as Node)) setListOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setListOpen(false); };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('click', onOutside, true);
    window.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('click', onOutside, true); window.removeEventListener('keydown', onKey, true); };
  }, [listOpen]);
  if (!media) return null;
  return <div className="player-dock" role="region" aria-label="播放控制栏">
    {listOpen && <div className="dock-playlist" ref={listRef} aria-label="当前播放列表">
      <header><strong>{session.title}</strong><span>{session.items.length} 项内容</span>
        <button className="text-link" onClick={() => { setListOpen(false); onOpenPlaylist(); }}>打开完整列表</button></header>
      <div className="dock-playlist-items">{session.items.map((item, index) => <button key={item.id} className={index === session.index ? 'active' : ''}
        aria-current={index === session.index ? 'true' : undefined} onClick={() => { onSelect(index); }}>
        <span>{index === session.index ? <Play size={12} fill="currentColor" /> : String(index + 1).padStart(2, '0')}</span>
        <strong title={item.title}>{item.title}</strong><small>{item.subtitle || item.platform}</small><PlatformIcon platform={item.platform} size={13} />
      </button>)}</div>
    </div>}
    <div className="dock-stage">
      {ownsPlayer ? <ResourcePlayer key={`${media.id}:${session.version}`} media={media} onEnded={() => onStep('ended')} /> : <Cover media={media} />}
    </div>
    <div className="dock-info">
      <strong title={media.title}>{media.title}</strong>
      <small title={session.title}>{session.title} · {session.index + 1} / {session.items.length} · {media.subtitle || media.platform}</small>
    </div>
    <div className="dock-controls"><PlaybackControls shortcuts={shortcuts} /></div>
    <div className="dock-actions">
      <PlaybackModeSelect label="播放规则" value={session.mode} onChange={onModeChange} />
      <button className={`icon-button ${listOpen ? 'selected' : ''}`} aria-label="当前播放列表" aria-expanded={listOpen} title="当前播放列表" onClick={() => setListOpen(value => !value)}><ListMusic size={17} /></button>
      <button className="icon-button" aria-label="放大播放" title="放大播放" onClick={onTheater}><Maximize2 size={17} /></button>
      {ownsPlayer && <><DownloadButton media={media} notify={notify} label="下载" /><LyricsControl media={media} enabled={lyricsEnabled} onToggle={onToggleLyrics} /></>}
      <button className="icon-button" aria-label="停止播放并收起" title="停止播放并收起" onClick={onStop}><X size={17} /></button>
    </div>
  </div>;
}
