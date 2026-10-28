import { useEffect, useState } from 'react';
import { Check, Copy, Globe2, Link, LoaderCircle, Wifi } from 'lucide-react';
import { Modal } from './components';
import type { NetworkInfo } from './types';
import { api } from './hooks';

export function isPublicBrowserOrigin(origin: string) {
  try { const u = new URL(origin); return u.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/.test(u.hostname) && !u.hostname.endsWith('.local'); } catch { return false; }
}
export default function ShareModal({ roomId, onClose, notify }: { roomId?: string; onClose: () => void; notify: (message: string) => void }) {
  const [info, setInfo] = useState<NetworkInfo | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [configured, setConfigured] = useState(''); const [copied, setCopied] = useState(false);
  const publicBase = isPublicBrowserOrigin(location.origin) ? location.origin : info?.publicUrl;
  const invitation = publicBase ? new URL(roomId ? `/?room=${roomId}` : '/', publicBase).href : '';
  const load = async () => { try { setInfo(await api('/api/network')); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); const timer = setInterval(load, 2500); return () => clearInterval(timer); }, []);
  const action = async (route: string, body = {}) => { setBusy(true); setError(''); try { await api(route, { method: 'POST', body: JSON.stringify(body) }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); setCopied(true); notify('邀请链接已复制'); } catch { notify('请选中下方地址手动复制'); } };
  return <Modal title={roomId ? '把这个位置，留给朋友' : '让远方的朋友也能连接'} subtitle="公网朋友需要 HTTPS 地址；同一 Wi-Fi 下可使用局域网地址。" onClose={onClose}>
    <div className={`network-status ${invitation ? 'ready' : ''}`}><Globe2 size={23} /><div><strong>{invitation ? '公网邀请已就绪' : info?.state === 'starting' ? '正在开启公网分享' : '尚未连接公网'}</strong><p>{invitation && info?.temporary ? '临时 HTTPS 链接；关闭隧道或重启服务后会失效。' : info?.message || '正在检查网络…'}</p></div>{info?.state === 'starting' && <LoaderCircle size={19} className="spin" />}</div>
    {invitation ? <><label className="field-label" htmlFor="public-invitation">发送给远端朋友</label><div className="share-copy"><input id="public-invitation" value={invitation} readOnly onFocus={e => e.target.select()} /><button className="button button-primary" onClick={() => copy(invitation)}>{copied ? <Check size={15} /> : <Copy size={15} />}复制</button></div></> : info?.canManage ? <button className="button button-primary full-width" disabled={busy || info.state === 'starting'} onClick={() => action('/api/share/start')}><Globe2 size={16} />{info.state === 'starting' ? '正在建立 HTTPS 连接…' : '开启公网分享'}</button> : <p className="info-box">请让服务提供者在本机 localhost 页面开启公网分享，再发送生成的 HTTPS 邀请地址。</p>}
    {info?.canManage && <details className="network-details"><summary>已有域名或反向代理</summary><p>填写连接到当前共映服务的根地址，验证通过后用于生成邀请。</p><form onSubmit={e => { e.preventDefault(); void action('/api/share/verify', { url: configured }); }}><input aria-label="公网根地址" className="text-input" type="url" placeholder="https://coplay.example.com" value={configured} onChange={e => setConfigured(e.target.value)} required /><button className="button button-outline" disabled={busy}>验证并使用</button></form></details>}
    {!!info?.lanUrls.length && <details className="network-details"><summary><Wifi size={14} />仅限同一局域网</summary><p>这些地址不能用于互联网远端访问。普通 HTTP 下无法使用麦克风和 P2P 边传边播。</p>{info.lanUrls.map(base => { const url = new URL(roomId ? `/?room=${roomId}` : '/', base).href; return <div className="share-copy" key={base}><input aria-label="局域网邀请地址" value={url} readOnly onFocus={e => e.target.select()} /><button className="icon-button" aria-label="复制局域网地址" onClick={() => copy(url)}><Copy size={15} /></button></div>; })}</details>}
    <p className="modal-footnote">{info?.turnConfigured ? '已配置 TURN，P2P 无法直连时可中继。' : '网页公网访问和媒体 P2P 是两条连接。严格 NAT 网络需要部署 TURN 才能中继。'}</p>
    {info?.canManage && info.temporary && info.state === 'ready' && <button className="text-link share-stop" disabled={busy} onClick={() => action('/api/share/stop')}>关闭临时公网分享</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
