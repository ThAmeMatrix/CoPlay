import { Film, Link, ListPlus } from 'lucide-react';

export type ImportMode = 'link' | 'local' | 'collection';
export default function ImportModeTabs({ value, onChange }: { value: ImportMode; onChange: (value: ImportMode) => void }) {
  return <div className="import-mode-tabs" role="group" aria-label="导入方式">
    <button type="button" className={value === 'link' ? 'active' : ''} aria-pressed={value === 'link'} onClick={() => onChange('link')}><Link size={16} />网站链接</button>
    <button type="button" className={value === 'local' ? 'active' : ''} aria-pressed={value === 'local'} onClick={() => onChange('local')}><Film size={16} />本地影片 / 音乐</button>
    <button type="button" className={value === 'collection' ? 'active' : ''} aria-pressed={value === 'collection'} onClick={() => onChange('collection')}><ListPlus size={16} />合集 / 歌单</button>
  </div>;
}
