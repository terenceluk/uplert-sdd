# Feature Specification: Webhook Alerting

**Feature Branch**: `002-webhook-alerting`

**Created**: 2026-10-17

**Status**: Draft

**Input**: User description: "Add webhook alerting to Uplert. A user can optionally set a webhook URL on each of their checks. When a check changes state from up to down, or from down to up, Uplert sends a single HTTP POST to that check's webhook URL with the check's display name, URL, new state, status code, response time, and the time of the change. Repeated results in the same state do not send another alert. A failed webhook delivery is recorded and does not affect polling or the check's state. Users can only see and change webhook URLs on their own checks. Webhook URLs follow the same destination rules as check URLs, so private, internal, loopback, and cloud metadata addresses are rejected. Email, SMS, and alert escalation are out of scope."

## Clarifications

### Session 2026-10-17

- Q: When a webhook delivery is "recorded," how much of that should be visible to the user in the dashboard? → A: Only the last delivery's outcome, per check — the dashboard shows whether the most recently attempted delivery for a check succeeded or failed and when; no running history of past attempts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get alerted when a check's status changes (Priority: P1)

A signed-in user sets a webhook URL on one of their checks. From then on, whenever that
check's status genuinely flips — from up to down, or from down to up — Uplert sends a
single HTTP notification to that URL describing the change. Polls that don't change the
status send nothing.

**Why this priority**: This is the entire point of the feature — without a webhook
actually firing on a real state change, there is no alerting value at all.

**Independent Test**: Can be fully tested by setting a webhook URL on a check pointed at a
known-failing endpoint, letting it flip from "up" (or pending) to "down", and confirming
exactly one HTTP POST arrives at the webhook URL with the expected fields; then letting it
poll again in the same state and confirming no second POST arrives.

**Acceptance Scenarios**:

1. **Given** a check with a webhook URL set, **When** that check's status changes from
   "up" to "down" on a poll, **Then** Uplert sends exactly one HTTP POST to the webhook
   URL containing the check's display name, URL, new state ("down"), status code,
   response time, and the time of the change.
2. **Given** a check with a webhook URL set, **When** that check's status changes from
   "down" to "up" on a poll, **Then** Uplert sends exactly one HTTP POST to the webhook
   URL with the same fields, with new state "up".
3. **Given** a check whose status stays the same across two consecutive polls, **When**
   the second poll completes, **Then** no additional webhook notification is sent.
4. **Given** a check that has never been polled before (status "pending"), **When** its
   first poll establishes an initial status of "up" or "down", **Then** no webhook
   notification is sent for that first result, since it is not a transition between "up"
   and "down".
5. **Given** a user adding or updating a check, **When** they set a webhook URL that
   resolves to a private, internal, loopback, or cloud-metadata address, **Then** the
   system rejects it with a clear error, the same way it already rejects such an address
   for the check's own URL.
6. **Given** a check with a webhook URL set, **When** the webhook endpoint cannot be
   reached or fails to respond, **Then** the delivery is recorded as failed, the check's
   own polling continues on schedule, and the check's displayed up/down status is
   unaffected by the delivery failure.

---

### User Story 2 - See whether alerts are actually getting through (Priority: P2)

A signed-in user looks at a check that has a webhook URL set and can see, at a glance,
whether the most recent alert attempt for that check succeeded or failed, and when — so a
broken webhook doesn't fail silently forever.

**Why this priority**: Alerting that fails invisibly is worse than no alerting at all,
since the user believes they're covered when they aren't. This depends on User Story 1
existing (there must be deliveries to report on).

**Independent Test**: Can be fully tested by setting a webhook URL on a check, forcing one
successful delivery and (separately) one failed delivery, and confirming the dashboard
reflects the outcome and timestamp of the most recent of the two each time.

**Acceptance Scenarios**:

1. **Given** a check with a webhook URL set that has had at least one delivery attempt,
   **When** the user views their dashboard, **Then** they see whether that check's most
   recent delivery attempt succeeded or failed, and when it happened.
2. **Given** a check with a webhook URL set that has never had a delivery attempt (no
   state change has occurred yet), **When** the user views their dashboard, **Then** no
   misleading success/failure indicator is shown for it.
3. **Given** two consecutive delivery attempts for the same check — one failed, then one
   succeeded — **When** the user views the dashboard after both, **Then** only the
   outcome of the most recent (successful) attempt is shown.

---

### Edge Cases

- What happens when a check has no webhook URL set? No delivery is ever attempted for it,
  and nothing related to webhooks appears for that check.
- What happens when a check's status oscillates across several consecutive polls (up →
  down → up)? Each transition sends its own single notification — one per transition, not
  one per poll.
- What happens if a webhook URL that was safe when set later resolves to a private or
  internal address (its DNS answer changes)? The delivery for that transition is blocked
  and recorded as failed, the same way a check's own polling blocks and records a
  now-unsafe destination; the check's polling and status are unaffected.
- What happens if the webhook endpoint accepts the connection but never finishes
  responding? The delivery attempt is treated as failed after a reasonable timeout rather
  than hanging indefinitely.
- What happens when a user clears a previously set webhook URL? No further notifications
  are sent for that check until a new webhook URL is set; its last recorded delivery
  outcome is no longer shown.
- What happens to a check's webhook URL and delivery record when the check itself is
  deleted? Both are removed along with the check, consistent with deleting a check
  removing all of its data.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a signed-in user to optionally set a webhook URL on a
  check they own, either when adding the check or by updating it afterward.
- **FR-002**: System MUST allow a signed-in user to clear a previously set webhook URL on
  a check they own, returning that check to having no webhook configured.
- **FR-003**: System MUST validate a webhook URL using the same rules applied to a
  check's own URL: it must be a syntactically valid HTTP or HTTPS URL of at most 2048
  characters, and it MUST NOT resolve to a private, loopback, link-local, or cloud-metadata
  address. This destination check MUST be re-evaluated at the time of every delivery
  attempt, not only when the webhook URL is set, mirroring the same re-check-on-every-use
  policy already applied to checks' own URLs.
- **FR-004**: System MUST ensure a signed-in user can view or change the webhook URL only
  on checks they own; any attempt to view or change another user's check's webhook URL
  MUST be denied on the server regardless of what the request claims.
- **FR-005**: System MUST send exactly one webhook notification each time a check's status
  transitions between "up" and "down" (in either direction), for any check that has a
  webhook URL set at the time of that transition.
- **FR-006**: System MUST NOT send a webhook notification when a poll result leaves a
  check's status unchanged from its previous poll, and MUST NOT send one for a check's
  very first poll result (the transition out of "pending"), since neither is a transition
  between "up" and "down".
- **FR-007**: Each webhook notification MUST be delivered as a single HTTP POST request to
  the check's webhook URL, whose content includes: the check's display name, the check's
  URL, the new state ("up" or "down"), the status code from the poll that triggered the
  change, the response time of that poll, and the timestamp of the change.
- **FR-008**: System MUST record the outcome (succeeded or failed) and timestamp of the
  most recent webhook delivery attempt for each check that has ever had one.
- **FR-009**: System MUST show, for each of a signed-in user's checks that has a webhook
  URL set and at least one delivery attempt, the outcome and timestamp of that check's
  most recent delivery attempt.
- **FR-010**: A failed webhook delivery MUST NOT affect that check's scheduled polling or
  its recorded up/down status in any way.
- **FR-011**: System explicitly excludes email alerts, SMS alerts, and alert escalation
  (e.g., repeated or intensifying follow-up notifications for an alert that was already
  sent) from this version.

### Key Entities

- **Check** (existing entity, extended): gains an optional webhook URL attribute, owned
  and controlled exactly like the check's own URL — visible and changeable only by the
  check's owner.
- **Webhook Delivery Attempt**: the outcome of the most recent attempt to notify a check's
  webhook URL of a status transition. Attributes: owning check, outcome (succeeded or
  failed), timestamp of the attempt. Only the most recent attempt per check is retained
  and shown (per Clarifications) — this is not a running history.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When a check with a webhook URL set genuinely transitions between up and
  down, its owner's webhook receives exactly one notification for that transition within
  one additional polling interval of the transition occurring.
- **SC-002**: Across a sample of checks with known, controlled poll histories, zero
  webhook notifications are sent for polls that do not change status, and zero are sent
  for a check's first-ever poll result.
- **SC-003**: 100% of webhook URLs that resolve to a private, loopback, link-local, or
  cloud-metadata address are rejected, both when a user attempts to set them and at any
  later delivery attempt if a previously-safe URL's resolution changes.
- **SC-004**: A failed webhook delivery never delays, skips, or alters the outcome of that
  check's next scheduled poll, and never changes what up/down status is displayed for
  that check.
- **SC-005**: A user can tell, from the dashboard alone, whether their most recent alert
  for a given check was delivered successfully, without needing to inspect anything
  outside the application.
- **SC-006**: In testing across multiple user accounts, 0 instances of one user viewing or
  changing another user's webhook URL occur.

## Assumptions

- Only the single most recent delivery attempt's outcome is retained per check, per the
  Clarifications answer; an older failure is overwritten once a later attempt (success or
  failure) occurs, rather than accumulating a history.
- A webhook delivery attempt that does not complete within a reasonable timeout (the same
  10-second budget already used for polling a check's own URL) is treated as failed,
  consistent with how an unresponsive check endpoint is already handled.
- The webhook notification's content is sent as a structured, machine-readable body (the
  exact serialization is a planning-stage detail, not a product decision), containing
  exactly the fields FR-007 names — no additional fields, headers, or authentication are
  added on top of what a plain HTTP POST requires.
- This feature narrows, rather than contradicts, this project's earlier decision to treat
  "alerting/notifications" as out of scope: webhook delivery is now in scope, while
  email, SMS, and escalation remain explicitly excluded (FR-011).
- A check's webhook URL and its most recent delivery outcome are deleted along with the
  check itself; no separate cleanup step exists or is needed.
- There is no limit on how many of a user's checks may have a webhook URL configured
  simultaneously, consistent with there being no cap on the number of checks a user may
  add.
