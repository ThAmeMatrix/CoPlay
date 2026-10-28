import { safeFetch, publicUrl } from './safe-fetch.js';
import { load } from 'cheerio';
import { readStaticAssignment } from './static-data.js';

const BILI = /\b(BV[a-zA-Z0-9]{10})\b/;
const biliHosts = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'player.bilibili.com']);
const qqHosts = new Set(['y.qq.com', 'www.y.qq.com', 'i.y.qq.com', 'c.y.qq.com']);
const shorts = new Map([['b23.tv', 'bilibili'], ['163cn.tv', 'netease'], ['c.y.qq.com', 'qqmusic']]);
const clean = (value, max = 2000) => load(`<body>${String(value || '')}</body>`)('body').text().trim().slice(0, max);
const cover = value => typeof value === 'string' && /^(?:https?:)?\/\//.test(value) ? value.replace(/^\/\//, 'https://').replace(/^http:/, 'https:') : '';
const duration = seconds => `${Math.floor((Number(seconds) || 0) / 60)}:${String(Math.floor((Number(seconds) || 0) % 60)).padStart(2, '0')}`;
const base = (id, platform, kind, title, url) => ({ id, platform, kind, title: clean(title, 150), url, subtitle: platform, cover: '', duration: '查看详情', tags: [platform], description: '', playbackType: 'embed', live: true });
export const qqEndpoint = data => `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(data))}`;
export async function platformJson(url, fetcher = safeFetch) {
  const response = await fetcher(url);
  try { return JSON.parse(response.body.toString('utf8')); } catch { throw new Error('平台未返回有效的数据，请稍后重试'); }
}

export function platformReference(input) {
  const raw = String(input || '').trim();
  const url = new URL(/^BV[a-zA-Z0-9]{10}$/.test(raw) ? `https://www.bilibili.com/video/${raw}` : raw);
  publicUrl(url.href);
  if (biliHosts.has(url.hostname)) {
    const bvid = url.pathname.match(BILI)?.[1] || url.searchParams.get('bvid');
    const episode = url.pathname.match(/\bep(\d+)\b/)?.[1];
    const season = url.pathname.match(/\bss(\d+)\b/)?.[1];
    if (bvid && /^BV[a-zA-Z0-9]{10}$/.test(bvid)) return { platform: 'bilibili', bvid, page: Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1))), url };
    if (episode || season) return { platform: 'bilibili', episode, season, url };
    throw new Error('请使用 B 站 BV 号、视频链接或番剧 ep / ss 链接');
  }
  if (['music.163.com', 'www.music.163.com'].includes(url.hostname)) {
    const route = /^#\/?(?:song|playlist)/.test(url.hash) ? new URL(url.hash.slice(1).replace(/^\/?/, '/'), url.origin) : url;
    const id = route.searchParams.get('id');
    const playlist = /\/(?:m\/)?playlist\/?$/.test(route.pathname);
    if (!/^\d{1,20}$/.test(id || '') || !/\/(?:m\/)?(?:song|playlist)\/?$/.test(route.pathname)) throw new Error('请使用包含 id 的网易云单曲或歌单链接');
    return { platform: 'netease', id, playlist, url };
  }
  if (qqHosts.has(url.hostname)) {
    const key = url.searchParams.get('songmid') || url.searchParams.get('songid') || url.pathname.match(/\/(?:songDetail|song)\/([a-zA-Z0-9]+)(?:\.html)?(?:\/|$)/)?.[1];
    if (key && /^(?:\d{1,15}|[a-zA-Z0-9]{14})$/.test(key)) return { platform: 'qqmusic', key, url };
    if (url.hostname !== 'c.y.qq.com' || !url.pathname.startsWith('/base/fcgi-bin/u')) throw new Error('请使用 QQ 音乐单曲详情页或分享链接');
  }
  return { platform: '', url };
}

export async function resolveReference(input, fetcher = safeFetch) {
  let ref;
  try { ref = platformReference(input); } catch (e) {
    if (e instanceof TypeError) throw new Error('请输入 BV 号，或完整的 https:// 视频 / 音乐链接');
    throw e;
  }
  const expected = shorts.get(ref.url.hostname);
  if (expected && !ref.platform) {
    const response = await fetcher(ref.url.href, { maxBytes: 4 * 1024 * 1024 });
    ref = platformReference(response.url);
    if (ref.platform !== expected) throw new Error('分享链接未跳转到对应平台的资源详情页');
  }
  return ref;
}

export function biliMedia(data, page = 1) {
  if (!/^BV[a-zA-Z0-9]{10}$/.test(data.bvid || '') || !data.title) throw new Error('B 站未返回有效的视频信息');
  const pages = (data.pages || []).slice(0, 1000);
  const selected = pages.findIndex(p => Number(p.page) === page);
  if (pages.length && selected < 0) throw new Error('此视频没有指定的分 P，请检查链接中的 p 参数');
  let episode = '';
  try { const redirect = new URL(data.redirect_url); if (redirect.protocol === 'https:' && ['www.bilibili.com', 'bilibili.com'].includes(redirect.hostname) && !redirect.username && !redirect.password) episode = redirect.pathname.match(/^\/bangumi\/play\/ep(\d+)\/?$/)?.[1] || ''; } catch { /* Regular BV videos have no episode redirect. */ }
  const player = p => `https://player.bilibili.com/player.html?${episode ? `episodeId=${episode}` : `bvid=${data.bvid}&p=${p}`}&autoplay=0&danmaku=1`;
  return { ...base(`bili-${data.bvid}`, '哔哩哔哩', '视频', data.title, episode ? `https://www.bilibili.com/bangumi/play/ep${episode}` : `https://www.bilibili.com/video/${data.bvid}/?p=${page}`),
    subtitle: clean(data.owner?.name, 100) || '哔哩哔哩', cover: cover(data.pic), duration: duration(data.duration),
    description: clean(data.desc), tags: ['B 站视频', ...(data.tname ? [clean(data.tname, 30)] : [])],
    playbackUrl: player(page), defaultEpisode: Math.max(0, selected),
    episodes: pages.length > 1 ? pages.map(p => ({ title: `P${p.page} · ${clean(p.part, 100)}`, url: player(p.page), page: Number(p.page) })) : [],
    download: { provider: 'bilibili', bvid: data.bvid, page, available: data.rights?.download === 1 && !data.rights?.pay && !data.rights?.ugc_pay && !data.rights?.arc_pay },
    stats: { views: data.stat?.view, danmaku: data.stat?.danmaku, comments: data.stat?.reply, favorites: data.stat?.favorite } };
}
export async function biliInfo(bvid, fetcher = safeFetch) {
  if (!/^BV[a-zA-Z0-9]{10}$/.test(bvid || '')) throw new Error('BV 号格式不正确');
  const d = await platformJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, fetcher);
  if (d.code !== 0 || !d.data) throw new Error(`B 站暂时无法读取此视频：${clean(d.message, 100) || d.code}`);
  return d.data;
}
export function neteaseMedia(song) {
  if (!song.id || !song.name) throw new Error('网易云未返回单曲信息');
  const album = song.album || song.al || {};
  const artists = (song.artists || song.ar || []).map(a => clean(a.name, 80)).join(' / ');
  return { ...base(`netease-${song.id}`, '网易云音乐', '音乐', song.name, `https://music.163.com/song?id=${song.id}`),
    subtitle: artists || '网易云音乐', cover: cover(album.picUrl), duration: duration((song.duration || song.dt) / 1000),
    description: [artists, album.name && `专辑：${clean(album.name)}`].filter(Boolean).join(' · '),
    tags: ['单曲', '网易云音乐'], playbackUrl: `https://music.163.com/outchain/player?type=2&id=${song.id}&auto=0&height=66` };
}
export function qqMedia(song) {
  if (!song.id || !song.mid || !song.name) throw new Error('QQ 音乐未返回单曲信息');
  const artists = (song.singer || []).map(a => clean(a.name, 80)).join(' / ');
  return { ...base(`qqmusic-${song.mid}`, 'QQ音乐', '音乐', song.name, `https://y.qq.com/n/ryqq/songDetail/${song.mid}`),
    subtitle: artists || 'QQ音乐', cover: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${encodeURIComponent(song.album.mid)}.jpg` : '',
    duration: duration(song.interval), year: song.time_public?.slice(0, 4),
    description: [artists, song.album?.name && `专辑：${clean(song.album.name)}`, song.subtitle].filter(Boolean).join(' · '),
    tags: ['单曲', 'QQ音乐'], playbackUrl: `https://i.y.qq.com/n2/m/outchain/player/index.html?songid=${song.id}&songtype=${Number(song.type) || 0}` };
}
export async function importPlatform(ref, fetcher = safeFetch) {
  if (ref.platform === 'bilibili') {
    if (ref.bvid) return { resource: biliMedia(await biliInfo(ref.bvid, fetcher), ref.page), warning: '' };
    const key = ref.episode ? `ep${ref.episode}` : `ss${ref.season}`;
    return { resource: { ...base(`bili-${key}`, '哔哩哔哩', '动漫', `哔哩哔哩番剧 · ${key}`, `https://www.bilibili.com/bangumi/play/${key}`), playbackUrl: `https://player.bilibili.com/player.html?${ref.episode ? `episodeId=${ref.episode}` : `seasonId=${ref.season}`}&autoplay=0&danmaku=1` }, warning: '番剧使用 B 站官方播放器，播放权限以平台为准。' };
  }
  if (ref.platform === 'netease') {
    if (ref.playlist) {
      const d = await platformJson(`https://music.163.com/api/playlist/detail?id=${ref.id}&n=1000`, fetcher);
      if (d.code !== 200 || !d.result) throw new Error('网易云歌单不可用，可能为私密歌单或已删除');
      const p = d.result;
      const tracks = (p.tracks || []).slice(0, 1000).map(neteaseMedia);
      return { resource: { ...base(`netease-playlist-${ref.id}`, '网易云音乐', '音乐', p.name, `https://music.163.com/playlist?id=${ref.id}`), cover: cover(p.coverImgUrl), subtitle: clean(p.creator?.nickname) || '网易云歌单', description: clean(p.description), duration: `${p.trackCount || tracks.length} 首`, playbackUrl: `https://music.163.com/outchain/player?type=0&id=${ref.id}&auto=0&height=430`, episodes: tracks.map(t => ({ title: `${t.title} · ${t.subtitle}`, url: t.playbackUrl })), tags: ['歌单', '网易云音乐'] }, warning: '已读取歌单曲目，可选曲播放；实际可播放范围由网易云提供。' };
    }
    const d = await platformJson(`https://music.163.com/api/song/detail/?id=${ref.id}&ids=${encodeURIComponent(JSON.stringify([ref.id]))}`, fetcher);
    if (d.code !== 200 || !d.songs?.length) throw new Error('网易云没有找到这首歌，请检查链接中的 id');
    return { resource: neteaseMedia(d.songs[0]), warning: '' };
  }
  if (ref.platform === 'qqmusic') {
    const d = await platformJson(qqEndpoint({ song: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: /^\d+$/.test(ref.key) ? { song_id: Number(ref.key) } : { song_mid: ref.key } } }), fetcher);
    if (d.code !== 0 || d.song?.code !== 0 || !d.song.data?.track_info) throw new Error('QQ 音乐没有返回这首歌，请检查链接或稍后重试');
    return { resource: qqMedia(d.song.data.track_info), warning: '' };
  }
  return null;
}

export function parseBiliSearch(body, page) {
  const $ = load(body.toString('utf8'));
  const script = $('script').toArray().map(node => $(node).text()).find(code => /window\.__pinia\s*=/.test(code));
  if (!script) throw new Error('B 站搜索页暂未返回结果，可能需要在原站完成验证');
  const state = readStaticAssignment(script, '__pinia');
  const result = state.searchTypeResponse?.searchTypeResponse;
  if (!Array.isArray(result?.result) || Number(result.page) !== page || !Number.isFinite(Number(result.numResults))) throw new Error('B 站搜索页未返回所请求的页码，请稍后重试或前往原站搜索');
  const items = result.result.filter(v => v.type === 'video' && /^BV[a-zA-Z0-9]{10}$/.test(v.bvid || '') && v.title).map(v => ({
    ...base(`bili-${v.bvid}`, '哔哩哔哩', '视频', v.title, `https://www.bilibili.com/video/${v.bvid}/`),
    subtitle: clean(v.author, 100), cover: cover(v.pic), description: clean(v.description), duration: clean(v.duration, 30),
    tags: [clean(v.typename, 30) || 'B 站视频', '搜索结果'], playbackUrl: `https://player.bilibili.com/player.html?bvid=${v.bvid}&p=1&autoplay=0&danmaku=1`,
    stats: { views: v.play, danmaku: v.danmaku ?? v.video_review, comments: v.review, favorites: v.favorites },
  }));
  return { items, hasMore: page < Number(result.numPages), total: Number(result.numResults) };
}

async function neteaseSearch(query, page, fetcher) {
  const url = new URL('https://music.163.com/api/search/get');
  url.search = new URLSearchParams({ s: query, type: '1', limit: '24', offset: String((page - 1) * 24) });
  const data = await platformJson(url.href, fetcher);
  const result = data.result;
  if (data.code !== 200 || !result || !Array.isArray(result.songs) && Number(result.songCount) !== 0) throw new Error('网易云搜索暂时不可用，请稍后重试');
  const songs = result.songs || [];
  const details = new Map();
  if (songs.some(song => !(song.album?.picUrl || song.al?.picUrl))) {
    // Search omits artwork on some deployments. One batched metadata request
    // fills covers; failure still leaves the source's original results intact.
    try {
      const full = await platformJson(`https://music.163.com/api/song/detail/?ids=${encodeURIComponent(JSON.stringify(songs.slice(0, 24).map(s => s.id)))}`, fetcher);
      if (full.code === 200) for (const song of full.songs || []) details.set(song.id, song);
    } catch { /* Artwork is optional. */ }
  }
  return { items: songs.map(song => neteaseMedia(details.get(song.id) || song)), hasMore: result.hasMore !== false && songs.length > 0 && Number(result.songCount) > page * 24, total: Number(result.songCount) || 0 };
}

async function qqSearch(query, page, fetcher) {
  const data = await platformJson(qqEndpoint({ req: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop', param: { num_per_page: 24, page_num: page, query, search_type: 0 } } }), fetcher);
  const result = data.req?.data;
  if (data.code !== 0 || data.req?.code !== 0 || !Array.isArray(result?.body?.song?.list) || Number(result.meta?.curpage) !== page) throw new Error('QQ 音乐搜索未返回有效结果，请稍后重试');
  const items = result.body.song.list.map(qqMedia);
  return { items, hasMore: items.length > 0 && Number(result.meta.sum) > page * 24, total: Number(result.meta.sum) || 0 };
}

export async function platformCatalog(source, query, page, fetcher = safeFetch) {
  let items = []; let hasMore = false;
  let total;
  if (query && (/^BV[a-zA-Z0-9]{10}$/.test(query) || /^https?:\/\//.test(query))) {
    if (page === 1) { const ref = await resolveReference(query, fetcher); if (ref.platform === source.type) items = [(await importPlatform(ref, fetcher)).resource]; }
  } else if (query) {
    let result;
    if (source.type === 'bilibili') {
      const response = await fetcher(`https://search.bilibili.com/video?keyword=${encodeURIComponent(query)}&page=${page}`, { timeout: 12000 });
      result = parseBiliSearch(response.body, page);
    } else if (source.type === 'netease') result = await neteaseSearch(query, page, fetcher);
    else if (source.type === 'qqmusic') result = await qqSearch(query, page, fetcher);
    if (!result) throw new Error('此来源尚未配置搜索');
    ({ items, hasMore, total } = result);
  } else if (source.type === 'bilibili') {
    const d = await platformJson(`https://api.bilibili.com/x/web-interface/popular?pn=${page}&ps=24`, fetcher);
    if (d.code !== 0 || !Array.isArray(d.data?.list)) throw new Error(`B 站热门目录暂不可用：${clean(d.message, 100) || d.code}`);
    items = d.data.list.map(v => biliMedia(v)); hasMore = d.data.no_more !== true && items.length === 24;
  } else if (source.type === 'netease') {
    const d = await platformJson('https://music.163.com/api/playlist/detail?id=3778678&n=1000', fetcher);
    if (d.code !== 200 || !Array.isArray(d.result?.tracks)) throw new Error('网易云热门榜暂时不可用');
    const all = d.result.tracks.map(neteaseMedia);
    items = all.slice((page - 1) * 24, page * 24); hasMore = all.length > page * 24;
  } else if (source.type === 'qqmusic') {
    const d = await platformJson(qqEndpoint({ top: { module: 'musicToplist.ToplistInfoServer', method: 'GetDetail', param: { topid: 26, num: 24, offset: (page - 1) * 24 } } }), fetcher);
    if (d.code !== 0 || d.top?.code !== 0 || !Array.isArray(d.top.data?.songInfoList)) throw new Error('QQ 音乐热歌榜暂时不可用');
    items = d.top.data.songInfoList.map(qqMedia);
    hasMore = (d.top.data.data?.totalNum || 0) > page * 24;
  }
  return { items: items.map(m => ({ ...m, sourceId: source.id, sourceKey: m.url })), hasMore, ...(total !== undefined ? { total } : {}), fetchedAt: Date.now() };
}
