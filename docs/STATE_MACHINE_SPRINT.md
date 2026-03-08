Sprint A — Lifecycle Hardening (State Machine & DB Invariants)

Objective

Formalize the Parker payment lifecycle and enforce system invariants so that race conditions, duplicate settlements, and replay attacks cannot violate economic safety.

This sprint introduces:
	•	explicit session state machines
	•	decision consumption guarantees
	•	settlement replay protection
	•	database-level safety constraints
	•	state transition tests

Goal: move Parker from working prototype to economically safe infrastructure.

1. Current Flow (Implicit Lifecycle)

Today the lifecycle is mostly enforced in code:

ENTRY
  → session created
  → policy grant issued

EXIT
  → payment decision created
  → settlement intent issued

SETTLEMENT
  → payment verified
  → enforcement check
  → session closed

The logic works, but the lifecycle is not formally defined.

Sprint A converts this to an explicit state machine.

2. Target Session State Machine

Session lifecycle

pending_entry
   ↓
active
   ↓
payment_required
   ↓
payment_verified
   ↓
closed

Failure / review paths

active → denied
payment_required → payment_failed
payment_required → approval_required
payment_required → expired

3. Payment Decision Lifecycle

A decision is the binding authorization for settlement.

created
  ↓
consumed
  ↓
expired

Invariant:

A decision may only be consumed once.

4. Settlement Lifecycle

Settlement results come from:
	•	XRPL verification route
	•	EVM watcher
	•	Stripe webhook

Lifecycle:

pending
  ↓
verified
  ↓
rejected

5. Core System Invariants

These must always hold true.

Session invariants

Only one active session per vehicle per lot.

A closed session cannot reopen.

A session cannot close without settlement verification.

Decision invariants

Every decision must reference a session grant.

A decision may only be used once.

Expired decisions cannot authorize settlement.

Settlement invariants

A settlement txHash may only be used once.

A settlement must match the decision rail.

A settlement must match the decision asset.

A settlement must match the quoted amount.

A settlement must match the operator destination address.

6. Database Constraints

Move key safety guarantees into the database.

Active session constraint

Ensure only one active session per vehicle per lot.

Example partial index:

UNIQUE(vehicle_id, lot_id)
WHERE state = 'active'

Settlement replay protection

Prevent tx replay across sessions.

UNIQUE(tx_hash)

Decision consumption

Prevent reuse of the same decision.

UNIQUE(decision_id)

Optional stronger constraint:

UNIQUE(decision_id, rail)

Session closure safety

A session may transition to closed only if:

settlement_verified = true

7. API Enforcement Tasks

Entry Route

Tasks:
	•	assert no active session exists
	•	create session in active state
	•	evaluate entry policy
	•	persist policyGrantId
	•	mint entry NFT (if enabled)

Exit Route

Tasks:
	•	assert session state = active
	•	evaluate payment policy
	•	create payment decision
	•	persist decisionId
	•	transition session → payment_required

Settlement Handlers

Applies to:
	•	XRPL verification route
	•	EVM watcher
	•	Stripe webhook

Tasks:
	1.	verify settlement
	2.	enforce policy decision
	3.	assert session still open
	4.	transition session → payment_verified
	5.	close session

8. Tests To Add

State transition tests

active → payment_required
payment_required → payment_verified
payment_verified → closed

Invalid transition tests

closed → payment_required   ❌
closed → payment_verified   ❌
expired decision → verified ❌

Replay tests

same txHash twice → rejected
same decision twice → rejected

Race condition tests

two settlement verifications in parallel
→ only one closes session

9. Observability (Recommended)

Add lifecycle event logs:

SESSION_CREATED
POLICY_GRANT_ISSUED
PAYMENT_DECISION_CREATED
SETTLEMENT_VERIFIED
SESSION_CLOSED

Include correlation identifiers:

sessionId
decisionId
txHash
policyHash

This makes debugging production issues dramatically easier.

9.1 Lifecycle Event Update (SBA + SPA)

To reflect budget-first authorization and then decision-specific authorization, the lifecycle event chain is:

POLICY.GRANT_ISSUED
SESSION_BUDGET_AUTHORIZATION.ISSUED
PAYMENT.DECISION_CREATED
SIGNED_PAYMENT_AUTHORIZATION.ISSUED

10. Definition of Done

Sprint A is complete when:
	•	lifecycle states explicitly defined
	•	DB constraints enforce invariants
	•	settlement replay impossible
	•	decision reuse impossible
	•	lifecycle transition tests passing
	•	settlement enforcement tests passing

Why This Sprint Matters

Parker is intended for autonomous payments: cars, agents, devices.

That means the system must be:
	•	deterministic
	•	replay-safe
	•	race-safe
	•	economically secure

This sprint establishes the core payment safety model required for an agent-driven economy.