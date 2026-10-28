export function musicEmbedUrl(src: string | undefined, autoPlay: boolean) {
  if (!src) return src;
  try {
    const url = new URL(src);
    if (url.origin === 'https://music.163.com' && url.pathname === '/outchain/player') url.searchParams.set('auto', autoPlay ? '1' : '0');
    // Older saved resources used a retired QQ endpoint. Normalize on playback
    // as well as import so existing playlists do not need to be recreated.
    if (url.origin === 'https://i.y.qq.com' && url.pathname === '/n2/m/outchain/player.html') url.pathname = '/n2/m/outchain/player/index.html';
    return url.toString();
  } catch { return src; }
}
export function requiresMusicPlayClick(src: string | undefined) {
  try { const url = new URL(src || ''); return url.origin === 'https://i.y.qq.com' && url.pathname === '/n2/m/outchain/player/index.html'; } catch { return false; }
}
