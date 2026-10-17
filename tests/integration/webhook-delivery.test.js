import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';
import { startMockEndpoint } from '../helpers/mock-endpoint.js';
import { pollDueChecks } from '../../src/services/poller.js';

function makeDeliveries() {
  const received = [];
  return {
    received,
    async start() {
      return startMockEndpoint((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          received.push(JSON.parse(body));
          res.writeHead(200);
          res.end('ok');
        });
      });
    },
  };
}

function markDueNow(db, checkId) {
  db.prepare('UPDATE checks SET last_polled_at = NULL WHERE id = ?').run(checkId);
}

test('webhook fires exactly once per real transition, never on repeats or the first poll', async (t) => {
  const { baseUrl, db, close } = await startTestServer();

  // Both the monitored endpoint and the webhook receiver live on 127.0.0.1, which
  // url-safety correctly blocks for real checks — stub the safety check's own DNS
  // lookup so this test can drive real HTTP round trips locally (see monitor-flow.test.js
  // in feature 001 for the same technique).
  t.mock.method(dns.promises, 'lookup', async () => ({ address: '203.0.113.1', family: 4 }));

  let monitoredStatus = 200;
  const monitored = await startMockEndpoint((req, res) => {
    res.writeHead(monitoredStatus);
    res.end('body');
  });

  const deliveries = makeDeliveries();
  const webhook = await deliveries.start();

  t.after(async () => {
    await monitored.close();
    await webhook.close();
    await close();
  });

  const cookie = await registerAndLogin(baseUrl, 'webhook-delivery@example.com', 'password123');

  const createRes = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ url: monitored.url, displayName: 'Delivery target', intervalSeconds: 60 }),
  });
  const check = await createRes.json();

  await fetch(`${baseUrl}/api/checks/${check.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ webhookUrl: webhook.url }),
  });

  // First poll: pending -> up. Not a transition between up/down — no webhook.
  await pollDueChecks(db);
  assert.equal(deliveries.received.length, 0, 'the first-ever poll must not fire a webhook');

  // Force a real up -> down transition.
  monitoredStatus = 500;
  markDueNow(db, check.id);
  await pollDueChecks(db);
  assert.equal(deliveries.received.length, 1, 'exactly one webhook for the up->down transition');
  assert.deepEqual(deliveries.received[0], {
    displayName: 'Delivery target',
    url: monitored.url,
    state: 'down',
    statusCode: 500,
    responseTimeMs: deliveries.received[0].responseTimeMs,
    changedAt: deliveries.received[0].changedAt,
  });
  assert.equal(typeof deliveries.received[0].responseTimeMs, 'number');
  assert.equal(typeof deliveries.received[0].changedAt, 'string');

  const recorded = db.prepare('SELECT webhook_last_outcome FROM checks WHERE id = ?').get(check.id);
  assert.equal(recorded.webhook_last_outcome, 'succeeded');

  // Repeat the same "down" state — no additional webhook.
  markDueNow(db, check.id);
  await pollDueChecks(db);
  assert.equal(deliveries.received.length, 1, 'no additional webhook for a repeated same-state poll');

  // Flip back down -> up — a second webhook, for the other direction.
  monitoredStatus = 200;
  markDueNow(db, check.id);
  await pollDueChecks(db);
  assert.equal(deliveries.received.length, 2, 'exactly one webhook for the down->up transition');
  assert.equal(deliveries.received[1].state, 'up');
});
