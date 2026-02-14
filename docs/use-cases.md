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

## 15. Plate Normalization

**Problem:** Plate numbers can be entered inconsistently (dashes, spaces, mixed case).

**Behavior:** The `normalizePlate()` utility strips whitespace and dashes, then converts to uppercase. This function is applied at every system boundary — localStorage, WebSocket subscriptions, API requests, and ALPR output — ensuring consistent matching everywhere.

**Primary file:** `packages/core/src/utils.ts` (lines ~4-11)
