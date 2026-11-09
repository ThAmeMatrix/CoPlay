import { useEffect, useState } from 'react';
import { ExternalLink, Film, X } from 'lucide-react';
import PlaybackControls from './PlaybackControls';
import { type PlaybackSnapshot } from './playback';
import { applyTheme } from './settings';

const EMPTY: PlaybackSnapshot = { active: false, meta: null, playing: false, currentTime: 0, duration: 0, volume: 1, muted: false, controllable: false, embedded: false };

/** Rendered only inside the independent frameless tray window. */
export default function Bubble() {
  const [state, setState] = useState<PlaybackSnapshot>(EMPTY);
  useEffect(() => {
    // main.tsx already applied the persisted theme before first paint.
    const offState = window.coplayDesktop?.onBubbleState?.(next => { if (next) setState(next); });
    const offTheme = window.coplayDesktop?.onBubbleTheme?.(theme => applyTheme(theme));
    // Listeners are now installed; ask the main process to replay the latest state.
    window.coplayDesktop?.bubbleReady?.();
    return () => { offState?.(); offTheme?.(); };
  }, []);
  const meta = state.meta;
  return <div className="bubble-window">
    <div className="bubble-top">
      <div className="bubble-cover">{meta?.cover ? <img src={meta.cover} alt="" /> : <Film size={20} />}</div>
      <div className="bubble-info">
        <strong title={meta?.title}>{meta?.title || '暂无正在播放的内容'}</strong>
        <small>{meta ? `${meta.subtitle || meta.platform} · ${state.embedded ? '平台播放器' : state.playing ? '正在播放' : '已暂停'}` : '从主界面开始播放后，这里会显示播放信息'}</small>
      </div>
      <div className="bubble-window-actions">
        <button aria-label="打开主界面" title="打开主界面" onClick={() => window.coplayDesktop?.bubbleShowMain?.()}><ExternalLink size={14} /></button>
        <button aria-label="关闭悬浮气泡" title="关闭悬浮气泡" onClick={() => window.coplayDesktop?.bubbleHide?.()}><X size={15} /></button>
      </div>
    </div>
    <PlaybackControls state={state} compact onCommand={action => window.coplayDesktop?.bubbleCommand?.(action)} />
  </div>;
}
