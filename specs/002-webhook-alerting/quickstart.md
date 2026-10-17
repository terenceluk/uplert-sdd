# Quickstart: Webhook Alerting

Validates this feature end-to-end against the acceptance scenarios in `spec.md`. Assumes
feature 001 (`specs/001-uptime-monitor/`) is already implemented and this feature's
changes are layered on top of it — see that feature's own `quickstart.md` for base
setup/sign-in steps, not repeated here.

## Prerequisites

- Everything in feature 001's quickstart Prerequisites.
- A second terminal (or a tool like a throwaway local HTTP listener) able to stand in as
  a webhook receiver, to observe what Uplert actually sends.

## Setup

```powershell
npm start
```

Still the single command — this feature adds no new startup step. If you have an
existing `uplert.db` from before this feature, its `checks` table gains the new webhook
columns automatically on this first startup after upgrading (no migration command).

## Scenario 1 — A real up→down or down→up transition fires exactly one webhook (User Story 1 / SC-001, SC-002)

1. Sign in, add a check against an endpoint you control (or a mock endpoint), and use
   `PATCH /api/checks/:id` with `{"webhookUrl": "<your receiver's URL>"}` to set its
   webhook.
   - **Expect**: `200`, and the check's `webhookUrl` field in a subsequent
     `GET /api/checks` reflects it.
2. Let the check's first poll happen (status goes from "pending" to "up" or "down").
   - **Expect**: no webhook POST arrives for this first result (FR-006).
3. Change the monitored endpoint's behavior so the next poll flips the check's status
   (e.g., stop it if it was "up", or start it if it was "down").
   - **Expect**: exactly one HTTP POST arrives at the webhook receiver, with
     `displayName`, `url`, `state`, `statusCode`, `responseTimeMs`, and `changedAt`
     matching that poll (FR-005, FR-007).
4. Let another poll happen without changing the endpoint's behavior again (status stays
   the same).
   - **Expect**: no second POST arrives (FR-006, SC-002).

## Scenario 2 — An unsafe webhook URL is rejected (FR-003, SC-003)

1. Attempt `PATCH /api/checks/:id` with `{"webhookUrl": "http://127.0.0.1:9/"}` (or any
   RFC 1918/loopback/link-local/metadata address).
   - **Expect**: `400`, same destination-safety rejection already used for a check's own
     `url` in feature 001.

## Scenario 3 — A failed delivery doesn't touch polling or status (FR-010, SC-004)

1. Set a check's webhook URL to an address that will refuse the connection (but is not
   itself a blocked private/internal address — e.g. a public IP on a closed port).
2. Force a status transition on that check.
   - **Expect**: the check's `status`/`uptimePercent24h`/`recentResponseTimesMs` reflect
     only the poll itself; `webhookLastDeliveryStatus` becomes `"failed"` with a current
     `webhookLastDeliveryAt`; the check keeps polling on its normal schedule afterward.

## Scenario 4 — The dashboard shows only the latest delivery outcome (User Story 2 / SC-005)

1. After Scenario 1 step 3 (a succeeded delivery) and Scenario 3 (a failed delivery on a
   different check), call `GET /api/checks`.
   - **Expect**: each check shows only its own most recent `webhookLastDeliveryStatus`/
     `webhookLastDeliveryAt` — no list of past attempts, and the two checks' outcomes
     don't bleed into each other.
2. `PATCH` the first check's `webhookUrl` to `null`.
   - **Expect**: `webhookUrl` becomes `null`, and `webhookLastDeliveryStatus`/
     `webhookLastDeliveryAt` are now also `null` in `GET /api/checks`, even though a
     delivery was attempted earlier (FR-009, data-model.md Derived values).

## Scenario 5 — Cross-user isolation on webhook URLs (FR-004, SC-006)

1. As a second user, attempt `PATCH` on the first user's check id.
   - **Expect**: `404` — identical to feature 001's existing cross-user `DELETE`
     behavior, revealing nothing about whether that check id exists.

## Running the automated test suite

```powershell
npm test
```

**Expect**: every scenario above has a corresponding automated test, and the full suite
(feature 001's existing tests plus this feature's new ones) passes — the gate
`/speckit-implement` enforces before any task can be marked complete (Constitution
Principle IV).
