import { useCallback, useEffect, useMemo } from 'react';
import { usePersistent } from './hooks';
import { defaultShortcuts, normalizeShortcuts, type ShortcutMap } from './shortcuts';
import { playback } from './playback';

export type ThemeMode = 'light' | 'dark' | 'system';
export interface Settings {
  theme: ThemeMode;
  shortcuts: ShortcutMap;
  /** Hide to the tray instead of quitting when the window is closed during playback. */
  minimizeToTray: boolean;
  /** Show the always-on-top mini player bubble. */
  showBubble: boolean;
  /** Register OS-wide hotkeys in the desktop app. */
  globalShortcuts: boolean;
  /** Show a floating desktop lyrics window while lyrics are available. */
  showLyrics: boolean;
  /** Desktop download destination. Empty means the system Downloads folder. */
  downloadDir: string;
}
export const defaultSettings: Settings = {
  theme: 'light', shortcuts: defaultShortcuts, minimizeToTray: true, showBubble: true, globalShortcuts: true, showLyrics: false, downloadDir: '',
};

export function normalizeSettings(value: unknown): Settings {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  return {
    theme: ['light', 'dark', 'system'].includes(source.theme as string) ? source.theme as ThemeMode : 'light',
    shortcuts: normalizeShortcuts(source.shortcuts),
    minimizeToTray: source.minimizeToTray !== false,
    showBubble: source.showBubble !== false,
    globalShortcuts: source.globalShortcuts !== false,
    showLyrics: source.showLyrics === true,
    downloadDir: typeof source.downloadDir === 'string' && source.downloadDir.length <= 260 ? source.downloadDir : '',
  };
}

export function readSettings(): Settings {
  try { return normalizeSettings(JSON.parse(localStorage.getItem('coplay:settings-v1') || 'null')); }
  catch { return defaultSettings; }
}

export function resolvedTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return theme;
}

/** Flip the visible day/night appearance; "跟随系统" becomes an explicit choice. */
export function toggleThemeMode(theme: ThemeMode): ThemeMode {
  return resolvedTheme(theme) === 'dark' ? 'light' : 'dark';
}

export function applyTheme(theme: ThemeMode) {
  const resolved = resolvedTheme(theme);
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#12161b' : '#f7f8fa');
  return resolved;
}

/** Owned by App: persists settings, applies the theme and syncs desktop services. */
export function useSettings() {
  const [stored, setStored] = usePersistent<Settings>('settings-v1', defaultSettings);
  // Stable identity: the sync effect must not re-send IPC on every render.
  const settings = useMemo(() => normalizeSettings(stored), [stored]);
  const patch = useCallback((change: Partial<Settings>) => setStored(current => ({ ...normalizeSettings(current), ...change })), [setStored]);
  useEffect(() => {
    applyTheme(settings.theme);
    playback.setShortcuts(settings.shortcuts);
    if (window.coplayDesktop?.setSettings) window.coplayDesktop.setSettings({ ...settings, theme: applyTheme(settings.theme) });
  }, [settings]);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => { if (settings.theme === 'system') window.coplayDesktop?.setTheme?.(applyTheme('system')); };
    media?.addEventListener?.('change', onChange);
    return () => media?.removeEventListener?.('change', onChange);
  }, [settings.theme]);
  return [settings, patch] as const;
}
