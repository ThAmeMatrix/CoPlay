import { useEffect, useRef, useState } from 'react';
import { Check, Link, ListPlus, LoaderCircle, Search } from 'lucide-react';
import { Cover, Modal } from './components';
import { api } from './hooks';
import ImportModeTabs, { type ImportMode } from './ImportModeTabs';
import LocalPlaylistImport from './LocalPlaylistImport';
import PlaylistImportDestination from './PlaylistImportDestination';
import { matchesSearch, mediaMatchesSearch } from './playlist-search';
import type { Media, Playlist } from './types';

type Entry = Media | { id: string; title: string; unavailable: string };
type CollectionPage = { session: string; title: string; source: string; url: string; total: number; items: Entry[]; nextCursor: number | null; complete: boolean; warnings: string[] };
const available = (item: Entry): item is Media => !('unavailable' in item);
export default function CollectionImport({ playlists, initialTarget, initialUrl = '', initialMode = 'link', onClose, onImport }: { playlists: Playlist[]; initialTarget?: string; initialUrl?: string; initialMode?: ImportMode; onClose: () => void; onImport: (items: Media[], target: string, title: string) => void }) {
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [url, setUrl] = useState(initialUrl);
  const [collection, setCollection] = useState<CollectionPage | null>(null);
  const [items, setItems] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(initialTarget || 'new');
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  const received = useRef(new Set<string>());
  useEffect(() => () => request.current?.abort(), []);
  const load = async (resume = false) => {
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    setBusy(true); setError('');
    if (!resume) { setItems([]); setSelected(new Set()); setCollection(null); setWarnings([]); setCursor(null); setQuery(''); received.current.clear(); }
    let session = resume ? collection?.session : undefined, next = resume ? cursor : null;
    try {
      do {
        const batch = await api<CollectionPage>('/api/collections', { method: 'POST', signal: abort.signal, body: JSON.stringify(session ? { session, cursor: next } : { url }) });
        if (abort.signal.aborted) return;
        if (!session) { setTitle(batch.title); setCollection(batch); }
        const fresh = batch.items.filter(item => { if (received.current.has(item.id)) return false; received.current.add(item.id); return true; });
        setItems(previous => [...previous, ...fresh]);
        setSelected(previous => new Set([...previous, ...fresh.filter(available).map(item => item.id)]));
        setWarnings(previous => [...new Set([...previous, ...batch.warnings])]);
        session = batch.session; next = batch.nextCursor; setCursor(next);
        // Yield between batches so selection and cancellation stay responsive.
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (next !== null && !abort.signal.aborted);
    } catch (failure) { if (!abort.signal.aborted) setError((failure as Error).message); }
    finally { if (request.current === abort) setBusy(false); }
  };
  const playable = items.filter(available), chosen = playable.filter(item => selected.has(item.id));
  const visible = items.filter(item => available(item) ? mediaMatchesSearch(item, query) : matchesSearch(query, item.title));
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <Modal title="导入到播放列表" subtitle="通过链接、本地文件或合集歌单，收藏喜欢的视频与音乐。" onClose={onClose} wide>
    <ImportModeTabs value={mode} onChange={value => { if (value === 'local') { request.current?.abort(); setBusy(false); } setMode(value); }} />
    <div hidden={mode === 'local'} className="collection-remote-panel">
    <form className="collection-link-form" onSubmit={event => { event.preventDefault(); void load(); }}>
      <div className="input-with-icon"><Link size={17} /><input aria-label="资源链接或 BV 号" required type="text" maxLength={2048} autoComplete="off" spellCheck={false} value={url} disabled={busy} onChange={event => setUrl(event.target.value)} placeholder={mode === 'collection' ? 'B 站收藏夹 / 多分 P 视频 / 网易云歌单链接' : '视频 / 单曲链接，或 BV 号'} /></div>
      <button className="button button-primary" disabled={busy || !url.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <ListPlus size={16} />}{busy ? '读取中…' : '读取资源'}</button>
    </form>
    <p className="field-hint">{mode === 'collection' ? '支持 B 站收藏夹、多分 P 视频和网易云歌单。读取后可以全选或勾选部分条目；带 p 参数的视频链接只读取指定分集。' : '支持 B 站视频 / BV 号、网易云和 QQ 音乐单曲、媒体直链。也能直接识别合集链接，读取后勾选要加入的内容。'}</p>
    {collection && <>
      <div className="collection-progress"><div><strong>{collection.title}</strong><p role="status">{busy ? '正在读取' : cursor === null && !error ? '读取完成' : '读取尚未完成'} · 已读取 {items.length} / 来源标示 {collection.total} 项 · 可选 {playable.length} 项</p></div>
        {busy ? <button className="text-link" onClick={() => { request.current?.abort(); setBusy(false); }}>暂停读取</button> : cursor !== null && <button className="button button-outline" onClick={() => void load(true)}>继续读取</button>}
      </div>
      <div className="collection-selection"><label><input type="checkbox" aria-label="全选可用条目" checked={playable.length > 0 && chosen.length === playable.length} onChange={event => setSelected(new Set(event.target.checked ? playable.map(item => item.id) : []))} />全选可用条目</label><span>已选 {chosen.length} 项</span><div className="input-with-icon"><Search size={14} /><input aria-label="搜索待导入条目" value={query} onChange={event => setQuery(event.target.value)} placeholder="查找标题或作者" /></div></div>
      <div className="collection-items" role="group" aria-label="待导入条目">{visible.map(item => <label key={item.id} className={!available(item) ? 'unavailable' : ''}><input type="checkbox" aria-label={`导入${item.title}`} disabled={!available(item)} checked={selected.has(item.id)} onChange={() => toggle(item.id)} />{available(item) && <Cover media={item} />}<span><strong>{item.title}</strong><small>{available(item) ? `${item.subtitle} · ${item.duration}` : item.unavailable}</small></span></label>)}</div>
      {!visible.length && <p className="field-hint">没有匹配的条目。</p>}
      <PlaylistImportDestination playlists={playlists} target={target} title={title} onTargetChange={setTarget} onTitleChange={setTitle} />
      <button className="button button-primary full-width" disabled={busy || !chosen.length || target === 'new' && !title.trim()} onClick={() => onImport(chosen, target, title.trim())}><Check size={16} />导入已选 {chosen.length} 项</button>
      <p className="field-hint">已有条目自动去重，保留原顺序；新内容按来源顺序添加。这里只导入资源信息，不会批量下载媒体。</p>
    </>}
    {warnings.map(warning => <p key={warning} className="info-box">{warning}</p>)}
    {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <div hidden={mode !== 'local'}><LocalPlaylistImport playlists={playlists} target={target} onTargetChange={setTarget} onImport={onImport} /></div>
  </Modal>;
}
