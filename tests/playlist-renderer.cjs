// Exercise the built app in a test-owned renderer/profile with local WAV audio.
// External requests are blocked; the user's browser and files are not touched.
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration(); // Stable offscreen capture on Windows test hosts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { CSP } = require('../desktop/security.cjs');
const root = path.resolve(__dirname, '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'coplay-playlist-test-')));
app.on('window-all-closed', () => {});
let server, window;
const results = [];
const helpers = `
  async function waitFor(check, label, timeout = 10000) {
    const start = Date.now();
    while (!check()) { if (Date.now() - start > timeout) throw new Error(label + ': ' + document.querySelector('[role="dialog"]')?.textContent); await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 40));
  const button = (text, selector = 'button') => [...document.querySelectorAll(selector)].find(node => node.textContent.trim() === text);
  async function click(text, selector) { const node = button(text, selector); check(node && !node.disabled, 'missing/enabled button: ' + text); node.click(); await tick(); }
  async function close() { document.querySelector('[aria-label="关闭弹窗"]').click(); await waitFor(() => !document.querySelector('[role="dialog"]'), 'modal closed'); }
  async function setMode(mode) { const select = document.querySelector('[aria-label="队列播放规则"]'); select.value = mode; select.dispatchEvent(new Event('change', { bubbles:true })); await tick(); }
  const track = () => document.querySelector('.queue-list [aria-current="true"] strong')?.textContent;
  async function audioReady() { await waitFor(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > .05 && audio.readyState >= 3; }, 'audio playing automatically'); return document.querySelector('audio'); }
  async function finishTrack() { const audio = await audioReady(); audio.currentTime = audio.duration - .06; return audio; }
`;
const run = code => window.webContents.executeJavaScript(`(async () => { ${helpers} ${code} })()`, true);
async function capture(name) {
  await new Promise(resolve => setTimeout(resolve, 350));
  window.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 100));
  fs.writeFileSync(path.join(root, '.qa', name), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
}
function wav() {
  const sampleRate = 8000, samples = sampleRate * 20, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(Math.round(Math.sin(index * 440 * Math.PI * 2 / sampleRate) * 600), 44 + index * 2);
  return buffer;
}
app.whenReady().then(async () => {
  const api = express(), tone = wav();
  api.get('/api/sources', (_req, res) => res.json([]));
  api.get('/api/catalog-cache', (_req, res) => res.json({ pages: 0, bytes: 0, updatedAt: 0 }));
  api.get('/api/resources/:id/comments', (_req, res) => res.json([]));
  api.get('/tone.wav', (_req, res) => res.type('audio/wav').send(tone));
  api.use((_req, res, next) => { res.set('Content-Security-Policy', CSP); next(); });
  api.use(express.static(path.join(root, 'dist')));
  server = api.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = { subtitle: '本机测试音轨', kind: '音乐', platform: '媒体链接', cover: '', duration: '0:20', tags: ['音乐'], description: '隔离测试数据', url: origin + '/tone.wav', playbackUrl: origin + '/tone.wav', playbackType: 'audio' };
  const tracks = ['雨后', '林间', '晚风'].map((title, index) => ({ ...base, id: 'audio-' + index, title }));
  const media = [...tracks,
    { ...base, id: 'netease-fixture', title: '网易云测试', platform: '网易云音乐', playbackType: 'embed', playbackUrl: 'https://music.163.com/outchain/player?type=2&id=186016&auto=0&height=66' },
    { ...base, id: 'qq-fixture', title: 'QQ音乐测试', platform: 'QQ音乐', playbackType: 'embed', playbackUrl: 'https://i.y.qq.com/n2/m/outchain/player.html?songid=97773&songtype=0' },
    { ...base, id: 'video-fixture', title: '视频测试', kind: '视频', playbackType: 'video' },
  ];
  window = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  window.webContents.setAudioMuted(true);
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: new URL(details.url).origin !== origin }));
  await window.loadURL(origin);
  await run(`await waitFor(() => button('本地资源', '.main-nav button'), 'app mounted before seeding'); await tick();
    localStorage.setItem('coplay:resources-v1', JSON.stringify(${JSON.stringify(media)}));
    localStorage.setItem('coplay:favorites-v1', JSON.stringify(${JSON.stringify(media.map(value => value.id))}));
    localStorage.setItem('coplay:playlists-v1', JSON.stringify([{ id:'weekend', title:'音乐测试片单', description:'顺着心情，听见日常', color:'#b6bfb5', ids:['audio-0','audio-1','audio-2'] }]));`);
  await window.loadURL(origin);
  const local = await run(`
    await waitFor(() => button('本地资源', '.main-nav button'), 'navigation');
    await click('本地资源', '.main-nav button'); await click('打开本地文件');
    await waitFor(() => document.querySelector('[aria-label="选择本地文件"]'), 'local file input');
    const bytes = await (await fetch('/tone.wav')).arrayBuffer(), transfer = new DataTransfer();
    transfer.items.add(new File([bytes], '本机音乐.wav', { type:'audio/wav' }));
    const input = document.querySelector('[aria-label="选择本地文件"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles:true }));
    const audio = await audioReady();
    const result = { time:audio.currentTime, paused:audio.paused, source:audio.src.slice(0,5) };
    check(!document.querySelector('.detail-buttons'), 'music still requires second play click');
    await close(); check(audio.paused, 'closed music kept playing'); return result;
  `);
  assert.equal(local.paused, false); assert.equal(local.source, 'blob:');
  results.push({ name: 'local music starts on import and stops when closed', ...local });
  const embeds = await run(`
    document.querySelector('.sidebar nav button .lucide-heart').closest('button').click(); await tick();
    document.querySelector('[aria-label="查看网易云测试"]').click();
    await waitFor(() => document.querySelector('.detail-player iframe'), 'NetEase opens immediately');
    const netease = document.querySelector('iframe').src;
    check(new URL(netease).searchParams.get('auto') === '1', 'NetEase autoplay flag missing'); await close();
    document.querySelector('[aria-label="查看QQ音乐测试"]').click();
    await waitFor(() => document.querySelector('.detail-player iframe'), 'QQ opens immediately');
    const qq = document.querySelector('iframe').src;
    check(new URL(qq).pathname === '/n2/m/outchain/player/index.html', 'cached QQ endpoint not migrated');
    check(document.querySelector('.platform-music-player').textContent.includes('点击播放'), 'QQ play requirement missing'); await close();
    document.querySelector('[aria-label="查看视频测试"]').click();
    await waitFor(() => button('立即播放'), 'video play button'); check(!document.querySelector('.detail-player'), 'video opened without click'); await close();
    return { netease, qq };
  `);
  results.push({ name: 'music embeds open with supported autoplay and repaired cached QQ URL; videos keep explicit play', ...embeds });
  const ordering = await run(`
    await click('音乐测试片单', '.playlist-nav button');
    check(!document.querySelector('.playlist-edit-list'), 'edit tools visible outside edit mode');
    const play = button('播放列表', '.playlist-controls button'), edit = button('编辑列表');
    check(play.getBoundingClientRect().left < edit.getBoundingClientRect().left, 'play is not on the left');
    await click('编辑列表');
    check(document.querySelector('[aria-label="上移雨后"]').disabled, 'first item can move up');
    document.querySelector('[aria-label="下移雨后"]').click(); await tick();
    let order = [...document.querySelectorAll('.playlist-edit-list li')].map(row => row.dataset.mediaId);
    check(order.join() === 'audio-1,audio-0,audio-2', 'down arrow did not reorder');
    document.querySelector('[aria-label="上移雨后"]').click(); await tick();
    const handle = document.querySelector('[data-media-id="audio-0"] .playlist-drag-handle'), dataTransfer = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles:true, dataTransfer })); await tick();
    const target = document.querySelector('[data-media-id="audio-2"]');
    target.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer })); await tick();
    target.dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer })); await tick();
    order = [...document.querySelectorAll('.playlist-edit-list li')].map(row => row.dataset.mediaId);
    check(order.join() === 'audio-1,audio-2,audio-0', 'drag reorder failed');
    check(JSON.parse(localStorage.getItem('coplay:playlists-v1'))[0].ids.join() === order.join(), 'order not saved');
    return order;
  `);
  fs.mkdirSync(path.join(root, '.qa'), { recursive: true });
  await capture('playlist-edit-1.3.0.png');
  results.push({ name: 'explicit edit mode, left play button, arrow/drag sorting and persistence', order: ordering });
  await window.loadURL(origin);
  await run(`
    await waitFor(() => button('音乐测试片单', '.playlist-nav button'), 'restored playlist');
    await click('音乐测试片单', '.playlist-nav button');
    check([...document.querySelectorAll('.media-title')].map(node => node.textContent).join() === '林间,晚风,雨后', 'reloaded order differs');
    await click('播放列表', '.playlist-controls button'); await audioReady(); check(track() === '林间', 'queue ignored saved order');
    await finishTrack(); await waitFor(() => track() === '晚风', 'automatic next track'); await audioReady();
    await finishTrack(); await waitFor(() => track() === '雨后', 'last track');
    const last = await finishTrack(); await waitFor(() => document.querySelector('.queue-rule-description').textContent.includes('播放完毕'), 'list stopped');
    check(last === document.querySelector('audio') && last.ended && last.paused, 'list unexpectedly restarted');
    check(document.querySelector('[aria-label="下一项"]').disabled, 'list end next button enabled');
  `);
  results.push({ name: 'saved order is used by queue; actual audio ended events advance and stop at list end', ok: true });
  await run(`
    await setMode('loop');
    document.querySelectorAll('.queue-list button')[2].click(); await audioReady(); await finishTrack();
    await waitFor(() => track() === '林间', 'list loop wraps'); await audioReady();
    await setMode('single'); const previous = await finishTrack();
    await waitFor(() => document.querySelector('audio') !== previous, 'repeat remount');
    const replay = await audioReady(); check(track() === '林间' && replay.currentTime < 3, 'single repeat failed');
    document.querySelector('[aria-label="下一项"]').click(); await audioReady(); check(track() === '晚风', 'single repeat manual next failed');
  `);
  results.push({ name: 'list loop and single repeat restart real audio; manual next still works', ok: true });
  const shuffle = await run(`
    await setMode('shuffle');
    const visits = [track()];
    for (let count = 0; count < 2; count++) { await finishTrack(); await waitFor(() => track() !== visits[visits.length-1], 'shuffle advance'); await audioReady(); visits.push(track()); }
    check(new Set(visits).size === 3, 'shuffle repeated before cycle complete');
    document.querySelector('[aria-label="上一项"]').click(); await tick(); check(track() === visits[1], 'shuffle previous did not follow history');
    document.querySelector('[aria-label="下一项"]').click(); await tick(); check(track() === visits[2], 'shuffle forward did not follow history');
    const secondCycle = [];
    for (let count = 0; count < 3; count++) { const previous = track(); await finishTrack(); await waitFor(() => track() !== previous, 'shuffle next cycle'); await audioReady(); secondCycle.push(track()); }
    check(new Set(secondCycle).size === 3, 'next shuffle cycle omitted a track');
    await setMode('single'); return visits;
  `);
  results.push({ name: 'shuffle traverses all tracks and previous/next follow playback history', visits: shuffle });
  await capture('music-playback-1.3.0.png');
  await run('await close();');
  await window.loadURL(origin);
  await run(`
    await waitFor(() => button('音乐测试片单', '.playlist-nav button'), 'playlist after restart');
    await click('音乐测试片单', '.playlist-nav button');
    check(document.querySelector('[aria-label="播放规则"]').value === 'single', 'mode not persisted');
    document.querySelector('[aria-label="查看晚风"]').click(); await audioReady(); check(track() === '晚风', 'click did not start selected song in queue');
    await close(); await click('编辑列表');
  `);
  window.setContentSize(390, 844);
  const mobile = await run(`await tick(); return { width:innerWidth, contentWidth:document.documentElement.scrollWidth, listWidth:document.querySelector('.playlist-edit-list').getBoundingClientRect().width };`);
  assert.ok(mobile.contentWidth <= mobile.width, JSON.stringify(mobile));
  await capture('playlist-mobile-1.3.0.png');
  results.push({ name: 'mode persists, selected song opens in queue, and editor fits mobile viewport', ...mobile });
  fs.writeFileSync(path.join(root, '.qa', 'playlist-renderer-tests.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, tests: results }, null, 2)); finish(0);
}).catch(async error => {
  console.error(error.stack);
  console.error(JSON.stringify({ completed: results, page: window && !window.isDestroyed() ? await window.webContents.executeJavaScript('document.body.innerText.slice(0,7000)') : '' }, null, 2));
  finish(1);
});
function finish(code) { if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(code); }
setTimeout(() => { console.error('Playlist renderer tests timed out'); finish(1); }, 90000).unref();
