import type { Playlist } from './types';

export default function PlaylistImportDestination({ playlists, target, title, onTargetChange, onTitleChange }: { playlists: Playlist[]; target: string; title: string; onTargetChange: (target: string) => void; onTitleChange: (title: string) => void }) {
  return <div className="collection-destination">
    <label>导入到<select className="text-input" aria-label="导入目标播放列表" value={target} onChange={event => onTargetChange(event.target.value)}><option value="new">新建播放列表</option>{playlists.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    {target === 'new' && <label>列表名称<input className="text-input" aria-label="导入列表名称" value={title} onChange={event => onTitleChange(event.target.value)} maxLength={100} /></label>}
  </div>;
}
