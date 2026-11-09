const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('coplayDesktop', Object.freeze({
  version: '1.6.0',
  onDownload: callback => on('coplay:download', callback),
  publishPlayback: state => ipcRenderer.send('coplay:playback-state', state),
  onCommand: callback => on('coplay:command', callback),
  setSettings: settings => ipcRenderer.send('coplay:settings', settings),
  setTheme: theme => ipcRenderer.send('coplay:theme', theme),
  onShortcutConflicts: callback => on('coplay:shortcut-conflicts', callback),
  setFullscreen: value => ipcRenderer.send('coplay:fullscreen', value === true),
  onFullscreenState: callback => on('coplay:fullscreen-state', callback),
  openTheater: () => ipcRenderer.send('coplay:open-theater'),
  closeTheater: () => ipcRenderer.send('coplay:close-theater'),
  onBubbleState: callback => on('coplay:bubble-state', callback),
  onBubbleTheme: callback => on('coplay:bubble-theme', callback),
  bubbleReady: () => ipcRenderer.send('coplay:bubble-ready'),
  bubbleCommand: (action, value) => ipcRenderer.send('coplay:bubble-command', { action, value }),
  bubbleShowMain: () => ipcRenderer.send('coplay:bubble-show-main'),
  bubbleHide: () => ipcRenderer.send('coplay:bubble-hide'),
  publishLyrics: payload => ipcRenderer.send('coplay:lyrics-data', payload),
  onLyricsData: callback => on('coplay:lyrics-state', callback),
  lyricsReady: () => ipcRenderer.send('coplay:lyrics-ready'),
  lyricsClose: () => ipcRenderer.send('coplay:lyrics-close'),
  onLyricsDismissed: callback => on('coplay:lyrics-dismissed', () => callback()),
  chooseDownloadFolder: () => ipcRenderer.invoke('coplay:choose-download-folder'),
  clearDownloadFolder: () => ipcRenderer.send('coplay:clear-download-folder'),
}));

// Only real clicks in the app's main frame can request the system browser.
window.addEventListener('click', event => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const anchor = event.target.closest('a[target="_blank"]');
  if (!anchor || !anchor.href) return;
  event.preventDefault();
  ipcRenderer.send('coplay:open-external', anchor.href);
}, true);
