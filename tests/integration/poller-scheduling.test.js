import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/db/index.js';
import { pollDueChecks } from '../../src/services/poller.js';
import { startMockEndpoint } from '../helpers/mock-endpoint.js';

test('a check already mid-poll is skipped, and resumes once no longer in progress', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'uplert-poller-'));
  const db = openDatabase(join(dir, 'test.db'));
  const endpoint = await startMockEndpoint((req, res) => {
    res.writeHead(200);
    res.end('ok');
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
     VALUES (?, ?, 'c', 60, ?, NULL, 1)` // poll_in_progress = 1: simulates a poll already in flight
  ).run(userId, endpoint.url, now);
  const checkId = Number(db.prepare('SELECT id FROM checks').get().id);

  await pollDueChecks(db);
  const afterFirstTick = db
    .prepare('SELECT COUNT(*) AS count FROM poll_results WHERE check_id = ?')
    .get(checkId).count;
  assert.equal(afterFirstTick, 0, 'a check mid-poll must be skipped, not polled concurrently');

  // The in-flight poll "completes" — flip the flag back off, as pollOneCheck's
  // own finally-block would.
  db.prepare('UPDATE checks SET poll_in_progress = 0 WHERE id = ?').run(checkId);

  await pollDueChecks(db);
  const afterSecondTick = db
    .prepare('SELECT COUNT(*) AS count FROM poll_results WHERE check_id = ?')
    .get(checkId).count;
  assert.equal(afterSecondTick, 1, 'once no longer in progress, the check is polled normally');
});
