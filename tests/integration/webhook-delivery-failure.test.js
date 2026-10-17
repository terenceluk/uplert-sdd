import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';
import { startMockEndpoint } from '../helpers/mock-endpoint.js';
import { pollDueChecks } from '../../src/services/poller.js';

function markDueNow(db, checkId) {
  db.prepare('UPDATE checks SET last_polled_at = NULL WHERE id = ?').run(checkId);
}

test('a failed webhook delivery is recorded but never affects polling or status', async (t) => {
  const { baseUrl, db, close } = await startTestServer();
  t.mock.method(dns.promises, 'lookup', async () => ({ address: '203.0.113.1', family: 4 }));

  let monitoredStatus = 200;
  const monitored = await startMockEndpoint((req, res) => {
    res.writeHead(monitoredStatus);
    res.end('body');
  });

  // Grab a port and immediately free it, so the webhook URL points at something
  // that will refuse the connection (ECONNREFUSED), not something that hangs.
  const probe = await startMockEndpoint((req, res) => res.end());
  const deadPort = new URL(probe.url).port;
  await probe.close();
  const unreachableWebhookUrl = `http://127.0.0.1:${deadPort}/`;

  t.after(async () => {
    await monitored.close();
    await close();
  });

  const cookie = await registerAndLogin(baseUrl, 'webhook-failure@example.com', 'password123');

  const createRes = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ url: monitored.url, displayName: 'Failure target', intervalSeconds: 60 }),
  });
  const check = await createRes.json();

  await fetch(`${baseUrl}/api/checks/${check.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ webhookUrl: unreachableWebhookUrl }),
  });

  // First poll establishes "up" (no webhook fires — not a transition).
  await pollDueChecks(db);

  // Force a transition so a delivery is actually attempted.
  monitoredStatus = 500;
  markDueNow(db, check.id);
  await pollDueChecks(db);

  const recorded = db.prepare('SELECT webhook_last_outcome FROM checks WHERE id = ?').get(check.id);
  assert.equal(recorded.webhook_last_outcome, 'failed');

  // The check's own polling and status are unaffected by the delivery failure.
  const listRes = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: cookie } });
  const [viewed] = await listRes.json();
  assert.equal(viewed.status, 'down');
  assert.equal(viewed.uptimePercent24h, 50); // 1 up (first poll) + 1 down (this poll) = 50%

  // Polling continues normally on the next due tick.
  monitoredStatus = 200;
  markDueNow(db, check.id);
  await pollDueChecks(db);
  const afterNextPoll = db
    .prepare('SELECT COUNT(*) AS count FROM poll_results WHERE check_id = ?')
    .get(check.id).count;
  assert.equal(afterNextPoll, 3, 'polling kept running after the failed delivery');
});
