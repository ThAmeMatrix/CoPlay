import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, GripVertical, ListMusic, Trash2 } from 'lucide-react';
import { Cover } from './components';
import { matchesSearch, mediaMatchesSearch } from './playlist-search';
import type { Media, Playlist } from './types';

export default function PlaylistEditor({ playlist, resources, query = '', onMove, onRemove, onTransfer }: { playlist: Playlist; resources: Media[]; query?: string; onMove: (id: string, target: string) => void; onRemove: (id: string) => void; onTransfer: (id: string) => void }) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const resourceMap = useMemo(() => new Map(resources.map(media => [media.id, media])), [resources]);
  const visible = playlist.ids.map((id, index) => ({ id, index, media: resourceMap.get(id) }))
    .filter(({ media }) => media ? mediaMatchesSearch(media, query) : matchesSearch(query, '资源暂不可用'));
  const move = (id: string, to: string) => {
    onMove(id, to);
    setAnnouncement(`已将${resources.find(media => media.id === id)?.title || '内容'}移到第 ${playlist.ids.indexOf(to) + 1} 项`);
  };
  return <div className="playlist-editor">
    <p className="playlist-edit-hint">拖动左侧把手，或使用上下箭头调整顺序。修改自动保存在本机。</p>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    <ol className="playlist-edit-list" aria-label="编辑播放列表">
      {visible.map(({ id, index, media }) => {
        const title = media?.title || '资源暂不可用';
        return <li key={id} data-media-id={id} className={`${dragged === id ? 'dragging' : ''} ${target === id && dragged !== id ? 'drop-target' : ''}`}
          onDragOver={event => { if (dragged) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTarget(id); } }}
          onDrop={event => { event.preventDefault(); if (dragged) move(dragged, id); setDragged(null); setTarget(null); }}>
          <span className="playlist-drag-handle" draggable title="拖动调整顺序" aria-hidden="true"
            onDragStart={event => { event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; setDragged(id); }}
            onDragEnd={() => { setDragged(null); setTarget(null); }}><GripVertical size={18} /></span>
          <span className="playlist-order-number">{String(index + 1).padStart(2, '0')}</span>
          {media ? <Cover media={media} className="playlist-edit-cover" /> : <span className="playlist-edit-cover missing"><ListMusic size={18} /></span>}
          <div className="playlist-edit-info"><strong>{title}</strong><span>{media ? `${media.platform} · ${media.duration}` : '可从列表中移除'}</span></div>
          <div className="playlist-edit-buttons">
            <button className="icon-button bordered" aria-label={`上移${title}`} disabled={index === 0} onClick={() => move(id, playlist.ids[index - 1])}><ArrowUp size={16} /></button>
            <button className="icon-button bordered" aria-label={`下移${title}`} disabled={index === playlist.ids.length - 1} onClick={() => move(id, playlist.ids[index + 1])}><ArrowDown size={16} /></button>
            <button className="icon-button bordered" aria-label={`复制或移动${title}`} title="复制或移动到其他列表" onClick={() => onTransfer(id)}><Copy size={15} /></button>
            <button className="icon-button bordered" aria-label={`移出${title}`} onClick={() => { onRemove(id); setAnnouncement(`已移出${title}`); }}><Trash2 size={15} /></button>
          </div>
        </li>;
      })}
    </ol>
    {playlist.ids.length > 0 && !visible.length && <p className="playlist-edit-hint" role="status">没有匹配的内容，试试其他标题、作者或来源。</p>}
    {!playlist.ids.length && <p className="playlist-edit-hint">列表已清空，点击「完成编辑」后可继续添加内容。</p>}
  </div>;
}
