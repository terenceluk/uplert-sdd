export const POLL_TIMEOUT_MS = 10_000;
const RECENT_RESPONSE_LIMIT = 20;

/**
 * A poll is "up" only when the status code is in [200, 399] and the full
 * response was read within POLL_TIMEOUT_MS of connection start (FR-008).
 */
export function classifyPoll(statusCode, responseTimeMs) {
  if (statusCode === null || statusCode === undefined) return false;
  if (responseTimeMs > POLL_TIMEOUT_MS) return false;
  return statusCode >= 200 && statusCode <= 399;
}

export function computeStatus(db, checkId) {
  const latest = db
    .prepare(
      'SELECT is_up FROM poll_results WHERE check_id = ? ORDER BY polled_at DESC, id DESC LIMIT 1'
    )
    .get(checkId);
  if (!latest) return 'pending';
  return latest.is_up ? 'up' : 'down';
}

export function computeUptimePercent24h(db, checkId, checkCreatedAt) {
  const windowStartMs = Math.max(
    Date.parse(checkCreatedAt),
    Date.now() - 24 * 60 * 60 * 1000
  );
  const since = new Date(windowStartMs).toISOString();

  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(is_up), 0) AS upCount
       FROM poll_results
       WHERE check_id = ? AND polled_at >= ?`
    )
    .get(checkId, since);

  if (!row.total) return 0;
  return Math.round((row.upCount / row.total) * 1000) / 10;
}

export function recentResponseTimes(db, checkId, limit = RECENT_RESPONSE_LIMIT) {
  const rows = db
    .prepare(
      'SELECT response_time_ms FROM poll_results WHERE check_id = ? ORDER BY polled_at DESC, id DESC LIMIT ?'
    )
    .all(checkId, limit);
  return rows.map((row) => row.response_time_ms);
}

export function buildCheckView(db, check) {
  return {
    id: check.id,
    url: check.url,
    displayName: check.display_name,
    intervalSeconds: check.interval_seconds,
    status: computeStatus(db, check.id),
    uptimePercent24h: computeUptimePercent24h(db, check.id, check.created_at),
    recentResponseTimesMs: recentResponseTimes(db, check.id),
  };
}
