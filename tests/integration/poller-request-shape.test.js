import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/db/index.js';
import { pollDueChecks } from '../../src/services/poller.js';
import { startMockEndpoint } from '../helpers/mock-endpoint.js';

test('the poller sends a plain GET request with no custom headers, body, or auth', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'uplert-poller-shape-'));
  const db = openDatabase(join(dir, 'test.db'));

  // See monitor-flow.test.js: the mock endpoint listens on 127.0.0.1, which
  // url-safety blocks for real checks, so the safety check's own DNS lookup
  // is stubbed here — the real fetch() still connects to the real address.
  t.mock.method(dns.promises, 'lookup', async () => ({ address: '203.0.113.1', family: 4 }));

  let capturedMethod = null;
  let capturedBody = '';
  let capturedAuthHeader;

  const endpoint = await startMockEndpoint((req, res) => {
    capturedMethod = req.method;
    capturedAuthHeader = req.headers.authorization;
    req.on('data', (chunk) => {
      capturedBody += chunk;
    });
    req.on('end', () => {
      res.writeHead(200);
      res.end('ok');
    });
  });

  t.after(async () => {
    await endpoint.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (login, password_hash, password_salt, role, created_at) VALUES ('u', 'h', 's', 'user', ?)"
  ).run(now);
  const userId = Number(db.prepare('SELECT id FROM users').get().id);
  db.prepare(
    `INSERT INTO checks (user_id, url, display_name, interval_seconds, created_at, last_polled_at, poll_in_progress)
     VALUES (?, ?, 'c', 60, ?, NULL, 0)`
  ).run(userId, endpoint.url, now);

  await pollDueChecks(db);

  assert.equal(capturedMethod, 'GET');
  assert.equal(capturedBody, '');
  assert.equal(capturedAuthHeader, undefined);
});
