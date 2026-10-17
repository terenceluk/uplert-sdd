import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/db/index.js';
import {
  computeUptimePercent24h,
  recentResponseTimes,
} from '../../src/services/uptime-service.js';

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'uplert-uptime-'));
  const db = openDatabase(join(dir, 'test.db'));
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertCheck(db, createdAt) {
  db.prepare(
    "INSERT INTO users (login, password_hash, password_salt, role, created_at) VALUES ('u', 'h', 's', 'user', ?)"
  ).run(createdAt);
  const userId = Number(db.prepare('SELECT id FROM users').get().id);
  db.prepare(
    "INSERT INTO checks (user_id, url, display_name, interval_seconds, created_at, last_polled_at, poll_in_progress) VALUES (?, 'https://example.com', 'c', 60, ?, NULL, 0)"
  ).run(userId, createdAt);
  return Number(db.prepare('SELECT id FROM checks').get().id);
}

function insertPoll(db, checkId, isUp, polledAt, responseTimeMs = 100) {
  db.prepare(
    'INSERT INTO poll_results (check_id, status_code, is_up, response_time_ms, polled_at) VALUES (?, ?, ?, ?, ?)'
  ).run(checkId, isUp ? 200 : 500, isUp ? 1 : 0, responseTimeMs, polledAt);
}

test('uptime percentage only counts polls within the last 24 hours', () => {
  withTempDb((db) => {
    const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const checkId = insertCheck(db, createdAt);

    // Outside the 24h window — must not count.
    insertPoll(db, checkId, false, new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString());

    // Inside the 24h window: 3 up, 1 down => 75%.
    insertPoll(db, checkId, true, new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString());
    insertPoll(db, checkId, true, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    insertPoll(db, checkId, true, new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString());
    insertPoll(db, checkId, false, new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());

    const uptime = computeUptimePercent24h(db, checkId, createdAt);
    assert.equal(uptime, 75);
  });
});

test('uptime percentage for a check younger than 24h is computed since creation', () => {
  withTempDb((db) => {
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const checkId = insertCheck(db, createdAt);

    insertPoll(db, checkId, true, new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString());

    const uptime = computeUptimePercent24h(db, checkId, createdAt);
    assert.equal(uptime, 100);
  });
});

test('recent response times returns at most the most recent 20, newest first', () => {
  withTempDb((db) => {
    const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const checkId = insertCheck(db, createdAt);

    for (let i = 0; i < 25; i += 1) {
      const polledAt = new Date(Date.now() - (25 - i) * 1000).toISOString();
      insertPoll(db, checkId, true, polledAt, 100 + i);
    }

    const times = recentResponseTimes(db, checkId);
    assert.equal(times.length, 20);
    assert.equal(times[0], 124); // most recent poll (i = 24) had response_time_ms = 124
    assert.equal(times[19], 105); // 20th-most-recent (i = 5) had response_time_ms = 105
  });
});
