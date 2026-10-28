import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { createApplication } from '../server/app.js';
import { localAdmin } from '../server/local-access.js';

test('local mode rejects forwarded access and disables room, relay and sharing APIs', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'coplay-local-'));
  const { httpServer, io, sources } = await createApplication({ dataDir: dir });
  httpServer.listen(0, '127.0.0.1'); await once(httpServer, 'listening');
  t.after(async () => { await new Promise(r => io.close(r)); await sources.flush(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  const call = (route, options = {}) => new Promise((resolve, reject) => {
    const req = request(base + route, options, res => {
      const chunks = []; res.on('data', b => chunks.push(b));
      res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on('error', reject); req.end();
  });
  const health = (await call('/api/health')).json();
  assert.equal(health.localOnly, true); assert.equal(health.roomsEnabled, false);
  for (const endpoint of ['/api/rooms', '/api/share/start', '/api/share/verify']) {
    assert.equal((await call(endpoint, { method: 'POST' })).status, 410);
  }
  assert.deepEqual((await call('/api/rtc-config')).json(), { iceServers: [] });
  assert.equal((await call('/api/catalog-cache')).json().pages, 0);
  assert.equal((await call('/api/catalog-cache', { method: 'DELETE', headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 403);
  assert.equal((await call('/api/catalog-cache', { method: 'DELETE' })).status, 200);
  for (const headers of [{ Host: 'coplay.example.com' }, { 'x-forwarded-for': '1.2.3.4' }, { 'cf-connecting-ip': '1.2.3.4' }]) {
    assert.equal((await call('/api/health', { headers })).status, 403);
  }
  assert.equal((await call('/socket.io/?EIO=4&transport=polling')).status, 403);
  assert.equal((await call('/api/playback/bilibili', { method: 'POST' })).status, 400);
  assert.equal((await call('/api/playback/bilibili', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('/api/playback/invalid/video', { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 403);
  assert.equal(localAdmin({ socket: { remoteAddress: '192.168.1.2' }, headers: { host: 'localhost' } }), false);
});
