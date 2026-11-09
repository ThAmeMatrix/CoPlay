import type { PlaybackSnapshot, CommandAction } from './playback';
import type { ShortcutMap } from './shortcuts';

export interface DesktopCommand { action: CommandAction | string; value?: number }
export interface DesktopSettings {
  theme: 'light' | 'dark';
  shortcuts: ShortcutMap;
  minimizeToTray: boolean;
  showBubble: boolean;
  globalShortcuts: boolean;
}
export interface DownloadState {
  id: string; filename: string; received: number; total: number;
  state: 'progressing' | 'interrupted' | 'completed' | 'cancelled';
}

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
    };
  }
}
