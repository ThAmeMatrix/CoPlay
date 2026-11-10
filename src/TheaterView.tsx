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

/**
 * A dedicated player PAGE (not a fixed overlay). The left pane holds the video
 * and never scrolls; the right pane is the only scrollable region and contains
 * the playlist. Wheel events anywhere on the page, and the slim scrub bar above
 * the list, both scroll that playlist.
 */
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
  const [stalled, setStalled] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [listProgress, setListProgress] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const media = items[state.index];
  const fullscreen = useFullscreen();
  const fullLayout = pageFull || fullscreen;
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

  // This is a whole page: lock the document so only the playlist can scroll.
  useEffect(() => {
    document.documentElement.classList.add('player-page-active');
    return () => document.documentElement.classList.remove('player-page-active');
  }, []);
  const readListProgress = () => {
    const list = listRef.current;
    if (!list) return;
    const max = Math.max(0, list.scrollHeight - list.clientHeight);
    setListProgress(max > 0 ? Math.round(list.scrollTop / max * 100) : 0);
  };
  const scrollListTo = (percent: number) => {
    const list = listRef.current;
    if (!list) return;
    const max = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = max * Math.max(0, Math.min(100, percent)) / 100;
    setListProgress(percent);
  };
  /** Scrolling anywhere (including over the player) scrolls the playlist. */
  useEffect(() => {
    const page = root.current;
    if (!page) return;
    const onWheel = (event: WheelEvent) => {
      const list = listRef.current;
      if (!list || list.contains(event.target as Node)) return;
      const max = Math.max(0, list.scrollHeight - list.clientHeight);
      if (max <= 0) return;
      event.preventDefault();
      list.scrollTop += event.deltaY;
      readListProgress();
    };
    page.addEventListener('wheel', onWheel, { passive: false });
    return () => page.removeEventListener('wheel', onWheel);
  }, []);
  // Keep the current item in view when it changes, without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('.theater-items>button.active');
    if (!list || !active) return;
    list.scrollTop = Math.max(0, active.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2);
    readListProgress();
  }, [state.index, fullLayout, query, items.length]);
  useEffect(() => { readListProgress(); }, [visible.length, fullLayout]);

  // A freshly created media element may have missed the user gesture.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const element = document.querySelector<HTMLMediaElement>('.theater-stage video, .theater-stage audio');
      if (element?.paused && element.currentTime === 0) void element.play().catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [media?.id, reloadKey]);
  // Never leave a silent black rectangle if the player never appears.
  useEffect(() => {
    setStalled(false);
    if (!media) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      const stage = root.current?.querySelector('.theater-stage');
      const ready = stage?.querySelector('video, audio, iframe, .theater-empty, [role="alert"]');
      if (ready) { setStalled(false); window.clearInterval(timer); return; }
      if (++attempts === 8) setStalled(true);
      if (attempts >= 30) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [media?.id, state.version, reloadKey]);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const pageFullRef = useRef(pageFull); pageFullRef.current = pageFull;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.fullscreenElement || playback.getSnapshot().fullscreen) { playback.setFullscreen(false); return; }
        if (pageFullRef.current) { setPageFull(false); return; }
        closeRef.current();
        return;
      }
      if (event.key === 'F11') { event.preventDefault(); playback.toggleFullscreen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => () => { if (playback.getSnapshot().fullscreen) playback.setFullscreen(false); }, []);

  const toggleDirect = () => playback.toggleFullscreen();
  const togglePage = () => setPageFull(value => !value);
  const exitFullLayout = () => { setPageFull(false); if (fullscreen) playback.setFullscreen(false); };
  const transport = <PlaybackControls onFullscreen={toggleDirect} fullscreen={fullscreen} embeddedHint />;

  return <div ref={root} className={`theater-view player-page ${fullLayout ? 'page-full' : ''}`} role="region" aria-label="播放界面">
    <header className="theater-head">
      <button className="theater-back" onClick={onClose}><ArrowLeft size={17} />返回</button>
      <div className="theater-titles"><strong>{media?.title || title}</strong><span>{title} · {state.index + 1} / {items.length} · {media?.subtitle || media?.platform}</span></div>
      <div className="theater-actions">
        <button className={pageFull ? 'active' : ''} aria-pressed={pageFull} onClick={togglePage} title="页面全屏：播放器铺满整个页面（Esc 退出）">{pageFull ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>页面全屏</span></button>
        <button className={fullscreen ? 'active' : ''} aria-pressed={fullscreen} onClick={toggleDirect} title="直接全屏：系统级全屏（Esc 退出）"><MonitorPlay size={15} /><span>{fullscreen ? '退出全屏' : '直接全屏'}</span></button>
      </div>
    </header>
    <div className="theater-body player-body">
      <section className="theater-main player-pane" aria-label="播放器">
        {/* Unmasked, unrounded surface: a hardware video overlay can be blanked
            by rounded clipping on some Windows GPU drivers. */}
        <div className="theater-stage" key={`${media?.id}:${reloadKey}`}>
          {media ? <ResourcePlayer media={media} onEnded={() => step('ended')} onError={() => setError('这个媒体暂时无法播放，可以跳到下一项。')} /> : <p className="theater-empty">列表里暂时没有可播放的内容。</p>}
          {stalled && <div className="theater-stalled" role="alert">
            <strong>画面暂时没能加载</strong>
            <p>可以重新载入播放器，或切换到已验证可正常显示的全屏布局。</p>
            <div><button className="button button-outline" onClick={() => { setReloadKey(value => value + 1); setError(''); }}>重新载入</button><button className="button button-outline" onClick={togglePage}>页面全屏</button></div>
          </div>}
        </div>
        {!fullLayout && <>
          {transport}
          <div className="queue-toolbar theater-toolbar">
            <PlaybackModeSelect label="队列播放规则" value={mode} onChange={changeMode} />
            <div><button className="icon-button bordered" aria-label="上一项" disabled={!canStepQueue(state, items.length, mode, 'previous')} onClick={() => step('previous')}><ChevronLeft size={17} /></button><button className="icon-button bordered" aria-label="下一项" disabled={!canStepQueue(state, items.length, mode, 'next')} onClick={() => step('next')}><ChevronRight size={17} /></button></div>
          </div>
          {media && <div className="theater-extra-actions"><DownloadButton media={media} notify={notify} /><LyricsControl media={media} enabled={lyricsEnabled} onToggle={onToggleLyrics} /></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>}
      </section>
      {!fullLayout && <aside className="theater-directory player-list" aria-label="播放列表">
        <header><strong>播放列表</strong><span>{title} · 共 {items.length} 项 · 滚动浏览全部内容</span>
          <div className="theater-search"><Search size={15} /><input type="search" aria-label="搜索播放列表目录" placeholder="查找标题或作者" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="plain-icon" aria-label="清空目录搜索" onClick={() => setQuery('')}><X size={13} /></button>}</div>
          <div className="player-list-scroll">
            <span>列表进度</span>
            <input type="range" min={0} max={100} step={1} value={listProgress} aria-label="播放列表滚动进度"
              onChange={event => scrollListTo(Number(event.target.value))} />
            <span>{listProgress}%</span>
          </div>
        </header>
        <div className="theater-items player-items" ref={listRef} onScroll={readListProgress}>
          {visible.map(({ item, index }) => <button key={item.id} className={index === state.index ? 'active' : ''} aria-current={index === state.index ? 'true' : undefined} aria-label={`播放${item.title}`} onClick={() => select(index)}>
            <span>{index === state.index ? <Play size={12} fill="currentColor" /> : String(index + 1).padStart(2, '0')}</span>
            <div className="theater-cover"><Cover media={item} /></div>
            <div><strong>{item.title}</strong><small>{item.subtitle} · {item.duration}</small></div>
            <PlatformIcon platform={item.platform} size={13} />
          </button>)}{!visible.length && <p className="theater-empty">没有匹配的内容，换个关键词试试。</p>}
        </div>
      </aside>}
    </div>
    {fullLayout && <div className="theater-page-controls">
      <div className="theater-page-title"><strong>{media?.title || title}</strong><span>{state.index + 1} / {items.length}</span></div>
      {transport}
      <div className="theater-page-actions">
        <button className="button button-outline" onClick={toggleDirect} title="系统级全屏">{fullscreen ? <Minimize2 size={15} /> : <MonitorPlay size={15} />}{fullscreen ? '退出全屏' : '直接全屏'}</button>
        <button className="button button-outline" onClick={exitFullLayout}><Minimize2 size={15} />退出页面全屏</button>
      </div>
    </div>}
  </div>;
}
