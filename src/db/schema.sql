CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT UNIQUE NOT NULL CHECK(length(login) <= 254),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  url TEXT NOT NULL CHECK(length(url) <= 2048),
  display_name TEXT NOT NULL CHECK(length(display_name) <= 100),
  interval_seconds INTEGER NOT NULL CHECK(interval_seconds BETWEEN 60 AND 86400),
  created_at TEXT NOT NULL,
  last_polled_at TEXT,
  poll_in_progress INTEGER NOT NULL DEFAULT 0,
  webhook_url TEXT CHECK(webhook_url IS NULL OR length(webhook_url) <= 2048),
  webhook_last_outcome TEXT CHECK(webhook_last_outcome IS NULL OR webhook_last_outcome IN ('succeeded', 'failed')),
  webhook_last_attempted_at TEXT
);

CREATE TABLE IF NOT EXISTS poll_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  status_code INTEGER,
  is_up INTEGER NOT NULL,
  response_time_ms INTEGER NOT NULL,
  polled_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_poll_results_check_polled
  ON poll_results (check_id, polled_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
