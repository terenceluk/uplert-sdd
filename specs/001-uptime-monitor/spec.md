# Feature Specification: Personal Uptime Monitor

**Feature Branch**: `001-uptime-monitor`

**Created**: 2026-10-17

**Status**: Draft

**Input**: User description: "Build Uplert, a personal uptime monitor. A registered user signs in, adds HTTP endpoints to monitor with a URL, a display name, and a polling interval, and sees a dashboard showing whether each endpoint is currently up, its uptime percentage over the last 24 hours, and its recent response times. A background process polls every due check and records the status code, the response time in milliseconds, and a timestamp. Users can delete a check, which also removes its history. An administrator can list every registered user and how many checks each one has, but cannot see another user's check results. Alerting, public status pages, and scheduled report exports are out of scope for this version."

## Clarifications

### Session 2026-10-17

- Q: How long should the system wait for a response before treating a poll as "down" due to timeout? → A: 10 seconds.
- Q: What range of polling intervals should a user be allowed to choose when adding a check? → A: 1 minute to 24 hours.
- Q: When the system polls a monitored endpoint, what kind of HTTP request should it send? → A: A plain GET request only, with no custom headers, body, or auth.
- Q: If a check's previous poll is still running (or was missed) when its next poll comes due, what should the system do? → A: Skip the overdue slot; poll once at the next interval, so a check is never polled concurrently with itself.

### Session 2026-10-17 (security checklist follow-up)

- Q: Should it be acceptable for an attacker to learn whether a given login/email is already registered, or should that signal be hidden everywhere, including at registration? → A: Accept it at registration only — a distinct "already taken" error at registration is fine, but sign-in MUST return an identical, generic error for both an unknown login and a wrong password.
- Q: Since the poller makes outbound GET requests to whatever URL a user types in, should it be allowed to reach private/internal network addresses or cloud metadata endpoints, or should those be blocked? → A: Block private/internal/loopback/link-local/metadata destinations; only publicly routable addresses may be polled.

### Session 2026-10-17 (analysis remediation)

- Q: Does the 10-second poll timeout (FR-008) cover the whole request, or only time-to-first-byte? → A: The whole request — from connecting through fully reading the response. A response that connects quickly but trickles in past 10 seconds total still counts as "down."
- Q: Should `login`, `password`, `url`, and `display_name` have maximum lengths? → A: Yes — login 254 characters, password 1024 characters, URL 2048 characters, display name 100 characters; exceeding any of these is rejected at creation/registration time.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Monitor an endpoint from a dashboard (Priority: P1)

A registered, signed-in user adds an HTTP endpoint they care about — giving it a URL, a
display name, and how often it should be checked — and then watches a dashboard that shows,
for that endpoint and every other endpoint they've added, whether it is currently up, what
percentage of the last 24 hours it was up, and how it has been responding recently.

**Why this priority**: This is the entire reason the product exists. Without the ability to
add an endpoint and see its live status, there is no product — every other capability
(deletion, admin oversight) only has meaning once this exists.

**Independent Test**: Can be fully tested by signing in, adding one check pointed at a known
endpoint, waiting for at least one poll to occur, and confirming the dashboard shows an
up/down status, a 24-hour uptime percentage, and recent response times for that endpoint.
This alone delivers the core value of the product.

**Acceptance Scenarios**:

1. **Given** a signed-in user with no checks yet, **When** they add a check with a valid
   URL, a display name, and a polling interval, **Then** the check appears on their
   dashboard and is scheduled to be polled going forward.
2. **Given** a check that has been polled at least once, **When** the user views their
   dashboard, **Then** they see the check's current up/down status, its uptime percentage
   over the last 24 hours, and a list of its most recent response times.
3. **Given** a check whose endpoint responds successfully, **When** the next scheduled poll
   runs, **Then** the system records a status code, a response time in milliseconds, and a
   timestamp for that poll, and the dashboard reflects the updated status on next view.
4. **Given** a check whose endpoint times out or refuses the connection, **When** the
   scheduled poll runs, **Then** the check is recorded and shown as "down" for that poll.
5. **Given** a user with multiple checks, **When** they view their dashboard, **Then** they
   see only checks they personally added — never another user's checks.

---

### User Story 2 - Remove a check and its history (Priority: P2)

A signed-in user who no longer wants an endpoint monitored deletes its check, and both the
check and every historical poll result recorded for it disappear immediately.

**Why this priority**: Monitoring needs change over time (an endpoint is retired, a check was
added by mistake). This is a secondary but necessary piece of managing one's own monitored
endpoints, and it depends on User Story 1 existing first.

**Independent Test**: Can be fully tested by adding a check, letting it accumulate at least
one poll result, deleting it, and confirming it no longer appears on the dashboard and that
querying its history returns nothing.

**Acceptance Scenarios**:

1. **Given** a signed-in user with an existing check, **When** they delete that check,
   **Then** it no longer appears on their dashboard.
2. **Given** a deleted check that previously had recorded poll history, **When** the
   deletion completes, **Then** none of that check's historical poll results remain
   accessible anywhere in the system.
3. **Given** a signed-in user, **When** they attempt to delete a check that belongs to
   another user, **Then** the deletion is rejected and the other user's check is unaffected.

---

### User Story 3 - Administrator oversight of users (Priority: P3)

The administrator views a list of every registered user along with how many checks each one
currently has, in order to understand overall usage of the system — without being able to see
the actual checks or results belonging to any user other than themselves.

**Why this priority**: This is an oversight capability for the system owner, not something
every user needs, and it has no bearing on whether the core monitoring experience (User
Stories 1 and 2) works. It builds on there being multiple users with checks.

**Independent Test**: Can be fully tested by signing in as the administrator, viewing the
user list, confirming it shows every registered user and an accurate per-user check count,
and confirming that no control on that view exposes another user's individual check URLs,
statuses, or history.

**Acceptance Scenarios**:

1. **Given** multiple registered users each with a different number of checks, **When** the
   administrator views the user list, **Then** every registered user appears with an accurate
   count of their checks.
2. **Given** the administrator is viewing the user list, **When** they look for a way to see
   another user's check details or results, **Then** no such view or data is available to
   them.
3. **Given** a signed-in user who is not an administrator, **When** they attempt to access
   the user list, **Then** access is denied.

---

### Edge Cases

- What happens when a user adds a check whose URL is malformed or unreachable at a basic
  syntax level (not just temporarily down)? The system rejects the check at creation time
  with a clear error rather than scheduling it.
- What happens when a check has existed for less than 24 hours and therefore has no full
  24-hour window of data? Its uptime percentage is calculated over however much history
  actually exists since the check was created.
- What happens when a check has never been polled yet (just added, no poll has run)? The
  dashboard shows it as pending/unknown rather than reporting a false "up" or "down" status.
- What happens if a user tries to view, edit, or delete a check ID that belongs to another
  user (e.g., by guessing or reusing an identifier)? The request is denied as if the check
  did not exist, regardless of what the client sends.
- What happens when the administrator account's own checks are involved? The administrator
  sees their own checks and results exactly as any other user would, but still cannot see
  other users' check details through the admin view.
- What happens when two different users each add a check pointing at the same URL? Both
  checks exist independently, are polled independently, and belong only to their respective
  owners.
- What happens when a check's poll takes longer than its own polling interval to complete?
  The next due slot for that check is skipped, and polling resumes one interval after the
  slow poll finishes — a check is never polled concurrently with itself.
- What happens when a check's URL resolves to a private, loopback, or link-local address
  (including at a later poll, if DNS resolution changes after creation)? The poll is
  blocked and recorded as "down" rather than being sent.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow anyone to self-register a new account with a unique
  identifier (e.g., email or username) and a password. The system MAY respond with a
  distinct "that login is already taken" error when registration is attempted with a
  login that already exists; this is an accepted tradeoff for usable signup feedback and
  applies only to registration, not to sign-in (see FR-003a). Registration MUST be
  rejected with a 400-equivalent error if `login` exceeds 254 characters or `password`
  exceeds 1024 characters.
- **FR-002**: System MUST designate the very first account ever registered as the
  administrator; every account registered after that MUST be a regular user.
- **FR-003**: System MUST allow a registered user to sign in and establish an authenticated
  session before they can add, view, or delete checks.
- **FR-003a**: System MUST return an identical, generic error for a sign-in attempt with an
  unknown login and a sign-in attempt with a correct login but wrong password, so that a
  failed sign-in attempt never reveals whether a given login is registered. Timing-based
  side channels in that comparison are explicitly out of scope for this version.
- **FR-004**: System MUST allow a signed-in user to add a check by specifying a URL, a
  display name, and a polling interval between 1 minute and 24 hours.
- **FR-005**: System MUST reject a check at creation time if its URL is not a syntactically
  valid HTTP or HTTPS URL, if its URL exceeds 2048 characters, if its display name is
  empty or exceeds 100 characters, or if its polling interval falls outside the
  1-minute-to-24-hour range.
- **FR-006**: System MUST automatically poll each check once its configured polling interval
  has elapsed since its last poll, without requiring any manual action by the user. If a
  check's prior poll is still in progress when its next poll comes due, the system MUST skip
  that due slot and poll again one interval after the in-progress poll completes, so a check
  is never polled concurrently with itself.
- **FR-006a**: Each poll MUST be a plain HTTP GET request to the check's URL, with no
  custom headers, request body, or authentication; endpoints that require any of those to
  respond successfully are out of scope for this version.
- **FR-007**: System MUST record, for every poll performed, the resulting status code (or an
  equivalent failure indicator if the endpoint could not be reached), the response time in
  milliseconds, and the timestamp of the poll.
- **FR-008**: System MUST classify a poll as "up" when the endpoint responds with an HTTP
  status code in the 2xx or 3xx range and the full response body is read within 10 seconds
  of initiating the connection, and as "down" for any other status code, a request whose
  connection, response headers, or response body are not fully received within that same
  10-second window measured from connection start, or a connection failure.
- **FR-009**: System MUST show each check's current up/down status on the signed-in user's
  dashboard, based on its most recent poll result.
- **FR-010**: System MUST show each check's uptime percentage — the share of its polls in
  the last 24 hours (or since creation, if younger than 24 hours) that were classified as
  "up" — on the signed-in user's dashboard.
- **FR-011**: System MUST show each check's recent response times on the signed-in user's
  dashboard.
- **FR-012**: System MUST allow a signed-in user to delete only their own checks.
- **FR-013**: System MUST permanently remove all historical poll results for a check at the
  moment that check is deleted.
- **FR-014**: System MUST ensure a signed-in user can only view, add, or delete checks that
  belong to them; any attempt to act on another user's check MUST be denied on the server
  regardless of what the request claims.
- **FR-015**: System MUST allow the administrator to view a list of every registered user
  together with a count of how many checks each user currently has.
- **FR-016**: System MUST prevent the administrator, through the administrator view, from
  viewing any other user's individual check details, statuses, or poll history.
- **FR-017**: System MUST deny access to the administrator's user list to any signed-in user
  who is not the administrator.
- **FR-018**: System explicitly excludes alerting/notifications, public status pages, and
  scheduled report exports from this version.
- **FR-019**: System MUST refuse to poll a check whose URL resolves to a private
  (RFC 1918), loopback, link-local, or other non-publicly-routable address (including
  common cloud metadata addresses such as 169.254.169.254) — rejecting it at creation time
  when resolvable immediately, and re-checking the resolved address on every subsequent
  poll (not only at creation) so a URL that resolves to a public address at creation but a
  private one later is still blocked. A check blocked this way is recorded/shown as "down"
  for that poll rather than silently skipped.

### Key Entities

- **User**: A registered account. Attributes: unique login identifier, hashed password,
  role (administrator or regular user, determined at registration). Owns zero or more
  Checks.
- **Check**: An HTTP endpoint a user wants monitored. Attributes: owning user, URL, display
  name, polling interval, creation time. Has zero or more Poll Results. Deleting a Check
  deletes all of its Poll Results.
- **Poll Result**: The outcome of one scheduled poll of a Check. Attributes: owning Check,
  status code (or failure indicator), response time in milliseconds, timestamp, derived
  up/down classification.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can register, sign in, and see their first added check appear on
  their dashboard in under 2 minutes of starting.
- **SC-002**: A check's dashboard status, uptime percentage, and recent response times
  reflect a poll result within one additional polling interval of that poll occurring.
- **SC-003**: Across a sample of checks with known, controlled poll histories, the displayed
  24-hour uptime percentage matches the actual up/down ratio of recorded polls 100% of the
  time.
- **SC-004**: Deleting a check removes it from the dashboard immediately, and 100% of its
  prior poll history becomes permanently inaccessible.
- **SC-005**: In testing across multiple user accounts, 0 instances of one user viewing,
  modifying, or deleting another user's check or poll history occur.
- **SC-006**: The administrator can obtain an accurate per-user check count for every
  registered user without ever being able to view another user's individual check results.

## Assumptions

- Account creation is open self-registration; the first account ever created becomes the
  administrator, and that role is fixed for this version (no promotion/demotion flow).
- "Recent response times" means the most recent handful of poll results for a check (e.g.,
  the last 20), not the entire history, which is sufficient to spot a trend at a glance.
- Historical poll results are retained indefinitely until their owning check is deleted;
  this is a personal, locally run tool expected to hold a modest volume of data.
- A user may add any number of checks; no artificial cap is imposed in this version.
- This application has a single administrator for this version, since the role is assigned
  only to the first registered account.
