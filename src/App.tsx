import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, Check, ChevronDown, ChevronRight, Clock3, Compass, Copy, Film, FolderHeart, Grid2X2, Headphones, Heart, History, Link, ListMusic, ListPlus, LoaderCircle, Menu, MessageCircle, MonitorPlay, Music2, Pencil, Play, Plus, Search, Settings2, Sparkles, Star, Tv, Users, X } from 'lucide-react';
import { catalog, initialPlaylists, spaceImage, themes } from './data';
import type { Comment, Kind, Media, Playlist, PublicRoom } from './types';
import { api, compactNumber, usePersistent } from './hooks';
import { Cover, Empty, MediaCard, Modal, PlatformIcon, SourceLink, Toast } from './components';
import Room from './Room';
import QueuePlayer from './QueuePlayer';
import PlaylistEditor from './PlaylistEditor';
import { mediaMatchesSearch, playlistMatchesSearch } from './playlist-search';
import CollectionImport from './CollectionImport';
import ImportModeTabs, { type ImportMode } from './ImportModeTabs';
import PlaylistTransfer from './PlaylistTransfer';
import { appendPlaylistItems, mergeImportedResources, transferPlaylistItem } from './playlist-actions';
import PlaybackModeSelect from './PlaybackModeSelect';
import { normalizePlaybackMode, reorderPlaylist } from './playback-queue';
import ResourceSquare from './ResourceSquare';
import ShareModal from './ShareModal';
import { AttachDownloadedFile, ResourcePlayer, LocalRestore } from './MediaPlayer';
import { addLocalFile, localAccept, useLocalAsset } from './local-media';
import DownloadPanel from './DownloadPanel';
import DesktopDownloads from './DesktopDownloads';
import { bilibiliPlaybackTarget } from './bilibili-player';
import { version as appVersion } from '../package.json';

type Page = 'discover' | 'browse' | 'local' | 'rooms' | 'playlists' | 'favorites' | 'history' | 'playlist';
const roomsEnabled = false;
const categories = ['全部', '电影', '电视剧', '动漫', '音乐', '视频'];
const platforms = ['全平台', '哔哩哔哩', '网易云音乐', 'QQ音乐', 'YouTube', '开放片源', '媒体链接'];
const initialRoom = roomsEnabled ? new URLSearchParams(location.search).get('room') : null;
const featured = [
  { media: catalog[0], title: ['把宇宙的浪漫，', '分享给你。'], background: spaceImage },
  { media: catalog[3], title: ['让每一个梦想，', '都有自己的旋律。'], background: catalog[3].cover },
  { media: catalog[4], title: ['穿过浩瀚沙海，', '赴一场命运之约。'], background: catalog[4].cover },
];

export default function App() {
  const [page, setPage] = useState<Page>('browse');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [platform, setPlatform] = useState('全平台');
  const [sort, setSort] = useState('推荐排序');
  const [tag, setTag] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [featureIndex, setFeatureIndex] = useState(0);
  const feature = featured[featureIndex];
  const [mobileNav, setMobileNav] = useState(false);
  const [imported, setImported] = usePersistent<Media[]>('resources-v1', []);
  const [favorites, setFavorites] = usePersistent<string[]>('favorites-v1', []);
  const [history, setHistory] = usePersistent<string[]>('history-v1', []);
  const [playlists, setPlaylists] = usePersistent<Playlist[]>('playlists-v1', initialPlaylists);
  const [savedPlaybackMode, setPlaybackMode] = usePersistent<string>('playback-mode-v1', 'list');
  const playbackMode = normalizePlaybackMode(savedPlaybackMode);
  const [editingPlaylist, setEditingPlaylist] = useState(false);
  const [collectionImport, setCollectionImport] = useState<{ url?: string; mode?: ImportMode } | null>(null);
  const [transfer, setTransfer] = useState<{ id: string; source: string } | null>(null);
  const [nickname, setNickname] = usePersistent('nickname-v1', '橘子同学');
  const [activePlaylist, setActivePlaylist] = useState('weekend');
  const [selected, setSelected] = useState<Media | null>(null);
  const [modal, setModal] = useState<'import' | 'local' | 'playlist' | 'room' | 'profile' | 'join' | 'network' | null>(null);
  const [addMedia, setAddMedia] = useState<Media | null>(null);
  const [newPlaylistMedia, setNewPlaylistMedia] = useState<Media | null>(null);
  const [queue, setQueue] = useState<{ title: string; items: Media[]; initialIndex?: number } | null>(null);
  const [roomMedia, setRoomMedia] = useState<Media>(catalog.find(m => m.id === 'bunny')!);
  const [roomId, setRoomId] = useState<string | null>(initialRoom);
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [roomError, setRoomError] = useState('');
  const [roomLoading, setRoomLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [notifications, setNotifications] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const resources = useMemo(() => [...imported, ...catalog.filter(m => !imported.some(i => i.id === m.id))], [imported]);
  const playlist = playlists.find(p => p.id === activePlaylist);
  const notify = (text: string) => { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 3500); };
  useEffect(() => { const handler = () => notify('本地存储空间不足，部分修改可能无法保存'); window.addEventListener('coplay:storage-error', handler); return () => window.removeEventListener('coplay:storage-error', handler); }, []);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  useEffect(() => { if (!roomsEnabled) return; const handler = () => setRoomId(new URLSearchParams(location.search).get('room')); window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler); }, []);
  useEffect(() => {
    if (!roomsEnabled || page !== 'rooms') return;
    let active = true;
    const load = async () => { setRoomLoading(true); try { const data = await api<PublicRoom[]>('/api/rooms'); if (active) { setRooms(data); setRoomError(''); } } catch (e) { if (active) setRoomError((e as Error).message); } finally { if (active) setRoomLoading(false); } };
    void load(); const timer = setInterval(load, 10000); return () => { active = false; clearInterval(timer); };
  }, [page]);
  const navigate = (next: Page) => { setPage(next); setQuery(''); setCategory('全部'); setPlatform('全平台'); setTag(''); setSort('推荐排序'); setEditingPlaylist(false); setShowAll(false); setMobileNav(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const remember = (media: Media) => { if (media.live) setImported(old => [media, ...old.filter(m => m.id !== media.id)]); };
  const openResource = (media: Media) => { remember(media); setSelected(media); };
  const recordPlay = (media: Media) => setHistory(h => [media.id, ...h.filter(id => id !== media.id)].slice(0, 50));
  const toggleFavorite = (media: Media) => { const exists = favorites.includes(media.id); setFavorites(old => exists ? old.filter(id => id !== media.id) : [...old, media.id]); notify(exists ? '已取消收藏' : '已收藏，喜欢的内容不会走散'); };
  const startRoom = (media?: Media) => { if (!roomsEnabled) { notify('放映室暂时搁置，请使用本地播放'); return; } setRoomMedia(media?.playbackType !== 'external' && media ? media : catalog.find(m => m.id === 'bunny')!); setSelected(null); setModal('room'); };
  const startPlaylist = (startId?: string) => { const items = (playlist?.ids || []).flatMap(id => resources.find(m => m.id === id && m.playbackType !== 'external') || []); if (!items.length) { notify('片单中还没有可直接播放的资源，请先导入媒体链接'); return; } setQueue({ title: playlist?.title || '播放列表', items, initialIndex: startId ? Math.max(0, items.findIndex(m => m.id === startId)) : undefined }); };
  const enterRoom = (id: string) => { setRoomId(id); setModal(null); const url = new URL(location.href); url.searchParams.set('room', id); window.history.pushState({}, '', url); };
  const leaveRoom = () => { setRoomId(null); const url = new URL(location.href); url.searchParams.delete('room'); window.history.pushState({}, '', url); navigate('rooms'); };
  const listResources = useMemo(() => {
    let list = resources;
    if (page === 'local') list = list.filter(m => m.playbackType === 'local');
    if (page === 'favorites') list = list.filter(m => favorites.includes(m.id));
    if (page === 'history') list = history.flatMap(id => resources.find(m => m.id === id) || []);
    if (page === 'playlist') list = (playlist?.ids || []).flatMap(id => resources.find(m => m.id === id) || []);
    if (category !== '全部') list = list.filter(m => m.kind === category);
    if (platform !== '全平台') list = list.filter(m => m.platform === platform);
    if (tag) list = list.filter(m => m.tags.includes(tag) || m.kind === tag);
    if (query.trim()) list = list.filter(m => mediaMatchesSearch(m, query));
    if (sort === '评分优先') list = [...list].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
    if (sort === '年份最新') list = [...list].sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
    if (sort === '可以同步') list = list.filter(m => ['video', 'audio', 'local'].includes(m.playbackType));
    return list;
  }, [resources, page, favorites, history, playlist, category, platform, tag, query, sort]);
  const visiblePlaylists = playlists.filter(item => playlistMatchesSearch(item, query));
  const isFiltered = query.trim() || category !== '全部' || platform !== '全平台' || tag || sort !== '推荐排序';
  const visibleResources = page === 'discover' && !isFiltered && !showAll ? listResources.slice(0, 6) : listResources;
  const pageTitle = page === 'local' ? '本地影片，随时开场' : page === 'discover' ? '发现，下一份热爱' : page === 'browse' ? '把喜欢，收在一起' : page === 'rooms' ? '放映室暂时搁置' : page === 'favorites' ? '我的收藏' : page === 'history' ? '最近播放' : page === 'playlist' ? playlist?.title || '播放列表' : '我的播放列表';
  const pageSubtitle = page === 'local' ? '打开电脑里的视频与音乐，文件留在本机。' : page === 'discover' ? '好电影、好音乐，还有同频的你。' : page === 'rooms' ? '当前仅提供本地测试。' : page === 'playlists' ? '每一种心情，都值得拥有一份专属片单。' : page === 'playlist' ? playlist?.description : '散落在各个平台的好内容，在这里相遇。';

  if (roomsEnabled && roomId) return <><Room roomId={roomId} nickname={nickname} onLeave={leaveRoom} notify={notify} onPlayed={recordPlay} />{toast && <Toast text={toast} />}</>;

  return <div className="app-shell">
    <DesktopDownloads />
    {mobileNav && <div className="sidebar-shade" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <button className="brand" onClick={() => navigate('discover')} aria-label="共映首页"><span className="brand-mark"><span /><Play size={24} fill="currentColor" /></span><span className="brand-name">共映<span>CoPlay</span></span></button>
      <div className="sidebar-caption">好内容，一起看</div>
      <nav className="main-nav">
        {([{ key: 'discover', icon: Compass, title: '发现' }, { key: 'browse', icon: Grid2X2, title: '资源广场' }, { key: 'local', icon: MonitorPlay, title: '本地资源' }] as const).map(n => <button key={n.key} onClick={() => navigate(n.key)} className={`nav-item ${page === n.key ? 'active' : ''}`}><n.icon size={19} /><span>{n.title}</span></button>)}
      </nav>
      <div className="nav-section-label">我的空间</div>
      <nav>
        {([{ key: 'playlists', icon: ListMusic, title: '播放列表' }, { key: 'favorites', icon: Heart, title: '我的收藏' }, { key: 'history', icon: History, title: '最近播放' }] as const).map(n => <button key={n.key} onClick={() => navigate(n.key)} className={`nav-item ${page === n.key || n.key === 'playlists' && page === 'playlist' ? 'active' : ''}`}><n.icon size={18} /><span>{n.title}</span>{n.key === 'favorites' && favorites.length > 0 && <span className="nav-count">{favorites.length}</span>}</button>)}
      </nav>
      <div className="nav-section-label playlists-label"><span>我的播放列表</span><button className="plain-icon" aria-label="新建播放列表" onClick={() => setModal('playlist')}><Plus size={15} /></button></div>
      <nav className="playlist-nav">{playlists.slice(0, 5).map(p => <button key={p.id} className={`nav-item small ${page === 'playlist' && p.id === activePlaylist ? 'selected' : ''}`} onClick={() => { navigate('playlist'); setActivePlaylist(p.id); }}><span className="playlist-dot" style={{ background: p.color }} /><span>{p.title}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="collection-note"><span className="note-icon"><Link size={19} /></span><strong>让喜欢，不再散落。</strong><p>一个链接，收藏整个世界。</p><button onClick={() => setModal('import')}>导入资源<ArrowUpRight size={14} /></button></div><button className="sidebar-help" onClick={() => setModal('profile')}><Settings2 size={16} />偏好设置<span>{window.coplayDesktop ? `桌面 v${window.coplayDesktop.version}` : `v${appVersion}`}</span></button></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={22} /></button><div className="breadcrumb">探索世界<span>/</span><strong>{page === 'discover' ? '发现' : page === 'local' ? '本地资源' : page === 'browse' ? '资源广场' : '我的空间'}</strong></div>
        <div className="topbar-actions"><div className="search-box"><Search size={17} /><input ref={searchRef} value={query} onChange={e => { setQuery(e.target.value); if (page === 'rooms' || page === 'discover') setPage('browse'); }} placeholder={page === 'playlists' ? '搜索播放列表名称、描述…' : page === 'playlist' ? '搜索列表内的标题、作者、来源…' : '搜索影视、音乐、创作者…'} aria-label={page === 'playlists' ? '搜索播放列表' : page === 'playlist' ? '搜索列表内容' : '搜索资源'} />{query ? <button className="plain-icon" aria-label="清空搜索" onClick={() => setQuery('')}><X size={15} /></button> : <kbd>Ctrl K</kbd>}</div><button className="button button-primary import-top" onClick={() => page === 'playlist' || page === 'playlists' ? setCollectionImport({}) : setModal(page === 'local' ? 'local' : 'import')}><Plus size={17} />导入资源</button><div className="notification-wrap"><button className={`icon-button notification-button ${notifications ? 'selected' : ''}`} aria-label="消息通知" onClick={() => setNotifications(v => !v)}><Bell size={19} /></button>{notifications && <div className="notification-menu"><strong>共映小助手</strong><p>浏览在线目录，或导入电脑里的视频与音乐，制作自己的播放列表。</p><button className="text-link" onClick={() => { setNotifications(false); setModal('local'); }}>打开本地影片<ArrowRight size={14} /></button></div>}</div><button className="avatar-button" onClick={() => setModal('profile')} aria-label="个人设置">{nickname.slice(0, 1)}</button></div>
      </header>
      <main className="main-content">
        <div className="page-heading"><div><div className="eyebrow">MAKE TIME FOR WHAT YOU LOVE</div><h1>{query.trim() && page !== 'playlist' && page !== 'playlists' ? `搜索「${query.trim()}」` : pageTitle}<span className="heading-dot">.</span></h1><p>{query.trim() ? page === 'browse' ? '搜索已连接的在线来源，结果显示在下方' : page === 'playlists' ? `找到 ${visiblePlaylists.length} / ${playlists.length} 个播放列表` : page === 'playlist' ? `在当前列表中找到 ${listResources.length} 项内容` : `在你的资源库中找到 ${listResources.length} 份内容` : pageSubtitle}</p></div><div className="heading-right">{page === 'local' ? <button className="button button-primary" onClick={() => setModal('local')}><Plus size={17} />打开本地文件</button> : page === 'playlists' ? <button className="button button-primary" onClick={() => setModal('playlist')}><Plus size={17} />新建播放列表</button> : <span className="daily-note"><span className="sun-icon">✳</span> 给生活一点好内容</span>}</div></div>

        {page === 'discover' && !query && <>
          <section className="hero-grid"><div className="hero-feature" style={{ backgroundImage: `url("${feature.background}")` }}><div className="hero-shade" /><div className="hero-content"><span className="hero-label"><Sparkles size={13} /> 本周共映精选</span><div className="hero-kicker">{feature.media.subtitle.toUpperCase()}</div><h2>{feature.title[0]}<br />{feature.title[1]}</h2><p>{feature.media.title}<span>{feature.media.year}</span><span>{feature.media.tags.slice(0, 2).join(' / ')}</span><span className="hero-score"><Star size={12} fill="currentColor" />{feature.media.rating}</span></p><div className="hero-buttons"><button className="button button-white" onClick={() => openResource(feature.media)}><Play size={15} fill="currentColor" />探索这部电影</button><button className="hero-save" aria-label={`收藏${feature.media.title}`} onClick={() => toggleFavorite(feature.media)}><Heart size={18} fill={favorites.includes(feature.media.id) ? 'currentColor' : 'none'} /></button></div></div><span className="hero-pagination">{featured.map((f, i) => <button key={f.media.id} className={featureIndex === i ? 'active' : ''} aria-label={`推荐：${f.media.title}`} aria-pressed={featureIndex === i} onClick={() => setFeatureIndex(i)} />)}</span><span className="hero-index">0{featureIndex + 1} <span>/ 03</span></span></div>
          <div className="together-card"><div className="together-top"><span><span className="green-dot" /> 给每一份收藏，一个位置</span><ArrowUpRight size={18} /></div><h2>你收藏的故事，<br />在这里继续。</h2><p>本地影片 · 音乐播放 · 专属片单</p><div className="together-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="mini-film film-back"><img src={catalog[2].cover} alt="你的名字海报" /></div><div className="mini-film film-front"><img src={catalog[3].cover} alt="爱乐之城海报" /></div><div className="art-play"><Play size={22} fill="currentColor" /></div><div className="art-chat"><MessageCircle size={16} /><span>这一幕，好喜欢</span><span>♡</span></div><span className="art-star star-one">✳</span><span className="art-star star-two">✧</span></div><button onClick={() => setModal('local')}>打开本地影片<ArrowRight size={16} /></button></div></section>
        </>}

        {page === 'browse' ? <ResourceSquare query={query} local={resources} favorites={favorites} onOpen={openResource} onAdd={m => { remember(m); setAddMedia(m); }} onFavorite={m => { remember(m); toggleFavorite(m); }} onImport={() => setModal('import')} notify={notify} /> : page === 'rooms' ? <section className="rooms-section"><div className="section-heading"><h2>正在放映<span className="count-pill">{rooms.length}</span></h2><span className="muted-text"><span className="green-dot" /> 每 10 秒刷新</span></div>{roomError ? <Empty title="暂时连接不上放映室" text={roomError} /> : rooms.length ? <div className="room-cards">{rooms.map(r => <button key={r.id} className="public-room" onClick={() => enterRoom(r.id)}><Cover media={r.media} /><div className="public-room-info"><span className="room-live"><span className="green-dot" /> 正在放映</span><h3>{r.name}</h3><p>{r.media.title}</p><span><Users size={14} />{r.count} / 12 人<ArrowRight size={17} /></span></div></button>)}</div> : <Empty icon={<MonitorPlay size={32} />} title={roomLoading ? '正在寻找同频的人…' : '第一场放映，等你开场'} text="现在还没有公开放映室。选一部影片，邀请朋友一起度过今晚。" action={<button className="button button-primary" onClick={() => startRoom()}><Plus size={16} />创建放映室</button>} />}<div className="room-guide"><div><MonitorPlay size={23} /><h3>同一秒的心动</h3><p>房主控制播放与进度，大家同步观看。</p></div><div><MessageCircle size={23} /><h3>让感受飘过屏幕</h3><p>实时聊天与弹幕，每一句都有人回应。</p></div><div><Headphones size={23} /><h3>就像坐在你身边</h3><p>开启麦克风，一起笑、一起分享。</p></div></div></section> : page === 'playlists' ? <section><div className="section-heading"><h2>属于你的灵感收藏<span className="count-pill">{visiblePlaylists.length}</span></h2></div><div className="playlist-grid">{visiblePlaylists.map(p => <button className="playlist-card" key={p.id} onClick={() => { setActivePlaylist(p.id); navigate('playlist'); }}><div className="playlist-collage" style={{ background: p.color }}>{p.ids.slice(0, 3).map(id => resources.find(m => m.id === id)).filter(Boolean).map((m, i) => <Cover key={m!.id} media={m!} className={`collage-${i}`} />)}{!p.ids.length && <ListMusic size={48} />}<span className="playlist-play"><Play size={20} fill="currentColor" /></span></div><h3>{p.title}</h3><p>{p.description || '收藏每一次心动'}</p><span>{p.ids.length} 个内容<ArrowUpRight size={15} /></span></button>)}<button className="playlist-create" onClick={() => setModal('playlist')}><span><Plus size={27} /></span><strong>新建播放列表</strong><p>给喜欢的内容，一个专属位置</p></button></div>{query.trim() && !visiblePlaylists.length && <Empty icon={<Search size={30} />} title="没有匹配的播放列表" text="试试列表名称或描述中的其他关键词。" action={<button className="button button-outline" onClick={() => setQuery('')}>清空搜索</button>} />}</section> : <>
          <section className="discovery-section"><div className="section-heading"><div className="heading-inline"><h2>{page === 'playlist' ? '列表中的内容' : page === 'favorites' ? '每一份喜欢，都有迹可循' : page === 'history' ? '重温喜欢的瞬间' : query ? '搜索结果' : '发现你的下一部喜欢'}</h2>{page === 'discover' && <span className="tiny-note">精选展示片单</span>}{page === 'playlist' && <span className="count-pill">{listResources.length}</span>}</div><div className="section-actions">{page === 'history' && history.length > 0 && <button className="text-link" onClick={() => { setHistory([]); notify('播放记录已清空'); }}>清空记录</button>}{!editingPlaylist && <label className="sort-select"><Settings2 size={14} /><select aria-label="资源排序" value={sort} onChange={e => setSort(e.target.value)}>{['推荐排序', '评分优先', '年份最新', '可以同步'].map(s => <option key={s}>{s}</option>)}</select><ChevronDown size={12} /></label>}</div></div>
          {page === 'playlist' && playlist && <div className="playlist-controls">
            <div className="playlist-controls-left"><button className="button button-primary" disabled={!playlist.ids.length} onClick={() => startPlaylist()}><Play size={15} fill="currentColor" />播放列表</button><PlaybackModeSelect value={playbackMode} onChange={setPlaybackMode} /><button className="button button-outline" onClick={() => setCollectionImport({})}><ListPlus size={16} />导入资源</button></div>
            <button className={`button ${editingPlaylist ? 'button-primary' : 'button-outline'}`} aria-pressed={editingPlaylist} onClick={() => { setEditingPlaylist(value => !value); setSort('推荐排序'); setCategory('全部'); setPlatform('全平台'); setTag(''); }}>{editingPlaylist ? <Check size={16} /> : <Pencil size={16} />}{editingPlaylist ? '完成编辑' : '编辑列表'}</button>
          </div>}
          {!editingPlaylist && <div className="filter-bar"><div className="category-tabs">{categories.map(c => <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c === '全部' && <Grid2X2 size={13} />}{c}</button>)}</div><div className="source-filter"><span className="filter-label">来源</span><label><select aria-label="按平台筛选" value={platform} onChange={e => setPlatform(e.target.value)}>{platforms.map(p => <option key={p}>{p}</option>)}</select><ChevronDown size={13} /></label></div></div>}
          {tag && <div className="active-filter">专题：{tag}<button aria-label="清除专题筛选" onClick={() => setTag('')}><X size={13} /></button></div>}
          {page === 'playlist' && editingPlaylist && playlist ? <PlaylistEditor playlist={playlist} resources={resources} query={query}
            onMove={(id, target) => setPlaylists(current => current.map(item => item.id === activePlaylist ? { ...item, ids: reorderPlaylist(item.ids, id, target) } : item))}
            onRemove={id => setPlaylists(current => current.map(item => item.id === activePlaylist ? { ...item, ids: item.ids.filter(value => value !== id) } : item))} onTransfer={id => setTransfer({ id, source: activePlaylist })} />
            : visibleResources.length ? <div className="media-grid">{visibleResources.map(m => <MediaCard key={m.id} media={m} onOpen={() => page === 'playlist' && m.kind === '音乐' && m.playbackType !== 'external' ? startPlaylist(m.id) : openResource(m)} onAdd={() => setAddMedia(m)} onFavorite={() => toggleFavorite(m)} favorite={favorites.includes(m.id)} />)}</div> : <Empty icon={page === 'favorites' ? <Heart size={30} /> : <Search size={30} />} title={page === 'favorites' && !isFiltered ? '把心动留在这里' : page === 'history' && !isFiltered ? '好故事，从按下播放开始' : page === 'playlist' && !isFiltered ? '这份片单，等你来填满' : '还没有找到这份内容'} text={isFiltered ? '试试其他关键词或平台，也可以直接导入一个资源链接。' : '去发现页逛一逛，或者导入你喜欢的内容。'} action={<button className="button button-outline" onClick={() => page === 'playlist' ? setCollectionImport({}) : setModal('import')}><Plus size={15} />导入资源</button>} />}
          {page === 'discover' && !isFiltered && !showAll && <button className="show-more" onClick={() => setShowAll(true)}>发现更多好内容<ChevronRight size={15} /></button>}
          </section>
          {page === 'discover' && !query && <section className="themes-section"><div className="section-heading"><div className="heading-inline"><h2>跟着心情，选一份片单</h2><span className="tiny-note">总有一种，正合此刻</span></div><button className="text-link" onClick={() => navigate('playlists')}>我的片单<ArrowUpRight size={14} /></button></div><div className="theme-grid">{themes.map(t => <button key={t.title} className="theme-card" style={{ backgroundImage: `linear-gradient(90deg, ${t.color}ee 0%, ${t.color}40 100%), url("${t.image}")` }} onClick={() => { setTag(t.tag); setCategory('全部'); document.querySelector('.discovery-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><span className="theme-label">{t.label}</span><h3>{t.title}</h3><p>{t.subtitle}</p><span className="theme-arrow"><ArrowUpRight size={16} /></span></button>)}</div></section>}
        </>}
        <footer className="page-footer"><span className="footer-brand"><Play size={11} fill="currentColor" />共映 CoPlay</span><span>把散落的喜欢，和同频的人，聚在一起。</span><span>MADE FOR SHARED MOMENTS</span></footer>
      </main>
    </div>
    {(modal === 'import' || modal === 'local') && <ImportModal onCollection={url => { setModal(null); setCollectionImport({ url, mode: 'collection' }); }} initialMode={modal === 'local' ? 'local' : 'link'} onClose={() => setModal(null)} onImported={m => { setImported(prev => [m, ...prev.filter(i => i.id !== m.id)]); setModal(null); setSelected(m); if (m.playbackType === 'local') navigate('local'); notify('资源已收进你的资源库'); }} />}
    {collectionImport && <CollectionImport playlists={playlists} initialUrl={collectionImport.url} initialMode={collectionImport.mode} initialTarget={page === 'playlist' ? activePlaylist : undefined} onClose={() => setCollectionImport(null)} onImport={(items, target, title) => {
      const id = target === 'new' ? crypto.randomUUID() : target;
      setImported(current => mergeImportedResources(current, items));
      setPlaylists(current => appendPlaylistItems(target === 'new' ? [...current, { id, title, description: items.every(item => item.playbackType === 'local') ? '本地视频与音乐' : '从链接导入的收藏', color: '#b6bfb5', ids: [] }] : current, id, items));
      setActivePlaylist(id); setCollectionImport(null); navigate('playlist'); notify(`已导入 ${items.length} 项，重复内容自动跳过`);
    }} />}
    {transfer && <PlaylistTransfer title={resources.find(item => item.id === transfer.id)?.title || '资源'} source={transfer.source} playlists={playlists} onClose={() => setTransfer(null)} onTransfer={(target, move, title) => {
      const id = target === 'new' ? crypto.randomUUID() : target;
      setPlaylists(current => transferPlaylistItem(target === 'new' ? [...current, { id, title, description: '', color: '#b6bfb5', ids: [] }] : current, transfer.source, id, transfer.id, move));
      setTransfer(null); notify(move ? '已移动到目标播放列表' : '已复制到目标播放列表');
    }} />}
    {modal === 'playlist' && <NewPlaylistModal onClose={() => { setModal(null); setNewPlaylistMedia(null); }} onCreate={title => { const p = { id: crypto.randomUUID(), title, description: '', ids: newPlaylistMedia ? [newPlaylistMedia.id] : [] as string[], color: '#b6bfb5' }; setPlaylists(old => [...old, p]); setNewPlaylistMedia(null); setActivePlaylist(p.id); setModal(null); navigate('playlist'); notify('播放列表已创建'); }} />}
    {roomsEnabled && modal === 'network' && <ShareModal onClose={() => setModal(null)} notify={notify} />}
    {modal === 'profile' && <ProfileModal onNetwork={() => setModal('network')} nickname={nickname} onSave={name => { setNickname(name); setModal(null); notify('昵称已更新'); }} onClose={() => setModal(null)} />}
    {roomsEnabled && modal === 'join' && <JoinModal onJoin={enterRoom} onClose={() => setModal(null)} />}
    {roomsEnabled && modal === 'room' && <CreateRoomModal media={roomMedia} resources={resources.filter(m => m.playbackType !== 'external')} nickname={nickname} onSelect={setRoomMedia} onClose={() => setModal(null)} onCreated={(id, key, seedKey) => { sessionStorage.setItem(`coplay:host:${id}`, key); if (seedKey) sessionStorage.setItem(`coplay:seed:${id}`, seedKey); recordPlay(roomMedia); enterRoom(id); }} />}
    {selected && <DetailModal key={selected.id} media={selected} nickname={nickname} onClose={() => setSelected(null)} favorite={favorites.includes(selected.id)} onFavorite={() => toggleFavorite(selected)} onAdd={() => { setAddMedia(selected); setSelected(null); }} onRoom={m => startRoom(m)} onPlayed={() => recordPlay(selected)} notify={notify} />}
    {addMedia && <Modal title="收进你的播放列表" subtitle={addMedia.title} onClose={() => setAddMedia(null)}><div className="choose-playlist">{playlists.map(p => { const added = p.ids.includes(addMedia.id); return <button key={p.id} onClick={() => { setPlaylists(old => old.map(item => item.id === p.id ? { ...item, ids: added ? item.ids.filter(id => id !== addMedia.id) : [...item.ids, addMedia.id] } : item)); notify(added ? '已从列表移除' : `已加入「${p.title}」`); }}><span className="list-icon" style={{ background: p.color }}><ListMusic size={20} /></span><span><strong>{p.title}</strong><small>{p.ids.length} 个内容</small></span>{added ? <Check size={18} className="orange-text" /> : <Plus size={18} />}</button>})}</div><button className="button button-outline full-width" onClick={() => { setNewPlaylistMedia(addMedia); setAddMedia(null); setModal('playlist'); }}><Plus size={16} />新建播放列表</button></Modal>}
    {queue && <QueuePlayer title={queue.title} items={queue.items} initialIndex={queue.initialIndex} mode={playbackMode} onModeChange={setPlaybackMode} onClose={() => setQueue(null)} onPlayed={recordPlay} />}
    {toast && <Toast text={toast} />}
  </div>;
}

function ImportModal({ onClose, onImported, onCollection, initialMode = 'link' }: { onCollection: (url?: string) => void; onClose: () => void; onImported: (m: Media) => void; initialMode?: ImportMode }) {
  const [mode, setMode] = useState(initialMode);
  const [url, setUrl] = useState(''); const [title, setTitle] = useState(''); const [kind, setKind] = useState<Kind>('视频'); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState<{ resource: Media; warning: string } | null>(null);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (/bilibili\.com\/(?:list\/ml|.*favlist)|music\.163\.com\/.*playlist/.test(url)) { onCollection(url); return; } setLoading(true); setError(''); try { setResult(await api('/api/import', { method: 'POST', body: JSON.stringify({ url, title, kind }) })); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } };
  const chooseFile = async (file?: File) => {
    if (!file || loading) return;
    setLoading(true); setError('');
    try { onImported(await addLocalFile(file)); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };
  return <Modal title="收藏链接，或打开本地影片" subtitle="视频、音乐、影视作品，都可以在这里相遇。" onClose={onClose}>
    <ImportModeTabs value={mode} onChange={value => { if (value === 'collection') { onCollection(url); return; } setMode(value); setResult(null); setError(''); }} />
    {mode === 'local' ? <div className="local-import">
      <div className="local-dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void chooseFile(e.dataTransfer.files[0]); }}>
        <MonitorPlay size={39} /><h3>把你的影院带到这里</h3>
        <p>拖入一个视频或音频文件，或点击选择。<br />直接在浏览器播放，文件保留在你的电脑里。</p>
        <label className="button button-primary file-button">{loading ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{loading ? '正在读取文件…' : '选择本地文件'}
          <input aria-label="选择本地文件" type="file" accept={localAccept} disabled={loading} onChange={e => void chooseFile(e.target.files?.[0])} />
        </label>
      </div>
      <p className="field-hint">推荐 H.264 / AAC 的 MP4、WebM、MP3。文件不会上传；刷新页面后需要重新选择。其他封装或编码取决于浏览器支持。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div> : <>
      <div className="import-platforms">{['哔哩哔哩', '网易云音乐', 'QQ音乐', 'YouTube', '媒体链接'].map(p => <span key={p}><PlatformIcon platform={p} />{p}</span>)}</div>
      {result ? <div className="import-result">
        <div className="import-preview"><Cover media={result.resource} /><div><strong>{result.resource.title}</strong><p>{result.resource.platform} · {result.resource.kind}</p></div><Check size={24} className="orange-text" /></div>
        {result.warning && <p className="info-box">{result.warning}</p>}
        <div className="form-actions"><button className="button button-outline" onClick={() => setResult(null)}>修改链接</button><button className="button button-primary" onClick={() => onImported(result.resource)}><Plus size={16} />收进资源库</button></div>
      </div> : <form onSubmit={submit}>
        <label className="field-label" htmlFor="resource-url">资源链接或 BV 号</label>
        <div className="input-with-icon"><Link size={17} /><input id="resource-url" required type="text" maxLength={2048} placeholder="BV1B7411m7LV，或视频 / 音乐链接…" value={url} onChange={e => setUrl(e.target.value)} autoFocus /></div>
        <p className="field-hint">支持 B 站 BV 号 / 短链接 / 番剧、网易云单曲 / 歌单、QQ 音乐单曲、YouTube、媒体直链与公开影片详情页。</p>
        <div className="form-columns"><div><label className="field-label" htmlFor="resource-title">自定义标题<span>选填</span></label><input id="resource-title" className="text-input" maxLength={150} placeholder="给这份内容起个名字" value={title} onChange={e => setTitle(e.target.value)} /></div><div><label className="field-label" htmlFor="resource-kind">内容类型</label><select className="text-input" id="resource-kind" value={kind} onChange={e => setKind(e.target.value as Kind)}>{categories.slice(1).map(c => <option key={c}>{c}</option>)}</select></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary full-width" disabled={loading || !url.trim()}>{loading ? <LoaderCircle size={17} className="spin" /> : <ArrowDownToLine size={17} />}{loading ? '正在读取资源信息…' : '读取资源信息'}</button>
        <p className="modal-footnote">通过平台公开信息与官方播放器接入，播放范围由来源平台决定。</p>
      </form>}
    </>}
  </Modal>;
}
function NewPlaylistModal({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string) => void }) { const [title, setTitle] = useState(''); return <Modal title="创建一份专属片单" subtitle="为一种心情，或一个特别的人。" onClose={onClose}><form onSubmit={e => { e.preventDefault(); if (title.trim()) onCreate(title.trim()); }}><label className="field-label" htmlFor="playlist-title">播放列表名称</label><input id="playlist-title" className="text-input" maxLength={40} autoFocus placeholder="比如：和你一起看的100部电影" value={title} onChange={e => setTitle(e.target.value)} required /><button className="button button-primary full-width spaced" disabled={!title.trim()}><Plus size={16} />创建播放列表</button></form></Modal>; }
function ProfileModal({ nickname, onSave, onClose }: { onNetwork: () => void; nickname: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(nickname);
  return <Modal title="你好，同频的朋友" subtitle="设置昵称，整理属于你的内容空间。" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
      <label className="field-label" htmlFor="nickname">我的昵称</label>
      <input className="text-input" id="nickname" maxLength={24} required value={name} onChange={e => setName(e.target.value)} />
      <p className="info-box">你的收藏、片单和昵称保存在当前浏览器中。当前仅在本机测试，放映室与公网分享已暂停。</p>
      <button className="button button-primary full-width" disabled={!name.trim()}>保存设置</button>
    </form>
  </Modal>;
}
function JoinModal({ onJoin, onClose }: { onJoin: (id: string) => void; onClose: () => void }) { const [value, setValue] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); return <Modal title="加入朋友的放映室" subtitle="粘贴邀请链接，或输入 8 位房间号。" onClose={onClose}><form onSubmit={async e => { e.preventDefault(); let id = value.trim(); try { id = new URL(id).searchParams.get('room') || id; } catch { /* A bare room code is valid. */ } if (!/^[a-f0-9]{8}$/i.test(id)) { setError('请输入正确的邀请链接或 8 位房间号'); return; } setLoading(true); try { await api(`/api/rooms/${id.toLowerCase()}`); onJoin(id.toLowerCase()); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }}><input className="text-input" aria-label="房间号或邀请链接" required value={value} onChange={e => setValue(e.target.value)} placeholder="粘贴邀请链接或房间号…" />{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary full-width spaced" disabled={loading || !value.trim()}>{loading ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}加入放映室</button></form></Modal>; }
function CreateRoomModal({ media, resources, nickname, onSelect, onClose, onCreated }: { media: Media; resources: Media[]; nickname: string; onSelect: (m: Media) => void; onClose: () => void; onCreated: (id: string, key: string, seedKey?: string) => void }) {
  const local = useLocalAsset(media.id);
  const [name, setName] = useState(`${nickname}的放映室`); const [isPublic, setPublic] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  return <Modal title="今晚，一起看点什么？" subtitle="创建放映室，让每一次播放都多一份陪伴。" onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setLoading(true); setError(''); try { const r = await api<{ id: string; hostKey: string; seedKey?: string }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name, media, public: isPublic }) }); onCreated(r.id, r.hostKey, r.seedKey); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }}><label className="field-label" htmlFor="room-name">放映室名称</label><input id="room-name" className="text-input" required maxLength={60} value={name} onChange={e => setName(e.target.value)} /><label className="field-label spaced" htmlFor="room-media">今晚的放映内容</label><select id="room-media" className="text-input" value={media.id} onChange={e => onSelect(resources.find(m => m.id === e.target.value)!)}>{resources.map(m => <option key={m.id} value={m.id}>{m.title} · {['video', 'audio', 'local'].includes(m.playbackType) ? '支持同步' : '官方嵌入播放'}</option>)}</select><div className="room-media-preview"><Cover media={media} /><div><strong>{media.title}</strong><p>{media.platform} · {media.duration}</p><span>{media.playbackType === 'embed' ? '支持聊天与语音，播放进度需各自控制' : '支持播放、暂停、进度同步'}</span></div></div>{media.playbackType === 'local' && (!local ? <LocalRestore media={media} /> : <p className="info-box">影片将通过 P2P 按需分享，不上传服务器。请保持本页面打开；朋友拖动进度时会读取相应片段。</p>)}<label className="checkbox-label"><input type="checkbox" checked={isPublic} onChange={e => setPublic(e.target.checked)} /><span>公开放映室<small>让其他同频的人也能发现并加入</small></span></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary full-width" disabled={loading || !name.trim() || media.playbackType === 'local' && !local}>{loading ? <LoaderCircle size={17} className="spin" /> : <MonitorPlay size={17} />}创建并进入放映室</button></form></Modal>;
}
function DetailModal({ media: originalMedia, nickname, onClose, favorite, onFavorite, onAdd, onRoom, onPlayed, notify }: { media: Media; nickname: string; onClose: () => void; favorite: boolean; onFavorite: () => void; onAdd: () => void; onRoom: (m: Media) => void; onPlayed: () => void; notify: (s: string) => void }) {
  const [episode, setEpisode] = useState(originalMedia.defaultEpisode || 0);
  const media = originalMedia.episodes?.[episode] ? { ...originalMedia, playbackUrl: originalMedia.episodes[episode].url } : originalMedia;
  const [playing, setPlaying] = useState(originalMedia.kind === '音乐' && originalMedia.playbackType !== 'external'); const [tab, setTab] = useState('简介'); const [comments, setComments] = useState<Comment[]>([]); const [comment, setComment] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const played = useRef(onPlayed); played.current = onPlayed;
  useEffect(() => { if (playing) played.current(); }, [playing, episode]);
  useEffect(() => { let active = true; api<Comment[]>(`/api/resources/${media.id}/comments`).then(data => { if (active) setComments(data); }).catch(() => { if (active) setError('评论暂时无法加载'); }); return () => { active = false; }; }, [media.id]);
  return <Modal title={media.title} subtitle={`${media.subtitle} ${media.year ? `· ${media.year}` : ''}`} onClose={onClose} wide>
    <div className="detail-top">{playing ? <div className={`detail-player ${media.kind === '音乐' ? 'music-embed' : ''}`}>
      <ResourcePlayer media={media} onError={() => setError('媒体无法播放，请检查链接、跨域许可或本地文件的编码（推荐 H.264 MP4 / WebM）')} />
      <button className="close-player" aria-label="关闭播放器" onClick={() => setPlaying(false)}><X size={16} /></button>
    </div> : <><Cover media={media} className="detail-cover" /><div className="detail-summary">
      <div className="detail-tags"><span>{media.kind}</span>{media.tags.map(t => <span key={t}>{t}</span>)}</div><p>{media.description}</p>
      <div className="detail-meta"><span><Clock3 size={14} />{media.duration}</span><span><PlatformIcon platform={media.platform} />{media.platform}</span>{media.rating && <span className="detail-rating"><Star size={14} fill="currentColor" />{media.rating}<small>推荐分</small></span>}</div>
      <div className="detail-buttons">
        {media.playbackType === 'external' ? <a className="button button-primary" href={media.url} target="_blank" rel="noreferrer" onClick={onPlayed}><ArrowUpRight size={16} />去平台发现</a> : <button className="button button-primary" onClick={() => { setPlaying(true); setError(''); }}><Play size={16} fill="currentColor" />{media.demo ? '播放预告片' : '立即播放'}</button>}
        {roomsEnabled && <button className="button button-outline" disabled={media.playbackType === 'external'} onClick={() => onRoom(media)}><Users size={16} />一起看</button>}
        <button className={`icon-button bordered ${favorite ? 'orange-text' : ''}`} aria-label="收藏资源" onClick={onFavorite}><Heart size={18} fill={favorite ? 'currentColor' : 'none'} /></button><button className="icon-button bordered" aria-label="加入播放列表" onClick={onAdd}><Plus size={19} /></button>
      </div>
    </div></>}</div>
    {playing && <div className="playing-detail-actions"><button className={`button button-outline ${favorite ? 'orange-text' : ''}`} onClick={onFavorite}><Heart size={15} fill={favorite ? 'currentColor' : 'none'} />{favorite ? '已收藏' : '收藏'}</button><button className="button button-outline" onClick={onAdd}><Plus size={16} />加入播放列表</button></div>}
    {!!media.episodes?.length && <div className="episode-selector"><label htmlFor="episode-select">{media.kind === '音乐' ? '选曲' : '选集'}</label><select id="episode-select" className="text-input" value={episode} onChange={e => { setEpisode(Number(e.target.value)); setError(''); setPlaying(true); }}>{media.episodes.map((ep, i) => <option key={`${i}-${ep.url}`} value={i}>{ep.title}</option>)}</select><span>{media.episodes.length} {media.kind === '音乐' ? '首' : '集 / 线路'}</span></div>}
    {media.playbackType !== 'local' && <AttachDownloadedFile key={media.playbackUrl || media.id} media={media} />}
    {media.download && <DownloadPanel key={`${media.download.bvid}:${media.episodes?.[episode]?.page || media.download.page}`} media={media} page={media.episodes?.[episode]?.page || media.download.page} />}
    <div className="detail-tabs">{['简介', '数据', '评论'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}{t === '评论' && <span>{comments.length}</span>}</button>)}<SourceLink media={media} /></div>
    {tab === '简介' ? <div className="detail-body"><h3>关于这份内容</h3><p>{media.description}</p><p className="attribution">{media.attribution || (media.demo ? '精选展示条目，海报与推荐分用于片单展示；请前往来源平台确认实际播放权限。' : media.playbackType === 'local' ? '本机文件，仅在当前浏览器读取与播放。' : '导入的内容由来源平台或媒体提供方提供。')}</p>{media.playbackType === 'embed' && <p className="info-box">{bilibiliPlaybackTarget(media.playbackUrl)?.bvid ? '优先播放 B 站提供的公开视频，可拖动进度或选择分 P。需要平台弹幕或登录时，可切换官方播放器。' : '使用平台官方嵌入播放器，实际播放权限与可用性由来源平台决定。'}</p>}</div>
      : tab === '数据' ? <div className="detail-body"><div className="stats-grid">{[{ label: '播放', value: media.stats?.views, icon: Play }, { label: '弹幕', value: media.stats?.danmaku, icon: Tv }, { label: '平台评论', value: media.stats?.comments, icon: MessageCircle }, { label: '平台收藏', value: media.stats?.favorites, icon: Heart }].map(s => <div key={s.label}><s.icon size={18} /><strong>{compactNumber(s.value)}</strong><span>{s.label}</span></div>)}</div><p className="muted-text">{media.stats ? '数据为导入时的平台快照，可重新导入同一链接刷新。' : '此资源暂未获取平台统计数据。共映中的评论独立保存。'}</p></div>
      : <div className="detail-body comments-body">
        <form onSubmit={async e => { e.preventDefault(); if (!comment.trim()) return; setLoading(true); setError(''); try { const c = await api<Comment>(`/api/resources/${media.id}/comments`, { method: 'POST', body: JSON.stringify({ text: comment, nickname }) }); setComments(prev => [...prev, c]); setComment(''); notify('你的感受，已被留下'); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }}>
          <textarea aria-label="分享你的感受" placeholder="这一部，哪一幕打动了你？" maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} /><div><span>共映社区评论 · {nickname}</span><button className="button button-primary" disabled={loading || !comment.trim()}>{loading ? '发送中…' : '发布评论'}</button></div>
        </form>
        {comments.length ? [...comments].reverse().map(c => <div className="comment" key={c.id}><span className="comment-avatar">{c.nickname.slice(0, 1)}</span><div><strong>{c.nickname}<time>{new Date(c.at).toLocaleDateString('zh-CN')}</time></strong><p>{c.text}</p></div></div>) : <p className="no-comments">还没有评论，来分享第一份感受吧。</p>}
      </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
