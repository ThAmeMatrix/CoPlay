import { useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, LoaderCircle, Plus, Search } from 'lucide-react';
import { Cover } from './components';
import { localAccept, prepareLocalFile, type PreparedLocalFile } from './local-media';
import { mediaMatchesSearch } from './playlist-search';
import PlaylistImportDestination from './PlaylistImportDestination';
import type { Media, Playlist } from './types';

export default function LocalPlaylistImport({ playlists, target, onTargetChange, onImport }: { playlists: Playlist[]; target: string; onTargetChange: (target: string) => void; onImport: (items: Media[], target: string, title: string) => void }) {
  const [entries, setEntries] = useState<PreparedLocalFile[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [query, setQuery] = useState(''), [title, setTitle] = useState('本地播放列表');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const seen = useRef(new Set<string>()), request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const chooseFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    const abort = new AbortController(); request.current = abort;
    setBusy(true); setErrors([]); setProgress(`正在读取 0 / ${files.length} 个文件`);
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        try {
          const entry = await prepareLocalFile(file);
          if (abort.signal.aborted) return;
          if (!seen.current.has(entry.media.id)) {
            seen.current.add(entry.media.id);
            setEntries(current => [...current, entry]);
            setSelected(current => new Set([...current, entry.media.id]));
          }
        } catch (error) { failures.push(`${file.name}：${(error as Error).message}`); }
        if (abort.signal.aborted) return;
        setProgress(`已读取 ${index + 1} / ${files.length} 个文件`);
      }
      setErrors(failures);
    } finally { if (!abort.signal.aborted) setBusy(false); }
  };
  const chosen = entries.filter(entry => selected.has(entry.media.id));
  const visible = entries.filter(entry => mediaMatchesSearch(entry.media, query));
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <div className="local-playlist-import">
    <div className="local-dropzone" aria-label="拖入本地视频或音乐" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void chooseFiles(Array.from(event.dataTransfer.files)); }}>
      <FolderOpen size={34} /><h3>把本地视频和音乐加入列表</h3>
      <p>拖入文件，或一次选择多个视频、音频。<br />预览并勾选后加入播放列表。</p>
      <label className="button button-primary file-button">{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{busy ? '正在读取文件…' : '选择本地文件'}<input type="file" multiple accept={localAccept} disabled={busy} aria-label="选择本地文件加入列表" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void chooseFiles(files); }} /></label>
    </div>
    <p className="field-hint">文件保留在本机，不会上传。推荐 MP4、WebM、MP3；刷新后列表会保留，需要重新选择同一文件才能播放。</p>
    {progress && <p className="field-hint" role="status">{progress}</p>}
    {entries.length > 0 && <>
      <div className="collection-selection"><label><input type="checkbox" aria-label="全选本地文件" checked={chosen.length === entries.length} onChange={event => setSelected(new Set(event.target.checked ? entries.map(entry => entry.media.id) : []))} />全选本地文件</label><span>已选 {chosen.length} / {entries.length} 项</span><div className="input-with-icon"><Search size={14} /><input aria-label="搜索待导入本地文件" placeholder="查找文件名" value={query} onChange={event => setQuery(event.target.value)} /></div></div>
      <div className="collection-items" role="group" aria-label="待导入本地文件">{visible.map(({ media }) => <label key={media.id}><input type="checkbox" aria-label={`导入${media.title}`} checked={selected.has(media.id)} onChange={() => toggle(media.id)} /><Cover media={media} /><span><strong>{media.title}</strong><small>{media.subtitle} · {media.duration}</small></span></label>)}</div>
      {!visible.length && <p className="field-hint">没有匹配的文件。</p>}
      <PlaylistImportDestination playlists={playlists} target={target} title={title} onTargetChange={onTargetChange} onTitleChange={setTitle} />
      <button className="button button-primary full-width" disabled={busy || !chosen.length || target === 'new' && !title.trim()} onClick={() => { chosen.forEach(entry => entry.attach()); onImport(chosen.map(entry => entry.media), target, title.trim()); }}><Check size={16} />导入已选 {chosen.length} 项</button>
      <p className="field-hint">同一文件自动去重；新内容按选择顺序添加。也可以继续选择更多文件。</p>
    </>}
    {errors.length > 0 && <div className="local-import-errors" role="alert">{errors.map((error, index) => <p className="form-error" key={index}>{error}</p>)}</div>}
  </div>;
}
