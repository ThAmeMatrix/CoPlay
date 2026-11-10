const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { CSP } = require('../desktop/security.cjs');

const root = path.resolve(__dirname, '..');
const VIDEO = path.join(root, '.qa/p2p-film.mp4');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'coplay-player-page-')));
app.on('window-all-closed', () => {});
let window, server;
const results = [];
const helpers = `
 const tick=()=>new Promise(r=>setTimeout(r,80));
 async function waitFor(check,label,timeout=15000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error(label+' :: '+document.body.innerText.slice(0,900));await new Promise(r=>setTimeout(r,40));}}
 const check=(ok,label)=>{if(!ok)throw Error(label)};
`;
const run = code => window.webContents.executeJavaScript(`(async()=>{${helpers}${code}})()`, true);
async function shot(name) {
  await new Promise(r => setTimeout(r, 400));
  window.webContents.invalidate();
  await new Promise(r => setTimeout(r, 220));
  await window.webContents.capturePage();
  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  fs.writeFileSync(path.join(root, '.qa', name), image.toPNG());
}

app.whenReady().then(async () => {
  const api = express();
  api.use(express.json());
  api.get('/api/sources', (_q, r) => r.json([]));
  api.get('/api/catalog-cache', (_q, r) => r.json({ pages: 0, bytes: 0, updatedAt: 0 }));
  api.get('/api/downloaded-media', (_q, r) => r.json([]));
  api.get('/api/resources/:id/comments', (_q, r) => r.json([]));
  api.get('/api/lyrics', (_q, r) => r.json({ lines: [], source: '', reason: '' }));
  api.use('/media', express.static(path.dirname(VIDEO)));
  api.use((_q, r, next) => { r.set('Content-Security-Policy', CSP); next(); });
  api.use(express.static(path.join(root, 'dist')));
  server = api.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  window.webContents.setAudioMuted(true);
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => cb({ cancel: new URL(d.url).origin !== origin }));

  const base = { subtitle: '本机测试', kind: '视频', platform: '媒体链接', cover: '', duration: '0:52', tags: [], description: '', playbackType: 'video' };
  const resources = Array.from({ length: 30 }, (_, i) => ({
    ...base, id: `clip-${i}`, title: `影片 ${String(i + 1).padStart(2, '0')}`,
    url: `${origin}/media/p2p-film.mp4`, playbackUrl: `${origin}/media/p2p-film.mp4`,
  }));
  await window.loadURL(origin);
  await run(`localStorage.setItem('coplay:resources-v1',JSON.stringify(${JSON.stringify(resources)}));
    localStorage.setItem('coplay:playlists-v1',JSON.stringify([{id:'p',title:'三十部影片',description:'',ids:${JSON.stringify(resources.map(r => r.id))},color:'#b6bfb5'}]));`);
  await window.loadURL(origin);
  await new Promise(r => setTimeout(r, 3000));
  await run(`await waitFor(()=>[...document.querySelectorAll('.playlist-nav button')].some(b=>b.textContent.includes('三十部影片')),'sidebar');
    [...document.querySelectorAll('.playlist-nav button')].find(b=>b.textContent.includes('三十部影片')).click();await tick();
    [...document.querySelectorAll('.playlist-controls button')].find(b=>b.textContent.includes('播放列表')).click();await tick();
    await waitFor(()=>document.querySelector('.detail-player video'),'queue player');
    document.querySelector('[aria-label="放大播放"]').click();
    await waitFor(()=>document.querySelector('.theater-view.player-page'),'player page');
    await waitFor(()=>{const v=document.querySelector('.theater-stage video');return v&&v.readyState>=2&&v.clientWidth>500},'player page video ready');`);

  const layout = JSON.parse(await run(`return JSON.stringify((()=>{
    const page=document.querySelector('.theater-view'),pane=document.querySelector('.theater-main'),
      stage=document.querySelector('.theater-stage'),list=document.querySelector('.theater-items'),
      v=stage?.querySelector('video');
    const box=el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};
    return { pageClass:page.className, position:getComputedStyle(page).position,
      appShell:!!document.querySelector('.app-shell'), dock:!!document.querySelector('.player-dock'),
      pageScrollable:document.documentElement.scrollHeight>innerHeight+2,
      paneOverflow:getComputedStyle(pane).overflow, listOverflow:getComputedStyle(list).overflowY,
      listScrollable:list.scrollHeight>list.clientHeight+20,
      stage:box(stage), pane:box(pane), list:box(list),
      video:v?{...box(v),paused:v.paused,readyState:v.readyState,time:v.currentTime}:null,
      items:document.querySelectorAll('.theater-items>button').length,
      scrub:!!document.querySelector('.player-list-scroll input')};})());`));
  assert.equal(layout.appShell, false, 'the player must be its own page, not an overlay on the library');
  assert.equal(layout.dock, false);
  assert.equal(layout.position, 'relative', 'no fixed/z-index overlay');
  assert.equal(layout.pageScrollable, false, 'the page itself must not scroll');
  assert.equal(layout.paneOverflow, 'hidden', 'the left player pane must never scroll');
  assert.equal(layout.listOverflow, 'auto');
  assert.equal(layout.listScrollable, true);
  assert.equal(layout.items, 30);
  assert.equal(layout.scrub, true, 'the playlist scrub bar must exist');
  assert.ok(layout.stage.x < layout.list.x, 'player must be on the left of the playlist');
  assert.ok(layout.video && layout.video.w > 500 && layout.video.h > 300 && layout.video.readyState >= 2, 'video must be visible');
  results.push({ name: 'a standalone page keeps the player fixed on the left and the playlist as the only scroll region', ok: true });
  await shot('player-page-1.11.0.png');

  // Wheel over the player scrolls the playlist, not the page.
  const wheel = JSON.parse(await run(`
    const list=document.querySelector('.theater-items'),stage=document.querySelector('.theater-stage');
    list.scrollTop=0;await tick();
    const before=list.scrollTop;
    stage.dispatchEvent(new WheelEvent('wheel',{deltaY:600,bubbles:true,cancelable:true}));
    await tick();
    return JSON.stringify({before,after:list.scrollTop,pageScroll:document.documentElement.scrollTop||window.scrollY});
  `));
  assert.ok(wheel.after > wheel.before, 'wheel over the player must scroll the playlist');
  assert.equal(wheel.pageScroll, 0, 'the page must stay fixed');
  results.push({ name: 'scrolling anywhere scrolls the playlist', ok: true });

  // The slim scrub bar drives the same playlist scroll.
  const scrubResult = JSON.parse(await run(`
    const list=document.querySelector('.theater-items'),input=document.querySelector('.player-list-scroll input');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}));await tick();
    const max=Math.max(0,list.scrollHeight-list.clientHeight);
    setter.call(input,'0');input.dispatchEvent(new Event('input',{bubbles:true}));await tick();
    return JSON.stringify({max,atZero:list.scrollTop,label:document.querySelector('.player-list-scroll>span:last-child').textContent});
  `));
  assert.ok(scrubResult.max > 100);
  assert.equal(scrubResult.atZero, 0, 'scrubbing back to 0 must return to the top of the list');
  assert.equal(scrubResult.label, '0%');
  results.push({ name: 'the playlist scrub bar scrolls the list and reflects its position', ok: true });

  // Selecting a later item keeps the player alive and the page still fixed.
  await run(`document.querySelectorAll('.theater-items>button')[20].click();await tick();
    await waitFor(()=>document.querySelector('.theater-items>button.active')?.textContent.includes('影片 21'),'selection');`);
  const selected = JSON.parse(await run(`return JSON.stringify({title:document.querySelector('.theater-titles strong').textContent,video:!!document.querySelector('.theater-stage video'),listScroll:document.querySelector('.theater-items').scrollTop,pageScroll:document.documentElement.scrollHeight>innerHeight+2});`));
  assert.equal(selected.video, true);
  assert.equal(selected.pageScroll, false);
  assert.ok(selected.listScroll > 0, 'the current item should be scrolled into view');
  results.push({ name: 'choosing a distant playlist item keeps the player in place', ok: true });

  // Page fullscreen hides the directory but keeps a reachable transport.
  await run(`[...document.querySelectorAll('.theater-actions>button')].find(b=>b.textContent.includes('页面全屏')).click();await tick();
    await waitFor(()=>document.querySelector('.theater-view.page-full'),'page full');`);
  const full = JSON.parse(await run(`return JSON.stringify({list:!!document.querySelector('.theater-directory'),transport:!!document.querySelector('.theater-page-controls .playback-controls'),video:!!document.querySelector('.theater-stage video')});`));
  assert.equal(full.list, false);
  assert.equal(full.transport, true);
  assert.equal(full.video, true);
  await shot('player-page-full-1.11.0.png');
  await run(`[...document.querySelectorAll('.theater-page-actions button')].find(b=>b.textContent.includes('退出页面全屏')).click();await tick();`);
  results.push({ name: 'page fullscreen hides only the playlist and keeps the transport', ok: true });

  // Returning restores the library page and the persistent bottom player.
  await run(`document.querySelector('.theater-back').click();await tick();
    await waitFor(()=>document.querySelector('.app-shell'),'library page');`);
  const back = JSON.parse(await run(`return JSON.stringify({page:!!document.querySelector('.theater-view'),dock:!!document.querySelector('.player-dock'),videos:document.querySelectorAll('video').length,locked:document.documentElement.classList.contains('player-page-active')});`));
  assert.equal(back.page, false);
  assert.equal(back.dock, true);
  assert.equal(back.locked, false, 'the scroll lock must be removed');
  results.push({ name: 'returning leaves the new page cleanly and restores the bottom player', ok: true });

  fs.writeFileSync(path.join(root, '.qa/player-page-renderer-tests.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
  finish(0);
}).catch(async error => {
  console.error(error.stack);
  console.error(JSON.stringify({ completed: results, page: window && !window.isDestroyed() ? await window.webContents.executeJavaScript('document.body.innerText.slice(0,3000)') : '' }, null, 2));
  finish(1);
});
function finish(code) { if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(code); }
setTimeout(() => { console.error('player page renderer timeout'); finish(1); }, 150000).unref();
