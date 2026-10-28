const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration(); // Stable offscreen capture on Windows test hosts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Readable } = require('node:stream');
const express = require('express');
const { CSP } = require('../desktop/security.cjs');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(),'coplay-collections-renderer-'));
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
let window, server;const results=[];
const helpers = `
 async function waitFor(check,label,timeout=15000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error(label+': '+document.querySelector('[role="dialog"]')?.textContent);await new Promise(r=>setTimeout(r,30));}}
 const tick=()=>new Promise(r=>setTimeout(r,60));
 const check=(value,message)=>{if(!value)throw Error(message)};
 const find=(label,selector='button')=>[...document.querySelectorAll(selector)].find(node=>node.textContent.trim()===label);
 async function click(label,selector){const node=find(label,selector);check(node&&!node.disabled,'button unavailable '+label);node.click();await tick();}
 function fill(node,value){Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));}
 async function close(){document.querySelector('[aria-label="关闭弹窗"]').click();await waitFor(()=>!document.querySelector('[role="dialog"]'),'close dialog');}
 const saved=()=>JSON.parse(localStorage.getItem('coplay:playlists-v1'));
`;
const run=code=>window.webContents.executeJavaScript(`(async()=>{${helpers}${code}})()`,true);
async function screenshot(name){await window.webContents.executeJavaScript("document.getAnimations().forEach(animation => { if (animation.effect?.getTiming().iterations !== Infinity) animation.finish(); })");await new Promise(r=>setTimeout(r,450));window.webContents.invalidate();await new Promise(r=>setTimeout(r,100));fs.mkdirSync(path.join(root,'.qa'),{recursive:true});fs.writeFileSync(path.join(root,'.qa',name),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());}
function wav(){const size=8000*20,buffer=Buffer.alloc(44+size*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(8000,24);buffer.writeUInt32LE(16000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(size*2,40);for(let i=0;i<size;i++)buffer.writeInt16LE(Math.sin(i/8000*440*2*Math.PI)*600,44+i*2);return buffer;}
app.whenReady().then(async()=>{
 const {createDownloadedLibrary}=await import(pathToFileURL(path.join(root,'server/downloaded-library.js')).href);
 const {createDownloads}=await import(pathToFileURL(path.join(root,'server/downloads.js')).href);
 const library=await createDownloadedLibrary({dataDir:path.join(profile,'data')});
 const tone=wav(),bvid='BV1B7411m7LV';let onlineRequests=0,localRequests=0,failedBatch=true,downloadsDone=0;
 const downloader=createDownloads({library,fetcher:async url=>({body:Buffer.from(JSON.stringify({code:0,data:url.includes('playurl')?{format:'mp4',quality:16,durl:[{url:'https://cdn.bilivideo.com/test.mp4',length:20000,size:tone.length}]}:{bvid,title:'下载复用测试',cid:1,duration:20,rights:{download:1},pages:[{page:1,cid:1,duration:20}]}}))}),streamer:async(_url,{range})=>Object.assign(Readable.from([range?tone.subarray(0,1):tone]),{statusCode:range?206:200,headers:{'content-type':'video/mp4','content-length':String(range?1:tone.length),...(range?{'content-range':`bytes 0-0/${tone.length}`}:{})}})});
 const base={subtitle:'合集作者',kind:'视频',platform:'哔哩哔哩',cover:'',duration:'0:20',tags:[],description:'隔离测试条目',url:`https://www.bilibili.com/video/${bvid}/`,playbackUrl:`https://player.bilibili.com/player.html?bvid=${bvid}&p=1&autoplay=0`,playbackType:'embed',download:{provider:'bilibili',bvid,page:1,available:true}};
 const entries=[{...base,id:'video-a',title:'下载复用测试'},{...base,id:'video-b',title:'不选这条'},{id:'unavailable',title:'失效视频',unavailable:'已失效'},{...base,id:'video-c',title:'最后一条'}];
 const api=express();api.use(express.json());
 api.get('/fixture.wav',(_q,r)=>r.type('audio/wav').send(tone));
 api.get('/api/sources',(_q,r)=>r.json([]));api.get('/api/catalog-cache',(_q,r)=>r.json({pages:0,bytes:0,updatedAt:0}));api.get('/api/resources/:id/comments',(_q,r)=>r.json([]));
 api.post('/api/collections',(q,r)=>{
  if(q.body.session&&failedBatch){failedBatch=false;return r.status(400).json({error:'这一批网络中断，可继续读取'});}
  r.json({session:'fixture',title:'测试收藏夹',source:'哔哩哔哩',total:4,items:q.body.session?entries.slice(2):entries.slice(0,2),nextCursor:q.body.session?null:1,complete:!!q.body.session,warnings:[]});
 });
 api.get('/api/downloaded-media',async(_q,r)=>r.json(await library.list()));
 api.get('/api/downloaded-media/:id/file',(q,r)=>{localRequests++;return library.send(q,r);});
 api.post('/api/downloads/prepare',async(q,r)=>r.json(await downloader.prepare(q.body)));
 api.get('/api/downloads/:token/file',(q,r)=>downloader.send(q,r));
 api.post('/api/playback/bilibili',(_q,r)=>{onlineRequests++;r.status(400).json({error:'测试在线来源不可用'});});
 api.use((_q,r,next)=>{r.set('Content-Security-Policy',CSP);next();});api.use(express.static(path.join(root,'dist')));
 server=api.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
 window=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});window.webContents.setAudioMuted(true);
 window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:new URL(details.url).origin!==origin}));
 window.webContents.session.on('will-download',(_event,item)=>{item.setSavePath(path.join(profile,'exported-test.mp4'));item.once('done',(_event,state)=>{if(state==='completed')downloadsDone++;});});
 await window.loadURL(origin);await run(`await waitFor(()=>find('播放列表','.sidebar nav button'),'mount');await tick();localStorage.setItem('coplay:playlists-v1',JSON.stringify([{id:'weekend',title:'来源列表',ids:[],color:'#b6bfb5'},{id:'target',title:'目标列表',ids:['video-c'],color:'#d2baa8'}]));localStorage.setItem('coplay:resources-v1','[]');`);await window.loadURL(origin);
 await run(`
  await waitFor(()=>find('来源列表','.playlist-nav button'),'sidebar');await click('来源列表','.playlist-nav button');await click('导入资源','.playlist-controls button');
  fill(document.querySelector('[aria-label="资源链接或 BV 号"]'),'https://www.bilibili.com/list/ml716471605');await tick();await click('读取资源');
  await waitFor(()=>document.querySelector('.form-error')?.textContent.includes('网络中断'),'failed second batch');
  check(document.querySelectorAll('.collection-items>label').length===2,'first batch discarded');
  document.querySelector('[aria-label="导入不选这条"]').click();await click('继续读取');
  await waitFor(()=>document.querySelector('.collection-progress p')?.textContent.includes('读取完成'),'all batches');
  check(document.querySelectorAll('.collection-items>label').length===4,'missing collection rows');
  check(document.querySelector('[aria-label="导入失效视频"]').disabled,'unavailable selectable');
  check(!document.querySelector('[aria-label="导入不选这条"]').checked,'retry reset choices');
 `);
 await screenshot('collection-import-1.4.0.png');
 await run(`await click('导入已选 2 项');await waitFor(()=>!document.querySelector('[role="dialog"]'),'import closed');check(saved()[0].ids.join()==='video-a,video-c','unselected entries imported');check(JSON.parse(localStorage.getItem('coplay:resources-v1')).length===2,'unselected media persisted');`);
 results.push({name:'collection pagination retries preserve selection and import only checked available entries',ok:true});
 await run(`
  await click('编辑列表');document.querySelector('[aria-label="复制或移动下载复用测试"]').click();await tick();await click('确认复制');
  check(saved()[0].ids.join()==='video-a,video-c','copy removed source');check(saved()[1].ids.join()==='video-c,video-a','copy target order wrong');
  document.querySelector('[aria-label="复制或移动下载复用测试"]').click();await tick();await click('移动到其他列表');await click('确认移动');
  check(saved()[0].ids.join()==='video-c','move kept source');check(saved()[1].ids.join()==='video-c,video-a','move created duplicate');
 `);
 await window.loadURL(origin);
 await run(`await waitFor(()=>find('目标列表','.playlist-nav button'),'restored targets');await click('目标列表','.playlist-nav button');check([...document.querySelectorAll('.media-title')].map(e=>e.textContent).join()==='最后一条,下载复用测试','transfers not persisted');`);
 results.push({name:'copy and move are saved, preserve source appropriately and deduplicate the target',ok:true});
 await run(`
  document.querySelector('[aria-label="查看下载复用测试"]').click();await waitFor(()=>find('准备下载'),'detail downloads');await click('准备下载');await waitFor(()=>document.querySelector('.download-file'),'prepared file');document.querySelector('.download-file').click();
 `);
 for(let count=0;count<400;count++){if(downloadsDone&&(await library.list())[0]?.complete)break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(downloadsDone,1);assert.equal((await library.list())[0].complete,true);assert.deepEqual(fs.readFileSync(path.join(profile,'exported-test.mp4')),tone);
 await run(`await close();await click('播放列表','.playlist-controls button');await waitFor(()=>{const video=document.querySelector('.downloaded-player video');return video&&!video.paused&&video.currentTime>.1},'downloaded media auto plays');check(document.querySelector('.downloaded-player-label').textContent.includes('已下载资源'),'local playback label missing');const video=document.querySelector('video');video.currentTime=10;await waitFor(()=>video.currentTime>=10&&!video.seeking,'offline seek');`);
 assert.equal(onlineRequests,0);assert.ok(localRequests>0);
 await screenshot('downloaded-playback-1.4.0.png');
 results.push({name:'native download completion registers full media; playlist plays and seeks locally with zero online prepares',downloadsDone,onlineRequests,localRequests});
 await run('await close();');await window.loadURL(origin);
 await run(`await waitFor(()=>find('目标列表','.playlist-nav button'),'reload');await click('目标列表','.playlist-nav button');await click('播放列表','.playlist-controls button');await waitFor(()=>document.querySelector('.downloaded-player video')?.currentTime>.1,'local playback after reload');await close();`);
 const recorded=(await library.list())[0];await fs.promises.unlink(path.join(profile,'data/downloaded-media',recorded.files[0].id+'.mp4'));
 await run(`await click('播放列表','.playlist-controls button');await waitFor(()=>document.querySelector('.bili-player-status[role="alert"]'),'missing file falls back to online');check(!document.querySelector('.downloaded-player'),'missing file still selected');await close();`);
 assert.equal(onlineRequests,1);results.push({name:'saved download survives page reload and a removed file falls back to the original source',ok:true});
 await run(`
  document.querySelector('[aria-label="查看下载复用测试"]').click();await waitFor(()=>document.querySelector('[aria-label="关联已有下载文件"]'),'attach input');
  const transfer=new DataTransfer();transfer.items.add(new File([await(await fetch('/fixture.wav')).arrayBuffer()],'旧下载.mp4',{type:'video/mp4'}));
  const input=document.querySelector('[aria-label="关联已有下载文件"]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await tick();await close();
  await click('播放列表','.playlist-controls button');await waitFor(()=>document.querySelector('.detail-player video')?.currentTime>.1,'attached file playback');check(document.querySelector('video').src.startsWith('blob:'),'attached file not used');await close();
 `);
 assert.equal(onlineRequests,1);results.push({name:'previously downloaded file can be attached and reused across playlist aliases in this session',ok:true});
 await run(`await click('编辑列表');document.querySelector('[aria-label="复制或移动下载复用测试"]').click();await tick();`);window.setContentSize(390,844);await screenshot('playlist-transfer-mobile-1.4.0.png');
 const size=await run(`return {width:innerWidth,scroll:document.documentElement.scrollWidth}`);assert.ok(size.scroll<=size.width);
 results.push({name:'playlist transfer dialog fits narrow screens',...size});
 fs.writeFileSync(path.join(root,'.qa/collections-renderer-tests.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({ok:true,tests:results},null,2));finish(0);
}).catch(async error=>{console.error(error.stack);console.error(JSON.stringify({completed:results,page:window&&!window.isDestroyed()?await window.webContents.executeJavaScript('document.body.innerText.slice(0,7000)'):''},null,2));finish(1);});
function finish(code){if(window&&!window.isDestroyed())window.destroy();if(server){server.closeAllConnections();server.close();}app.exit(code);}
setTimeout(()=>{console.error('Collections renderer timeout');finish(1);},90000).unref();
