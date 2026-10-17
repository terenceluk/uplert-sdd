import { isValidHttpUrl, MAX_URL_LENGTH } from './check-service.js';
import { isSafeToFetch } from './url-safety.js';
import { POLL_TIMEOUT_MS } from './uptime-service.js';

/**
 * Validates a webhook URL the same way a check's own URL is validated: syntax, length,
 * and (since this is also an outbound destination Uplert will POST to) the same
 * private/loopback/link-local/metadata destination check (FR-003). This is the
 * set-time validation; sendWebhookAlert re-runs the destination check again at every
 * delivery attempt, since a safe destination can change after the fact.
 */
export async function validateWebhookUrl(url) {
  if (typeof url !== 'string' || !isValidHttpUrl(url)) {
    return 'webhookUrl must be a valid http(s) URL';
  }
  if (url.length > MAX_URL_LENGTH) {
    return `webhookUrl must be at most ${MAX_URL_LENGTH} characters`;
  }
  const safe = await isSafeToFetch(url);
  if (!safe) {
    return 'webhookUrl resolves to a private, loopback, link-local, or metadata address and cannot be used';
  }
  return null;
}

function recordOutcome(db, checkId, outcome) {
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE checks SET webhook_last_outcome = ?, webhook_last_attempted_at = ? WHERE id = ?'
  ).run(outcome, now, checkId);
}

/**
 * Sends a single webhook notification for a check's up/down transition. Re-validates
 * destination safety at delivery time (FR-003) and never throws — any failure is caught
 * and recorded as 'failed' so it can never affect the poller that calls this (FR-010).
 */
export async function sendWebhookAlert(db, check, newStatus, statusCode, responseTimeMs, changedAt) {
  if (!check.webhook_url) return;

  try {
    const safe = await isSafeToFetch(check.webhook_url);
    if (!safe) {
      recordOutcome(db, check.id, 'failed');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
    try {
      await fetch(check.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: check.display_name,
          url: check.url,
          state: newStatus,
          statusCode,
          responseTimeMs,
          changedAt,
        }),
        signal: controller.signal,
      });
      recordOutcome(db, check.id, 'succeeded');
    } finally {
      clearTimeout(timer);
    }
  } catch {
    recordOutcome(db, check.id, 'failed');
  }
}
