const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const express = require('express');
const security = require('../desktop/security.cjs');
const root = path.resolve(__dirname, '..');
app.setAppPath(root);

const SLOW_SIZE = 16 * 1024 * 1024;
const originalDownloadUrl = security.downloadUrl;
security.downloadUrl = value => originalDownloadUrl(value) || (() => {
  try { const u = new URL(value); return security.appUrl(value) && u.pathname === '/slow.bin'; } catch { return false; }
})();
// A never-ending response stands in for a real B 站 download stream, served
// from the app's own origin so the download allowlist accepts it.
const originalStatic = express.static;
express.static = function (dir, options) {
  const middleware = originalStatic(dir, options);
  return function (req, res, next) {
    if (req.path === '/slow.bin') {
      res.set('Content-Type', 'video/mp4');
      res.set('Content-Disposition', 'attachment; filename="slow.mp4"');
      res.set('Content-Length', String(SLOW_SIZE));
      let sent = 0;
      const chunk = Buffer.alloc(16 * 1024);
      const tick = () => {
        if (res.destroyed || res.writableEnded) return;
        res.write(chunk); sent += chunk.length;
        if (sent < SLOW_SIZE) setTimeout(tick, 10); else res.end();
      };
      tick();
      return;
    }
    return middleware(req, res, next);
  };
};
const errors = [];
const originalErrorBox = dialog.showErrorBox;
dialog.showErrorBox = (title, content) => { errors.push(`dialog: ${title} ${content}`); void originalErrorBox; };
// Confirm "关闭应用" instead of blocking on a native modal.
dialog.showMessageBoxSync = () => 1;
process.on('uncaughtException', error => errors.push(`uncaught: ${error.message}`));
process.on('unhandledRejection', error => errors.push(`unhandled: ${error && error.message || error}`));
require('../desktop/main.cjs');

// Keep the process alive long enough to observe shutdown-time exceptions.
const realQuit = app.quit.bind(app);
let scheduled = false;
app.quit = function () {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => realQuit(), 2500);
};
const delay = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  await delay(4200);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) throw new Error('no main window');
  win.webContents.on('console-message', detail => { if (detail.level === 'error') errors.push(`renderer: ${detail.message}`); });
  let received = 0, done = '';
  win.webContents.session.on('will-download', (_event, item) => {
    item.on('updated', (_e, state) => { if (state === 'progressing') received = item.getReceivedBytes(); });
    item.once('done', (_e, state) => { done = state; });
  });
  win.webContents.downloadURL('http://127.0.0.1:36743/slow.bin');
  await delay(1300);
  if (!(received > 0)) throw new Error('download never started');
  win.close();
  await delay(2000);
  if (!done) throw new Error('download was not cancelled cleanly');
  // Filter out Chromium's benign "download cancelled" network log if present.
  const fatal = errors.filter(message => !/ERR_ABORTED|net::ERR|download/i.test(message));
  console.log(JSON.stringify({ ok: fatal.length === 0, received, done, errors }, null, 2));
  app.exit(fatal.length === 0 ? 0 : 1);
}).catch(error => { console.error(error.stack); app.exit(1); });
