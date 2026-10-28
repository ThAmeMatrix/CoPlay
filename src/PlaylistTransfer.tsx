import { useState } from 'react';
import { Copy, FolderInput } from 'lucide-react';
import { Modal } from './components';
import type { Playlist } from './types';
export default function PlaylistTransfer({ title, source, playlists, onClose, onTransfer }: { title: string; source: string; playlists: Playlist[]; onClose: () => void; onTransfer: (target: string, move: boolean, newTitle: string) => void }) {
  const targets = playlists.filter(item => item.id !== source);
  const [target, setTarget] = useState(targets[0]?.id || 'new');
  const [move, setMove] = useState(false), [name, setName] = useState('');
  return <Modal title="复制或移动到其他播放列表" subtitle={title} onClose={onClose}>
    <div className="transfer-mode"><button className={move ? '' : 'active'} aria-pressed={!move} onClick={() => setMove(false)}><Copy size={17} />复制到其他列表</button><button className={move ? 'active' : ''} aria-pressed={move} onClick={() => setMove(true)}><FolderInput size={17} />移动到其他列表</button></div>
    <p className="field-hint">{move ? '添加到目标列表后，从当前列表移除。' : '当前列表保留，同时添加到目标列表。'}目标列表中已有该资源时自动去重。</p>
    <label className="field-label" htmlFor="transfer-target">目标播放列表</label><select id="transfer-target" className="text-input" value={target} onChange={event => setTarget(event.target.value)}>{targets.map(item => <option key={item.id} value={item.id}>{item.title} · {item.ids.length} 项</option>)}<option value="new">新建播放列表</option></select>
    {target === 'new' && <input className="text-input spaced" aria-label="目标列表名称" placeholder="新列表名称" maxLength={100} value={name} onChange={event => setName(event.target.value)} />}
    <button className="button button-primary full-width spaced" disabled={target === 'new' && !name.trim()} onClick={() => onTransfer(target, move, name.trim())}>{move ? <FolderInput size={16} /> : <Copy size={16} />}{move ? '确认移动' : '确认复制'}</button>
  </Modal>;
}
