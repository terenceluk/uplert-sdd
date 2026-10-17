import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/db/index.js';
import {
  createSession,
  validateSession,
  INACTIVITY_WINDOW_MS,
} from '../../src/services/auth-service.js';

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'uplert-unit-'));
  const db = openDatabase(join(dir, 'test.db'));
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('session tokens are never stored in plaintext', () => {
  withTempDb((db) => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (login, password_hash, password_salt, role, created_at) VALUES ('u', 'h', 's', 'user', ?)"
    ).run(now);
    const userId = Number(db.prepare('SELECT id FROM users').get().id);

    const rawToken = createSession(db, userId);
    const rows = db.prepare('SELECT token_hash FROM sessions').all();

    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, rawToken);
    assert.equal(rows[0].token_hash.length, 64); // sha256 hex digest length
  });
});

test('a session past the inactivity window is rejected and removed', () => {
  withTempDb((db) => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (login, password_hash, password_salt, role, created_at) VALUES ('u2', 'h', 's', 'user', ?)"
    ).run(now);
    const userId = Number(db.prepare('SELECT id FROM users').get().id);

    const rawToken = createSession(db, userId);

    // Simulate the session having gone stale well past the inactivity window.
    const staleTime = new Date(Date.now() - INACTIVITY_WINDOW_MS - 1000).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?').run(staleTime);

    const result = validateSession(db, rawToken);
    assert.equal(result, null);

    const remaining = db.prepare('SELECT * FROM sessions').all();
    assert.equal(remaining.length, 0);
  });
});

test('a fresh session validates and refreshes last_seen_at', () => {
  withTempDb((db) => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (login, password_hash, password_salt, role, created_at) VALUES ('u3', 'h', 's', 'admin', ?)"
    ).run(now);
    const userId = Number(db.prepare('SELECT id FROM users').get().id);

    const rawToken = createSession(db, userId);
    const user = validateSession(db, rawToken);

    assert.ok(user);
    assert.equal(user.role, 'admin');
  });
});
