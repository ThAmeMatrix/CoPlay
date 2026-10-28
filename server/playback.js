import { randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { safeFetch, safeStream, publicUrl } from './safe-fetch.js';
import { biliInfo, platformJson } from './platforms.js';
import { biliMediaHost } from './downloads.js';

function videoResponse(stream) {
  if (!/^(video\/mp4|application\/octet-stream|binary\/octet-stream)(;|$)/i.test(stream.headers['content-type'] || '')) {
    stream.destroy(); throw new Error('B 站未返回可播放的视频数据，请切换官方播放器');
  }
}

export function playbackRange(value, size) {
  if (value === undefined) return undefined;
  const match = typeof value === 'string' && /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || !match[1] && !match[2]) return null;
  const first = Number(match[1]), last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  if (!match[1]) return last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null;
  if (first >= size || match[2] && last < first) return null;
  return { start: first, end: match[2] ? Math.min(last, size - 1) : size - 1 };
}

// Playback only accepts a BV identifier. CDN URLs stay on the server and are
// checked again on every request and redirect by safeStream.
export function createPlayback({ fetcher = safeFetch, streamer = safeStream, now = Date.now } = {}) {
  const tickets = new Map();
  const cleanup = () => { for (const [key, value] of tickets) if (value.expiresAt <= now()) tickets.delete(key); };
  const canceled = signal => { if (signal?.aborted) throw new Error('播放准备已取消'); };
  return {
    async prepare(input, signal) {
      cleanup(); canceled(signal);
      const page = Number(input.page ?? 1);
      if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('分 P 编号无效');
      const data = await biliInfo(input.bvid, fetcher);
      canceled(signal);
      if (data.state < 0 || data.rights?.pay || data.rights?.ugc_pay || data.rights?.arc_pay) throw new Error('此视频需要在 B 站确认播放权限，请使用官方播放器');
      const part = (data.pages || []).find(p => Number(p.page) === page) || (page === 1 && !data.pages?.length ? { cid: data.cid, duration: data.duration } : null);
      if (!part?.cid) throw new Error('找不到这个分 P，请重新打开视频详情');
      const json = await platformJson(`https://api.bilibili.com/x/player/playurl?bvid=${data.bvid}&cid=${part.cid}&qn=32&fnval=0&platform=html5`, fetcher);
      canceled(signal);
      const play = json.data;
      if (json.code !== 0 || !play || play.is_preview || play.is_drm || !/^mp4/.test(play.format || '') || play.durl?.length !== 1) throw new Error('B 站暂未提供完整的公开 MP4 播放版本，请使用官方播放器');
      const file = play.durl[0];
      if (!Number.isFinite(file.length) || file.length <= 0 || part.duration && file.length < part.duration * 900) throw new Error('B 站仅提供试看片段，请使用官方播放器');
      if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 8 * 1024 ** 3) throw new Error('此视频大小暂不支持本机播放，请使用官方播放器');
      const url = publicUrl(String(file.url || '').replace(/^http:/, 'https:'));
      if (!biliMediaHost(url.hostname)) throw new Error('B 站返回了无法识别的媒体地址');
      const probe = await streamer(url.href, { range: 'bytes=0-0', referer: 'https://www.bilibili.com/', signal, allowHost: biliMediaHost });
      videoResponse(probe); probe.destroy(); canceled(signal);
      while (tickets.size >= 80) tickets.delete(tickets.keys().next().value);
      const token = randomBytes(24).toString('hex');
      const expiresAt = now() + 2 * 60 * 60 * 1000;
      tickets.set(token, { url: url.href, size: file.size, expiresAt });
      return { url: `/api/playback/${token}/video`, expiresAt, duration: file.length / 1000, quality: ({ 16: '360P', 32: '480P', 64: '720P', 80: '1080P' })[play.quality] || 'MP4', page };
    },
    async send(req, res) {
      cleanup();
      const ticket = tickets.get(req.params.token);
      if (!ticket) return res.status(410).json({ error: '播放地址已过期，请点击重新播放' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '仅可从本机应用播放' });
      const range = playbackRange(req.headers.range, ticket.size);
      if (range === null) return res.status(416).set('Content-Range', `bytes */${ticket.size}`).end();
      const headers = () => {
        res.set('Content-Type', 'video/mp4'); res.set('Content-Disposition', 'inline');
        res.set('Accept-Ranges', 'bytes'); res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'private, no-store');
      };
      if (req.method === 'HEAD') { headers(); return res.status(200).set('Content-Length', String(ticket.size)).end(); }
      const abort = new AbortController(); res.once('close', () => abort.abort());
      let stream;
      try {
        stream = await streamer(ticket.url, { range: range ? `bytes=${range.start}-${range.end}` : undefined, referer: 'https://www.bilibili.com/', signal: abort.signal, allowHost: biliMediaHost });
        videoResponse(stream);
        let expected = ticket.size;
        if (range) {
          const received = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(stream.headers['content-range'] || '');
          if (stream.statusCode !== 206 || !received || Number(received[1]) !== range.start || Number(received[2]) < range.start || Number(received[2]) > range.end || Number(received[3]) !== ticket.size) throw new Error('B 站暂未返回正确的视频片段，请重试');
          expected = Number(received[2]) - range.start + 1;
          res.set('Content-Range', stream.headers['content-range']);
        } else if (stream.statusCode !== 200) throw new Error('B 站返回的视频响应不完整，请重试');
        if (stream.headers['content-length'] !== undefined && Number(stream.headers['content-length']) !== expected) throw new Error('视频大小发生变化，请重新播放');
        headers(); res.status(range ? 206 : 200).set('Content-Length', String(expected));
        let bytes = 0;
        const bound = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > expected ? new Error('视频片段超过声明大小') : null, chunk); }, flush(callback) { callback(bytes !== expected ? new Error('视频片段传输中断') : null); } });
        await pipeline(stream, bound, res, { signal: abort.signal });
      } catch (e) {
        stream?.destroy();
        if (!res.headersSent && !res.destroyed) { res.removeHeader('Content-Range'); res.removeHeader('Content-Length'); res.status(502).json({ error: e.message }); }
        else res.destroy();
      }
    },
  };
}
