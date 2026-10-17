import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/server-harness.js';

// quickstart.md Scenario 7: session cookie attributes against the live server.
test('register + login against the live server yields an HttpOnly, SameSite=Strict cookie', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'scenario7@example.com', password: 'super-secret' }),
  });

  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'scenario7@example.com', password: 'super-secret' }),
  });

  const setCookie = loginRes.headers.get('set-cookie');
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
});
