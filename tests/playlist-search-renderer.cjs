const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration(); // Stable offscreen capture on Windows test hosts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const express = require('express');
const { CSP } = require('../desktop/security.cjs');
const root = path.resolve(__dirname, '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'coplay-list-search-')));
app.on('window-all-closed', () => {});
let window, server;
const results = [], importRequests = [];
const helpers = `
  async function waitFor(check, label, timeout=12000) { const start=Date.now(); while(!check()) { if(Date.now()-start>timeout) throw Error(label+': '+document.querySelector('[role="dialog"]')?.textContent); await new Promise(r=>setTimeout(r,30)); } }
  const check=(value,message)=>{if(!value)throw Error(message)};
  const tick=()=>new Promise(r=>setTimeout(r,70));
  const find=(label,selector='button')=>[...document.querySelectorAll(selector)].find(n=>n.textContent.trim()===label);
  async function click(label,selector) { const n=find(label,selector);check(n&&!n.disabled,'button unavailable '+label);n.click();await tick(); }
  function fill(node,value) { check(node,'input missing');Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true})); }
  async function search(label,value) { fill(document.querySelector('[aria-label="'+label+'"]'),value);await tick(); }
  async function close() { document.querySelector('[aria-label="关闭弹窗"]').click();await waitFor(()=>!document.querySelector('[role="dialog"]'),'close'); }
  const saved=()=>JSON.parse(localStorage.getItem('coplay:playlists-v1'));
  async function audioReady(){await waitFor(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.05&&a.readyState>=3;},'audio playing');return document.querySelector('audio');}
  async function readResource(url) { await search('资源链接或 BV 号',url);await click('读取资源');await waitFor(()=>document.querySelector('.collection-progress p')?.textContent.includes('读取完成'),'resource read'); }
`;
const run=code=>window.webContents.executeJavaScript(`(async()=>{${helpers}${code}})()`,true);
async function screenshot(name) { await window.webContents.executeJavaScript("document.getAnimations().forEach(a=>{if(a.effect?.getTiming().iterations!==Infinity)a.finish()})");await new Promise(r=>setTimeout(r,450));window.webContents.invalidate();await new Promise(r=>setTimeout(r,100));fs.mkdirSync(path.join(root,'.qa'),{recursive:true});fs.writeFileSync(path.join(root,'.qa',name),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()); }
function wav(){const n=8000*30,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.sin(i/8000*440*2*Math.PI)*600,44+i*2);return b;}
app.whenReady().then(async()=>{
  const { createCollections }=await import(pathToFileURL(path.join(root,'server/collections.js')).href);
  const bvid='BV1B7411m7LV', response=body=>({body:Buffer.from(JSON.stringify(body))});
  const collections=createCollections({fetcher:async url=>{
    if(url.includes('api.bilibili.com'))return response({code:0,data:{bvid,title:'单个视频演示',owner:{name:'视频作者'},duration:30,rights:{download:1},pages:[{page:1,cid:1}]}});
    if(url.includes('music.163.com'))return response({code:200,songs:[{id:186016,name:'网易云单曲演示',ar:[{name:'音乐作者'}],dt:180000}]});
    if(url.includes('u.y.qq.com'))return response({code:0,song:{code:0,data:{track_info:{id:123,mid:'0039MnYb0qxYhV',name:'QQ 单曲演示',singer:[{name:'QQ 作者'}],interval:180}}}});
    throw Error('unexpected fixture request '+url);
  }});
  const api=express();api.use(express.json());
  api.get('/api/sources',(_q,r)=>r.json([]));api.get('/api/catalog-cache',(_q,r)=>r.json({pages:0,bytes:0,updatedAt:0}));api.get('/api/downloaded-media',(_q,r)=>r.json([]));api.get('/api/resources/:id/comments',(_q,r)=>r.json([]));
  api.get('/tone.wav',(_q,r)=>r.type('audio/wav').send(wav()));
  api.post('/api/collections',async(q,r)=>{importRequests.push(q.body);try{r.json(q.body.session?await collections.page(q.body.session,q.body.cursor):await collections.start(q.body.url));}catch(e){r.status(400).json({error:e.message});}});
  api.use((_q,r,next)=>{r.set('Content-Security-Policy',CSP);next();});api.use(express.static(path.join(root,'dist')));
  server=api.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const base={kind:'音乐',platform:'媒体链接',cover:'',duration:'0:30',tags:['测试'],description:'本机测试音轨',url:origin+'/tone.wav',playbackUrl:origin+'/tone.wav',playbackType:'audio'};
  const tracks=[{...base,id:'audio-0',title:'雨后 Night',subtitle:'Alice'},{...base,id:'audio-1',title:'林间 Forest',subtitle:'Bob'},{...base,id:'audio-2',title:'晚风 Evening',subtitle:'Carla'}];
  window=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});window.webContents.setAudioMuted(true);
  window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>cb({cancel:new URL(d.url).origin!==origin}));
  await window.loadURL(origin);await run(`await waitFor(()=>find('播放列表','.sidebar nav button'),'mount');await tick();localStorage.setItem('coplay:resources-v1',JSON.stringify(${JSON.stringify(tracks)}));localStorage.setItem('coplay:playback-mode-v1',JSON.stringify('list'));localStorage.setItem('coplay:playlists-v1',JSON.stringify([{id:'weekend',title:'夜航 Night Mix',description:'通勤时的城市声景',ids:['audio-0','audio-1','audio-2'],color:'#b6bfb5'},{id:'target',title:'阅读时光',description:'安静的午后',ids:[],color:'#d2baa8'}]));`);await window.loadURL(origin);
  await run(`
    await waitFor(()=>find('播放列表','.sidebar nav button'),'navigation');await click('播放列表','.sidebar nav button');
    await search('搜索播放列表','  ＮＩＧＨＴ  通勤 ');check(document.querySelectorAll('.playlist-card').length===1,'playlist metadata search failed');check(document.querySelector('.playlist-card h3').textContent==='夜航 Night Mix','wrong playlist');check(document.querySelector('h1').textContent.includes('我的播放列表'),'search left playlists');
    await search('搜索播放列表','不存在');check(!document.querySelector('.playlist-card'),'unmatched playlist visible');check(document.body.textContent.includes('没有匹配的播放列表'),'empty search missing');
    document.querySelector('.search-box [aria-label="清空搜索"]').click();await tick();check(document.querySelectorAll('.playlist-card').length===2,'clear lost playlists');
    await search('搜索播放列表','夜航');document.querySelector('.playlist-card').click();await tick();check(document.querySelector('[aria-label="搜索列表内容"]').value==='','list navigation kept name filter');
  `);
  results.push({name:'playlist name/description search remains on the playlists page; empty and clear results work',ok:true});
  await run(`
    await search('搜索列表内容','  BOB  ');check(document.querySelectorAll('.media-title').length===1,'content filter wrong');check(document.querySelector('.media-title').textContent==='林间 Forest','author did not match');
    await click('编辑列表');check(document.querySelector('[aria-label="搜索列表内容"]').value==='  BOB  ','edit mode cleared search');check(document.querySelectorAll('.playlist-edit-list li').length===1,'editor did not filter');check(document.querySelector('.playlist-order-number').textContent==='02','filtered item renumbered');
    document.querySelector('[aria-label="上移林间 Forest"]').click();await tick();check(saved()[0].ids.join()==='audio-1,audio-0,audio-2','move changed wrong item');
    document.querySelector('[aria-label="复制或移动林间 Forest"]').click();await tick();await click('确认复制');check(saved()[1].ids.join()==='audio-1','copy used filtered index');
    document.querySelector('[aria-label="下移林间 Forest"]').click();await tick();check(saved()[0].ids.join()==='audio-0,audio-1,audio-2','restore order failed');
    await search('搜索列表内容','不存在');check(!document.querySelector('.playlist-edit-list li'),'unmatched editor rows visible');check(document.querySelector('.playlist-editor').textContent.includes('没有匹配的内容'),'editor empty missing');
    await search('搜索列表内容','');await click('完成编辑');check(document.querySelectorAll('.media-title').length===3,'content clear lost entries');
  `);
  results.push({name:'contents and edit mode search by author; filtered reordering/copy use original item identities',ok:true});
  await run(`
    await click('播放列表','.playlist-controls button');const audio=await audioReady(),time=audio.currentTime;
    await search('搜索播放队列','carla');check(document.querySelectorAll('.queue-list button').length===1,'queue filter wrong');check(document.querySelector('.queue-list strong').textContent==='晚风 Evening','wrong queue result');check(document.querySelector('audio')===audio&&audio.currentTime>=time,'search restarted audio');
    await search('搜索播放队列','不存在');check(!document.querySelector('.queue-list button'),'empty queue filter failed');check(!audio.paused,'search paused audio');
    document.querySelector('[aria-label="下一项"]').click();await tick();await audioReady();check(document.querySelector('[role="dialog"]').textContent.includes('正在播放 2 / 3 · 林间 Forest'),'next followed search subset');
    document.querySelector('[aria-label="清空队列搜索"]').click();await tick();check(document.querySelectorAll('.queue-list button').length===3,'clear changed queue');check(document.querySelector('.queue-list [aria-current] strong').textContent==='林间 Forest','wrong current item after clearing');
    await search('搜索播放队列','ＣＡＲＬＡ');document.querySelector('.queue-list button').click();await tick();await audioReady();check(document.querySelector('[role="dialog"]').textContent.includes('正在播放 3 / 3 · 晚风 Evening'),'selected filtered index instead of original');
  `);
  await screenshot('playlist-queue-search-1.4.1.png');
  results.push({name:'queue filtering preserves playing audio and full-list navigation; selecting a match plays its original index',ok:true});
  window.setContentSize(390,844);await screenshot('playlist-queue-search-mobile-1.4.1.png');
  await run(`const dialog=document.querySelector('[role="dialog"]');check(dialog.scrollWidth<=dialog.clientWidth+2,'mobile dialog overflow');const input=document.querySelector('[aria-label="搜索播放队列"]');check(input.getBoundingClientRect().width>90,'mobile search collapsed');await close();`);window.setContentSize(1400,1000);
  results.push({name:'queue search fits a 390px window',ok:true});
  await run(`
    await click('导入资源','.playlist-controls button');check(document.querySelector('[aria-label="资源链接或 BV 号"]').type==='text','BV blocked by URL input');await readResource('${bvid}');check(document.querySelectorAll('.collection-items>label').length===1,'single video preview missing');check(document.querySelector('[aria-label="导入目标播放列表"]').value==='weekend','current target missing');
  `);
  await screenshot('single-resource-import-1.4.1.png');
  await run(`
    await click('导入已选 1 项');await waitFor(()=>!document.querySelector('[role="dialog"]'),'single import closed');check(saved()[0].ids.join()==='audio-0,audio-1,audio-2,bili-${bvid}','single video not added');
    await click('导入资源','.playlist-controls button');await readResource('https://www.bilibili.com/video/${bvid}/');await click('导入已选 1 项');check(saved()[0].ids.length===4,'duplicate single imported');
  `);
  assert.ok(importRequests.some(value=>value.url===bvid));
  results.push({name:'bare BV is previewed through real collection/import adapters; selected single video is added once',ok:true});
  await run(`
    await click('导入资源','.playlist-controls button');await readResource('https://music.163.com/#/song?id=186016');check(document.querySelector('.collection-items strong').textContent==='网易云单曲演示','song metadata missing');
    await search('搜索待导入条目','找不到');check(!document.querySelector('.collection-items>label'),'preview filter failed');
    await search('资源链接或 BV 号','bad input');await click('读取资源');await waitFor(()=>document.querySelector('.form-error'),'invalid input feedback');check(!document.querySelector('.collection-items'),'failed parse kept old selection');
    await readResource('https://music.163.com/#/song?id=186016');check(document.querySelector('[aria-label="搜索待导入条目"]').value==='','new read kept stale filter');await click('导入已选 1 项');check(saved()[0].ids.includes('netease-186016'),'NetEase not added');
    await click('导入资源','.playlist-controls button');await readResource('https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV');await click('导入已选 1 项');check(saved()[0].ids.includes('qqmusic-0039MnYb0qxYhV'),'QQ not added');
    await click('导入资源','.playlist-controls button');await readResource('https://cdn.example.com/MyMusic.mp3');await click('导入已选 1 项');check(saved()[0].ids.length===7,'media link not added');
  `);
  await window.loadURL(origin);
  await run(`await waitFor(()=>find('夜航 Night Mix','.playlist-nav button'),'reload');await click('夜航 Night Mix','.playlist-nav button');check(saved()[0].ids.length===7,'single imports not persistent');await search('搜索列表内容','网易云');check(document.querySelectorAll('.media-title').length===1,'imported single not searchable');check(document.querySelector('.media-title').textContent==='网易云单曲演示','wrong imported search result');`);
  results.push({name:'NetEase/QQ songs and direct audio import into current playlist; retry resets stale preview, reload preserves searchable entries',ok:true});
  fs.writeFileSync(path.join(root,'.qa/playlist-search-renderer-tests.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({ok:true,tests:results},null,2));finish(0);
}).catch(async e=>{console.error(e.stack);console.error(JSON.stringify({completed:results,page:window&&!window.isDestroyed()?await window.webContents.executeJavaScript('document.body.innerText.slice(0,8000)'):''},null,2));finish(1);});
function finish(code){if(window&&!window.isDestroyed())window.destroy();if(server){server.closeAllConnections();server.close();}app.exit(code);}
setTimeout(()=>{console.error('Playlist search renderer timeout');finish(1);},90000).unref();
