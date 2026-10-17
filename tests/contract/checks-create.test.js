import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';

test('POST /api/checks', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);
  const cookie = await registerAndLogin(baseUrl, 'checks-create@example.com', 'password123');

  await t.test('a valid check is created as pending', async () => {
    const res = await fetch(`${baseUrl}/api/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'https://example.com/health',
        displayName: 'Example health',
        intervalSeconds: 300,
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.status, 'pending');
    assert.deepEqual(body.recentResponseTimesMs, []);
  });

  await t.test('a non-http(s) URL is rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'not-a-valid-url',
        displayName: 'Bad URL',
        intervalSeconds: 300,
      }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('interval boundaries: 60 and 86400 inclusive, 59 and 86401 rejected', async () => {
    const makeReq = (intervalSeconds) =>
      fetch(`${baseUrl}/api/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          url: 'https://example.com/health',
          displayName: 'Interval test',
          intervalSeconds,
        }),
      });

    assert.equal((await makeReq(59)).status, 400);
    assert.equal((await makeReq(86401)).status, 400);
    assert.equal((await makeReq(60)).status, 201);
    assert.equal((await makeReq(86400)).status, 201);
  });

  await t.test('a private-network URL is rejected with 400 (FR-019)', async () => {
    const res = await fetch(`${baseUrl}/api/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'http://127.0.0.1:9999/',
        displayName: 'Loopback',
        intervalSeconds: 300,
      }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('url/displayName length boundaries (2048/100 inclusive)', async () => {
    const longPath = 'a'.repeat(2048 - 'https://example.com/'.length);
    const okUrl = `https://example.com/${longPath}`;
    const okDisplayName = 'n'.repeat(100);

    const resOk = await fetch(`${baseUrl}/api/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ url: okUrl, displayName: okDisplayName, intervalSeconds: 300 }),
    });
    assert.equal(resOk.status, 201);

    const resUrlTooLong = await fetch(`${baseUrl}/api/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: `${okUrl}x`,
        displayName: 'short',
        intervalSeconds: 300,
      }),
    });
    assert.equal(resUrlTooLong.status, 400);

    const resNameTooLong = await fetch(`${baseUrl}/api/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        url: 'https://example.com/health',
        displayName: 'n'.repeat(101),
        intervalSeconds: 300,
      }),
    });
    assert.equal(resNameTooLong.status, 400);
  });
});
