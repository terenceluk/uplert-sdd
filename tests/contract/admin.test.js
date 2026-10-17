import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';

async function addCheck(baseUrl, cookie, displayName) {
  await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      url: 'https://example.com/health',
      displayName,
      intervalSeconds: 60,
    }),
  });
}

test('GET /api/admin/users', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  // First-ever account becomes the administrator (FR-002).
  const adminCookie = await registerAndLogin(baseUrl, 'admin@example.com', 'password123');
  const userCookie = await registerAndLogin(baseUrl, 'regular@example.com', 'password123');

  await addCheck(baseUrl, adminCookie, 'Admin check 1');
  await addCheck(baseUrl, userCookie, 'User check 1');
  await addCheck(baseUrl, userCookie, 'User check 2');

  await t.test('admin sees every user with an accurate check count and no check-level fields', async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.length, 2);

    const admin = body.find((u) => u.login === 'admin@example.com');
    const regular = body.find((u) => u.login === 'regular@example.com');
    assert.equal(admin.role, 'admin');
    assert.equal(admin.checkCount, 1);
    assert.equal(regular.role, 'user');
    assert.equal(regular.checkCount, 2);

    for (const user of body) {
      assert.ok(!('url' in user));
      assert.ok(!('status' in user));
      assert.ok(!('checks' in user));
    }
  });

  await t.test('a non-admin is denied with 403', async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: userCookie } });
    assert.equal(res.status, 403);
  });

  await t.test('an unauthenticated caller is denied with 401', async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`);
    assert.equal(res.status, 401);
  });
});
