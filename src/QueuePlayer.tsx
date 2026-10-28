import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ListMusic, LocateFixed, Play, RotateCcw, Search, X } from 'lucide-react';
import { Modal, PlatformIcon } from './components';
import type { Media } from './types';
import { ResourcePlayer } from './MediaPlayer';
import { bilibiliPlaybackTarget } from './bilibili-player';
import { useLocalAsset } from './local-media';
import { downloadedKey, useDownloadedLibrary } from './downloaded-media';
import PlaybackModeSelect from './PlaybackModeSelect';
import { mediaMatchesSearch } from './playlist-search';
import { canStepQueue, changeQueueMode, createQueue, playbackModes, selectQueueItem, stepQueue, type PlaybackMode } from './playback-queue';

export default function QueuePlayer({ title, items, initialIndex, mode, onModeChange, onClose, onPlayed }: { title: string; items: Media[]; initialIndex?: number; mode: PlaybackMode; onModeChange: (mode: PlaybackMode) => void; onClose: () => void; onPlayed: (m: Media) => void }) {
  const [state, setState] = useState(() => createQueue(items.length, mode, initialIndex));
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [locateRequest, setLocateRequest] = useState(0);
  const currentItem = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!locateRequest) return;
    const row = currentItem.current, list = row?.closest<HTMLElement>('.queue-list'), body = row?.closest<HTMLElement>('.modal-body');
    if (!row || !list || !body) return;
    // Move only the two content scrollers, keeping the dialog heading and playback untouched.
    const rowBounds = row.getBoundingClientRect(), listBounds = list.getBoundingClientRect(), bodyBounds = body.getBoundingClientRect();
    list.scrollTop += rowBounds.top - listBounds.top - list.clientTop - (list.clientHeight - rowBounds.height) / 2;
    body.scrollTop += listBounds.top - bodyBounds.top - body.clientTop - (body.clientHeight - listBounds.height) / 2;
    row.focus({ preventScroll: true });
  }, [locateRequest]);
  const visible = items.map((item, index) => ({ item, index })).filter(({ item }) => mediaMatchesSearch(item, query));
  const played = useRef(onPlayed); played.current = onPlayed;
  const media = items[state.index];
  const library = useDownloadedLibrary();
  const attached = useLocalAsset(downloadedKey(media));
  const localCopy = !!attached || library.items.some(item => item.key === downloadedKey(media) && item.complete);
  useEffect(() => { setError(''); played.current(media); }, [media, state.version]);
  const step = (reason: 'ended' | 'next' | 'previous') => { const choice = Math.random(); setState(current => stepQueue(current, items.length, mode, reason, () => choice)); };
  const select = (index: number) => setState(current => selectQueueItem(current, index, items.length));
  return <Modal title={title} subtitle={`${state.finished ? '播放完毕' : '正在播放'} ${state.index + 1} / ${items.length} · ${media.title}`} onClose={onClose} wide>
    <div className={`detail-player ${media.kind === '音乐' ? 'music-embed' : ''}`}>
      <ResourcePlayer key={`${media.id}:${state.version}`} media={media} onEnded={() => step('ended')} onError={() => setError('这个媒体暂时无法播放，可以跳到下一项。')} />
    </div>
    <div className="queue-toolbar">
      <PlaybackModeSelect label="队列播放规则" value={mode} onChange={value => { setState(current => changeQueueMode(current, items.length)); onModeChange(value); }} />
      <div><button className="icon-button bordered" aria-label="上一项" disabled={!canStepQueue(state, items.length, mode, 'previous')} onClick={() => step('previous')}><ChevronLeft size={19} /></button><button className="icon-button bordered" aria-label="下一项" disabled={!canStepQueue(state, items.length, mode, 'next')} onClick={() => step('next')}><ChevronRight size={19} /></button></div>
    </div>
    <p className="queue-rule-description" role="status"><ListMusic size={14} />{state.finished ? '列表已播放完毕。' : playbackModes.find(value => value.value === mode)?.description}{state.finished && <button className="text-link" onClick={() => select(0)}><RotateCcw size={14} />重新播放</button>}</p>
    {media.playbackType === 'embed' && !localCopy && <p className="queue-platform-notice">{bilibiliPlaybackTarget(media.playbackUrl)?.bvid ? '本机播放支持以上规则；切到官方播放器后，需手动选择上一项或下一项。' : '该平台播放器不提供播放结束通知，需手动选择上一项或下一项；单曲重播可点击队列中的当前项。'}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="queue-search-row">
      <div className="input-with-icon"><Search size={16} /><input type="search" aria-label="搜索播放队列" placeholder="搜索标题、作者或来源" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="plain-icon" aria-label="清空队列搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div>
      <button className="button button-outline queue-locate" onClick={() => { setQuery(''); setLocateRequest(value => value + 1); }}><LocateFixed size={15} />定位当前播放</button>
      <span role="status">{query.trim() ? `${visible.length} / ${items.length} 项` : `${items.length} 项内容`}</span>
    </div>
    <div className="queue-list">{visible.map(({ item: m, index: i }) => <button ref={state.index === i ? currentItem : undefined} className={state.index === i ? 'active' : ''} aria-label={`播放${m.title}`} aria-current={state.index === i ? 'true' : undefined} key={m.id} onClick={() => select(i)}><span>{i === state.index ? <Play size={13} fill="currentColor" /> : String(i + 1).padStart(2, '0')}</span><div className="queue-item-info"><strong>{m.title}</strong><small>{m.subtitle}</small></div><PlatformIcon platform={m.platform} size={13} /><span>{m.duration}</span></button>)}</div>
    {!visible.length && <p className="queue-search-empty" role="status">没有匹配的内容，试试其他关键词或清空搜索。</p>}
    <p className="modal-footnote">当前队列包含片单中的可播放内容。仅支持前往来源平台的条目不会加入队列。</p>
  </Modal>;
}
