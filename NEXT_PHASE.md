# Parker — Next Phase Planning

**Last updated:** 2026-02-14
**Based on:** Code review of current implementation vs SPEC.md

---

## 1. Current Implementation Status

### ✅ Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| Smart contracts (DriverRegistry, ParkingNFT) | ✅ Complete | Solidity + Hardhat, 19 passing tests |
| Driver registration API | ✅ Complete | CRUD routes, plate normalization |
| Parking session management API | ✅ Complete | Entry/exit flow with fee calculation |
| Gate API (entry, exit, scan, lot CRUD) | ✅ Complete | Full ALPR integration path |
| ALPR package (normalize + recognize) | ✅ Complete | Google Cloud Vision, IL/US/EU formats |
| x402 payment middleware | ✅ MVP | 402 flow implemented, but trusts `X-PAYMENT` header without on-chain verification |
| x402 client (driver-side) | ✅ Complete | Auto-retry with payment proof |
| Stripe payment integration | ✅ Complete | Checkout + webhook flow with NFT burn |
| Hedera NFT minting/burning | ✅ Complete | HTS-based, with mirror node queries + AES-256-GCM encrypted metadata |
| Multi-currency pricing service | ✅ Complete | FX rate conversion, per-lot currency |
| WebSocket real-time events | ✅ Complete | Gate + driver notification channels |
| Driver App (Next.js PWA) | ✅ Complete | Register, profile, history, session, onboarding, pay pages |
| Gate App (Next.js PWA) | ✅ Complete | Dashboard, sessions, settings, camera feed, QR fallback |
| Off-chain DB layer (PostgreSQL) | ✅ Complete | Drivers, sessions, lots tables |
| Deployment model (multi-country) | ✅ Complete | DEPLOYMENT_COUNTRIES env-based scoping |
| Wallet auth (EIP-4361 / SIWE) | ✅ Complete | JWT-based auth with nonce, signature verification; dev fallback via x-wallet-address |
| Contract deployment (Base Sepolia) | ✅ Complete | DriverRegistry at `0x3Af5...62Ab`, Hedera NFT collection `0.0.7933460` |
| Driver app wallet connect | ✅ Complete | Wagmi + Coinbase Smart Wallet, AuthProvider with SIWE sign-in |
| Gate offline resilience | ✅ Complete | Session cache in `useSessionCache` hook, 24h TTL, gate opens when API unreachable |
| Gate exit QR code fallback | ✅ Complete | QR code with payment details when WebSocket is unreliable |
| NFT viewer in parking history | ✅ Complete | Links to hashscan.io for each completed session |
| Lot grace period | ✅ Complete | `grace_period_minutes` setting, cars exiting within window not charged |
| API tests | ✅ Complete | 69 tests (vitest + supertest) covering auth, drivers, gate, sessions |
| x402 package tests | ✅ Complete | 10 tests for middleware + client |

### ❌ Not Yet Implemented

| Feature | SPEC Reference | Gap |
|---------|---------------|-----|
| On-chain driver registration sync | §4.1 | DB-only; register endpoint doesn't call `DriverRegistry.register()` on-chain |
| Rate limiting | §11 | No rate limiting middleware on any endpoint |
| WebSocket auth | §11 | Anyone can subscribe to `/ws/driver/:plate` — no token or session required |
| x402 on-chain payment verification | §5 | Middleware trusts `X-PAYMENT` header without verifying tx on Base |

---

## 2. Remaining Features (Prioritized)

### P0 — Must Have (Security & Core Gaps)

1. **On-chain driver registration sync**
   - Wire `POST /api/drivers/register` to also call `DriverRegistry.register()` on Base Sepolia
   - Implement event listener to sync on-chain state → DB

2. **Rate limiting**
   - Add express-rate-limit to ALPR scan endpoint and registration
   - Prevent abuse of Google Cloud Vision API calls

3. **x402 on-chain payment verification**
   - Verify USDC transfer on Base before marking session as paid
   - Replace current passthrough with actual tx confirmation

4. **WebSocket authentication**
   - Require signed token or JWT for WS connections
   - Prevent unauthorized subscription to driver session events

### P1 — Should Have (Feature Completeness)

5. **Gate app camera integration**
   - Connect CameraFeed component to actual device camera API
   - Implement real-time ALPR scanning loop

6. **Multi-plate support**
   - Allow drivers to register multiple vehicles (SPEC open question #5)
   - Schema change: drivers ↔ plates becomes 1:N

7. **Dispute resolution flow**
   - Admin endpoint to cancel/refund sessions
   - On-chain evidence linking for disputes (SPEC open question #6)

8. **Live FX rates**
   - Replace static `FX_RATE_*` env vars with CoinGecko / Circle API
   - Cache with TTL, fallback to static rates on API failure

### P2 — Nice to Have (Polish & Scale)

9. **Push notifications**
   - Service worker for PWA push notifications
   - Entry detected, payment charged, approaching max time

10. **Operator dashboard analytics**
    - Revenue reports (daily/weekly/monthly)
    - Average session duration, peak hours
    - Occupancy heatmap

11. **Multi-lot network**
    - Lot discovery API (nearby lots by GPS)
    - Cross-lot session history

12. **Subscription / monthly pass NFTs**
    - New contract for pass NFTs with expiry
    - Auto-validate on entry, skip payment on exit

---

## 3. Technical Debt & Improvements

### Architecture

- **No input validation library** — Routes manually check `req.body` fields. Add `zod` for schema validation on all endpoints.
- **No structured error handling** — Each route has its own try/catch with inconsistent error shapes. Create an error middleware with typed error classes.
- **DB connection pool not configurable** — `pg.Pool` uses defaults. Add pool size, timeout, and SSL config from env.
- **No graceful shutdown** — Server doesn't handle SIGTERM/SIGINT for draining connections.

### Code Quality

- **Missing TypeScript strict mode** — `tsconfig` should enable `strict: true` across all packages.
- **`any` casts in DB mappers** — `mapDriver(row: any)`, `mapSession(row: any)` — add proper row types.
- **Console logging everywhere** — Replace with structured logger (pino/winston) with log levels.
- **No API versioning** — All routes under `/api/` with no version prefix. Add `/api/v1/` before more clients depend on it.

### Testing

- **No real DB integration tests** — Current API tests use mocked DB. Add tests against a real PostgreSQL (testcontainers or in-memory).
- **No contract integration tests** — Test the API → blockchain flow end-to-end with Hardhat network.
- **Driver/Gate apps untested** — No component tests for React apps. Add vitest + React Testing Library.

### DevOps

- **No CI/CD pipeline** — Add GitHub Actions for lint, test, build on PR.
- **No Dockerfile for API** — docker-compose exists for PostgreSQL but no app container.
- **No migration system** — DB schema is a SQL file, no versioned migrations. Add `node-pg-migrate` or `drizzle-kit`.

---

## 4. Security Considerations

| Risk | Severity | Status |
|------|----------|--------|
| ~~No wallet auth~~ | ~~Critical~~ | ✅ Fixed — EIP-4361 SIWE implemented |
| WebSocket has no auth | **High** | ❌ Open — require signed token or JWT for WS connections |
| ALPR endpoint has no rate limit | **High** | ❌ Open — add express-rate-limit |
| x402 payment verification is MVP-only | **Critical** | ❌ Open — must verify tx on Base before closing session |
| Plate numbers in plaintext in DB | **Medium** | Acceptable for off-chain index (per SPEC §11), add access control on query endpoints |
| NFT metadata encrypted on-chain | **Safe** | ✅ AES-256-GCM encryption prevents on-chain plate tracking |
| Stripe webhook secret in env | **Low** | ✅ Verified via signature |
| No CORS restriction in dev | **Low** | `CORS_ORIGIN` defaults to `*` — restrict in production |
| No HTTPS enforcement | **Medium** | Add HSTS headers, redirect HTTP→HTTPS in production |
| SQL injection via pg parameterized queries | **Safe** | All queries use `$1` parameterization ✅ |
