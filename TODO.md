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

## Features

- [ ] **On-chain driver registration sync**
  Wire `POST /api/drivers/register` to call `DriverRegistry.register()` on Base Sepolia. Currently DB-only.

- [ ] **Gate camera integration**
  Connect CameraFeed component to device camera API. Implement real-time ALPR scanning loop.

- [ ] **Multi-plate support**
  Allow drivers to register multiple vehicles. Schema change: drivers ↔ plates becomes 1:N.

- [ ] **Live FX rates**
  Replace static `FX_RATE_*` env vars with CoinGecko / Circle API. Cache with TTL, fallback to static rates.

- [ ] **Dispute resolution flow**
  Admin endpoint to cancel/refund sessions. On-chain evidence linking for disputes.

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
