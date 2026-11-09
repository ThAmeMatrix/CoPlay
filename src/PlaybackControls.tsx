import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { usePlayback, playback, type PlaybackSnapshot, type CommandAction } from './playback';

function time(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Shared transport bar. `state` / `onCommand` can be injected by the tray bubble window. */
export default function PlaybackControls({ state, compact = false, onFullscreen, fullscreen = false, embeddedHint = false, onCommand }: {
  state?: PlaybackSnapshot; compact?: boolean; onFullscreen?: () => void; fullscreen?: boolean; embeddedHint?: boolean;
  onCommand?: (action: CommandAction, value?: number) => void;
}) {
  const live = usePlayback();
  const s = state || live;
  const run = (action: CommandAction, value?: number) => onCommand ? onCommand(action, value) : playback.command(action, value);
  const pct = s.duration > 0 ? Math.min(100, s.currentTime / s.duration * 100) : 0;
  const disabled = !s.controllable;
  return <div className={`playback-controls ${compact ? 'compact' : ''}`}>
    <div className="playback-progress">
      <span>{time(s.currentTime)}</span>
      <input type="range" min={0} max={Math.max(s.duration, 1)} step={0.1} value={Math.min(s.currentTime, Math.max(s.duration, 1))}
        aria-label="播放进度" disabled={disabled} onChange={event => run('seekTo', Number(event.target.value))} style={{ '--played': `${pct}%` } as React.CSSProperties} />
      <span>{s.duration ? time(s.duration) : '--:--'}</span>
    </div>
    <div className="playback-buttons">
      <button className="icon-button" aria-label="上一项" title="上一项" onClick={() => run('previous')}><ChevronLeft size={19} /></button>
      <button className="icon-button" aria-label="后退 10 秒" title="后退 10 秒" disabled={disabled} onClick={() => run('seekBack')}><RotateCcw size={17} /></button>
      <button className="playback-play" aria-label={s.playing ? '暂停' : '播放'} disabled={disabled} onClick={() => run('playPause')}>{s.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
      <button className="icon-button" aria-label="快进 10 秒" title="快进 10 秒" disabled={disabled} onClick={() => run('seekForward')}><RotateCw size={17} /></button>
      <button className="icon-button" aria-label="下一项" title="下一项" onClick={() => run('next')}><ChevronRight size={19} /></button>
      <span className="playback-volume">
        <button className="icon-button" aria-label={s.muted ? '取消静音' : '静音'} disabled={disabled} onClick={() => run('mute')}>{s.muted || s.volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
        {!compact && <input type="range" min={0} max={1} step={0.05} value={s.muted ? 0 : s.volume} aria-label="音量" disabled={disabled}
          onChange={event => run('setVolume', Number(event.target.value))} style={{ '--played': `${(s.muted ? 0 : s.volume) * 100}%` } as React.CSSProperties} />}
      </span>
      {onFullscreen && <button className="icon-button" aria-label={fullscreen ? '退出全屏' : '直接全屏'} title={fullscreen ? '退出全屏' : '直接全屏'} onClick={onFullscreen}>{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>}
    </div>
    {embeddedHint && s.embedded && <p className="playback-embed-hint" role="status">当前使用来源平台的嵌入播放器，进度与音量请在该播放器内调节；上一项 / 下一项仍可用全局快捷键控制。</p>}
  </div>;
}
