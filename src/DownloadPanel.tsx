import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, LoaderCircle } from 'lucide-react';
import type { Media } from './types';
import { api } from './hooks';
import { useDownloadedLibrary, watchDownload } from './downloaded-media';

type DownloadPlan = { downloads: { url: string; filename: string; size: number }[]; expiresAt: number; quality: string; message: string };
export default function DownloadPanel({ media, page }: { media: Media; page: number }) {
  const library = useDownloadedLibrary();
  const downloaded = library.items.find(item => item.key === `bili:${media.download?.bvid}:p${page}` && item.complete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<DownloadPlan | null>(null);
  const [saved, setSaved] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const prepare = async () => {
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    setBusy(true); setError(''); setPlan(null); setSaved(false);
    try { const result = await api<DownloadPlan>('/api/downloads/prepare', { method: 'POST', signal: abort.signal, body: JSON.stringify({ bvid: media.download?.bvid, page }) }); if (!abort.signal.aborted) setPlan(result); }
    catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  if (!media.download) return null;
  return <div className="download-panel">
    <div className="download-heading"><ArrowDownToLine size={18} /><div><strong>保存到电脑{media.episodes?.length ? ` · P${page}` : ''}</strong><p>{media.download.available !== false ? '下载时在应用数据目录保留播放副本；完整下载后，播放列表优先使用该副本。' : '平台未开放此视频的公开下载，可使用上方播放器观看。'}</p></div>
      {media.download.available !== false && <button className="button button-outline" disabled={busy} onClick={() => void prepare()}>{busy ? <LoaderCircle size={14} className="spin" /> : <ArrowDownToLine size={14} />}{busy ? '准备中…' : plan ? '重新准备' : '准备下载'}</button>}
    </div>
    {downloaded && <p className="download-local-ready" role="status"><Check size={14} />已保留完整本地副本，播放时自动使用 · {downloaded.files.map(file => file.filename).join("、")}</p>}
    {plan && <div className="download-files"><p role="status">{plan.message} {plan.quality} · 链接 10 分钟内有效</p>{plan.downloads.map(file => <a className="download-file" key={file.url} href={file.url} download={file.filename} onClick={e => { if (Date.now() >= plan.expiresAt) { e.preventDefault(); setError('下载链接已过期，请点击重新准备'); return; } setSaved(true); watchDownload(`bili:${media.download?.bvid}:p${page}`); }}><ArrowDownToLine size={16} /><span>{file.filename}</span><small>{(file.size / 1024 ** 2).toFixed(1)} MB</small></a>)}{saved && <p role="status"><Check size={13} />已交给下载管理器；完成后会自动关联到同一资源及其所在的播放列表。</p>}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
