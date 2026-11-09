import { safeFetch } from './safe-fetch.js';
import { platformJson } from './platforms.js';

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
const clean = (value, max = 300) => String(value == null ? '' : value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, max);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Parse an LRC file into a flat, time-sorted line list. Pure and unit-testable. */
export function parseLrc(text, translationText = '') {
  const build = raw => {
    const source = String(raw == null ? '' : raw).slice(0, 256 * 1024);
    const offsetTag = /\[offset:\s*([+-]?\d{1,6})\s*\]/i.exec(source);
    const offset = offsetTag ? clamp(Number(offsetTag[1]) / 1000, -60, 60) : 0;
    const lines = [];
    for (const row of source.split(/\r?\n/)) {
      const tags = [...row.matchAll(TIME_TAG)];
      if (!tags.length) continue;
      const content = clean(row.replace(TIME_TAG, ''));
      if (lines.length >= 3000) break;
      for (const tag of tags) {
        const minutes = Number(tag[1]), seconds = Number(tag[2]);
        if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) continue;
        const fraction = tag[3] ? Number(`0.${tag[3]}`) : 0;
        const time = minutes * 60 + seconds + fraction + offset;
        if (!Number.isFinite(time) || time < 0 || time > 86400) continue;
        lines.push({ time: Math.round(time * 1000) / 1000, text: content });
      }
    }
    return lines.sort((a, b) => a.time - b.time).slice(0, 2000);
  };
  const lines = build(text);
  const translated = build(translationText);
  if (translated.length) {
    const byTime = new Map();
    for (const line of translated) if (line.text && !byTime.has(Math.round(line.time * 100))) byTime.set(Math.round(line.time * 100), line.text);
    for (const line of lines) {
      const value = byTime.get(Math.round(line.time * 100));
      if (value && value !== line.text) line.translation = value;
    }
  }
  return lines;
}

function neteaseSongId(media) {
  const fromId = /^netease-(\d{1,20})$/.exec(String(media?.id || ''));
  if (fromId) return fromId[1];
  for (const value of [media?.url, media?.playbackUrl]) {
    try {
      const url = new URL(value);
      if (!['music.163.com', 'www.music.163.com'].includes(url.hostname)) continue;
      const route = url.hash && /^#\/?song/.test(url.hash) ? new URL(url.hash.slice(1).replace(/^\/?/, '/'), url.origin) : url;
      const id = route.searchParams.get('id');
      if (/^\d{1,20}$/.test(id || '')) return id;
    } catch { /* Not a usable URL. */ }
  }
  return '';
}
function qqSongId(media) {
  const fromId = /^qqmusic-([a-zA-Z0-9]{14})$/.exec(String(media?.id || ''));
  let mid = fromId ? fromId[1] : '';
  let numeric = '';
  for (const value of [media?.url, media?.playbackUrl]) {
    try {
      const url = new URL(value);
      if (!/^(?:y|i|c|u)\.qq\.com$/.test(url.hostname)) continue;
      mid = mid || (/^[a-zA-Z0-9]{14}$/.test(url.searchParams.get('songmid') || '') ? url.searchParams.get('songmid') : '');
      numeric = numeric || (/^\d{1,15}$/.test(url.searchParams.get('songid') || '') ? url.searchParams.get('songid') : '');
      const path = /\/songDetail\/([a-zA-Z0-9]{14})/.exec(url.pathname)?.[1];
      mid = mid || path || '';
    } catch { /* Not a usable URL. */ }
  }
  return mid ? { mid, numeric } : null;
}

/** Resolve lyrics for a media item. Only allowlisted platform endpoints are fetched. */
export function createLyrics({ fetcher = safeFetch } = {}) {
  const cache = new Map();
  return {
    async resolve(input = {}) {
      const media = input.media && typeof input.media === 'object' ? input.media : {};
      const key = clean(input.key || media.id || `${media.url || ''}|${media.title || ''}`, 160);
      if (cache.has(key)) return cache.get(key);
      let result = { lines: [], source: '', reason: '这首作品暂时没有可用歌词' };
      const direct = typeof input.lrc === 'string' ? input.lrc : '';
      if (direct.trim()) {
        result = { lines: parseLrc(direct, typeof input.translation === 'string' ? input.translation : ''), source: '内嵌歌词', reason: '' };
        if (!result.lines.length) result = { lines: [], source: '', reason: '歌词文件格式无法识别' };
      } else {
        const netease = neteaseSongId(media);
        const qq = qqSongId(media);
        if (netease) {
          try {
            const data = await platformJson(`https://music.163.com/api/song/lyric?id=${netease}&lv=1&kv=1&tv=-1`, fetcher);
            const lines = parseLrc(data?.lrc?.lyric, data?.tlyric?.lyric);
            result = lines.length ? { lines, source: '网易云音乐', reason: '' } : { lines: [], source: '', reason: '这首歌暂时没有提供歌词' };
          } catch (error) { result = { lines: [], source: '', reason: clean(error.message, 120) || '歌词暂时读取失败' }; }
        } else if (qq) {
          try {
            const query = new URLSearchParams({ songmid: qq.mid, format: 'json', nobase64: '1' });
            if (qq.numeric) query.set('songid', qq.numeric);
            const data = await platformJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${query}`, fetcher);
            const lines = parseLrc(data?.lyric, data?.trans);
            result = lines.length ? { lines, source: 'QQ音乐', reason: '' } : { lines: [], source: '', reason: '这首歌暂时没有提供歌词' };
          } catch (error) { result = { lines: [], source: '', reason: clean(error.message, 120) || '歌词暂时读取失败' }; }
        }
      }
      if (result.lines.length) result.reason = '';
      if (cache.size > 120) cache.clear();
      cache.set(key, result);
      return result;
    },
  };
}
