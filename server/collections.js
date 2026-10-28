import { randomBytes } from 'node:crypto';
import { safeFetch, publicUrl } from './safe-fetch.js';
import { biliMedia, biliInfo, neteaseMedia, platformJson } from './platforms.js';
import { importResource } from './importers.js';

export function collectionReference(input, { optional = false } = {}) {
  const raw = String(input || '').trim();
  let url;
  try { url = publicUrl(/^BV[a-zA-Z0-9]{10}$/.test(raw) ? `https://www.bilibili.com/video/${raw}/` : raw); }
  catch (error) { if (error instanceof TypeError) throw new Error('请输入 BV 号，或完整的视频、音乐、合集链接'); throw error; }
  if (['www.bilibili.com', 'bilibili.com', 'm.bilibili.com', 'space.bilibili.com'].includes(url.hostname)) {
    const favorite = url.pathname.match(/\/(?:list|medialist\/detail)\/ml(\d+)\/?$/)?.[1] || (/\/favlist\/?$/.test(url.pathname) ? url.searchParams.get('fid') : '');
    if (/^\d{1,20}$/.test(favorite || '')) return { type: 'bili-favorites', id: favorite, url: url.href };
    const bvid = url.pathname.match(/\/video\/(BV[a-zA-Z0-9]{10})\/?$/)?.[1];
    if (bvid) {
      const page = url.searchParams.has('p') ? Number(url.searchParams.get('p')) : undefined;
      if (page !== undefined && (!Number.isInteger(page) || page < 1 || page > 1000)) throw new Error('请使用有效的分 P 序号');
      return { type: 'bili-parts', id: bvid, url: url.href, ...(page === undefined ? {} : { page }) };
    }
  }
  if (['music.163.com', 'www.music.163.com'].includes(url.hostname)) {
    const route = /^#\/?playlist/.test(url.hash) ? new URL(url.hash.slice(1), url.origin) : url;
    const id = route.searchParams.get('id');
    if (/\/((m|my)\/)?playlist\/?$/.test(route.pathname) && /^\d{1,20}$/.test(id || '')) return { type: 'netease', id, url: url.href };
  }
  if (optional) return null;
  throw new Error('请使用 B 站收藏夹 ml 链接、视频分 P 链接，或网易云歌单链接');
}
const unavailable = (id, title, reason) => ({ id, title: title || `条目 ${id}`, unavailable: reason });
export function createCollections({ fetcher = safeFetch, now = Date.now } = {}) {
  const sessions = new Map();
  const json = url => platformJson(url, (value, options) => fetcher(value, { ...options, timeout: 12000, maxBytes: 12 * 1024 * 1024 }));
  const favoritePage = (id, page) => json(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${id}&pn=${page + 1}&ps=20&platform=web`);
  const checkFavorite = data => { if (data.code !== 0 || !data.data?.info || !Array.isArray(data.data.medias) && data.data.info.media_count !== 0) throw new Error(`收藏夹暂不可读取，可能为私密或需要登录（${data.message || data.code}）`); };
  async function page(token, cursor = 0) {
    const session = sessions.get(token);
    if (!session || now() - session.at > 30 * 60000) throw new Error('合集读取已过期，请重新读取链接');
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 2500) throw new Error('合集页码无效');
    if (session.pages.has(cursor)) return session.pages.get(cursor);
    if (cursor > 0 && !session.pages.has(cursor - 1)) throw new Error('请按顺序读取合集页面');
    const { ref } = session; let items, nextCursor = null;
    const warnings = [...(session.warnings || [])];
    if (ref.type === 'bili-favorites') {
      const data = cursor === 0 ? session.first : await favoritePage(ref.id, cursor); checkFavorite(data);
      if (Number(data.data.info.media_count) !== session.total) warnings.push('来源收藏夹在读取期间发生变化，可重新读取以取得最新顺序。');
      items = (data.data.medias || []).map((value, index) => {
        const bvid = value.bvid || value.bv_id;
        if (value.type !== 2 || !/^BV[a-zA-Z0-9]{10}$/.test(bvid || '') || !value.title || value.title === '已失效视频' || (Number(value.attr) & 9)) return unavailable(`unavailable-${cursor}-${value.id || index}`, value.title, '已失效、不可见或暂不支持的条目');
        const media = biliMedia({ bvid, title: value.title, pic: value.cover, duration: value.duration, owner: value.upper, desc: value.intro, stat: { view: value.cnt_info?.play, danmaku: value.cnt_info?.danmaku } });
        delete media.download.available; // List metadata does not contain download permissions.
        return media;
      });
      if (data.data.has_more) {
        if (!items.length) throw new Error('来源返回空页但仍标记有下一页，请重试');
        nextCursor = cursor + 1;
      }
    } else if (ref.type === 'netease') {
      const ids = session.ids.slice(cursor * 50, (cursor + 1) * 50);
      const missing = ids.filter(id => !session.songs.has(id));
      if (missing.length) {
        const data = await json(`https://music.163.com/api/song/detail/?ids=${encodeURIComponent(JSON.stringify(missing))}`);
        if (data.code !== 200 || !Array.isArray(data.songs)) throw new Error('这一批歌曲详情读取失败，可以继续重试');
        for (const song of data.songs) if (song.id && song.name) session.songs.set(String(song.id), song);
      }
      items = ids.map(id => session.songs.has(id) ? neteaseMedia(session.songs.get(id)) : unavailable(`netease-${id}`, `歌曲 ${id}`, '来源未返回详情，可能已下架或无权访问'));
      if ((cursor + 1) * 50 < session.ids.length) nextCursor = cursor + 1;
      if (session.ids.length < session.total) warnings.push(`平台只公开了 ${session.ids.length} / ${session.total} 首的曲目 ID，其余暂不可读取。`);
    } else {
      items = session.items; if (cursor) throw new Error('资源列表没有下一页');
    }
    if (nextCursor === null && ref.type === 'bili-favorites') {
      const received = [...session.pages.values()].reduce((sum, value) => sum + value.items.length, 0) + items.length;
      if (received !== session.total) warnings.push(`来源标示 ${session.total} 项，但实际公开返回 ${received} 项；未返回的内容无法导入。`);
    }
    const result = { session: token, title: session.title, source: session.source || (ref.type === 'netease' ? '网易云音乐' : '哔哩哔哩'), url: ref.url, total: session.total, items, nextCursor, complete: nextCursor === null, warnings };
    session.pages.set(cursor, result); return result;
  }
  return {
    async start(url) {
      for (const [key, value] of sessions) if (now() - value.at > 30 * 60000) sessions.delete(key);
      while (sessions.size >= 12) sessions.delete(sessions.keys().next().value);
      const ref = collectionReference(url, { optional: true }) || { type: 'single', url }; const session = { ref, at: now(), pages: new Map() };
      if (ref.type === 'bili-favorites') {
        session.first = await favoritePage(ref.id, 0); checkFavorite(session.first);
        session.title = String(session.first.data.info.title || 'B 站收藏夹').slice(0, 150); session.total = Number(session.first.data.info.media_count) || 0;
      } else if (ref.type === 'netease') {
        const data = await json(`https://music.163.com/api/v6/playlist/detail?id=${ref.id}&n=100000&s=0`);
        const playlist = data.playlist;
        if (data.code !== 200 || !playlist || !Array.isArray(playlist.trackIds)) throw new Error('歌单暂不可读取，可能为私密、已删除或需要登录');
        session.title = String(playlist.name || '网易云歌单').slice(0, 150); session.total = Number(playlist.trackCount) || 0;
        session.ids = [...new Set(playlist.trackIds.map(value => String(value.id)).filter(id => /^\d{1,20}$/.test(id)))];
        session.songs = new Map((playlist.tracks || []).filter(song => song.id && song.name).map(song => [String(song.id), song]));
      } else if (ref.type === 'bili-parts') {
        const data = await biliInfo(ref.id, fetcher), parts = data.pages?.length ? data.pages : [{ page: 1, part: data.title }];
        const chosen = ref.page === undefined ? parts : parts.filter(part => Number(part.page) === ref.page);
        if (!chosen.length) throw new Error('此视频没有指定的分 P，请检查链接中的 p 参数');
        session.title = data.title; session.total = chosen.length;
        session.items = chosen.map(part => { const media = biliMedia(data, Number(part.page)); return { ...media, id: parts.length > 1 ? `${media.id}-p${part.page}` : media.id, title: parts.length > 1 ? `${data.title} · P${part.page} ${part.part || ''}` : data.title }; });
      } else {
        const { resource, warning } = await importResource({ url }, { fetcher });
        // A shared link to a specific Bilibili part must keep the same identity as collection imports.
        if (resource.download?.provider === 'bilibili' && (resource.episodes?.length > 1 || resource.download.page > 1)) resource.id += `-p${resource.download.page}`;
        session.title = resource.title; session.source = resource.platform; session.total = 1;
        session.items = [resource]; session.warnings = warning ? [warning] : [];
        session.ref.url = resource.url;
      }
      if (session.total > 50000) throw new Error('集合超过 50000 项，请在来源平台拆分后导入');
      const token = randomBytes(24).toString('hex'); sessions.set(token, session); return page(token, 0);
    },
    page,
  };
}
