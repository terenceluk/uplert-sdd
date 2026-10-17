# Implementation Plan: Personal Uptime Monitor

**Branch**: `001-uptime-monitor` | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-uptime-monitor/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Uplert is a single-process Node.js web application: users register and sign in, add HTTP
checks (URL, display name, 1-minute-to-24-hour polling interval), and watch a dashboard of
current up/down status, 24-hour uptime percentage, and recent response times. An in-process
interval-timer poller GET-requests every due check with a 10-second timeout, classifies it
up/down, and records the result in SQLite — refusing to poll (and recording "down" for) any
check whose URL resolves to a private, loopback, link-local, or metadata address, re-checked
on every poll (FR-019). Deleting a check cascades to its history. The first registered
account is the administrator, who can see a user/check-count roster but never another
user's check details. Sign-in failures are uniform regardless of whether the login exists
(FR-003a); sessions are stored hashed, expire after a fixed period of inactivity, and their
cookie is always `HttpOnly` + `SameSite=Strict` (Constitution Principle V, amended v1.1.0).
The entire app — API, static dashboard, and poller — runs from one Node.js process with
zero third-party npm dependencies, using only Node's built-in `http`, `node:sqlite`,
`node:crypto`, and `node:test` modules, so it starts with one command on a plain Windows 11
install.

## Technical Context

**Language/Version**: Node.js 22 LTS or later (minimum 22.5.0, the first version shipping
the built-in `node:sqlite` module)

**Primary Dependencies**: None (zero third-party npm packages). Built on Node.js core
modules only: `node:http` (server + routing), `node:sqlite` (storage), `node:crypto`
(password hashing via scrypt, session token generation), `node:test` + `node:assert`
(testing), global `fetch` (outbound polling of monitored endpoints).

**Storage**: SQLite via `node:sqlite`, a single file created automatically on first run if
absent, with schema applied via an idempotent startup migration.

**Testing**: `node:test` (Node's built-in test runner) run via `node --test`; integration
tests drive the real HTTP server with global `fetch` against an ephemeral SQLite file (no
mocking of storage).

**Target Platform**: Windows 11, native Node.js process (no Docker/WSL/VM), started with a
single `npm start` command.

**Project Type**: Single-process web service (API + server-rendered-free static dashboard +
background poller, all in one Node.js process).

**Performance Goals**: Dashboard view responds in well under 1 second for a user with up to
a few hundred checks — this is an aspirational target carried from planning and is **not**
verified by an automated test in this version (see tasks.md Notes); the poller services
every due check without a check falling more than one of its own intervals behind schedule
(per spec SC-002, which *is* test-backed — see T020/T022).

**Constraints**: Poller MUST run in the same process as the API on an interval timer (per
user direction) and MUST NOT block the HTTP event loop — outbound polls run as concurrent,
non-blocking `fetch` calls with a 10-second timeout (spec Clarifications) and skip a due
slot rather than overlap with their own still-running poll (spec FR-006). Every poll MUST
resolve the check's URL and refuse to proceed if the resolved address is private, loopback,
link-local, or a metadata address, re-checked on every poll, not cached from creation (spec
FR-019). All user-data access MUST be authorized server-side from the session, never from
client-supplied IDs (Constitution Principle III). Session tokens MUST be stored only as a
hash, expire after a fixed period of inactivity, and ride on an `HttpOnly` +
`SameSite=Strict` cookie (Constitution Principle V, amended v1.1.0).

**Scale/Scope**: Personal-to-small-team scale: expected tens of users at most, each with up
to perhaps a few dozen checks, polled no more often than once per minute — not a
multi-tenant SaaS workload.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Native Windows Execution, No Lock-In | Single Node.js process, started with `npm start`; no Docker/WSL/VM; no paid or signup-gated service used anywhere in this feature | PASS |
| II. SQLite Persistence, Created on First Run | `node:sqlite` file created and schema-migrated automatically at startup if missing; no separate provisioning step | PASS |
| III. Per-User Data Isolation, Enforced Server-Side | Every checks/poll-results/admin handler re-derives the acting user from the server-side session and filters/authorizes by that identity, never by a client-supplied user or check ID alone | PASS (enforced in contracts, Phase 1) |
| IV. Test-Backed Requirements (NON-NEGOTIABLE) | Every FR-00x gets at least one `node:test` case under `tests/`; `node --test` must pass in full before any task is marked complete | PASS (enforced in tasks.md / implement) |
| V. Secure Credential & Session Handling | Passwords hashed with `node:crypto.scrypt` (adaptive, salted); session tokens stored only as a `sha256` hash, never plaintext; sessions expire after a fixed inactivity window; session cookie always `HttpOnly` + `SameSite=Strict`; no password, hash, or token value ever passed to a log call | PASS (data-model.md and research.md §4 updated to match the v1.1.0 amendment) |
| VI. Minimal Dependencies | Zero third-party npm packages; every capability (HTTP server, SQLite, hashing, sessions, polling, testing) is met by Node.js core | PASS — exceeds the bar |
| Technology Constraints | Run command (`npm start`) documented in README; works on a clean Windows 11 box with only Node.js installed; no optional external integrations in this feature | PASS |
| Quality Gates | Procedural — enforced during `/speckit-tasks` (test mapping) and `/speckit-implement` (full-suite-pass-before-complete) | Will be enforced downstream |

No violations. **Complexity Tracking is not applicable** — no principle required an exception.

*Post-Phase-1 re-check*: `data-model.md` (cascading deletes, session table keyed off the
server-side cookie, no client-trusted IDs) and `contracts/api.md` (every check/admin
endpoint re-derives identity from the session and the admin roster query never selects
another user's check columns) confirm the design still satisfies every row above — no new
violations were introduced during Phase 1 design.

*Re-check after constitution amendment v1.1.0 and spec clarifications (FR-003a, FR-019)*:
`research.md` §4 and `data-model.md`'s `Session` entity were revised so the stored token is
a hash (not the raw value), a session carries a `last_seen_at` timestamp checked against a
fixed inactivity window, and the cookie is `SameSite=Strict`. `contracts/api.md`'s
`/api/register` and `/api/login` entries were revised to state the FR-003a tradeoff
explicitly, and a new `url-safety` check (research.md §9) was added ahead of check creation
and every poll to satisfy FR-019. Still PASS on every principle; no violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/001-uptime-monitor/
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
# Single project: one Node.js process serving the API, the static dashboard, and the poller.
src/
├── server.js            # Entry point: builds the HTTP server, wires routes, starts the poller, listens
├── db/
│   ├── schema.sql        # CREATE TABLE statements (users, checks, poll_results, sessions)
│   └── index.js           # Opens the SQLite file (creating it if absent) and applies schema.sql idempotently
├── routes/
│   ├── auth.js             # POST /api/register, POST /api/login, POST /api/logout
│   ├── checks.js           # GET/POST /api/checks, DELETE /api/checks/:id
│   ├── admin.js            # GET /api/admin/users
│   └── static.js           # Serves public/ for the dashboard shell
├── services/
│   ├── auth-service.js      # scrypt password hashing, hashed session issuance/validation + inactivity expiry
│   ├── check-service.js     # Ownership-checked CRUD over checks
│   ├── uptime-service.js    # 24h uptime % and recent-response-time derivation from poll_results
│   ├── url-safety.js         # Resolves a check's URL and rejects private/loopback/link-local/metadata addresses (FR-019); used at check creation and before every poll
│   └── poller.js             # Interval-timer loop: finds due checks, re-validates via url-safety, fetch()es them, records results
└── public/
    ├── index.html             # Dashboard shell (sign in / register / check list)
    ├── dashboard.js            # Vanilla JS: calls the API, renders status/uptime/response times
    └── styles.css

tests/
├── contract/              # One file per route group, asserting request/response shape + auth enforcement
├── integration/           # End-to-end flows: register→add check→poll→dashboard; delete cascade; cross-user isolation; admin roster
└── unit/                  # uptime-service math, URL/interval validation, poll up/down classification, scrypt round-trip, url-safety private/metadata-address detection, session hash + inactivity expiry
```

**Structure Decision**: Single project (Option 1) — there is no separate frontend build; the
dashboard is static HTML/CSS/vanilla JS served directly from `src/public/` by the same
`node:http` server that serves the JSON API, and the poller runs as an in-process interval
timer started alongside that server. This is the simplest structure that satisfies the
constitution's single-command, no-build-step constraint and the user's explicit "same
process" direction for both the dashboard and the poller.

## Complexity Tracking

> No entries — the Constitution Check above recorded no violations requiring justification.
