# Quickstart: Personal Uptime Monitor

Validates the feature end-to-end against the acceptance scenarios in `spec.md`. Assumes the
implementation described in `plan.md`/`data-model.md`/`contracts/api.md` exists.

## Prerequisites

- Windows 11 with Node.js 22 LTS or later installed (`node --version`).
- A clean checkout of this repository with no `uplert.db` file present yet (so first-run
  database creation can be observed).

## Setup

```powershell
npm start
```

This is the single command Constitution Principle I requires — no `npm install` step is
needed (or expected) first, since the project has zero dependencies (research.md Summary).

Expected: the process prints that it is listening (e.g., `Uplert listening on
http://localhost:3000`), and a new SQLite file (e.g., `uplert.db`) appears in the working
directory with no manual migration step (validates Constitution Principle II).

## Scenario 1 — Register, add a check, see it on the dashboard (User Story 1 / SC-001)

1. Open `http://localhost:3000` in a browser. Register with a login + password.
   - **Expect**: this is the first account ever created, so it becomes the administrator
     (FR-002) — but it can still add and see checks exactly like any other user.
2. Add a check: URL `https://example.com`, display name "Example", interval 1 minute.
   - **Expect**: it appears immediately on the dashboard with status "pending" (FR-004, no
     poll has run yet).
3. Wait slightly over one minute.
   - **Expect**: status becomes "up" (assuming `https://example.com` is reachable),
     uptime shows 100%, and one response time appears in "recent response times" (FR-006
     through FR-011, SC-002).

## Scenario 2 — A failing endpoint is recorded as down (User Story 1, edge case)

1. Add a second check pointing at a hostname that cannot resolve at all, e.g.
   `http://does-not-exist.invalid/` (the `.invalid` TLD is reserved by RFC 2606 to never
   resolve — a clean, unambiguous DNS-failure example, distinct from the FR-019 case in
   Scenario 3 below), interval 1 minute.
2. Wait slightly over one minute.
   - **Expect**: status becomes "down" (FR-008), and the uptime percentage for this check
     reflects that failure (0% if it's the only poll so far).

## Scenario 3 — Private/internal destinations are blocked (FR-019)

1. Attempt to add a check with URL `http://127.0.0.1:3000/` (loopback — the app's own
   address) or `http://192.168.1.1/` (RFC 1918 private range).
   - **Expect**: `400` from `POST /api/checks`; the check is never created (FR-019,
     resolved immediately at creation time).
2. (Optional, harder to stage) Add a check for a hostname that currently resolves
   publicly, let it poll successfully once, then point that hostname's DNS at a private
   address and wait for the next poll.
   - **Expect**: the next poll is blocked and recorded as "down," not silently skipped —
     FR-019 re-checks the resolved address on every poll, not only at creation.

## Scenario 4 — Delete a check removes its history (User Story 2 / SC-004)

1. Delete the "Example" check from Scenario 1.
   - **Expect**: it disappears from the dashboard immediately (`204` from
     `DELETE /api/checks/:id`).
2. Confirm via the database (or by re-adding a check with the same URL and checking its
   uptime starts fresh) that no poll history from the deleted check remains anywhere
   (FR-013).

## Scenario 5 — Cross-user isolation (User Story 1/2, SC-005)

1. Register a second account (`user2`). Confirm it is **not** an administrator (only the
   first-ever account is, FR-002). Also confirm registering `user2` again with the same
   login now returns `409` (FR-001) while a *login* attempt with a wrong password for an
   existing user, and a login attempt for a login that was never registered, both return
   the identical `401` response (FR-003a) — only registration reveals existence.
2. As `user2`, add a check of their own.
3. As `user2`, call `GET /api/checks` and confirm only `user2`'s check is returned — never
   the first user's checks.
4. As `user2`, attempt `DELETE /api/checks/:id` using the first user's check ID (found via
   its earlier `201` response, if still on hand).
   - **Expect**: `404`, and the first user's check is unaffected (FR-012, FR-014).

## Scenario 6 — Administrator roster without visibility into other users' checks (User Story 3 / SC-006)

1. As the first-registered (administrator) account, call `GET /api/admin/users`.
   - **Expect**: both registered users appear with accurate `checkCount` values, and no
     field in the response includes a URL, status, or poll history for `user2`'s checks
     (FR-015, FR-016).
2. As `user2`, call `GET /api/admin/users`.
   - **Expect**: `403` (FR-017).

## Scenario 7 — Session handling (Constitution Principle V, amended v1.1.0)

1. After logging in (Scenario 1), inspect the `Set-Cookie` header from `POST /api/login`.
   - **Expect**: `HttpOnly` and `SameSite=Strict` are both present; inspecting the SQLite
     `sessions` table directly shows only `token_hash`, never the raw cookie value.
2. Leave the session idle past the configured inactivity window (see `auth-service.js` for
   the exact duration), then call `GET /api/checks` with the same cookie.
   - **Expect**: `401`, identical to having no cookie at all, and the corresponding
     `sessions` row is gone on the next check.

## Running the automated test suite

```powershell
npm test
```

**Expect**: every scenario above has a corresponding automated test under `tests/contract/`
or `tests/integration/`, and the full suite passes — this is the gate `/speckit-implement`
enforces before any task can be marked complete (Constitution Principle IV).
