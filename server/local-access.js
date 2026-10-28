// Both the TCP listener and request host are limited to this computer.
export function localAdmin(req) {
  const local = ['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  let hostname = '';
  try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch { return false; }
  return local && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    && !['cf-connecting-ip', 'x-forwarded-host', 'x-forwarded-for', 'forwarded', 'x-real-ip'].some(h => req.headers[h]);
}
