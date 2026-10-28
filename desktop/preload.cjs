const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('coplayDesktop', Object.freeze({
  version: '1.4.2',
  onDownload: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('coplay:download', listener);
    return () => ipcRenderer.removeListener('coplay:download', listener);
  },
}));
// Only real clicks in the app's main frame can request the system browser.
window.addEventListener('click', event => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const anchor = event.target.closest('a[target="_blank"]');
  if (!anchor || !anchor.href) return;
  event.preventDefault();
  ipcRenderer.send('coplay:open-external', anchor.href);
}, true);
