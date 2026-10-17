import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/db/index.js';
import { pollDueChecks } from '../../src/services/poller.js';

// Simulates a check whose URL now resolves to a private address at poll time,
// even though it was accepted at creation. A real DNS-rebinding attack can't
// be staged in a test environment, so this directly mutates the stored URL to
// a loopback address between "creation" and the poll — exercising the exact
// re-check-on-every-poll code path FR-019 requires, regardless of how the
// resolved address came to change.
test('a check blocked by url-safety at poll time is recorded "down", not skipped', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'uplert-poller-safety-'));
  const db = openDatabase(join(dir, 'test.db'));
  t.after(() => {
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
     VALUES (?, 'http://127.0.0.1:9/', 'c', 60, ?, NULL, 0)`
  ).run(userId, now);
  const checkId = Number(db.prepare('SELECT id FROM checks').get().id);

  await pollDueChecks(db);

  const result = db
    .prepare('SELECT * FROM poll_results WHERE check_id = ? ORDER BY id DESC LIMIT 1')
    .get(checkId);

  assert.ok(result, 'expected a poll_result row to be recorded, not silently skipped');
  assert.equal(result.is_up, 0);
  assert.equal(result.status_code, null);
});
