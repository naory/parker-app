# Why This Cannot Be Solved Cleanly in Web2

## The Problem

Parking infrastructure today relies on fragmented systems:

- Parking apps (e.g., mobile payment apps)
- Gate hardware
- Payment processors
- Municipal operators
- Private lot operators

Each system maintains its own database and its own version of truth.

When something fails — duplicate scan, payment dispute, gate misfire — there is no shared, cryptographically verifiable source of state.

Everything becomes:

- Log comparison
- Customer support escalation
- Trust-based reconciliation

At scale, this becomes expensive and brittle.

---

## Why Web2 Breaks Down

A Web2 architecture can coordinate parking sessions using centralized APIs.

But it cannot solve:

### 1. Multi-Party State Without Trust

Entry and exit involve at least:

- Driver app
- Gate controller
- Operator backend
- Payment provider

In Web2:

- Each party trusts another party's database.
- Disputes are resolved by authority, not proof.

There is no neutral, tamper-resistant state machine.

---

### 2. Cross-App Interoperability

If a city has:

- 3 parking apps
- 5 private operators
- 2 different gate vendors

Web2 requires bilateral integrations between every pair.

This becomes O(n^2) integration complexity.

With on-chain session tokens:

- Entry mints session
- Exit burns session
- Any compliant app can read state

The ledger becomes the shared interface.

---

### 3. Deterministic Lifecycle Finality

Web2 systems can mark a session as "closed."

But:

- Records can be modified.
- Audit logs can be altered.
- Settlement disputes require reconciliation.

A burn transaction creates:

- Immutable finality
- Verifiable timestamp
- Public proof of settlement event

No operator can silently rewrite history.

---

### 4. Payment-Linked State Transitions

In Web2:

- Payment and session closure are loosely coupled.
- Payment webhooks fail.
- Gates misalign with payment confirmation.

On-chain lifecycle enables:

Entry -> NFT Mint  
Exit -> NFT Burn -> Payment Trigger

The session state becomes programmable.

Settlement can be cryptographically tied to lifecycle completion.

---

### 5. Fraud & Replay Resistance

Common Web2 attack surfaces:

- Reused QR codes
- Duplicate exit scans
- Session cloning
- Backend race conditions

An NFT session:

- Exists once
- Can be burned once
- Cannot be replayed

The state machine enforces uniqueness.

---

## The Architectural Shift

Instead of:

App <-> Backend <-> Gate <-> Payment Provider

The model becomes:

Physical Event -> On-Chain State Change -> Deterministic Settlement

The ledger acts as:

- Shared coordination layer
- Neutral arbiter
- Settlement trigger engine

---

## What This Enables

- Multi-operator interoperability
- Reduced reconciliation costs
- Real-time audit trails
- Programmable pricing rules
- Cross-border stablecoin settlement
- Public infrastructure accountability

This is not about "NFTs for parking."

It is about:  
Tokenizing session state in physical infrastructure.

---

## Summary

Web2 can simulate this.

But it cannot provide:

- Neutral shared truth
- Immutable lifecycle finality
- Trust-minimized multi-party coordination
- Atomic settlement tied to physical state

For fragmented physical infrastructure, that difference matters.
