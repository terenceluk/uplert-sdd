import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/db/index.js';

function createPreFeature002Database(filePath) {
  // Mirrors feature 001's checks table shape — no webhook columns at all.
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      url TEXT NOT NULL,
      display_name TEXT NOT NULL,
      interval_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_polled_at TEXT,
      poll_in_progress INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.close();
}

test('opening a pre-feature-002 database adds the missing webhook columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uplert-migration-'));
  const dbPath = join(dir, 'legacy.db');
  try {
    createPreFeature002Database(dbPath);

    const db = openDatabase(dbPath);
    const columns = db.prepare('PRAGMA table_info(checks)').all().map((row) => row.name);
    assert.ok(columns.includes('webhook_url'));
    assert.ok(columns.includes('webhook_last_outcome'));
    assert.ok(columns.includes('webhook_last_attempted_at'));

    // The upgraded columns are usable immediately.
    db.prepare(
      "INSERT INTO users (login, password_hash, password_salt, role, created_at) VALUES ('u', 'h', 's', 'user', ?)"
    ).run(new Date().toISOString());
    const userId = Number(db.prepare('SELECT id FROM users').get().id);
    db.prepare(
      `INSERT INTO checks (user_id, url, display_name, interval_seconds, created_at, webhook_url)
       VALUES (?, 'https://example.com', 'c', 60, ?, 'https://hooks.example.com/x')`
    ).run(userId, new Date().toISOString());
    const check = db.prepare('SELECT webhook_url FROM checks').get();
    assert.equal(check.webhook_url, 'https://hooks.example.com/x');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('opening an already-upgraded database a second time does not error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uplert-migration-idempotent-'));
  const dbPath = join(dir, 'upgraded.db');
  try {
    createPreFeature002Database(dbPath);
    openDatabase(dbPath).close();

    assert.doesNotThrow(() => {
      openDatabase(dbPath).close();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
