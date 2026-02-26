# Policy Lifecycle

Policy in Parker has three phases: **Grant** (entry), **Decision** (exit), and **Enforcement** (settlement). No session is closed until enforcement passes.

## Lifecycle diagram: Grant → Decision → Enforcement

```
  ┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
  │   ENTRY     │     │    EXIT     │     │   SETTLEMENT     │
  │   Grant     │     │  Decision   │     │  Enforcement     │
  └──────┬──────┘     └──────┬──────┘     └────────┬────────┘
         │                   │                      │
         ▼                   ▼                      ▼
  evaluateEntryPolicy   evaluatePaymentPolicy   enforceOrReject
  (lot, geo, rails,     (priceFiat, spendFiat,  (decisionId,
   assets, risk)         caps in fiat)           settlement)
         │                   │                      │
         ▼                   ▼                      ▼
  PolicyGrantRecord     PaymentPolicyDecision   Session close
  • grantId             • decisionId            only if allowed
  • policyHash          • priceFiat + quotes    • EVM watcher
  • allowedRails        • sessionGrantId       • XRPL verify route
  • allowedAssets       • chosen rail/asset     • Stripe webhook
  • caps (fiat minor)   • action, reasons       Replay: txHash/
  • expiresAt           Persisted in             paymentId unique
  • requireApproval      policy_decisions
  Session: policyGrantId + approvalRequiredBeforePayment (if requireApproval)
         │                   │
         └───────────────────┘
           decision ⊆ grant (rail, asset, caps)
           Invariant: session.policyGrantId ⇒ decision.sessionGrantId
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

Policy restricts which rails and assets are allowed via **railAllowlist** and **assetAllowlist**. Environment knobs below determine what the lot *offers*; policy then filters to what is *allowed* for the session.

### XRPL assets

| Variable           | Meaning |
|--------------------|--------|
| `XRPL_ISSUER`      | **Required** for XRPL IOU. If unset, XRPL IOU is not offered (fail closed). |
| `XRPL_IOU_CURRENCY`| Currency code for XRPL IOU (default `RLUSD`). Used only when `XRPL_ISSUER` is set. |
| `XRPL_ALLOW_XRP`   | If `true`, XRP is offered as an asset. Default unset → XRP not offered. |

Entry/exit policy **assetAllowlist** can further restrict (e.g. only IOU from a specific issuer). Grant stores `allowed_assets`; decision must choose from that set.

### Other

| Variable              | Meaning |
|-----------------------|--------|
| `PLATFORM_POLICY_JSON`| Optional JSON string for platform policy (allowlists, caps). |
| `X402_STABLECOIN`     | Stablecoin symbol (e.g. `USDC`) for quote and settlement. |
| `X402_NETWORK`        | Network for x402 (e.g. `xrpl:testnet`, `base-sepolia`). |

---

## Decision persistence

Each payment decision is stored in two places:

1. **`policy_decisions`** (first-class table): `decision_id`, `policy_hash`, `session_grant_id`, `chosen_rail`, `chosen_asset`, `quote_minor`, `quote_currency`, `created_at`, `expires_at`, `action`, `reasons`, `require_approval`, `payload`. Used for enforcement lookup.

2. **`policy_events`**: `event_type = 'paymentDecisionCreated'`, same payload for audit. `getDecisionPayloadByDecisionId` reads from `policy_decisions` first, then falls back to events.

Settlement verification events use `settlementVerified` and `enforcementFailed` with `tx_hash` where applicable. Replay protection (txHash/paymentId uniqueness) is enforced by each settlement handler before session close.
