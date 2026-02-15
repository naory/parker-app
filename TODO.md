# Parker App — TODO

## Completed

- [x] **Gate: Payment QR code fallback**
  Display a QR code on the gate exit screen containing the payment request details. Serves as a fallback when the driver's WebSocket connection is unreliable.

- [x] **Parking history: View NFT on Hedera explorer**
  Each completed session links to hashscan.io with the token ID and serial number.

- [x] **Lot grace period**
  `gracePeriodMinutes` setting per lot (default 0). Cars exiting within the window are not charged.

## Security (P0)

- [ ] **x402 on-chain payment verification**
  The x402 middleware currently trusts the `X-PAYMENT` header (MVP pass-through). Verify the USDC transfer on Base before marking payment as confirmed.

- [ ] **WebSocket authentication**
  Anyone can subscribe to `/ws/driver/:plate` and see real-time session events. Require JWT or signed token for WS connections.

- [ ] **Rate limiting**
  Add express-rate-limit to ALPR scan endpoint, registration, and auth routes. Prevent abuse of Google Cloud Vision API calls.

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
