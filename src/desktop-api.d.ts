import type { PlaybackSnapshot, CommandAction } from './playback';
import type { ShortcutMap } from './shortcuts';

export interface DesktopCommand { action: CommandAction | string; value?: number }
export interface DesktopSettings {
  theme: 'light' | 'dark';
  shortcuts: ShortcutMap;
  minimizeToTray: boolean;
  showBubble: boolean;
  globalShortcuts: boolean;
  showLyrics: boolean;
}
export interface DownloadState {
  id: string; filename: string; received: number; total: number;
  state: 'progressing' | 'interrupted' | 'completed' | 'cancelled';
}
export interface DesktopLyricsPayload {
  enabled: boolean; mediaId: string; title: string; subtitle: string; source: string;
  lines: { time: number; text: string; translation: string }[];
}
export interface DesktopLyricsState { playback: PlaybackSnapshot; lyrics: DesktopLyricsPayload }

declare global {
  interface Window {
    coplayDesktop?: {
      version: string;
      onDownload: (listener: (state: DownloadState) => void) => () => void;
      publishPlayback?: (state: PlaybackSnapshot) => void;
      onCommand?: (listener: (command: DesktopCommand) => void) => () => void;
      setSettings?: (settings: DesktopSettings) => void;
      setTheme?: (theme: 'light' | 'dark') => void;
      setFullscreen?: (on: boolean) => void;
      onFullscreenState?: (listener: (on: boolean) => void) => () => void;
      onShortcutConflicts?: (listener: (conflicts: string[]) => void) => () => void;
      bubbleReady?: () => void;
      onBubbleState?: (listener: (state: PlaybackSnapshot) => void) => () => void;
      onBubbleTheme?: (listener: (theme: 'light' | 'dark') => void) => () => void;
      bubbleCommand?: (action: CommandAction, value?: number) => void;
      bubbleShowMain?: () => void;
      bubbleHide?: () => void;
      openTheater?: () => void;
      closeTheater?: () => void;
      onBubbleCommand?: (listener: (command: DesktopCommand) => void) => () => void;
      publishLyrics?: (payload: DesktopLyricsPayload) => void;
      onLyricsData?: (listener: (state: DesktopLyricsState) => void) => () => void;
      lyricsReady?: () => void;
      lyricsClose?: () => void;
      onLyricsDismissed?: (listener: () => void) => () => void;
      chooseDownloadFolder?: () => Promise<string | null>;
      clearDownloadFolder?: () => void;
    };
  }
}
