import test from 'node:test';
import assert from 'node:assert/strict';
import security from '../desktop/security.cjs';
test('desktop privileges stay on the stable loopback origin and bounded download routes', () => {
  const { appUrl, externalUrl, downloadUrl, LOOPBACK_ORIGIN } = security;
  assert.equal(appUrl(LOOPBACK_ORIGIN + '/'), true);
  for (const url of ['https://127.0.0.1:36743/', 'http://127.0.0.1:36744/', 'http://127.0.0.1.evil.example:36743/', 'file:///a']) assert.equal(appUrl(url), false);
  assert.ok(externalUrl('https://www.bilibili.com/video/BV1B7411m7LV'));
  for (const url of ['file:///a', 'javascript:alert(1)', 'ms-settings:privacy', 'https://user:password@example.com/', 'http://localhost/']) assert.equal(externalUrl(url), '');
  assert.equal(downloadUrl(`${LOOPBACK_ORIGIN}/api/downloads/${'f'.repeat(48)}/file`), true);
  assert.equal(downloadUrl('https://evil.example/api/downloads/' + 'f'.repeat(48) + '/file'), false);
  assert.equal(downloadUrl(LOOPBACK_ORIGIN + '/api/downloads/../file'), false);
});
