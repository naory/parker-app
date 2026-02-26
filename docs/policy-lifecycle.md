# Policy Lifecycle

Policy in Parker has three phases: **Grant** (entry), **Decision** (exit), and **Enforcement** (settlement). No session is closed until enforcement passes.

## Lifecycle diagram

```
  Entry                    Exit                      Settlement
  ─────                    ────                      ───────────
  Policy                   Quote + spend             Verified payment
  evaluation    ──────►   Decision     ──────►      enforceOrReject
       │                        │                           │
       ▼                        ▼                           ▼
  PolicyGrantRecord         PaymentPolicyDecision      Session close
  (grantId, allowedRails,   (decisionId, rail,        only if allowed
   allowedAssets, caps,      asset, maxSpend,
   expiresAt, requireApproval)  sessionGrantId)       EVM / XRPL / Stripe
       │                        │
       └────────────────────────┘
         decision ⊆ grant
         (rail/asset/caps)
```

1. **Grant (entry)**  
   Entry policy is evaluated (lot, geo, rail/asset allowlists, risk). A `PolicyGrantRecord` is stored and its `grantId` is written to the session (`session.policyGrantId`). If risk is high or geo is missing, entry can still be allowed and the grant marked `requireApproval` so that payment will require approval. If no rails or (for crypto rails) no assets are allowed, entry is denied.

2. **Decision (exit)**  
   When the driver requests payment options, the API builds a payment context (quote and spend in **stablecoin minor** units, rails and assets offered from settlement). The payment decision (allow/deny/require-approval) is stored in `policy_events` with `event_type = 'paymentDecisionCreated'`. The decision must be within the entry grant (rail ∈ grant.allowedRails, asset ∈ grant.allowedAssets, caps at least as strict). The decision always carries `sessionGrantId` when the session has a `policyGrantId` (audit invariant). If the grant has expired, the decision is forced to `REQUIRE_APPROVAL` and `GRANT_EXPIRED` is **appended** to the existing reasons (not replaced).

3. **Enforcement (settlement)**  
   Every settlement path (EVM watcher, XRPL verify route, Stripe webhook) calls `enforceOrReject(decisionId, settlement)` before closing the session. Enforcement checks:
   - **Rail** match  
   - **Asset** match (skipped for `stripe` / `hosted`)  
   - **Amount** ≤ decision `perTxMinor` cap  
   - **Destination** and **tx uniqueness** are enforced by the route (receiver check, replay by `tx_hash`).  

   If enforcement fails, an `enforcementFailed` event is stored and the session is **not** closed.

---

## Unit conventions

| Context        | Unit              | Meaning |
|----------------|-------------------|--------|
| **Fiat**       | Lot currency      | Display and DB spend totals (e.g. USD, EUR). `getSpendTotalsFiat` returns `dayTotalFiat`, `sessionTotalFiat` in fiat. |
| **Stablecoin minor** | Integer, 6 decimals for USDC | Quote, spend, and caps in policy and settlement. Same unit as on-chain (e.g. 1 USDC = 1_000_000 minor). FX converts lot currency → stablecoin; policy uses stablecoin minor only. |
| **MoneyMinor.currency** | Stablecoin symbol (e.g. `USDC`) | In payment context, `quote.currency` is the stablecoin symbol so that policy and caps are clearly in stablecoin, not fiat. |

Caps (`capPerTxMinor`, `capPerSessionMinor`, `capPerDayMinor`) and `requireApprovalOverMinor` are always in **stablecoin minor**. Spend totals passed into the payment context are converted from fiat to stablecoin minor in the API before calling policy-core.

---

## Environment (policy / settlement)

| Variable           | Meaning |
|--------------------|--------|
| `XRPL_ISSUER`      | **Required** for XRPL IOU. If unset, XRPL IOU is not offered (fail closed). |
| `XRPL_IOU_CURRENCY`| Currency code for XRPL IOU (default `RLUSD`). Used only when `XRPL_ISSUER` is set. |
| `XRPL_ALLOW_XRP`   | If `true`, XRP is offered as an asset. Default unset → XRP not offered. |
| `PLATFORM_POLICY_JSON` | Optional JSON string for platform policy (allowlists, caps). |
| `X402_STABLECOIN`  | Stablecoin symbol (e.g. `USDC`) for quote and settlement. |
| `X402_NETWORK`      | Network for x402 (e.g. `xrpl:testnet`, `base-sepolia`). |

---

## Decision persistence

Each payment decision is stored in `policy_events` with:

- `event_type = 'paymentDecisionCreated'`
- `payload`: full decision (decisionId, policyHash, sessionGrantId, action, reasons, rail, asset, maxSpend, expiresAtISO)
- `decision_id`, `session_id` for lookup

Settlement verification events use `settlementVerified` and `enforcementFailed` with `tx_hash` where applicable. Replay protection is enforced per rail (e.g. `tx_hash` uniqueness for XRPL, `hasSettlementForTxHash` for EVM).
