

# Sprint B — Lifecycle Observability & Timeline

## Objective

Introduce full lifecycle observability for Parker sessions so operators, developers, and autonomous agents can understand **exactly what happened during a parking payment flow**.

This sprint adds:

- session lifecycle event logging
- decision and settlement audit trails
- correlation identifiers across services
- a timeline API
- operator debugging visibility

Goal: make the system **operationally observable, debuggable, and auditable**.

---

# 1. Why This Sprint Exists

The Parker system already enforces:

- policy grants
- payment decisions
- settlement verification
- enforcement safety gates

However, when something fails, operators currently have to inspect logs or database rows to understand the sequence of events.

This sprint introduces a **timeline model** so that every session can be inspected as a chronological sequence of events.

Example session timeline:

```
Session: sess_7A32

09:11:02  SESSION_CREATED
09:11:02  POLICY_GRANT_ISSUED
09:18:41  PAYMENT_DECISION_CREATED
09:18:45  SETTLEMENT_VERIFIED (XRPL)
09:18:45  POLICY_ENFORCEMENT_PASSED
09:18:46  SESSION_CLOSED
```

This dramatically simplifies debugging and provides an audit trail for autonomous payments.

---

# 2. Lifecycle Event Model

Introduce a dedicated **session event log**.

Events are append-only records representing important lifecycle transitions.

## Event Characteristics

Events must be:

- immutable
- chronological
- correlated with a session
- optionally linked to decisions and settlements

Events should never be updated or deleted.

---

# 3. Event Types

The following core lifecycle events should be emitted.

## Session events

```
SESSION_CREATED
SESSION_DENIED
SESSION_CLOSED
```

## Policy lifecycle

```
POLICY_GRANT_ISSUED
POLICY_GRANT_DENIED
```

## Payment lifecycle

```
PAYMENT_DECISION_CREATED
PAYMENT_DECISION_EXPIRED
PAYMENT_APPROVAL_REQUIRED
PAYMENT_APPROVED
PAYMENT_REJECTED
```

## Settlement lifecycle

```
SETTLEMENT_DETECTED
SETTLEMENT_VERIFIED
SETTLEMENT_REJECTED
```

## Enforcement lifecycle

```
POLICY_ENFORCEMENT_PASSED
POLICY_ENFORCEMENT_FAILED
```

---

# 4. Event Storage

Create a new table:

```
session_events
```

### Schema (conceptual)

```
id
session_id
event_type
created_at
metadata
```

### Example row

```
{
  id: "evt_91d2",
  session_id: "sess_7A32",
  event_type: "SETTLEMENT.VERIFIED",
  created_at: "2026-03-07T09:18:45Z",
  metadata: {
    rail: "xrpl",
    txHash: "ABC123",
    amount: "450",
    asset: "XRP"
  }
}
```

---

# 5. Correlation Identifiers

Every event should include the relevant identifiers to make debugging simple.

Common identifiers:

```
sessionId
decisionId
txHash
policyHash
vehicleId
lotId
```

Not every event will include all identifiers, but the metadata should include them when available.

---

# 6. Event Emission Points

Lifecycle events should be emitted whenever state transitions occur.

## Entry flow

Emit events during:

```
SESSION_CREATED
POLICY_GRANT_ISSUED
```

## Exit flow

Emit events during:

```
PAYMENT_DECISION_CREATED
PAYMENT_APPROVAL_REQUIRED
```

## Settlement detection

Emit events when watchers detect payment attempts:

```
SETTLEMENT_DETECTED
```

Sources:

- XRPL verification route
- EVM watcher
- Stripe webhook

## Settlement verification

After settlement validation:

```
SETTLEMENT_VERIFIED
```

If rejected:

```
SETTLEMENT_REJECTED
```

## Enforcement step

After `enforcePayment`:

```
POLICY_ENFORCEMENT_PASSED
POLICY_ENFORCEMENT_FAILED
```

## Session completion

```
SESSION_CLOSED
```

---

# 7. Timeline API

Expose lifecycle history via API.

### Endpoint

```
GET /api/sessions/:sessionId/timeline
```

### Response

```
{
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "state": "payment_required",
  "eventCount": 2,
  "events": [
    {
      "eventType": "SESSION.CREATED",
      "createdAt": "...",
      "metadata": {
        "lotId": "lot-1",
        "vehicleId": "veh-1"
      }
    },
    {
      "eventType": "POLICY.GRANT_ISSUED",
      "createdAt": "...",
      "metadata": {
        "grantId": "grant-1",
        "policyHash": "..."
      }
    }
  ]
}
```

Events should be returned in chronological order.

Validation behavior:

- malformed `sessionId` (non-UUID): `400`
- unknown session: `404`
- existing session with no events yet: `200` with `"events": []`

Current query capabilities:

- supports `?limit=<n>` (capped to 1000, default 500)
- event-type filtering (for example `?type=SETTLEMENT.VERIFIED`) is planned as a future extension

Authorization behavior:

- timeline is internal/operator access
- if `SESSION_TIMELINE_API_KEY` (or `GATE_API_KEY`) is configured, caller must send matching `x-gate-api-key`

---

# 8. Debugging Benefits

This event log allows developers to answer key operational questions quickly:

```
Why did this payment fail?
Why was approval required?
Why did enforcement reject the settlement?
Did a replay attempt occur?
```

Instead of digging through logs, the answer becomes visible in the session timeline.

---

# 9. Observability Integration

The lifecycle event stream can later feed into:

- operator dashboards
- alerting systems
- analytics pipelines

Example metrics:

```
settlement_failures_by_reason
approval_rate
policy_denials
replay_attempts
```

---

# 10. Definition of Done

Sprint B is complete when:

- session_events table exists
- lifecycle events are emitted for all major transitions
- timeline API returns ordered session events
- settlement enforcement failures are visible in the timeline
- correlation identifiers are included in metadata

---

# Why This Matters

Parker is designed for **machine‑to‑machine payments**:

- autonomous cars
- parking infrastructure
- charging stations
- toll systems

These systems must provide a **clear audit trail**.

Without lifecycle observability, debugging failures becomes extremely difficult.

This sprint makes Parker **operationally transparent and production-ready**.

---

# Next Phase

After this sprint, the next major improvement is:

**Sprint C — Intent Binding**

Binding payment decisions to deterministic settlement quotes so that autonomous agents can execute payments safely and predictably.