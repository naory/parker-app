# Parker App — TODO

## Completed

- [x] **Gate: Payment QR code fallback**
  Display a QR code on the gate exit screen containing the payment request details. Serves as a fallback when the driver's WebSocket connection is unreliable.

- [x] **Parking history: View NFT on Hedera explorer**
  Each completed session links to hashscan.io with the token ID and serial number.

- [x] **Lot grace period**
  `gracePeriodMinutes` setting per lot (default 0). Cars exiting within the window are not charged.

## Security (P0)

- [x] **x402 on-chain payment verification**
  The x402 middleware now verifies ERC20 transfers on-chain via viem when a publicClient is configured. Gate exit validates receiver wallet and amount (1% tolerance).

- [x] **WebSocket authentication**
  WebSocket upgrade handler validates JWT token or gate API key, rejects unauthenticated connections with 401. Skipped in development mode.

- [x] **Rate limiting**
  Three tiers via express-rate-limit: strict (10/min) for auth, medium (30/min) for gate ops & registration, standard (100/min) catch-all.

- [ ] **XRPL settlement verification (x402-xrpl-settlement-adapter)**
  Add XRPL as a settlement backend for x402 payments using the `x402-xrpl-settlement-adapter` npm package. Implement server-side `verifySettlement()` using a network-specific `fetchTransaction` backed by XRPL JSON-RPC/WebSocket.

- [ ] **Gate exit: XRPL payment option (XRP / RLUSD IOU)**
  Extend payment method selection to include XRPL. Generate an XRPL payment request payload + memo (x402 JSON memo with paymentId) and display a QR that wallets can act on (XUMM/Xaman deep link or QR payload). On-chain watcher verifies settlement and auto-opens gate.

- [ ] **Replay store persistence for XRPL receipts**
  Persist `paymentId ↔ txHash` mappings in DB (instead of in-memory) to survive restarts and prevent replay across instances.

## Features

- [ ] **Policy enforcement failure ops flow (paid but not closable)**
  Define and implement a business workflow for cases where settlement is verified on-chain but policy enforcement rejects closure (for example, cap mismatch). Requirements: operator review queue, support/admin tooling to resolve stuck active sessions, customer-facing status, and explicit refund/credit handling policy per rail.

- [ ] **On-chain driver registration sync**
  Wire `POST /api/drivers/register` to call `DriverRegistry.register()` on Base Sepolia. Currently DB-only.

- [x] **Gate exit: payment method selection with EIP-681 wallet QR**
  On exit, the gate screen prompts the driver to choose a payment method (credit card or crypto wallet). If crypto is chosen, generate an EIP-681 `ethereum:` URI QR code encoding the USDC transfer (receiver, amount, token contract). Driver scans with any EIP-681-compatible wallet (Coinbase, MetaMask, etc.) — no driver app or WebSocket required. API watches for the on-chain transfer to auto-close the session and open the gate.

- [ ] **Gate camera integration**
  Connect CameraFeed component to device camera API. Implement real-time ALPR scanning loop.

- [ ] **Multi-plate support**
  Allow drivers to register multiple vehicles. Schema change: drivers ↔ plates becomes 1:N.

- [ ] **Live FX rates**
  Replace static `FX_RATE_*` env vars with CoinGecko / Circle API. Cache with TTL, fallback to static rates.

- [ ] **Dispute resolution flow**
  Admin endpoint to cancel/refund sessions. On-chain evidence linking for disputes.

## Testing

- [x] **paymentWatcher unit tests**
  15 tests covering `addPendingPayment`/`removePendingPayment`, `startPaymentWatcher`, transfer event matching (exact, 1% tolerance, wrong amount, wrong receiver, case-insensitive), Hedera NFT burn on settle, and stale payment pruning. Statement coverage: 9.5% → 92%.

## Technical Debt

- [ ] **Zod schema validation**
  Replace manual `req.body` field checks with zod schemas on all API endpoints.

- [ ] **Structured error handling**
  Create error middleware with typed error classes instead of per-route try/catch.

- [ ] **Structured logging**
  Replace `console.log` with pino or winston. Add log levels and request IDs.

- [ ] **CI/CD pipeline**
  GitHub Actions for lint, test, build on PR.

- [ ] **DB migrations**
  Add versioned migrations with node-pg-migrate or drizzle-kit. Currently schema is a single SQL file.

- [ ] **ALPR: Google Cloud credentials**
  `recognizePlate()` requires `GOOGLE_APPLICATION_CREDENTIALS` to be configured. Currently untested with real credentials.
