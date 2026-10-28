import { ListMusic, Repeat, Repeat1, Shuffle } from 'lucide-react';
import { playbackModes, type PlaybackMode } from './playback-queue';

export default function PlaybackModeSelect({ value, onChange, label = '播放规则' }: { value: PlaybackMode; onChange: (value: PlaybackMode) => void; label?: string }) {
  const Icon = { list: ListMusic, shuffle: Shuffle, loop: Repeat, single: Repeat1 }[value];
  return <label className="playback-mode-select" title={playbackModes.find(mode => mode.value === value)?.description}>
    <Icon size={16} />
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value as PlaybackMode)}>
      {playbackModes.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
    </select>
  </label>;
}
