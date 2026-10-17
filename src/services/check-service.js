import { isSafeToFetch } from './url-safety.js';

export const MAX_URL_LENGTH = 2048;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 86400;

export function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateCheckInput({ url, displayName, intervalSeconds }) {
  if (typeof url !== 'string' || !isValidHttpUrl(url)) {
    return 'url must be a valid http(s) URL';
  }
  if (url.length > MAX_URL_LENGTH) {
    return `url must be at most ${MAX_URL_LENGTH} characters`;
  }
  if (typeof displayName !== 'string' || displayName.length === 0) {
    return 'displayName is required';
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`;
  }
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < MIN_INTERVAL_SECONDS ||
    intervalSeconds > MAX_INTERVAL_SECONDS
  ) {
    return `intervalSeconds must be an integer between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`;
  }
  return null;
}

export function getCheckById(db, checkId) {
  return db.prepare('SELECT * FROM checks WHERE id = ?').get(checkId);
}

export async function createCheck(db, userId, input) {
  const validationError = validateCheckInput(input);
  if (validationError) {
    return { error: validationError };
  }

  const safe = await isSafeToFetch(input.url);
  if (!safe) {
    return {
      error:
        'url resolves to a private, loopback, link-local, or metadata address and cannot be monitored',
    };
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO checks (user_id, url, display_name, interval_seconds, created_at, last_polled_at, poll_in_progress)
       VALUES (?, ?, ?, ?, ?, NULL, 0)`
    )
    .run(userId, input.url, input.displayName, input.intervalSeconds, now);

  return { check: getCheckById(db, Number(result.lastInsertRowid)) };
}

export function listChecksForUser(db, userId) {
  return db.prepare('SELECT * FROM checks WHERE user_id = ? ORDER BY id').all(userId);
}

export function deleteCheck(db, userId, checkId) {
  const check = getCheckById(db, checkId);
  if (!check || check.user_id !== userId) {
    return false;
  }
  db.prepare('DELETE FROM checks WHERE id = ?').run(checkId);
  return true;
}

/**
 * Ownership-checked update of a check's webhook URL. Validation of `webhookUrl` (syntax,
 * length, destination safety) is the caller's responsibility (see webhook-service.js's
 * validateWebhookUrl) — kept out of this module to avoid a circular import between
 * check-service.js and webhook-service.js. `webhookUrl: null` clears the webhook.
 */
export function updateCheckWebhook(db, userId, checkId, webhookUrl) {
  const check = getCheckById(db, checkId);
  if (!check || check.user_id !== userId) {
    return null;
  }
  db.prepare('UPDATE checks SET webhook_url = ? WHERE id = ?').run(webhookUrl, checkId);
  return getCheckById(db, checkId);
}

export function getAdminRoster(db) {
  return db
    .prepare(
      `SELECT u.id AS id, u.login AS login, u.role AS role,
              (SELECT COUNT(*) FROM checks c WHERE c.user_id = u.id) AS checkCount
       FROM users u
       ORDER BY u.id`
    )
    .all();
}
