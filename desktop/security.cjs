const LOOPBACK_ORIGIN = 'http://127.0.0.1:36743';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: http:; media-src 'self' blob: https: http:; connect-src 'self' https: http:; frame-src https://player.bilibili.com https://music.163.com https://i.y.qq.com https://www.youtube.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function externalUrl(value) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && !u.port && !/^(localhost|127\.|0\.|\[|10\.|192\.168\.|169\.254\.)/i.test(u.hostname) && !/\.(local|internal|localhost)$/i.test(u.hostname) ? u.href : '';
  } catch { return ''; }
}
function appUrl(value) { try { return new URL(value).origin === LOOPBACK_ORIGIN; } catch { return false; } }
function downloadUrl(value) { try { const u = new URL(value); return appUrl(value) && /^\/api\/downloads\/[a-f0-9]{48}\/file$/.test(u.pathname); } catch { return false; } }
module.exports = { LOOPBACK_ORIGIN, CSP, externalUrl, appUrl, downloadUrl };
