export function bilibiliPlaybackTarget(value?: string) {
  try {
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.hostname !== 'player.bilibili.com' || url.pathname !== '/player.html' || url.username || url.password || url.port) return null;
    const bvid = url.searchParams.get('bvid') || '';
    const page = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p') || url.searchParams.get('page')) || 1)));
    const episode = url.searchParams.get('episodeId'), season = url.searchParams.get('seasonId');
    if (/^\d+$/.test(episode || '')) return { bvid: '', page: 1, official: url.href, source: `https://www.bilibili.com/bangumi/play/ep${episode}` };
    if (/^\d+$/.test(season || '')) return { bvid: '', page: 1, official: url.href, source: `https://www.bilibili.com/bangumi/play/ss${season}` };
    if (!/^BV[a-zA-Z0-9]{10}$/.test(bvid)) return null;
    return { bvid, page, official: url.href, source: `https://www.bilibili.com/video/${bvid}/?p=${page}` };
  } catch { return null; }
}

export function bilibiliEmbedUrl(value: string, autoPlay: boolean) {
  const url = new URL(value);
  url.searchParams.set('autoplay', autoPlay ? '1' : '0');
  return url.href;
}
