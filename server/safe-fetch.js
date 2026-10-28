import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import ipaddr from 'ipaddr.js';

export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function publicUrl(input) {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) throw new Error('来源必须是公开的 HTTP / HTTPS 地址');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || /\.(localhost|local|internal)$/i.test(hostname) || ipaddr.isValid(hostname) && !publicAddress(hostname)) throw new Error('不能读取本地或内网地址');
  return url;
}
const trustedCertificates = typeof tls.getCACertificates === 'function'
  ? [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]
  : undefined;
export function sourceError(error) {
  const code = error.code || '';
  let message = error.message;
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) message = '来源域名解析失败，请检查网络或站点地址';
  else if (['CERT_HAS_EXPIRED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) message = '来源证书验证失败，请检查站点证书或系统信任设置';
  else if (code === 'EPROTO') message = '来源 TLS 握手失败，当前网络无法与该站建立 HTTPS 连接';
  else if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) message = '来源连接超时或被中断，请稍后重试';
  return Object.assign(new Error(message), { code, status: error.status, retryAfter: error.retryAfter });
}
// DNS, all connection attempts and redirects share one deadline. Each public
// address is validated and pinned; certificate and hostname checks stay enabled.
export async function safeFetch(input, { maxBytes = 4 * 1024 * 1024, timeout = 8000, redirects = 3, deadline = Date.now() + timeout } = {}) {
  const url = publicUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let dnsTimer;
  const remaining = () => Math.max(1, deadline - Date.now());
  const timeoutError = () => Object.assign(new Error('来源连接超时，请稍后重试'), { code: 'ETIMEDOUT' });
  if (Date.now() >= deadline) throw timeoutError();
  let addresses;
  try {
    addresses = await Promise.race([lookup(hostname, { all: true }), new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(timeoutError()), remaining()); })]);
  } catch (e) { throw sourceError(e); } finally { clearTimeout(dnsTimer); }
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('来源地址解析到非公网网络');
  const candidates = addresses.sort((a, b) => a.family - b.family).slice(0, 2);
  const attempt = address => new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(url, {
      agent: false, ...(url.protocol === 'https:' && trustedCertificates ? { ca: trustedCertificates } : {}),
      lookup: (_hostname, opts, cb) => opts.all ? cb(null, [address]) : cb(null, address.address, address.family),
      headers: { 'User-Agent': 'CoPlay/1.1 (+resource-metadata)', Accept: 'application/json,text/html;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'identity' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); resolve({ redirect: new URL(res.headers.location, url).href }); return; }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume(); const status = res.statusCode;
        const message = status === 403 ? '来源拒绝访问（403），可前往原站确认访问要求' : status === 429 ? '来源请求过于频繁（429），稍后自动重试' : `来源返回 HTTP ${status}，暂时无法读取`;
        reject(Object.assign(new Error(message), { status, retryAfter: Number(res.headers['retry-after']) || 60 })); return;
      }
      const buffers = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) req.destroy(new Error('来源页面过大')); else buffers.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ body: Buffer.concat(buffers), url: url.href, contentType: res.headers['content-type'] || '' }));
    });
    let timer = setTimeout(() => req.destroy(timeoutError()), Math.min(remaining(), candidates.length > 1 ? Math.max(1000, timeout / 2) : timeout));
    // Once connected, allow a slow search response to use the shared deadline.
    // The shorter first timer only reserves time for another connection address.
    req.once('socket', socket => socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer); timer = setTimeout(() => req.destroy(timeoutError()), remaining());
    }));
    req.on('error', reject); req.on('close', () => clearTimeout(timer));
  });
  let result;
  for (const address of candidates) {
    try { result = await attempt(address); break; }
    catch (e) { if (e.status || !['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPROTO'].includes(e.code) || address === candidates.at(-1) || Date.now() >= deadline) throw sourceError(e); }
  }
  if (result.redirect) { if (!redirects) throw new Error('来源重定向次数过多'); return safeFetch(result.redirect, { maxBytes, timeout, redirects: redirects - 1, deadline }); }
  return result;
}

// Media is streamed with backpressure instead of collected in the metadata
// buffer. Every redirect is checked and DNS is pinned just like safeFetch.
export async function safeStream(input, { range, referer, signal, redirects = 3, allowHost = () => true } = {}) {
  const url = publicUrl(input);
  if (!allowHost(url.hostname)) throw new Error('媒体下载地址不属于来源平台');
  if (range && !/^bytes=\d+-\d*$/.test(range)) throw new Error('下载范围无效');
  if (signal?.aborted) throw new Error('下载已取消');
  let dnsTimer;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('媒体域名解析超时')), 8000); }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('媒体地址解析到非公网网络');
  const candidates = addresses.sort((a, b) => a.family - b.family).slice(0, 2);
  let response;
  for (const address of candidates) {
    if (signal?.aborted) throw new Error('下载已取消');
    try {
      response = await new Promise((resolve, reject) => {
        const req = (url.protocol === 'https:' ? https : http).get(url, {
          agent: false, ...(url.protocol === 'https:' && trustedCertificates ? { ca: trustedCertificates } : {}),
          lookup: (_hostname, opts, cb) => opts.all ? cb(null, [address]) : cb(null, address.address, address.family),
          headers: { 'User-Agent': 'Mozilla/5.0 CoPlay/1.1', 'Accept-Encoding': 'identity', ...(referer ? { Referer: referer } : {}), ...(range ? { Range: range } : {}) },
        }, res => {
          clearTimeout(timer);
          res.on('error', () => {});
          res.once('close', () => signal?.removeEventListener('abort', cancel));
          resolve(res);
        });
        const cancel = () => req.destroy(new Error('下载已取消'));
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => req.destroy(Object.assign(new Error('媒体连接超时'), { code: 'ETIMEDOUT' })), 10000);
        req.setTimeout(20000, () => req.destroy(new Error('媒体传输超时，请重新下载')));
        req.on('error', reject);
        req.once('close', () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); });
      });
      break;
    } catch (e) {
      if (signal?.aborted || address === candidates.at(-1)) throw sourceError(e);
    }
  }
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.destroy();
    if (!redirects) throw new Error('媒体重定向次数过多');
    return safeStream(new URL(response.headers.location, url).href, { range, referer, signal, redirects: redirects - 1, allowHost });
  }
  if (![200, 206].includes(response.statusCode)) {
    response.destroy();
    throw new Error(`平台媒体返回 HTTP ${response.statusCode}，请稍后重试或前往原站`);
  }
  if (signal?.aborted) { response.destroy(); throw new Error('下载已取消'); }
  return response;
}
