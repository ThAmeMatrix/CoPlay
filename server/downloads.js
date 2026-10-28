import { createHash, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { safeFetch, safeStream, publicUrl } from './safe-fetch.js';
import { biliInfo, platformJson } from './platforms.js';

export const biliMediaHost = host => /(?:^|\.)bilivideo\.(?:com|cn)$/.test(host);
export function downloadFilename(title, suffix = '') {
  const base = String(title || '哔哩哔哩视频').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[ .]+$/g, '').slice(0, 90) || '视频';
  return `${/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(base) ? '_' : ''}${base}${suffix}.mp4`;
}
function validMediaResponse(stream) {
  if (/text\/|json|xml|html/i.test(stream.headers['content-type'] || '')) {
    stream.destroy(); throw new Error('平台返回的不是视频文件，当前无法下载');
  }
}
export function createDownloads({ fetcher = safeFetch, streamer = safeStream, now = Date.now, library } = {}) {
  const tickets = new Map();
  function cleanup() { for (const [key, value] of tickets) if (value.expiresAt <= now()) tickets.delete(key); }
  return {
    async prepare(input, signal) {
      cleanup();
      const page = Number(input.page || 1);
      if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('分 P 编号无效');
      const data = await biliInfo(input.bvid, fetcher);
      if (data.rights?.download !== 1 || data.rights?.pay || data.rights?.ugc_pay || data.rights?.arc_pay) throw new Error('平台未开放此视频的公开下载，可继续使用官方播放器观看');
      const part = (data.pages || []).find(p => Number(p.page) === page) || (page === 1 && !data.pages?.length ? { cid: data.cid, duration: data.duration } : null);
      if (!part?.cid) throw new Error('找不到这个分 P，请重新导入视频');
      const json = await platformJson(`https://api.bilibili.com/x/player/playurl?bvid=${data.bvid}&cid=${part.cid}&qn=32&fnval=0&platform=html5`, fetcher);
      const play = json.data;
      if (json.code !== 0 || !play || play.is_preview || !Array.isArray(play.durl) || !play.durl.length) throw new Error('平台没有提供可下载的视频文件，可能需要登录或仅支持官方播放');
      if (play.durl.length > 8 || !/^mp4/.test(play.format || '')) throw new Error('此视频暂未提供 MP4 下载版本，请在官方播放器观看');
      const length = play.durl.reduce((sum, p) => sum + (Number(p.length) || 0), 0);
      if (part.duration && length && length < part.duration * 900) throw new Error('平台仅提供试看片段，未生成完整视频下载');
      const files = play.durl.map((v, i) => {
        const url = publicUrl(String(v.url || '').replace(/^http:/, 'https:'));
        if (!biliMediaHost(url.hostname)) throw new Error('平台返回了无法识别的下载地址');
        if (!Number.isSafeInteger(v.size) || v.size <= 0 || v.size > 8 * 1024 ** 3) throw new Error('视频文件大小无效或超过 8 GB');
        const suffix = `${data.pages?.length > 1 ? `-P${page}` : ''}${play.durl.length > 1 ? `-分段${i + 1}` : ''}`;
        return { url: url.href, filename: downloadFilename(data.title, suffix), size: v.size };
      });
      // Check access before presenting a save link; only request the first byte.
      const probe = await streamer(files[0].url, { range: 'bytes=0-0', referer: 'https://www.bilibili.com/', signal, allowHost: biliMediaHost });
      validMediaResponse(probe); probe.destroy();
      if (signal?.aborted) throw new Error('下载准备已取消');
      while (tickets.size + files.length > 80) tickets.delete(tickets.keys().next().value);
      const expiresAt = now() + 10 * 60 * 1000;
      const group = createHash('sha256').update(`${part.cid}:${files.map(file => file.size).join(',')}`).digest('hex');
      const downloads = files.map((file, segment) => {
        const token = randomBytes(24).toString('hex');
        tickets.set(token, { ...file, expiresAt, key: `bili:${data.bvid}:p${page}`, group, segment, segmentCount: files.length, page, title: data.title });
        return { url: `/api/downloads/${token}/file`, filename: file.filename, size: file.size };
      });
      return { downloads, expiresAt, quality: ({ 16: '360P', 32: '480P', 64: '720P', 80: '1080P' })[play.quality] || 'MP4', message: files.length > 1 ? '平台提供多个视频分段，请逐个保存。' : '视频已就绪，点击保存到电脑。' };
    },
    async send(req, res) {
      cleanup();
      const ticket = tickets.get(req.params.token);
      if (!ticket) return res.status(410).json({ error: '下载链接已过期，请重新点击准备下载' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({ error: '下载请求来源无效' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '下载仅可从本机应用发起' });
      const range = req.headers.range;
      const match = typeof range === 'string' ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
      if (range && (!match || Number(match[1]) >= ticket.size || match[2] && (Number(match[2]) < Number(match[1]) || Number(match[2]) >= ticket.size))) return res.status(416).set('Content-Range', `bytes */${ticket.size}`).end();
      const abort = new AbortController();
      res.once('close', () => { if (!res.writableFinished) abort.abort(); });
      let stream, capture;
      try {
        stream = await streamer(ticket.url, { range, referer: 'https://www.bilibili.com/', signal: abort.signal, allowHost: biliMediaHost });
        validMediaResponse(stream);
        const size = Number(stream.headers['content-length']);
        if (size && size > ticket.size) throw new Error('平台返回的文件大小发生变化，请重新准备下载');
        const fullResponse = stream.statusCode === 200 || (stream.statusCode === 206 && stream.headers['content-range'] === `bytes 0-${ticket.size - 1}/${ticket.size}`);
        if (library && fullResponse) capture = await library.begin(ticket);
        res.status(stream.statusCode || 200);
        res.set('Content-Type', 'video/mp4');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Content-Disposition', `attachment; filename="bilibili-video.mp4"; filename*=UTF-8''${encodeURIComponent(ticket.filename).replace(/'/g, '%27')}`);
        if (size) res.set('Content-Length', String(size));
        if (stream.headers['content-range']) res.set('Content-Range', stream.headers['content-range']);
        res.set('Accept-Ranges', 'bytes');
        let bytes = 0;
        const bound = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > ticket.size ? new Error('视频传输超过声明的文件大小') : null, chunk); } });
        if (capture) await pipeline(stream, bound, capture.transform, res, { signal: abort.signal });
        else await pipeline(stream, bound, res, { signal: abort.signal });
        await capture?.commit();
      } catch (e) {
        stream?.destroy();
        await capture?.abort();
        if (!res.headersSent && !res.destroyed) res.status(502).json({ error: e.message });
        else res.destroy();
      }
    },
  };
}
