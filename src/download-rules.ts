// Pure download helpers shared by the renderer and the Node test runner.
// Deliberately keeps NO runtime imports: Node's TS loader cannot resolve
// extension-less relative imports, and tests load this file directly.
import type { Media } from './types';

export interface DownloadFile { url: string; filename: string; size: number }
export interface DownloadPlan { downloads: DownloadFile[]; expiresAt: number; quality: string; message: string }
export interface DownloadRequest { key: string; bvid: string; page: number }
export interface PreparedDownload { key: string; ok: boolean; plan?: DownloadPlan; error?: string }

/**
 * Items per `/api/downloads/prepare-batch` request. There is deliberately NO
 * cap on how many items the user may select: the panel walks the whole
 * selection in chunks so a large playlist downloads in one action.
 */
export const BATCH_CHUNK_SIZE = 10;
/** Hard server-side ceiling for a single chunk request. */
export const MAX_BATCH_REQUEST = 25;
/** Split an arbitrarily large selection into per-request chunks, losing nothing. */
export function chunkItems<T>(items: T[], size = BATCH_CHUNK_SIZE): T[][] {
  const step = Math.max(1, Math.min(size, MAX_BATCH_REQUEST));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}
const BVID = /^BV[a-zA-Z0-9]{10}$/;

/** B 站公开 MP4 is the only source that offers a downloadable file today. */
export function downloadPage(media: Media): number {
  const fromEpisode = media.episodes?.[media.defaultEpisode || 0]?.page;
  return Math.max(1, Math.floor(Number(fromEpisode || media.download?.page || 1) || 1));
}
export function canDownloadMedia(media: Media): boolean {
  return media.download?.provider === 'bilibili' && media.download.available !== false && BVID.test(media.download.bvid);
}
export function downloadKey(media: Media): string {
  return `bili:${media.download?.bvid}:p${downloadPage(media)}`;
}
export function downloadRequest(media: Media): DownloadRequest {
  // Safe for any media: callers filter with canDownloadMedia before sending a request.
  return { key: downloadKey(media), bvid: media.download?.bvid || '', page: downloadPage(media) };
}
export interface LocalCopyRecord { key: string; complete: boolean }
/** A completed local copy keyed exactly like the download request must never be re-downloaded. */
export function hasLocalCopy(items: LocalCopyRecord[], media: Media): boolean {
  return canDownloadMedia(media) && items.some(item => item.key === downloadKey(media) && item.complete);
}
/** Legacy lookup key derived from the embed URL (BV id / page can disagree with the download request). */
function legacyDownloadedKey(media: Media): string {
  const value = media.playbackUrl || media.episodes?.[media.defaultEpisode || 0]?.url || '';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'player.bilibili.com' && url.pathname === '/player.html') {
      const bvid = url.searchParams.get('bvid') || '';
      const page = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('p') || url.searchParams.get('page')) || 1)));
      if (/^BV[a-zA-Z0-9]{10}$/.test(bvid)) return `bili:${bvid}:p${page}`;
    }
  } catch { /* not a B 站 embed URL */ }
  return `resource:${media.id}`;
}
/**
 * The server files a finished download under the SAME key the request used.
 * Looking it up by the embed URL alone can miss the copy and make playback fall
 * back to the slow B 站 prepare API even though the file is already on disk.
 */
export function downloadedKey(media: Media): string {
  return canDownloadMedia(media) ? downloadKey(media) : legacyDownloadedKey(media);
}
/** Canonical key first, legacy key as a compatibility fallback. */
export function downloadedKeys(media: Media): string[] {
  const canonical = downloadedKey(media);
  const legacy = legacyDownloadedKey(media);
  return legacy === canonical ? [canonical] : [canonical, legacy];
}
