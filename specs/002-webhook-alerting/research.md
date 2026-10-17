# Research: Webhook Alerting

All Technical Context items were decided explicitly by the user's planning direction
("Extend the existing Uplert application. Reuse the existing poller, data store, and
authorization checks, store the webhook URL on the existing check record, and add no new
dependencies."). No `NEEDS CLARIFICATION` markers remain. This document records the
resulting decisions against the **existing feature 001 codebase**, not from a blank slate.

## 1. Where webhook state lives

- **Decision**: Three new nullable columns directly on the existing `checks` table:
  `webhook_url`, `webhook_last_outcome` (`'succeeded'` | `'failed'` | `NULL`),
  `webhook_last_attempted_at` (ISO timestamp | `NULL`). No new table.
- **Rationale**: The user explicitly said to store the webhook URL on the existing check
  record. The spec's own Clarifications answer narrows delivery-outcome tracking to "only
  the most recent attempt" (not a history) — which is exactly one row's worth of state,
  so a separate `webhook_deliveries` table would hold at most one row per check anyway.
  Overwriting two columns on the same `checks` row is simpler, requires no join to render
  the dashboard, and is consistent with "no new dependencies/infrastructure" in spirit.
- **Alternatives considered**: A `webhook_deliveries` table (one row per attempt, or one
  row per check) — rejected as unnecessary complexity for data the spec explicitly says
  is not retained as a history; mirroring `poll_results`' append-only design would also
  need a cleanup/retention policy the spec never asked for.

## 2. Schema evolution for an existing database

- **Decision**: `db/index.js`'s startup step gains a second phase after applying
  `schema.sql`: for each of the three new columns, check `PRAGMA table_info(checks)` and
  run `ALTER TABLE checks ADD COLUMN ...` only if that column is absent.
- **Rationale**: `CREATE TABLE IF NOT EXISTS` (feature 001's existing approach) is a
  no-op against a `checks` table that already exists from a prior run — it will **not**
  retroactively add these new columns to someone's existing `uplert.db`. SQLite's
  `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` clause, so the existence check has
  to happen in application code. This keeps Constitution Principle II's "no separate
  migration command" promise true for upgrades, not just fresh installs, at zero
  dependency cost (`PRAGMA table_info` and `ALTER TABLE` are both plain SQL the existing
  `node:sqlite` connection already executes).
- **Alternatives considered**: A dedicated migration-runner/versioned-migrations
  mechanism — rejected as unnecessary machinery (and a new dependency risk) for a schema
  that, in practice, only ever grows by a handful of nullable columns across this
  project's lifetime so far; wrapping the `ALTER TABLE` in a try/catch and ignoring a
  "duplicate column" error — rejected as a sloppier version of the same idea that would
  also silently swallow a genuinely different failure.

## 3. Where delivery is triggered from

- **Decision**: Inside `src/services/poller.js`'s existing `pollOneCheck`, immediately
  after `recordPollResult` runs and before the `finally` block clears
  `poll_in_progress`. The check's status *before* this poll (via `uptime-service.js`'s
  existing `computeStatus`, called before the new row is inserted) is compared to the
  status this poll just produced; a new `webhook-service.js` is invoked only when they
  differ and neither is `"pending"`.
- **Rationale**: The user said to reuse the existing poller rather than add a second
  scheduler. `pollOneCheck` already runs once per due check, already knows the exact
  status-determining values (`statusCode`, `responseTimeMs`, the derived `isUp`), and
  already has a `finally` block that guarantees `poll_in_progress` clears regardless of
  what happens — placing the webhook call before that `finally` means a hung or slow
  delivery still can't leave `poll_in_progress` stuck forever (it's wrapped in its own
  timeout, see §5) and a delivery failure still can't prevent the flag from clearing
  (`webhook-service.js` never throws).
- **Alternatives considered**: A separate `setInterval` tick dedicated to webhooks,
  scanning for recent transitions — rejected per explicit user direction, and it would
  need its own notion of "already alerted this transition," duplicating state this
  design gets for free by acting at the exact moment the transition is detected.

## 4. Detecting "the first poll" vs. a real transition

- **Decision**: `computeStatus` already returns `"pending"` when a check has no prior
  poll result (feature 001). Webhook delivery is skipped whenever the *previous* status
  was `"pending"`, in addition to being skipped whenever previous and new status match.
- **Rationale**: Reuses an existing function and an existing enum value rather than
  adding a new "is this the first poll" flag anywhere.
- **Alternatives considered**: none seriously — this is a direct, almost free reuse of
  existing state.

## 5. Delivery request shape, timeout, and failure handling

- **Decision**: A single `fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type':
  'application/json' }, body: JSON.stringify(payload), signal })` with the exact same
  `AbortController` + `POLL_TIMEOUT_MS` (10 seconds, imported from `uptime-service.js`)
  pattern `poller.js` already uses to poll a check's own URL. Any thrown error (network
  failure, timeout, non-2xx is still considered "delivered" at the HTTP layer — see
  below) is caught inside `webhook-service.js` and turned into `webhook_last_outcome =
  'failed'`; anything else is `'succeeded'`.
- **Rationale**: Reuses the exact timeout mechanics already proven in `poller.js` instead
  of inventing a second one. The payload fields (`displayName`, `url`, `state`,
  `statusCode`, `responseTimeMs`, `changedAt`) match spec FR-007 exactly.
- **On response status codes**: a webhook endpoint that is reachable and responds — even
  with a 4xx/5xx — has still *received* the notification; spec FR-010 only requires that
  a failed **delivery** not affect polling, and "recorded... outcome (succeeded or
  failed)" (FR-008) is about whether the HTTP request itself completed, not about judging
  the receiver's response code. This project therefore treats any response that arrives
  before the timeout as `'succeeded'`, and only a network error, DNS/destination-safety
  rejection, or timeout as `'failed'` — avoiding the need to pick an arbitrary
  "acceptable status code" policy the spec never specified.
- **Alternatives considered**: treating non-2xx responses as `'failed'` — rejected as an
  unrequested policy decision with no basis in the spec; retrying a failed delivery —
  explicitly not asked for (spec says "a single HTTP POST") and rejected to keep this a
  one-shot, fire-once-per-transition design.

## 6. Reusing URL-syntax validation between checks and webhooks

- **Decision**: `check-service.js`'s existing `isValidHttpUrl` function (currently
  private to that module) is exported and imported directly by `webhook-service.js`,
  alongside the existing `MAX_URL_LENGTH` constant (2048, already shared conceptually
  with checks per spec FR-003's "same rules").
- **Rationale**: Avoids re-implementing the exact same "is this a syntactically valid
  http(s) URL of at most N characters" check a second time, consistent with the user's
  "reuse" direction.
- **Alternatives considered**: duplicating the check inline in `webhook-service.js` —
  rejected as exactly the kind of drift-prone duplication the "reuse" direction was
  written to avoid.

## 7. API shape for setting/clearing the webhook URL

- **Decision**: `PATCH /api/checks/:id` with body `{"webhookUrl": string | null}`. A
  `null` (or omitted) value clears the webhook; a non-null value is validated exactly
  like a check's own URL (syntax, length, destination safety at set-time) before being
  stored. The response is the same check-view shape `GET`/`POST /api/checks` already
  return, now including the three new fields.
- **Rationale**: `PATCH` semantically signals "partial update" for exactly one field,
  matching this feature's narrow scope (the spec grants changing the webhook URL, not
  general check editing). Reusing the existing check-view response shape means the
  dashboard's existing rendering code only needs new fields added, not a new response
  shape to parse.
- **Alternatives considered**: a dedicated `/api/checks/:id/webhook` sub-resource — adds
  a second URL pattern for what is, underneath, a single-column update on the same
  resource `DELETE /api/checks/:id` already addresses; rejected for not being simpler.
- **Correction (Convergence, T022)**: this section originally also decided that
  `POST /api/checks` would **not** accept `webhookUrl` at creation, reasoning that
  `PATCH` immediately afterward was an acceptable substitute. `/speckit-converge` caught
  that this directly under-delivered spec.md's FR-001 ("either when adding the check or
  by updating it afterward") and its Acceptance Scenario 5. `POST /api/checks` now also
  accepts an optional `webhookUrl`, validated identically to `PATCH`'s. `PATCH` remains
  the only way to *change or clear* a webhook URL after creation.

## Summary

No third-party dependency is added. Every new piece of behavior is either a small,
additive extension of an existing file (`poller.js`, `check-service.js`,
`uptime-service.js`, `routes/checks.js`, `db/index.js`, `server.js`, `dashboard.js`) or
one new file (`webhook-service.js`) that itself only composes functions those existing
files already export or could trivially export.
