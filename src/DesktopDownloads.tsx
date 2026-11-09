import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, X } from 'lucide-react';
import type { DownloadState } from './desktop-api';

const LABEL: Record<DownloadState['state'], string> = {
  progressing: '正在下载', completed: '下载完成', cancelled: '下载已取消', interrupted: '下载中断，请重新准备下载',
};
/** How long a finished card stays visible before it clears itself. */
const CLEAR_AFTER = 4000;

export default function DesktopDownloads() {
  const [downloads, setDownloads] = useState<DownloadState[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const clearTimer = (id: string) => {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  };
  useEffect(() => {
    const off = window.coplayDesktop?.onDownload(state => {
      if (!state?.id) return;
      clearTimer(state.id);
      setDownloads(old => [state, ...old.filter(d => d.id !== state.id)].slice(0, 4));
      // Finished cards are transient: no stale "下载完成" panel left on screen.
      if (state.state !== 'progressing') {
        timers.current.set(state.id, setTimeout(() => {
          setDownloads(old => old.filter(d => d.id !== state.id));
          timers.current.delete(state.id);
        }, CLEAR_AFTER));
      }
    });
    return () => { off?.(); for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); };
  }, []);
  if (!downloads.length) return null;
  return <aside className="desktop-downloads" aria-label="下载进度" aria-live="polite">
    <button className="plain-icon desktop-downloads-clear" aria-label="清除全部下载提示" title="清除全部下载提示" onClick={() => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); setDownloads([]); }}><X size={15} /></button>
    {downloads.map(item => <section key={item.id}><div>{item.state === 'completed' ? <Check size={16} /> : <ArrowDownToLine size={16} />}<span>{LABEL[item.state]}</span><button className="plain-icon" aria-label="隐藏下载进度" onClick={() => { clearTimer(item.id); setDownloads(old => old.filter(d => d.id !== item.id)); }}><X size={14} /></button></div><p>{item.filename}</p>{item.state === 'progressing' && <><progress value={item.received} max={item.total || 1} /><p>{(item.received / 1024 ** 2).toFixed(1)} / {(item.total / 1024 ** 2).toFixed(1)} MB</p></>}</section>)}
  </aside>;
}
