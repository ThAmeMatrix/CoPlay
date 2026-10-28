import { useEffect, useRef, type ReactNode } from 'react';
import { X, Play, Tv, Music2, Youtube, Link, Plus, Heart, Star, Film, Check, ArrowUpRight } from 'lucide-react';
import type { Media } from './types';

export function PlatformIcon({ platform, size = 15 }: { platform: string; size?: number }) {
  const Icon = platform === '哔哩哔哩' ? Tv : ['网易云音乐', 'QQ音乐'].includes(platform) ? Music2 : platform === 'YouTube' ? Youtube : platform === '开放片源' ? Film : Link;
  return <Icon size={size} className={`platform-icon platform-${platform === '哔哩哔哩' ? 'bili' : platform === 'QQ音乐' ? 'qqmusic' : platform === '网易云音乐' ? 'music' : platform === 'YouTube' ? 'youtube' : 'open'}`} />;
}
export function Cover({ media, className = '' }: { media: Pick<Media, 'cover' | 'title' | 'kind'>; className?: string }) {
  return <div className={`cover ${className}`}>
    {media.cover ? <img key={media.cover} src={media.cover} alt={media.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}
    <div className="cover-fallback"><Film size={30} /><span>{media.title}</span></div>
  </div>;
}
export function MediaCard({ media, onOpen, onAdd, onFavorite, favorite }: { media: Media; onOpen: () => void; onAdd: () => void; onFavorite: () => void; favorite: boolean }) {
  return <article className="media-card">
    <div className="poster-wrap">
      <button className="poster-button" onClick={onOpen} aria-label={`查看${media.title}`}>
        <Cover media={media} />
        {media.rating && <span className="rating"><Star size={11} fill="currentColor" />{media.rating}</span>}
        <span className="poster-kind">{media.kind}</span>
        <span className="poster-play"><Play size={22} fill="currentColor" /></span>
      </button>
      <div className="poster-actions">
        <button className={favorite ? 'active' : ''} title={favorite ? '取消收藏' : '收藏资源'} aria-label={`${favorite ? '取消收藏' : '收藏'}${media.title}`} onClick={onFavorite}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></button>
        <button title="加入播放列表" aria-label={`将${media.title}加入播放列表`} onClick={onAdd}><Plus size={18} /></button>
      </div>
    </div>
    <button className="media-title" onClick={onOpen}>{media.title}</button>
    <div className="media-meta"><span>{media.year || media.tags[0]}<span className="meta-dot">·</span>{media.tags.slice(0, 2).join(' / ')}</span></div>
    <div className="media-source"><PlatformIcon platform={media.platform} size={13} /><span>{media.platform}</span>{media.demo ? <span className="sample-label">精选</span> : <span className="playable-label">{media.playbackType === 'local' ? '本机播放' : ['video', 'audio'].includes(media.playbackType) ? '可播放' : media.playbackType === 'embed' ? '官方播放器' : '目录'}</span>}</div>
  </article>;
}
export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const closer = useRef(onClose);
  closer.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closer.current();
      if (e.key === 'Tab') {
        const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(node => node.getClientRects().length > 0);
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); before?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={panel} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={21} /></button></div><div className="modal-body">{children}</div>
  </div></div>;
}
export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon || <Film size={29} />}</div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function SourceLink({ media }: { media: Media }) { if (!media.url) return null; return <a className="text-link" href={media.url} target="_blank" rel="noreferrer">前往{media.platform}<ArrowUpRight size={15} /></a>; }
export function Toast({ text }: { text: string }) { return <div className="toast" role="status"><Check size={17} />{text}</div>; }
