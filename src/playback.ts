import { useEffect, useRef, useSyncExternalStore } from 'react';
import { acceleratorMatches, normalizeShortcuts, type ShortcutMap } from './shortcuts';

export interface PlaybackMeta {
  id: string; title: string; subtitle: string; cover: string; platform: string; kind: string;
}
export interface PlaybackSnapshot {
  active: boolean;
  meta: PlaybackMeta | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** A real <video>/<audio> element is available for transport control. */
  controllable: boolean;
  /** The active player is a cross-origin iframe owned by the source platform. */
  embedded: boolean;
  /** Human-readable queue rule, mirrored into the tray bubble. */
  mode: string;
  /** OS-level fullscreen, reported by the main process / Fullscreen API. */
  fullscreen: boolean;
}
export type CommandAction =
  | 'playPause' | 'seekBack' | 'seekForward' | 'previous' | 'next'
  | 'mute' | 'volumeUp' | 'volumeDown' | 'seekTo' | 'setVolume' | 'toggleFullscreen' | 'cycleMode';

const EMPTY: PlaybackSnapshot = {
  active: false, meta: null, playing: false, currentTime: 0, duration: 0,
  volume: 1, muted: false, controllable: false, embedded: false, mode: '列表播放', fullscreen: false,
};
const MEDIA_EVENTS = ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'pause', 'volumechange', 'ended', 'seeked'];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
// Continuous controls must not be throttled by the discrete-command debounce,
// otherwise dragging a progress bar feels sticky.
const CONTINUOUS = new Set<CommandAction>(['seekTo', 'setVolume', 'volumeUp', 'volumeDown']);

function mediaElement(): HTMLMediaElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio'));
  return nodes.find(node => node.isConnected && node.getClientRects().length > 0) || nodes[0] || null;
}
function embeddedPlayer(): boolean {
  return !!document.querySelector('.detail-player iframe, .theater-stage iframe, .platform-music-player iframe, .bili-player-stage iframe');
}

class PlaybackBus {
  private listeners = new Set<() => void>();
  private snapshot: PlaybackSnapshot = EMPTY;
  private element: HTMLMediaElement | null = null;
  private metaOwner: string | null = null;
  private queue: { previous: () => void; next: () => void; cycleMode?: () => void } | null = null;
  private shortcuts: ShortcutMap = normalizeShortcuts(null);
  private resumeAt = 0;
  private resumeMetaId = '';
  private announcedMetaId = '';
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastCommand: { action: string; at: number } | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  /** While the user drags a slider, freeze snapshots so React cannot fight the pointer. */
  private scrubbing = false;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private emit() { for (const listener of this.listeners) listener(); }
  private set(patch: Partial<PlaybackSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    let changed = false;
    for (const key of Object.keys(next) as (keyof PlaybackSnapshot)[]) {
      if (next[key] !== this.snapshot[key]) { changed = true; break; }
    }
    if (!changed) return;
    this.snapshot = next;
    this.emit();
    this.publish();
  }
  private publish() {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      window.coplayDesktop?.publishPlayback?.(this.snapshot);
    }, 180);
  }

  /** The active player view announces the media the tray/bubble should display. */
  setSource(meta: PlaybackMeta | null, owner: string, active = true) {
    if (!active) { this.clearSource(owner); return; }
    this.metaOwner = owner;
    if (meta) { this.announcedMetaId = meta.id; this.set({ active: true, meta }); }
    else this.set({ active: true });
    this.syncDom();
    this.tryResume();
  }
  clearSource(owner: string) {
    if (this.metaOwner !== owner) return;
    this.metaOwner = null;
    this.set({ active: false, meta: null, playing: false, currentTime: 0, duration: 0, controllable: false, embedded: false });
  }
  setQueueHandlers(handlers: { previous: () => void; next: () => void; cycleMode?: () => void } | null) { this.queue = handlers; }
  setShortcuts(map: ShortcutMap) { this.shortcuts = normalizeShortcuts(map); }
  /** Suppress progress snapshots while a slider is being dragged. */
  setScrubbing = (on: boolean) => { this.scrubbing = on; };
  /** The active owner reports its rule so remote surfaces can show / change it. */
  setMode(label: string) { if (label && label !== this.snapshot.mode) this.set({ mode: label.slice(0, 40) }); }
  /** Preserve the playhead when the player is remounted into a different layout. */
  requestResume(seconds?: number, mediaId?: string) {
    this.resumeAt = Math.max(0, seconds ?? this.snapshot.currentTime);
    this.resumeMetaId = mediaId ?? this.snapshot.meta?.id ?? '';
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    // A stale playhead must never be applied to a later session.
    this.resumeTimer = setTimeout(() => { this.resumeAt = 0; this.resumeMetaId = ''; }, 12000);
  }
  /**
   * Only resume for the SAME item. Seeking a different item to the old
   * playhead can land past its end and leave a black frame. Called both when a
   * media element appears and when the new owner announces its metadata,
   * because those can arrive in either order.
   */
  private tryResume() {
    const id = this.snapshot.meta?.id || this.announcedMetaId;
    if (!this.element || this.resumeAt <= 0.25 || !this.resumeMetaId || this.resumeMetaId !== id) return;
    const element = this.element;
    const target = this.resumeAt;
    this.resumeAt = 0; this.resumeMetaId = '';
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    const seek = () => {
      if (Number.isFinite(element.duration) && element.duration > 0 && target < element.duration - 0.5)
        element.currentTime = clamp(target, 0, element.duration - 0.5);
      element.removeEventListener('loadedmetadata', seek);
    };
    element.addEventListener('loadedmetadata', seek);
    if (element.readyState >= 1) seek();
  }

  private attach(element: HTMLMediaElement) {
    this.element = element;
    for (const event of MEDIA_EVENTS) element.addEventListener(event, this.readElement);
    this.readElement();
    this.tryResume();
  }
  private detach() {
    if (!this.element) return;
    for (const event of MEDIA_EVENTS) this.element.removeEventListener(event, this.readElement);
    this.element = null;
  }
  private readElement = () => {
    const element = this.element;
    if (!element) return;
    this.set({
      controllable: true, embedded: false,
      playing: !element.paused && !element.ended,
      currentTime: this.scrubbing ? this.snapshot.currentTime : (Number.isFinite(element.currentTime) ? element.currentTime : 0),
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      volume: element.volume, muted: element.muted,
    });
  };

  /** Re-scan the DOM after React swaps a player or an iframe mounts. */
  syncDom = () => {
    const element = mediaElement();
    if (element !== this.element) { this.detach(); if (element) this.attach(element); }
    if (!element) {
      const embedded = embeddedPlayer();
      this.set({ controllable: false, embedded, ...(embedded ? {} : { playing: false, currentTime: 0, duration: 0 }) });
    } else if (this.element) this.readElement();
  };

  /**
   * Use Chromium's own Fullscreen API rather than Electron's native
   * BrowserWindow.setFullScreen(). Native fullscreen swaps the compositor
   * surface on Windows, which blanks hardware-accelerated <video> layers;
   * the HTML5 path keeps the video in the same rendering surface and Electron
   * still expands the window to the whole screen. If it is unavailable we
   * degrade to the CSS page-fullscreen layout (state only, no OS change).
   */
  setFullscreen = (enabled: boolean) => {
    const doc = document;
    if (!enabled) {
      if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
      this.set({ fullscreen: false });
      return;
    }
    if (doc.fullscreenElement) { this.set({ fullscreen: true }); return; }
    const target = doc.querySelector<HTMLElement>('.theater-view') || doc.documentElement;
    const request = target.requestFullscreen?.();
    if (!request) { this.set({ fullscreen: true }); return; }
    void request.catch(() => this.set({ fullscreen: true }));
  };
  toggleFullscreen = () => this.setFullscreen(!this.snapshot.fullscreen);

  command = (action: CommandAction, value?: number) => {
    if (action === 'toggleFullscreen') { this.toggleFullscreen(); return; }
    const now = Date.now();
    if (!CONTINUOUS.has(action) && this.lastCommand && this.lastCommand.action === action && now - this.lastCommand.at < 140) return;
    this.lastCommand = { action, at: now };
    if (action === 'previous' || action === 'next') { this.queue?.[action](); return; }
    if (action === 'cycleMode') { this.queue?.cycleMode?.(); return; }
    const element = this.element;
    if (!element) {
      // Cross-origin embeds cannot be driven from this document. Keep the visual
      // play state meaningful for the tray/bubble while the platform player is used.
      if (action === 'playPause' && this.snapshot.embedded) this.set({ playing: !this.snapshot.playing });
      return;
    }
    switch (action) {
      case 'playPause':
        if (element.paused) void element.play().catch(() => {}); else element.pause();
        break;
      case 'seekBack': element.currentTime = Math.max(0, element.currentTime - 10); break;
      case 'seekForward':
        element.currentTime = Math.min(Number.isFinite(element.duration) ? element.duration : element.currentTime + 10, element.currentTime + 10);
        break;
      case 'seekTo':
        if (Number.isFinite(value)) element.currentTime = clamp(value!, 0, Number.isFinite(element.duration) ? element.duration : 0);
        break;
      case 'mute': element.muted = !element.muted; break;
      case 'volumeUp': element.volume = clamp(element.volume + 0.05, 0, 1); element.muted = false; break;
      case 'volumeDown': element.volume = clamp(element.volume - 0.05, 0, 1); break;
      case 'setVolume':
        if (Number.isFinite(value)) { element.volume = clamp(value!, 0, 1); element.muted = element.volume === 0; }
        break;
    }
    this.readElement();
  };

  /** Install DOM observation, local shortcuts and desktop IPC. Idempotent. */
  start() {
    if (this.started) return;
    this.started = true;
    const observer = new MutationObserver(() => this.syncDom());
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'hidden', 'class'] });
    document.addEventListener('fullscreenchange', () => this.set({ fullscreen: !!document.fullscreenElement }));
    // A ~8 Hz clock keeps the progress bar visually smooth; when the element is
    // still attached we only read it instead of re-scanning the whole document.
    window.setInterval(() => {
      if (this.scrubbing) return;
      if (this.element?.isConnected) this.readElement();
      else this.syncDom();
    }, 120);
    window.addEventListener('keydown', event => {
      if (document.querySelector('[data-capturing-shortcut]')) return;
      const target = event.target as HTMLElement | null;
      if (target && typeof target.closest === 'function' &&
        (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      for (const [action, accelerator] of Object.entries(this.shortcuts) as [CommandAction, string][]) {
        if (!accelerator || !acceleratorMatches(event, accelerator)) continue;
        event.preventDefault();
        event.stopPropagation();
        this.command(action);
        break;
      }
    }, true);
    this.installRemote();
    this.syncDom();
    this.publish();
  }
  private installRemote() {
    window.coplayDesktop?.onCommand?.(command => {
      const action = command?.action as CommandAction;
      if (typeof action === 'string' && /^[A-Za-z]{2,20}$/.test(action)) this.command(action, command.value);
    });
    window.coplayDesktop?.onFullscreenState?.(on => { this.set({ fullscreen: !!on }); });
  }
}

export const playback = new PlaybackBus();
export function usePlayback(): PlaybackSnapshot { return useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot); }
/** Only re-render when the boolean flips, not on every progress tick. */
export function useFullscreen(): boolean {
  return useSyncExternalStore(playback.subscribe, () => playback.getSnapshot().fullscreen, () => false);
}
export function playbackMeta(media: { id: string; title: string; subtitle: string; cover: string; platform: string; kind: string }): PlaybackMeta {
  return { id: media.id, title: media.title, subtitle: media.subtitle, cover: media.cover, platform: media.platform, kind: media.kind };
}
/** The active queue owner publishes its rule for the tray bubble and remote commands. */
export function usePlaybackMode(label: string, active = true) {
  useEffect(() => { if (active) playback.setMode(label); }, [label, active]);
}
/** Mount inside a player view so the tray/bubble knows what is playing. */
export function usePlaybackSource(meta: PlaybackMeta | null, owner: string, active = true) {
  useEffect(() => {
    playback.setSource(meta, owner, active);
    return () => playback.clearSource(owner);
  }, [meta?.id, meta?.title, meta?.cover, owner, active]);
}
/** Register the queue's previous/next/mode actions for shortcuts, tray and bubble. */
export function useQueueHandlers(previous: () => void, next: () => void, active = true, cycleMode?: () => void) {
  const previousRef = useRef(previous); previousRef.current = previous;
  const nextRef = useRef(next); nextRef.current = next;
  const cycleRef = useRef(cycleMode); cycleRef.current = cycleMode;
  useEffect(() => {
    if (!active) return;
    playback.setQueueHandlers({
      previous: () => previousRef.current(), next: () => nextRef.current(),
      cycleMode: () => cycleRef.current?.(),
    });
    return () => playback.setQueueHandlers(null);
  }, [active]);
}
