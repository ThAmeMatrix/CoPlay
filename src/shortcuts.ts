// Pure shortcut helpers shared by the renderer. Keep this file free of imports so
// both Vite and the Node test runner can load it directly.
export const ACCELERATOR_PATTERN = '^(?:(?:Ctrl|Alt|Shift|Super)\\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Left|Right|Up|Down|Space|Enter|Escape|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Plus|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backslash)$';
const acceleratorRe = new RegExp(ACCELERATOR_PATTERN);

export type ShortcutAction = 'playPause' | 'seekBack' | 'seekForward' | 'previous' | 'next' | 'mute' | 'volumeUp' | 'volumeDown';
export type ShortcutMap = Partial<Record<ShortcutAction, string>>;
export const shortcutActions: { id: ShortcutAction; label: string }[] = [
  { id: 'playPause', label: '播放 / 暂停' },
  { id: 'seekBack', label: '后退 10 秒' },
  { id: 'seekForward', label: '快进 10 秒' },
  { id: 'previous', label: '上一项' },
  { id: 'next', label: '下一项' },
  { id: 'mute', label: '静音 / 取消静音' },
  { id: 'volumeUp', label: '调大音量' },
  { id: 'volumeDown', label: '调小音量' },
];
export const defaultShortcuts: Record<ShortcutAction, string> = {
  playPause: 'Ctrl+Alt+P', seekBack: 'Ctrl+Alt+Left', seekForward: 'Ctrl+Alt+Right',
  previous: 'Ctrl+Alt+PageUp', next: 'Ctrl+Alt+PageDown', mute: 'Ctrl+Alt+M',
  volumeUp: 'Ctrl+Alt+Up', volumeDown: 'Ctrl+Alt+Down',
};

const modifierKeys = ['Control', 'Alt', 'Shift', 'Meta'];
const codeMap: Record<string, string> = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', Minus: 'Minus', Equal: 'Plus',
  BracketLeft: 'BracketLeft', BracketRight: 'BracketRight', Semicolon: 'Semicolon',
  Quote: 'Quote', Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backslash: 'Backslash',
};

export function isValidAccelerator(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && acceleratorRe.test(value);
}

/** Normalize a persisted shortcut map, dropping unknown/invalid entries. */
export function normalizeShortcuts(value: unknown): Record<ShortcutAction, string> {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const result = { ...defaultShortcuts };
  for (const action of shortcutActions) {
    const candidate = source[action.id];
    if (candidate === null || candidate === '') result[action.id] = '';
    else if (isValidAccelerator(candidate)) result[action.id] = candidate;
  }
  return result;
}

function eventKey(event: KeyboardEvent): string {
  if (event.key === ' ') return 'Space';
  if (codeMap[event.code]) return codeMap[event.code];
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(event.code)) return event.code;
  if (/^[a-z]$/.test(event.key)) return event.key.toUpperCase();
  return '';
}

/** Build an Electron accelerator from a keyboard event, or null if it is not usable as a shortcut. */
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (modifierKeys.includes(event.key)) return null;
  const key = eventKey(event);
  if (!key) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  if (!parts.length) return null;
  const candidate = [...parts, key].join('+');
  return isValidAccelerator(candidate) ? candidate : null;
}

export function acceleratorMatches(event: KeyboardEvent, accelerator: string): boolean {
  if (!isValidAccelerator(accelerator)) return false;
  const parts = accelerator.split('+');
  const key = parts.pop()!;
  const want = {
    Ctrl: parts.includes('Ctrl'), Alt: parts.includes('Alt'),
    Shift: parts.includes('Shift'), Super: parts.includes('Super'),
  };
  if (event.ctrlKey !== want.Ctrl || event.altKey !== want.Alt || event.shiftKey !== want.Shift || event.metaKey !== want.Super) return false;
  const actual = eventKey(event);
  if (actual === key) return true;
  // Equal/Plus and Minus are written differently by browsers vs Electron.
  if (key === 'Plus' && (actual === 'Equal' || event.key === '+')) return true;
  if (key === 'Equal' && actual === 'Plus') return true;
  return false;
}

export function displayAccelerator(accelerator: string): string {
  if (!accelerator) return '未设置';
  return accelerator.replace(/\bCtrl\b/g, 'Ctrl').replace(/\bSuper\b/g, 'Win').replace(/\+/g, ' + ');
}
