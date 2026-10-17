import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';

async function addCheck(baseUrl, cookie, overrides = {}) {
  const res = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      url: 'https://example.com/health',
      displayName: 'Example',
      intervalSeconds: 300,
      ...overrides,
    }),
  });
  return res.json();
}

test('GET /api/checks', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const ownerCookie = await registerAndLogin(baseUrl, 'owner@example.com', 'password123');
  const otherCookie = await registerAndLogin(baseUrl, 'other@example.com', 'password123');

  await addCheck(baseUrl, ownerCookie, { displayName: 'Owner check' });
  await addCheck(baseUrl, otherCookie, { displayName: 'Other check' });

  await t.test('response items include the documented shape', async () => {
    const res = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: ownerCookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.length, 1);
    const [check] = body;
    for (const key of [
      'id',
      'url',
      'displayName',
      'intervalSeconds',
      'status',
      'uptimePercent24h',
      'recentResponseTimesMs',
    ]) {
      assert.ok(key in check, `expected key "${key}" in check response`);
    }
  });

  await t.test('only the caller\'s own checks are returned (FR-014)', async () => {
    const res = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: ownerCookie } });
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].displayName, 'Owner check');
  });
});
