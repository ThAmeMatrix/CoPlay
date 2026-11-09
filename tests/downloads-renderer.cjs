const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { CSP } = require('../desktop/security.cjs');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coplay-downloads-renderer-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let window, server;
const results = [];
const helpers = `
 const tick=()=>new Promise(r=>setTimeout(r,70));
 async function waitFor(check,label,timeout=12000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error(label+' :: '+document.body.innerText.slice(0,1200));await new Promise(r=>setTimeout(r,40));}}
 const check=(ok,label)=>{if(!ok)throw Error(label)};
 const buttons=text=>[...document.querySelectorAll('button')].filter(n=>n.textContent.includes(text));
 async function click(text,selector='button'){const n=[...document.querySelectorAll(selector)].find(b=>b.textContent.includes(text)&&!b.disabled);check(n,'missing button '+text);n.click();await tick();}
`;
const run = code => window.webContents.executeJavaScript(`(async()=>{${helpers}${code}})()`, true);

const bvid = 'BV1B7411m7LV';
let prepareCalls = 0, singleCalls = 0, delivered = 0, completed = 0;

app.whenReady().then(async () => {
  const api = express();
  api.use(express.json());
  api.get('/api/sources', (_q, r) => r.json([]));
  api.get('/api/catalog-cache', (_q, r) => r.json({ pages: 0, bytes: 0, updatedAt: 0 }));
  api.get('/api/downloaded-media', (_q, r) => r.json([]));
  api.get('/api/resources/:id/comments', (_q, r) => r.json([]));
  api.get('/tone.wav', (_q, r) => r.type('audio/wav').send(Buffer.alloc(1024)));
  api.get('/api/lyrics', (_q, r) => r.json({
    source: '网易云音乐', reason: '',
    lines: [{ time: 0, text: '第一句歌词', translation: 'First line' }, { time: 10, text: '第二句歌词' }, { time: 20, text: '第三句歌词' }],
  }));
  api.post('/api/downloads/prepare-batch', (q, r) => {
    prepareCalls++;
    const items = Array.isArray(q.body?.items) ? q.body.items : [];
    r.json({ results: items.map((item, i) => ({
      key: item.key, ok: true,
      plan: { downloads: [{ url: `/api/downloads/${'a'.repeat(47)}${i.toString(16)}/file`, filename: `item-${i}.mp4`, size: 8 }], expiresAt: Date.now() + 600000, quality: '360P', message: '已就绪' },
    })) });
  });
  api.post('/api/downloads/prepare', (q, r) => {
    singleCalls++;
    assert.match(q.body.bvid, /^BV[a-zA-Z0-9]{10}$/);
    r.json({ downloads: [{ url: `/api/downloads/${'b'.repeat(48)}/file`, filename: 'single.mp4', size: 8 }], expiresAt: Date.now() + 600000, quality: '360P', message: '已就绪' });
  });
  api.get('/api/downloads/:token/file', (q, r) => {
    delivered++;
    r.set('Content-Type', 'video/mp4');
    r.set('Content-Disposition', 'attachment; filename="item.mp4"');
    r.send(Buffer.from('01234567'));
  });
  api.use((_q, r, next) => { r.set('Content-Security-Policy', CSP); next(); });
  api.use(express.static(path.join(root, 'dist')));
  server = api.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  window = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  window.webContents.setAudioMuted(true);
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: new URL(details.url).origin !== origin }));
  window.webContents.session.on('will-download', (_event, item) => {
    item.setSavePath(path.join(profile, `export-${delivered}.mp4`));
    item.once('done', (_e, state) => { if (state === 'completed') completed++; });
  });

  const base = { subtitle: '本机测试作者', kind: '音乐', platform: '哔哩哔哩', cover: '', duration: '0:20', tags: [], description: '本机测试',
    url: `https://www.bilibili.com/video/${bvid}/`, playbackType: 'audio', playbackUrl: `${origin}/tone.wav`,
    download: { provider: 'bilibili', bvid, page: 1, available: true } };
  const resources = [
    { ...base, id: 'dl-a', title: '可下载一' },
    { ...base, id: 'dl-b', title: '可下载二', download: { provider: 'bilibili', bvid: 'BV2B7411m7LV', page: 1, available: true } },
    { ...base, id: 'dl-c', title: '不支持下载', download: undefined },
  ];
  await window.loadURL(origin);
  await run(`await waitFor(()=>document.querySelector('.sidebar'),'mount');await tick();
    localStorage.setItem('coplay:resources-v1',JSON.stringify(${JSON.stringify(resources)}));
    localStorage.setItem('coplay:playlists-v1',JSON.stringify([{id:'weekend',title:'下载测试列表',description:'批量下载与歌词',ids:['dl-a','dl-b','dl-c'],color:'#b6bfb5'}]));`);
  await window.loadURL(origin);

  // Playlist batch selection
  await run(`await waitFor(()=>buttons('下载测试列表').length,'sidebar');
    [...document.querySelectorAll('.playlist-nav button')].find(b=>b.textContent.includes('下载测试列表')).click();await tick();
    await click('批量下载','.playlist-controls button');
    await waitFor(()=>document.querySelector('.batch-panel'),'batch panel');
    check(document.querySelectorAll('.batch-check').length===3,'three cards should show a selection box');
    check(document.querySelectorAll('.batch-check input:disabled').length===1,'unsupported item must be disabled');
    check([...document.querySelectorAll('.media-card')].length===3,'media cards missing');`);
  results.push({ name: 'playlist batch mode shows a selection box per card and disables unsupported sources', ok: true });

  await run(`await click('全选可下载','.batch-actions button');await tick();
    check(document.querySelectorAll('.batch-check input:checked').length===2,'only downloadable items are selectable');
    check(document.querySelectorAll('.media-card.batch-selected').length===2,'selected cards are highlighted');
    await click('下载选中','.batch-actions button');
    await waitFor(()=>document.querySelectorAll('.batch-jobs li').length===2,'download jobs');
    await waitFor(()=>[...document.querySelectorAll('.batch-jobs li')].every(li=>li.className==='downloading'||li.className==='done'),'jobs dispatched');`);
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.equal(prepareCalls, 1, 'one batch preparation request');
  assert.equal(delivered, 2, 'two files handed to the download manager');
  assert.equal(completed, 2, 'both downloads finished');
  results.push({ name: 'selecting two downloadable items prepares one batch and saves both files', ok: true });

  // Lyrics toggle during playback (web build falls back to an in-app overlay)
  await run(`await click('结束批量下载','.playlist-controls button');await click('播放列表','.playlist-controls button');
    await waitFor(()=>document.querySelector('.queue-extra-actions .lyrics-toggle'),'lyrics toggle');
    check(!!document.querySelector('.queue-extra-actions .download-action button'),'per-item download button missing');
    await click('桌面歌词','.queue-extra-actions button');
    await waitFor(()=>document.querySelector('.lyrics-overlay'),'lyrics overlay');
    check(document.querySelectorAll('.lyrics-overlay .lyric-line').length>=2,'lyric lines missing');
    check(document.querySelector('.lyrics-overlay').textContent.includes('第一句歌词'),'first lyric line missing');
    check(document.querySelector('.queue-extra-actions .lyrics-toggle').getAttribute('aria-pressed')==='true','toggle not pressed');`);
  results.push({ name: 'playback shows a per-item download action and toggles a synced lyrics overlay', ok: true });

  await run(`await click('下载到本地','.queue-extra-actions button');
    await new Promise(r=>setTimeout(r,900));`);
  assert.equal(singleCalls, 1, 'single download uses the original prepare endpoint');
  assert.equal(delivered, 3, 'the per-item download handed one more file to the manager');
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.equal(completed, 3, 'all three downloads finished');
  results.push({ name: 'downloading the currently playing item prepares one file and saves it', ok: true });

  fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  fs.writeFileSync(path.join(root, '.qa/downloads-renderer-tests.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, prepareCalls, singleCalls, delivered, completed, tests: results }, null, 2));
  finish(0);
}).catch(async error => {
  console.error(error.stack);
  console.error(JSON.stringify({ completed: results, page: window && !window.isDestroyed() ? await window.webContents.executeJavaScript('document.body.innerText.slice(0,6000)') : '' }, null, 2));
  finish(1);
});
function finish(code) { if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(code); }
setTimeout(() => { console.error('downloads renderer timeout'); finish(1); }, 120000).unref();
