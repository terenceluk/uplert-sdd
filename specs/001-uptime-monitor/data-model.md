# Data Model: Personal Uptime Monitor

Storage is a single SQLite database file (per Constitution Principle II), created and
schema-migrated automatically on first run. All four tables below live in that one file.

## User

Represents a registered account (spec Key Entity: User).

| Field | Type | Notes |
|---|---|---|
| `id` | integer, primary key, autoincrement | |
| `login` | text, unique, not null | Email or username (FR-001); max 254 characters |
| `password_hash` | text, not null | `scrypt` output, hex/base64-encoded |
| `password_salt` | text, not null | Random per-user salt used with `scrypt` |
| `role` | text, not null, `'admin'` \| `'user'` | Set once at creation (FR-002); never changes in this version |
| `created_at` | text (ISO 8601), not null | |

**Rules**:
- `login` uniqueness is enforced at the database level (`UNIQUE` constraint) and checked at
  registration (FR-001).
- `role` is computed at insert time: `'admin'` if this is the first row ever inserted into
  `users`, otherwise `'user'` (FR-002). Not user-settable through any API input.
- `password_hash`/`password_salt` are never included in any API response or log line
  (Constitution Principle V).
- The input `password` (before hashing, never stored itself) is rejected at registration
  if it exceeds 1024 characters; `login` is rejected if it exceeds 254 characters
  (FR-001).

## Check

An HTTP endpoint a user wants monitored (spec Key Entity: Check).

| Field | Type | Notes |
|---|---|---|
| `id` | integer, primary key, autoincrement | |
| `user_id` | integer, not null, foreign key → `users.id` | Owner (FR-012, FR-014) |
| `url` | text, not null | Must be a syntactically valid `http://` or `https://` URL (FR-005); max 2048 characters |
| `display_name` | text, not null | Max 100 characters (FR-005) |
| `interval_seconds` | integer, not null | 60–86400 inclusive (1 minute to 24 hours; FR-004/FR-005) |
| `created_at` | text (ISO 8601), not null | Anchors the "since creation" uptime window for checks younger than 24h |
| `last_polled_at` | text (ISO 8601), nullable | Null until the first poll completes; drives due-check scheduling (FR-006) |
| `poll_in_progress` | integer (boolean 0/1), not null, default 0 | Set while a poll is in flight so the next due tick skips it (FR-006) |

**Rules**:
- `interval_seconds` is validated against the 60–86400 range at creation (FR-005).
- `url` is rejected at creation if it exceeds 2048 characters; `display_name` is rejected
  if empty or if it exceeds 100 characters (FR-005).
- At creation, the URL's hostname is resolved and rejected if it is immediately resolvable
  to a private/loopback/link-local/metadata address (FR-019); no column stores this
  outcome, since it is re-evaluated — not cached — on every poll (research.md §9).
- Deleting a `Check` deletes all of its `PollResult` rows (FR-013) — enforced via
  `ON DELETE CASCADE` on the foreign key, so deletion is atomic and cannot leave orphaned
  history.
- A `Check` is "due" when `last_polled_at IS NULL` or
  `last_polled_at + interval_seconds <= now`, AND `poll_in_progress = 0`.

## PollResult

The outcome of one scheduled poll of a Check (spec Key Entity: Poll Result).

| Field | Type | Notes |
|---|---|---|
| `id` | integer, primary key, autoincrement | |
| `check_id` | integer, not null, foreign key → `checks.id`, `ON DELETE CASCADE` | |
| `status_code` | integer, nullable | HTTP status code; null if the request failed/timed out (FR-007) |
| `is_up` | integer (boolean 0/1), not null | Derived classification (FR-008), stored (not recomputed) so history is stable |
| `response_time_ms` | integer, not null | Elapsed time for the attempt, including a request that timed out at 10,000ms |
| `polled_at` | text (ISO 8601), not null | Timestamp of the poll (FR-007) |

**Rules**:
- `is_up = 1` only when `status_code` is in `[200, 399]` and the full response body was
  read within 10,000ms of initiating the connection (connect + headers + body, not just
  time-to-first-byte); otherwise `is_up = 0` (FR-008).
- A poll blocked by the URL-safety check (FR-019 — resolved address is private/internal/
  metadata) is recorded exactly like any other failure: `status_code = NULL`,
  `is_up = 0`, with `response_time_ms` reflecting the time taken to resolve and reject.
- Rows are append-only from the poller; the only deletion path is the cascade from deleting
  their owning `Check` (FR-013).
- Indexed on `(check_id, polled_at)` to make "last 24 hours" and "most recent N" queries
  (FR-010, FR-011) efficient without a full table scan as history grows.

## Session

Supports FR-003/FR-003a (sign-in / authenticated session). Not a spec-level business
entity, but required to implement server-side authorization (Constitution Principle III)
and the session-handling rules of Constitution Principle V, as amended in v1.1.0 (see
research.md §4).

| Field | Type | Notes |
|---|---|---|
| `token_hash` | text, primary key | `sha256` of a random `crypto.randomBytes(32)` value; the raw value is sent to the client as an `HttpOnly`, `SameSite=Strict` cookie and never stored (Constitution Principle V) |
| `user_id` | integer, not null, foreign key → `users.id`, `ON DELETE CASCADE` | |
| `created_at` | text (ISO 8601), not null | |
| `last_seen_at` | text (ISO 8601), not null | Updated on every successful authenticated request; compared against the fixed inactivity window to decide expiry (Constitution Principle V) |

**Rules**:
- A request is authenticated by hashing its cookie's raw token, looking up that hash in
  this table, and resolving `user_id` server-side — the request body/query string is never
  trusted for identity (Constitution Principle III), and the raw token itself is never
  stored (Constitution Principle V).
- A session row whose `last_seen_at` is older than the fixed inactivity window (set in
  `auth-service.js`, see research.md §4) is treated as expired: the request is rejected as
  unauthenticated and the row is deleted on that sighting, rather than kept around stale.
- Logout deletes the row immediately.

## Entity relationships

```text
User (1) ──< (many) Check (1) ──< (many) PollResult
User (1) ──< (many) Session
```

## Derived values (not stored as independent columns)

- **Current status** (FR-009): the `is_up` of the `Check`'s most recent `PollResult`
  (`ORDER BY polled_at DESC LIMIT 1`), or "pending" if no `PollResult` exists yet.
- **24-hour uptime percentage** (FR-010): `COUNT(is_up=1) / COUNT(*)` over `PollResult` rows
  for the check where `polled_at >= max(check.created_at, now - 24h)`.
- **Recent response times** (FR-011): the `response_time_ms` of the most recent 20
  `PollResult` rows for the check, newest first (see spec Assumptions).
- **Per-user check count** (FR-015): `COUNT(*)` of `Check` rows grouped by `user_id`,
  joined with `User` for the admin roster — this query never selects `Check`/`PollResult`
  columns beyond the count, which is what keeps FR-016 true by construction.
