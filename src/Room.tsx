import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowLeft, Check, ChevronRight, Copy, Crown, Headphones, Link, LoaderCircle, LogOut, MessageCircle, Mic, MicOff, MonitorPlay, Play, Radio, Send, Users, VolumeX, Wifi, WifiOff } from 'lucide-react';
import type { ChatMessage, Media, PlaybackState, RoomState } from './types';
import { api } from './hooks';
import { Cover, Empty, PlatformIcon } from './components';
import { useVoice } from './voice';
import { useFileShare } from './use-file-share';
import { VideoPlayer, LocalRestore } from './MediaPlayer';
import ShareModal from './ShareModal';
import { bytesLabel } from './local-media';

export default function Room({ roomId, nickname, onLeave, notify, onPlayed }: { roomId: string; nickname: string; onLeave: () => void; notify: (text: string) => void; onPlayed: (m: Media) => void }) {
  const [preview, setPreview] = useState<{ name: string; media: Media; count: number } | null>(null);
  const [error, setError] = useState(''); const [joined, setJoined] = useState(false); const [name, setName] = useState(nickname);
  const [socket, setSocket] = useState<Socket | null>(null); const [room, setRoom] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false); const [selfId, setSelfId] = useState('');
  const [message, setMessage] = useState(''); const [sending, setSending] = useState(false); const [sendDanmaku, setSendDanmaku] = useState(true); const [showDanmaku, setShowDanmaku] = useState(true);
  const [danmaku, setDanmaku] = useState<(ChatMessage & { lane: number })[]>([]); const [sideTab, setSideTab] = useState('聊天');
  const [needsPlay, setNeedsPlay] = useState(false); const [shareOpen, setShareOpen] = useState(false); const [mediaError, setMediaError] = useState('');
  const video = useRef<HTMLVideoElement>(null); const roomRef = useRef<RoomState | null>(null); const selfRef = useRef('');
  const offset = useRef(0); const playback = useRef<PlaybackState | null>(null); const applying = useRef(false); const chatEnd = useRef<HTMLDivElement>(null); const lane = useRef(0);
  const notifier = useRef(notify); notifier.current = notify; const recorded = useRef(onPlayed); recorded.current = onPlayed;
  const voice = useVoice(socket, notify);
  const fileShare = useFileShare(socket, room, selfId);
  const isHost = room?.hostId === selfId;
  const direct = room && ['audio', 'video', 'local'].includes(room.media.playbackType);
  const localMedia = room?.media.playbackType === 'local';
  const mediaUrl = localMedia ? fileShare.url : room?.media.playbackUrl;
  const applyPlayback = (p: PlaybackState, force = false) => {
    playback.current = p;
    const player = video.current;
    if (!player || player.readyState < 1 || !force && roomRef.current?.hostId === selfRef.current) return;
    applying.current = true;
    const time = p.time + (p.playing ? Math.max(0, (Date.now() + offset.current - p.updatedAt) / 1000) : 0);
    if (Math.abs(player.currentTime - time) > 1.1) player.currentTime = Math.min(time, Number.isFinite(player.duration) ? player.duration : time);
    if (p.playing && player.paused) player.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
    if (!p.playing && !player.paused) player.pause();
    setTimeout(() => { applying.current = false; }, 150);
  };
  useEffect(() => {
    let active = true;
    api<{ name: string; media: Media; count: number }>(`/api/rooms/${encodeURIComponent(roomId)}`).then(data => { if (active) setPreview(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [roomId]);
  useEffect(() => {
    if (!joined) return;
    const connection = io({ autoConnect: false }); setSocket(connection);
    const join = () => {
      connection.emit('room:join', { id: roomId, nickname: name, hostKey: sessionStorage.getItem(`coplay:host:${roomId}`) }, (result: { error?: string; room: RoomState & { serverTime: number }; selfId: string }) => {
        if (result.error) { setError(result.error); setConnected(false); connection.disconnect(); return; }
        selfRef.current = result.selfId; setSelfId(result.selfId); roomRef.current = result.room; setRoom(result.room); setConnected(true); setError('');
        offset.current = result.room.serverTime - Date.now(); playback.current = result.room.playback; recorded.current(result.room.media);
        applyPlayback(result.room.playback, true);
      });
    };
    connection.on('connect', join);
    connection.on('connect_error', () => { setConnected(false); setError('正在重新连接放映室，请检查网络或服务是否启动'); });
    connection.on('disconnect', () => setConnected(false));
    connection.on('room:state', (state: RoomState & { serverTime: number }) => { roomRef.current = state; setRoom(state); offset.current = state.serverTime - Date.now(); applyPlayback(state.playback); });
    connection.on('playback:sync', (p: PlaybackState & { serverTime: number }) => { offset.current = p.serverTime - Date.now(); applyPlayback(p); });
    connection.on('chat:message', (m: ChatMessage) => { setRoom(old => old ? { ...old, messages: [...old.messages, m].slice(-200) } : old); if (m.type === 'danmaku') { lane.current = (lane.current + 1) % 6; setDanmaku(old => [...old.slice(-24), { ...m, at: Date.now(), lane: lane.current }]); } });
    connection.on('voice:state', ({ id, enabled }: { id: string; enabled: boolean }) => setRoom(old => old ? { ...old, members: old.members.map(m => m.id === id ? { ...m, mic: enabled } : m) } : old));
    connection.connect();
    const timer = setInterval(() => {
      const player = video.current;
      if (roomRef.current?.hostId === selfRef.current && player && player.readyState > 0) connection.emit('playback:update', { time: player.currentTime, playing: !player.paused && !player.ended });
      else if (playback.current) applyPlayback(playback.current);
      setDanmaku(old => old.filter(d => Date.now() - d.at < 9500));
    }, 3000);
    return () => { clearInterval(timer); connection.removeAllListeners(); connection.disconnect(); setSocket(null); };
  }, [joined, roomId]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [room?.messages.length, sideTab]);
  const broadcastPlayback = () => { const player = video.current; if (!applying.current && isHost && connected && player) socket?.emit('playback:update', { time: player.currentTime, playing: !player.paused && !player.ended }); };
  const copy = () => setShareOpen(true);
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault(); if (!message.trim() || !socket?.connected || sending) return;
    setSending(true);
    socket.timeout(6000).emit('chat:send', { text: message, type: sendDanmaku ? 'danmaku' : 'chat' }, (timeout: Error | null, result: { error?: string }) => {
      setSending(false); if (timeout) { notify('消息发送超时，请重试'); return; } if (result.error) notify(result.error); else setMessage('');
    });
  };

  if (!joined || !room) return <div className="room-entry-page"><button className="room-back" onClick={onLeave}><ArrowLeft size={18} />返回共映</button><div className="room-entry-card"><div className="room-entry-symbol"><MonitorPlay size={34} /></div>{error ? <Empty title="暂时无法进入放映室" text={error} action={<button className="button button-primary" onClick={onLeave}>返回发现</button>} /> : preview ? <><span className="eyebrow">SOME MOMENTS ARE BETTER TOGETHER</span><h1>{preview.name}</h1><p>有人为你留了一个位置。</p><div className="room-media-preview"><Cover media={preview.media} /><div><strong>{preview.media.title}</strong><p>{preview.media.platform}</p><span>{preview.count} 位朋友在这里 · 最多 12 人</span></div></div><form onSubmit={e => { e.preventDefault(); if (name.trim()) setJoined(true); }}><label className="field-label" htmlFor="join-nickname">怎么称呼你</label><input id="join-nickname" className="text-input" maxLength={24} value={name} onChange={e => setName(e.target.value)} required /><button className="button button-primary full-width spaced" disabled={joined || !name.trim()}>{joined ? <LoaderCircle size={17} className="spin" /> : <Play size={17} fill="currentColor" />}{joined ? '正在连接…' : '进入放映室'}</button></form><p className="modal-footnote">麦克风默认关闭，进入后可随时开启。</p></> : <div className="loading"><LoaderCircle className="spin" /><p>正在寻找你的放映室…</p></div>}</div></div>;

  return <div className="watch-page"><header className="watch-header"><button className="room-back" onClick={onLeave}><ArrowLeft size={19} /><span className="watch-brand">共映<span>CoPlay</span></span></button><span className="watch-header-divider" /><div className="watch-title"><h1>{room.name}</h1><span>房间号 {roomId}<span className="meta-dot">·</span>{room.public ? '公开放映室' : '私密放映室'}</span></div><div className={`connection-state ${connected ? '' : 'offline'}`}>{connected ? <Wifi size={14} /> : <WifiOff size={14} />}{connected ? '已连接' : '正在重连'}</div><button className="button button-primary" onClick={copy}><Link size={15} />邀请朋友</button><button className="icon-button leave-room" onClick={onLeave} aria-label="离开放映室"><LogOut size={19} /></button></header>
    <main className="watch-layout"><section className="watch-main"><div className="watch-video-container"><div className={`watch-video ${room.media.kind === '音乐' ? 'watch-audio' : ''}`}>
      {room.media.playbackType === 'embed' ? <iframe src={room.media.playbackUrl} title={room.media.title} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> : mediaUrl ? <VideoPlayer ref={video} src={mediaUrl} controls playsInline preload="metadata" poster={room.media.cover} onPlay={broadcastPlayback} onPause={broadcastPlayback} onSeeked={broadcastPlayback} onEnded={broadcastPlayback} onLoadedMetadata={() => { if (playback.current) applyPlayback(playback.current, true); }} onError={() => setMediaError(localMedia ? '本地影片无法解码或片段传输中断。请重连，或改用浏览器支持的 H.264 MP4 / WebM。' : '影片暂时无法加载，请确认媒体链接有效并允许跨域播放。')} /> : <div className="p2p-video-placeholder">{localMedia && fileShare.canProvide ? <LocalRestore media={room.media} /> : <><MonitorPlay size={39} /><strong>{fileShare.state === 'waiting' ? '等待文件提供者上线' : fileShare.state === 'error' ? 'P2P 连接需要重试' : '正在连接影片提供者…'}</strong><p>{fileShare.error || '通过 P2P 拉取需要的片段，连接后即可开始同步观看。'}</p><button className="button button-outline" onClick={fileShare.reconnect}>重新连接</button></>}</div>}
      {showDanmaku && <div className="danmaku-layer" aria-hidden="true">{danmaku.map(d => <span key={d.id} className={d.sender === selfId ? 'my-danmaku' : ''} style={{ top: `${10 + d.lane * 10}%` }}>{d.text}</span>)}</div>}
      {needsPlay && <button className="autoplay-gate" onClick={() => { video.current?.play().then(() => { setNeedsPlay(false); if (playback.current) applyPlayback(playback.current); }).catch(() => notify('浏览器暂时无法播放这个媒体')); }}><span><Play size={28} fill="currentColor" /></span>点击加入同步播放</button>}
      {mediaError && <div className="media-error"><MonitorPlay size={30} /><p>{mediaError}</p><button className="button button-outline" onClick={() => { setMediaError(''); if (localMedia) fileShare.reconnect(); else video.current?.load(); }}>重新加载</button></div>}
    </div><div className="watch-control-bar"><span className="sync-indicator"><span className="green-dot" />{direct ? isHost ? '你是房主 · 控制大家的播放进度' : '跟随房主同步播放' : '官方播放器 · 进度由各自控制'}</span><label className="danmaku-toggle"><input type="checkbox" checked={showDanmaku} onChange={e => setShowDanmaku(e.target.checked)} />弹幕<span className={`switch ${showDanmaku ? 'on' : ''}`} /></label></div></div>
      {localMedia && <div className="p2p-status-bar"><span className={`source-dot ${fileShare.state === 'ready' || fileShare.state === 'seeding' || fileShare.state === 'local' ? 'ok' : 'error'}`} /><div><strong>{fileShare.state === 'seeding' ? '正在提供本地影片 · P2P' : fileShare.state === 'local' ? '使用本地文件播放' : fileShare.state === 'ready' ? 'P2P 已连接 · 按需拉取' : fileShare.state === 'waiting' ? '文件提供者暂时离线' : '正在建立 P2P 连接'}</strong><p>{fileShare.error || (fileShare.local ? '请保持此页面打开，朋友可以边传边播和跳转进度。' : '文件片段保存在当前会话的有界缓存中，不会上传服务器。')}</p></div><span className="p2p-byte-count">{fileShare.local ? `已发送 ${bytesLabel(fileShare.sent)}` : `已接收 ${bytesLabel(fileShare.received)}`}</span>{!fileShare.local && <button className="text-link" onClick={() => { setMediaError(''); fileShare.reconnect(); }}>重连</button>}</div>}<div className="watch-media-info"><div className="watch-media-title"><div><span className="watch-media-label">NOW SHOWING</span><h2>{room.media.title}</h2><div><PlatformIcon platform={room.media.platform} /><span>{room.media.platform}</span><span>·</span><span>{room.media.duration}</span></div></div><span className="watch-viewers"><Users size={17} />{room.members.length} 人一起看</span></div><p>{room.media.description}</p>{room.media.attribution && <small className="watch-attribution">{room.media.attribution}</small>}{!direct && <p className="embed-notice">平台播放器暂不开放远程控制，播放与暂停需各自操作；聊天室、弹幕和语音实时共享。</p>}</div><div className="watch-company"><div className="company-avatars">{room.members.slice(0, 5).map((m, i) => <span key={m.id} style={{ background: ['#f6b48c', '#a5bcae', '#b9acd0', '#d1bd8e', '#9baebf'][i] }}>{m.nickname.slice(0, 1)}</span>)}</div><div><strong>好故事，有人一起才更好。</strong><p>把这个时刻，分享给你想念的人。</p></div><button onClick={copy}>邀请朋友<ChevronRight size={15} /></button></div>
    </section><aside className="watch-chat"><div className="chat-tabs">{['聊天', '成员'].map(t => <button key={t} className={sideTab === t ? 'active' : ''} onClick={() => setSideTab(t)}>{t === '聊天' ? <MessageCircle size={16} /> : <Users size={16} />}{t}{t === '成员' && <span>{room.members.length}</span>}</button>)}</div>{sideTab === '聊天' ? <><div className="chat-messages"><div className="chat-welcome"><span><SparklesIcon /></span><p>欢迎来到我们的放映室<br /><small>分享感受，让此刻多一点共鸣。</small></p></div>{room.messages.map(m => <div className={`chat-message ${m.sender === selfId ? 'self' : ''}`} key={m.id}><span className="chat-avatar">{m.nickname.slice(0, 1)}</span><div><div className="chat-message-meta"><strong>{m.nickname}</strong>{m.sender === room.hostId && <Crown size={12} />}<time>{new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{m.text}</p>{m.type === 'danmaku' && <small>已发送弹幕</small>}</div></div>)}<div ref={chatEnd} /></div><form className="chat-composer" onSubmit={sendMessage}><div className="composer-options"><label><input type="checkbox" checked={sendDanmaku} onChange={e => setSendDanmaku(e.target.checked)} /><span>同时发送弹幕</span></label><span>{message.length}/500</span></div><div className="composer-input"><input aria-label="发送消息" value={message} onChange={e => setMessage(e.target.value)} maxLength={500} placeholder={connected ? '这一刻，想说点什么…' : '正在重新连接…'} disabled={!connected} /><button aria-label="发送" disabled={!connected || !message.trim() || sending}><Send size={18} /></button></div></form></> : <div className="room-members">{room.members.map((m, i) => <div key={m.id}><span className={`member-avatar member-color-${i % 4}`}>{m.nickname.slice(0, 1)}</span><span><strong>{m.nickname}{m.id === selfId && <small>（我）</small>}</strong><small>{m.id === room.hostId ? '房主' : '正在一起看'}</small></span>{m.id === room.hostId && <Crown size={16} className="orange-text" />}{m.mic ? <Mic size={17} className="green-text" /> : <MicOff size={17} />}</div>)}<button className="button button-outline full-width" onClick={copy}><PlusIcon />邀请一位朋友</button></div>}
      <div className="voice-controls"><button className={voice.enabled ? 'mic-active' : ''} disabled={voice.busy || !connected} onClick={voice.toggleMic}>{voice.busy ? <LoaderCircle size={18} className="spin" /> : voice.enabled ? <Mic size={18} /> : <MicOff size={18} />}<span>{voice.enabled ? '麦克风已开' : '开启麦克风'}</span></button><button onClick={voice.toggleListening}>{voice.listening ? <Headphones size={18} /> : <VolumeX size={18} />}<span>{voice.listening ? '正在收听' : '收听语音'}</span></button></div>
    </aside></main><footer className="watch-footer"><Radio size={13} />此刻，我们同频。<span>共映 CoPlay · SHARED MOMENTS</span></footer>
    {shareOpen && <ShareModal roomId={roomId} onClose={() => setShareOpen(false)} notify={notify} />}
  </div>;
}
function SparklesIcon() { return <span className="chat-sparkle">✳</span>; }
function PlusIcon() { return <Users size={16} />; }
