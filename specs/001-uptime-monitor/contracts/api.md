# API Contract: Personal Uptime Monitor

JSON over HTTP, served by the same `node:http` process as the static dashboard. All
endpoints except registration and login require a valid session cookie; the session's
user is re-derived server-side on every call (Constitution Principle III) — a request body
or query string is never trusted to say who the caller is or what they're allowed to touch.
A session that exists but has exceeded the fixed inactivity window (Constitution Principle
V, data-model.md §Session) is treated as not authenticated at all — same `401` as no
cookie — and is deleted server-side the moment it's seen in that state.

Error responses share one shape: `{"error": "<message>"}` with a non-2xx status code.

## Auth

### `POST /api/register`

Implements FR-001, FR-002.

- **Request body**: `{"login": string, "password": string}`
- **Responses**:
  - `201` `{"id": number, "login": string, "role": "admin"|"user"}` — role is `"admin"` only
    if this is the very first account ever created.
  - `409` if `login` is already taken. This is an accepted, deliberate exception to the
    "don't reveal account existence" posture used elsewhere (FR-001): registration needs
    this signal to give usable "pick another name" feedback. It applies to this endpoint
    only — `POST /api/login` below never reveals it.
  - `400` if `login` or `password` is missing/empty, if `login` exceeds 254 characters,
    or if `password` exceeds 1024 characters.

### `POST /api/login`

Implements FR-003, FR-003a.

- **Request body**: `{"login": string, "password": string}`
- **Responses**:
  - `200` with `Set-Cookie: session=<token>; HttpOnly; SameSite=Strict` and body
    `{"id": number, "login": string, "role": "admin"|"user"}`. `<token>` is the raw,
    random value; only its hash is stored server-side (data-model.md §Session,
    Constitution Principle V).
  - `401` on unknown login or wrong password — identical status, body, and message in both
    cases (FR-003a), so a failed attempt never reveals whether the login is registered.
    Response-timing side channels are explicitly out of scope for this version (FR-003a).

### `POST /api/logout`

- **Auth**: required.
- **Responses**: `204`, and clears the session cookie server-side (deletes the `Session`
  row) and client-side.

## Checks

All of the following require a valid session (FR-003) and act only on the caller's own
checks — regardless of any ID supplied by the client (FR-012, FR-014).

### `GET /api/checks`

Implements FR-009, FR-010, FR-011.

- **Auth**: required.
- **Response** `200`:
  ```json
  [
    {
      "id": 1,
      "url": "https://example.com/health",
      "displayName": "Example health",
      "intervalSeconds": 300,
      "status": "up" | "down" | "pending",
      "uptimePercent24h": 99.4,
      "recentResponseTimesMs": [182, 190, 177]
    }
  ]
  ```
  Only contains checks owned by the caller — never another user's.

### `POST /api/checks`

Implements FR-004, FR-005, FR-006a, FR-019.

- **Auth**: required.
- **Request body**: `{"url": string, "displayName": string, "intervalSeconds": number}`
- **Responses**:
  - `201` with the created check in the same shape as a `GET /api/checks` element (with
    `status: "pending"` and an empty `recentResponseTimesMs`, since it has not been polled
    yet).
  - `400` if `url` is not a syntactically valid `http(s)://` URL, if `url` exceeds 2048
    characters, if `displayName` is empty or exceeds 100 characters, if `intervalSeconds`
    is outside `[60, 86400]`, or if `url`'s hostname resolves immediately to a
    private/loopback/link-local/metadata address (FR-019). Note: a check can still later
    be blocked per-poll and shown "down" if its URL's resolution changes *after* creation
    — FR-019 re-checks on every poll, not only at creation.

### `DELETE /api/checks/:id`

Implements FR-012, FR-013, FR-014.

- **Auth**: required.
- **Responses**:
  - `204` — the check and all of its poll history are permanently removed.
  - `404` if `:id` does not exist **or** belongs to a different user (identical response in
    both cases, so existence of other users' check IDs is never revealed).

## Admin

### `GET /api/admin/users`

Implements FR-015, FR-016, FR-017.

- **Auth**: required, and the caller's role must be `"admin"`.
- **Response** `200`:
  ```json
  [
    {"id": 1, "login": "owner@example.com", "role": "admin", "checkCount": 3},
    {"id": 2, "login": "someone@example.com", "role": "user", "checkCount": 7}
  ]
  ```
  Contains every registered user and their check count, and nothing else about their
  checks (no URLs, statuses, or history) — by construction, this query never joins in
  `PollResult` or per-check `Check` columns.
- **Responses**:
  - `403` if the caller is signed in but not an administrator.
  - `401` if the caller is not signed in at all.

## Static dashboard

### `GET /` and any non-`/api/*` path

Serves the static dashboard shell (`src/public/index.html`, `dashboard.js`, `styles.css`).
No auth check at the HTTP layer — the dashboard page itself calls `GET /api/checks` on load
and redirects to a sign-in view client-side on a `401`, but the *data* is always protected
server-side by the API endpoints above, never by hiding the page.
