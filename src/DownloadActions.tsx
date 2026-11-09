import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, LoaderCircle, X } from 'lucide-react';
import type { Media } from './types';
import { canDownloadMedia, delay, deliverDownloads, downloadRequest, MAX_BATCH, prepareDownloads, prepareSingle } from './download-actions';
import { useDownloadedLibrary } from './downloaded-media';

/** Compact download action shown while a playlist item is playing. */
export function DownloadButton({ media, notify, label = '下载到本地' }: { media: Media; notify?: (text: string) => void; label?: string }) {
  const library = useDownloadedLibrary();
  const downloadable = canDownloadMedia(media);
  const key = downloadable ? downloadRequest(media).key : '';
  const saved = downloadable && library.items.some(item => item.key === key && item.complete);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  if (!downloadable) return null;
  const run = async () => {
    setBusy(true); setError('');
    try {
      const result = await prepareSingle(downloadRequest(media));
      if (!result.ok || !result.plan) throw new Error(result.error || '下载准备未完成，请稍后再试');
      const count = deliverDownloads(result.plan, result.key);
      if (!count) throw new Error('没有可保存的文件');
      setStarted(true);
      notify?.(`已开始下载「${media.title}」，完成后会自动保留本地播放副本`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <span className="download-action">
    <button className="button button-outline" disabled={busy || saved} onClick={() => void run()} title={saved ? '已保留本地副本，播放时自动使用' : '把当前内容保存到电脑'}>
      {saved ? <Check size={15} /> : busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}
      {saved ? '已有本地副本' : busy ? '准备中…' : started ? '继续下载' : label}
    </button>
    {error && <small className="form-error" role="alert">{error}</small>}
  </span>;
}

type Job = { key: string; title: string; status: 'pending' | 'preparing' | 'downloading' | 'done' | 'error'; detail?: string };
const STATUS: Record<Job['status'], string> = { pending: '等待中', preparing: '准备中', downloading: '已交给下载管理器', done: '已开始下载', error: '失败' };

/** Playlist batch bar: multi-select the cards above, then prepare and save them. */
export function BatchDownloadPanel({ items, selected, onSelectedChange, onClose, notify }: {
  items: Media[]; selected: string[]; onSelectedChange: (ids: string[]) => void; onClose: () => void; notify: (text: string) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const downloadable = items.filter(canDownloadMedia);
  const chosen = downloadable.filter(item => selected.includes(item.id)).slice(0, MAX_BATCH);
  const skipped = selected.length - chosen.length;
  const update = (key: string, patch: Partial<Job>) => setJobs(current => current.map(job => job.key === key ? { ...job, ...patch } : job));
  const run = async () => {
    if (!chosen.length) { notify('所选内容没有可下载的 B 站视频，请改选其他内容'); return; }
    setBusy(true); setError('');
    const controller = new AbortController(); abort.current = controller;
    setJobs(chosen.map(item => ({ key: downloadRequest(item).key, title: item.title, status: 'preparing' })));
    let ok = 0;
    try {
      if (window.coplayDesktop?.chooseDownloadFolder) {
        const folder = await window.coplayDesktop.chooseDownloadFolder();
        if (!folder) { setBusy(false); setJobs([]); notify('已取消批量下载'); return; }
      }
      const results = await prepareDownloads(chosen.map(downloadRequest), controller.signal);
      const byKey = new Map(results.map(result => [result.key, result]));
      for (const item of chosen) {
        if (controller.signal.aborted) break;
        const key = downloadRequest(item).key;
        const result = byKey.get(key);
        if (!result?.ok || !result.plan) { update(key, { status: 'error', detail: result?.error || '未返回下载计划' }); continue; }
        try {
          deliverDownloads(result.plan, key);
          update(key, { status: 'downloading', detail: `${result.plan.downloads.length} 个文件 · ${result.plan.quality}` });
          ok++;
        } catch (e) { update(key, { status: 'error', detail: (e as Error).message }); }
        await delay(450);
      }
      // The folder is only needed while will-download fires; release it soon after.
      setTimeout(() => window.coplayDesktop?.clearDownloadFolder?.(), 5000);
      notify(ok ? `已开始下载 ${ok} 项内容${skipped ? `，跳过 ${skipped} 项暂不支持下载的内容` : ''}` : '没有可下载的内容');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); abort.current = null; }
  };
  return <section className="batch-panel" aria-label="批量下载">
    <header>
      <strong><ArrowDownToLine size={16} />批量下载到本地</strong>
      <span>勾选上方卡片；目前支持 B 站公开 MP4，一次最多 {MAX_BATCH} 项。桌面版可选择文件夹后自动保存。</span>
      <button className="plain-icon" aria-label="退出批量下载" onClick={onClose}><X size={15} /></button>
    </header>
    <div className="batch-actions">
      <button className="button button-outline" onClick={() => onSelectedChange(downloadable.map(item => item.id))}>全选可下载（{downloadable.length}）</button>
      <button className="button button-outline" onClick={() => onSelectedChange([])}>清空选择</button>
      <button className="button button-primary" disabled={busy || !chosen.length} onClick={() => void run()}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}
        {busy ? '处理中…' : `下载选中（${chosen.length}）`}
      </button>
      {skipped > 0 && <span role="status">已跳过 {skipped} 项不支持下载的内容</span>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!!jobs.length && <ul className="batch-jobs">{jobs.map(job => <li key={job.key} className={job.status}>
      <strong>{job.title}</strong><span>{STATUS[job.status]}{job.detail ? ` · ${job.detail}` : ''}</span>
    </li>)}</ul>}
  </section>;
}
