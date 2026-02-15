# Parker — Next Phase Planning

**Date:** 2026-02-15
**Based on:** Code review of current implementation vs SPEC.md

---

## 1. Current Implementation Status

### ✅ Implemented (Phase 1)

| Feature | Status | Notes |
|---------|--------|-------|
| Smart contracts (DriverRegistry, ParkingNFT) | ✅ Complete | Solidity + Hardhat, 19 passing tests |
| Driver registration API | ✅ Complete | CRUD routes, plate normalization |
| Parking session management API | ✅ Complete | Entry/exit flow with fee calculation |
| Gate API (entry, exit, scan, lot CRUD) | ✅ Complete | Full ALPR integration path |
| ALPR package (normalize + recognize) | ✅ Complete | Google Cloud Vision, IL/US/EU formats |
| x402 payment middleware | ✅ Complete | 402 flow with payment verification |
| x402 client (driver-side) | ✅ Complete | Auto-retry with payment proof |
| Stripe payment integration | ✅ Complete | Checkout + webhook flow |
| Hedera NFT minting/burning | ✅ Complete | HTS-based, with mirror node queries |
| Multi-currency pricing service | ✅ Complete | FX rate conversion, per-lot currency |
| WebSocket real-time events | ✅ Complete | Gate + driver notification channels |
| Driver App (Next.js PWA) | ✅ Scaffolded | Pages: register, profile, history, session, onboarding |
| Gate App (Next.js PWA) | ✅ Scaffolded | Pages: dashboard, sessions, settings, camera feed |
| Off-chain DB layer (PostgreSQL) | ✅ Complete | Drivers, sessions, lots tables |
| Deployment model (multi-country) | ✅ Complete | DEPLOYMENT_COUNTRIES env-based scoping |

### ❌ Not Yet Implemented (from SPEC.md Phase 1 scope)

| Feature | SPEC Reference | Gap |
|---------|---------------|-----|
| Wallet signature verification | §11, middleware/auth.ts | `verifyWallet` is a passthrough — trusts `x-wallet-address` header |
| On-chain driver registration | §4.1 | DB-only; no Base Sepolia contract write on register |
| Base Sepolia deployment | §12 | Contract addresses are placeholder zeros |
| Rate limiting on ALPR endpoint | §11 | No rate limiting middleware exists |
| E2E testing | §13 Phase 5 | No integration or E2E tests |
| Driver app wallet connect | §7.1 | WalletProvider scaffolded but not wired |
| Gate app offline resilience | §3.2 | No offline queue implemented |

---

## 2. Suggested Phase 2 Features (Prioritized)

### P0 — Must Have (Security & Core Gaps)

1. **Wallet signature verification (EIP-4361 / SIWE)**
   - The auth middleware currently trusts headers blindly
   - Implement Sign-In with Ethereum for all state-changing endpoints
   - Critical for production security

2. **On-chain driver registration sync**
   - Wire `POST /api/drivers/register` to also call `DriverRegistry.register()` on Base Sepolia
   - Implement event listener to sync on-chain state → DB

3. **Rate limiting**
   - Add express-rate-limit to ALPR scan endpoint and registration
   - Prevent abuse of Google Cloud Vision API calls

4. **Deploy contracts to Base Sepolia**
   - Run deployment script, update contract addresses in env/config
   - Verify contracts on Basescan

### P1 — Should Have (Feature Completeness)

5. **Driver app wallet integration**
   - Complete Coinbase Smart Wallet / WalletConnect flow
   - Wire payment signing for x402 exit flow

6. **Gate app camera integration**
   - Connect CameraFeed component to actual device camera API
   - Implement real-time ALPR scanning loop

7. **Multi-plate support**
   - Allow drivers to register multiple vehicles (SPEC open question #5)
   - Schema change: drivers ↔ plates becomes 1:N

8. **Dispute resolution flow**
   - Admin endpoint to cancel/refund sessions
   - On-chain evidence linking for disputes (SPEC open question #6)

9. **Live FX rates**
   - Replace static `FX_RATE_*` env vars with CoinGecko / Circle API
   - Cache with TTL, fallback to static rates on API failure

### P2 — Nice to Have (Polish & Scale)

10. **Gate offline resilience**
    - Queue entry/exit transactions in IndexedDB when connectivity drops
    - Replay on reconnect with conflict resolution

11. **Push notifications**
    - Service worker for PWA push notifications
    - Entry detected, payment charged, approaching max time

12. **Operator dashboard analytics**
    - Revenue reports (daily/weekly/monthly)
    - Average session duration, peak hours
    - Occupancy heatmap

13. **Multi-lot network**
    - Lot discovery API (nearby lots by GPS)
    - Cross-lot session history

14. **Subscription / monthly pass NFTs**
    - New contract for pass NFTs with expiry
    - Auto-validate on entry, skip payment on exit

---

## 3. Technical Debt & Improvements

### Architecture

- **No input validation library** — Routes manually check `req.body` fields. Add `zod` for schema validation on all endpoints.
- **No structured error handling** — Each route has its own try/catch with inconsistent error shapes. Create an error middleware with typed error classes.
- **DB connection pool not configurable** — `pg.Pool` uses defaults. Add pool size, timeout, and SSL config from env.
- **No graceful shutdown** — Server doesn't handle SIGTERM/SIGINT for draining connections.
- **WebSocket has no auth** — Anyone can subscribe to `/ws/driver/:plate` and see real-time session events for any plate.

### Code Quality

- **Missing TypeScript strict mode** — `tsconfig` should enable `strict: true` across all packages.
- **`any` casts in DB mappers** — `mapDriver(row: any)`, `mapSession(row: any)` — add proper row types.
- **Console logging everywhere** — Replace with structured logger (pino/winston) with log levels.
- **No API versioning** — All routes under `/api/` with no version prefix. Add `/api/v1/` before more clients depend on it.
- **Unused `@x402/express` dependency** — `packages/x402/package.json` depends on `@x402/express` but the middleware is custom-built. Either use the official package or remove the dependency.

### Testing

- **No integration tests** — Current tests are unit-only with mocked DB. Add tests against a real PostgreSQL (testcontainers or in-memory).
- **No contract integration tests** — Test the API → blockchain flow end-to-end with Hardhat network.
- **Driver/Gate apps untested** — No component tests for React apps. Add vitest + React Testing Library.

### DevOps

- **No CI/CD pipeline** — Add GitHub Actions for lint, test, build on PR.
- **No Docker setup** — Add Dockerfile for API + docker-compose with PostgreSQL.
- **No migration system** — DB schema is in SPEC.md only, no SQL migration files. Add `node-pg-migrate` or `drizzle-kit`.
- **No seed data script** — Add a `seed.ts` for dev/demo with sample lots and drivers.

---

## 4. Security Considerations

| Risk | Severity | Mitigation |
|------|----------|------------|
| No wallet auth — anyone can register/modify drivers | **Critical** | Implement EIP-4361 SIWE verification |
| WebSocket has no auth | **High** | Require signed token or session cookie for WS connections |
| ALPR endpoint has no rate limit | **High** | Add express-rate-limit (e.g., 10 req/min per IP) |
| Plate numbers in plaintext in DB | **Medium** | Acceptable for off-chain index (per SPEC §11), but add access control on query endpoints |
| Stripe webhook secret in env | **Low** | Already verified via signature — ensure STRIPE_WEBHOOK_SECRET is set in prod |
| x402 payment verification is MVP-only | **Critical** | Currently trusts `X-PAYMENT` header without on-chain verification. Must verify tx on Base before closing session |
| No CORS restriction in dev | **Low** | `CORS_ORIGIN` defaults to `*` — restrict in production |
| No HTTPS enforcement | **Medium** | Add HSTS headers, redirect HTTP→HTTPS in production |
| SQL injection via pg parameterized queries | **Safe** | All queries use `$1` parameterization ✅ |
| Large image upload (10MB limit) | **Low** | Could be used for DoS — add file type validation |

---

## 5. Recommended Phase 2 Timeline

| Week | Focus | Deliverables |
|------|-------|-------------|
| 1 | Security hardening | SIWE auth, rate limiting, WS auth, x402 on-chain verification |
| 2 | Contract deployment | Deploy to Base Sepolia, update addresses, verify on Basescan |
| 3 | Driver app completion | Wallet connect, payment flow, real-time session UI |
| 4 | Gate app completion | Camera integration, ALPR loop, offline queue |
| 5 | DevOps & testing | CI/CD, Docker, DB migrations, integration tests |
| 6 | Polish | Multi-plate, live FX, notifications, analytics |
