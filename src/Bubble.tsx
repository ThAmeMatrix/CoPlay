import { useEffect, useState } from 'react';
import { ExternalLink, Film, ListMusic, X } from 'lucide-react';
import PlaybackControls from './PlaybackControls';
import { type PlaybackSnapshot } from './playback';
import { applyTheme } from './settings';
import { displayAccelerator, type ShortcutMap } from './shortcuts';

type BubbleState = PlaybackSnapshot & { shortcuts?: ShortcutMap };
const EMPTY: BubbleState = { active: false, meta: null, playing: false, currentTime: 0, duration: 0, volume: 1, muted: false, controllable: false, embedded: false, mode: '列表播放' };

/** Rendered only inside the independent frameless tray window. */
export default function Bubble() {
  const [state, setState] = useState<BubbleState>(EMPTY);
  useEffect(() => {
    // main.tsx already applied the persisted theme before first paint.
    const offState = window.coplayDesktop?.onBubbleState?.(next => { if (next) setState(next as BubbleState); });
    const offTheme = window.coplayDesktop?.onBubbleTheme?.(theme => applyTheme(theme));
    // Listeners are now installed; ask the main process to replay the latest state.
    window.coplayDesktop?.bubbleReady?.();
    return () => { offState?.(); offTheme?.(); };
  }, []);
  // Forward the slider value too: without it a seek becomes "seekTo 0".
  const command = (action: Parameters<NonNullable<NonNullable<Window['coplayDesktop']>['bubbleCommand']>>[0], value?: number) =>
    window.coplayDesktop?.bubbleCommand?.(action, value);
  const meta = state.meta;
  const shortcuts = state.shortcuts;
  const hint = (label: string, action?: keyof ShortcutMap) => {
    const accelerator = action ? shortcuts?.[action] : '';
    return accelerator ? `${label}（${displayAccelerator(accelerator)}）` : label;
  };
  return <div className="bubble-window">
    <div className="bubble-top">
      <div className="bubble-cover">{meta?.cover ? <img src={meta.cover} alt="" /> : <Film size={20} />}</div>
      <div className="bubble-info">
        <strong title={meta?.title}>{meta?.title || '暂无正在播放的内容'}</strong>
        <small>{meta ? `${meta.subtitle || meta.platform} · ${state.embedded ? '平台播放器' : state.playing ? '正在播放' : '已暂停'}` : '从主界面开始播放后，这里会显示播放信息'}</small>
      </div>
      <div className="bubble-window-actions">
        <button aria-label="打开主界面" title={hint('打开主界面')} onClick={() => window.coplayDesktop?.bubbleShowMain?.()}><ExternalLink size={14} /></button>
        <button aria-label="关闭悬浮气泡" title={hint('关闭悬浮气泡')} onClick={() => window.coplayDesktop?.bubbleHide?.()}><X size={15} /></button>
      </div>
    </div>
    <div className="bubble-lower">
      <button className="bubble-mode" aria-label="切换播放模式" title={hint(`播放模式：${state.mode}（点击切换）`)} onClick={() => command('cycleMode')}>
        <ListMusic size={13} /><span>{state.mode}</span>
      </button>
      <PlaybackControls state={state} compact shortcuts={shortcuts} onCommand={command} />
    </div>
  </div>;
}
