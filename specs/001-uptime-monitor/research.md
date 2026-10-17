# Research: Personal Uptime Monitor

All Technical Context items were decided explicitly by the user's planning direction ("Use
Node.js and SQLite with as few dependencies as possible... same process... poller... on an
interval timer"). No `NEEDS CLARIFICATION` markers remain. This document records the
resulting decisions, their rationale, and the alternatives considered, so the choices are
revisitable without re-deriving them from scratch.

## 1. SQLite access

- **Decision**: Use Node's built-in `node:sqlite` module (available from Node.js 22.5.0).
- **Rationale**: It is a zero-dependency synchronous SQLite driver shipped in Node core,
  which satisfies "as few dependencies as possible" as literally as possible (zero) and
  Constitution Principle VI directly. Synchronous calls are acceptable here because SQLite
  operations on a small personal dataset are sub-millisecond and the app has no other
  concurrent-request pressure that synchronous I/O would meaningfully block.
- **Alternatives considered**:
  - `better-sqlite3` (third-party, synchronous, native binding) — extremely common and
    battle-tested, but it is a compiled native dependency (needs prebuilt binaries or a
    native toolchain on the target Windows machine) and is an additional dependency the
    built-in module makes unnecessary.
  - `sqlite3` (third-party, async/callback) — older, callback-based API, heavier, and still
    an extra dependency with no benefit over the built-in module for this workload.
- **Risk / mitigation**: `node:sqlite` is marked experimental as of Node 22/24 and may emit
  a startup warning. Mitigation: pin a minimum Node version in `package.json#engines`,
  document the expected warning in the README, and keep `check-service.js`/`db/index.js` as
  the only modules touching the driver so a swap to `better-sqlite3` later (same SQL, same
  schema) would be a localized change if the experimental API ever proves unworkable.

## 2. HTTP server & routing

- **Decision**: Use Node's built-in `node:http` module with a small hand-written router
  (method + path match) rather than a framework.
- **Rationale**: The API surface is small (register, login, logout, list/add/delete checks,
  admin user list, static file serving) — a few dozen lines of routing logic. Pulling in
  Express/Fastify/Koa for this would add a dependency (plus its own transitive dependencies)
  to replace something `node:http` already does adequately at this scale.
- **Alternatives considered**: Express (ubiquitous, but a dependency + several transitive
  dependencies for middleware this app doesn't need); Fastify (faster, schema-based, but
  still an added dependency and a learning-curve for a project this size).

## 3. Password hashing

- **Decision**: `node:crypto.scrypt` with a random per-user salt (stored alongside the hash)
  and parameters consistent with current OWASP guidance.
- **Rationale**: `scrypt` is a modern adaptive, memory-hard hashing algorithm available in
  Node core — satisfies Constitution Principle V with zero dependency.
- **Alternatives considered**: `bcrypt`/`bcryptjs` (popular, but third-party, and bcrypt's
  native variant requires a compiled binding); `argon2` (arguably the current best-practice
  algorithm, but only available via a third-party, natively-compiled package). Both were
  rejected only because `scrypt` already meets the constitution's "modern adaptive
  algorithm" bar at zero dependency cost — not because they are worse algorithms.

## 4. Session / authentication mechanism

- **Decision**: Opaque, random session tokens (`crypto.randomBytes(32)`) issued at login.
  The client receives the raw token in an `HttpOnly`, `SameSite=Strict` cookie, but the
  database stores only `sha256(token)` — never the raw value — in a `sessions` table in
  SQLite. Every session row also carries `last_seen_at`; a request updates it on successful
  validation, and any session whose `last_seen_at` is older than a fixed inactivity window
  is treated as expired and rejected (not merely "old" — it is deleted on next sight).
- **Rationale**: Keeps the authenticated identity server-side and re-derived per request
  (Constitution Principle III) without needing a JWT library or a signing dependency. A
  SQLite-backed session table (rather than an in-memory `Map`) means a process restart does
  not silently misbehave and sessions can be inspected/cleared like any other app data.
  Hashing the stored token, enforcing inactivity expiry, and requiring `SameSite=Strict`
  are direct requirements of Constitution Principle V as amended (v1.1.0): a database read
  alone (backup, export, unrelated bug) must not yield a usable session, a forgotten session
  must not stay valid forever, and the cookie must never ride along on a cross-site request
  — this app has exactly one origin to serve from, so `Strict` costs nothing in practice.
  `sha256` (not `scrypt`) is appropriate here because a session token is already
  high-entropy random data, not a low-entropy user-chosen secret like a password — hashing
  it is about surviving a database leak, not about resisting brute-force guessing of the
  token itself.
- **Alternatives considered**: Signed/stateless JWT in a cookie — avoids a sessions table,
  but adds a dependency (or hand-rolled signing/verification code) for no real benefit at
  this scale, and makes immediate server-side revocation (e.g., on logout) harder. Storing
  the raw token instead of its hash was rejected outright once Principle V was amended to
  require hash-at-rest storage.
- **Inactivity window**: a specific duration (e.g., 30 minutes) is a planning-level default
  to be set in `auth-service.js`, not a value the constitution or spec mandates a number
  for; it must exist and be enforced, per FR-003/Constitution Principle V, but the exact
  figure is an implementation choice.

## 5. Background poller scheduling

- **Decision**: A single `setInterval` "tick" (e.g., every 15 seconds) in the same process
  as the HTTP server, which queries SQLite for checks whose next-due time has passed, and
  fires a non-blocking `fetch` (with a 10-second timeout via `AbortController`) for each one
  concurrently. A check already mid-poll is skipped on that tick (spec FR-006).
- **Rationale**: This is exactly what the user specified ("run the poller in the same
  process on an interval timer") and needs no scheduling library — `setInterval` plus a
  "due" query against the `checks` table (comparing `last_polled_at + interval` to now) is
  sufficient at this scale.
- **Alternatives considered**: `node-cron`/`node-schedule` (third-party cron-style
  schedulers) — unnecessary, since checks aren't on fixed wall-clock cron schedules, they're
  on a per-check rolling interval; a worker thread or child process for the poller — rejected
  per explicit user direction to keep the poller in the same process, and unnecessary given
  non-blocking `fetch` already keeps polling from blocking the event loop.

## 6. Outbound polling HTTP client

- **Decision**: The global `fetch` built into Node.js (18+), with `AbortController` for the
  10-second timeout. The timer starts when the request is initiated and the `AbortController`
  fires at 10,000ms regardless of connection/header/body progress, so the 10-second budget
  covers the entire request — connect through fully reading the response body — not just
  time-to-first-byte (FR-008; resolves security checklist CHK029).
- **Rationale**: Zero dependency, already handles GET requests and timeouts.
- **Alternatives considered**: `axios`, `node-fetch` — both unnecessary now that `fetch` is a
  Node.js built-in global.

## 7. Dashboard frontend

- **Decision**: Static HTML/CSS and vanilla JavaScript served directly from `src/public/` by
  the same `node:http` server; the dashboard JS calls the JSON API with `fetch` and renders
  results with direct DOM updates.
- **Rationale**: No build step (no bundler, no framework) keeps the "one command to start"
  constitutional constraint trivially true and adds zero frontend dependencies for a
  handful of views (sign in/register, check list + add form, admin roster).
- **Alternatives considered**: React/Vue/Svelte with a bundler (Vite, etc.) — would add a
  build dependency chain and a build step before `npm start` works, which conflicts with
  both the constitution and the user's single-process/single-command direction.

## 8. Testing framework

- **Decision**: Node's built-in `node:test` runner with `node:assert`, invoked via
  `node --test`.
- **Rationale**: Zero dependency, directly supports the constitution's non-negotiable
  "every functional requirement has at least one automated test, full suite must pass"
  principle, and integrates cleanly with async setup/teardown for spinning up a real HTTP
  server + ephemeral SQLite file per test file.
- **Alternatives considered**: Jest, Mocha+Chai, Vitest — all capable, but all third-party
  dependencies (Jest and Vitest pull in non-trivial transitive dependency trees) that
  `node:test` makes unnecessary for this project's size.

## 9. Blocking private/internal/metadata poll destinations (FR-019)

- **Decision**: Before accepting a check at creation time, and again immediately before
  every poll, resolve the check's hostname with `node:dns`'s `dns.promises.lookup()` and
  reject (at creation) or record a "down" result (at poll time) if the resolved address
  falls in a private (RFC 1918), loopback (`127.0.0.0/8`, `::1`), link-local
  (`169.254.0.0/16`, `fe80::/10`), or other non-publicly-routable range. If the address is
  safe, proceed with the normal `fetch()` call from research.md §6.
- **Rationale**: Zero-dependency — `node:dns` plus a small range-matching helper is all
  that's needed; no IP-range-matching package required. Re-resolving on every poll (not
  just at creation) is what FR-019 requires, since a hostname's DNS answer can legitimately
  change between polls.
- **Known limitation (accepted)**: there is a small time-of-check-to-time-of-use gap
  between this lookup and `fetch()`'s own internal DNS resolution — in principle, a
  malicious or misconfigured DNS server could answer differently a few milliseconds later
  ("DNS rebinding"). Closing that gap completely would mean manually connecting to the
  checked IP and setting the `Host` header rather than letting `fetch()` re-resolve, which
  is meaningfully more implementation complexity for a personal, locally run tool. The
  accepted mitigation is that FR-019's "re-check on every poll" already bounds any exposure
  to at most one polling interval (minimum 1 minute), which is judged sufficient at this
  scale; closing the TOCTOU gap itself is not required by the spec.
- **Alternatives considered**: a third-party "is-private-ip" style npm package — rejected
  per Constitution Principle VI, since the range list is short and stable enough to
  hand-maintain; manually pinning the connection to the checked IP (eliminating the TOCTOU
  gap) — rejected for now as more complexity than this version's risk level justifies, but
  noted above as the harder-guarantee alternative if that judgment ever changes.

## Summary

Every dependency question resolves to "use what Node.js already ships." The project will
have **zero** entries in `package.json`'s `dependencies` and **zero** in `devDependencies`,
which is the strongest possible reading of both the user's "as few dependencies as
possible" direction and Constitution Principle VI. Two decisions in this document were
revised after the fact to track real governance/spec changes rather than being decided
fresh: §4 (session handling) now implements Constitution Principle V as amended to v1.1.0
(hash-at-rest tokens, inactivity expiry, `SameSite=Strict`), and §9 was added to implement
spec FR-019 (blocking private/internal/metadata poll destinations).
