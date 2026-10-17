import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';
import { pollDueChecks } from '../../src/services/poller.js';
import { startMockEndpoint } from '../helpers/mock-endpoint.js';

test('end-to-end: register, add a check, poll it, see it on the dashboard', async (t) => {
  const { baseUrl, db, close } = await startTestServer();
  const endpoint = await startMockEndpoint((req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  t.after(async () => {
    await endpoint.close();
    await close();
  });

  // The mock endpoint necessarily listens on 127.0.0.1, which FR-019's
  // url-safety check correctly blocks for real checks. Stub the DNS lookup
  // *our* safety check uses so this test can exercise a real HTTP round trip
  // against the local mock server without weakening that production check —
  // the actual fetch() still connects to the real local address itself.
  t.mock.method(dns.promises, 'lookup', async () => ({ address: '203.0.113.1', family: 4 }));

  const cookie = await registerAndLogin(baseUrl, 'flow@example.com', 'password123');

  const createRes = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      url: endpoint.url,
      displayName: 'Mock endpoint',
      intervalSeconds: 60,
    }),
  });
  assert.equal(createRes.status, 201);

  // Drive the poller directly (rather than waiting on the real interval timer)
  // against the same database the live server is using.
  await pollDueChecks(db);

  const listRes = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: cookie } });
  const [check] = await listRes.json();

  assert.equal(check.status, 'up');
  assert.equal(check.uptimePercent24h, 100);
  assert.equal(check.recentResponseTimesMs.length, 1);
});

test('a connection failure is recorded and reflected as "down"', async (t) => {
  const { baseUrl, db, close } = await startTestServer();
  t.after(close);

  const cookie = await registerAndLogin(baseUrl, 'flow-down@example.com', 'password123');

  const createRes = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      url: 'http://does-not-exist.invalid/',
      displayName: 'Unreachable',
      intervalSeconds: 60,
    }),
  });
  assert.equal(createRes.status, 201);

  await pollDueChecks(db);

  const listRes = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: cookie } });
  const [check] = await listRes.json();

  assert.equal(check.status, 'down');
  assert.equal(check.uptimePercent24h, 0);
});
