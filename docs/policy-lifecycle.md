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
  • grantAction         • decisionId            only if allowed
  • grantId             • policyHash            • EVM watcher
  • policyHash          • priceFiat + quotes    • XRPL verify route
  • allowedRails        • sessionGrantId        • Stripe webhook
  • allowedAssets       • chosen rail/asset
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
   Entry policy is evaluated (lot, operator/vendor, geo, rail/asset allowlists, risk). A `PolicyGrantRecord` is stored and its `grantId` is written to the session (`session.policyGrantId`). The grant carries explicit `grantAction` (`ALLOW | DENY | REQUIRE_APPROVAL`) so callers do not infer from empty allowlists. Parker currently uses **allow entry + block payment** for `REQUIRE_APPROVAL` (sets `approval_required_before_payment=true` on session). If no rails or (for crypto rails) no assets are allowed, entry is denied.

2. **Decision (exit)**  
   The API builds a payment context with **priceFiat** (fiat minor, lot currency) and **spendTotalsFiat** (session/day totals in fiat minor). Caps are compared in fiat only. The payment decision (allow/deny/require-approval) is stored in `policy_events` with `event_type = 'paymentDecisionCreated'`. The persisted payload includes **priceFiat**, **settlementQuotes** (Stripe + x402 with atomic amounts, destination, FX snapshot), and **chosen** (rail + quoteId). The decision must be within the entry grant. The decision always carries `sessionGrantId` when the session has a `policyGrantId`. If the grant has expired, the decision is forced to `REQUIRE_APPROVAL` and `GRANT_EXPIRED` is **appended** to reasons.

3. **Enforcement (settlement)**  
   Every settlement path calls **enforceOrReject()** before closing the session or burning NFT:
   - **Stripe webhook**: enforceOrReject → then settlementVerified → endSession (+ Hedera burn if enabled).
   - **XRPL verify route**: enforceOrReject → then settlementVerified → resolve intent → endSession (+ Hedera burn).
   - **EVM watcher**: enforceOrReject → then settlementVerified → settleSession (endSession + Hedera burn if enabled).

   The **decision source of truth** is `policy_decisions.payload` (with `policy_events` fallback); enforcement references **decisionId** (lookup) and the payload contains **sessionGrantId** and **policyHash**. **Minimum checks**: rail match, asset match (if applicable), amount (exact when quote present; otherwise ≥ allowed per cap), destination match, tx uniqueness / replay protection (`hasSettlementForTxHash`). If enforcement fails, `enforcementFailed` is stored and the session is **not** closed.

---

## Money types and unit rules

We split money types so one “currency” field does not mean two different things:

- **FiatMinor** (policy-core: `FiatMoneyMinor`): `amountMinor` + `currency` (ISO 4217). Used for caps and spend totals in lot currency. All fiat cap checks use this; spend comes from `getFiatSpendTotalsByCurrency(plate, currency)` (same currency as lot), then converted to minor for comparison.
- **AssetAtomic** (policy-core: `AtomicAmount`): `amount` (string, smallest unit) + `decimals`. Used for on-chain settlement (Stripe cents, USDC 6 decimals). No currency field; asset identity is rail+asset (e.g. ERC20 chainId+token).

**Cap checks (apples-to-apples):**

- **Fiat caps** compare vs **fiat spend**: `capPerTxMinor`, `capPerSessionMinor`, `capPerDayMinor` are in fiat minor (lot currency); spend totals are in the same currency and converted to minor. No mixing of fiat and stablecoin in these checks.
- **Asset caps** (if added later) would compare vs **asset spend** (stablecoin atomic); today only fiat caps are used.

## Units (summary)

- **Caps and spend (policy)**  
  All caps and spend totals are in **fiat minor** (lot currency). **Spend totals** come from `getFiatSpendTotalsByCurrency(plate, currency)`; **quote_currency** in the decision record is the same lot currency. Exit evaluation compares in the same unit (apples-to-apples).

- **Settlement (enforcement)**  
  Settlement is enforced in **atomic units** per rail (`AtomicAmount`): Stripe cents (2 decimals); x402 token smallest unit (e.g. 6 for USDC). The decision’s **settlementQuotes** carry `AtomicAmount` and `destination`. Enforcement requires exact amount match and destination match when a quote is present.

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
| `XRPL_DESTINATION_TAG` | Optional exact destination tag to require on inbound XRPL payments. |
| `XRPL_REQUIRE_DESTINATION_TAG` | If `true`, destination tag must be present. |
| `XRPL_ALLOW_ANY_DESTINATION_TAG` | If `true`, allows any destination tag when exact tag is not configured. Default is strict (unexpected tag rejected). |

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
