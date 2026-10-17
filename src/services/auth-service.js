import { randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto';

const SCRYPT_KEYLEN = 64;
export const INACTIVITY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function createSession(db, userId) {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)'
  ).run(tokenHash, userId, now, now);
  return rawToken;
}

export function validateSession(db, rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const session = db
    .prepare('SELECT * FROM sessions WHERE token_hash = ?')
    .get(tokenHash);
  if (!session) return null;

  const lastSeen = new Date(session.last_seen_at).getTime();
  if (Date.now() - lastSeen > INACTIVITY_WINDOW_MS) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(
    now,
    tokenHash
  );

  const user = db
    .prepare('SELECT id, login, role FROM users WHERE id = ?')
    .get(session.user_id);
  return user ?? null;
}

export function destroySession(db, rawToken) {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

const SESSION_COOKIE_NAME = 'session';

export function buildSessionCookie(rawToken) {
  return `${SESSION_COOKIE_NAME}=${rawToken}; HttpOnly; SameSite=Strict; Path=/`;
}

export function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function getSessionUser(db, cookies) {
  return validateSession(db, cookies[SESSION_COOKIE_NAME]);
}
