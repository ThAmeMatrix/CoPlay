import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown, Database, FolderOpen, Globe2, HardDrive, Link, LoaderCircle, Plus, RefreshCw, Search, Settings2, Trash2 } from 'lucide-react';
import type { CatalogSource, Media } from './types';
import { api } from './hooks';
import { Empty, MediaCard, Modal } from './components';
import { useCatalog } from './useCatalog';

const cacheSize = (bytes: number) => bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const cacheTime = (at: number) => at ? new Date(at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '尚未缓存';
const sourceSearchUrl = (source: CatalogSource, query: string) => {
  try { const url = new URL((source.searchUrl || '').replaceAll('{query}', encodeURIComponent(query)).replaceAll('{page}', '1')); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
};
export default function ResourceSquare({ query, local, favorites, onOpen, onAdd, onFavorite, onImport, notify }: { query: string; local: Media[]; favorites: string[]; onOpen: (m: Media) => void; onAdd: (m: Media) => void; onFavorite: (m: Media) => void; onImport: () => void; notify: (s: string) => void }) {
  const [source, setSource] = useState('all'); const [kind, setKind] = useState('全部');
  const [manage, setManage] = useState(false); const [resolving, setResolving] = useState(''); const [visibleCount, setVisibleCount] = useState(24);
  const [lookup, setLookup] = useState(''); const [locating, setLocating] = useState(false); const [lookupError, setLookupError] = useState('');
  const lookupRequest = useRef<AbortController | null>(null);
  useEffect(() => () => lookupRequest.current?.abort(), []);
  const sentinel = useRef<HTMLDivElement>(null);
  const { sources, entries, loadingSources, clearing, cacheInfo, diskInfo, error, notice, controller } = useCatalog(query, source);
  const selected = source === 'local' ? [] : sources.filter(s => source === 'all' ? s.enabled : s.id === source);
  const seen = new Set<string>();
  const items = selected.flatMap(s => Object.values(entries[s.id]?.pages || {}).flatMap(p => p.items)).filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
  const pending = selected.filter(s => entries[s.id]?.loading).length;
  const loading = pending > 0 || (loadingSources && !sources.length && source !== 'local');
  const more = selected.some(s => entries[s.id]?.hasMore);
  const sourceTotal = selected.length === 1 ? entries[selected[0].id]?.pages[1]?.total : undefined;
  const warnings = selected.filter(s => entries[s.id]?.warning).map(s => ({ source: s, message: entries[s.id].warning }));
  const cachedCount = selected.filter(s => entries[s.id]?.cached).reduce((sum, s) => sum + Object.values(entries[s.id].pages).reduce((n, p) => n + p.items.length, 0), 0);
  const own = source === 'local' ? local.filter(m => !m.demo) : [];
  const filtered = (source === 'local' ? own.filter(m => !query || `${m.title} ${m.subtitle}`.toLowerCase().includes(query.toLowerCase())) : items).filter(m => kind === '全部' || m.kind === kind);
  useEffect(() => { setVisibleCount(24); }, [source, query, kind]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || visibleCount >= filtered.length || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(records => { if (records.some(r => r.isIntersecting)) { observer.disconnect(); setVisibleCount(n => n + 24); } }, { rootMargin: '400px' });
    observer.observe(node); return () => observer.disconnect();
  }, [visibleCount, filtered.length]);
  const open = async (media: Media) => {
    if (media.sourceId && media.sourceKey && ['html', 'maccms', 'archive', 'bilibili'].includes(sources.find(s => s.id === media.sourceId)?.type || '')) {
      setResolving(media.id); try { const resolved = await api<Media>('/api/sources/resolve', { method: 'POST', body: JSON.stringify({ sourceId: media.sourceId, key: media.sourceKey }) }); onOpen({ ...resolved, id: media.id, kind: media.kind, cover: resolved.cover || media.cover, description: resolved.description || media.description }); } catch (e) { notify((e as Error).message); onOpen(media); } finally { setResolving(''); }
    } else onOpen(media);
  };
  return <section className="resource-square"><div className="square-banner"><div className="square-banner-icon"><Database size={26} /></div><div><strong>连接更大的内容世界</strong><p>实时目录、网站资源与本地影片，都在这里。目录信息与可播放片源会分别标明。</p></div><button className="button button-outline" disabled={clearing} onClick={() => setManage(true)}><Settings2 size={15} />管理来源</button></div>
    <form className="resource-lookup" onSubmit={async e => {
      e.preventDefault(); if (!lookup.trim() || locating) return;
      const abort = new AbortController(); lookupRequest.current = abort; setLocating(true); setLookupError('');
      try { const data = await api<{ resource: Media; warning: string }>('/api/import', { method: 'POST', signal: abort.signal, body: JSON.stringify({ url: lookup.trim() }) }); if (!abort.signal.aborted) { onOpen(data.resource); if (data.warning) notify(data.warning); } }
      catch (e) { if (!abort.signal.aborted) setLookupError((e as Error).message); }
      finally { if (!abort.signal.aborted) setLocating(false); }
    }}><label htmlFor="direct-resource">有链接，直接看</label><div><Link size={18} /><input id="direct-resource" value={lookup} onChange={e => setLookup(e.target.value)} placeholder="输入 BV 号，或粘贴 B 站 / 网易云 / QQ 音乐链接" maxLength={2048} required /><button className="button button-primary" disabled={locating || !lookup.trim()}>{locating ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}{locating ? '定位中…' : '定位资源'}</button></div><p>例如 BV1B7411m7LV · 支持 B 站短链接、分 P 视频、网易云单曲与歌单、QQ 音乐单曲</p>{lookupError && <p className="form-error" role="alert">{lookupError}</p>}</form>
    <div className="square-source-tabs"><button disabled={clearing} className={source === 'all' ? 'active' : ''} onClick={() => setSource('all')}><Globe2 size={14} />全部在线来源</button><button disabled={clearing} className={source === 'local' ? 'active' : ''} onClick={() => setSource('local')}><FolderOpen size={14} />我的导入</button>{sources.map(s => <button disabled={clearing} key={s.id} className={source === s.id ? 'active' : ''} onClick={() => setSource(s.id)}><span className={`source-dot ${entries[s.id]?.loading ? 'loading' : entries[s.id]?.warning ? 'error' : entries[s.id]?.cached ? 'cached' : entries[s.id]?.page ? 'ok' : s.status.state}`} />{s.name}{query.trim() && entries[s.id]?.page ? <span className="source-result-count">{Object.values(entries[s.id].pages).reduce((n, p) => n + p.items.length, 0)}</span> : null}</button>)}</div>
    {query.trim() && source !== 'local' && <div className="source-search-summary" role="status"><Search size={18} /><div><strong>在{selected.length === 1 ? `「${selected[0].name}」` : `${selected.length} 个来源`}搜索「{query.trim()}」</strong><p>{loading ? '正在读取源站搜索结果，完成后逐个展示。' : `已载入 ${items.length} 个结果${sourceTotal !== undefined ? ` · 来源返回 ${sourceTotal.toLocaleString()} 个匹配` : ''}。`}按来源返回的顺序显示，可继续加载下一页。</p></div>{selected.length === 1 && sourceSearchUrl(selected[0], query) && <a className="text-link" href={sourceSearchUrl(selected[0], query)} target="_blank" rel="noreferrer">源站搜索<ArrowUpRight size={13} /></a>}</div>}
    {source !== 'local' && <details className="catalog-cache-panel">
      <summary><HardDrive size={16} /><strong>本地目录缓存</strong><span>{cacheInfo.items ? `${cacheInfo.items} 条 · ${cacheSize(cacheInfo.bytes)}` : '首次读取后自动保存'}</span>{cachedCount > 0 && <span className="cache-hit-label">正在展示缓存</span>}<ChevronDown size={15} /></summary>
      <div className="catalog-cache-body"><div className="cache-statistics"><div><span>浏览器缓存</span><strong>{cacheInfo.pages} 页 · {cacheSize(cacheInfo.bytes)}</strong><small>最近更新 {cacheTime(cacheInfo.updatedAt)}</small></div><div><span>本机服务缓存</span><strong>{diskInfo ? `${diskInfo.pages} 页 · ${cacheSize(diskInfo.bytes)}` : '读取中…'}</strong><small>最近更新 {cacheTime(diskInfo?.updatedAt || 0)}</small></div></div>
        <p>优先显示已缓存目录，超过 10 分钟按来源更新；缓存保留 7 天。仅保存影片信息，不下载媒体文件。</p>
        {(cacheInfo.error || diskInfo?.error) && <p className="cache-error" role="status">{cacheInfo.error || diskInfo?.error}</p>}
        <div className="catalog-source-status">{selected.map(s => { const entry = entries[s.id]; return <div key={s.id}><span className={`source-dot ${entry?.warning ? 'error' : entry?.loading ? 'loading' : entry?.page ? 'ok' : ''}`} /><div><strong>{s.name}</strong><p>{entry?.warning || (entry?.loading ? '正在更新，已有内容可继续浏览' : entry?.updatedAt ? `${entry.cached ? '已显示缓存' : '已读取最新目录'} · ${cacheTime(entry.updatedAt)}` : '尚未读取')}</p></div><button className="text-link" disabled={entry?.loading || clearing} onClick={() => controller.retry(s.id)}>{entry?.warning ? '重试' : '更新'}</button></div>; })}</div>
        <div className="cache-footer"><span>浏览器上限 2 MB · 本机服务上限 12 MB</span><button className="button button-outline" disabled={clearing} onClick={() => void controller.clear()}><Trash2 size={13} />{clearing ? '清理中…' : '清理目录缓存'}</button></div>
      </div></details>}
    <div className="section-heading"><div className="category-tabs">{['全部', '电影', '电视剧', '动漫', '音乐', '视频'].map(k => <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{k}</button>)}</div><div className="square-actions"><span>{filtered.length} 个内容</span>{source !== 'local' && <button className="icon-button" aria-label="刷新资源目录" title="从来源重新获取" disabled={clearing} onClick={() => controller.refresh()}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>}<button className="button button-primary" onClick={onImport}><Plus size={14} />导入</button></div></div>
    {notice && <p className="catalog-notice" role="status">{notice}</p>}
    {!query.trim() && ['bilibili', 'netease', 'qqmusic'].includes(source) && <p className="catalog-notice">{sources.find(s => s.id === source)?.description}。在顶部输入关键词即可搜索此来源。</p>}
    {(warnings.length > 0 || error) && <details className="source-warning"><summary>{error || `${warnings.length} 个来源暂时不可用，其他来源仍可浏览`}</summary>{warnings.map(w => <div className="source-warning-row" key={w.source.id}><p>{w.message}</p>{query.trim() && sourceSearchUrl(w.source, query) && <a className="text-link" href={sourceSearchUrl(w.source, query)} target="_blank" rel="noreferrer">源站搜索<ArrowUpRight size={12} /></a>}<button className="text-link" disabled={clearing} onClick={() => controller.retry(w.source.id)}>重试此来源</button></div>)}{source !== 'all' && <button className="text-link" onClick={() => setManage(true)}>修改来源地址</button>}</details>}
    {loading && <div className="catalog-progress" role="status"><LoaderCircle size={15} className="spin" /><span>{pending ? `${pending} 个来源正在读取，完成后逐个显示` : '正在读取来源列表…'}</span>{cachedCount > 0 && <span>已保留 {cachedCount} 条缓存</span>}</div>}
    {filtered.length ? <div className="media-grid">{filtered.slice(0, visibleCount).map(m => <div key={m.id} className="square-media"><MediaCard media={m} onOpen={() => void open(m)} onAdd={() => onAdd(m)} onFavorite={() => onFavorite(m)} favorite={favorites.includes(m.id)} />{resolving === m.id && <span className="resolving-label"><LoaderCircle size={12} className="spin" />正在读取播放信息</span>}</div>)}</div> : loading ? <div className="media-grid catalog-skeleton" aria-label="目录加载中">{Array.from({ length: 6 }, (_, i) => <div key={i}><div /><span /><span /></div>)}</div> : <Empty title="这里还没有匹配的内容" text={source === 'local' ? '导入一个网站链接或本地视频，就可以开始观看。' : query ? '可以换个关键词（海外目录也可用英文），或配置常用站点搜索地址。' : '该来源暂未提供可读取的内容，可以添加有效站点或 JSON API。'} action={<button className="button button-outline" onClick={source === 'local' ? onImport : () => setManage(true)}><Plus size={15} />{source === 'local' ? '导入资源' : '配置来源'}</button>} />}
    {visibleCount < filtered.length && <div ref={sentinel} className="catalog-sentinel"><button className="button button-outline" onClick={() => setVisibleCount(n => n + 24)}>继续显示（{visibleCount} / {filtered.length}）</button><span>向下滚动自动加载</span></div>}
    {visibleCount >= filtered.length && more && !loading && <button className="button button-outline square-more" onClick={() => controller.loadMore()}>{query.trim() ? '获取下一页搜索结果' : '获取下一页内容'}</button>}
    {manage && <SourceManager sources={sources} onClose={() => setManage(false)} onSaved={() => { void controller.configured(); notify('来源配置已保存'); }} />}
  </section>;
}
function SourceManager({ sources, onClose, onSaved }: { sources: CatalogSource[]; onClose: () => void; onSaved: () => void }) {
  const empty = { id: '', name: '', url: '', searchUrl: '', type: 'html', kind: '电影', enabled: true };
  const [form, setForm] = useState(empty); const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title="内容来源" subtitle="网页目录、兼容的 JSON API，都可以成为你的资源库。" onClose={onClose} wide>
    <div className="source-manager-list">{sources.map(s => <div key={s.id}><span className={`source-dot ${s.status.state}`} /><div><strong>{s.name}</strong><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a><p>{s.status.message || s.description}</p></div>{['html', 'maccms'].includes(s.type) && <button className="button button-outline" onClick={() => { setForm({ ...empty, ...s, searchUrl: s.searchUrl || '' }); setEditing(true); }}>配置</button>}</div>)}</div>
    {!editing ? <button className="button button-outline full-width" onClick={() => { setForm(empty); setEditing(true); }}><Plus size={15} />添加来源</button> : <form className="source-editor" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await api('/api/sources', { method: 'POST', body: JSON.stringify(form) }); setEditing(false); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><div className="form-columns"><div><label className="field-label" htmlFor="source-name">来源名称</label><input className="text-input" id="source-name" required value={form.name} maxLength={35} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：常用的人人影视站点" /></div><div><label className="field-label" htmlFor="source-type">接入方式</label><select id="source-type" className="text-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="html">网页目录</option><option value="maccms">JSON API（苹果CMS）</option></select></div></div><label className="field-label" htmlFor="source-url">{form.type === 'html' ? '影片列表页地址' : 'JSON API 地址'}</label><input id="source-url" className="text-input" required type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/" />{form.type === 'html' && <><label className="field-label spaced" htmlFor="source-search">搜索地址<span>选填，以 {'{query}'} 代表关键词</span></label><input id="source-search" className="text-input" value={form.searchUrl} onChange={e => setForm({ ...form, searchUrl: e.target.value })} placeholder="https://example.com/search?q={query}" /></>}<div className="source-options"><label>默认类型<select className="text-input" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{['电影', '电视剧', '动漫', '音乐', '视频'].map(k => <option key={k}>{k}</option>)}</select></label><label><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />加入聚合搜索</label></div><p className="field-hint">读取页面公开的封面、标题与播放地址。需要登录或验证的内容会显示不可用；页面上的普通文字不会作为脚本运行。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="button button-outline" type="button" onClick={() => setEditing(false)}>取消</button><button className="button button-primary" disabled={busy}>{busy ? '保存中…' : '保存来源'}</button></div></form>}
  </Modal>;
}
