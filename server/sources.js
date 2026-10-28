import { load, loadBuffer } from 'cheerio';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { safeFetch, publicUrl } from './safe-fetch.js';
import { createCatalogCache } from './catalog-cache.js';
import { createCatalogReader } from './catalog-reader.js';
import { platformCatalog, resolveReference, importPlatform } from './platforms.js';

const text = (v, max = 2000) => typeof v === 'string' ? load(`<body>${v}</body>`)('body').text().trim().slice(0, max) : '';
const id = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const link = (value, base) => { if (typeof value !== 'string' || !value.trim()) return ''; try { const u = new URL(value, base); const origin = new URL(base); if (origin.protocol === 'https:' && u.protocol === 'http:' && u.host === origin.host) u.protocol = 'https:'; return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
const direct = url => /\.(mp4|webm|ogv|m3u8|mp3|m4a|wav|ogg)(\?|$)/i.test(url || '');
const playable = url => /\.(mp3|m4a|wav|ogg)(\?|$)/i.test(url) ? 'audio' : 'video';
const document = body => Buffer.isBuffer(body) ? loadBuffer(body, { encoding: { defaultEncoding: 'utf-8' } }) : load(body);
export const defaultSources = [
  { id: 'bilibili', name: '哔哩哔哩', type: 'bilibili', url: 'https://www.bilibili.com', searchUrl: 'https://search.bilibili.com/video?keyword={query}&page={page}', enabled: true, kind: '视频', description: '热门视频 · B 站关键词搜索 · BV 号 / 链接直达' },
  { id: 'netease', name: '网易云音乐', type: 'netease', url: 'https://music.163.com', searchUrl: 'https://music.163.com/#/search/m/?s={query}&type=1', enabled: true, kind: '音乐', description: '热歌榜 · 网易云歌曲搜索 · 单曲 / 歌单导入' },
  { id: 'qqmusic', name: 'QQ音乐', type: 'qqmusic', url: 'https://y.qq.com', searchUrl: 'https://y.qq.com/n/ryqq/search?w={query}&t=song', enabled: true, kind: '音乐', description: '热歌榜 · QQ 音乐歌曲搜索 · 单曲链接导入' },
  { id: 'renren', name: '人人电影网', type: 'html', url: 'https://www.rrdynb.com/index.html', searchUrl: 'https://www.rrdynb.com/plus/search.php?q={query}&pagesize=20&PageNo={page}', enabled: true, kind: '电影', description: '公开影视目录与来源入口 · 网盘资源需前往来源站点获取' },
  { id: 'archive', name: 'Internet Archive 电影', type: 'archive', url: 'https://archive.org', enabled: true, kind: '电影', description: '电影档案目录 · 支持读取公开的可播放版本' },
  { id: 'tvmaze', name: 'TVmaze 剧集', type: 'tvmaze', url: 'https://api.tvmaze.com', enabled: true, kind: '电视剧', description: '实时剧集目录、剧情和评分 · CC BY-SA' },
  { id: 'apple-movies', name: 'Apple 电影目录', type: 'apple', url: 'https://itunes.apple.com/us/rss/topmovies/limit=100/json', enabled: true, kind: '电影', description: '热门电影目录与商店入口' },
  { id: 'jikan', name: 'MyAnimeList 动漫', type: 'jikan', url: 'https://api.jikan.moe/v4', enabled: true, kind: '动漫', description: '动漫目录与评分 · Jikan API' },
  { id: 'age', name: 'AGE 动漫', type: 'html', url: 'https://www.agedm.io/', searchUrl: 'https://www.agedm.io/search?query={query}&page={page}', enabled: true, kind: '动漫', description: 'AGE 动漫目录、搜索与影片详情入口' },
];
const baseMedia = (source, key, title) => ({ id: `source-${id(`${source.id}:${key}`)}`, title: text(title, 150), subtitle: source.name, kind: source.kind || '电影', platform: source.name, cover: '', duration: '查看详情', tags: [source.name], description: '', url: '', playbackType: 'external', sourceId: source.id, sourceKey: String(key), live: true });

export function parseMacCMS(data, source) {
  if (!Array.isArray(data.list)) throw new Error('接口未返回 list 数组，请使用兼容的 JSON 资源接口');
  return data.list.slice(0, 100).map(v => {
    const m = baseMedia(source, v.vod_id, v.vod_name);
    const episodes = [];
    for (const group of String(v.vod_play_url || '').split('$$$')) for (const entry of group.split('#')) {
      const cut = entry.indexOf('$'); const title = cut >= 0 ? entry.slice(0, cut) : '播放'; const url = link(cut >= 0 ? entry.slice(cut + 1) : entry, source.url);
      if (direct(url) && !episodes.some(e => e.url === url)) episodes.push({ title: text(title, 60), url });
    }
    const type = String(v.type_name || '');
    Object.assign(m, { cover: link(v.vod_pic, source.url), year: String(v.vod_year || ''), description: text(v.vod_content), tags: [type, v.vod_area].filter(Boolean).map(t => text(t, 30)), url: link(v.vod_detail_url, source.url) || source.url, duration: text(v.vod_remarks || v.vod_duration, 50) || '查看详情', episodes, kind: /动漫|动画/.test(type) ? '动漫' : /剧|连续/.test(type) ? '电视剧' : source.kind || '电影' });
    if (episodes.length) Object.assign(m, { playbackType: playable(episodes[0].url), playbackUrl: episodes[0].url });
    return m;
  }).filter(m => m.title);
}
export function parseHtmlCatalog(body, source, pageUrl, scope = '') {
  const $ = document(body);
  const root = scope ? $(scope) : $.root();
  if (scope && !root.length) throw new Error('来源搜索页结构发生变化，暂时无法读取结果');
  const items = []; const seen = new Set();
  root.find('a[href]').each((_i, node) => {
    const a = $(node); const card = a.closest('.video_item, .video_cover');
    const nestedImage = a.find('img').first();
    const img = nestedImage.length ? nestedImage : card.find('.video_item--image img').first();
    const href = link(a.attr('href'), pageUrl);
    if (!href || seen.has(href) || new URL(href).hostname !== new URL(pageUrl).hostname || a.parents('[hidden], [style*="display: none"], [style*="display:none"]').length) return;
    const title = text(a.attr('title') || img.attr('alt') || a.text(), 150);
    if (title.length < 2 || /logo|下载APP|客户端|广告|返回首页/i.test(title)) return;
    const background = a.attr('style')?.match(/url\(\s*['"]?([^'"\s)]+)/i)?.[1];
    const cover = link(img.attr('data-src') || img.attr('data-original') || img.attr('src') || a.attr('data-original') || a.attr('data-src') || background, pageUrl);
    if (!cover && !(scope && a.attr('title') && a.closest('h2, h3').length)) return;
    const section = a.closest('section, .stui-pannel').find('h2, h3').first().text();
    const kind = /动漫|动画/.test(section) ? '动漫' : /电视剧|连续剧/.test(section) ? '电视剧' : source.kind || '电影';
    seen.add(href);
    items.push({ ...baseMedia(source, href, title), url: href, cover, kind, duration: text(card.find('.video_item--info, .video_play_status').first().text(), 50) || '查看详情', description: text(a.closest('li').find('.stui-vodlist__detail p').first().text()), sourceKey: href });
  });
  return items.slice(0, 96);
}
export function catalogNextPage(body, pageUrl) {
  const $ = document(body);
  for (const node of $('a[rel="next"], .pagination a, .stui-page a, .pagelist a').toArray()) {
    const a = $(node);
    if (a.attr('rel') !== 'next' && !/^(下一页|下页|next|›|»)$/i.test(a.text().trim())) continue;
    const url = link(a.attr('href'), pageUrl);
    if (url && url !== pageUrl && new URL(url).hostname === new URL(pageUrl).hostname) return url;
  }
  return '';
}
export function parsePage(body, url, source = { id: 'web', name: new URL(url).hostname, kind: '电影' }) {
  const $ = document(body);
  const title = $('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text();
  const m = baseMedia(source, url, title || new URL(url).hostname);
  const poster = $('.stui-content__thumb img, .stui-content__thumb a').first();
  const description = text($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content'));
  Object.assign(m, { url, description: /\{dede:/.test(description) ? '' : description, cover: link($('meta[property="og:image"]').attr('content') || poster.attr('data-original') || poster.attr('data-src') || poster.attr('src'), url) });
  const episodes = [];
  $('video[src], audio[src], video source[src], audio source[src], a[href]').each((_i, node) => { const el = $(node); const target = link(el.attr('src') || el.attr('href'), url); if (direct(target) && !episodes.some(e => e.url === target)) episodes.push({ title: text(el.attr('title') || el.text(), 60) || `播放 ${episodes.length + 1}`, url: target }); });
  $('script[type="application/ld+json"]').each((_i, node) => { try { const json = JSON.parse($(node).text()); const entries = Array.isArray(json) ? json : json['@graph'] || [json]; for (const entry of entries) { const target = link(entry.contentUrl, url); if (direct(target) && !episodes.some(e => e.url === target)) episodes.push({ title: text(entry.name, 60) || '播放', url: target }); } } catch { /* Invalid structured metadata is optional. */ } });
  if (episodes.length) Object.assign(m, { episodes, playbackUrl: episodes[0].url, playbackType: playable(episodes[0].url) });
  return m;
}
export function validateSource(input) {
  if (!input || !['html', 'maccms'].includes(input.type) || typeof input.name !== 'string' || !input.name.trim()) throw new Error('请填写来源名称，并选择网页目录或 JSON API');
  const url = publicUrl(input.url).href;
  let searchUrl = '';
  if (input.searchUrl) {
    if (!String(input.searchUrl).includes('{query}')) throw new Error('搜索地址需要包含 {query} 占位符');
    const search = publicUrl(String(input.searchUrl).replace('{query}', 'test').replace('{page}', '1'));
    if (search.hostname !== new URL(url).hostname) throw new Error('搜索地址与目录需使用相同域名');
    searchUrl = String(input.searchUrl).slice(0, 2000);
  }
  return { id: /^[a-z0-9-]{1,60}$/.test(input.id || '') ? input.id : `custom-${id(url)}`, name: input.name.trim().slice(0, 35), url, type: input.type, searchUrl, kind: ['动漫', '电视剧', '电影', '音乐', '视频'].includes(input.kind) ? input.kind : '电影', enabled: input.enabled !== false, description: text(input.description, 150) || '自定义资源来源' };
}
export async function createSources({ dataDir, test = false, fetcher = safeFetch }) {
  let sources = structuredClone(defaultSources);
  const cache = await createCatalogCache({ dataDir, persist: !test });
  const cacheKey = (source, query, page) => `${source.id}:${id(JSON.stringify([source.type, source.url, source.searchUrl, source.name, source.kind]))}:${query}:${page}${query ? ':remote-search-v2' : ''}`;
  let saving = Promise.resolve();
  if (!test) { try { const saved = JSON.parse(await readFile(path.join(dataDir, 'sources.json'), 'utf8')); if (Array.isArray(saved)) sources = [...defaultSources.filter(s => !saved.some(v => v.id === s.id)), ...saved.map(s => ['bilibili', 'netease', 'qqmusic'].includes(s.type) ? { ...s, ...defaultSources.find(d => d.id === s.id), enabled: s.enabled } : s)]; } catch { /* New install. */ } }
  async function save(input) {
    const source = validateSource(input);
    const existing = sources.find(s => s.id === source.id);
    if (existing && !['html', 'maccms'].includes(existing.type)) throw new Error('内置 API 来源不允许替换，可另建来源');
    if (!existing && sources.length >= 20) throw new Error('最多可配置 20 个来源');
    sources = [...sources.filter(s => s.id !== source.id), source]; await reader.clear();
    if (!test) { const content = JSON.stringify(sources, null, 2); saving = saving.catch(() => {}).then(async () => { await mkdir(dataDir, { recursive: true }); await writeFile(path.join(dataDir, 'sources.tmp'), content); await rename(path.join(dataDir, 'sources.tmp'), path.join(dataDir, 'sources.json')); }); await saving; }
    return source;
  }
  async function fetchSource(source, query, page, request) {
    if (['bilibili', 'netease', 'qqmusic'].includes(source.type)) return platformCatalog(source, query, page, request);
    if (query && source.type === 'html' && !source.searchUrl) throw new Error('此来源尚未配置搜索地址，请在管理来源中填写搜索模板');
    if (query && source.type === 'tvmaze' && page > 1) return { items: [], hasMore: false, fetchedAt: Date.now() };
    let url;
    if (source.type === 'html' && page > 1 && !(query ? source.searchUrl : source.url)?.includes('{page}')) {
      const previous = cache.get(cacheKey(source, query, page - 1));
      if (!previous) throw new Error('请先读取上一页，再继续加载此来源');
      if (!previous.nextUrl) return { items: [], hasMore: false, fetchedAt: Date.now() };
      url = previous.nextUrl;
    }
    if (source.type === 'archive') {
      const u = new URL('/advancedsearch.php', source.url);
      const term = query.replace(/["\\:(){}\[\]*?]/g, ' ').trim();
      u.searchParams.set('q', `mediatype:movies AND collection:feature_films AND format:"MPEG4" AND NOT access-restricted-item:true${term ? ` AND (title:("${term}") OR description:("${term}"))` : ''}`);
      for (const field of ['identifier', 'title', 'description', 'year', 'licenseurl']) u.searchParams.append('fl[]', field);
      u.searchParams.set('sort[]', 'downloads desc'); u.searchParams.set('output', 'json'); u.searchParams.set('rows', '24'); u.searchParams.set('page', String(page)); url = u.href;
    }
    else if (source.type === 'tvmaze') url = query ? `${source.url}/search/shows?q=${encodeURIComponent(query)}` : `${source.url}/shows?page=${Math.floor((page - 1) / 5)}`;
    else if (source.type === 'apple') url = query ? `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=US&limit=200` : source.url;
    else if (source.type === 'jikan') url = query ? `${source.url}/anime?q=${encodeURIComponent(query)}&page=${page}&limit=24&sfw=true` : `${source.url}/top/anime?page=${page}&limit=24&sfw=true`;
    else if (source.type === 'maccms') { const u = new URL(source.url); u.searchParams.set('ac', 'detail'); u.searchParams.set('pg', String(page)); if (query) u.searchParams.set('wd', query); url = u.href; }
    else url ||= query && source.searchUrl ? source.searchUrl.replace('{query}', encodeURIComponent(query)).replace('{page}', String(page)) : source.url.replace('{page}', String(page));
    const response = await request(url, { timeout: source.type === 'html' && query ? 12000 : 8000 });
    let items = []; let more = false; let nextUrl = ''; let total;
    if (source.type === 'html') { items = parseHtmlCatalog(response.body, source, response.url, query && source.id === 'renren' ? '#movielist' : ''); nextUrl = catalogNextPage(response.body, response.url); more = !!nextUrl; if (!items.length && !query) throw new Error('页面没有可读取的影片目录；可修改站点地址或使用 JSON API'); }
    else {
      const d = JSON.parse(response.body.toString('utf8'));
      if (source.type === 'archive') {
        items = (d.response?.docs || []).map(v => ({ ...baseMedia(source, v.identifier, v.title), url: `https://archive.org/details/${encodeURIComponent(v.identifier)}`, cover: `https://archive.org/services/img/${encodeURIComponent(v.identifier)}`, description: text(Array.isArray(v.description) ? v.description.join('\n') : v.description), year: String(v.year || '').slice(0, 4), tags: ['电影档案', '可读取片源'], attribution: `Internet Archive · ${Array.isArray(v.licenseurl) ? v.licenseurl.join(' ') : v.licenseurl || '授权信息以来源详情页为准'}` }));
        total = Number(d.response?.numFound); more = total > page * 24;
      } else if (source.type === 'tvmaze') {
        const list = query ? d.map(v => v.show) : d.slice(((page - 1) % 5) * 50, ((page - 1) % 5 + 1) * 50);
        items = list.map(v => ({ ...baseMedia(source, v.id, v.name), kind: v.type === 'Animation' ? '动漫' : '电视剧', url: v.url, cover: v.image?.medium || '', description: text(v.summary), year: (v.premiered || '').slice(0, 4), duration: v.averageRuntime ? `${v.averageRuntime} 分钟 / 集` : v.status, rating: v.rating?.average ? String(v.rating.average) : undefined, tags: v.genres, attribution: '数据来自 TVmaze · CC BY-SA · ' + v.url })); more = !query && d.length > 0;
      } else if (source.type === 'apple') {
        if (query) {
          if (!Array.isArray(d.results)) throw new Error('Apple 搜索未返回有效结果');
          // The public movie-only endpoint currently returns empty responses.
          // Its general search still includes feature films with the same term.
          const list = d.results.filter(v => v.kind === 'feature-movie' && v.trackId && v.trackName);
          total = list.length; more = total > page * 24;
          items = list.slice((page - 1) * 24, page * 24).map(v => ({ ...baseMedia(source, v.trackId, v.trackName), url: link(v.trackViewUrl, source.url) || source.url, subtitle: text(v.artistName, 100) || source.name, cover: link(v.artworkUrl100 || v.artworkUrl60, source.url), description: text(v.longDescription || v.shortDescription), year: String(v.releaseDate || '').slice(0, 4), duration: v.trackTimeMillis ? `${Math.round(v.trackTimeMillis / 60000)} 分钟` : '查看详情', tags: [v.primaryGenreName].filter(Boolean), attribution: 'Apple 搜索结果 · 影片详情与商店入口' }));
        } else {
          const list = d.feed?.entry || [];
          items = list.map(v => ({ ...baseMedia(source, v.id?.attributes?.['im:id'], v['im:name']?.label), url: v.id?.label || source.url, cover: v['im:image']?.at(-1)?.label || '', description: text(v.summary?.label), year: v['im:releaseDate']?.label?.slice(0, 4), tags: [v.category?.attributes?.label].filter(Boolean), attribution: `${v.rights?.label || ''} · Apple 电影目录，仅提供影片信息与商店入口` }));
        }
      } else if (source.type === 'jikan') {
        items = (d.data || []).map(v => ({ ...baseMedia(source, v.mal_id, v.title), subtitle: v.title_english || v.title_japanese || source.name, url: v.url, cover: v.images?.jpg?.image_url || '', description: text(v.synopsis), year: v.year ? String(v.year) : '', duration: v.episodes ? `${v.episodes} 集` : '更新中', rating: v.score ? String(v.score) : undefined, tags: (v.genres || []).map(g => g.name), attribution: '动漫信息来自 MyAnimeList，经 Jikan API 提供' })); more = !!d.pagination?.has_next_page;
      } else { items = parseMacCMS(d, source); more = Number(d.pagecount) > page; }
    }
    return { items, hasMore: more, nextUrl, ...(Number.isFinite(total) ? { total } : {}), fetchedAt: Date.now() };
  }
  const reader = createCatalogReader({ cache, fetchPage: (source, query, page) => fetchSource(structuredClone(source), query, page, fetcher) });
  return {
    list: () => sources.map(s => ({ ...s, status: reader.status(s.id) || { state: s.enabled ? 'idle' : 'disabled', message: s.description } })), save,
    cacheInfo: cache.info, clearCache: reader.clear, flush: cache.flush,
    async search({ query = '', sourceId = 'all', page = 1, refresh = false }) {
      const selected = sources.filter(s => (sourceId === 'all' ? s.enabled : s.id === sourceId));
      if (!selected.length) throw new Error('没有可用的来源');
      const results = await Promise.allSettled(selected.map(s => reader.get(s, cacheKey(s, query, page), query, page, refresh)));
      const items = [], warnings = []; let hasMore = false;
      results.forEach((r, i) => { if (r.status === 'fulfilled') { items.push(...r.value.items); hasMore ||= r.value.hasMore; if (r.value.warning) warnings.push(`${selected[i].name}：${r.value.warning}`); } else warnings.push(`${selected[i].name}：${r.reason.message}`); });
      const cached = results.filter(r => r.status === 'fulfilled').map(r => r.value.cache);
      const total = results.length === 1 && results[0].status === 'fulfilled' ? results[0].value.total : undefined;
      return { items, warnings, hasMore, page, ...(Number.isFinite(total) ? { total } : {}), cache: { hit: cached.some(c => c.hit), stale: cached.some(c => c.stale), fetchedAt: cached.length ? Math.min(...cached.map(c => c.fetchedAt)) : 0 }, status: selected.length === 1 ? reader.status(selected[0].id) : undefined };
    },
    async resolve(sourceId, key) {
      const source = sources.find(s => s.id === sourceId); if (!source) throw new Error('来源不存在');
      if (['bilibili', 'netease', 'qqmusic'].includes(source.type)) {
        const ref = await resolveReference(key, fetcher);
        if (ref.platform !== source.type) throw new Error('资源链接与所选平台不匹配');
        return { ...(await importPlatform(ref, fetcher)).resource, sourceId, sourceKey: key };
      }
      if (source.type === 'archive' && /^[a-zA-Z0-9_.-]{1,160}$/.test(key)) {
        const response = await safeFetch(`https://archive.org/metadata/${encodeURIComponent(key)}`);
        const d = JSON.parse(response.body); const v = d.metadata || {};
        if (d.is_dark || d.is_restricted || v['access-restricted-item'] === 'true') throw new Error('此影片当前需要来源平台授权访问');
        const episodes = (d.files || []).filter(f => !f.private && !f.name?.startsWith('__') && /\.(mp4|webm|ogv)$/i.test(f.name || '') && Number(f.size) > 0).sort((a, b) => Number(!/\.mp4$/i.test(a.name)) - Number(!/\.mp4$/i.test(b.name)) || Number(a.size) - Number(b.size)).slice(0, 20).map(f => ({ title: `${f.format || '播放版本'} · ${Math.round(Number(f.size) / 1024 ** 2)} MB`, url: `https://archive.org/download/${encodeURIComponent(key)}/${f.name.split('/').map(encodeURIComponent).join('/')}` }));
        const m = { ...baseMedia(source, key, v.title || key), url: `https://archive.org/details/${encodeURIComponent(key)}`, cover: `https://archive.org/services/img/${encodeURIComponent(key)}`, description: text(Array.isArray(v.description) ? v.description.join('\n') : v.description), year: String(v.year || '').slice(0, 4), episodes, attribution: `Internet Archive · ${v.licenseurl || '来源详情页包含影片授权信息'}` };
        if (episodes.length) Object.assign(m, { playbackType: 'video', playbackUrl: episodes[0].url, tags: ['电影档案', '可同步'] });
        return m;
      }
      if (source.type === 'html') { const url = publicUrl(key); if (url.hostname !== new URL(source.url).hostname) throw new Error('详情地址必须来自同一站点'); const response = await safeFetch(url.href); return parsePage(response.body, response.url, source); }
      if (source.type === 'maccms' && /^\d+$/.test(key)) { const u = new URL(source.url); u.searchParams.set('ac', 'detail'); u.searchParams.set('ids', key); const response = await safeFetch(u.href); const items = parseMacCMS(JSON.parse(response.body), source); if (items.length) return items[0]; }
      throw new Error('该目录仅提供元数据，请前往来源网站或导入播放链接');
    },
  };
}
