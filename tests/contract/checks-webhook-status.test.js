import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';
import { startMockEndpoint } from '../helpers/mock-endpoint.js';
import { pollDueChecks } from '../../src/services/poller.js';

function markDueNow(db, checkId) {
  db.prepare('UPDATE checks SET last_polled_at = NULL WHERE id = ?').run(checkId);
}

async function getCheck(baseUrl, cookie, checkId) {
  const res = await fetch(`${baseUrl}/api/checks`, { headers: { Cookie: cookie } });
  const checks = await res.json();
  return checks.find((c) => c.id === checkId);
}

test('webhookLastDeliveryStatus / webhookLastDeliveryAt visibility', async (t) => {
  const { baseUrl, db, close } = await startTestServer();
  t.mock.method(dns.promises, 'lookup', async () => ({ address: '203.0.113.1', family: 4 }));

  let monitoredStatus = 200;
  const monitored = await startMockEndpoint((req, res) => {
    res.writeHead(monitoredStatus);
    res.end('body');
  });
  const webhook = await startMockEndpoint((req, res) => {
    res.writeHead(200);
    res.end('ok');
  });

  t.after(async () => {
    await monitored.close();
    await webhook.close();
    await close();
  });

  const cookie = await registerAndLogin(baseUrl, 'webhook-status@example.com', 'password123');

  const createRes = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ url: monitored.url, displayName: 'Status target', intervalSeconds: 60 }),
  });
  const check = await createRes.json();

  await t.test('no webhook URL set: both fields are null', async () => {
    const viewed = await getCheck(baseUrl, cookie, check.id);
    assert.equal(viewed.webhookLastDeliveryStatus, null);
    assert.equal(viewed.webhookLastDeliveryAt, null);
  });

  await t.test('webhook URL set but never attempted: both fields still null', async () => {
    await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ webhookUrl: webhook.url }),
    });
    const viewed = await getCheck(baseUrl, cookie, check.id);
    assert.equal(viewed.webhookLastDeliveryStatus, null);
    assert.equal(viewed.webhookLastDeliveryAt, null);
  });

  await t.test('after a delivery attempt, both fields are populated', async () => {
    await pollDueChecks(db); // pending -> up, no delivery yet

    monitoredStatus = 500;
    markDueNow(db, check.id);
    await pollDueChecks(db); // up -> down, delivery attempted

    const viewed = await getCheck(baseUrl, cookie, check.id);
    assert.equal(viewed.webhookLastDeliveryStatus, 'succeeded');
    assert.equal(typeof viewed.webhookLastDeliveryAt, 'string');
  });

  await t.test('clearing the webhook URL hides the prior outcome', async () => {
    await fetch(`${baseUrl}/api/checks/${check.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ webhookUrl: null }),
    });
    const viewed = await getCheck(baseUrl, cookie, check.id);
    assert.equal(viewed.webhookUrl, null);
    assert.equal(viewed.webhookLastDeliveryStatus, null);
    assert.equal(viewed.webhookLastDeliveryAt, null);
  });
});
