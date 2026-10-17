---

description: "Task list for Webhook Alerting (extends Uplert feature 001)"
---

# Tasks: Webhook Alerting

**Input**: Design documents from `/specs/002-webhook-alerting/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md (all present). This feature extends the already-implemented feature 001 (`specs/001-uptime-monitor/`) — most tasks below modify an existing file rather than create a new one.

**Tests**: Constitution Principle IV (NON-NEGOTIABLE) requires at least one automated test
per functional requirement, and requires the full `node --test` suite — feature 001's
existing 48 tests plus this feature's new ones — to pass before any task is marked
complete. Test tasks below are mandatory, not optional.

**Organization**: Tasks are grouped by user story (from spec.md), after a Setup phase
covering the one piece of infrastructure both stories depend on: the schema change and
its automatic upgrade path for an existing database.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2) — Setup and Polish tasks
  carry no story label
- Every task names its exact file path(s)

## Path Conventions

Single project (per plan.md Structure Decision, unchanged from feature 001): `src/` and
`tests/` at the repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The schema change both user stories depend on — US1 writes `webhook_url`
and the delivery-outcome columns; US2 reads them. Neither story can be built or tested
without this.

- [X] T001 Add three new nullable columns to the `checks` table definition in
  `src/db/schema.sql` (for brand-new databases), exactly as specified in data-model.md:
  `webhook_url TEXT CHECK(webhook_url IS NULL OR length(webhook_url) <= 2048)` ("Must be
  a syntactically valid http://` or `https://` URL of at most 2048 characters when set...
  NULL means no webhook is configured"); `webhook_last_outcome TEXT CHECK(webhook_last_outcome
  IS NULL OR webhook_last_outcome IN ('succeeded', 'failed'))` ("NULL until the first
  attempt ever happens for this check"); `webhook_last_attempted_at TEXT` (nullable —
  "NULL exactly when webhook_last_outcome is NULL")
- [X] T002 Implement an idempotent column-add step in `src/db/index.js`, run immediately
  after applying `schema.sql`: for each of the three column names from T001, query
  `PRAGMA table_info(checks)` and run `ALTER TABLE checks ADD COLUMN <name> <type>` only
  if that column is not already present, so an existing `uplert.db` created before this
  feature gains them automatically on next startup — no separate migration command
  (Constitution Principle II; research.md §2) (depends on T001)
- [X] T003 [P] Unit test for the migration step in `tests/unit/db-migration.test.js`:
  opening a database file whose `checks` table was created via the pre-feature-002 schema
  (missing the three webhook columns) results in `openDatabase()` adding them with the
  correct nullability; calling `openDatabase()` a second time against the now-upgraded
  file does not error (idempotent) (depends on T002)

**Checkpoint**: Schema ready — both user stories can now be built.

---

## Phase 2: User Story 1 - Get alerted when a check's status changes (Priority: P1) 🎯 MVP

**Goal**: A signed-in user sets a webhook URL on a check they own; when that check's
status genuinely flips between "up" and "down", Uplert sends exactly one HTTP POST
describing the change. Repeated same-state polls and a check's first-ever poll send
nothing. A failed delivery is recorded but never affects that check's own polling or
status.

**Independent Test**: Set a webhook URL on a check pointed at a known-failing endpoint
(via `PATCH /api/checks/:id`), let it flip from "up"/"pending" to "down", and confirm
exactly one HTTP POST arrives at the webhook URL with the expected fields; poll again in
the same state and confirm no second POST arrives.

### Tests for User Story 1

> Write these tests FIRST, ensure they FAIL before implementation (Constitution
> Principle IV)

- [X] T004 [P] [US1] Contract test for `PATCH /api/checks/:id` in
  `tests/contract/checks-webhook.test.js`: 200 with `webhookUrl` reflected in the
  response for a valid URL (FR-001); 200 with `webhookUrl: null` after clearing it
  (FR-002); 400 for a non-`http(s)` URL, for a 2049-character URL, and for a URL
  resolving to a private/loopback/link-local/metadata address (FR-003); identical 404
  whether `:id` doesn't exist or belongs to another user (FR-004)
- [X] T005 [P] [US1] Integration test for webhook delivery on real transitions in
  `tests/integration/webhook-delivery.test.js`: a check with a webhook URL set that
  flips from "up" to "down" (and, separately, "down" to "up") triggers exactly one POST
  to a local mock receiver with `displayName`, `url`, `state`, `statusCode`,
  `responseTimeMs`, and `changedAt` matching that poll, and the check's
  `webhook_last_outcome` is recorded `'succeeded'` (FR-005, FR-007, FR-008); a second
  poll in the same state sends no additional POST (FR-006); a check's very first poll
  (its "pending" → up/down transition) sends no POST (FR-006)
- [X] T006 [P] [US1] Integration test for delivery-failure isolation in
  `tests/integration/webhook-delivery-failure.test.js`: a check whose webhook URL points
  at an endpoint that refuses the connection has its delivery recorded as `'failed'`
  (FR-008), while that check's own next scheduled poll still runs on time and its
  displayed up/down status and uptime percentage are unaffected by the delivery failure
  (FR-010)
- [X] T007 [P] [US1] Integration test for destination-safety re-checking at delivery
  time in `tests/integration/webhook-url-safety.test.js`: a check whose webhook URL
  resolves to a private/loopback/link-local/metadata address at the moment of delivery
  (not necessarily at the moment it was set) is blocked and recorded `'failed'`, not
  silently skipped or sent anyway (FR-003)

### Implementation for User Story 1

- [X] T008 [P] [US1] Export the existing `isValidHttpUrl` function from
  `src/services/check-service.js` (currently module-private) so it can be reused for
  webhook URL syntax validation (research.md §6)
- [X] T009 [US1] Create `src/services/webhook-service.js`: `validateWebhookUrl(url)`
  reusing `isValidHttpUrl`/the 2048-character max from `check-service.js` and
  `isSafeToFetch` from `url-safety.js` (FR-003); `sendWebhookAlert(db, check, newStatus,
  statusCode, responseTimeMs, changedAt)` that re-validates destination safety, sends a
  `POST` with `Content-Type: application/json` and body `{displayName, url, state,
  statusCode, responseTimeMs, changedAt}` using the same `AbortController` + 10-second
  timeout pattern `poller.js` already uses, and writes `webhook_last_outcome`
  (`'succeeded'` on any response received before the timeout, `'failed'` on a network
  error, safety-check rejection, or timeout) and `webhook_last_attempted_at` onto the
  check row — this function MUST NOT throw under any failure (FR-007, FR-008, FR-010;
  research.md §5) (depends on T001, T002, T008)
- [X] T010 [US1] Add `updateCheckWebhook(db, userId, checkId, webhookUrl)` to
  `src/services/check-service.js`: ownership-checked identically to the existing
  `deleteCheck` (returns a not-found/not-owned signal the route maps to 404); when
  `webhookUrl` is non-null, validates it via `webhook-service.js`'s
  `validateWebhookUrl` and rejects with an error if invalid (FR-003); when `webhookUrl`
  is `null`, sets the `webhook_url` column to `NULL` only — `webhook_last_outcome`/
  `webhook_last_attempted_at` are left as stored (hiding them is a display-time concern,
  see T017) (FR-001, FR-002) (depends on T009)
- [X] T011 [US1] Implement `PATCH /api/checks/:id` in `src/routes/checks.js` per
  contracts/api.md: requires a valid session via the existing `getSessionUser` pattern
  (FR-004), calls `updateCheckWebhook`, returns the updated check view on success, `400`
  on a validation error, `404` on not-found-or-not-owned; register in `src/server.js`'s
  router (depends on T010, T013)
- [X] T012 [P] [US1] Extend `buildCheckView` in `src/services/uptime-service.js` to
  include a `webhookUrl` field sourced directly from the check row's `webhook_url`
  column (depends on T001)
- [X] T013 [P] [US1] Extend `src/server.js`'s request-body-reading condition (currently
  `req.method === 'POST' || req.method === 'PUT'`) to also include `'PATCH'`, so the new
  endpoint's JSON body is read the same way existing endpoints' bodies already are
- [X] T014 [P] [US1] Extend `src/services/poller.js`'s `pollOneCheck`: capture the
  check's status via `uptime-service.js`'s existing `computeStatus` *before* this poll's
  result is recorded; after recording it, if the "before" status was not `"pending"` and
  differs from the status this poll produced, and the check's `webhook_url` is
  currently set, call `webhook-service.js`'s `sendWebhookAlert` with this poll's
  `statusCode`/`responseTimeMs`/timestamp — sequenced before the `finally` block clears
  `poll_in_progress` (FR-005, FR-006; research.md §3, §4) (depends on T009)
- [X] T015 [P] [US1] Add a webhook URL field with a save/clear control to each check row
  in `src/public/dashboard.js`, calling `PATCH /api/checks/:id` (depends on T011)

**Checkpoint**: User Story 1 is fully functional and independently testable (MVP for
this feature).

---

## Phase 3: User Story 2 - See whether alerts are actually getting through (Priority: P2)

**Goal**: A signed-in user can see, for any of their checks with a webhook URL set,
whether the most recently attempted delivery succeeded or failed, and when.

**Independent Test**: Set a webhook URL on a check, force one successful delivery and
(separately, on another check) one failed delivery, and confirm the dashboard reflects
the correct outcome and timestamp for each — and that clearing a webhook URL hides its
prior outcome.

### Tests for User Story 2

- [X] T016 [P] [US2] Contract test for delivery-outcome visibility in
  `tests/contract/checks-webhook-status.test.js`: `webhookLastDeliveryStatus` and
  `webhookLastDeliveryAt` are both `null` when no webhook URL is set; both `null` when a
  webhook URL is set but has never had a delivery attempt; populated correctly after a
  successful or a failed attempt; both `null` again immediately after the webhook URL is
  cleared, even though a prior attempt's outcome is still stored (FR-009)

### Implementation for User Story 2

- [X] T017 [US2] Extend `buildCheckView` in `src/services/uptime-service.js`:
  `webhookLastDeliveryStatus` and `webhookLastDeliveryAt` are both `null` whenever
  `webhook_url` is `null` on that check (regardless of what is stored in the outcome
  columns), otherwise sourced from `webhook_last_outcome`/`webhook_last_attempted_at`
  (FR-009; data-model.md Derived values) (depends on T012)
- [X] T018 [US2] Add a delivery-outcome indicator to each check row that has a webhook
  URL set in `src/public/dashboard.js` (e.g. "Webhook: ✓ delivered `<time>`" / "✗ failed
  `<time>`"), reading the two fields from `GET /api/checks` (depends on T015, T017)

**Checkpoint**: Both user stories independently functional.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Final verification against the constitution's Quality Gates and this
feature's own scope before it is considered complete.

- [X] T019 [P] Run the full automated suite (`node --test`) and confirm every FR-00x in
  this feature's spec.md (FR-001 through FR-011, excluding the scope-exclusion statement
  FR-011's own listed exclusions) has at least one passing test; fix any gap found
  (Constitution Principle IV)
- [X] T020 [P] Execute this feature's quickstart.md Scenarios 1–5 by hand against a
  clean `npm start` — once against a brand-new `uplert.db`, and once against an existing
  `uplert.db` carried over from before this feature, to confirm the column-add migration
  (T002) works on both (Constitution Principle II, Technology Constraints)
- [X] T021 Review `src/routes/checks.js`'s new `PATCH` handler and
  `src/services/webhook-service.js` against Constitution Quality Gates item 3
  (server-side authorization re-derived from the session on every request, never from a
  client-supplied id) and confirm no new code path logs a webhook URL's full value
  alongside anything sensitive; confirm `package.json` still lists zero `dependencies`/
  `devDependencies` (Constitution Principle VI). Fix any gap found.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. BLOCKS both user stories.
- **User Story 1 (Phase 2)**: Depends on Setup. No dependency on US2.
- **User Story 2 (Phase 3)**: Depends on Setup, and on `buildCheckView`
  (`uptime-service.js`) and the dashboard webhook UI existing from US1 (T012, T015) to
  extend — independently testable once added, same pattern feature 001 used for its own
  User Story 2.
- **Polish (Phase 4)**: Depends on both user stories being complete.

### Within Each Phase

- Within User Story 1 and User Story 2, tests are written first and must fail before
  their implementation task (Constitution Principle IV; TDD convention). Setup (Phase 1)
  is the same documented exception feature 001 established: there is no independently
  testable surface for a schema column before it exists, so T001–T002 build it and T003
  verifies it immediately after.
- **The full `node --test` suite — feature 001's existing 48 tests plus this feature's
  new ones — MUST pass before any task in this file is marked complete** (Constitution
  Quality Gates item 2), not only at Phase 4.

### Parallel Opportunities

- Setup: T003 after T002 (sequential chain; nothing to parallelize within this small
  phase).
- User Story 1: all of T004–T007 (tests) in parallel; T008, T012, T013 in parallel; T014
  in parallel with T010–T013 (it depends only on T009, not on them); T015 in parallel
  with T012–T014 (it depends only on T011).
- User Story 2: T016 (test) can be written in parallel with anything in US1 once Setup
  is done, though it will fail until US1's implementation lands.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Contract test for PATCH /api/checks/:id in tests/contract/checks-webhook.test.js"
Task: "Integration test for webhook delivery on real transitions in tests/integration/webhook-delivery.test.js"
Task: "Integration test for delivery-failure isolation in tests/integration/webhook-delivery-failure.test.js"
Task: "Integration test for destination-safety re-checking at delivery time in tests/integration/webhook-url-safety.test.js"

# Launch the independent pieces of the implementation together:
Task: "Export isValidHttpUrl from src/services/check-service.js"
Task: "Extend buildCheckView in src/services/uptime-service.js with webhookUrl"
Task: "Extend src/server.js's body-reading condition to include PATCH"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (schema + migration)
2. Complete Phase 2: User Story 1
3. **STOP and VALIDATE**: run `node --test` (full suite, including feature 001's
   existing tests, must pass) and quickstart.md Scenarios 1–3 by hand
4. This alone is a usable alerting feature: set a webhook, get notified on real
   transitions, broken webhooks don't break anything else

### Incremental Delivery

1. Setup → schema ready on both fresh and existing databases
2. Add User Story 1 → test independently → MVP for this feature
3. Add User Story 2 → test independently → users can tell when their alerting is broken
4. Phase 4 → full-suite + quickstart + constitution Quality-Gate review before calling
   this feature done

---

## Notes

- [P] tasks = different files, no dependency on an incomplete task
- [US1]/[US2] labels map every Phase 2+ task to its user story for traceability back to
  spec.md
- Tests are mandatory here (Constitution Principle IV), not optional — write them first
  within each user story phase, confirm they fail, then implement; Setup (Phase 1)
  builds its one piece of infrastructure first and verifies it immediately after, for
  the reason given in "Within Each Phase" above
- Per Constitution Quality Gates, **no task in this file is "complete" unless the full
  `node --test` suite passes**, including feature 001's existing tests
- FR-011 (the exclusion of email, SMS, and alert escalation) has no corresponding test —
  it is a scope boundary, not a behavior to exercise
- Commit after each task or logical group
- Stop at either checkpoint to validate a story independently before moving on

---

## Phase 5: Convergence

**Purpose**: Close a gap found between spec.md's explicit requirement and the current
code, identified by `/speckit-converge` after `/speckit-implement` completed Phases 1–4.

- [X] T022 Allow `webhookUrl` to be set directly in `POST /api/checks`'s request body
  (an optional field, alongside `url`/`displayName`/`intervalSeconds`), validated with
  the exact same rules `PATCH /api/checks/:id` already uses
  (`webhook-service.js`'s `validateWebhookUrl` — syntax, length, destination safety),
  rejecting the whole creation with `400` if an invalid non-null `webhookUrl` is
  supplied; the created check's response MUST reflect it, same as `PATCH`'s response
  does today. Add a contract test in `tests/contract/checks-create.test.js` (or a new
  file) asserting a check can be created with its webhook URL set in that same call, and
  that an invalid `webhookUrl` at creation time is rejected with `400` per FR-001 / US1
  Acceptance Scenario 5 (missing).
