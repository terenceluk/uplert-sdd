import { isSafeToFetch } from './url-safety.js';
import { classifyPoll, POLL_TIMEOUT_MS } from './uptime-service.js';

const DEFAULT_TICK_INTERVAL_MS = 15_000;

export function startPoller(db, tickIntervalMs = DEFAULT_TICK_INTERVAL_MS) {
  const tick = () => {
    pollDueChecks(db).catch((err) => console.error('Poller tick error:', err.message));
  };
  tick(); // run immediately so short test intervals don't wait a full tick period
  return setInterval(tick, tickIntervalMs);
}

export async function pollDueChecks(db) {
  const now = Date.now();
  const candidates = db.prepare('SELECT * FROM checks WHERE poll_in_progress = 0').all();
  const due = candidates.filter((check) => {
    if (!check.last_polled_at) return true;
    const nextDueMs = Date.parse(check.last_polled_at) + check.interval_seconds * 1000;
    return nextDueMs <= now;
  });
  await Promise.all(due.map((check) => pollOneCheck(db, check)));
}

async function pollOneCheck(db, check) {
  db.prepare('UPDATE checks SET poll_in_progress = 1 WHERE id = ?').run(check.id);
  try {
    const result = await performPoll(check.url);
    recordPollResult(db, check.id, result);
  } finally {
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE checks SET poll_in_progress = 0, last_polled_at = ? WHERE id = ?'
    ).run(now, check.id);
  }
}

async function performPoll(url) {
  const start = Date.now();

  const safe = await isSafeToFetch(url);
  if (!safe) {
    return { statusCode: null, responseTimeMs: Date.now() - start };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    await response.text(); // ensure the full body is read within the same timeout budget
    return { statusCode: response.status, responseTimeMs: Date.now() - start };
  } catch {
    return { statusCode: null, responseTimeMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

function recordPollResult(db, checkId, { statusCode, responseTimeMs }) {
  const isUp = classifyPoll(statusCode, responseTimeMs) ? 1 : 0;
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO poll_results (check_id, status_code, is_up, response_time_ms, polled_at) VALUES (?, ?, ?, ?, ?)'
  ).run(checkId, statusCode, isUp, responseTimeMs, now);
}
