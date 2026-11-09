import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCELERATOR_PATTERN, defaultShortcuts, shortcutActions, normalizeShortcuts,
  isValidAccelerator, acceleratorFromEvent, acceleratorMatches, displayAccelerator,
} from '../src/shortcuts.ts';
import spec from '../shared/shortcuts.json' with { type: 'json' };

const keyEvent = (init) => ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init });

test('shared shortcut spec and renderer defaults stay in sync', () => {
  assert.equal(ACCELERATOR_PATTERN, spec.accelerator);
  assert.deepEqual(shortcutActions.map(a => a.id), spec.actions.map(a => a.id));
  for (const action of spec.actions) assert.equal(defaultShortcuts[action.id], action.default);
});

test('accelerator validation rejects bare keys, unknown keys and oversized values', () => {
  for (const value of ['Ctrl+Alt+P', 'Ctrl+Alt+Left', 'Ctrl+Alt+PageUp', 'Super+M', 'Ctrl+Shift+F5', 'Ctrl+Alt+Space'])
    assert.equal(isValidAccelerator(value), true, value);
  for (const value of ['', 'p', 'P', 'Ctrl+', 'Ctrl+Nope', 'AltGr+P', 'Ctrl+Alt+', 'javascript:alert(1)', 'x'.repeat(80)])
    assert.equal(isValidAccelerator(value), false, value);
});

test('normalizeShortcuts fills defaults, accepts clearing and drops hostile values', () => {
  assert.deepEqual(normalizeShortcuts(null), defaultShortcuts);
  assert.deepEqual(normalizeShortcuts({ playPause: '' }), { ...defaultShortcuts, playPause: '' });
  const result = normalizeShortcuts({ next: 'Ctrl+Alt+N', unknownAction: 'Ctrl+Alt+Q', playPause: 'javascript:alert(1)' });
  assert.equal(result.next, 'Ctrl+Alt+N');
  assert.equal(result.playPause, defaultShortcuts.playPause);
  assert.equal('unknownAction' in result, false);
});

test('recording a keyboard event produces a valid accelerator and ignores modifier-only presses', () => {
  assert.equal(acceleratorFromEvent(keyEvent({ key: 'p', code: 'KeyP', ctrlKey: true, altKey: true })), 'Ctrl+Alt+P');
  assert.equal(acceleratorFromEvent(keyEvent({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true })), 'Ctrl+Alt+Left');
  assert.equal(acceleratorFromEvent(keyEvent({ key: 'PageDown', code: 'PageDown', ctrlKey: true, altKey: true })), 'Ctrl+Alt+PageDown');
  assert.equal(acceleratorFromEvent(keyEvent({ key: ' ', code: 'Space', ctrlKey: true, altKey: true })), 'Ctrl+Alt+Space');
  assert.equal(acceleratorFromEvent(keyEvent({ key: 'p', code: 'KeyP' })), null, 'bare keys must not hijack typing');
  assert.equal(acceleratorFromEvent(keyEvent({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), null);
});

test('acceleratorMatches requires exact modifiers and maps browser key codes', () => {
  const press = keyEvent({ key: 'p', code: 'KeyP', ctrlKey: true, altKey: true });
  assert.equal(acceleratorMatches(press, 'Ctrl+Alt+P'), true);
  assert.equal(acceleratorMatches({ ...press, shiftKey: true }, 'Ctrl+Alt+P'), false);
  assert.equal(acceleratorMatches(keyEvent({ key: 'p', code: 'KeyP', altKey: true }), 'Ctrl+Alt+P'), false);
  assert.equal(acceleratorMatches(keyEvent({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, altKey: true }), 'Ctrl+Alt+Up'), true);
  assert.equal(acceleratorMatches(press, 'Ctrl+Nope'), false);
});

test('displayAccelerator formats readable labels', () => {
  assert.equal(displayAccelerator('Ctrl+Alt+P'), 'Ctrl + Alt + P');
  assert.equal(displayAccelerator(''), '未设置');
});
