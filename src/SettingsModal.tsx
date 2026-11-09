import { useEffect, useRef, useState } from 'react';
import { Captions, FolderOpen, HardDriveDownload, Keyboard, Monitor, Moon, RotateCcw, Sun, X } from 'lucide-react';
import { Modal } from './components';
import { acceleratorFromEvent, displayAccelerator, shortcutActions, type ShortcutAction, type ShortcutMap } from './shortcuts';
import type { Settings, ThemeMode } from './settings';
import { defaultSettings } from './settings';

const themes: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '日间', icon: Sun },
  { value: 'dark', label: '夜间', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

export default function SettingsModal({ nickname, onSave, onClose, settings, patch, desktop, conflicts }: {
  nickname: string; onSave: (name: string) => void; onClose: () => void;
  settings: Settings; patch: (change: Partial<Settings>) => void; desktop: boolean; conflicts: string[];
}) {
  const [name, setName] = useState(nickname);
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const captureRef = useRef<ShortcutAction | null>(null);
  captureRef.current = capturing;

  useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const action = captureRef.current;
      if (!action) return;
      if (event.key === 'Escape') { setCapturing(null); return; }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        patch({ shortcuts: { ...settings.shortcuts, [action]: '' } });
        setCapturing(null);
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) return;
      patch({ shortcuts: { ...settings.shortcuts, [action]: accelerator } });
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, settings.shortcuts, patch]);

  return <Modal title="偏好设置" subtitle="外观、播放快捷键与桌面行为，都在这里调整。" onClose={onClose} wide>
    <section className="settings-section">
      <h3><Sun size={16} />外观</h3>
      <p>切换日间 / 夜间配色，或让共映跟随系统设置。</p>
      <div className="segmented" role="group" aria-label="主题模式">
        {themes.map(theme => <button key={theme.value} className={settings.theme === theme.value ? 'active' : ''} aria-pressed={settings.theme === theme.value}
          onClick={() => patch({ theme: theme.value })}><theme.icon size={15} />{theme.label}</button>)}
      </div>
    </section>

    <section className="settings-section">
      <h3><Captions size={16} />桌面歌词</h3>
      <p>播放带歌词的音乐时，可在桌面显示独立的置顶歌词窗口；没有歌词的作品不会弹出。网页版会在应用内显示歌词浮层。</p>
      <label className="settings-toggle"><input type="checkbox" checked={settings.showLyrics} onChange={event => patch({ showLyrics: event.target.checked })} />
        <span><strong>播放时显示歌词{desktop ? '（桌面置顶窗口）' : '（应用内浮层）'}</strong><small>歌词跟随播放进度高亮；关闭歌词窗口也会同时关闭这个选项。</small></span></label>
    </section>

    <section className="settings-section">
      <h3><Keyboard size={16} />播放快捷键</h3>
      <p>点击按键框后直接按下组合键即可录制；需要至少一个 Ctrl / Alt / Win 修饰键。按 Esc 取消，按 Delete 清空。桌面版快捷键在系统范围内生效。</p>
      <div className="shortcut-table">{shortcutActions.map(action => {
        const value = settings.shortcuts[action.id] || '';
        const isCapturing = capturing === action.id;
        return <div className="shortcut-row" key={action.id}>
          <span>{action.label}</span>
          <button className={`shortcut-key ${isCapturing ? 'capturing' : ''}`} data-capturing-shortcut={isCapturing ? '' : undefined}
            aria-label={`录制${action.label}快捷键`} onClick={() => setCapturing(isCapturing ? null : action.id)}>
            {isCapturing ? '请按下组合键…' : displayAccelerator(value)}
          </button>
          {value && <button className="plain-icon" aria-label={`清空${action.label}快捷键`} title="清空" onClick={() => patch({ shortcuts: { ...settings.shortcuts, [action.id]: '' } })}><X size={14} /></button>}
        </div>;
      })}</div>
      <div className="settings-actions">
        <button className="text-link" onClick={() => patch({ shortcuts: { ...defaultSettings.shortcuts } })}><RotateCcw size={14} />恢复默认快捷键</button>
      </div>
      {!!conflicts.length && <p className="shortcut-conflicts" role="alert">以下组合键已被系统或其他程序占用：{conflicts.join('、')}。请改成其他组合键。</p>}
    </section>

    {desktop && <section className="settings-section">
      <h3><HardDriveDownload size={16} />下载位置</h3>
      <p>所有单个与批量下载会直接保存到下面的文件夹，不会每次弹窗询问。已有本地副本的内容会自动跳过，不会重复下载。</p>
      <div className="download-dir-row">
        <code title={settings.downloadDir || '系统默认下载文件夹'}>{settings.downloadDir || '系统默认下载文件夹'}</code>
        <button className="button button-outline" disabled={pickingFolder} onClick={async () => {
          if (!window.coplayDesktop?.chooseDownloadFolder) return;
          setPickingFolder(true);
          try {
            const folder = await window.coplayDesktop.chooseDownloadFolder();
            if (folder) patch({ downloadDir: folder });
          } finally { setPickingFolder(false); }
        }}><FolderOpen size={15} />{pickingFolder ? '选择中…' : '更改文件夹'}</button>
        {settings.downloadDir && <button className="text-link" onClick={() => patch({ downloadDir: '' })}>恢复默认</button>}
      </div>
    </section>}

    {desktop && <section className="settings-section">
      <h3><Monitor size={16} />桌面行为</h3>
      <label className="settings-toggle"><input type="checkbox" checked={settings.minimizeToTray} onChange={event => patch({ minimizeToTray: event.target.checked })} />
        <span><strong>播放中关闭窗口时缩到任务栏</strong><small>不退出应用，图标留在右下角通知区域；从托盘菜单可彻底退出。</small></span></label>
      <label className="settings-toggle"><input type="checkbox" checked={settings.showBubble} onChange={event => patch({ showBubble: event.target.checked })} />
        <span><strong>显示悬浮气泡</strong><small>窗口隐藏到托盘后，显示带封面、名称、进度和播放控制的迷你播放器。</small></span></label>
      <label className="settings-toggle"><input type="checkbox" checked={settings.globalShortcuts} onChange={event => patch({ globalShortcuts: event.target.checked })} />
        <span><strong>启用全局快捷键</strong><small>即使共映不在前台，快捷键也能控制播放；关闭后仅在窗口内生效。</small></span></label>
    </section>}
    {!desktop && <section className="settings-section"><h3><Monitor size={16} />桌面行为</h3>
      <p className="settings-desktop-note">缩到任务栏与悬浮气泡是桌面版能力，请通过共映桌面版使用。当前网页版的快捷键在本页面内生效。</p></section>}

    <section className="settings-section">
      <h3>我的昵称</h3>
      <form onSubmit={event => { event.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <input className="text-input" id="nickname" maxLength={24} required value={name} onChange={event => setName(event.target.value)} aria-label="我的昵称" />
        <div className="settings-actions"><button className="button button-primary" disabled={!name.trim()}>保存昵称</button></div>
      </form>
    </section>
  </Modal>;
}
