import { createHash } from 'node:crypto';
import { safeFetch } from './safe-fetch.js';
import { parsePage } from './sources.js';
import { resolveReference, importPlatform, platformJson } from './platforms.js';

const kinds = ['电影', '动漫', '电视剧', '音乐', '视频'];
const idFor = (url) => createHash('sha256').update(url).digest('hex').slice(0, 16);
export async function importResource(input, { fetcher = safeFetch } = {}) {
  if (typeof input.url !== 'string' || input.url.length > 2048) throw new Error('请输入有效的资源链接');
  const ref = await resolveReference(input.url, fetcher);
  const url = ref.url;
  if (ref.platform) {
    const result = await importPlatform(ref, fetcher);
    if (typeof input.title === 'string' && input.title.trim()) result.resource.title = input.title.trim().slice(0, 150);
    return result;
  }
  const kind = kinds.includes(input.kind) ? input.kind : '视频';
  const resource = { id: idFor(url.href), title: '', subtitle: '导入的资源', kind, platform: '媒体链接', cover: '', duration: '导入资源', tags: ['我的导入'], description: '', url: url.href, playbackType: 'external' };
  let warning = '';
  const host = url.hostname.toLowerCase();
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1];
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('请使用有效的 YouTube 视频链接');
    Object.assign(resource, { title: `YouTube · ${id}`, platform: 'YouTube', playbackType: 'embed', playbackUrl: `https://www.youtube.com/embed/${id}`, cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
    try {
      const d = await platformJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, fetcher);
      resource.title = d.title;
      resource.subtitle = d.author_name;
    } catch { warning = '已保存视频链接，平台元数据暂不可用。'; }
  } else if (/\.(mp4|webm|ogv|mov|m3u8|mp3|m4a|wav|ogg)$/i.test(url.pathname)) {
    const audio = /\.(mp3|m4a|wav|ogg)$/i.test(url.pathname);
    Object.assign(resource, { title: decodeURIComponent(url.pathname.split('/').pop() || '导入的媒体'), playbackType: audio ? 'audio' : 'video', playbackUrl: url.href, kind: audio ? '音乐' : kind, description: '通过媒体直链导入的资源，可在本机播放并加入片单。', tags: ['我的导入', '可播放'] });
  } else {
    const response = await fetcher(url.href);
    if (!response.contentType.includes('html')) throw new Error('此链接不是影片页面或可识别的媒体直链');
    const parsed = parsePage(response.body, response.url);
    if (!parsed.cover && !parsed.description && parsed.playbackType === 'external') throw new Error('此页面没有可导入的影片信息，请使用详情页或媒体直链');
    Object.assign(resource, parsed);
    warning = parsed.playbackType === 'external' ? '已导入网页标题、封面和来源。页面没有公开的直链，可前往来源网站观看。' : '已读取页面公开的播放地址，可在详情中选择集数。';
  }
  if (typeof input.title === 'string' && input.title.trim()) resource.title = input.title.trim().slice(0, 150);
  return { resource, warning };
}
