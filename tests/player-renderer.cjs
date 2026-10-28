// Run the built application in an isolated, hidden Electron renderer. These
// tests own their profile and loopback server; no user's browser is inspected.
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration(); // Stable offscreen capture on Windows test hosts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { CSP } = require('../desktop/security.cjs');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coplay-renderer-test-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const live = process.argv.find(v => v.startsWith('--live='))?.slice(7);
if (live && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(live)) throw new Error('The renderer test only accepts a loopback origin');
const bvid = process.argv.find(v => v.startsWith('--bvid='))?.slice(7) || 'BV1B7411m7LV';
if (!/^BV[a-zA-Z0-9]{10}$/.test(bvid)) throw new Error('Invalid test identifier');
let server, window;
const results = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pageWait = `async function waitFor(check, label, timeout = 20000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(label + ': ' + document.querySelector('.detail-player')?.textContent); await new Promise(resolve => setTimeout(resolve, 50)); }
}`;
async function open(origin) {
  window = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.setAudioMuted(true);
  if (!live) window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: new URL(details.url).origin !== origin }));
  await window.loadURL(origin + '/?test=player');
  await window.webContents.executeJavaScript(`(async () => {
    ${pageWait}
    await waitFor(() => document.querySelector('#direct-resource'), 'link input');
    const input = document.querySelector('#direct-resource');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(bvid)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => !input.form.querySelector('button').disabled, 'submit enabled');
    input.form.requestSubmit();
    await waitFor(() => document.querySelector('.detail-buttons button'), 'detail dialog');
    const play = [...document.querySelectorAll('.detail-buttons button')].find(button => button.textContent.includes('立即播放'));
    if (!play) throw new Error('Play button missing');
    play.click();
  })()`, true);
}
async function errorState() {
  return window.webContents.executeJavaScript(`(async () => {
    ${pageWait}
    await waitFor(() => document.querySelector('.bili-player-status[role="alert"]'), 'visible playback error');
    return { error: document.querySelector('.bili-player-status').textContent, iframes: document.querySelectorAll('.detail-player iframe').length, source: document.querySelector('.bili-player-toolbar a')?.href };
  })()`);
}
app.whenReady().then(async () => {
  if (live) {
    await open(live);
    const result = await window.webContents.executeJavaScript(`(async () => {
      ${pageWait}
      await waitFor(() => document.querySelector('.detail-player video')?.videoWidth > 0, 'decoded video');
      const video = document.querySelector('.detail-player video');
      const sample = () => ({ currentTime: video.currentTime, width: video.videoWidth, height: video.videoHeight, frames: video.getVideoPlaybackQuality().totalVideoFrames, audioBytes: video.webkitAudioDecodedByteCount, error: video.error?.message });
      await video.play(); const first = sample();
      await new Promise(resolve => setTimeout(resolve, 1500)); const playing = sample();
      video.currentTime = Math.min(30, video.duration / 2);
      await waitFor(() => !video.seeking && video.currentTime > 0, 'seek');
      const seek = sample(); video.pause();
      return { first, playing, seek, iframes: document.querySelectorAll('.detail-player iframe').length };
    })()`, true);
    assert.equal(result.iframes, 0);
    assert.ok(result.playing.currentTime > result.first.currentTime);
    assert.ok(result.playing.frames > result.first.frames);
    assert.ok(result.playing.audioBytes > 0);
    assert.ok(!result.playing.error && !result.seek.error);
    results.push({ name: 'live video, audio decoding and seeking', bvid, ...result });
    fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
    fs.writeFileSync(path.join(root, '.qa', `player-live-${bvid}.png`), (await window.webContents.capturePage()).toPNG());
  } else {
    let scenario = 'error'; let prepares = 0;
    const api = express(); api.use(express.json());
    api.get('/api/sources', (_req, res) => res.json([]));
    api.get('/api/catalog-cache', (_req, res) => res.json({ pages: 0, bytes: 0, updatedAt: 0 }));
    api.get('/api/resources/:id/comments', (_req, res) => res.json([]));
    api.post('/api/import', (_req, res) => res.json({ resource: { id: 'bili-' + bvid, title: '播放回归测试', subtitle: '测试数据', kind: '视频', platform: '哔哩哔哩', cover: '', tags: [], description: '', duration: '1:00', url: `https://www.bilibili.com/video/${bvid}/`, playbackType: 'embed', playbackUrl: scenario === 'episode' ? 'https://player.bilibili.com/player.html?episodeId=12345&autoplay=0' : `https://player.bilibili.com/player.html?bvid=${bvid}&p=2&autoplay=0` }, warning: '' }));
    api.post('/api/playback/bilibili', (req, res) => { prepares++; assert.equal(req.body.page, 2); scenario === 'invalid' ? res.json({}) : res.status(400).json({ error: '测试：来源连接暂时中断，请重试' }); });
    api.use((_req, res, next) => { res.set('Content-Security-Policy', CSP); next(); });
    api.use(express.static(path.join(root, 'dist')));
    server = api.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await open(origin);
    const failed = await errorState(); assert.match(failed.error, /来源连接暂时中断/); assert.equal(failed.iframes, 0);
    const before = prepares;
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="重新加载 B 站视频"]').click()`);
    for (let count = 0; prepares === before && count < 100; count++) await delay(25);
    assert.equal(prepares, before + 1); assert.equal((await errorState()).iframes, 0);
    results.push({ name: 'API error stays visible; retry does not load official iframe', ok: true }); window.destroy();
    scenario = 'invalid'; await open(origin);
    const invalid = await errorState(); assert.match(invalid.error, /有效地址/); assert.equal(invalid.iframes, 0);
    results.push({ name: 'invalid plan gives an explicit error instead of a blank player', ok: true }); window.destroy();
    scenario = 'episode'; const previous = prepares; await open(origin);
    const episode = await errorState(); assert.match(episode.error, /番剧/); assert.equal(episode.iframes, 0); assert.equal(episode.source, 'https://www.bilibili.com/bangumi/play/ep12345'); assert.equal(prepares, previous);
    const embed = await window.webContents.executeJavaScript(`(async () => {
      ${pageWait}
      [...document.querySelectorAll('.bili-player-toolbar button')].find(button => button.textContent.includes('官方播放器')).click();
      await waitFor(() => document.querySelector('.detail-player iframe'), 'explicit official playback');
      return document.querySelector('.detail-player iframe').src;
    })()`);
    assert.equal(new URL(embed).searchParams.get('episodeId'), '12345');
    results.push({ name: 'episode playback loads official iframe only on explicit click', ok: true });
  }
  fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  fs.writeFileSync(path.join(root, '.qa', live ? `player-live-${bvid}.json` : 'player-renderer-tests.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, tests: results }, null, 2));
  finish(0);
}).catch(error => { console.error(error.stack); finish(1); });
function finish(code) { if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(code); }
setTimeout(() => { console.error('Renderer test timed out'); finish(1); }, 90000).unref();
