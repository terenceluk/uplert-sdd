import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/db/index.js';
import { createServer } from '../../src/server.js';

export async function startTestServer() {
  const dir = mkdtempSync(join(tmpdir(), 'uplert-test-'));
  const dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath);
  const server = createServer(db);

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return { baseUrl, db, close };
}

/** Extracts the raw session cookie value from a fetch Response's Set-Cookie header. */
export function extractSessionCookie(response) {
  const raw = response.headers.get('set-cookie');
  if (!raw) return null;
  const match = raw.match(/session=([^;]*)/);
  return match ? `session=${match[1]}` : null;
}

/** Registers a user (if not already registered) and signs in, returning the cookie header value. */
export async function registerAndLogin(baseUrl, login, password) {
  await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  return extractSessionCookie(res);
}
