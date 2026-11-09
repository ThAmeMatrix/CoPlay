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
if (isBubble) document.documentElement.classList.add('bubble-root');

playback.setShortcuts(readSettings().shortcuts);
// The tray bubble is a read-only mirror; only player windows install the observer.
if (!isBubble) playback.start();

async function mount() {
  let Component: React.ComponentType;
  if (isBubble) Component = (await import('./Bubble')).default;
  else if (isTheater) Component = (await import('./TheaterStandalone')).default;
  else Component = (await import('./App')).default;
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Component /></React.StrictMode>);
}
void mount();
