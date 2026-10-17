import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';

async function addCheck(baseUrl, cookie) {
  const res = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      url: 'https://example.com/health',
      displayName: 'To delete',
      intervalSeconds: 60,
    }),
  });
  return res.json();
}

test('DELETE /api/checks/:id', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const ownerCookie = await registerAndLogin(baseUrl, 'deleter@example.com', 'password123');
  const otherCookie = await registerAndLogin(baseUrl, 'bystander@example.com', 'password123');

  await t.test('owner can delete their own check', async () => {
    const check = await addCheck(baseUrl, ownerCookie);

    const deleteRes = await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    assert.equal(deleteRes.status, 204);

    const listRes = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: ownerCookie } });
    const remaining = await listRes.json();
    assert.ok(!remaining.some((c) => c.id === check.id));
  });

  await t.test('deleting a nonexistent id returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/checks/999999`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    assert.equal(res.status, 404);
  });

  await t.test("deleting another user's check returns the same 404, and leaves it intact", async () => {
    const check = await addCheck(baseUrl, ownerCookie);

    const res = await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'DELETE',
      headers: { Cookie: otherCookie },
    });
    assert.equal(res.status, 404);

    const listRes = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: ownerCookie } });
    const remaining = await listRes.json();
    assert.ok(remaining.some((c) => c.id === check.id));
  });
});
