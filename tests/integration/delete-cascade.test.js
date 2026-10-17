import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerAndLogin } from '../helpers/server-harness.js';

test('deleting a check removes all of its poll history (FR-013)', async (t) => {
  const { baseUrl, db, close } = await startTestServer();
  t.after(close);

  const cookie = await registerAndLogin(baseUrl, 'cascade@example.com', 'password123');

  const createRes = await fetch(`${baseUrl}/api/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      url: 'https://example.com/health',
      displayName: 'Has history',
      intervalSeconds: 60,
    }),
  });
  const check = await createRes.json();

  // Seed some poll history directly, standing in for polls that occurred over time.
  const now = new Date().toISOString();
  for (let i = 0; i < 3; i += 1) {
    db.prepare(
      'INSERT INTO poll_results (check_id, status_code, is_up, response_time_ms, polled_at) VALUES (?, 200, 1, 100, ?)'
    ).run(check.id, now);
  }
  const beforeCount = db
    .prepare('SELECT COUNT(*) AS count FROM poll_results WHERE check_id = ?')
    .get(check.id).count;
  assert.equal(beforeCount, 3);

  const deleteRes = await fetch(`${baseUrl}/api/checks/${check.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  assert.equal(deleteRes.status, 204);

  const afterCount = db
    .prepare('SELECT COUNT(*) AS count FROM poll_results WHERE check_id = ?')
    .get(check.id).count;
  assert.equal(afterCount, 0, 'no poll history should remain after the check is deleted');
});
