# API Contract: Webhook Alerting

This documents only what feature 002 adds or changes to the API feature 001 already
defined in `specs/001-uptime-monitor/contracts/api.md`, which remains authoritative for
`/api/register`, `/api/login`, `/api/logout`, `/api/admin/users`, and everything about
`/api/checks` not called out below. All existing auth/ownership rules continue to apply
unchanged (every endpoint re-derives identity from the session; a request can never claim
an identity or ownership the server doesn't independently verify).

## Checks (extended response shape)

`GET /api/checks` and `POST /api/checks` (both already defined in feature 001) now
include three additional fields in each check object:

```json
{
  "id": 1,
  "url": "https://example.com/health",
  "displayName": "Example health",
  "intervalSeconds": 300,
  "status": "up" | "down" | "pending",
  "uptimePercent24h": 99.4,
  "recentResponseTimesMs": [182, 190, 177],
  "webhookUrl": "https://hooks.example.com/uplert" | null,
  "webhookLastDeliveryStatus": "succeeded" | "failed" | null,
  "webhookLastDeliveryAt": "2026-10-17T12:34:56.000Z" | null
}
```

`webhookUrl` is `null` when no webhook is configured for that check (its default).
`webhookLastDeliveryStatus`/`webhookLastDeliveryAt` are both `null` whenever `webhookUrl`
is `null`, and whenever no delivery has ever been attempted for that check yet, even if a
webhook URL is currently set (spec FR-009).

`POST /api/checks`'s request body gains one optional field: `webhookUrl` (string, or
omitted/`null` for none). When provided and non-null, it is validated with the exact same
rules as `PATCH /api/checks/:id`'s `webhookUrl` below (syntax, length, destination
safety) — the whole creation is rejected with `400` if it fails validation, and no check
row is created in that case. A webhook URL can also still be set or changed afterward via
`PATCH /api/checks/:id` (per FR-001: "either when adding the check or by updating it
afterward").

### `PATCH /api/checks/:id`

Implements FR-001, FR-002, FR-003, FR-004.

- **Auth**: required; acts only on a check the caller owns, exactly like `DELETE
  /api/checks/:id` (FR-004 — identical 404 for not-found vs. not-owned, so existence of
  another user's check is never revealed).
- **Request body**: `{"webhookUrl": string | null}`. A `null` value (or an absent key)
  clears the webhook. A non-null value MUST be a syntactically valid `http(s)` URL of at
  most 2048 characters that does not resolve to a private/loopback/link-local/metadata
  address.
- **Responses**:
  - `200` with the updated check in the same shape as a `GET /api/checks` element (see
    above).
  - `400` if `webhookUrl` is a non-null value that fails URL syntax, length, or
    destination-safety validation (FR-003) — same error shape and same validation rules
    as `POST /api/checks`'s own `url` field.
  - `404` if `:id` does not exist **or** belongs to a different user.

## Webhook delivery (outbound, not an API endpoint Uplert serves)

Not a contract Uplert exposes to its own clients — this describes the outbound request
Uplert itself makes to a user-configured destination, for completeness.

- **Trigger**: immediately after a poll that changes a check's status between `"up"` and
  `"down"` (either direction), for a check whose `webhook_url` is set at that moment
  (spec FR-005, FR-006).
- **Request**: `POST <webhookUrl>` with `Content-Type: application/json` and body:

  ```json
  {
    "displayName": "Example health",
    "url": "https://example.com/health",
    "state": "up" | "down",
    "statusCode": 200,
    "responseTimeMs": 183,
    "changedAt": "2026-10-17T12:34:56.000Z"
  }
  ```

  `statusCode` is `null` when the transition was caused by a connection failure/timeout
  rather than an HTTP response (consistent with how `PollResult.status_code` already
  represents that case in feature 001).
- **Timeout**: 10 seconds, the same budget already used to poll a check's own URL.
- **Outcome recording**: any response received before the timeout (regardless of its
  HTTP status code) is recorded as `'succeeded'`; a network error, a destination blocked
  by the safety re-check, or a timeout is recorded as `'failed'` (research.md §5). This
  recording never surfaces as an API error to the user making an unrelated request — it
  only updates `webhook_last_outcome`/`webhook_last_attempted_at`, visible on that
  check's next `GET /api/checks`.
