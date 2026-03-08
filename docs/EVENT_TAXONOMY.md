

# Parker Event Taxonomy

Purpose: Define the canonical lifecycle events emitted by the Parker system.

Events are append-only records that describe what happened during a parking session lifecycle.

They are used for:

• observability
• debugging
• dispute resolution
• analytics
• autonomous agent reasoning

---

# Event Naming Convention

All events follow this structure:

ENTITY.ACTION

Examples:

SESSION.CREATED  
POLICY.GRANT_ISSUED  
PAYMENT.DECISION_CREATED  
SETTLEMENT.VERIFIED

Rules:

• Uppercase
• Dot separated
• Immutable (never rename once published)
• Append-only (events are never modified)

---

# Base Event Schema

Every event shares the same base metadata.

Example:

{
  "event": "SETTLEMENT.VERIFIED",
  "timestamp": "2026-03-01T12:00:00Z",
  "sessionId": "...",
  "lotId": "...",
  "vehicleId": "...",
  "policyHash": "...",
  "decisionId": "...",
  "rail": "xrpl",
  "asset": "RLUSD",
  "details": {}
}

Fields:

sessionId  
lotId  
vehicleId  
timestamp  
policyHash (optional)  
decisionId (optional)  
rail (optional)  
asset (optional)  
details (free-form JSON)

---

# Core Session Lifecycle

These are the minimal lifecycle events that must exist for every session.

SESSION.CREATED  
SESSION.CLOSED  
SESSION.CANCELLED

---

# Entry / Gate Events

ENTRY.PLATE_DETECTED  
ENTRY.SCAN_FAILED  
ENTRY.POLICY_EVALUATED  
ENTRY.DENIED

---

# Policy Layer Events

POLICY.GRANT_ISSUED  
POLICY.GRANT_DENIED  
POLICY.DECISION_CREATED  
POLICY.APPROVAL_REQUIRED

---

# Payment Events

PAYMENT.QUOTE_CREATED  
PAYMENT.OPTION_SELECTED  
PAYMENT.DECISION_CREATED

---

# Settlement Events

SETTLEMENT.SUBMITTED  
SETTLEMENT.VERIFIED  
SETTLEMENT.REJECTED  
SETTLEMENT.REPLAY_DETECTED

---

# XRPL Specific Events

XRPL.INTENT_CREATED  
XRPL.INTENT_REJECTED  
XRPL.TX_VERIFIED  
XRPL.TX_INVALID

---

# Stripe Events

STRIPE.CHECKOUT_CREATED  
STRIPE.PAYMENT_CONFIRMED  
STRIPE.WEBHOOK_RECEIVED

---

# Minimal Implementation Set

The first implementation phase should emit only these events:

SESSION.CREATED  
POLICY.GRANT_ISSUED  
PAYMENT.DECISION_CREATED  
SETTLEMENT.VERIFIED  
SESSION.CLOSED

These form the canonical session timeline.

---

# Example Timeline

SESSION.CREATED  
POLICY.GRANT_ISSUED  
PAYMENT.DECISION_CREATED  
XRPL.INTENT_CREATED  
SETTLEMENT.VERIFIED  
SESSION.CLOSED

---

# Timeline API Example

Endpoint:

`GET /api/sessions/:sessionId/timeline`

Example response:

```json
{
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "state": "payment_required",
  "eventCount": 2,
  "events": [
    {
      "eventType": "SESSION.CREATED",
      "createdAt": "2026-03-08T12:00:00Z",
      "metadata": {
        "lotId": "lot_1",
        "vehicleId": "veh_1",
        "plateNumber": "1234567"
      }
    },
    {
      "eventType": "POLICY.GRANT_ISSUED",
      "createdAt": "2026-03-08T12:00:01Z",
      "metadata": {
        "grantId": "grant_1",
        "policyHash": "abc..."
      }
    }
  ]
}
```

Current query options:

- `?limit=<n>` is supported
- `?type=<EVENT_TYPE>` filtering is intentionally deferred for a later iteration

---

# Design Principles

1. Events are append-only.

2. Events are immutable once emitted.

3. Events describe facts, not state.

4. State machines should be derived from event sequences.

5. Events should never depend on application logs.

---

# Future Extensions

Possible additional event domains:

VEHICLE.*  
LOT.*  
POLICY.* updates  
RECONCILIATION.*  
FRAUD.* detection

These are intentionally excluded from the MVP lifecycle.