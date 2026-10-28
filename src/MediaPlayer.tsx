import { forwardRef, useEffect, useRef, useState, type VideoHTMLAttributes } from 'react';
import { ArrowUpRight, FolderOpen, LoaderCircle, Music2, Play, RefreshCw } from 'lucide-react';
import type { Media } from './types';
import { attachLocalCopy, localAccept, restoreLocalFile, useLocalAsset } from './local-media';
import { api } from './hooks';
import { bilibiliEmbedUrl, bilibiliPlaybackTarget } from './bilibili-player';
import { musicEmbedUrl, requiresMusicPlayClick } from './music-player';
import { downloadedKey, refreshDownloadedLibrary, useDownloadedLibrary, type DownloadedMedia } from './downloaded-media';

export const VideoPlayer = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement>>(function VideoPlayer({ src, ...props }, ref) {
  const player = useRef<HTMLVideoElement | null>(null);
  const callback = useRef(props.onError); callback.current = props.onError;
  useEffect(() => {
    const video = player.current; if (!video || !src) return;
    let destroy: (() => void) | undefined; let canceled = false;
    if (/\.m3u8(?:\?|$)/i.test(src) && !video.canPlayType('application/vnd.apple.mpegurl')) {
      void import('hls.js').then(({ default: Hls }) => {
        if (canceled) return;
        if (!Hls.isSupported()) { video.dispatchEvent(new Event('error')); return; }
        const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
        hls.loadSource(src); hls.attachMedia(video); destroy = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) video.dispatchEvent(new Event('error')); });
        if (props.autoPlay) hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(() => {}); });
      }).catch(() => video.dispatchEvent(new Event('error')));
    } else video.src = src;
    return () => { canceled = true; destroy?.(); video.removeAttribute('src'); video.load(); };
  }, [src]);
  return <video {...props} ref={node => { player.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }} />;
});
export function LocalRestore({ media, onError }: { media: Media; onError?: (message: string) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <div className="local-restore"><FolderOpen size={28} /><strong>重新选择本地影片</strong><p>刷新后浏览器需要重新获得文件。请选择「{media.localFile?.name}」。</p><label className={`button button-primary file-button ${busy ? 'disabled' : ''}`}>{busy ? <LoaderCircle size={16} className="spin" /> : <FolderOpen size={16} />}选择同一文件<input type="file" accept={localAccept} disabled={busy} aria-label="重新选择本地影片" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; setBusy(true); setError(''); try { await restoreLocalFile(media, file); } catch (e) { const message = (e as Error).message; setError(message); onError?.(message); } finally { setBusy(false); } }} /></label>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
type PlayerProps = { media: Media; autoPlay?: boolean; onEnded?: () => void; onError?: () => void };
export function ResourcePlayer(props: PlayerProps) {
  const attached = useLocalAsset(downloadedKey(props.media));
  if (attached) return <OnlineResourcePlayer {...props} media={{ ...props.media, playbackType: props.media.kind === '音乐' ? 'audio' : 'video', playbackUrl: attached.url }} />;
  if (props.media.playbackType === 'local') return <OnlineResourcePlayer {...props} />;
  return <CheckDownloadedPlayer key={`${props.media.id}:${props.media.playbackUrl}`} {...props} />;
}
function CheckDownloadedPlayer(props: PlayerProps) {
  const library = useDownloadedLibrary();
  const [checked, setChecked] = useState(false);
  useEffect(() => { let active = true; void refreshDownloadedLibrary(true).then(() => { if (active) setChecked(true); }); return () => { active = false; }; }, []);
  if (!checked) return <div className="local-copy-status" role="status"><LoaderCircle size={22} className="spin" />正在检查本地下载…</div>;
  return <PreferDownloadedPlayer {...props} library={library} />;
}
function PreferDownloadedPlayer({ library, ...props }: PlayerProps & { library: { ready: boolean; items: DownloadedMedia[] } }) {
  const match = () => library.items.find(item => item.key === downloadedKey(props.media) && item.complete) || null;
  const [copy, setCopy] = useState<DownloadedMedia | null | undefined>(() => library.ready ? match() : undefined);
  const [segment, setSegment] = useState(0), [failed, setFailed] = useState(false);
  useEffect(() => { if (copy === undefined && library.ready) setCopy(match()); }, [copy, library]);
  if (copy === undefined) return <div className="local-copy-status" role="status"><LoaderCircle size={22} className="spin" />正在检查本地下载…</div>;
  if (!copy) return <OnlineResourcePlayer {...props} />;
  return <div className="downloaded-player">
    <div className="downloaded-player-stage">{failed ? <div className="local-copy-status" role="alert">本地副本已移动、删除或无法播放。<button className="button button-outline" onClick={() => setCopy(null)}>改用在线播放</button></div> : <VideoPlayer key={copy.files[segment].id} src={copy.files[segment].url} controls autoPlay={props.autoPlay ?? true} playsInline onError={() => setFailed(true)} onEnded={() => segment < copy.files.length - 1 ? setSegment(value => value + 1) : props.onEnded?.()} />}</div>
    <div className="downloaded-player-label"><span>正在播放已下载资源{copy.files.length > 1 ? ` · 分段 ${segment + 1} / ${copy.files.length}` : ''}</span><button className="text-link" onClick={() => setCopy(null)}>使用在线来源</button></div>
  </div>;
}
function OnlineResourcePlayer({ media, autoPlay = true, onEnded, onError }: { media: Media; autoPlay?: boolean; onEnded?: () => void; onError?: () => void }) {
  const local = useLocalAsset(media.id);
  const src = media.playbackType === 'local' ? local?.url : media.playbackUrl;
  if (media.playbackType === 'local' && !src) return <LocalRestore media={media} />;
  if (media.playbackType === 'embed') {
    const bili = bilibiliPlaybackTarget(src);
    if (bili) return <BilibiliPlayer key={`${media.id}:${src}`} media={media} target={bili} autoPlay={autoPlay} onEnded={onEnded} />;
    const embed = media.kind === '音乐' ? musicEmbedUrl(src, autoPlay) : src;
    const frame = <iframe title={media.title} src={embed} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />;
    return requiresMusicPlayClick(embed) ? <div className="platform-music-player">{frame}<p>QQ 音乐需在播放器内点击播放。</p></div> : frame;
  }
  if (media.kind === '音乐' && !/\.m3u8(?:\?|$)/i.test(src || '')) return <AudioPlayer key={`${media.id}:${src}`} media={media} src={src} autoPlay={autoPlay} onEnded={onEnded} onError={onError} />;
  return <VideoPlayer key={media.id} src={src} controls autoPlay={autoPlay} playsInline onEnded={onEnded} onError={onError} poster={media.cover} className={media.kind === '音乐' ? 'audio-player' : ''} />;
}

function AudioPlayer({ media, src, autoPlay, onEnded, onError }: { media: Media; src?: string; autoPlay: boolean; onEnded?: () => void; onError?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let active = true;
    const player = audio.current;
    if (autoPlay && src) void player?.play().catch(error => { if (active && error.name === 'NotAllowedError') setBlocked(true); });
    return () => { active = false; player?.pause(); };
  }, [src, autoPlay]);
  return <div className="native-audio-player">
    <div className="audio-art">{media.cover ? <img src={media.cover} alt="" /> : <Music2 size={36} />}</div>
    <div className="audio-info"><strong>{media.title}</strong><span>{media.subtitle || media.platform}</span>
      <audio ref={audio} src={src} controls autoPlay={autoPlay} preload="metadata" onEnded={onEnded} onError={onError} onPlaying={() => setBlocked(false)} aria-label={`播放${media.title}`} />
      {blocked && <button className="text-link" onClick={() => { void audio.current?.play().catch(() => setBlocked(true)); }}><Play size={14} />点击继续播放</button>}
    </div>
  </div>;
}

type PlaybackPlan = { url: string; quality: string; expiresAt: number; duration: number; page: number };
function BilibiliPlayer({ media, target, autoPlay, onEnded }: { media: Media; target: NonNullable<ReturnType<typeof bilibiliPlaybackTarget>>; autoPlay: boolean; onEnded?: () => void }) {
  const [mode, setMode] = useState<'direct' | 'official'>('direct');
  const [attempt, setAttempt] = useState(0);
  const [plan, setPlan] = useState<PlaybackPlan | null>(null);
  const [busy, setBusy] = useState(!!target.bvid);
  const [waiting, setWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(target.bvid ? '' : '番剧需通过 B 站确认播放权限，可选择官方播放器或在 B 站打开。');
  const video = useRef<HTMLVideoElement>(null);
  const resumeTime = useRef(0);
  useEffect(() => {
    if (mode !== 'direct' || !target.bvid) return;
    const abort = new AbortController();
    setBusy(true); setPlan(null); setError(''); setWaiting(false);
    void api<PlaybackPlan>('/api/playback/bilibili', { method: 'POST', signal: abort.signal, body: JSON.stringify({ bvid: target.bvid, page: target.page }) })
      .then(result => {
        if (abort.signal.aborted) return;
        if (!/^\/api\/playback\/[a-f0-9]{48}\/video$/.test(result?.url || '') || !Number.isFinite(result.duration) || result.duration <= 0) throw new Error('播放服务未返回有效地址，请刷新页面后重试。');
        setPlan(result); setWaiting(true);
      })
      .catch(e => { if (!abort.signal.aborted) { setWaiting(false); setError(e.message || '暂时无法准备视频，请重试。'); } })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [target.bvid, target.page, attempt, mode]);
  useEffect(() => {
    setSlow(false);
    if (!waiting && !busy) return;
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, [waiting, busy]);
  const retry = () => {
    if (video.current) resumeTime.current = video.current.currentTime || 0;
    setError(''); setMode('direct'); setAttempt(n => n + 1);
  };
  const official = () => { if (video.current) resumeTime.current = video.current.currentTime || 0; setError(''); setBusy(false); setWaiting(false); setMode('official'); };
  return <div className="bili-player">
    <div className="bili-player-stage">
      {mode === 'official' ? <iframe key={attempt} title={media.title} src={bilibiliEmbedUrl(target.official, autoPlay)} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={() => setError('官方播放器未能加载，可点击下方「在 B 站打开」。')} />
        : plan && !error ? <VideoPlayer ref={video} src={plan.url} controls autoPlay={autoPlay} playsInline preload="metadata" poster={media.cover} onEnded={onEnded}
          onLoadedMetadata={() => { if (video.current && resumeTime.current > 0) video.current.currentTime = Math.min(resumeTime.current, Math.max(0, video.current.duration - 0.1)); }}
          onCanPlay={() => setWaiting(false)} onPlaying={() => setWaiting(false)} onWaiting={() => setWaiting(true)}
          onError={() => { if (video.current) resumeTime.current = video.current.currentTime || resumeTime.current; setWaiting(false); setError([3, 4].includes(video.current?.error?.code || 0) ? '当前浏览器无法解码此视频，可使用共映桌面版或在 B 站打开。' : '视频读取中断，请重试，或在 B 站打开。'); }} /> : null}
      {mode === 'direct' && (busy || error || waiting) && <div className={`bili-player-status ${plan && !error ? 'buffering' : ''}`} role={error ? 'alert' : 'status'}>{!error && <LoaderCircle size={26} className="spin" />}<p>{error || (busy ? '正在准备 B 站视频…' : '正在缓冲…')}</p>{slow && <small>加载时间较长，可以点击下方重试或切换官方播放器。</small>}</div>}
    </div>
    <div className="bili-player-toolbar"><span>{mode === 'direct' ? target.bvid ? `本机播放${plan ? ` · ${plan.quality}` : ''}` : 'B 站番剧' : 'B 站官方播放器'}</span><div>
      {target.bvid && <button type="button" onClick={retry} aria-label={mode === 'direct' ? '重新加载 B 站视频' : '切换本机播放'}><RefreshCw size={13} />{mode === 'direct' ? '重试' : '本机播放'}</button>}
      <button type="button" onClick={mode === 'direct' ? official : () => { setError(''); setAttempt(n => n + 1); }}>{mode === 'direct' ? '官方播放器 / 弹幕' : '重载官方播放器'}</button>
      <a href={target.source} target="_blank" rel="noreferrer">在 B 站打开<ArrowUpRight size={13} /></a>
    </div></div>
    {mode === 'official' && <p className="bili-player-notice" role="status">{error || '若显示「非常抱歉」或需要登录，请在 B 站打开；普通视频也可切回本机播放。'}</p>}
  </div>;
}

export function AttachDownloadedFile({ media }: { media: Media }) {
  const key = downloadedKey(media), copy = useLocalAsset(key);
  const [error, setError] = useState('');
  return <div className="attach-downloaded-file"><label className="button button-outline file-button"><FolderOpen size={15} />{copy ? '更换关联文件' : '关联已有下载文件'}<input type="file" accept={localAccept} aria-label="关联已有下载文件" onChange={event => { const file = event.target.files?.[0]; if (!file) return; try { attachLocalCopy(key, file); setError(''); } catch (failure) { setError((failure as Error).message); } }} /></label><p>{copy ? `已关联「${copy.file.name}」，当前打开的页面优先使用此文件。` : '旧版本下载的文件可手动关联到此资源；刷新后需重新选择。新下载会自动保留并关联本地副本。'}</p>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
