import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';
import { startMockEndpoint } from '../helpers/mock-endpoint.js';
import { pollDueChecks } from '../../src/services/poller.js';

function markDueNow(db, checkId) {
  db.prepare('UPDATE checks SET last_polled_at = NULL WHERE id = ?').run(checkId);
}

test('a webhook URL that becomes unsafe is blocked at delivery time, not just at set time', async (t) => {
  const { baseUrl, db, close } = await startTestServer();

  // The lookup is "safe" while this flag is true, "private" (blocked) once false —
  // simulating a webhook destination whose resolution changes after it was set,
  // since a real DNS-rebinding attack can't be staged in a test environment (same
  // technique feature 001 used for its own url-safety re-check test).
  const dnsState = { safe: true };
  t.mock.method(dns.promises, 'lookup', async () => {
    return dnsState.safe
      ? { address: '203.0.113.1', family: 4 }
      : { address: '10.0.0.5', family: 4 };
  });

  let monitoredStatus = 200;
  const monitored = await startMockEndpoint((req, res) => {
    res.writeHead(monitoredStatus);
    res.end('body');
  });

  let webhookRequestCount = 0;
  const webhook = await startMockEndpoint((req, res) => {
    webhookRequestCount += 1;
    res.writeHead(200);
    res.end('ok');
  });

  t.after(async () => {
    await monitored.close();
    await webhook.close();
    await close();
  });

  const cookie = await registerAndLogin(baseUrl, 'webhook-safety@example.com', 'password123');

  const createRes = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ url: monitored.url, displayName: 'Safety target', intervalSeconds: 60 }),
  });
  const check = await createRes.json();

  const patchRes = await fetch(`${baseUrl}/api/checks/${check.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ webhookUrl: webhook.url }),
  });
  assert.equal(patchRes.status, 200, 'webhook URL is accepted while its destination is safe');

  // First poll: pending -> up. No webhook fires (not a transition).
  await pollDueChecks(db);

  // Now the webhook's resolved destination becomes unsafe, and a real transition occurs.
  dnsState.safe = false;
  monitoredStatus = 500;
  markDueNow(db, check.id);
  await pollDueChecks(db);

  assert.equal(webhookRequestCount, 0, 'the webhook endpoint must never actually receive the request');
  const recorded = db.prepare('SELECT webhook_last_outcome FROM checks WHERE id = ?').get(check.id);
  assert.equal(recorded.webhook_last_outcome, 'failed');
});
