# Parker — Use Cases & Fallback Scenarios

Single reference for all use cases, resilience patterns, and edge-case handling in the Parker parking system.

---

## 1. QR Code Payment Fallback

**Problem:** The driver's WebSocket connection may drop before the payment request arrives.

**Behavior:** When the gate is waiting for payment and the driver hasn't responded via WebSocket, the gate UI displays a QR code linking to the payment page with the fee and session details embedded. The driver scans the QR code to complete payment manually.

**Primary file:** `apps/gate/src/app/page.tsx`

---

## 2. DB-Down Mirror Node Fallback

**Problem:** PostgreSQL may be unreachable during exit, preventing session lookup.

**Behavior:** When the database query fails during exit, the system falls back to the Hedera Mirror Node REST API. It scans recent NFTs in the collection to find an active (not burned) NFT matching the driver's plate hash, extracts entry time and lot info from the on-chain metadata, and calculates the fee from that data. The gate proceeds normally.

**Primary file:** `apps/api/src/routes/gate.ts` (lines ~209-250)

---

## 3. NFT Write-Ahead Resilience

**Problem:** If the DB write fails after entry, there's no record of the parking session.

**Behavior:** On entry, the Hedera NFT is minted **before** writing the session to the database. If the DB write fails but the NFT mint succeeded, the system logs a warning and returns the NFT serial as proof of entry. The on-chain record serves as the source of truth, and the session can be recovered later via Mirror Node scan.

**Primary file:** `apps/api/src/routes/gate.ts` (lines ~105-144)

---

## 4. Gate-Side Offline Cache

**Problem:** Both the database and Mirror Node may be unreachable during exit.

**Behavior:** The gate app maintains an in-memory session cache (a `Map`) populated from WebSocket entry events. If the API is unreachable during exit, it validates against this local cache and opens the gate with deferred payment. Sessions older than 24 hours are auto-pruned, and the cache is capped at 500 entries.

**Primary file:** `apps/gate/src/hooks/useSessionCache.ts`

---

## 5. Grace Period

**Problem:** Drivers who enter and leave quickly (e.g., wrong lot) shouldn't be charged.

**Behavior:** The `calculateFee()` function accepts a `gracePeriodMinutes` parameter (default 0). If the parking duration is less than or equal to this period, the fee is zero and the driver exits for free. Each lot can configure its own grace period.

**Primary file:** `packages/core/src/utils.ts` (lines ~80-99)

---

## 6. Encrypted NFT Metadata

**Problem:** On-chain NFT metadata in plaintext (`plateHash|lotId|entryTime`) leaks information. A stalker who observes a car entering a lot can correlate the NFT by lot + time, extract the `plateHash`, and track the car across all lots forever — keccak256 is deterministic and license plates are low-entropy (rainbow-tableable).

**Behavior:** The entire metadata payload is encrypted with AES-256-GCM using a server-held key (`NFT_ENCRYPTION_KEY`, required) and a random IV per NFT. On-chain data appears as opaque binary. The API refuses to start without a valid key configured.

**Format:** `[1B version=0x01][12B IV][NB ciphertext][16B auth tag]`

**Primary file:** `packages/hedera/src/crypto.ts`

---

## 7. Lot Capacity Check

**Problem:** More cars shouldn't enter than the lot can hold.

**Behavior:** On entry, the system checks the count of active sessions against the lot's defined capacity. If the lot is full, entry is rejected with a 409 Conflict status. Lots without a capacity setting have unlimited entry.

**Primary file:** `apps/api/src/routes/gate.ts` (lines ~90-94)

---

## 8. Duplicate Session Prevention

**Problem:** Race conditions could create multiple active sessions for the same plate.

**Behavior:** A PostgreSQL unique partial index on `sessions(plate_number) WHERE status = 'active'` ensures only one active session per plate at any time. Attempts to create a duplicate are rejected at the database level.

**Primary file:** `apps/api/src/db/schema.sql` (lines ~41-43)

---

## 9. Lot Mismatch Detection

**Problem:** A driver might try to exit from a lot they didn't enter.

**Behavior:** During exit, the system compares the session's `lotId` with the exit request's `lotId`. If they differ, the request is rejected with a 400 error ("Lot mismatch"). The driver must exit from the same lot they entered.

**Primary file:** `apps/api/src/routes/gate.ts` (lines ~193-198)

---

## 10. Stripe Webhook Idempotency

**Problem:** Stripe may deliver the same webhook event multiple times.

**Behavior:** The webhook handler checks if the session is still active before closing it. If the session is already closed (from a prior delivery), the handler logs a warning and returns 200 without error, preventing duplicate processing.

**Primary file:** `apps/api/src/routes/webhooks.ts` (lines ~72-76)

---

## 11. Stripe Webhook DB-Down Fallback

**Problem:** The database may be unreachable when a Stripe payment-confirmation webhook arrives.

**Behavior:** If the DB is unavailable during webhook processing, the system falls back to the Hedera Mirror Node to find and burn the parking NFT, then notifies the gate to open via WebSocket. The payment confirmation is honored even if the DB write fails — the on-chain burn is the authoritative record.

**Primary file:** `apps/api/src/routes/webhooks.ts` (lines ~124-165)

---

## 12. WebSocket Auto-Reconnect

**Problem:** The driver's WebSocket connection may drop due to network issues.

**Behavior:** The driver app's WebSocket hook sets a 5-second reconnect timer in the `onclose` handler. The timer is cleared on component unmount to prevent memory leaks. Reconnection is automatic and transparent to the user.

**Primary file:** `apps/driver/src/hooks/useParkerSocket.ts` (lines ~52-56)

---

## 13. ALPR Country-Aware Detection

**Problem:** License plate formats vary by country.

**Behavior:** The ALPR service accepts an optional `countryCode` parameter (ISO 3166-1 alpha-2). When provided, normalization is restricted to that country's plate format rules. When omitted, it tries all known formats (IL first, then EU generic). The deployment's `DEPLOYMENT_COUNTRIES` env var configures the default set.

**Primary files:** `packages/alpr/src/normalize.ts`, `apps/api/src/routes/gate.ts`

---

## 14. Multi-Currency Payment Rails

**Problem:** Lots in different countries charge in local currency, but on-chain payments use stablecoins.

**Behavior:** Each lot stores a `currency` field (e.g., "EUR", "GBP"). The pricing service converts local currency fees to the configured stablecoin (default USDC) using static FX rates from environment variables (e.g., `FX_RATE_EUR_USD=1.08`). Drivers see the local currency amount; the blockchain transaction settles in stablecoin.

**Primary file:** `apps/api/src/services/pricing.ts`

---

## 15. Lot Name & Address Display

**Problem:** Both apps previously showed only the internal lot ID (e.g., "lot-01"), which is meaningless to drivers and operators.

**Behavior:** The gate app fetches lot name and address from `GET /api/gate/lot/:lotId/status` on mount and displays them in the page header (replacing "Live Gate"). The sidebar shows the lot ID as a subtitle. In the driver app, the active session card and session detail page show the lot name instead of the raw ID, and the address is rendered as a clickable Google Maps link (`https://www.google.com/maps/search/?api=1&query=...`).

**Primary files:** `apps/gate/src/app/page.tsx`, `apps/gate/src/app/layout.tsx`, `apps/driver/src/components/SessionCard.tsx`, `apps/driver/src/app/session/[id]/page.tsx`

---

## 16. Plate Normalization

**Problem:** Plate numbers can be entered inconsistently (dashes, spaces, mixed case).

**Behavior:** The `normalizePlate()` utility strips whitespace and dashes, then converts to uppercase. This function is applied at every system boundary — localStorage, WebSocket subscriptions, API requests, and ALPR output — ensuring consistent matching everywhere.

**Primary file:** `packages/core/src/utils.ts` (lines ~4-11)

---

## 17. On-Chain Payment Watcher (Base EVM Rail)

**Problem:** When a driver pays via EIP-681 QR code on the Base rail (scanned with an external wallet), the system needs to detect the on-chain USDC transfer and auto-settle the session.

**Behavior:** The payment watcher subscribes to ERC-20 Transfer events on the USDC contract (Base Sepolia). When the gate exit registers a pending payment (expected amount + receiver wallet), the watcher matches incoming transfers by receiver address and amount (within 1% tolerance). On match, it ends the DB session, burns the Hedera NFT if applicable, and notifies both gate and driver via WebSocket. Stale pending payments older than 30 minutes are pruned automatically. This watcher is specific to the EVM rail.

**Primary file:** `apps/api/src/services/paymentWatcher.ts`

---

## 18. XRPL Settlement Confirmation

**Problem:** XRPL payment confirmation cannot rely on ERC-20 event watchers or EVM transaction receipts.

**Behavior:** When `X402_NETWORK` is set to `xrpl:*`, the API initializes the XRPL settlement adapter and verifies payment proofs by fetching the submitted XRPL transaction hash and validating a successful, finalized `Payment` transaction. The same `X-PAYMENT` header is used, but verification logic is network-specific.

**Primary files:** `apps/api/src/app.ts`, `packages/x402-xrpl-settlement-adapter/src/index.ts`, `packages/x402/src/middleware.ts`

---

## 19. Xaman-First Wallet Fallback

**Problem:** XRPL wallet interoperability differs across apps; deep-link/QR behavior is most consistent in Xaman.

**Behavior:** Driver and gate UIs are Xaman-first (explicit Xaman CTA/copy). The API creates a Xaman payload, the client opens Xaman and polls payload status, and when signed the tx hash is auto-submitted to `/api/gate/exit`. Manual tx-hash entry remains a deterministic fallback.

**Primary files:** `apps/driver/src/components/PaymentPrompt.tsx`, `apps/driver/src/app/pay/page.tsx`, `apps/gate/src/app/page.tsx`

---

## 20. Dev Simulation Payment Bypass

**Problem:** During development, testing the full payment flow requires real on-chain USDC transfers, which is impractical.

**Behavior:** In development mode (`NODE_ENV=development`), the x402 middleware accepts a special `X-PAYMENT: simulated-dev-payment` header, bypassing on-chain transaction hash validation. The driver app's "Simulate Pay" button sends this header to quickly test the exit flow without real crypto. This bypass is only active in development mode.

**Primary files:** `packages/x402/src/middleware.ts`, `apps/driver/src/components/PaymentPrompt.tsx`
