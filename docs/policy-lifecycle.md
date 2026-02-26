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
  (grantId, allowedRails,   (decisionId, priceFiat,  only if allowed
   allowedAssets, caps      settlementQuotes, chosen, EVM / XRPL / Stripe
   fiat minor, expiresAt)   sessionGrantId, rail, asset)
       │                        │
       └────────────────────────┘
         decision ⊆ grant
         (rail/asset/caps)
```

1. **Grant (entry)**  
   Entry policy is evaluated (lot, geo, rail/asset allowlists, risk). A `PolicyGrantRecord` is stored and its `grantId` is written to the session (`session.policyGrantId`). If risk is high or geo is missing, entry can still be allowed and the grant marked `requireApproval` so that payment will require approval. If no rails or (for crypto rails) no assets are allowed, entry is denied.

2. **Decision (exit)**  
   The API builds a payment context with **priceFiat** (fiat minor, lot currency) and **spendTotalsFiat** (session/day totals in fiat minor). Caps are compared in fiat only. The payment decision (allow/deny/require-approval) is stored in `policy_events` with `event_type = 'paymentDecisionCreated'`. The persisted payload includes **priceFiat**, **settlementQuotes** (Stripe + x402 with atomic amounts, destination, FX snapshot), and **chosen** (rail + quoteId). The decision must be within the entry grant. The decision always carries `sessionGrantId` when the session has a `policyGrantId`. If the grant has expired, the decision is forced to `REQUIRE_APPROVAL` and `GRANT_EXPIRED` is **appended** to reasons.

3. **Enforcement (settlement)**  
   Every settlement path (EVM watcher, XRPL verify route, Stripe webhook) calls `enforceOrReject(decisionId, settlement)` before closing. When the decision has **settlementQuotes**, enforcement matches by rail + quoteId or rail+asset, then checks **atomic amount** (strict), **destination** (operator wallet), and asset for on-chain rails. Otherwise (legacy) it checks rail, asset, and amount vs `maxSpend.perTxMinor`. **Replay** (txHash/paymentId uniqueness) is enforced by each route. If enforcement fails, `enforcementFailed` is stored and the session is **not** closed.

---

## Units

- **Caps and spend (policy)**  
  All caps (`capPerTxMinor`, `capPerSessionMinor`, `capPerDayMinor`) and spend totals are in **fiat minor** (lot currency, e.g. USD cents). Entry grant stores these; exit evaluation compares price and spend in fiat minor only. No mixing of fiat and stablecoin in cap checks.

- **Settlement (enforcement)**  
  Settlement is enforced in **atomic units** per rail: Stripe uses cents (2 decimals); x402 uses token smallest unit (e.g. 6 decimals for USDC). The decision’s **settlementQuotes** carry `AtomicAmount { amount, decimals }` and `destination`. Enforcement requires exact amount match and destination match when a quote is present.

- **Decision payload**  
  Persisted decision includes **priceFiat** (FiatMoneyMinor), **settlementQuotes** (each with amount, destination, expiresAt, optional **FxSnapshot** for x402), and **chosen** (rail, quoteId). This allows rehydration of expected atomic amount and destination from DB for enforcement.

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
- `payload`: full decision including **priceFiat**, **settlementQuotes** (Stripe + x402 with atomic amount, destination, FX snapshot), **chosen** (rail, quoteId), decisionId, policyHash, sessionGrantId, grantId, action, reasons, rail, asset, maxSpend, expiresAtISO
- `decision_id`, `session_id` for lookup

Settlement verification events use `settlementVerified` and `enforcementFailed` with `tx_hash` where applicable. Replay protection is enforced per rail.
