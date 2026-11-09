// Pure download helpers shared by the renderer. Keep this file free of runtime
// imports so both Vite and the Node test runner can load it directly.
import type { Media } from './types';

export interface DownloadFile { url: string; filename: string; size: number }
export interface DownloadPlan { downloads: DownloadFile[]; expiresAt: number; quality: string; message: string }
export interface DownloadRequest { key: string; bvid: string; page: number }
export interface PreparedDownload { key: string; ok: boolean; plan?: DownloadPlan; error?: string }

export const MAX_BATCH = 20;
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
