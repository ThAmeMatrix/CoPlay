import { useSyncExternalStore } from 'react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Media } from './types';

const assets = new Map<string, { file: File; url: string }>();
const listeners = new Set<() => void>();
let version = 0;
const types: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' };
export const localAccept = 'video/*,audio/*,.mkv,.m4v,.flac';
export const bytesLabel = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
export async function fileFingerprint(file: File) {
  const hash = sha256.create();
  hash.update(new TextEncoder().encode(`${file.name}:${file.size}:`));
  hash.update(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
  if (file.size > 1024 * 1024) hash.update(new Uint8Array(await file.slice(-1024 * 1024).arrayBuffer()));
  return bytesToHex(hash.digest());
}
function storeAsset(id: string, file: File) { const old = assets.get(id); if (old) URL.revokeObjectURL(old.url); assets.set(id, { file, url: URL.createObjectURL(file) }); version++; listeners.forEach(fn => fn()); }
export interface PreparedLocalFile { media: Media; attach: () => void }
export async function prepareLocalFile(file: File): Promise<PreparedLocalFile> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = types[extension] || (/^(video|audio)\//.test(file.type) ? file.type : '');
  if (!mime || !file.size) throw new Error('请选择非空的视频或音频文件（推荐 MP4、WebM、MP3）');
  if (file.size > 100 * 1024 ** 3) throw new Error('单个文件暂支持最大 100 GB');
  const fingerprint = await fileFingerprint(file);
  const id = `local-${fingerprint.slice(0, 24)}`;
  const media: Media = { id, title: file.name.replace(/\.[^.]+$/, ''), subtitle: file.name, kind: mime.startsWith('audio') ? '音乐' : '电影', platform: '本地文件', cover: '', duration: bytesLabel(file.size), tags: ['本地文件', '本机播放'], url: '', playbackType: 'local', description: '在当前浏览器直接播放本机视频或音乐，支持收藏与加入播放列表。文件不会上传。刷新页面后，重新选择同一文件即可继续观看。', localFile: { name: file.name, size: file.size, mime, fingerprint, lastModified: file.lastModified } };
  return { media, attach: () => storeAsset(id, file) };
}
export async function addLocalFile(file: File): Promise<Media> {
  const prepared = await prepareLocalFile(file);
  prepared.attach();
  return prepared.media;
}
export async function restoreLocalFile(media: Media, file: File) {
  if (!media.localFile || file.size !== media.localFile.size || await fileFingerprint(file) !== media.localFile.fingerprint) throw new Error('与此资源的文件不匹配，请选择原来的同一个文件');
  storeAsset(media.id, file);
}
export const getLocalAsset = (id: string) => assets.get(id);
export function useLocalAsset(id?: string) { useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => version); return id ? assets.get(id) : undefined; }

export function attachLocalCopy(key: string, file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!file.size || !(types[extension] || /^(audio|video)\//.test(file.type))) throw new Error('请选择完整的视频或音频文件');
  storeAsset(key, file);
}
