

# Signed Payment Authorization

## Purpose

A **Signed Payment Authorization (SPA)** is a cryptographically signed instruction produced by Parker after a payment policy decision is made.  
It allows an external agent (driver app, vehicle wallet, fleet system, etc.) to execute a payment while guaranteeing that the payment parameters were approved by Parker’s policy engine.

The SPA makes payment decisions:

- portable
- verifiable
- deterministic
- safe for autonomous agents

Instead of trusting UI state or API responses alone, the payer executes a payment that is bound to a **signed authorization artifact**.

---

# Problem Statement

In a machine‑to‑machine economy (autonomous vehicles, delivery robots, fleet systems), a payment flow must:

1. Prevent payment manipulation
2. Prevent policy bypass
3. Allow offline or asynchronous payment execution
4. Allow backend verification that the executed payment matched policy

Without a signed authorization artifact, clients could modify:

- amount
- destination
- asset
- payment rail

or replay previously valid decisions.

A **Signed Payment Authorization** solves this by binding a payment instruction to:

- a session
- a policy decision
- a quote
- a time window

and signing it with the Parker backend key.

---

# Goals

SPA must:

• Bind payment to a **specific policy decision**  
• Bind payment to a **specific amount + asset + destination**  
• Expire quickly to reduce replay risk  
• Be verifiable without database access  
• Work across different payment rails (XRPL, EVM, Stripe, etc.)

SPA must support:

- autonomous agents
- vehicle wallets
- server‑to‑server integrations

---

# Non‑Goals

SPA does **not**:

• Replace the policy engine  
• Replace settlement verification  
• Replace backend enforcement  

SPA is **not a payment transaction**.  
It is only an **authorization artifact**.

---

# Authorization Object Schema

Example:

```json
{
  "version": 1,
  "decisionId": "dec_8c2b4",
  "sessionId": "sess_93a21",
  "policyHash": "4c0f2c...",
  "quoteId": "quote_17",
  "rail": "xrpl",
  "asset": {
    "kind": "IOU",
    "currency": "RLUSD",
    "issuer": "rIssuer..."
  },
  "amount": "19440000",
  "destination": "rDestination...",
  "expiresAt": "2026-03-08T14:00:00Z"
}
```

Fields:

| Field | Description |
|-----|-----|
| version | SPA schema version |
| decisionId | ID of the policy decision |
| sessionId | Parker session ID |
| policyHash | hash of policy snapshot used |
| quoteId | settlement quote identifier |
| rail | payment rail (xrpl, evm, stripe, etc.) |
| asset | payment asset |
| amount | payment amount in atomic units |
| destination | operator payment address |
| expiresAt | authorization expiration timestamp |

---

# Signed Authorization Envelope

The SPA is wrapped in a signature envelope:

```
{
  "authorization": { ...SPA object... },
  "signature": "base64(signature)",
  "keyId": "parker-signing-key-1"
}
```

---

# Signature Model

Signing algorithm:

Recommended:

```
Ed25519
```

Reasons:

• fast verification  
• small signatures  
• simple key management  

Signature input:

```
SHA256(canonical_json(authorization))
```

Parker signs the **digest bytes** above (not raw canonical JSON bytes).

Verification must recompute the same digest and verify the signature over that digest.

The signature must cover **only the authorization object**.

---

# Trust Model

The payer trusts:

```
Parker signing key
```

Verification steps for client:

1. compute `SHA256(canonical_json(authorization))`
2. verify signature over that digest
3. check expiration
4. check payment parameters
5. execute payment

The Parker backend later verifies:

```
settlement matches authorization
```

---

# Issuance Flow

```
SESSION.CREATED
      ↓
POLICY.GRANT_ISSUED
      ↓
PAYMENT.DECISION_CREATED
      ↓
SPA GENERATED + SIGNED
      ↓
RETURNED TO CLIENT
```

API response example:

```
{
  "decision": {...},
  "paymentAuthorization": {...signed SPA...}
}
```

---

# Settlement Verification Flow

When a payment arrives:

```
XRPL tx
EVM tx
Stripe webhook
```

Parker verifies:

1. decision exists
2. authorization signature valid
3. authorization not expired
4. rail matches
5. asset matches
6. amount matches
7. destination matches

If any condition fails:

```
REJECT settlement
```

---

# Replay Protection

Replay protection mechanisms:

• SPA expiration window (5 minutes recommended)  
• unique decisionId  
• settlement replay detection (txHash uniqueness)  
• session lifecycle constraints  

---

# Storage

SPA does **not require storage**.

The backend already persists:

```
policy_decisions
sessions
settlements
```

SPA can always be reconstructed from:

```
decisionId
```

However, storing the SPA envelope in the decision record may simplify debugging.

----

# API Integration

Exit API response example:

```
POST /api/sessions/{id}/exit

Response:
{
  decision: PaymentPolicyDecision,
  paymentAuthorization: SignedPaymentAuthorization
}
```

---

# XRPL Example

The SPA parameters translate directly to XRPL payment parameters:

```
Destination
Amount
Currency
Issuer
Memo (decisionId)
```

The settlement verifier ensures:

```
tx matches SPA
```

---

# Future Extensions

Possible extensions:

• multi‑rail authorizations  
• batched authorizations  
• pre‑authorized wallet allowances  
• fleet payment orchestration  
• DID‑based key discovery  

---

# Summary

Signed Payment Authorization provides:

• deterministic payment instructions  
• verifiable agent payments  
• strong backend enforcement  
• compatibility with autonomous systems

SPA turns Parker’s policy decision into a **portable cryptographic contract** between the operator and the payer.