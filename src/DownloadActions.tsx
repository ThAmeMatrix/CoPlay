import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, LoaderCircle, X } from 'lucide-react';
import type { Media } from './types';
import { chunkItems, canDownloadMedia, delay, deliverDownloads, downloadRequest, hasLocalCopy, prepareDownloads, prepareSingle } from './download-actions';
import { useDownloadedLibrary } from './downloaded-media';

/** Compact download action shown while a playlist item is playing. */
export function DownloadButton({ media, notify, label = '下载到本地' }: { media: Media; notify?: (text: string) => void; label?: string }) {
  const library = useDownloadedLibrary();
  const downloadable = canDownloadMedia(media);
  const saved = hasLocalCopy(library.items, media);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  if (!downloadable) return null;
  const run = async () => {
    if (saved || busy) return;
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
    <button className="button button-outline" disabled={busy || saved} onClick={() => void run()} title={saved ? '已保留本地副本，播放时自动使用，无需重复下载' : '把当前内容保存到电脑'}>
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
  const library = useDownloadedLibrary();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const clearJobs = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { abort.current?.abort(); clearTimeout(clearJobs.current); }, []);
  // Already-saved items are excluded up front: never re-download them.
  const downloadable = items.filter(media => canDownloadMedia(media) && !hasLocalCopy(library.items, media));
  const savedCount = items.filter(canDownloadMedia).length - downloadable.length;
  // No cap: "select all" really selects the whole list. The run walks it in
  // bounded chunks so one request never becomes huge or times out.
  const chosen = downloadable.filter(item => selected.includes(item.id));
  const skipped = selected.length - chosen.length;
  const update = (key: string, patch: Partial<Job>) => setJobs(current => current.map(job => job.key === key ? { ...job, ...patch } : job));
  const run = async () => {
    if (!chosen.length) { notify('所选内容没有需要下载的 B 站视频，请改选其他内容'); return; }
    setBusy(true); setError('');
    clearTimeout(clearJobs.current);
    const controller = new AbortController(); abort.current = controller;
    setJobs(chosen.map(item => ({ key: downloadRequest(item).key, title: item.title, status: 'pending' })));
    let ok = 0;
    try {
      for (const chunk of chunkItems(chosen)) {
        if (controller.signal.aborted) break;
        for (const item of chunk) update(downloadRequest(item).key, { status: 'preparing' });
        const results = await prepareDownloads(chunk.map(downloadRequest), controller.signal);
        const byKey = new Map(results.map(result => [result.key, result]));
        for (const item of chunk) {
          if (controller.signal.aborted) break;
          const key = downloadRequest(item).key;
          const result = byKey.get(key);
          if (!result?.ok || !result.plan) { update(key, { status: 'error', detail: result?.error || '未返回下载计划' }); continue; }
          try {
            deliverDownloads(result.plan, key);
            update(key, { status: 'downloading', detail: `${result.plan.downloads.length} 个文件 · ${result.plan.quality}` });
            ok++;
          } catch (e) { update(key, { status: 'error', detail: (e as Error).message }); }
          await delay(120);
        }
      }
      notify(ok ? `已开始下载 ${ok} 项内容${skipped ? `，跳过 ${skipped} 项无需下载的内容` : ''}` : '没有可下载的内容');
      if (ok) {
        onSelectedChange([]);
        // Clear the finished job list so no stale panel is left behind.
        clearJobs.current = setTimeout(() => setJobs([]), 5000);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); abort.current = null; }
  };
  return <section className="batch-panel" aria-label="批量下载">
    <header>
      <strong><ArrowDownToLine size={16} />批量下载到本地</strong>
      <span>勾选上方卡片，或点「全选待下载」一次选中全部；已下载的内容会自动跳过。文件保存到偏好设置里选定的位置，不会弹出保存窗口。</span>
      <button className="plain-icon" aria-label="退出批量下载" onClick={onClose}><X size={15} /></button>
    </header>
    <div className="batch-actions">
      <button className="button button-outline" onClick={() => onSelectedChange(downloadable.map(item => item.id))}>全选待下载（{downloadable.length}）</button>
      <button className="button button-outline" onClick={() => onSelectedChange([])}>清空选择</button>
      <button className="button button-primary" disabled={busy || !chosen.length} onClick={() => void run()}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}
        {busy ? '处理中…' : `下载选中（${chosen.length}）`}
      </button>
      {savedCount > 0 && <span role="status">已有 {savedCount} 项本地副本，自动跳过</span>}
      {skipped > 0 && <span role="status">已跳过 {skipped} 项已下载或不支持的内容</span>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!!jobs.length && <ul className="batch-jobs">{jobs.map(job => <li key={job.key} className={job.status}>
      <strong>{job.title}</strong><span>{STATUS[job.status]}{job.detail ? ` · ${job.detail}` : ''}</span>
    </li>)}</ul>}
  </section>;
}
