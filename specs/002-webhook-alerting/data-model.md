# Data Model: Webhook Alerting

This extends feature 001's data model (`specs/001-uptime-monitor/data-model.md`), which
remains the source of truth for `User`, `PollResult`, and `Session`, and for the `Check`
fields not listed again here. Only the `Check` entity changes, and only by addition — no
existing column changes type, nullability, or meaning.

## Check (extended)

Three new nullable columns, added to the existing `checks` table.

| Field | Type | Notes |
|---|---|---|
| `webhook_url` | text, nullable | Must be a syntactically valid `http://` or `https://` URL of at most 2048 characters when set (spec FR-003) — the identical rule already applied to the check's own `url`. `NULL` means no webhook is configured for this check. |
| `webhook_last_outcome` | text, nullable, `'succeeded'` \| `'failed'` \| `NULL` | The outcome of the most recent webhook delivery *attempt* for this check. `NULL` until the first attempt ever happens for this check (spec FR-008, FR-009). Overwritten on every subsequent attempt — not a history (per spec Clarifications). |
| `webhook_last_attempted_at` | text (ISO 8601), nullable | Timestamp of the attempt `webhook_last_outcome` describes. `NULL` exactly when `webhook_last_outcome` is `NULL`. |

**Rules**:
- `webhook_url`, when non-`NULL`, is validated at set-time with the same syntax+length
  check as a check's own `url`, and the same private/loopback/link-local/metadata
  destination check via `url-safety.js`'s `isSafeToFetch` (spec FR-003) — rejected with a
  clear error if either check fails, exactly like adding a check with an unsafe URL is
  already rejected.
- `webhook_url`'s destination safety is **re-checked at every delivery attempt**, not
  only when set (spec FR-003; mirrors feature 001's `Check.url` re-check-on-every-poll
  rule exactly). An attempt blocked this way is recorded as `webhook_last_outcome =
  'failed'`, the same as any other delivery failure.
- `webhook_url` may be set to `NULL` at any time by the check's owner, clearing it (spec
  FR-002). Clearing it does not retroactively change `webhook_last_outcome`/
  `webhook_last_attempted_at` from a prior attempt, but neither is shown once there is no
  webhook URL configured (derived value, see below).
- `webhook_last_outcome`/`webhook_last_attempted_at` are written only by the poller's
  webhook-delivery step, never by the API layer directly.
- Deleting a `Check` deletes these columns' values along with it — no separate cleanup,
  since they are columns on the check row itself, not a related table.

## Entity relationships

Unchanged from feature 001:

```text
User (1) ──< (many) Check (1) ──< (many) PollResult
User (1) ──< (many) Session
```

No new entity and no new relationship — `webhook_url` and the delivery-outcome columns
are attributes of `Check`, not a related entity, per the "store it on the existing check
record" direction and the Clarifications answer that only the latest attempt matters.

## Derived values (not stored as independent columns)

In addition to feature 001's derived values (current status, 24h uptime %, recent
response times, per-user check count), this feature adds:

- **Webhook delivery visibility** (spec FR-009): a check's `webhookLastDeliveryStatus`
  and `webhookLastDeliveryAt` are shown in the API response only when `webhook_url` is
  currently non-`NULL`; a check with no webhook URL configured shows neither field
  (`null`), even if `webhook_last_outcome` still holds a stale value from before the
  webhook URL was cleared.
- **Transition detection** (spec FR-005, FR-006): not a stored value at all — computed
  once per poll by comparing the check's `computeStatus` result *before* that poll's
  `PollResult` row is inserted against the `is_up` value *this* poll just produced. A
  webhook delivery is attempted only when those two differ and the "before" value is not
  `"pending"`.
