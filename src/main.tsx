import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './expanded.css';
import './features.css';
import './theme-dark.css';
import { applyTheme, readSettings } from './settings';
import { playback } from './playback';

// Apply the persisted theme before the first paint so dark mode does not flash white.
applyTheme(readSettings().theme);
const params = new URLSearchParams(location.search);
const isBubble = params.get('bubble') === '1';
const isTheater = params.get('theater') === '1';
const isLyrics = params.get('lyrics') === '1';
if (isBubble) document.documentElement.classList.add('bubble-root');
if (isLyrics) document.documentElement.classList.add('lyrics-root');

playback.setShortcuts(readSettings().shortcuts);
// The tray bubble and desktop lyrics window are read-only mirrors.
if (!isBubble && !isLyrics) playback.start();

async function mount() {
  let Component: React.ComponentType;
  if (isBubble) Component = (await import('./Bubble')).default;
  else if (isTheater) Component = (await import('./TheaterStandalone')).default;
  else if (isLyrics) Component = (await import('./LyricsView')).LyricsWindow;
  else Component = (await import('./App')).default;
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Component /></React.StrictMode>);
}
void mount();
