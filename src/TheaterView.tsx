import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2, MonitorPlay, Play, Search, X } from 'lucide-react';
import { Cover, PlatformIcon } from './components';
import { ResourcePlayer } from './MediaPlayer';
import PlaybackControls from './PlaybackControls';
import PlaybackModeSelect from './PlaybackModeSelect';
import { playbackMeta, usePlaybackSource, useQueueHandlers } from './playback';
import { canStepQueue, changeQueueMode, createQueue, selectQueueItem, stepQueue, type PlaybackMode } from './playback-queue';
import { mediaMatchesSearch } from './playlist-search';
import type { Media } from './types';

export interface TheaterSession { title: string; items: Media[]; index: number; mode: PlaybackMode }

/** Dedicated playback screen: player left, directory right, page/direct fullscreen. */
export default function TheaterView({ session, onClose, onPlayed, onModeChange, onDetach }: {
  session: TheaterSession; onClose: () => void; onPlayed: (media: Media) => void;
  onModeChange: (mode: PlaybackMode) => void; onDetach?: () => void;
}) {
  const { items, title } = session;
  const [state, setState] = useState(() => createQueue(items.length, session.mode, session.index));
  const [mode, setMode] = useState<PlaybackMode>(session.mode);
  const [query, setQuery] = useState('');
  const [pageFull, setPageFull] = useState(false);
  const [directFull, setDirectFull] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const media = items[state.index];
  const visible = useMemo(() => items.map((item, index) => ({ item, index })).filter(({ item }) => mediaMatchesSearch(item, query)), [items, query]);
  const played = useRef(onPlayed); played.current = onPlayed;
  const step = (reason: 'ended' | 'next' | 'previous') => { const choice = Math.random(); setState(current => stepQueue(current, items.length, mode, reason, () => choice)); };
  const select = (index: number) => setState(current => selectQueueItem(current, index, items.length));
  useQueueHandlers(() => step('previous'), () => step('next'), !!media);
  usePlaybackSource(media ? playbackMeta(media) : null, 'theater');
  useEffect(() => { if (media) { setError(''); played.current(media); } }, [media, state.version]);
  const desktop = !!window.coplayDesktop?.setFullscreen;
  useEffect(() => {
    const onChange = () => setDirectFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    const offDesktop = window.coplayDesktop?.onFullscreenState?.(on => setDirectFull(on));
    return () => { document.removeEventListener('fullscreenchange', onChange); offDesktop?.(); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement && !directFull) onClose();
      if (event.key === 'F11') { event.preventDefault(); void toggleDirect(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const toggleDirect = async () => {
    if (desktop) { window.coplayDesktop?.setFullscreen?.(!directFull); setDirectFull(!directFull); return; }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await (root.current || document.documentElement).requestFullscreen();
    } catch { setDirectFull(!!document.fullscreenElement); }
  };
  /** Page fullscreen is CSS-only: it fills the app window without OS fullscreen. */
  const togglePage = () => setPageFull(value => !value);
  useEffect(() => () => { if (desktop) window.coplayDesktop?.setFullscreen?.(false); }, [desktop]);

  return <div ref={root} className={`theater-view ${pageFull ? 'page-full' : ''}`} role="region" aria-label="播放界面">
    <header className="theater-head">
      <button className="theater-back" onClick={onClose}><ArrowLeft size={17} />返回</button>
      <div className="theater-titles"><strong>{media?.title || title}</strong><span>{title} · {state.index + 1} / {items.length} · {media?.subtitle || media?.platform}</span></div>
      <div className="theater-actions">
        <button className={pageFull ? 'active' : ''} aria-pressed={pageFull} onClick={togglePage} title="页面全屏：播放器铺满整个窗口，隐藏列表与工具栏">{pageFull ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>页面全屏</span></button>
        <button className={directFull ? 'active' : ''} aria-pressed={directFull} onClick={() => void toggleDirect()} title="直接全屏：进入系统级全屏，隐藏窗口边框"><MonitorPlay size={15} /><span>直接全屏</span></button>
        {onDetach && <button onClick={onDetach} title="在独立窗口中播放"><ExternalLink size={15} /><span>独立窗口</span></button>}
      </div>
    </header>
    <div className="theater-body">
      <div className="theater-main">
        <div className="theater-stage" key={`${media?.id}:${state.version}`}>
          {media ? <ResourcePlayer media={media} onEnded={() => step('ended')} onError={() => setError('这个媒体暂时无法播放，可以跳到下一项。')} /> : <p className="theater-empty">列表里暂时没有可播放的内容。</p>}
        </div>
        {!pageFull && <>
          <PlaybackControls onFullscreen={() => void toggleDirect()} fullscreen={directFull} embeddedHint />
          <div className="queue-toolbar theater-toolbar">
            <PlaybackModeSelect label="队列播放规则" value={mode} onChange={value => { setState(current => changeQueueMode(current, items.length)); setMode(value); onModeChange(value); }} />
            <div><button className="icon-button bordered" aria-label="上一项" disabled={!canStepQueue(state, items.length, mode, 'previous')} onClick={() => step('previous')}><ChevronLeft size={17} /></button><button className="icon-button bordered" aria-label="下一项" disabled={!canStepQueue(state, items.length, mode, 'next')} onClick={() => step('next')}><ChevronRight size={17} /></button></div>
          </div>
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
  </div>;
}
