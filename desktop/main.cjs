const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage, globalShortcut, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { pathToFileURL } = require('node:url');
const { LOOPBACK_ORIGIN, CSP, appUrl, externalUrl, downloadUrl } = require('./security.cjs');
const shortcutSpec = require('../shared/shortcuts.json');

const smoke = process.argv.includes('--smoke-test');
const smokeOutput = process.argv.find(arg => arg.startsWith('--smoke-output='))?.slice('--smoke-output='.length);
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), `coplay-smoke-${process.pid}`));
app.setAppUserModelId('com.coplay.desktop');

let window; let service; let shuttingDown = false; let smokeFinished = false;
let tray; let bubble; let theater; let forceQuit = false; let bubbleForced = false; let bubbleDismissed = false;
const acceleratorRe = new RegExp(shortcutSpec.accelerator);
const ACTIONS = shortcutSpec.actions.map(action => action.id);
const defaults = { theme: 'light', minimizeToTray: true, showBubble: true, globalShortcuts: true, showLyrics: false, downloadDir: '', shortcuts: Object.fromEntries(shortcutSpec.actions.map(action => [action.id, action.default])) };
let settings = { ...defaults };
let playbackState = emptyPlayback();
let registered = [];
let lyricsWindow;
let lyricsDismissed = false;
let lyricsPayload = emptyLyrics();
// Downloads go to a single, persisted destination chosen in Preferences.
// No native save dialog is shown for individual or batch downloads.
let savedDownloadDir = '';
function downloadPrefsFile() { return path.join(app.getPath('userData'), 'download-dir.json'); }
async function loadDownloadDir() {
  try {
    const raw = JSON.parse(await fs.readFile(downloadPrefsFile(), 'utf8'));
    if (typeof raw.dir === 'string' && path.isAbsolute(raw.dir) && raw.dir.length <= 260) savedDownloadDir = raw.dir;
  } catch { /* first run */ }
}
async function storeDownloadDir(dir) {
  savedDownloadDir = dir || '';
  try { await fs.writeFile(downloadPrefsFile(), JSON.stringify({ dir: savedDownloadDir })); } catch { /* read-only profile */ }
}
function downloadFolder() {
  const chosen = settings.downloadDir || savedDownloadDir || app.getPath('downloads');
  try { fsSync.mkdirSync(chosen, { recursive: true }); } catch { /* fall back below */ }
  return fsSync.existsSync(chosen) ? chosen : app.getPath('downloads');
}

function emptyPlayback() {
  return { active: false, meta: null, playing: false, currentTime: 0, duration: 0, volume: 1, muted: false, controllable: false, embedded: false, mode: '列表播放', fullscreen: false };
}
function emptyLyrics() {
  return { enabled: false, mediaId: '', title: '', subtitle: '', source: '', lines: [] };
}
function boundedString(value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function boundedNumber(value, max) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0; }
/** Playback snapshots cross into the tray window; keep them small and inert. */
function sanitizePlayback(value) {
  if (!value || typeof value !== 'object') return emptyPlayback();
  const meta = value.meta && typeof value.meta === 'object' ? value.meta : null;
  const cover = boundedString(meta?.cover, 2048);
  return {
    active: value.active === true,
    meta: meta ? {
      id: boundedString(meta.id, 128), title: boundedString(meta.title, 200), subtitle: boundedString(meta.subtitle, 200),
      cover: /^(https?:\/\/|data:image\/|\/)/i.test(cover) ? cover : '',
      platform: boundedString(meta.platform, 80), kind: boundedString(meta.kind, 40),
    } : null,
    playing: value.playing === true,
    currentTime: boundedNumber(value.currentTime, 86400), duration: boundedNumber(value.duration, 86400),
    volume: boundedNumber(value.volume, 1), muted: value.muted === true,
    controllable: value.controllable === true, embedded: value.embedded === true,
    mode: boundedString(value.mode, 40) || '列表播放',
    fullscreen: value.fullscreen === true,
  };
}
function sanitizeSettings(value) {
  if (!value || typeof value !== 'object') return defaults;
  const shortcuts = { ...defaults.shortcuts };
  const source = value.shortcuts && typeof value.shortcuts === 'object' ? value.shortcuts : {};
  for (const action of ACTIONS) {
    const candidate = source[action];
    if (typeof candidate === 'string' && candidate.length <= 64 && (candidate === '' || acceleratorRe.test(candidate))) shortcuts[action] = candidate;
  }
  return {
    theme: value.theme === 'dark' ? 'dark' : 'light',
    minimizeToTray: value.minimizeToTray !== false,
    showBubble: value.showBubble !== false,
    globalShortcuts: value.globalShortcuts !== false,
    showLyrics: value.showLyrics === true,
    downloadDir: typeof value.downloadDir === 'string' && value.downloadDir.length <= 260 && path.isAbsolute(value.downloadDir) ? value.downloadDir : '',
    shortcuts,
  };
}
/** Lyrics cross into a separate always-on-top window; keep them plain data. */
function sanitizeLyrics(value) {
  if (!value || typeof value !== 'object') return emptyLyrics();
  const lines = Array.isArray(value.lines) ? value.lines.slice(0, 1000) : [];
  return {
    enabled: value.enabled === true,
    mediaId: boundedString(value.mediaId, 128), title: boundedString(value.title, 200),
    subtitle: boundedString(value.subtitle, 200), source: boundedString(value.source, 60),
    lines: lines.map(line => ({
      time: boundedNumber(line?.time, 86400), text: boundedString(line?.text, 300),
      translation: boundedString(line?.translation, 300),
    })).filter(line => line.text || line.translation),
  };
}

async function finishSmoke(result) {
  if (smokeFinished) return; smokeFinished = true;
  if (smokeOutput) await fs.writeFile(smokeOutput, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
  app.quit();
}

function playerWindow() { return theater && !theater.isDestroyed() ? theater : window && !window.isDestroyed() ? window : null; }
function sendCommand(action, value) {
  const target = playerWindow();
  if (target && !target.isDestroyed()) target.webContents.send('coplay:command', { action, value });
}
function validSender(event, expected) {
  if (!expected || expected.isDestroyed() || event.sender !== expected.webContents) return false;
  if (event.senderFrame !== expected.webContents.mainFrame) return false;
  return appUrl(event.senderFrame.url);
}

/** OS-wide hotkeys. Rebuilt whenever the user edits bindings. */
function registerShortcuts() {
  globalShortcut.unregisterAll();
  registered = [];
  if (smoke || !settings.globalShortcuts) return [];
  const conflicts = [];
  for (const action of ACTIONS) {
    const accelerator = settings.shortcuts[action];
    if (!accelerator) continue;
    try {
      if (globalShortcut.register(accelerator, () => sendCommand(action))) registered.push(accelerator);
      else conflicts.push(accelerator);
    } catch { conflicts.push(accelerator); }
  }
  if (window && !window.isDestroyed()) window.webContents.send('coplay:shortcut-conflicts', conflicts);
  return conflicts;
}

function bubbleOrigin() { return `${LOOPBACK_ORIGIN}/?bubble=1`; }
function theaterOrigin() { return `${LOOPBACK_ORIGIN}/?theater=1`; }
function lyricsOrigin() { return `${LOOPBACK_ORIGIN}/?lyrics=1`; }

function createAuxWindow(url, width, height) {
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width, height, show: false, frame: false, resizable: false, movable: true,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: true, fullscreenable: false,
    backgroundColor: settings.theme === 'dark' ? '#181c20' : '#ffffff',
    x: Math.max(area.x, area.x + area.width - width - 18),
    y: Math.max(area.y, area.y + area.height - height - 18),
    webPreferences: { preload: path.join(app.getAppPath(), 'desktop/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false, safeDialogs: true, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => { if (!appUrl(event.url)) event.preventDefault(); });
  win.webContents.on('will-redirect', event => { if (event.isMainFrame && !appUrl(event.url)) event.preventDefault(); });
  void win.loadURL(url);
  return win;
}
function ensureBubble() {
  if (bubble && !bubble.isDestroyed()) return bubble;
  bubble = createAuxWindow(bubbleOrigin(), 360, 168);
  // The renderer cannot receive IPC until it has loaded; replay the latest state then.
  bubble.webContents.once('did-finish-load', () => {
    if (bubble && !bubble.isDestroyed()) {
      pushBubbleState();
      bubble.webContents.send('coplay:bubble-theme', settings.theme);
    }
  });
  bubble.once('ready-to-show', () => { if (bubble && !bubble.isDestroyed() && shouldShowBubble()) bubble.showInactive(); });
  bubble.on('closed', () => { bubble = undefined; });
  return bubble;
}
function shouldShowBubble() {
  return !smoke && !forceQuit && !shuttingDown && settings.showBubble && !bubbleDismissed && playbackState.active &&
    (bubbleForced || !window || window.isDestroyed() || !window.isVisible());
}
function pushBubbleState() {
  if (bubble && !bubble.isDestroyed()) bubble.webContents.send('coplay:bubble-state', { ...playbackState, shortcuts: settings.shortcuts });
}
function updateBubble() {
  if (smoke) return;
  if (!shouldShowBubble()) {
    if (bubble && !bubble.isDestroyed()) bubble.hide();
    return;
  }
  const win = ensureBubble();
  pushBubbleState();
  if (!win.isVisible()) win.showInactive();
}
function broadcastTheme(theme) {
  for (const win of [bubble, theater, lyricsWindow]) if (win && !win.isDestroyed()) win.webContents.send('coplay:bubble-theme', theme);
}

function shouldShowLyrics() {
  return !smoke && !forceQuit && !shuttingDown && settings.showLyrics && !lyricsDismissed &&
    lyricsPayload.enabled && lyricsPayload.lines.length > 0 && playbackState.active;
}
function pushLyricsState() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.webContents.send('coplay:lyrics-state', { playback: playbackState, lyrics: lyricsPayload });
    lyricsWindow.webContents.send('coplay:bubble-theme', settings.theme);
  }
}
function ensureLyricsWindow() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) return lyricsWindow;
  const width = 560, height = 230;
  lyricsWindow = createAuxWindow(lyricsOrigin(), width, height);
  const area = screen.getPrimaryDisplay().workArea;
  lyricsWindow.setBounds({ x: Math.max(area.x, area.x + Math.round((area.width - width) / 2)), y: Math.max(area.y, area.y + area.height - height - 90), width, height });
  lyricsWindow.setAlwaysOnTop(true, 'floating');
  // The renderer asks for a replay once its listeners are installed.
  lyricsWindow.webContents.once('did-finish-load', () => { if (lyricsWindow && !lyricsWindow.isDestroyed()) pushLyricsState(); });
  lyricsWindow.once('ready-to-show', () => { if (lyricsWindow && !lyricsWindow.isDestroyed() && shouldShowLyrics()) lyricsWindow.showInactive(); });
  lyricsWindow.on('closed', () => { lyricsWindow = undefined; });
  return lyricsWindow;
}
function updateLyricsWindow() {
  if (smoke) return;
  if (!shouldShowLyrics()) {
    if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.hide();
    return;
  }
  const win = ensureLyricsWindow();
  pushLyricsState();
  if (!win.isVisible()) win.showInactive();
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const title = playbackState.active && playbackState.meta?.title ? playbackState.meta.title : '共映 CoPlay';
  tray.setToolTip(`${playbackState.playing ? '正在播放' : '共映'} · ${title}`.slice(0, 120));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: showMain },
    { type: 'separator' },
    { label: '播放 / 暂停', click: () => sendCommand('playPause') },
    { label: '上一项', click: () => sendCommand('previous') },
    { label: '下一项', click: () => sendCommand('next') },
    { label: '后退 10 秒', click: () => sendCommand('seekBack') },
    { label: '快进 10 秒', click: () => sendCommand('seekForward') },
    { type: 'separator' },
    { label: '显示悬浮气泡', type: 'checkbox', checked: settings.showBubble, click: item => { settings.showBubble = item.checked; bubbleForced = item.checked; bubbleDismissed = false; updateBubble(); } },
    { label: '显示桌面歌词', type: 'checkbox', checked: settings.showLyrics, click: item => { settings.showLyrics = item.checked; lyricsDismissed = false; updateLyricsWindow(); } },
    { label: '缩到任务栏', type: 'checkbox', checked: settings.minimizeToTray, click: item => { settings.minimizeToTray = item.checked; } },
    { type: 'separator' },
    { label: '退出共映', click: () => { forceQuit = true; app.quit(); } },
  ]));
}
function showMain() {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    bubbleForced = false; bubbleDismissed = false;
    updateBubble();
  }
}
function setupTray() {
  if (smoke || tray) return;
  try {
    const image = nativeImage.createFromPath(path.join(app.getAppPath(), 'desktop/icon.png'));
    tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(path.join(app.getAppPath(), 'desktop/icon.ico')) : image.resize({ width: 16, height: 16 }));
    tray.on('click', showMain);
    tray.on('double-click', showMain);
    refreshTray();
  } catch (error) { console.warn('[tray] unavailable:', error.message); tray = undefined; }
}

function openTheaterWindow() {
  if (smoke) return;
  if (theater && !theater.isDestroyed()) { theater.show(); theater.focus(); return; }
  theater = createAuxWindow(theaterOrigin(), 1280, 800);
  theater.setResizable(true);
  theater.setSkipTaskbar(false);
  theater.setAlwaysOnTop(false);
  const bound = theater;
  theater.on('enter-full-screen', () => { if (!bound.isDestroyed()) bound.webContents.send('coplay:fullscreen-state', true); });
  theater.on('leave-full-screen', () => { if (!bound.isDestroyed()) bound.webContents.send('coplay:fullscreen-state', false); });
  theater.once('ready-to-show', () => { if (theater && !theater.isDestroyed()) theater.show(); });
  theater.on('closed', () => { theater = undefined; updateBubble(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { showMain(); if (window && !window.isDestroyed()) window.focus(); });
  app.whenReady().then(async () => {
    await loadDownloadDir();
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
      if (!validSender(event, window) || typeof value !== 'string' || value.length > 4096) return;
      const url = externalUrl(value); if (url) void shell.openExternal(url);
    });
    ipcMain.on('coplay:settings', (event, value) => {
      if (!validSender(event, window) && !validSender(event, theater)) return;
      const previous = settings;
      settings = sanitizeSettings(value);
      // Re-enabling the bubble in settings is an explicit request to show it again.
      if (!previous.showBubble && settings.showBubble) bubbleDismissed = false;
      if (!previous.showLyrics && settings.showLyrics) lyricsDismissed = false;
      if (window && !window.isDestroyed()) window.setBackgroundColor(settings.theme === 'dark' ? '#12161b' : '#f9faf4');
      registerShortcuts();
      setupTray(); refreshTray(); updateBubble(); updateLyricsWindow(); pushLyricsState(); broadcastTheme(settings.theme);
    });
    ipcMain.on('coplay:theme', (event, value) => {
      if (!validSender(event, window)) return;
      const theme = value === 'dark' ? 'dark' : 'light';
      settings.theme = theme;
      broadcastTheme(theme);
      for (const win of [bubble, theater]) if (win && !win.isDestroyed()) win.setBackgroundColor(theme === 'dark' ? '#181c20' : '#ffffff');
    });
    ipcMain.on('coplay:playback-state', (event, value) => {
      if (!validSender(event, window) && !validSender(event, theater)) return;
      playbackState = sanitizePlayback(value);
      pushBubbleState(); refreshTray(); updateBubble(); updateLyricsWindow(); pushLyricsState();
    });
    ipcMain.on('coplay:lyrics-data', (event, value) => {
      if (!validSender(event, window) && !validSender(event, theater)) return;
      lyricsPayload = sanitizeLyrics(value);
      updateLyricsWindow(); pushLyricsState();
    });
    ipcMain.on('coplay:lyrics-ready', event => {
      if (!validSender(event, lyricsWindow)) return;
      pushLyricsState();
    });
    ipcMain.on('coplay:lyrics-close', event => {
      if (!validSender(event, lyricsWindow)) return;
      lyricsDismissed = true;
      if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.hide();
      if (window && !window.isDestroyed()) window.webContents.send('coplay:lyrics-dismissed');
      if (theater && !theater.isDestroyed()) theater.webContents.send('coplay:lyrics-dismissed');
      refreshTray();
    });
    ipcMain.on('coplay:bubble-command', (event, value) => {
      if (!validSender(event, bubble) || !value || typeof value !== 'object') return;
      const action = boundedString(value.action, 24);
      if (!ACTIONS.includes(action) && !['seekTo', 'setVolume', 'toggleFullscreen', 'cycleMode'].includes(action)) return;
      sendCommand(action, boundedNumber(value.value, 86400));
    });
    ipcMain.on('coplay:bubble-ready', event => {
      if (!validSender(event, bubble)) return;
      pushBubbleState();
      bubble.webContents.send('coplay:bubble-theme', settings.theme);
    });
    ipcMain.on('coplay:bubble-show-main', event => { if (validSender(event, bubble)) showMain(); });
    ipcMain.on('coplay:bubble-hide', event => {
      if (!validSender(event, bubble)) return;
      bubbleForced = false; bubbleDismissed = true;
      if (bubble && !bubble.isDestroyed()) bubble.hide();
    });
    ipcMain.on('coplay:fullscreen', (event, value) => {
      if (!validSender(event, window) && !validSender(event, theater)) return;
      const target = validSender(event, theater) ? theater : window;
      const on = value === true;
      // Windows fullscreen transitions are expensive; ignore redundant toggles
      // so double clicks / repeated shortcut presses cannot make the UI stutter.
      if (target.isFullScreen() === on) return;
      // enter-full-screen / leave-full-screen report the authoritative state.
      target.setFullScreen(on);
    });
    ipcMain.on('coplay:open-theater', event => { if (validSender(event, window)) openTheaterWindow(); });
    ipcMain.on('coplay:close-theater', event => {
      if (!validSender(event, theater)) return;
      if (theater && !theater.isDestroyed()) theater.close();
    });
    const activeDownloads = new Set();
    function uniqueSavePath(folder, filename) {
      const base = path.basename(String(filename || 'video.mp4')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'video.mp4';
      let candidate = path.join(folder, base);
      if (!fsSync.existsSync(candidate)) return candidate;
      const dot = base.lastIndexOf('.'), stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
      for (let index = 2; index < 100; index++) {
        candidate = path.join(folder, `${stem} (${index})${ext}`);
        if (!fsSync.existsSync(candidate)) return candidate;
      }
      return path.join(folder, `${stem}-${Date.now()}${ext}`);
    }
    session.on('will-download', (event, item, contents) => {
      const fromMain = contents === window.webContents;
      const fromTheater = !!theater && !theater.isDestroyed() && contents === theater.webContents;
      if ((!fromMain && !fromTheater) || !downloadUrl(item.getURL())) { event.preventDefault(); return; }
      activeDownloads.add(item);
      // Every download goes to the directory chosen in Preferences — no save dialog.
      item.setSavePath(uniqueSavePath(downloadFolder(), item.getFilename()));
      const update = state => {
        const received = item.getReceivedBytes(), total = item.getTotalBytes();
        const payload = { id: item.getURL(), filename: item.getFilename(), received, total, state };
        for (const win of [window, theater]) if (win && !win.isDestroyed()) win.webContents.send('coplay:download', payload);
        if (!window.isDestroyed()) window.setProgressBar(state === 'progressing' && total ? received / total : -1);
      };
      item.on('updated', (_event, state) => update(state));
      item.once('done', (_event, state) => { activeDownloads.delete(item); update(state); });
    });
    // Called once from Preferences, never from the download flow.
    ipcMain.handle('coplay:choose-download-folder', async event => {
      if (!validSender(event, window) && !validSender(event, theater)) return null;
      const result = await dialog.showOpenDialog(window, {
        title: '选择下载保存位置', defaultPath: settings.downloadDir || savedDownloadDir || app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) return null;
      const dir = result.filePaths[0];
      await storeDownloadDir(dir);
      settings.downloadDir = dir;
      return dir;
    });
    window.on('close', event => {
      if (!forceQuit && !shuttingDown && !smoke && settings.minimizeToTray && playbackState.active) {
        event.preventDefault();
        window.hide();
        updateBubble();
        return;
      }
      if (activeDownloads.size && !shuttingDown && !smoke) {
        const choice = dialog.showMessageBoxSync(window, { type: 'question', title: '视频正在下载', message: '关闭共映会中断当前下载。', buttons: ['继续下载', '关闭应用'], defaultId: 0, cancelId: 0 });
        if (choice === 0) { event.preventDefault(); return; }
      }
      for (const item of activeDownloads) item.cancel();
      // Not hidden to the tray: close the whole app instead of leaving a stray tray icon.
      forceQuit = true;
    });
    window.on('closed', () => {
      if (bubble && !bubble.isDestroyed()) bubble.destroy();
      if (theater && !theater.isDestroyed()) theater.destroy();
      if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.destroy();
      if (tray && !tray.isDestroyed()) tray.destroy();
      globalShortcut.unregisterAll();
    });
    window.on('enter-full-screen', () => window.webContents.send('coplay:fullscreen-state', true));
    window.on('leave-full-screen', () => window.webContents.send('coplay:fullscreen-state', false));
    window.once('ready-to-show', () => { if (!smoke) window.show(); });
    if (!smoke) { setupTray(); registerShortcuts(); }
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
  app.on('window-all-closed', () => { if (forceQuit || smoke || !tray) app.quit(); });
  app.on('before-quit', event => {
    forceQuit = true;
    if (shuttingDown || !service) return;
    event.preventDefault(); shuttingDown = true;
    globalShortcut.unregisterAll();
    Promise.allSettled([service.sources.flush(), service.roomStore.flush(), service.downloadedLibrary.flush()]).finally(() => {
      service.io.close(); service.httpServer.closeAllConnections(); service.httpServer.close(); app.quit();
    });
  });
}
