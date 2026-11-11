import { useEffect, useState } from 'react';
import { Film } from 'lucide-react';
import TheaterView, { type TheaterSession } from './TheaterView';
import { normalizePlaybackMode } from './playback-queue';
import { applyTheme, toggleThemeMode, useSettings } from './settings';
import DesktopDownloads from './DesktopDownloads';
import type { Media } from './types';

/** Root of the independent theater BrowserWindow (?theater=1). */
export default function TheaterStandalone() {
  const [session, setSession] = useState<TheaterSession | null>(null);
  const [settings, patchSettings] = useSettings();
  useEffect(() => window.coplayDesktop?.onLyricsDismissed?.(() => patchSettings({ showLyrics: false })), [patchSettings]);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('coplay:theater-session-v1') || 'null');
      if (raw && Array.isArray(raw.items) && raw.items.length) {
        setSession({ title: String(raw.title || '播放列表'), items: raw.items as Media[], index: Math.max(0, Math.min(raw.items.length - 1, Number(raw.index) || 0)), mode: normalizePlaybackMode(raw.mode) });
      }
    } catch { /* no session */ }
    try { const s = JSON.parse(localStorage.getItem('coplay:settings-v1') || 'null'); applyTheme(s?.theme === 'system' ? 'system' : s?.theme === 'dark' ? 'dark' : 'light'); }
    catch { applyTheme('light'); }
    const off = window.coplayDesktop?.onBubbleTheme?.(next => applyTheme(next));
    return () => off?.();
  }, []);
  if (!session) return <div className="theater-view"><div className="theater-empty" style={{ margin: 'auto' }}><Film size={32} /><p>没有可播放的内容。请从共映主界面选择一个播放列表。</p></div></div>;
  return <><DesktopDownloads /><TheaterView session={session} onClose={() => window.coplayDesktop?.closeTheater?.()} onPlayed={() => {}} onModeChange={() => {}}
    lyricsEnabled={settings.showLyrics} onToggleLyrics={() => patchSettings({ showLyrics: !settings.showLyrics })}
    theme={settings.theme} onToggleTheme={() => patchSettings({ theme: toggleThemeMode(settings.theme) })} /></>;
}
