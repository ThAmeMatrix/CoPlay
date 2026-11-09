import { api } from './hooks';
import { watchDownload } from './downloaded-media';
import {
  downloadRequest,
  type DownloadPlan, type DownloadRequest, type PreparedDownload,
} from './download-rules';

export type { DownloadFile, DownloadPlan, DownloadRequest, PreparedDownload } from './download-rules';
export { BATCH_CHUNK_SIZE, MAX_BATCH_REQUEST, chunkItems, canDownloadMedia, downloadKey, downloadPage, downloadRequest, hasLocalCopy } from './download-rules';

/** A single interactive download uses the original endpoint with its own quota. */
export async function prepareSingle(item: DownloadRequest, signal?: AbortSignal): Promise<PreparedDownload> {
  try {
    const plan = await api<DownloadPlan>('/api/downloads/prepare', {
      method: 'POST', signal, body: JSON.stringify({ bvid: item.bvid, page: item.page }),
    });
    return { key: item.key, ok: true, plan };
  } catch (error) {
    return { key: item.key, ok: false, error: (error as Error).message };
  }
}

/** Prepare one chunk. Callers loop over chunks to download the whole selection. */
export async function prepareDownloads(items: DownloadRequest[], signal?: AbortSignal): Promise<PreparedDownload[]> {
  if (!items.length) return [];
  const data = await api<{ results: PreparedDownload[] }>('/api/downloads/prepare-batch', {
    method: 'POST', signal, body: JSON.stringify({ items }),
  });
  return Array.isArray(data.results) ? data.results : [];
}

/** Hand the ticketed files to the browser / Electron download manager. */
export function deliverDownloads(plan: DownloadPlan, key: string): number {
  if (Date.now() >= plan.expiresAt) throw new Error('下载链接已过期，请重新准备');
  let count = 0;
  for (const file of plan.downloads || []) {
    if (!/^\/api\/downloads\/[a-f0-9]{48}\/file$/.test(file.url)) continue;
    const anchor = document.createElement('a');
    anchor.href = file.url;
    anchor.download = file.filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    count++;
  }
  if (count) watchDownload(key);
  return count;
}

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
