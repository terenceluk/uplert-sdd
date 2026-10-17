---

description: "Task list for Personal Uptime Monitor (Uplert)"
---

# Tasks: Personal Uptime Monitor

**Input**: Design documents from `/specs/001-uptime-monitor/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md (all present)

**Tests**: Constitution Principle IV (NON-NEGOTIABLE) requires at least one automated test
per functional requirement, and requires the full `node --test` suite to pass before any
task is marked complete — so test tasks below are mandatory, not optional, and are included
throughout.

**Organization**: Tasks are grouped by user story (from spec.md) to enable independent
implementation and testing of each story, after a Setup and Foundational phase that every
story depends on (registration/login, storage, and the HTTP server itself).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3) — Setup, Foundational,
  and Polish tasks carry no story label
- Every task names its exact file path(s)

## Path Conventions

Single project (per plan.md Structure Decision): `src/` and `tests/` at the repository
root. No frontend/backend split — one Node.js process serves the API, the static
dashboard, and the poller.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create the project directory structure per plan.md: `src/db/`, `src/routes/`,
  `src/services/`, `src/public/`, `tests/contract/`, `tests/integration/`, `tests/unit/`
- [X] T002 Create `package.json` at the repo root: `"type": "module"`,
  `"engines": { "node": ">=22.5.0" }` (research.md §1 — minimum version shipping
  `node:sqlite`), `"scripts": { "start": "node src/server.js", "test": "node --test" }`,
  and no `dependencies`/`devDependencies` entries at all (Constitution Principle VI;
  research.md Summary: "zero entries... zero in devDependencies")
- [X] T003 [P] Create `README.md` documenting the single `npm start` command, the Node.js
  22.5+ prerequisite, the expected `node:sqlite` experimental-module startup warning
  (research.md §1 Risk/mitigation), and that `uplert.db` is created automatically on first
  run with no separate migration step (Constitution Principle II)
- [X] T004 [P] Create `.gitignore` at the repo root excluding `node_modules/` and `*.db`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Storage, authentication, and the HTTP server itself — every user story's
acceptance scenarios begin "Given a signed-in user," so registration/login/sessions and
the server/router must exist before any story can be built or tested.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 Create `src/db/schema.sql` with exactly these four tables and constraints, taken
  verbatim from data-model.md:
  - `users`: `id INTEGER PRIMARY KEY AUTOINCREMENT`;
    `login TEXT UNIQUE NOT NULL CHECK(length(login) <= 254)` ("Email or username (FR-001);
    max 254 characters"); `password_hash TEXT NOT NULL`; `password_salt TEXT NOT NULL`;
    `role TEXT NOT NULL CHECK(role IN ('admin','user'))` ("Set once at creation (FR-002);
    never changes in this version"); `created_at TEXT NOT NULL` — note: the input
    `password` itself (max 1024 characters, FR-001) is validated at the application layer
    before hashing, not via a column constraint, since only its hash is ever stored
  - `checks`: `id INTEGER PRIMARY KEY AUTOINCREMENT`;
    `user_id INTEGER NOT NULL REFERENCES users(id)`;
    `url TEXT NOT NULL CHECK(length(url) <= 2048)` ("max 2048 characters, FR-005");
    `display_name TEXT NOT NULL CHECK(length(display_name) <= 100)` ("max 100 characters,
    FR-005"); `interval_seconds INTEGER NOT NULL CHECK(interval_seconds BETWEEN 60 AND 86400)`
    ("60–86400 inclusive (1 minute to 24 hours; FR-004/FR-005)"); `created_at TEXT NOT NULL`;
    `last_polled_at TEXT` (nullable — "Null until the first poll completes");
    `poll_in_progress INTEGER NOT NULL DEFAULT 0`
  - `poll_results`: `id INTEGER PRIMARY KEY AUTOINCREMENT`;
    `check_id INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE`;
    `status_code INTEGER` (nullable — "null if the request failed/timed out");
    `is_up INTEGER NOT NULL`; `response_time_ms INTEGER NOT NULL`;
    `polled_at TEXT NOT NULL`; plus an index on `(check_id, polled_at)`
    ("to make 'last 24 hours' and 'most recent N' queries... efficient")
  - `sessions`: `token_hash TEXT PRIMARY KEY` ("never in plaintext"... "the raw value is
    sent to the client... and never stored"); `user_id INTEGER NOT NULL REFERENCES users(id)
    ON DELETE CASCADE`; `created_at TEXT NOT NULL`; `last_seen_at TEXT NOT NULL`
- [X] T006 Create `src/db/index.js`: opens the SQLite file via `node:sqlite`'s
  `DatabaseSync` (creating it automatically if absent — Constitution Principle II) and
  applies `schema.sql` idempotently (`CREATE TABLE IF NOT EXISTS`) on every startup
  (depends on T005)
- [X] T007 [P] Create `src/services/auth-service.js`: `hashPassword`/`verifyPassword` using
  `node:crypto.scrypt` with a random per-user salt (research.md §3, Constitution Principle
  V); `createSession(userId)` generating `crypto.randomBytes(32)`, storing only
  `sha256(token)` as `token_hash` with `created_at`/`last_seen_at` — "the raw value is sent
  to the client... and never stored" (data-model.md §Session); `validateSession(rawToken)`
  that hashes the incoming token, looks it up, rejects and deletes the row if
  `last_seen_at` exceeds a fixed inactivity window, otherwise refreshes `last_seen_at`
  (Constitution Principle V, v1.1.0) (depends on T006)
- [X] T008 [P] Create `src/services/url-safety.js`: resolves a hostname via
  `dns.promises.lookup()` and rejects if the resolved address is private (RFC 1918:
  `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `::1`),
  link-local (`169.254.0.0/16`, `fe80::/10`), or another non-publicly-routable/metadata
  address such as `169.254.169.254` (FR-019; research.md §9) — pure function, no DB
  dependency
- [X] T009 [P] Create `src/server.js`: a `node:http` server with a minimal method+path
  router, cookie parse/set helpers, and static file serving for any non-`/api/*` path from
  `src/public/` (contracts/api.md §Static dashboard) (depends on T006)
- [X] T010 Create `src/routes/auth.js` implementing, per contracts/api.md: `POST
  /api/register` (FR-001 — 409 "login already taken" is an accepted, documented exception
  to the no-enumeration posture, applying only here; FR-002 — the very first row ever
  inserted into `users` gets `role = 'admin'`, every later one `'user'`); `POST /api/login`
  (FR-003 — `Set-Cookie: session=<raw token>; HttpOnly; SameSite=Strict`; FR-003a —
  byte-identical 401 status/body for an unknown login and a correct login with wrong
  password); `POST /api/logout` (deletes the session row). Register these routes in
  `src/server.js`'s router (depends on T007, T009)
- [X] T011 [P] Contract test for `POST /api/register` in `tests/contract/register.test.js`:
  201 with `role: "admin"` for the first-ever account and `role: "user"` for the next one
  (FR-002); 409 for a duplicate `login` (FR-001); 400 for missing/empty `login` or
  `password` (FR-001); 400 for a 255-character `login` or a 1025-character `password`,
  201 for a 254-character `login` and a 1024-character `password` (FR-001)
- [X] T012 [P] Contract test for `POST /api/login` and `POST /api/logout` in
  `tests/contract/login.test.js`: 200 with a `Set-Cookie` containing `HttpOnly` and
  `SameSite=Strict` on success; identical 401 status and body for an unknown login versus
  a correct login with the wrong password (FR-003a); 204 and session-row deletion on
  logout
- [X] T013 [P] Unit test for session hashing and inactivity expiry in
  `tests/unit/auth-service.test.js`: the `sessions` table never contains the raw token,
  only its `sha256` hash (Constitution Principle V); a session whose `last_seen_at` exceeds
  the configured inactivity window is rejected by `validateSession` and removed
  (data-model.md §Session)
- [X] T014 [P] Unit test for `url-safety` range detection in
  `tests/unit/url-safety.test.js`: rejects `127.0.0.1`, `10.0.0.1`, `192.168.1.1`,
  `172.16.0.5`, `169.254.169.254`, `::1`, and `fe80::1`; accepts a public address (FR-019)
- [X] T015 [P] Integration test for session cookie attributes against the live server in
  `tests/integration/session-cookie.test.js`: starts the real HTTP server against an
  ephemeral SQLite file, registers and logs in a user, and asserts the raw `Set-Cookie`
  header contains both `HttpOnly` and `SameSite=Strict` (quickstart.md Scenario 7)

**Checkpoint**: Foundation ready — registration, login, sessions, storage, and the HTTP
server all exist and are tested; user story implementation can now begin.

---

## Phase 3: User Story 1 - Monitor an endpoint from a dashboard (Priority: P1) 🎯 MVP

**Goal**: A signed-in user adds an HTTP check (URL, display name, 1-minute-to-24-hour
interval); an in-process poller GET-requests it on schedule and records status
code/response time/timestamp; the dashboard shows current up/down status, 24-hour uptime
percentage, and recent response times.

**Independent Test**: Sign in, add one check against a known endpoint, wait for at least
one poll, and confirm `GET /api/checks` (and the dashboard) shows an up/down status, a
24-hour uptime percentage, and recent response times for that check.

### Tests for User Story 1

> Write these tests FIRST, ensure they FAIL before implementation (Constitution Principle
> IV; all run via `node --test` as part of the one full suite)

- [X] T016 [P] [US1] Contract test for `POST /api/checks` in
  `tests/contract/checks-create.test.js`: 201 with `status: "pending"` and an empty
  `recentResponseTimesMs` for a valid check (FR-004); 400 for a non-`http(s)` URL; 400 for
  `intervalSeconds` of 59 or 86401, 201 for exactly 60 and exactly 86400 — "60–86400
  inclusive" (FR-005); 400 when the URL's hostname resolves to a private/loopback/
  link-local/metadata address (FR-019); 400 for a 2049-character `url` or a 101-character
  `displayName`, 201 for a 2048-character `url` and a 100-character `displayName` (FR-005)
- [X] T017 [P] [US1] Contract test for `GET /api/checks` in
  `tests/contract/checks-list.test.js`: response items include `id`, `url`, `displayName`,
  `intervalSeconds`, `status`, `uptimePercent24h`, `recentResponseTimesMs`
  (contracts/api.md); only the caller's own checks are ever returned (FR-014)
- [X] T018 [P] [US1] Unit test for poll up/down classification in
  `tests/unit/poll-classification.test.js`: status codes 200 and 399 classify "up" when
  the full response body is read within 10,000ms of connection start; status 400 classifies
  "down"; a response whose status/headers arrive quickly but whose body finishes reading
  after 10,000ms (measured from connection start, not time-to-first-byte) also classifies
  "down" (FR-008)
- [X] T019 [P] [US1] Unit test for uptime-service derived values in
  `tests/unit/uptime-service.test.js`: 24-hour uptime percentage is computed only from
  `PollResult` rows at/after `max(check.created_at, now - 24h)` (FR-010); "recent response
  times" returns the most recent 20 rows' `response_time_ms`, newest first (FR-011; spec
  Assumptions)
- [X] T020 [P] [US1] Integration test for due-check overlap handling in
  `tests/integration/poller-scheduling.test.js`: a check whose poll is still in progress is
  skipped on its next due tick and is re-polled one interval after the in-progress poll
  completes — never concurrently with itself (FR-006)
- [X] T021 [P] [US1] Integration test for poll request shape in
  `tests/integration/poller-request-shape.test.js`: against a local test HTTP server
  standing in for the monitored endpoint, asserts the poller sends a GET request with no
  custom headers, request body, or Authorization header (FR-006a)
- [X] T022 [P] [US1] Integration test for the end-to-end monitor flow in
  `tests/integration/monitor-flow.test.js`: register, add a check against a local test
  server, wait for a poll, and assert `GET /api/checks` reflects status "up"/"down",
  `uptimePercent24h`, and `recentResponseTimesMs` (quickstart.md Scenarios 1–2; FR-006,
  FR-007, FR-009, SC-002)
- [X] T023 [P] [US1] Integration test for URL-safety re-checking at poll time in
  `tests/integration/poller-url-safety.test.js`: a check whose resolved address changes to
  a private range after creation is blocked on its next poll and recorded "down," not
  silently skipped (FR-019; quickstart.md Scenario 3 step 2)

### Implementation for User Story 1

- [X] T024 [P] [US1] Implement `src/services/check-service.js`: `createCheck(userId, url,
  displayName, intervalSeconds)` validating URL syntax and the 60–86400-inclusive interval
  range (FR-004, FR-005), calling `url-safety` before insert and rejecting if unsafe
  (FR-019); `listChecksForUser(userId)` joining each check's latest `PollResult` (depends
  on T006, T008)
- [X] T025 [P] [US1] Implement `src/services/uptime-service.js`: `computeStatus(check)` →
  `"up" | "down" | "pending"` from the latest `PollResult` (FR-009);
  `computeUptimePercent24h(checkId)` and `recentResponseTimes(checkId, limit = 20)` per
  data-model.md Derived values (FR-010, FR-011) (depends on T006)
- [X] T026 [P] [US1] Implement `src/services/poller.js`: a `setInterval` tick that selects
  due checks (`last_polled_at IS NULL OR last_polled_at + interval_seconds <= now`, AND
  `poll_in_progress = 0`), sets `poll_in_progress = 1`, re-validates the URL via
  `url-safety` (FR-019), issues a GET-only `fetch` with a single 10-second
  `AbortController` timeout started at connection initiation and covering the entire
  request — connect through fully reading the response body, not just time-to-first-byte
  (FR-006a, FR-008; research.md §6) — records `status_code`/`response_time_ms`/`polled_at`/`is_up`
  into `poll_results`, and clears `poll_in_progress` (FR-006, FR-007) (depends on T006,
  T008)
- [X] T027 [US1] Implement `src/routes/checks.js`: `GET /api/checks` and `POST
  /api/checks` per contracts/api.md, requiring a valid session (via `auth-service`) and
  using `check-service`/`uptime-service`; register in `src/server.js`'s router (depends on
  T009, T010, T024, T025)
- [X] T028 [P] [US1] Start the poller from `src/server.js` alongside the HTTP listener, in
  the same process (user direction: "same process on an interval timer") (depends on T026,
  T027)
- [X] T029 [P] [US1] Implement `src/public/index.html`, `dashboard.js`, `styles.css`:
  sign-in/register forms, an "add check" form (URL, display name, interval), and a check
  list rendering status/uptime/response times from `GET /api/checks`, posting new checks
  to `POST /api/checks` (depends on T010, T027)

**Checkpoint**: User Story 1 is fully functional and independently testable (MVP).

---

## Phase 4: User Story 2 - Remove a check and its history (Priority: P2)

**Goal**: A signed-in user deletes a check they own, and both the check and all of its
poll history disappear immediately and permanently.

**Independent Test**: Add a check, let it accumulate at least one poll result, delete it,
and confirm it no longer appears on the dashboard and that no poll history for it remains
anywhere.

### Tests for User Story 2

- [X] T030 [P] [US2] Contract test for `DELETE /api/checks/:id` in
  `tests/contract/checks-delete.test.js`: 204, and the check is absent from a subsequent
  `GET /api/checks` for its owner (FR-012); identical 404 when the id doesn't exist or
  belongs to another user (FR-014)
- [X] T031 [P] [US2] Integration test for cascade history deletion in
  `tests/integration/delete-cascade.test.js`: a check with recorded `poll_results` is
  deleted, and no `poll_results` row referencing that `check_id` remains afterward (FR-013)

### Implementation for User Story 2

- [X] T032 [US2] Add `deleteCheck(userId, checkId)` to `src/services/check-service.js`:
  relies on the schema's `ON DELETE CASCADE` for history removal (FR-013) and returns an
  identical "not found" outcome whether the check doesn't exist or isn't owned by `userId`
  (FR-014) (depends on T024)
- [X] T033 [US2] Implement `DELETE /api/checks/:id` in `src/routes/checks.js` per
  contracts/api.md, requiring a valid session and re-deriving ownership from it, never
  from the URL alone (FR-012, FR-014) (depends on T027, T032)
- [X] T034 [US2] Add a delete control to each check row in `src/public/dashboard.js`
  calling `DELETE /api/checks/:id` and removing it from the rendered list on success
  (depends on T029, T033)

**Checkpoint**: User Stories 1 and 2 both independently functional.

---

## Phase 5: User Story 3 - Administrator oversight of users (Priority: P3)

**Goal**: The administrator views every registered user and their check count, without
being able to see any other user's individual check details, statuses, or history.

**Independent Test**: Sign in as the administrator, view the user list, confirm it shows
every registered user with an accurate check count, and confirm no field exposes another
user's check URLs, statuses, or history; confirm a non-administrator is denied access.

### Tests for User Story 3

- [X] T035 [P] [US3] Contract test for `GET /api/admin/users` in
  `tests/contract/admin.test.js`: 200 with every registered user's `id`/`login`/`role`/
  `checkCount` for an admin caller (FR-015); response objects contain no check-level field
  — no url, status, or history (FR-016); 403 for a signed-in non-admin; 401 for no session
  (FR-017)

### Implementation for User Story 3

- [X] T036 [US3] Implement an admin-roster query in `src/services/check-service.js`:
  selects every user with `COUNT(*)` of their checks, selecting no `poll_results` columns
  and no per-check `checks` columns beyond the count (FR-015, FR-016) (depends on T006)
- [X] T037 [US3] Implement `src/routes/admin.js`: `GET /api/admin/users` requiring a valid
  session with `role = "admin"` (403 otherwise, 401 if unauthenticated) per
  contracts/api.md; register in `src/server.js`'s router (FR-015, FR-016, FR-017) (depends
  on T009, T010, T036)
- [X] T038 [US3] Add an admin-only roster view to `src/public/dashboard.js`, shown only
  when the signed-in user's role is `"admin"`, rendering login/role/checkCount per user
  from `GET /api/admin/users` (depends on T029, T037)

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification against the constitution's Quality Gates before this
feature is considered complete.

- [X] T039 [P] Run the full automated suite (`node --test`) and confirm every FR in
  spec.md — FR-001 through FR-019 **including the lettered FR-003a and FR-006a**, but
  excluding the scope-exclusion statement FR-018 — has at least one passing test; fix any
  gap found (Constitution Principle IV)
- [X] T040 [P] Execute quickstart.md Scenarios 1–7 by hand against a clean `npm start` on
  Windows 11 and confirm every "Expect" outcome (Constitution Technology Constraints)
- [X] T041 Review every checks/admin/poller code path against Constitution Quality Gates
  items 3–4: server-side authorization re-derived from the session on every request
  (never from a client-supplied id/role); adaptive password hashing and hashed-at-rest
  session storage in place; inactivity expiry enforced; session cookies `HttpOnly` +
  `SameSite=Strict`; no password, hash, or token value reaching any log call. Fix any gap
  found.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational completion; proceed in priority
  order (P1 → P2 → P3) or in parallel across team members once Foundational is done.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on Foundational. No dependency on US2/US3.
- **User Story 2 (P2)**: Depends on Foundational and on `check-service.js` existing from
  US1 (T024) to add `deleteCheck` to, but is independently testable once added.
- **User Story 3 (P3)**: Depends only on Foundational (reads `users`/`checks` directly);
  no functional dependency on US1/US2, though it is most meaningful once other users have
  checks to count.

### Within Each Phase

- Within each **user story** phase (3–5), tests are written first and must fail before
  their implementation task (Constitution Principle IV; TDD convention). Foundational
  (Phase 2) is the one exception by necessity: there is no independently testable surface
  for registration/sessions/the server until that infrastructure exists, so T005–T010
  build it and T011–T015 verify it immediately after — still fully test-backed per
  Constitution Principle IV, just not test-first within this one phase.
- Services before routes; routes before the dashboard UI that calls them.
- **The full `node --test` suite MUST pass before any task in this file is marked
  complete** (Constitution Quality Gates item 2) — not only at Phase 6, but after every
  task.

### Parallel Opportunities

- Setup: T003, T004 in parallel.
- Foundational: T007, T008, T009 in parallel (after T006); T011–T015 in parallel (after
  T010).
- User Story 1: all of T016–T023 (tests) in parallel; T024, T025, T026 in parallel; T028,
  T029 in parallel (after T027).
- User Story 2 and User Story 3 tests/implementation can proceed in parallel with each
  other once Foundational is done, by different team members, even though this list
  orders them sequentially by priority.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Contract test for POST /api/checks in tests/contract/checks-create.test.js"
Task: "Contract test for GET /api/checks in tests/contract/checks-list.test.js"
Task: "Unit test for poll up/down classification in tests/unit/poll-classification.test.js"
Task: "Unit test for uptime-service derived values in tests/unit/uptime-service.test.js"
Task: "Integration test for due-check overlap handling in tests/integration/poller-scheduling.test.js"
Task: "Integration test for poll request shape in tests/integration/poller-request-shape.test.js"
Task: "Integration test for the end-to-end monitor flow in tests/integration/monitor-flow.test.js"
Task: "Integration test for URL-safety re-checking at poll time in tests/integration/poller-url-safety.test.js"

# Launch the independent services for User Story 1 together:
Task: "Implement src/services/check-service.js"
Task: "Implement src/services/uptime-service.js"
Task: "Implement src/services/poller.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run `node --test` (full suite must pass) and quickstart.md
   Scenarios 1–3 by hand
5. This is a usable, demoable Uplert: sign in, monitor an endpoint, see it on a dashboard

### Incremental Delivery

1. Setup + Foundational → registration/login/sessions/server all tested and working
2. Add User Story 1 → test independently → MVP
3. Add User Story 2 → test independently → users can now clean up checks they no longer want
4. Add User Story 3 → test independently → the administrator can see overall usage
5. Phase 6 → full-suite + quickstart + constitution Quality-Gate review before calling the
   feature done

### Parallel Team Strategy

With multiple developers, once Foundational (Phase 2) is complete:

- Developer A: User Story 1 (the MVP, highest priority)
- Developer B: User Story 2 (once `check-service.js` from T024 exists)
- Developer C: User Story 3 (fully independent of US1/US2)

---

## Notes

- [P] tasks = different files, no dependency on an incomplete task
- [US1]/[US2]/[US3] labels map every Phase 3+ task to its user story for traceability back
  to spec.md
- Tests are mandatory here (Constitution Principle IV), not optional — within each user
  story phase (3–5), write them first and confirm they fail before implementing;
  Foundational (Phase 2) builds core infrastructure first and verifies it with tests
  immediately after, for the reason given in "Within Each Phase" above
- Per Constitution Quality Gates, **no task in this file is "complete" unless the full
  `node --test` suite passes**, including tests unrelated to that task
- FR-018 (explicit exclusion of alerting, public status pages, and scheduled report
  exports) has no corresponding test — it is a scope boundary, not a behavior to exercise
- plan.md's Performance Goal (dashboard response time well under 1 second for up to a few
  hundred checks) is an **untested, aspirational target** in this version — no task in
  this file verifies it with a load/timing test, and none should be inferred from its
  presence in plan.md
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently before moving on

---

## Phase 7: Convergence

**Purpose**: Close a gap found between plan.md's documented structure and the current
code, identified by `/speckit-converge` after `/speckit-implement` completed Phases 1–6.

- [X] T042 Extract the static dashboard file-serving logic out of `src/server.js`'s request
  handler into its own `src/routes/static.js` module, registered through the same
  `addRoute`/router mechanism (or an equivalent explicit hook) the other route modules
  use, so the codebase matches the file plan.md's Project Structure names
  (`src/routes/static.js # Serves public/ for the dashboard shell`) per plan: Project
  Structure (partial). No behavior change — `GET /` and every non-`/api/*` path must
  continue to serve `src/public/{index.html,dashboard.js,styles.css}` exactly as today,
  and the full `node --test` suite (48/48) must still pass.
