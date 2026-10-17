# Implementation Plan: Webhook Alerting

**Branch**: `002-webhook-alerting` | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-webhook-alerting/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Webhook alerting is an **extension** of the existing Uplert application (feature
001-uptime-monitor), not a new subsystem. A user can set an optional webhook URL directly
on a check they already own; that URL is stored as two new nullable columns on the
existing `checks` row (the URL itself, plus the outcome/timestamp of the most recent
delivery attempt — no new table, per user direction). The existing poller
(`src/services/poller.js`) is extended, not replaced: after it records a poll result, it
compares the check's status before and after that poll, and — only on a genuine up↔down
flip, for a check with a webhook URL set — sends one HTTP POST to that URL using the same
`fetch`/`AbortController`/10-second-timeout pattern already used to poll the check itself.
A failed delivery is caught internally and recorded; it can never throw out of the poller
or affect the check's own polling or status. The existing per-check ownership check
(`getSessionUser` + `check.user_id === user.id`, already used by every `/api/checks`
handler) is reused for the one new capability this feature adds: a `PATCH
/api/checks/:id` endpoint to view/set/clear a check's webhook URL. Webhook URLs are
validated with the exact same syntax, length, and private/internal/loopback/metadata
destination rules as check URLs (reusing `url-safety.js`'s `isSafeToFetch`), re-checked at
every delivery attempt, not only when set. No third-party dependency is introduced.

## Technical Context

**Language/Version**: Node.js 22 LTS or later (minimum 22.5.0) — unchanged from feature
001; this feature adds no new runtime requirement.

**Primary Dependencies**: None (zero third-party npm packages) — unchanged. Webhook
delivery reuses the same Node.js core modules already in use: global `fetch` +
`AbortController` for the outbound POST, `node:sqlite` for the two new columns, and
`url-safety.js`'s existing `dns.promises.lookup`-based destination check.

**Storage**: The existing single SQLite file (`uplert.db`). Two new nullable columns are
added to the existing `checks` table (`webhook_url`, `webhook_last_outcome`,
`webhook_last_attempted_at` — three columns; see data-model.md). Because `db/index.js`
applies `schema.sql` via `CREATE TABLE IF NOT EXISTS`, which does not add columns to a
table that already exists from a prior run, `db/index.js` must also apply a small,
idempotent "add column if missing" step (checked via `PRAGMA table_info`) so a user's
existing `uplert.db` from feature 001 gains these columns automatically on next startup —
no separate migration command, per Constitution Principle II.

**Testing**: `node:test`, unchanged — new tests added under the existing
`tests/{contract,integration,unit}/` layout.

**Target Platform**: Windows 11, native Node.js process, single `npm start` command —
unchanged.

**Project Type**: Single-process web service — unchanged; this feature adds one new
route and extends two existing services, it does not change the architecture.

**Performance Goals**: Unchanged from feature 001 (untested aspirational target). Webhook
delivery adds at most one additional outbound HTTP call per check per poll tick, only on
an actual status transition — negligible relative to the existing poll itself.

**Constraints**: A webhook delivery attempt MUST NOT throw out of the poller and MUST NOT
delay or skip that check's own next scheduled poll beyond the time the delivery attempt
itself takes (it runs sequentially after the poll result is recorded, inside the same
`pollOneCheck` try block, before `poll_in_progress` is cleared — consistent with "a failed
webhook delivery does not affect polling," spec FR-010). A webhook URL MUST be re-validated
against the same destination-safety rule as check URLs at the moment of every delivery
attempt, not only when set (spec FR-003), mirroring feature 001's FR-019 precedent exactly.

**Scale/Scope**: Unchanged from feature 001 — personal-to-small-team scale. At most one
webhook delivery per check per transition; transitions are infrequent by nature (bounded
by real uptime/downtime events, not by polling frequency).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Native Windows Execution, No Lock-In | No change to how the app starts; still one `npm start` command, no new runtime prerequisite | PASS |
| II. SQLite Persistence, Created on First Run | New columns added via an idempotent startup step in `db/index.js` (checked via `PRAGMA table_info`, not a separate migration command) so both a fresh database and an existing one from feature 001 end up with the same schema automatically | PASS |
| III. Per-User Data Isolation, Enforced Server-Side | The new `PATCH /api/checks/:id` handler reuses the exact same `getSessionUser` + ownership-check pattern already used by `GET`/`POST`/`DELETE /api/checks` — no new authorization mechanism introduced | PASS |
| IV. Test-Backed Requirements (NON-NEGOTIABLE) | Every FR-00x in spec.md gets at least one `node:test` case; full suite (existing 48 + new) must pass before any task is marked complete | PASS (enforced in tasks.md / implement) |
| V. Secure Credential & Session Handling | Not implicated — webhook URLs and delivery outcomes are not credential material under this principle's definition; no session/password code is touched | PASS |
| VI. Minimal Dependencies | Zero third-party npm packages added; webhook delivery reuses `fetch`, `AbortController`, and `url-safety.js` exactly as the poller already does | PASS — exceeds the bar |
| Technology Constraints | No new prerequisite, no new optional external integration requiring graceful degradation (a webhook URL is user-supplied per-check configuration, not an app-level external service dependency) | PASS |
| Quality Gates | Procedural — enforced during `/speckit-tasks` (test mapping) and `/speckit-implement` (full-suite-pass-before-complete) | Will be enforced downstream |

No violations. **Complexity Tracking is not applicable** — no principle required an
exception, and no new table/service/project was introduced beyond what the feature
itself requires.

*Post-Phase-1 re-check*: `data-model.md` (three nullable columns on the existing `checks`
row, no new entity, idempotent column-add step for existing databases) and
`contracts/api.md` (the new `PATCH /api/checks/:id` reuses the identical
session-derived-ownership and identical-404 pattern as the existing `DELETE`) confirm the
design still satisfies every row above — no new violations introduced during Phase 1
design.

## Project Structure

### Documentation (this feature)

```text
specs/002-webhook-alerting/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
# Single project (unchanged from feature 001) — this feature extends existing files and
# adds exactly one new service file; no new top-level directories.
src/
├── server.js             # EXTEND: body-parsing already covers POST/PUT — add PATCH to that same check so the new endpoint's JSON body is read
├── db/
│   ├── schema.sql          # EXTEND: checks table gains webhook_url, webhook_last_outcome, webhook_last_attempted_at columns (new databases)
│   └── index.js             # EXTEND: idempotent "add column if missing" step for existing databases (Constitution Principle II)
├── routes/
│   └── checks.js            # EXTEND: add PATCH /api/checks/:id (get/set/clear webhook URL), reusing the existing session+ownership pattern
├── services/
│   ├── check-service.js      # EXTEND: export the existing isValidHttpUrl check so webhook-service.js can reuse it; add updateCheckWebhook(db, userId, checkId, webhookUrl)
│   ├── uptime-service.js     # EXTEND: buildCheckView() gains webhookUrl / webhookLastDeliveryStatus / webhookLastDeliveryAt fields
│   ├── poller.js              # EXTEND: after recording a poll result, detect an up↔down transition and call webhook-service for checks with a webhook URL set
│   └── webhook-service.js     # NEW: validateWebhookUrl (reuses check-service's URL-syntax check), sendWebhookAlert (destination re-check via url-safety.js, POST with the same timeout pattern as poller.js, records outcome — never throws)
└── public/
    └── dashboard.js          # EXTEND: add/clear a webhook URL per check; show the most recent delivery outcome/timestamp per check

tests/
├── contract/              # EXTEND: checks-create/checks-list get new assertions for the webhook fields; NEW checks-webhook.test.js for PATCH /api/checks/:id
├── integration/           # NEW: webhook-delivery.test.js (fires on transition, not on repeat, not on first poll, failure doesn't affect polling/status); EXTEND poller-url-safety-style coverage for webhook destination re-checking
└── unit/                  # EXTEND: url-safety reuse is implicitly covered by existing url-safety.test.js; NEW assertions for webhook payload shape if isolated as a pure function
```

**Structure Decision**: Still a single project (Option 1, unchanged from feature 001) —
this feature is additive within the existing structure. Exactly one new file
(`src/services/webhook-service.js`) is introduced; every other touch-point is an
extension of a file feature 001 already created, per the user's explicit direction to
reuse the existing poller, data store, and authorization checks rather than building
parallel infrastructure.

## Complexity Tracking

> No entries — the Constitution Check above recorded no violations requiring justification.
