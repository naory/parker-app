# Parker Threat Model

**Version:** 0.1  
**Date:** 2026-02-16  
**Scope:** Gate entry/exit, payments, Hedera NFT lifecycle, driver/gate apps, API.

## 1) System Security Goals

- Prevent unpaid exits and duplicate charging.
- Prevent duplicate session creation/closure under retries and race conditions.
- Preserve driver privacy (no plaintext plate data on-chain).
- Keep gates operational during partial outages (DB / network / webhook issues).
- Maintain auditable evidence for dispute resolution.

## 2) Trust Boundaries

- **Untrusted clients:** driver browser/app, gate browser/app, public internet.
- **Trusted backend boundary:** API server, DB, internal WebSocket channels.
- **External dependencies:** Hedera consensus + Mirror Node, Base RPC, Stripe webhooks.
- **Operator environment:** secrets manager / runtime env injection.

## 3) Key Threats and Mitigations

## A. Replay Attacks (API retries / duplicate requests)

**Threat:** attacker or flaky network replays entry/exit requests to mint extra sessions or close twice.  
**Impact:** duplicate billing, state corruption, inconsistent gate behavior.

**Mitigations (implemented):**

- DB-backed idempotency table for `gate:entry` and `gate:exit`.
- Mandatory `Idempotency-Key` on entry/exit endpoints.
- Request-hash binding: same key + different payload returns conflict.
- Completed requests return cached response, not re-executed side effects.

## B. Cloned Tickets / Forged Session Proof

**Threat:** attacker attempts to fabricate a valid parking ticket/session state.  
**Impact:** unpaid exits, fraudulent access.

**Mitigations (implemented):**

- Session proof anchored to Hedera HTS serial mint/burn lifecycle.
- Write-ahead minting: NFT minted before DB write.
- Mirror Node fallback verifies active NFT serial and decrypted metadata.
- Session close burns NFT serial to invalidate replayed proof.

## C. Plate Spoofing (visual impersonation / fake plate)

**Threat:** attacker uses spoofed plate to charge/vandalize another account or exit without valid ownership.  
**Impact:** fraud, disputes, wrong-account charging.

**Mitigations (implemented + operational):**

- ALPR normalization + confidence checks.
- Driver registration binding (wallet + normalized plate).
- Lot mismatch and active-session validations on exit.
- On-chain/off-chain evidence trail (entry/exit timestamps, token serial, payment tx).

**Operational controls recommended:**

- Add second-factor spot checks for low-confidence ALPR.
- Add camera image retention policy for dispute windows.

## D. Race Conditions (concurrent entry/exit attempts)

**Threat:** concurrent requests create duplicate active sessions or double-close session.  
**Impact:** inconsistent state, billing errors.

**Mitigations (implemented):**

- Partial unique index: one active session per plate.
- Idempotency keys on entry/exit mutations.
- Idempotent Stripe webhook processing.
- Pending payment watcher coordination before close.

## E. Gate Offline / Partial Outage

**Threat:** DB/network outage blocks gate exits during peak hours.  
**Impact:** queue buildup, availability failure.

**Mitigations (implemented):**

- Layered resilience:
  1. DB fast path
  2. Hedera Mirror Node fallback
  3. Gate-side session cache (offline-capable fallback)
- Best-effort DB reconciliation path after fallback close.

**Remaining hardening (planned):**

- Durable DB sync queue and reconciliation worker.
- Circuit breaker auto-failover.

## F. Payment Disputes (claimed mismatch / non-payment)

**Threat:** driver disputes charge or claims payment without settlement.  
**Impact:** support burden, potential revenue loss.

**Mitigations (implemented):**

- x402 on-chain ERC20 transfer verification.
- Stripe signed webhooks + payment IDs in session records.
- Immutable token serial lifecycle and tx references.
- Fee computation rules deterministic from lot config + duration.

## 4) Cryptographic & Secret Risks

### A. Metadata Disclosure

**Threat:** public chain observers infer plate history.  
**Mitigations:** hash + AES-256-GCM encrypted NFT metadata payload; no plaintext plate on-chain.

### B. Key Exposure

**Threat:** leaked Hedera private key / encryption key / webhook secret.  
**Mitigations:**

- Store secrets in managed secret stores (Vault / AWS Secrets Manager / Doppler).
- Runtime injection only; no plaintext secrets in git.
- Rotate secrets after suspected exposure.

## 5) Abuse Cases Checklist

- [x] Duplicate entry call with same idempotency key
- [x] Duplicate exit call with same idempotency key
- [x] Exit replay with mismatched request payload
- [x] DB unavailable on exit (Mirror Node fallback path)
- [x] Stripe webhook retried for already-closed session
- [ ] Plate spoofing with low-confidence OCR (needs policy + operator flow)
- [ ] Full offline reconciliation queue hardening

## 6) Incident Response (High Level)

- Detect: monitoring on failed exits, fallback activation rate, webhook failure rates.
- Contain: switch to fallback mode, isolate compromised credentials.
- Eradicate: rotate keys/secrets, patch vulnerable code path.
- Recover: replay queued reconciliations, verify mint/burn/session consistency.
- Learn: postmortem + threat model update.
