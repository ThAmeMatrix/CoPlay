import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { usePlayback, playback, type PlaybackSnapshot, type CommandAction } from './playback';
import { displayAccelerator, type ShortcutAction, type ShortcutMap } from './shortcuts';

function time(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Shared transport bar. `state` / `onCommand` can be injected by the tray bubble window. */
export default function PlaybackControls({ state, compact = false, onFullscreen, fullscreen = false, embeddedHint = false, onCommand, shortcuts }: {
  state?: PlaybackSnapshot; compact?: boolean; onFullscreen?: () => void; fullscreen?: boolean; embeddedHint?: boolean;
  onCommand?: (action: CommandAction, value?: number) => void; shortcuts?: ShortcutMap;
}) {
  const live = usePlayback();
  const s = state || live;
  const run = (action: CommandAction, value?: number) => onCommand ? onCommand(action, value) : playback.command(action, value);
  const runRef = useRef(run); runRef.current = run;
  const disabled = !s.controllable;
  const max = Math.max(s.duration, 1);

  // Scrubbing is a purely local preview. Seeking the media on every input event
  // forces a re-buffer (and an HTTP range request for streamed files) which is
  // what made dragging feel sticky. Exactly ONE seek happens on release.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubValue = useRef<number | null>(null);
  const scrubbing = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const endScrub = () => {
    if (!scrubbing.current && scrubValue.current === null) return;
    scrubbing.current = false;
    const value = scrubValue.current;
    playback.setScrubbing(false);
    if (value !== null) runRef.current('seekTo', value);
    // Keep the local value until the media reports the new position, otherwise
    // the thumb flickers back to the old playhead before jumping forward.
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => { scrubValue.current = null; setScrub(null); }, 1500);
  };
  const endRef = useRef(endScrub); endRef.current = endScrub;
  useEffect(() => {
    const up = () => endRef.current();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); playback.setScrubbing(false); };
  }, []);
  useEffect(() => () => clearTimeout(settleTimer.current), []);
  useEffect(() => {
    if (scrubbing.current || scrubValue.current === null) return;
    if (Math.abs(s.currentTime - scrubValue.current) <= 0.4) {
      scrubValue.current = null;
      clearTimeout(settleTimer.current);
      setScrub(null);
    }
  }, [s.currentTime]);
  const seek = (value: number) => {
    clearTimeout(settleTimer.current);
    scrubValue.current = value;
    playback.setScrubbing(true);
    setScrub(value);
  };

  const shown = scrub ?? Math.min(s.currentTime, max);
  const pct = s.duration > 0 ? Math.min(100, shown / s.duration * 100) : 0;
  /** Native tooltips reveal the matching global hotkey on hover. */
  const hint = (label: string, action?: ShortcutAction) => {
    const accelerator = action ? shortcuts?.[action] : '';
    return accelerator ? `${label}（${displayAccelerator(accelerator)}）` : label;
  };
  return <div className={`playback-controls ${compact ? 'compact' : ''} ${scrub !== null ? 'scrubbing' : ''}`}>
    <div className="playback-progress">
      <span>{time(shown)}</span>
      <input type="range" min={0} max={max} step={0.01} value={shown}
        aria-label="播放进度" disabled={disabled}
        onPointerDown={() => { clearTimeout(settleTimer.current); scrubbing.current = true; }}
        onKeyDown={() => { clearTimeout(settleTimer.current); scrubbing.current = true; }}
        onChange={event => seek(Number(event.target.value))}
        onBlur={endScrub} onKeyUp={endScrub}
        style={{ '--played': `${pct}%` } as React.CSSProperties} />
      <span>{s.duration ? time(s.duration) : '--:--'}</span>
    </div>
    <div className="playback-buttons">
      <button className="icon-button" aria-label="上一项" title={hint('上一项', 'previous')} onClick={() => run('previous')}><ChevronLeft size={19} /></button>
      <button className="icon-button" aria-label="后退 10 秒" title={hint('后退 10 秒', 'seekBack')} disabled={disabled} onClick={() => run('seekBack')}><RotateCcw size={17} /></button>
      <button className="playback-play" aria-label={s.playing ? '暂停' : '播放'} title={hint(s.playing ? '暂停' : '播放', 'playPause')} disabled={disabled} onClick={() => run('playPause')}>{s.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
      <button className="icon-button" aria-label="快进 10 秒" title={hint('快进 10 秒', 'seekForward')} disabled={disabled} onClick={() => run('seekForward')}><RotateCw size={17} /></button>
      <button className="icon-button" aria-label="下一项" title={hint('下一项', 'next')} onClick={() => run('next')}><ChevronRight size={19} /></button>
      <span className="playback-volume">
        <button className="icon-button" aria-label={s.muted ? '取消静音' : '静音'} title={hint(s.muted ? '取消静音' : '静音', 'mute')} disabled={disabled} onClick={() => run('mute')}>{s.muted || s.volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
        <input type="range" min={0} max={1} step={0.01} value={s.muted ? 0 : s.volume} aria-label="音量" disabled={disabled}
          title={hint(`音量 ${Math.round((s.muted ? 0 : s.volume) * 100)}%`, 'volumeUp')}
          onChange={event => run('setVolume', Number(event.target.value))} style={{ '--played': `${(s.muted ? 0 : s.volume) * 100}%` } as React.CSSProperties} />
      </span>
      {onFullscreen && <button className="icon-button" aria-label={fullscreen ? '退出全屏' : '直接全屏'} title={fullscreen ? '退出全屏' : '直接全屏'} onClick={onFullscreen}>{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>}
    </div>
    {embeddedHint && s.embedded && <p className="playback-embed-hint" role="status">当前使用来源平台的嵌入播放器，进度与音量请在该播放器内调节；上一项 / 下一项仍可用全局快捷键控制。</p>}
  </div>;
}
