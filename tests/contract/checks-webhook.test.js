import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';

async function addCheck(baseUrl, cookie, displayName = 'Webhook target') {
  const res = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      url: 'https://example.com/health',
      displayName,
      intervalSeconds: 300,
    }),
  });
  return res.json();
}

test('PATCH /api/checks/:id (webhook URL)', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const ownerCookie = await registerAndLogin(baseUrl, 'webhook-owner@example.com', 'password123');
  const otherCookie = await registerAndLogin(baseUrl, 'webhook-bystander@example.com', 'password123');

  await t.test('setting a valid webhook URL is reflected in the response', async () => {
    const check = await addCheck(baseUrl, ownerCookie);
    const res = await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com/alert' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.webhookUrl, 'https://hooks.example.com/alert');
  });

  await t.test('clearing a webhook URL with null returns webhookUrl: null', async () => {
    const check = await addCheck(baseUrl, ownerCookie);
    await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com/alert' }),
    });

    const res = await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ webhookUrl: null }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.webhookUrl, null);
  });

  await t.test('a non-http(s) webhook URL is rejected with 400', async () => {
    const check = await addCheck(baseUrl, ownerCookie);
    const res = await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ webhookUrl: 'not-a-valid-url' }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('a webhook URL over 2048 characters is rejected with 400', async () => {
    const check = await addCheck(baseUrl, ownerCookie);
    const tooLong = `https://example.com/${'a'.repeat(2048)}`;
    const res = await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ webhookUrl: tooLong }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('a webhook URL resolving to a private/loopback address is rejected with 400', async () => {
    const check = await addCheck(baseUrl, ownerCookie);
    const res = await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ webhookUrl: 'http://127.0.0.1:9999/' }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('a nonexistent check id returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/checks/999999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com/alert' }),
    });
    assert.equal(res.status, 404);
  });

  await t.test("another user's check returns the same 404, and is left unaffected", async () => {
    const check = await addCheck(baseUrl, ownerCookie, 'Owner-only check');
    const res = await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: otherCookie },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com/alert' }),
    });
    assert.equal(res.status, 404);

    const listRes = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: ownerCookie } });
    const allChecks = await listRes.json();
    const stillOwned = allChecks.find((c) => c.id === check.id);
    assert.equal(stillOwned.webhookUrl, null);
  });
});

test('POST /api/checks (webhookUrl at creation, FR-001 / US1 AC5)', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  const cookie = await registerAndLogin(baseUrl, 'webhook-at-creation@example.com', 'password123');

  await t.test('a check can be created with its webhook URL set in the same call', async () => {
    const res = await fetch(`${baseUrl}/api/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'https://example.com/health',
        displayName: 'Created with webhook',
        intervalSeconds: 300,
        webhookUrl: 'https://hooks.example.com/created',
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.webhookUrl, 'https://hooks.example.com/created');
  });

  await t.test('an invalid webhookUrl at creation is rejected with 400, and no check is created', async () => {
    const beforeRes = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: cookie } });
    const beforeCount = (await beforeRes.json()).length;

    const res = await fetch(`${baseUrl}/api/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'https://example.com/health',
        displayName: 'Should not be created',
        intervalSeconds: 300,
        webhookUrl: 'http://127.0.0.1:9999/',
      }),
    });
    assert.equal(res.status, 400);

    const afterRes = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: cookie } });
    const afterCount = (await afterRes.json()).length;
    assert.equal(afterCount, beforeCount, 'no check should be created when webhookUrl validation fails');
  });

  await t.test('omitting webhookUrl at creation still works and defaults to null', async () => {
    const res = await fetch(`${baseUrl}/api/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'https://example.com/health',
        displayName: 'No webhook',
        intervalSeconds: 300,
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.webhookUrl, null);
  });
});
