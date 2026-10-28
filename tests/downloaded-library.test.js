import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readFile, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDownloads } from '../server/downloads.js';
import { createDownloadedLibrary } from '../server/downloaded-library.js';
const bvid = 'BV1B7411m7LV';
const stream = (data, statusCode = 200, headers = {}) => Object.assign(Readable.from([Buffer.from(data)]), { statusCode, headers: { 'content-type':'video/mp4', 'content-length':String(data.length), ...headers } });
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coplay-download-library-'));
  const library = await createDownloadedLibrary({ dataDir: directory });
  let requests = 0;
  const downloader = createDownloads({ library, fetcher: async url => ({ body: Buffer.from(JSON.stringify({ code: 0, data: url.includes('playurl') ? { format:'mp4', quality:16, durl:[{ url:'https://cdn.bilivideo.com/a.mp4', size:10, length:60000 }] } : { bvid, cid:1, title:'测试视频', duration:60, rights:{download:1}, pages:[{page:1,cid:1,duration:60},{page:2,cid:2,duration:60}] } })) }), streamer: async (_url, { range }) => { requests++; if (range === 'bytes=0-0') return stream('0', 206, {'content-range':'bytes 0-0/10'}); if (range === 'bytes=2-4') return stream('234',206,{'content-range':'bytes 2-4/10'}); return stream('0123456789'); } });
  const app = express();
  app.get('/api/downloads/:token/file', (req,res) => downloader.send(req,res));
  app.get('/api/downloaded-media/:id/file', (req,res) => library.send(req,res));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(() => new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return { directory, library, downloader, origin:`http://127.0.0.1:${server.address().port}`, requests:()=>requests };
}
async function eventually(check) { for(let i=0;i<100;i++){ const result=await check(); if(result)return result; await new Promise(resolve=>setTimeout(resolve,10)); } throw Error('Condition did not complete'); }
test('complete browser/desktop download creates a durable copy; playlist playback and seeks do not contact upstream', async t => {
  const f=await fixture(t), plan=await f.downloader.prepare({bvid,page:2});
  const res=await fetch(f.origin+plan.downloads[0].url); assert.equal(await res.text(),'0123456789');
  const list=await eventually(async()=>{const values=await f.library.list();return values[0]?.complete&&values;});
  assert.equal(list[0].key,`bili:${bvid}:p2`);assert.ok(list[0].complete);assert.ok(!JSON.stringify(list).includes(f.directory));
  const calls=f.requests(), local=await fetch(f.origin+list[0].files[0].url,{headers:{Range:'bytes=2-5'}});
  assert.equal(local.status,206);assert.equal(await local.text(),'2345');assert.equal(f.requests(),calls);
  const restored=await createDownloadedLibrary({dataDir:f.directory});assert.deepEqual(await restored.list(),list);
  await unlink(path.join(f.directory,'downloaded-media',list[0].files[0].id+'.mp4'));
  assert.equal((await restored.list())[0].complete,false);assert.equal((await fetch(f.origin+list[0].files[0].url)).status,404);
});
test('partial requests, aborted captures and short files are never registered as complete copies', async t => {
  const f=await fixture(t), plan=await f.downloader.prepare({bvid});
  await (await fetch(f.origin+plan.downloads[0].url,{headers:{Range:'bytes=2-4'}})).arrayBuffer();
  assert.deepEqual(await f.library.list(),[]);
  const ticket={key:`bili:${bvid}:p1`,size:10,filename:'a.mp4',group:'a',segment:0,segmentCount:1,page:1};
  const capture=await f.library.begin(ticket);capture.transform.resume();await pipeline(Readable.from(['short']),capture.transform);
  await assert.rejects(capture.commit(),/未完整/);await capture.abort();
  assert.deepEqual(await f.library.list(),[]); assert.equal((await readdir(path.join(f.directory,'downloaded-media'))).length,0);
});
test('all segments must complete before a multi-segment resource is selected, and part keys stay separate', async t => {
  const f=await fixture(t);
  const save=async (page,segment,segmentCount,group='a')=>{
    const capture=await f.library.begin({key:`bili:${bvid}:p${page}`,title:'资源',page,size:3,filename:`${page}-${segment}.mp4`,segment,segmentCount,group});
    capture.transform.resume();await pipeline(Readable.from(['abc']),capture.transform);await capture.commit();
  };
  await save(1,1,2);assert.equal((await f.library.list())[0].complete,false);
  await save(2,0,1);await save(1,0,2);
  const list=await f.library.list();assert.equal(list.length,2);assert.ok(list.every(item=>item.complete));assert.deepEqual(list[0].files.map(file=>file.segment),[0,1]);
  const saved=JSON.parse(await readFile(path.join(f.directory,'downloaded-media/index.json'),'utf8'));assert.equal(saved.length,2);
  await save(1,0,2,'new-quality');assert.equal((await f.library.list())[0].complete,false);
});
