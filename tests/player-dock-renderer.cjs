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
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'coplay-dock-renderer-')));
app.on('window-all-closed', () => {});
let window, server;
const results = [];
const helpers = `
 const tick=()=>new Promise(r=>setTimeout(r,80));
 async function waitFor(check,label,timeout=12000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error(label+' :: '+document.body.innerText.slice(0,900));await new Promise(r=>setTimeout(r,40));}}
 const check=(ok,label)=>{if(!ok)throw Error(label)};
 async function click(text,selector='button'){const n=[...document.querySelectorAll(selector)].find(b=>b.textContent.includes(text)&&!b.disabled);check(n,'missing button '+text);n.click();await tick();}
 const player=()=>document.querySelector('video');
`;
const run = code => window.webContents.executeJavaScript(`(async()=>{${helpers}${code}})()`, true);
async function shot(name) {
  await new Promise(r => setTimeout(r, 400));
  window.webContents.invalidate();
  await new Promise(r => setTimeout(r, 150));
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

  window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  window.webContents.setAudioMuted(true);
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => cb({ cancel: new URL(d.url).origin !== origin }));

  const base = { subtitle: '本机', kind: '视频', platform: '媒体链接', cover: '', duration: '0:32', tags: [], description: '',
    playbackType: 'video' };
  const resources = [
    { ...base, id: 'v1', title: '影片一', url: `${origin}/media/p2p-film.mp4`, playbackUrl: `${origin}/media/p2p-film.mp4` },
    { ...base, id: 'v2', title: '影片二', url: `${origin}/media/p2p-film.mp4`, playbackUrl: `${origin}/media/p2p-film.mp4` },
  ];
  await window.loadURL(origin);
  await run(`localStorage.setItem('coplay:resources-v1',JSON.stringify(${JSON.stringify(resources)}));
    localStorage.setItem('coplay:playlists-v1',JSON.stringify([{id:'p',title:'测试片单',description:'',ids:['v1','v2'],color:'#b6bfb5'}]));`);
  await window.loadURL(origin);
  await new Promise(r => setTimeout(r, 3000));

  // Closing the playback dialog hands the playhead to the persistent dock.
  await run(`await waitFor(()=>[...document.querySelectorAll('.playlist-nav button')].some(b=>b.textContent.includes('测试片单')),'sidebar');
    [...document.querySelectorAll('.playlist-nav button')].find(b=>b.textContent.includes('测试片单')).click();await tick();
    await click('播放列表','.playlist-controls button');
    await waitFor(()=>{const v=player();return v&&!v.paused&&v.currentTime>0.3},'queue playing');`);
  const before = await run(`return player().currentTime;`);
  await run(`document.querySelector('[aria-label="关闭弹窗"]').click();await waitFor(()=>document.querySelector('.dock-stage video'),'dock player');await tick();`);
  await new Promise(r => setTimeout(r, 700));
  const afterDock = await run(`return { playing:!player().paused, time:player().currentTime, dock:!!document.querySelector('.player-dock'), modal:!!document.querySelector('[role="dialog"]') };`);
  assert.equal(afterDock.dock, true);
  assert.equal(afterDock.modal, false);
  assert.equal(afterDock.playing, true, 'playback must continue after the dialog closes');
  assert.ok(afterDock.time >= before - 0.5, 'playhead must not jump back to the start');
  results.push({ name: 'closing the playback dialog keeps the video playing in the bottom dock', ok: true });
  await shot('player-dock-1.7.0.png');

  // The dock can open the current playlist and switch items.
  await run(`document.querySelector('.player-dock [aria-label="当前播放列表"]').click();await tick();
    await waitFor(()=>document.querySelector('.dock-playlist'),'playlist popover');
    check(document.querySelectorAll('.dock-playlist-items>button').length===2,'playlist items missing');`);
  results.push({ name: 'the bottom dock opens the current playlist', ok: true });
  await run(`document.querySelector('.page-heading h1').click();await tick();
    check(!document.querySelector('.dock-playlist'),'playlist popover did not close on outside click');`);
  results.push({ name: 'the playlist popover closes when clicking elsewhere', ok: true });

  // Theater shows the video and returning does not cancel playback.
  await run(`document.querySelector('.player-dock [aria-label="放大播放"]').click();await tick();
    await waitFor(()=>document.querySelector('.theater-view'),'theater view');
    await waitFor(()=>{const v=document.querySelector('.theater-stage video');return v&&!v.paused&&v.currentTime>0.3},'theater playing');
    const v=document.querySelector('.theater-stage video'),box=v.getBoundingClientRect();
    check(box.width>400&&box.height>200,'theater video is not visible');`);
  await shot('player-theater-1.7.0.png');

  // Only two unambiguous fullscreen controls, both actually wired up.
  await run(`check(document.querySelectorAll('.theater-actions>button').length===2,'redundant fullscreen buttons');
    check([...document.querySelectorAll('.theater-actions>button')].some(b=>b.textContent.includes('页面全屏')),'page fullscreen missing');
    check([...document.querySelectorAll('.theater-actions>button')].some(b=>b.textContent.includes('直接全屏')),'direct fullscreen missing');`);
  results.push({ name: 'the enlarged view exposes exactly two fullscreen controls', ok: true });

  // Page fullscreen must keep a reachable transport + exit overlay.
  await run(`[...document.querySelectorAll('.theater-actions>button')].find(b=>b.textContent.includes('页面全屏')).click();await tick();
    await waitFor(()=>document.querySelector('.theater-view.page-full'),'page fullscreen');
    check(!!document.querySelector('.theater-page-controls .playback-controls'),'page fullscreen lost the transport');
    check([...document.querySelectorAll('.theater-page-actions button')].some(b=>b.textContent.includes('退出页面全屏')),'page fullscreen has no exit');
    const v=document.querySelector('.theater-stage video');
    check(v&&v.clientWidth>600&&v.clientHeight>300&&!v.paused,'video not visible in page fullscreen');`);
  await shot('player-page-full-1.7.0.png');
  await run(`[...document.querySelectorAll('.theater-page-actions button')].find(b=>b.textContent.includes('退出页面全屏')).click();await tick();
    check(!document.querySelector('.theater-view.page-full'),'page fullscreen exit button did nothing');
    check(getComputedStyle(document.querySelector('.theater-head')).display!=='none','header did not return');`);
  results.push({ name: 'page fullscreen keeps controls and is reversible', ok: true });

  // Esc leaves page fullscreen first instead of closing the whole player.
  await run(`[...document.querySelectorAll('.theater-actions>button')].find(b=>b.textContent.includes('页面全屏')).click();await tick();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();
    check(!document.querySelector('.theater-view.page-full'),'Esc did not leave page fullscreen');
    check(!!document.querySelector('.theater-view'),'Esc closed the player instead of just fullscreen');`);
  results.push({ name: 'Escape exits page fullscreen without stopping playback', ok: true });

  // Dragging the progress slider must follow the pointer every step (no snap-back).
  const scrub = await run(`
    const input=document.querySelector('.theater-main .playback-progress input');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    const values=[];
    input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    for(const v of [10,12,14,16,18]){
      setter.call(input,String(v));
      input.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,25));
      values.push(Number(input.value));
    }
    window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    return { values, time: document.querySelector('.theater-stage video').currentTime, playing: !document.querySelector('.theater-stage video').paused };
  `);
  assert.deepEqual(scrub.values, [10, 12, 14, 16, 18], 'slider must not snap back while dragging');
  assert.ok(Math.abs(scrub.time - 18) < 1.5, `seek did not follow the drag (got ${scrub.time})`);
  assert.equal(scrub.playing, true, 'seeking must not pause playback');
  results.push({ name: 'progress scrubbing is continuous and seeks to the released position', ok: true });

  await run(`await click('返回','.theater-back');
    await waitFor(()=>document.querySelector('video'),'player after back');
    await waitFor(()=>{const v=document.querySelector('video');return !v.paused&&v.currentTime>0.3},'playing after back');`);
  results.push({ name: 'the enlarged player shows the video and returning keeps playback alive', ok: true });

  // "共映小助手" closes on an outside click.
  await run(`document.querySelector('.notification-button').click();await tick();
    check(!!document.querySelector('.notification-menu'),'assistant did not open');
    document.querySelector('.page-heading h1').click();await tick();
    check(!document.querySelector('.notification-menu'),'assistant did not close on outside click');`);
  results.push({ name: 'the assistant popover closes when clicking elsewhere', ok: true });

  fs.writeFileSync(path.join(root, '.qa/player-dock-renderer-tests.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, before, afterDock, tests: results }, null, 2));
  finish(0);
}).catch(async error => {
  console.error(error.stack);
  console.error(JSON.stringify({ completed: results, page: window && !window.isDestroyed() ? await window.webContents.executeJavaScript('document.body.innerText.slice(0,4000)') : '' }, null, 2));
  finish(1);
});
function finish(code) { if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(code); }
setTimeout(() => { console.error('player dock renderer timeout'); finish(1); }, 120000).unref();
