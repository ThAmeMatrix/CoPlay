const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { CSP } = require('../desktop/security.cjs');

const root = path.resolve(__dirname, '..');
const VIDEO = path.join(root, '.qa/p2p-film.mp4');
const savedToken = 'd'.repeat(48);
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'coplay-fs-download-')));
app.on('window-all-closed', () => {});
let window, server;
const results = [];
let biliCalls = 0, localCalls = 0;
const helpers = `
 const tick=()=>new Promise(r=>setTimeout(r,80));
 async function waitFor(check,label,timeout=15000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error(label+' :: '+document.body.innerText.slice(0,900));await new Promise(r=>setTimeout(r,40));}}
 const check=(ok,label)=>{if(!ok)throw Error(label)};
`;
const run = (code, gesture = false) => window.webContents.executeJavaScript(`(async()=>{${helpers}${code}})()`, gesture);
const playerInfo = () => run(`return JSON.stringify((()=>{
  const stage=document.querySelector('.theater-stage');
  const v=stage?.querySelector('video');
  if(!v) return {video:false,html:stage?.innerHTML.slice(0,200)};
  const r=v.getBoundingClientRect();
  return {video:true,w:Math.round(r.width),h:Math.round(r.height),readyState:v.readyState,videoWidth:v.videoWidth,
    paused:v.paused,src:v.currentSrc,fs:!!document.fullscreenElement,fsTag:document.fullscreenElement?.className||'',
    layout:document.querySelector('.theater-view').className,overlay:!!document.querySelector('.theater-page-controls')};
})());`);

app.whenReady().then(async () => {
  const api = express();
  api.use(express.json());
  api.get('/api/sources', (_q, r) => r.json([]));
  api.get('/api/catalog-cache', (_q, r) => r.json({ pages: 0, bytes: 0, updatedAt: 0 }));
  api.get('/api/resources/:id/comments', (_q, r) => r.json([]));
  api.get('/api/lyrics', (_q, r) => r.json({ lines: [], source: '', reason: '' }));
  api.use('/media', express.static(path.dirname(VIDEO)));
  api.post('/api/playback/bilibili', (_q, r) => {
    biliCalls++;
    r.json({ url: `/api/playback/${'a'.repeat(48)}/video`, quality: '360P', expiresAt: Date.now() + 600000, duration: 52, page: 1 });
  });
  api.get('/api/playback/:token/video', (_q, r) => r.sendFile(path.basename(VIDEO), { root: path.dirname(VIDEO) }));
  // Registered exactly as the download request keys it: bili:<download.bvid>:p<download.page>.
  // The embed URL deliberately points at a DIFFERENT BV / page so the old
  // URL-derived lookup would miss this copy and fall back to the B 站 API.
  api.get('/api/downloaded-media', (_q, r) => r.json([{
    key: 'bili:BV2B7411m7LV:p2', title: '已下载影片', page: 2, savedAt: Date.now(), complete: true,
    files: [{ id: 'f1', filename: 'saved.mp4', size: 8, segment: 0, url: `/api/downloaded-media/${savedToken}/file`, available: true }],
  }]));
  api.get(`/api/downloaded-media/${savedToken}/file`, (_q, r) => {
    localCalls++;
    r.sendFile(path.basename(VIDEO), { root: path.dirname(VIDEO) });
  });
  api.use((_q, r, next) => { r.set('Content-Security-Policy', CSP); next(); });
  api.use(express.static(path.join(root, 'dist')));
  server = api.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  window = new BrowserWindow({ show: true, width: 1200, height: 800, fullscreenable: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.setAudioMuted(true);
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => cb({ cancel: new URL(d.url).origin !== origin }));

  const base = { subtitle: '本机', kind: '视频', platform: '哔哩哔哩', cover: '', duration: '0:52', tags: [], description: '', playbackType: 'embed' };
  const resources = [
    { ...base, id: 'downloaded', title: '已下载影片', url: 'https://www.bilibili.com/video/BV9ZZZZZZZZZ/',
      playbackUrl: 'https://player.bilibili.com/player.html?bvid=BV9ZZZZZZZZZ&p=1&autoplay=0',
      download: { provider: 'bilibili', bvid: 'BV2B7411m7LV', page: 2, available: true } },
  ];
  await window.loadURL(origin);
  await run(`localStorage.setItem('coplay:resources-v1',JSON.stringify(${JSON.stringify(resources)}));
    localStorage.setItem('coplay:playlists-v1',JSON.stringify([{id:'p',title:'测试',description:'',ids:['downloaded'],color:'#b6bfb5'}]));`);
  await window.loadURL(origin);
  await new Promise(r => setTimeout(r, 3200));

  await run(`await waitFor(()=>[...document.querySelectorAll('.playlist-nav button')].some(b=>b.textContent.includes('测试')),'playlist nav');
    [...document.querySelectorAll('.playlist-nav button')].find(b=>b.textContent.includes('测试')).click();await tick();
    await waitFor(()=>document.querySelector('.playlist-controls'),'playlist page');
    [...document.querySelectorAll('.playlist-controls button')].find(b=>b.textContent.includes('播放列表')).click();await tick();
    await waitFor(()=>document.querySelector('.detail-player video'),'queue player');
    document.querySelector('[aria-label="放大播放"]').click();await new Promise(r=>setTimeout(r,1200));
    await waitFor(()=>document.querySelector('.theater-stage video'),'theater player');`);
  let info = JSON.parse(await playerInfo());
  assert.equal(info.video, true);
  assert.match(info.src, /\/api\/downloaded-media\//, 'downloaded item must play the local file');
  assert.equal(biliCalls, 0, 'downloaded item must never call /api/playback/bilibili');
  assert.ok(localCalls > 0);
  results.push({ name: 'a downloaded item plays its local copy even when the embed URL points elsewhere', ok: true });

  // The plain enlarged view must not mask the hardware video overlay with a
  // rounded clip or put it inside a promoted scroll layer. Those were the only
  // CSS differences from page-fullscreen, which renders the picture correctly.
  const styles = JSON.parse(await run(`return JSON.stringify((() => {
    const s = getComputedStyle(document.querySelector('.theater-stage'));
    const m = getComputedStyle(document.querySelector('.theater-main'));
    return { radius: s.borderRadius, overflow: s.overflow, mainOverflow: m.overflow };
  })());`));
  assert.equal(styles.radius, '0px', 'the video stage must never be rounded');
  assert.equal(styles.overflow, 'hidden');
  assert.equal(styles.mainOverflow, 'hidden', 'no scroll layer around the video');
  assert.equal(await run(`return !!document.querySelector('.theater-stalled');`), false,
    'the recovery panel must not appear when the video loaded normally');
  results.push({ name: 'plain enlarged view uses the same unmasked video surface as fullscreen', ok: true });

  // Both fullscreen modes share the layout that renders the video correctly.
  await run(`[...document.querySelectorAll('.theater-actions>button')].find(b=>b.textContent.includes('页面全屏')).click();
    await waitFor(()=>{const v=document.querySelector('.theater-stage video');return v&&v.readyState>=2&&v.clientWidth>600&&v.clientHeight>400},'page fullscreen video ready');`);
  info = JSON.parse(await playerInfo());
  assert.ok(info.video && info.w > 600 && info.h > 400 && info.readyState >= 2, 'page fullscreen must show the video');
  assert.equal(info.overlay, true);
  assert.equal(biliCalls, 0);
  results.push({ name: 'page fullscreen keeps the downloaded video visible', ok: true });

  await run(`[...document.querySelectorAll('.theater-page-actions button')].find(b=>b.textContent.includes('退出页面全屏')).click();await new Promise(r=>setTimeout(r,350));`);
  // Direct fullscreen must use Chromium's Fullscreen API (video-safe), not Electron's
  // native setFullScreen, and must keep the same working full-screen layout.
  // Chromium needs a trusted click for transient activation, which a headless
  // harness cannot produce. Stub the Fullscreen API so the button path is fully
  // deterministic and we can prove it uses the HTML5 API (not Electron's native
  // setFullScreen) and reacts to the resulting fullscreenchange event.
  await run(`
    window.__fsElement=null;window.__fsCalls=[];
    Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>window.__fsElement});
    Element.prototype.requestFullscreen=function(){
      window.__fsElement=this;window.__fsCalls.push(this.className||this.tagName);
      document.dispatchEvent(new Event('fullscreenchange'));return Promise.resolve();
    };
    document.exitFullscreen=()=>{window.__fsElement=null;document.dispatchEvent(new Event('fullscreenchange'));return Promise.resolve();};
    check([...document.querySelectorAll('.theater-actions>button')].some(b=>b.textContent.includes('直接全屏')),'direct fullscreen button missing');
    [...document.querySelectorAll('.theater-actions>button')].find(b=>b.textContent.includes('直接全屏')).click();
    await new Promise(r=>setTimeout(r,500));`);
  const fsCalls = await run(`return JSON.stringify(window.__fsCalls);`);
  assert.match(fsCalls, /theater-view/, 'the button must call requestFullscreen on the theater view');
  info = JSON.parse(await playerInfo());
  assert.equal(info.fs, true, 'HTML5 Fullscreen API must be used');
  assert.match(info.fsTag, /theater-view/, 'the theater view itself should be fullscreen');
  assert.ok(info.video && info.w > 600 && info.h > 400 && info.readyState >= 2, 'direct fullscreen must show the video');
  assert.equal(info.overlay, true, 'direct fullscreen must keep a reachable transport');
  assert.match(info.src, /\/api\/downloaded-media\//);
  assert.equal(biliCalls, 0, 'no B 站 prepare request after fullscreen changes');
  results.push({ name: 'direct fullscreen uses the HTML5 API, shows video and stays local', ok: true });

  // Scrubbing: zero seeks while dragging, exactly one on release, thumb follows.
  const scrub = await run(`
    const input=document.querySelector('.theater-page-controls .playback-progress input');
    const v=document.querySelector('.theater-stage video');
    window.__seeks=0; const count=()=>window.__seeks++;
    v.addEventListener('seeking',count);
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    const values=[];
    input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    for(const t of [8,10,12,14,16,18,20]){
      setter.call(input,String(t));
      input.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,30));
      values.push(Number(input.value));
    }
    const during=window.__seeks;
    window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    await new Promise(r=>setTimeout(r,700));
    v.removeEventListener('seeking',count);
    return { values, during, after:window.__seeks, time:v.currentTime, paused:v.paused };
  `);
  assert.deepEqual(scrub.values, [8, 10, 12, 14, 16, 18, 20], 'thumb must follow the pointer without snapping back');
  assert.equal(scrub.during, 0, 'no media seeks are allowed while dragging');
  assert.equal(scrub.after, 1, 'exactly one seek should happen on release');
  assert.ok(Math.abs(scrub.time - 20) < 1.5, `playhead should land at 20s (got ${scrub.time})`);
  assert.equal(scrub.paused, false, 'seeking must not stop playback');
  assert.equal(biliCalls, 0);
  results.push({ name: 'scrubbing is jerk-free: no mid-drag seeks, one precise seek on release', ok: true });

  await run(`document.querySelector('.theater-page-actions button[title="系统级全屏"]')?.click();await new Promise(r=>setTimeout(r,500));`, true);
  await run(`if(document.fullscreenElement) document.exitFullscreen();await new Promise(r=>setTimeout(r,400));`, true);
  assert.equal(biliCalls, 0);

  fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  fs.writeFileSync(path.join(root, '.qa/fullscreen-download-renderer-tests.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, biliCalls, localCalls, tests: results }, null, 2));
  finish(0);
}).catch(async error => {
  console.error(error.stack);
  console.error(JSON.stringify({ completed: results, biliCalls, localCalls,
    page: window && !window.isDestroyed() ? await window.webContents.executeJavaScript('document.body.innerText.slice(0,3000)') : '' }, null, 2));
  finish(1);
});
function finish(code) { if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(code); }
setTimeout(() => { console.error('fullscreen download renderer timeout'); finish(1); }, 150000).unref();
