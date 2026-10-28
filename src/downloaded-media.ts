import { useEffect, useSyncExternalStore } from 'react';
import type { Media } from './types';
import { bilibiliPlaybackTarget } from './bilibili-player';
import { api } from './hooks';

export type DownloadedFile = { id: string; filename: string; size: number; segment: number; url: string; available: boolean };
export type DownloadedMedia = { key: string; title: string; page: number; savedAt: number; files: DownloadedFile[]; complete: boolean };
let snapshot: { ready: boolean; items: DownloadedMedia[] } = { ready: false, items: [] };
const listeners = new Set<() => void>();
let pending: Promise<void> | null = null, checkedAt = 0;
const publish = () => listeners.forEach(listener => listener());
export function downloadedKey(media: Media) {
  const selected = media.episodes?.[media.defaultEpisode || 0];
  const target = bilibiliPlaybackTarget(media.playbackUrl || selected?.url);
  if (target?.bvid) return `bili:${target.bvid}:p${target.page}`;
  return `resource:${media.id}`;
}
export async function refreshDownloadedLibrary(force = false) {
  if (pending) return pending;
  if (!force && snapshot.ready && Date.now() - checkedAt < 5000) return;
  pending = api<DownloadedMedia[]>('/api/downloaded-media', { signal: AbortSignal.timeout(4000) })
    .then(items => {
      if (!Array.isArray(items)) throw new Error('下载记录无效');
      snapshot = { ready: true, items: items.filter(item => Array.isArray(item.files) && item.files.every(file => /^\/api\/downloaded-media\/[a-f0-9]{48}\/file$/.test(file.url))) };
    }).catch(() => { snapshot = { ...snapshot, ready: true }; })
    .finally(() => { checkedAt = Date.now(); pending = null; publish(); });
  return pending;
}
export function useDownloadedLibrary() {
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => snapshot);
  useEffect(() => { void refreshDownloadedLibrary(); const refresh = () => { void refreshDownloadedLibrary(true); }; window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, []);
  return value;
}
const watchedDownloads = new Map<string, number>();
let watchTimer: ReturnType<typeof setInterval> | undefined;
export function watchDownload(key: string) {
  watchedDownloads.set(key, Date.now());
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    void refreshDownloadedLibrary(true).then(() => {
      for (const [key, started] of watchedDownloads) if (snapshot.items.some(item => item.key === key && item.complete && item.savedAt >= started) || Date.now() - started > 60 * 60 * 1000) watchedDownloads.delete(key);
      if (!watchedDownloads.size) { clearInterval(watchTimer); watchTimer = undefined; }
    });
  }, 3000);
}
