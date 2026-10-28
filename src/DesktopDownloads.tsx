import { useEffect, useState } from 'react';
import { ArrowDownToLine, Check, X } from 'lucide-react';
type DownloadState = { id: string; filename: string; received: number; total: number; state: 'progressing' | 'interrupted' | 'completed' | 'cancelled' };
declare global {
  interface Window { coplayDesktop?: { version: string; onDownload: (listener: (state: DownloadState) => void) => () => void } }
}
export default function DesktopDownloads() {
  const [downloads, setDownloads] = useState<DownloadState[]>([]);
  useEffect(() => window.coplayDesktop?.onDownload(state => setDownloads(old => [state, ...old.filter(d => d.id !== state.id)].slice(0, 5))), []);
  if (!downloads.length) return null;
  return <aside className="desktop-downloads" aria-label="下载进度" aria-live="polite">{downloads.map(item => <section key={item.id}><div>{item.state === 'completed' ? <Check size={16} /> : <ArrowDownToLine size={16} />}<span>{({ progressing: '正在下载', completed: '下载完成', cancelled: '下载已取消', interrupted: '下载中断，请重新准备下载' })[item.state]}</span><button className="plain-icon" aria-label="隐藏下载进度" onClick={() => setDownloads(old => old.filter(d => d.id !== item.id))}><X size={14} /></button></div><p>{item.filename}</p>{item.state === 'progressing' && <><progress value={item.received} max={item.total || 1} /><p>{(item.received / 1024 ** 2).toFixed(1)} / {(item.total / 1024 ** 2).toFixed(1)} MB</p></>}</section>)}</aside>;
}
