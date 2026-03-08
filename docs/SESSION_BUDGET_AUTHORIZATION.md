# Session Budget Authorization (SBA)

## Purpose

A **Session Budget Authorization (SBA)** is a signed policy artifact issued at **session entry** that defines the maximum allowed spending envelope for the session.

It provides deterministic guarantees for autonomous agents (vehicles, fleet systems, wallets) that a parking session can later be paid within a predefined budget and rule set.

SBA complements the existing Parker payment architecture:

```
Entry → Policy Grant → Session Budget Authorization
Exit  → Payment Decision → Signed Payment Authorization
Settlement → Enforcement → Session Close
```

The SBA ensures that all later payment decisions remain **bounded by a pre-authorized budget envelope**.

---

# Problem Statement

In an autonomous payment environment (autonomous vehicles, fleet systems, robot delivery platforms), relying only on **exit-time payment decisions** introduces uncertainty:

- vehicles may reach exit without guaranteed payment approval
- fleet policies may be violated unexpectedly
- payment authorization could fail due to policy mismatch
- operators cannot guarantee deterministic execution

Fleet operators need guarantees that a session **cannot exceed an approved spending envelope**.

The Session Budget Authorization solves this by defining:

- maximum spend
- allowed rails
- allowed assets
- allowed payment destinations
- expiry window

and cryptographically signing the budget envelope.

---

# Design Goals

SBA must:

• Bind a spending envelope to a **specific session**  
• Bind the envelope to a **specific policy snapshot**  
• Allow autonomous agents to verify the budget offline  
• Ensure all payment decisions remain within the authorized envelope  
• Support multiple payment rails (XRPL, EVM, Stripe)

---

# Non-Goals

SBA does **not**:

• Reserve or escrow funds  
• Guarantee wallet balances  
• Replace settlement verification  
• Replace Signed Payment Authorization

SBA is **a policy authorization artifact**, not a financial hold.

---

# Architecture Placement

The Parker lifecycle becomes:

```
SESSION.CREATED
      ↓
POLICY.GRANT_ISSUED
      ↓
SESSION_BUDGET_AUTHORIZATION.ISSUED
      ↓
PAYMENT.DECISION_CREATED
      ↓
SIGNED_PAYMENT_AUTHORIZATION.ISSUED
      ↓
SETTLEMENT.VERIFIED
      ↓
SESSION.CLOSED
```

SBA therefore represents the **maximum allowed envelope** while SPA represents the **specific payment instruction**.

---

# Authorization Object Schema

Example:

```json
{
  "version": 1,
  "budgetId": "bud_6f92c",
  "sessionId": "sess_8ac21",
  "vehicleId": "veh_92c1",
  "scopeId": "sess_8ac21",
  "policyHash": "a93fd2...",
  "currency": "USD",
  "minorUnit": 2,
  "budgetScope": "SESSION",
  "maxAmountMinor": "3000",
  "allowedRails": ["xrpl", "stripe"],
  "allowedAssets": [
    {
      "kind": "IOU",
      "currency": "RLUSD",
      "issuer": "rIssuer..."
    }
  ],
  "destinationAllowlist": [
    "rDestination..."
  ],
  "expiresAt": "2026-03-08T18:00:00Z"
}
```

`allowedAssets` is only enforced for rails that require an on-chain asset (`xrpl`, `evm`). It is ignored for hosted payment rails such as `stripe`.

`budgetScope` defines the logical scope of the spending envelope.  
In the initial Parker implementation the value is expected to be `SESSION`, meaning the budget applies only to the current parking session.  
Future implementations may support broader scopes such as `DAY`, `VEHICLE`, or `FLEET`.

## Budget Scope Values

| Value | Description |
|------|-------------|
| SESSION | Budget applies only to the current parking session |
| DAY | Budget applies across all sessions for the same vehicle during a day |
| VEHICLE | Budget applies across sessions for a specific vehicle |
| FLEET | Budget applies across multiple vehicles under a fleet policy |

`scopeId` identifies the entity that the budget scope applies to.  
For `SESSION` scope, `scopeId` should equal `sessionId`.  
Examples: `budgetScope: "VEHICLE"` with `scopeId: "veh_123"`, or `budgetScope: "FLEET"` with `scopeId: "fleet_abc"`.

---

# Field Definitions

| Field | Description |
|------|-------------|
| version | SBA schema version |
| budgetId | unique identifier |
| sessionId | Parker session |
| vehicleId | vehicle identifier |
| scopeId | identifier of the entity represented by `budgetScope` (e.g., session, vehicle, fleet) |
| policyHash | hash of policy snapshot |
| currency | fiat currency reference |
| minorUnit | decimal precision of the currency (e.g., USD = 2) |
| budgetScope | scope of the authorized budget (e.g., SESSION, DAY, VEHICLE, FLEET) |
| maxAmountMinor | max spend allowed |
| allowedRails | permitted payment rails |
| allowedAssets | permitted crypto assets |
| destinationAllowlist | allowed payment destinations |
| expiresAt | expiration timestamp |

---

# Signature Envelope

SBA is distributed as a signed artifact:

```
{
  "authorization": { ...SBA object... },
  "signature": "base64(signature)",
  "keyId": "parker-budget-signing-key-1"
}
```

---

# Signing Model

Recommended signature algorithm:

```
Ed25519
```

Signing process:

```
canonical_json(authorization)
        ↓
SHA256
        ↓
Ed25519 Sign
```

The signature must cover **only the authorization object**.

---

# Trust Model

Clients trust the Parker signing key.

Verification steps:

```
1 verify signature
2 verify expiration
3 verify policyHash
4 verify sessionId
5 enforce payment limits
```

The Parker backend later enforces settlement against both:

```
Signed Payment Authorization
Session Budget Authorization
```

---

# Decision Constraint Rules

Any payment decision must satisfy:

```
decision.amount ≤ budget.maxAmountMinor
decision.rail ∈ budget.allowedRails
decision.asset ∈ budget.allowedAssets
decision.destination ∈ destinationAllowlist
```

For scopes broader than `SESSION` (`DAY`, `VEHICLE`, `FLEET`), enforcement must apply this as a cumulative spend limit across the relevant scope window keyed by `scopeId`.

If any rule fails:

```
PAYMENT_DECISION_DENIED
```

---

# Settlement Constraint Rules

Settlement enforcement must confirm:

```
settlement.amount ≤ budget.maxAmountMinor
settlement.destination ∈ destinationAllowlist
settlement.asset ∈ allowedAssets
```

Additionally:

```
SPA constraints must also pass
```

---

# Replay Protection

Replay prevention relies on:

• session lifecycle enforcement  
• settlement replay detection  
• budget expiration window  

Budget reuse across sessions is not permitted.

---

# Storage

SBA may optionally be stored in:

```
policy_decisions
sessions
```

However the artifact can be reconstructed using:

```
budgetId
policyHash
sessionId
```

Storing the envelope is recommended for debugging.

---

# API Integration

Entry API may return:

```
POST /api/sessions/entry
```

Response:

```
{
  session,
  policyGrant,
  sessionBudgetAuthorization
}
```

Exit decisions must verify the budget before issuing a SPA.

---

# Timeline Event

When issued, emit:

```
SESSION_BUDGET_AUTHORIZATION.ISSUED
```

Metadata:

```
budgetId
maxAmountMinor
currency
minorUnit
budgetScope
scopeId
allowedRails
expiresAt
```

---

# XRPL Example

XRPL payment must satisfy:

```
Destination == destinationAllowlist
Amount ≤ maxAmountMinor
Currency/Issuer ∈ allowedAssets
```

The SPA generated later must also match the XRPL payment exactly.

---

# Security Model

SBA provides:

• deterministic payment envelope  
• protection against price manipulation  
• fleet spending controls  
• autonomous wallet verification  

However it does **not** guarantee wallet solvency.

Wallet solvency must be validated by the payer wallet itself.

---

# Future Extensions

Possible evolutions:

• multi-session fleet budgets  
• daily vehicle budgets  
• DID-based identity binding  
• multi-operator destination lists  
• escrow integration  
• prepaid parking models

---

# Summary

Session Budget Authorization establishes a **pre-authorized spending envelope** for a parking session.

Together with:

```
Policy Grant
Signed Payment Authorization
Settlement Enforcement
```

it creates a **complete, deterministic payment lifecycle suitable for autonomous systems**.