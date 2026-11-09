const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { CSP } = require('../desktop/security.cjs');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coplay-download-all-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let window, server;
const results = [];
const helpers = `
 const tick=()=>new Promise(r=>setTimeout(r,80));
 async function waitFor(check,label,timeout=15000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error(label+' :: '+document.body.innerText.slice(0,900));await new Promise(r=>setTimeout(r,40));}}
 const check=(ok,label)=>{if(!ok)throw Error(label)};
`;
const run = code => window.webContents.executeJavaScript(`(async()=>{${helpers}${code}})()`, true);
const TOTAL = 24;
let prepareCalls = 0, delivered = 0, completed = 0;
const chunkSizes = [];

app.whenReady().then(async () => {
  const api = express();
  api.use(express.json());
  api.get('/api/sources', (_q, r) => r.json([]));
  api.get('/api/catalog-cache', (_q, r) => r.json({ pages: 0, bytes: 0, updatedAt: 0 }));
  api.get('/api/downloaded-media', (_q, r) => r.json([]));
  api.get('/api/resources/:id/comments', (_q, r) => r.json([]));
  api.get('/api/lyrics', (_q, r) => r.json({ lines: [], source: '', reason: '' }));
  api.post('/api/downloads/prepare', (_q, r) => r.json({ downloads: [], expiresAt: Date.now() + 600000, quality: '360P', message: '' }));
  api.post('/api/downloads/prepare-batch', (q, r) => {
    prepareCalls++;
    const items = Array.isArray(q.body?.items) ? q.body.items : [];
    chunkSizes.push(items.length);
    r.json({ results: items.map((item, i) => ({
      key: item.key, ok: true,
      plan: { downloads: [{ url: `/api/downloads/${('a'.repeat(46) + prepareCalls.toString(16).padStart(2, '0')).slice(0, 47)}${i.toString(16)}/file`, filename: `${item.key}.mp4`, size: 8 }], expiresAt: Date.now() + 600000, quality: '360P', message: '已就绪' },
    })) });
  });
  api.get('/api/downloads/:token/file', (_q, r) => {
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

  window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  window.webContents.setAudioMuted(true);
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => cb({ cancel: new URL(d.url).origin !== origin }));
  window.webContents.session.on('will-download', (_event, item) => {
    item.setSavePath(path.join(profile, `export-${delivered}.mp4`));
    item.once('done', (_e, state) => { if (state === 'completed') completed++; });
  });

  const base = { subtitle: '本机', kind: '视频', platform: '哔哩哔哩', cover: '', duration: '0:20', tags: [], description: '',
    playbackType: 'video', url: `${origin}/tone.wav`, playbackUrl: `${origin}/tone.wav` };
  const resources = Array.from({ length: TOTAL }, (_, i) => ({
    ...base, id: `dl-${i}`, title: `待下载 ${i + 1}`,
    download: { provider: 'bilibili', bvid: `BV${String(i).padStart(10, 'X')}`, page: 1, available: true },
  }));
  resources.push({ ...base, id: 'unsupported', title: '不支持下载', download: undefined });
  await window.loadURL(origin);
  await run(`localStorage.setItem('coplay:resources-v1',JSON.stringify(${JSON.stringify(resources)}));
    localStorage.setItem('coplay:playlists-v1',JSON.stringify([{id:'all',title:'全部下载',description:'',ids:${JSON.stringify(resources.map(r => r.id))},color:'#b6bfb5'}]));`);
  await window.loadURL(origin);
  await new Promise(r => setTimeout(r, 3000));

  await run(`await waitFor(()=>[...document.querySelectorAll('.playlist-nav button')].some(b=>b.textContent.includes('全部下载')),'sidebar');
    [...document.querySelectorAll('.playlist-nav button')].find(b=>b.textContent.includes('全部下载')).click();await tick();
    [...document.querySelectorAll('.playlist-controls button')].find(b=>b.textContent.includes('批量下载')).click();await tick();
    await waitFor(()=>document.querySelector('.batch-panel'),'batch panel');
    check(!document.querySelector('.batch-panel').textContent.includes('一次最多'),'the old 20-item cap copy must be gone');
    check(document.querySelectorAll('.batch-check input:disabled').length===1,'only the unsupported item is disabled');
    const selectAll=[...document.querySelectorAll('.batch-actions button')].find(b=>b.textContent.includes('全选待下载'));
    check(selectAll.textContent.includes('${TOTAL}'),'select-all must offer every downloadable item');
    selectAll.click();await tick();
    check(document.querySelectorAll('.batch-check input:checked').length===${TOTAL},'every item must be selectable at once');
    const start=[...document.querySelectorAll('.batch-actions button')].find(b=>b.textContent.includes('下载选中'));
    check(start.textContent.includes('${TOTAL}'),'download button must count the whole selection');
    start.click();`);
  await run(`await waitFor(()=>[...document.querySelectorAll('.batch-jobs li')].filter(li=>li.className==='downloading'||li.className==='done').length===${TOTAL},'all jobs dispatched');`);
  await new Promise(r => setTimeout(r, 2500));

  assert.equal(prepareCalls, 3, '24 items must be prepared in 3 chunks of 10');
  assert.deepEqual(chunkSizes, [10, 10, 4]);
  assert.equal(delivered, TOTAL, 'every selected item must be handed to the download manager');
  assert.equal(completed, TOTAL, 'every download must finish');
  results.push({ name: 'select-all downloads the entire 24-item playlist in bounded chunks', ok: true });

  // The finished job list clears itself so nothing stale is left behind.
  await new Promise(r => setTimeout(r, 4000));
  assert.equal(await run(`return document.querySelectorAll('.batch-jobs li').length;`), 0);
  results.push({ name: 'finished batch jobs clear automatically', ok: true });

  fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  fs.writeFileSync(path.join(root, '.qa/download-all-renderer-tests.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, prepareCalls, chunkSizes, delivered, completed, tests: results }, null, 2));
  finish(0);
}).catch(async error => {
  console.error(error.stack);
  console.error(JSON.stringify({ completed: results, prepareCalls, chunkSizes, delivered, completed, page: window && !window.isDestroyed() ? await window.webContents.executeJavaScript('document.body.innerText.slice(0,3000)') : '' }, null, 2));
  finish(1);
});
function finish(code) { if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(code); }
setTimeout(() => { console.error('download all renderer timeout'); finish(1); }, 150000).unref();
