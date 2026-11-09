// Regenerates src/theme-dark.css from styles.css + expanded.css.
// Run: node scripts/generate-dark-theme.cjs
// Light-mode CSS is untouched; dark mode re-declares only color-bearing
// declarations under :root[data-theme="dark"] with higher specificity.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sources = ['src/styles.css', 'src/expanded.css'];
const out = path.join(root, 'src/theme-dark.css');

// Deliberate dark surfaces / brand art / poster art / new themed components.
const EXCLUDE = new RegExp(
  'hero|\\.cover\\b|cover-fallback|rating|poster-|toast|bili-player|danmaku|' +
  'autoplay-gate|media-error|p2p-video|close-player|button-primary|brand-mark|' +
  'playlist-collage|watch-video|watch-audio|composer-input>button|' +
  'downloaded-player-stage|art-play|chat-sparkle|audio-player|' +
  'room-entry-symbol|note-icon|avatar|detail-player|company-avatars|' +
  'member-avatar|platform-|sun-icon|star-|mini-film|\\.modal-backdrop|' +
  '::selection|theme-card|theme-label|theme-arrow|theme-grid|' +
  'bubble-|theater-|playback-controls|settings-|shortcut-'
);
const HEX = /#([0-9a-fA-F]{3,8})(?![0-9a-fA-F])/g;
const KEYWORD = /(?<![\w-])(white|black)(?![\w-])/g;
const COMMENT = /\/\*[\s\S]*?\*\//g;

function parseHex(value) {
  let v = value;
  if (v.length === 3 || v.length === 4) v = [...v].map(c => c + c).join('');
  if (v.length !== 6 && v.length !== 8) return null;
  const rgb = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
  return { rgb, alpha: v.length === 8 ? v.slice(6) : null };
}
function rgbToHls([r, g, b]) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r / 255: h = ((g - b) / 255 / d) % 6; break;
      case g / 255: h = (b - r) / 255 / d + 2; break;
      default: h = (r - g) / 255 / d + 4;
    }
    h /= 6; if (h < 0) h += 1;
  }
  return { h, l, s };
}
function hlsToRgb(h, l, s) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  const sector = Math.floor(h * 6) % 6;
  const values = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
  return values.map(v => Math.round((v + m) * 255));
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function darkHex(value) {
  const parsed = parseHex(value);
  if (!parsed) return '#' + value;
  const { rgb, alpha } = parsed;
  let { h, l: light, s: sat } = rgbToHls(rgb);
  // HSL saturation explodes for near-white tints (#fcfdfb has sat 0.33), so use
  // absolute chroma to decide whether a color is really neutral.
  const chroma = (Math.max(...rgb) - Math.min(...rgb)) / 255;
  let newLight, newSat;
  if (chroma < 0.14) {
    h = chroma < 0.12 ? 0.58 : h;
    newSat = chroma < 0.10 ? 0.06 : clamp(sat, 0.05, 0.09);
    if (light >= 0.80) newLight = 0.105 + (1 - light) * 0.30;
    else if (light >= 0.58) newLight = 0.20;
    else if (light >= 0.36) newLight = 0.66 + (0.58 - light) * 0.45;
    else newLight = 0.84 + (0.36 - light) * 0.26;
  } else {
    newSat = Math.min(sat, 0.72);
    if (light >= 0.80) { newLight = 0.19; newSat = Math.min(sat * 0.32, 0.22); }
    else if (light >= 0.70) { newLight = 0.24; newSat = Math.min(sat * 0.45, 0.30); }
    else newLight = Math.min(0.78, Math.max(0.58, light + 0.18));
  }
  const result = hlsToRgb(h, clamp(newLight, 0, 1), clamp(newSat, 0, 1));
  return '#' + result.map(v => v.toString(16).padStart(2, '0')).join('') + (alpha || '');
}

function transformValue(value) {
  let changed = false;
  value = value.replace(HEX, (_all, hex) => { changed = true; return darkHex(hex); });
  value = value.replace(KEYWORD, (_all, word) => { changed = true; return darkHex(word === 'white' ? 'ffffff' : '000000'); });
  return { value, changed };
}

function parseBlock(text, media = []) {
  const rules = [];
  let pending = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      const head = pending.replace(COMMENT, '').trim();
      pending = '';
      let j = i + 1, depth = 1;
      while (j < text.length && depth) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(i + 1, j - 1);
      if (/^@(media|supports)/.test(head)) rules.push(...parseBlock(body, [...media, head]));
      else if (!head.startsWith('@')) rules.push({ media, head, body });
      i = j;
    } else if (ch === '}') { pending = ''; i++; }
    else { pending += ch; i++; }
  }
  return rules;
}
function prefixed(selector) {
  return selector.split(',').map(part => part.trim()).filter(Boolean)
    .map(part => part === ':root' || part === 'html' ? ':root[data-theme="dark"]' : ':root[data-theme="dark"] ' + part)
    .join(',\n');
}

const TOKENS = [
  ':root[data-theme="dark"]{',
  'color-scheme:dark;',
  '--surface:#181c20;--surface-2:#1f252b;--surface-3:#293139;',
  '--line:#333c45;--text:#e9edf1;--text-muted:#aab4bc;--text-weak:#8b959e;',
  '--tint:#3a2a24;--tint-strong:#50362c;--shadow:0 18px 48px #0008;',
  '--bubble-bg:#1b2128;--theater-bg:#0d1116;',
  '}',
].join('');
const FINAL = [
  ':root[data-theme="dark"]{',
  '--accent:#e9704f;--accent-dark:#d9603f;--accent-text:#f2916f;',
  '--muted:#aab4bc;--border:#333c45;--green:#7cad97;',
  '}',
].join('');

function main() {
  const chunks = [
    '/* Generated by scripts/generate-dark-theme.cjs — do not edit by hand. */',
    TOKENS,
    ':root[data-theme="dark"] body{background:#12161b;color:#e9edf1}',
    ':root[data-theme="dark"] *{scrollbar-color:#3a444d transparent}',
    ':root[data-theme="dark"] input,:root[data-theme="dark"] textarea,:root[data-theme="dark"] select{color-scheme:dark}',
  ];
  let count = 0;
  for (const file of sources) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const mediaRules = new Map();
    const plain = [];
    for (const { media, head, body } of parseBlock(text)) {
      if (EXCLUDE.test(head)) continue;
      const decls = [];
      for (const decl of body.split(';')) {
        if (!decl.includes(':')) continue;
        const at = decl.indexOf(':');
        const prop = decl.slice(0, at);
        const result = transformValue(decl.slice(at + 1));
        if (result.changed) decls.push(`${prop.trim()}:${result.value.trim()}`);
      }
      if (!decls.length) continue;
      const rule = `${prefixed(head)}{${decls.join(';')}}`;
      if (media.length) {
        const key = media.join('\n');
        if (!mediaRules.has(key)) mediaRules.set(key, []);
        mediaRules.get(key).push(rule);
      } else plain.push(rule);
      count++;
    }
    chunks.push(`/* ${file} */`, ...plain);
    for (const [key, rules] of mediaRules) chunks.push(`${key}{`, ...rules, '}');
  }
  chunks.push('/* Final variable overrides */', FINAL);
  fs.writeFileSync(out, chunks.join('\n') + '\n', 'utf8');
  console.log(`theme-dark.css: ${count} dark rules, ${fs.statSync(out).size} bytes`);
}
main();
