import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Minimize2, MonitorPlay, Play, Search, X } from 'lucide-react';
import { Cover, PlatformIcon } from './components';
import { ResourcePlayer } from './MediaPlayer';
import PlaybackControls from './PlaybackControls';
import PlaybackModeSelect from './PlaybackModeSelect';
import LyricsControl from './LyricsView';
import { DownloadButton } from './DownloadActions';
import { playback, playbackMeta, useFullscreen, usePlaybackSource, usePlaybackMode, useQueueHandlers } from './playback';
import { canStepQueue, changeQueueMode, createQueue, playbackModes, selectQueueItem, stepQueue, type PlaybackMode } from './playback-queue';
import { mediaMatchesSearch } from './playlist-search';
import type { Media } from './types';

export interface TheaterSession { title: string; items: Media[]; index: number; mode: PlaybackMode }

/** Dedicated playback screen: player left, directory right, CSS and OS fullscreen. */
export default function TheaterView({ session, onClose, onPlayed, onModeChange, onIndexChange, lyricsEnabled = false, onToggleLyrics = () => {}, notify }: {
  session: TheaterSession; onClose: () => void; onPlayed: (media: Media) => void;
  onModeChange: (mode: PlaybackMode) => void; onIndexChange?: (index: number) => void;
  lyricsEnabled?: boolean; onToggleLyrics?: () => void; notify?: (text: string) => void;
}) {
  const { items, title } = session;
  const [state, setState] = useState(() => createQueue(items.length, session.mode, session.index));
  const [mode, setMode] = useState<PlaybackMode>(session.mode);
  const [query, setQuery] = useState('');
  const [pageFull, setPageFull] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const media = items[state.index];
  // OS fullscreen is owned by the playback bus, which listens to real
  // fullscreenchange / IPC events. No optimistic local copy that can desync.
  const fullscreen = useFullscreen();
  const visible = useMemo(() => items.map((item, index) => ({ item, index })).filter(({ item }) => mediaMatchesSearch(item, query)), [items, query]);
  const played = useRef(onPlayed); played.current = onPlayed;
  const step = (reason: 'ended' | 'next' | 'previous') => { const choice = Math.random(); setState(current => stepQueue(current, items.length, mode, reason, () => choice)); };
  const select = (index: number) => setState(current => selectQueueItem(current, index, items.length));
  const changeMode = (value: PlaybackMode) => { setState(current => changeQueueMode(current, items.length)); setMode(value); onModeChange(value); };
  useQueueHandlers(() => step('previous'), () => step('next'), !!media, () => changeMode(playbackModes[(playbackModes.findIndex(m => m.value === mode) + 1) % playbackModes.length].value));
  usePlaybackSource(media ? playbackMeta(media) : null, 'theater');
  usePlaybackMode(playbackModes.find(m => m.value === mode)?.label || '列表播放');
  const indexReporter = useRef(onIndexChange); indexReporter.current = onIndexChange;
  useEffect(() => { indexReporter.current?.(state.index); }, [state.index, state.version]);
  useEffect(() => { if (media) { setError(''); played.current(media); } }, [media, state.version]);
  // Some browsers block autoplay on a freshly created element. The click that
  // opened this view is a user gesture, so a second play() call succeeds.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const element = document.querySelector<HTMLMediaElement>('.theater-stage video, .theater-stage audio');
      if (element?.paused && element.currentTime === 0) void element.play().catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [media?.id]);
  // One keydown listener for the lifetime of the view.
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const pageFullRef = useRef(pageFull); pageFullRef.current = pageFull;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pageFullRef.current) setPageFull(false);
        else if (playback.getSnapshot().fullscreen) playback.setFullscreen(false);
        else closeRef.current();
        return;
      }
      if (event.key === 'F11') { event.preventDefault(); playback.toggleFullscreen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Leaving the view must never leave the OS window stuck in fullscreen.
  useEffect(() => () => { if (playback.getSnapshot().fullscreen) playback.setFullscreen(false); }, []);

  const toggleDirect = () => playback.toggleFullscreen();
  /** Page fullscreen is CSS-only: it fills the app window without OS fullscreen. */
  const togglePage = () => setPageFull(value => !value);
  const transport = <PlaybackControls onFullscreen={toggleDirect} fullscreen={fullscreen} embeddedHint />;

  return <div ref={root} className={`theater-view ${pageFull ? 'page-full' : ''}`} role="region" aria-label="播放界面">
    <header className="theater-head">
      <button className="theater-back" onClick={onClose}><ArrowLeft size={17} />返回</button>
      <div className="theater-titles"><strong>{media?.title || title}</strong><span>{title} · {state.index + 1} / {items.length} · {media?.subtitle || media?.platform}</span></div>
      <div className="theater-actions">
        <button className={pageFull ? 'active' : ''} aria-pressed={pageFull} onClick={togglePage} title="页面全屏：播放器铺满整个窗口，隐藏列表与工具栏（Esc 退出）">{pageFull ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>页面全屏</span></button>
        <button className={fullscreen ? 'active' : ''} aria-pressed={fullscreen} onClick={toggleDirect} title="直接全屏：进入系统级全屏，隐藏窗口边框（Esc 退出）"><MonitorPlay size={15} /><span>{fullscreen ? '退出全屏' : '直接全屏'}</span></button>
      </div>
    </header>
    <div className="theater-body">
      <div className="theater-main">
        {/* Stable key: mode changes and replays must not remount (and rebuffer) the video. */}
        <div className="theater-stage" key={media?.id}>
          {media ? <ResourcePlayer media={media} onEnded={() => step('ended')} onError={() => setError('这个媒体暂时无法播放，可以跳到下一项。')} /> : <p className="theater-empty">列表里暂时没有可播放的内容。</p>}
        </div>
        {!pageFull && <>
          {transport}
          <div className="queue-toolbar theater-toolbar">
            <PlaybackModeSelect label="队列播放规则" value={mode} onChange={changeMode} />
            <div><button className="icon-button bordered" aria-label="上一项" disabled={!canStepQueue(state, items.length, mode, 'previous')} onClick={() => step('previous')}><ChevronLeft size={17} /></button><button className="icon-button bordered" aria-label="下一项" disabled={!canStepQueue(state, items.length, mode, 'next')} onClick={() => step('next')}><ChevronRight size={17} /></button></div>
          </div>
          {media && <div className="theater-extra-actions"><DownloadButton media={media} notify={notify} /><LyricsControl media={media} enabled={lyricsEnabled} onToggle={onToggleLyrics} /></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>}
      </div>
      <aside className="theater-directory" aria-label="播放列表目录">
        <header><strong>列表目录</strong><span>{title} · 共 {items.length} 项</span>
          <div className="theater-search"><Search size={15} /><input type="search" aria-label="搜索播放列表目录" placeholder="查找标题或作者" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="plain-icon" aria-label="清空目录搜索" onClick={() => setQuery('')}><X size={13} /></button>}</div>
        </header>
        <div className="theater-items">{visible.map(({ item, index }) => <button key={item.id} className={index === state.index ? 'active' : ''} aria-current={index === state.index ? 'true' : undefined} aria-label={`播放${item.title}`} onClick={() => select(index)}>
          <span>{index === state.index ? <Play size={12} fill="currentColor" /> : String(index + 1).padStart(2, '0')}</span>
          <div className="theater-cover"><Cover media={item} /></div>
          <div><strong>{item.title}</strong><small>{item.subtitle} · {item.duration}</small></div>
          <PlatformIcon platform={item.platform} size={13} />
        </button>)}{!visible.length && <p className="theater-empty">没有匹配的内容，换个关键词试试。</p>}</div>
      </aside>
    </div>
    {/* Page-fullscreen keeps an always-reachable overlay so the user can exit
        and control playback; otherwise the view looks like a dead black screen. */}
    {pageFull && <div className="theater-page-controls">
      <div className="theater-page-title"><strong>{media?.title || title}</strong><span>{state.index + 1} / {items.length}</span></div>
      {transport}
      <div className="theater-page-actions">
        <button className="button button-outline" onClick={toggleDirect} title="系统级全屏">{fullscreen ? <Minimize2 size={15} /> : <MonitorPlay size={15} />}{fullscreen ? '退出全屏' : '直接全屏'}</button>
        <button className="button button-outline" onClick={togglePage}><Minimize2 size={15} />退出页面全屏</button>
      </div>
    </div>}
  </div>;
}
