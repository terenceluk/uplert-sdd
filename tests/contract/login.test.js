import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/server-harness.js';

async function register(baseUrl, login, password) {
  await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
}

test('POST /api/login and POST /api/logout', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);
  await register(baseUrl, 'user@example.com', 'correct-password');

  await t.test('successful login sets an HttpOnly, SameSite=Strict cookie', async () => {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'user@example.com', password: 'correct-password' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.login, 'user@example.com');

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'expected a Set-Cookie header');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
  });

  await t.test('unknown login and wrong password return identical 401 responses', async () => {
    const resUnknown = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'nobody@example.com', password: 'whatever' }),
    });
    const resWrongPassword = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'user@example.com', password: 'wrong-password' }),
    });

    assert.equal(resUnknown.status, 401);
    assert.equal(resWrongPassword.status, 401);

    const bodyUnknown = await resUnknown.json();
    const bodyWrongPassword = await resWrongPassword.json();
    assert.deepEqual(bodyUnknown, bodyWrongPassword);
  });

  await t.test('logout clears the session so it no longer authenticates', async () => {
    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'user@example.com', password: 'correct-password' }),
    });
    const setCookie = loginRes.headers.get('set-cookie');
    const cookie = setCookie.match(/session=([^;]*)/)[0];

    const logoutRes = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(logoutRes.status, 204);

    const afterLogout = await fetch(`${baseUrl}/api/checks`, {
      headers: { Cookie: cookie },
    });
    assert.equal(afterLogout.status, 401);
  });
});
