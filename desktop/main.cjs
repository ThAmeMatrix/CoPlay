const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { LOOPBACK_ORIGIN, CSP, appUrl, externalUrl, downloadUrl } = require('./security.cjs');

const smoke = process.argv.includes('--smoke-test');
const smokeOutput = process.argv.find(arg => arg.startsWith('--smoke-output='))?.slice('--smoke-output='.length);
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), `coplay-smoke-${process.pid}`));
app.setAppUserModelId('com.coplay.desktop');
let window; let service; let shuttingDown = false; let smokeFinished = false;
async function finishSmoke(result) {
  if (smokeFinished) return; smokeFinished = true;
  if (smokeOutput) await fs.writeFile(smokeOutput, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
  app.quit();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    const root = app.getAppPath();
    const { createApplication } = await import(pathToFileURL(path.join(root, 'server/app.js')).href);
    const { default: express } = await import('express');
    service = await createApplication({ dataDir: path.join(app.getPath('userData'), 'data') });
    service.app.use((_req, res, next) => { res.setHeader('Content-Security-Policy', CSP); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
    service.app.use(express.static(path.join(root, 'dist'), { setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); } }));
    service.app.get('/{*path}', (req, res) => req.path.startsWith('/api/') ? res.status(404).json({ error: '接口不存在' }) : res.sendFile(path.join(root, 'dist/index.html'), { headers: { 'Cache-Control': 'no-store' } }));
    await new Promise((resolve, reject) => { service.httpServer.once('error', reject); service.httpServer.listen(36743, '127.0.0.1', resolve); });

    window = new BrowserWindow({ width: 1440, height: 960, minWidth: 820, minHeight: 620, show: false,
      title: '共映 CoPlay', backgroundColor: '#f9faf4', icon: path.join(root, 'desktop/icon.ico'), autoHideMenuBar: true,
      webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false, safeDialogs: true, spellcheck: false },
    });
    const session = window.webContents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('will-navigate', event => { if (!appUrl(event.url)) event.preventDefault(); });
    window.webContents.on('will-redirect', event => { if (event.isMainFrame && !appUrl(event.url)) event.preventDefault(); });
    ipcMain.on('coplay:open-external', (event, value) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !appUrl(event.senderFrame.url) || typeof value !== 'string' || value.length > 4096) return;
      const url = externalUrl(value); if (url) void shell.openExternal(url);
    });
    const activeDownloads = new Set();
    session.on('will-download', (event, item, contents) => {
      if (contents !== window.webContents || !downloadUrl(item.getURL())) { event.preventDefault(); return; }
      activeDownloads.add(item);
      item.setSaveDialogOptions({ title: '保存视频到电脑', defaultPath: path.join(app.getPath('downloads'), item.getFilename()), properties: ['createDirectory', 'showOverwriteConfirmation'] });
      const update = state => {
        if (window.isDestroyed()) return;
        const received = item.getReceivedBytes(), total = item.getTotalBytes();
        window.webContents.send('coplay:download', { id: item.getURL(), filename: item.getFilename(), received, total, state });
        window.setProgressBar(state === 'progressing' && total ? received / total : -1);
      };
      item.on('updated', (_event, state) => update(state));
      item.once('done', (_event, state) => { activeDownloads.delete(item); update(state); });
    });
    window.on('close', event => {
      if (activeDownloads.size && !shuttingDown && !smoke) {
        const choice = dialog.showMessageBoxSync(window, { type: 'question', title: '视频正在下载', message: '关闭共映会中断当前下载。', buttons: ['继续下载', '关闭应用'], defaultId: 0, cancelId: 0 });
        if (choice === 0) { event.preventDefault(); return; }
      }
      for (const item of activeDownloads) item.cancel();
    });
    window.once('ready-to-show', () => { if (!smoke) window.show(); });
    if (smoke) {
      const errors = [];
      window.webContents.on('console-message', event => { if (event.level === 'error' && event.frame === window.webContents.mainFrame) errors.push(event.message); });
      window.webContents.once('did-fail-load', (_event, code, description) => void finishSmoke({ ok: false, code, description }));
      window.webContents.once('did-finish-load', async () => {
        try {
          const health = await (await fetch(`${LOOPBACK_ORIGIN}/api/health`)).json();
          const sources = await (await fetch(`${LOOPBACK_ORIGIN}/api/sources`)).json();
          const headers = await fetch(LOOPBACK_ORIGIN);
          const prefs = window.webContents.getLastWebPreferences();
          const result = { ok: health.ok && health.localOnly && !health.roomsEnabled && sources.some(s => s.id === 'qqmusic') && prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration && errors.length === 0, packaged: app.isPackaged, version: app.getVersion(), title: window.getTitle(), origin: LOOPBACK_ORIGIN, address: service.httpServer.address(), sourceCount: sources.length, contentSecurityPolicy: headers.headers.get('content-security-policy'), security: { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration }, errors };
          await finishSmoke(result);
        } catch (e) { await finishSmoke({ ok: false, error: e.message }); }
      });
      setTimeout(() => void finishSmoke({ ok: false, error: '桌面启动测试超时' }), 30000).unref();
    }
    await window.loadURL(LOOPBACK_ORIGIN);
  }).catch(async error => {
    if (smoke) { await finishSmoke({ ok: false, error: error.message }); return; }
    dialog.showErrorBox('共映未能启动', error.code === 'EADDRINUSE' ? '本机端口 36743 已被占用。请关闭另一个共映实例或占用该端口的应用后重试。' : error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (shuttingDown || !service) return;
    event.preventDefault(); shuttingDown = true;
    Promise.allSettled([service.sources.flush(), service.roomStore.flush(), service.downloadedLibrary.flush()]).finally(() => {
      service.io.close(); service.httpServer.closeAllConnections(); service.httpServer.close(); app.quit();
    });
  });
}
