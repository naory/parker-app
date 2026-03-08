# Parker Architecture Review - March 2026

Repo: https://github.com/naory/parker-app
Purpose: Snapshot review of the system architecture at HEAD before entering the Lifecycle Observability sprint.

---

# 1. System Overview

Parker is a multi-rail parking payment platform designed for machine-initiated transactions.

Core architectural idea:

Parking sessions are represented as on-chain artifacts, while operational logic runs off-chain with deterministic settlement verification.

Primary components:

- Hedera HTS - parking session NFT mint/burn
- x402 protocol - HTTP-native payment flow
- XRPL / EVM - crypto settlement rails
- Stripe - fiat fallback rail
- Policy engine - controls allowed payment rails/assets/caps
- PostgreSQL - operational index and session store

Parking is the first vertical, but the architecture is suitable for broader machine-to-machine payments.

---

# 2. Current Architecture Layers

The system now has four clear architectural layers.

## 2.1 Entry Layer

Responsible for parking session creation.

Flow:

ALPR scan -> entry API -> policy evaluation -> Hedera NFT mint -> session DB write

Important invariant:

NFT mint happens before DB write (write-ahead).

This guarantees that the blockchain record always exists even if the DB fails.

---

## 2.2 Policy Layer

The policy engine determines whether payment is allowed.

Policy evaluates:

- rail allowlists
- asset allowlists
- vendor/operator restrictions
- geo allowlists
- spending caps

Outputs:

- session policy grant (entry)
- payment decision (exit)

Important invariant:

Every payment decision is bound to a policy hash.

---

## 2.3 Settlement Layer

Settlement occurs through one of three rails.

Supported rails:

- XRPL
- EVM
- Stripe

Settlement verification is deterministic:

XRPL

Verify Payment transaction

EVM

Verify ERC-20 transfer

Stripe

Verify webhook confirmation

---

## 2.4 Enforcement Layer

Final gate before session closure.

Settlement must match the payment decision.

Checks include:

- rail match
- asset match
- amount match
- policy hash match
- session grant binding

This prevents settlement from bypassing the policy layer.

---

# 3. Security & Correctness Guarantees

The repository now enforces several important invariants.

## 3.1 Decision Binding

Each payment decision produces:

- decision_id
- policy_hash

XRPL payment intents must reference both.

Invariant:

payment intent.policy_hash == policy_decision.policy_hash

Enforced in:

- application layer
- database constraint
- settlement verification

---

## 3.2 Intent Binding

Payment intent must reference a valid decision.

Invariant:

intent.decision_id -> policy_decisions.decision_id

Protected by:

- foreign key
- DB trigger
- application validation

---

## 3.3 Settlement Verification

A settlement is only accepted if it matches the decision.

Required matches:

- rail
- asset
- quote amount
- destination

Otherwise settlement is rejected.

---

# 4. Resilience Design

Parker implements a layered resilience model.

Layer 1

PostgreSQL operational database

Layer 2

Hedera Mirror Node fallback

Layer 3

Gate-side session cache

This allows parking exits even if the database becomes unavailable.

---

# 5. Architecture Strengths

The system now has several strong architectural properties.

### Deterministic settlement

Payments cannot be accepted unless they match a prior decision.

### Multi-rail abstraction

The policy layer allows switching between settlement rails.

### Write-ahead blockchain state

On-chain record exists before DB record.

### Defense in depth

Invariants enforced in both application and database layers.

### Protocol-level thinking

The architecture resembles a generic machine payment protocol.

---

# 6. Current Architectural Gap

The system lacks operational observability.

While policy and settlement are enforced, the system cannot easily explain why a session behaved a certain way.

Examples:

- Why did payment require approval?
- Why was settlement rejected?
- Why was entry denied?

This motivates the next sprint.

---

# 7. Next Architecture Phase

Next step is Lifecycle Observability.

Goal:

Every session should produce a complete timeline of events.

Planned mechanism:

`session_events` table

Each major lifecycle step emits an event.

Example timeline:

SESSION_CREATED
POLICY_GRANT_ISSUED
PAYMENT_DECISION_CREATED
SETTLEMENT_VERIFIED
SESSION_CLOSED

This enables:

- debugging
- dispute resolution
- operational metrics

---

# 8. Strategic Direction

Although Parker is currently a parking platform, the architecture generalizes to agent-initiated payments.

Potential future domains:

- EV charging
- road tolling
- autonomous vehicle services
- robotic delivery payments

The combination of:

policy layer
intent binding
multi-rail settlement

creates the foundation for a machine payment control plane.

---

# 9. Summary

At the time of this review the Parker architecture provides:

- deterministic policy enforcement
- multi-rail settlement support
- blockchain-anchored session lifecycle
- layered resilience model

The next architectural step is to make the lifecycle observable and explainable.


# Parker Architecture Review — March 2026

Repo: https://github.com/naory/parker-app  
Purpose: Snapshot review of the system architecture at HEAD before entering the **Lifecycle Observability** sprint.

---

# 1. System Overview

Parker is a **multi‑rail parking payment platform** designed for machine‑initiated transactions.  

Core architectural idea:

Parking sessions are represented as **on‑chain artifacts**, while operational logic runs off‑chain with deterministic settlement verification.

Primary components:

• Hedera HTS — parking session NFT mint/burn  
• x402 protocol — HTTP-native payment flow  
• XRPL / EVM — crypto settlement rails  
• Stripe — fiat fallback rail  
• Policy engine — controls allowed payment rails/assets/caps  
• PostgreSQL — operational index and session store

Parking is the first vertical, but the architecture is suitable for broader **machine-to-machine payments**.

---

# 2. Current Architecture Layers

The system now has four clear architectural layers.

## 2.1 Entry Layer

Responsible for parking session creation.

Flow:

ALPR scan → entry API → policy evaluation → Hedera NFT mint → session DB write

Important invariant:

NFT mint happens **before DB write (write‑ahead)**.

This guarantees that the blockchain record always exists even if the DB fails.

---

## 2.2 Policy Layer

The policy engine determines whether payment is allowed.

Policy evaluates:

• rail allowlists  
• asset allowlists  
• vendor/operator restrictions  
• geo allowlists  
• spending caps

Outputs:

• session policy grant (entry)
• payment decision (exit)

Important invariant:

Every payment decision is bound to a **policy hash**.

---

## 2.3 Settlement Layer

Settlement occurs through one of three rails.

Supported rails:

• XRPL
• EVM
• Stripe

Settlement verification is deterministic:

XRPL

Verify Payment transaction

EVM

Verify ERC‑20 transfer

Stripe

Verify webhook confirmation

---

## 2.4 Enforcement Layer

Final gate before session closure.

Settlement must match the payment decision.

Checks include:

• rail match
• asset match
• amount match
• policy hash match
• session grant binding

This prevents settlement from bypassing the policy layer.

---

# 3. Security & Correctness Guarantees

The repository now enforces several important invariants.

## 3.1 Decision Binding

Each payment decision produces:

• decision_id  
• policy_hash

XRPL payment intents must reference both.

Invariant:

payment intent.policy_hash == policy_decision.policy_hash

Enforced in:

• application layer  
• database constraint  
• settlement verification

---

## 3.2 Intent Binding

Payment intent must reference a valid decision.

Invariant:

intent.decision_id → policy_decisions.decision_id

Protected by:

• foreign key
• DB trigger
• application validation

---

## 3.3 Settlement Verification

A settlement is only accepted if it matches the decision.

Required matches:

• rail
• asset
• quote amount
• destination

Otherwise settlement is rejected.

---

# 4. Resilience Design

Parker implements a layered resilience model.

Layer 1

PostgreSQL operational database

Layer 2

Hedera Mirror Node fallback

Layer 3

Gate‑side session cache

This allows parking exits even if the database becomes unavailable.

---

# 5. Architecture Strengths

The system now has several strong architectural properties.

### Deterministic settlement

Payments cannot be accepted unless they match a prior decision.

### Multi‑rail abstraction

The policy layer allows switching between settlement rails.

### Write‑ahead blockchain state

On‑chain record exists before DB record.

### Defense in depth

Invariants enforced in both application and database layers.

### Protocol‑level thinking

The architecture resembles a generic machine payment protocol.

---

# 6. Current Architectural Gap

The system lacks **operational observability**.

While policy and settlement are enforced, the system cannot easily explain *why* a session behaved a certain way.

Examples:

• Why did payment require approval?
• Why was settlement rejected?
• Why was entry denied?

This motivates the next sprint.

---

# 7. Next Architecture Phase

Next step is **Lifecycle Observability**.

Goal:

Every session should produce a complete timeline of events.

Planned mechanism:

`session_events` table

Each major lifecycle step emits an event.

Example timeline:

SESSION_CREATED  
POLICY_GRANT_ISSUED  
PAYMENT_DECISION_CREATED  
SETTLEMENT_VERIFIED  
SESSION_CLOSED

This enables:

• debugging
• dispute resolution
• operational metrics

---

# 8. Strategic Direction

Although Parker is currently a parking platform, the architecture generalizes to **agent‑initiated payments**.

Potential future domains:

• EV charging
• road tolling
• autonomous vehicle services
• robotic delivery payments

The combination of:

policy layer  
intent binding  
multi‑rail settlement

creates the foundation for a **machine payment control plane**.

---

# 9. Summary

At the time of this review the Parker architecture provides:

• deterministic policy enforcement  
• multi‑rail settlement support  
• blockchain‑anchored session lifecycle  
• layered resilience model

The next architectural step is to make the lifecycle **observable and explainable**.