import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/server-harness.js';

test('POST /api/register', async (t) => {
  const { baseUrl, close } = await startTestServer();
  t.after(close);

  await t.test('first account becomes admin', async () => {
    const res = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'owner@example.com', password: 'correct-horse' }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.role, 'admin');
    assert.equal(body.login, 'owner@example.com');
  });

  await t.test('second account is a regular user', async () => {
    const res = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'second@example.com', password: 'correct-horse' }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.role, 'user');
  });

  await t.test('duplicate login is rejected with 409', async () => {
    const res = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'second@example.com', password: 'another-pass' }),
    });
    assert.equal(res.status, 409);
  });

  await t.test('missing login or password is rejected with 400', async () => {
    const res1 = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-horse' }),
    });
    assert.equal(res1.status, 400);

    const res2 = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'nouser@example.com', password: '' }),
    });
    assert.equal(res2.status, 400);
  });

  await t.test('login/password length boundaries (254/1024 inclusive)', async () => {
    const okLogin = 'a'.repeat(254);
    const okPassword = 'b'.repeat(1024);
    const resOk = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: okLogin, password: okPassword }),
    });
    assert.equal(resOk.status, 201);

    const tooLongLogin = 'a'.repeat(255);
    const resLoginTooLong = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: tooLongLogin, password: 'short-pass' }),
    });
    assert.equal(resLoginTooLong.status, 400);

    const tooLongPassword = 'b'.repeat(1025);
    const resPasswordTooLong = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'another-login@example.com', password: tooLongPassword }),
    });
    assert.equal(resPasswordTooLong.status, 400);
  });
});
