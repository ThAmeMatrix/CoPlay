import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, access, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';
import { publicUrl, safeFetch } from './safe-fetch.js';

export function localAdmin(req) {
  const address = req.socket.remoteAddress;
  const local = ['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(address);
  let hostname = '';
  try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch { return false; }
  return local && ['localhost', '127.0.0.1', '[::1]'].includes(hostname) && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-host'];
}
export function publicOrigin(input) {
  const u = publicUrl(input);
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash) throw new Error('请输入应用的 HTTPS 根地址，例如 https://coplay.example.com');
  return u.origin;
}
export function createNetwork({ httpServer, test = false }) {
  const instanceId = randomUUID();
  let configured = ''; let child; let generation = 0;
  let state = { state: 'idle', publicUrl: '', message: '尚未启用公网分享', temporary: false };
  const currentPort = () => httpServer.address()?.port || Number(process.env.PORT) || 3000;
  async function check(url) {
    const origin = publicOrigin(url);
    const response = await safeFetch(`${origin}/api/health`, { timeout: 10000, maxBytes: 16384 });
    if (JSON.parse(response.body.toString()).instanceId !== instanceId) throw new Error('此地址没有连接到当前共映服务，请检查反向代理或隧道');
    return origin;
  }
  async function verify(url) {
    const version = generation;
    const origin = await check(url);
    if (version !== generation) throw new Error('公网连接状态已变化，请重试');
    configured = origin;
    state = { state: 'ready', publicUrl: origin, message: '公网 HTTPS 连接已验证', temporary: false };
    return state;
  }
  async function ensureBinary() {
    if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
    const binary = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    const file = path.resolve('.tools', binary);
    try { await access(file); return file; } catch { /* Download the official release on first use. */ }
    const asset = process.platform === 'win32' ? `cloudflared-windows-${process.arch === 'arm64' ? 'arm64' : 'amd64'}.exe` : process.platform === 'linux' ? `cloudflared-linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}` : null;
    if (!asset) throw new Error('请安装 cloudflared，并通过 CLOUDFLARED_PATH 指定其位置');
    state.message = '首次启用：正在下载官方 cloudflared 连接工具';
    const response = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`连接工具下载失败（HTTP ${response.status}）`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 1000000 || bytes.length > 100 * 1024 * 1024) throw new Error('连接工具下载不完整');
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file + '.tmp', bytes); await rename(file + '.tmp', file);
    if (process.platform !== 'win32') await chmod(file, 0o755);
    return file;
  }
  async function launch(version) {
    const active = () => version === generation;
    try {
      const binary = await ensureBinary(); if (!active()) return;
      state.message = '正在建立公网 HTTPS 隧道…';
      const process = spawn(binary, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${currentPort()}`, '--protocol', 'http2'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child = process;
      const timeout = setTimeout(() => {
        if (active() && state.state === 'starting') { state = { state: 'error', publicUrl: '', temporary: false, message: '建立公网连接超时，请检查网络后重试，或使用已有 HTTPS 域名' }; process.kill(); }
      }, 180000); timeout.unref();
      let output = ''; let checking = false;
      const inspect = data => {
        if (!active()) return;
        output = (output + data.toString()).slice(-12000);
        const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
        if (!url || checking) return;
        checking = true;
        state.message = '隧道已创建，正在验证远端能否访问…';
        void (async () => {
          let error;
          for (let attempt = 0; attempt < 12 && child === process && active(); attempt++) {
            try { const origin = await check(url); if (!active() || child !== process) return; configured = origin; state = { state: 'ready', publicUrl: origin, message: '公网 HTTPS 连接已验证', temporary: true }; clearTimeout(timeout); return; } catch (e) { error = e; await new Promise(r => setTimeout(r, 2000)); }
          }
          if (active() && child === process) { state = { state: 'error', publicUrl: '', temporary: false, message: `隧道尚不可达：${error?.message || '请检查网络'}` }; process.kill(); }
        })();
      };
      process.stdout.on('data', inspect); process.stderr.on('data', inspect);
      process.on('error', e => { clearTimeout(timeout); if (active()) { state = { state: 'error', publicUrl: '', temporary: false, message: `无法启动公网连接：${e.message}` }; child = undefined; } });
      process.on('exit', () => { clearTimeout(timeout); if (!active()) return; child = undefined; if (state.state !== 'error') state = { state: 'error', publicUrl: '', temporary: false, message: `公网隧道已关闭${/failed to request quick Tunnel|timeout|error/i.test(output) ? '，请检查网络后重试' : '，旧邀请链接已失效'}` }; configured = ''; });
    } catch (e) { if (active()) state = { state: 'error', publicUrl: '', temporary: false, message: e.message }; }
  }
  const stop = () => { generation++; child?.kill(); child = undefined; configured = ''; state = { state: 'idle', publicUrl: '', temporary: false, message: '公网分享已关闭' }; };
  httpServer.on('close', stop);
  let envCheck;
  return {
    instanceId,
    async info(req) {
      if (!test && process.env.PUBLIC_BASE_URL && !configured && !envCheck) { envCheck = verify(process.env.PUBLIC_BASE_URL).catch(e => { state.message = `PUBLIC_BASE_URL 验证失败：${e.message}`; }).finally(() => {}); }
      if (envCheck) await envCheck;
      const canManage = localAdmin(req);
      const lanUrls = canManage ? Object.values(networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')).map(n => `http://${n.address}:${currentPort()}`) : [];
      return { ...state, publicUrl: configured || state.publicUrl, canManage, lanUrls, turnConfigured: !!(process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) };
    },
    start() { if (test) throw new Error('测试环境禁止启动外部隧道'); if (['starting', 'ready'].includes(state.state)) return state; generation++; state = { state: 'starting', publicUrl: '', temporary: true, message: '正在准备公网连接…' }; void launch(generation); return state; },
    stop, verify,
  };
}
