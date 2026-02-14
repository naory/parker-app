# Parker — Technical Specification

**Version:** 0.1.0 (Draft)
**Date:** 2026-02-13
**Author:** N Man + Clawie 🐾

---

## 1. Problem Statement

Centralized parking apps (Tango, Pango) suffer from:
- Frequent communication failures between app and parking lot systems
- Single point of failure in ticket validation
- Opaque fee calculation
- No interoperability between parking providers
- Poor user experience when systems go down

## 2. Solution

A decentralized parking system where:
- Each parking event is an on-chain NFT with immutable timestamps
- Payment is handled via the x402 protocol (HTTP-native, stablecoin-based)
- Verification happens directly against the blockchain — no central server dependency
- Drivers maintain a digital wallet linked to their vehicle identity

## 2.1 Deployment Model

Parker is a multi-country, currency-agnostic **platform** designed to be white-labeled by country or regional operators. Each deployment is scoped to a single country or region:

- **Single-country** — e.g., an operator in Israel deploys with `DEPLOYMENT_COUNTRIES=IL`. All lots use ILS, ALPR validates Israeli plates, and the driver app shows only Israel in registration.
- **Regional** — e.g., a pan-European operator deploys with `DEPLOYMENT_COUNTRIES=DE,FR,ES,IT,NL,GB`. Lots may use EUR or GBP (per-lot config), ALPR tries EU plate formats, and the driver app shows the relevant countries.

This `DEPLOYMENT_COUNTRIES` env var is the single config knob that scopes:
1. Driver registration (country picker visibility and options)
2. ALPR plate format detection (which country normalizers to apply)
3. Seed data and demo configuration

Currency, pricing, and payment methods remain per-lot settings — a regional deployment may have lots in different currencies (e.g., EUR lots in Germany and GBP lots in the UK).

## 3. System Architecture

### 3.1 High-Level Components

```
                         ┌───────────────────┐
                         │    Base L2 Chain   │
                         │  ┌─────────────┐  │
                         │  │ ParkingNFT   │  │
                         │  │ Contract     │  │
                         │  └─────────────┘  │
                         │  ┌─────────────┐  │
                         │  │ DriverReg    │  │
                         │  │ Contract     │  │
                         │  └─────────────┘  │
                         └────────▲──────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
              ┌─────▼─────┐ ┌────▼────┐ ┌─────▼─────┐
              │  Driver   │ │ Parker  │ │   Gate    │
              │  App      │ │ Backend │ │   App     │
              │  (PWA)    │ │ (API)   │ │   (PWA)   │
              └───────────┘ └─────────┘ └───────────┘
```

### 3.2 Component Breakdown

#### Parker Backend (API Server)
- Express.js with x402 payment middleware
- Interfaces with blockchain (ethers.js / viem)
- ALPR processing pipeline
- WebSocket for real-time gate events
- PostgreSQL for off-chain indexing (fast queries, plate lookups)

#### Driver App (PWA)
- Mobile-first Next.js progressive web app
- Wallet integration (Coinbase Smart Wallet / WalletConnect)
- Profile management
- Real-time parking session view
- Payment history

#### Gate App (PWA)
- Tablet/kiosk-optimized Next.js app
- Camera integration for ALPR
- Real-time entry/exit processing
- Operator dashboard
- Offline resilience (queue transactions when connectivity drops)

## 4. Smart Contracts

### 4.1 DriverRegistry Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct DriverProfile {
    address wallet;
    string plateNumber;      // e.g., "ABC-1234"
    string countryCode;      // ISO 3166-1 alpha-2, e.g., "US"
    string carMake;          // e.g., "Toyota"
    string carModel;         // e.g., "Corolla"
    bool active;
    uint256 registeredAt;
}

contract DriverRegistry {
    mapping(bytes32 => DriverProfile) public drivers;  // keccak256(plate) => profile
    mapping(address => bytes32) public walletToPlate;

    event DriverRegistered(address indexed wallet, string plateNumber);
    event DriverUpdated(address indexed wallet, string plateNumber);
    event DriverDeactivated(address indexed wallet, string plateNumber);

    function register(
        string calldata plateNumber,
        string calldata countryCode,
        string calldata carMake,
        string calldata carModel
    ) external;

    function isRegistered(string calldata plateNumber) external view returns (bool);
    function getDriver(string calldata plateNumber) external view returns (DriverProfile memory);
    function deactivate() external;
}
```

### 4.2 ParkingNFT Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

struct ParkingSession {
    string plateNumber;
    string lotId;            // Unique parking lot identifier
    uint256 entryTime;
    uint256 exitTime;        // 0 while active
    uint256 feePaid;         // in USDC (6 decimals)
    bool active;
}

contract ParkingNFT is ERC721 {
    uint256 public nextTokenId;
    mapping(uint256 => ParkingSession) public sessions;
    mapping(bytes32 => uint256) public activeSessionByPlate;  // plate hash => tokenId

    // Lot operators (authorized to mint/close sessions)
    mapping(address => bool) public authorizedLots;

    event SessionStarted(uint256 indexed tokenId, string plateNumber, string lotId, uint256 entryTime);
    event SessionEnded(uint256 indexed tokenId, string plateNumber, uint256 exitTime, uint256 fee);

    function startSession(
        string calldata plateNumber,
        string calldata lotId
    ) external returns (uint256 tokenId);
    // Only authorized lot operators can call

    function endSession(
        string calldata plateNumber,
        uint256 feePaid
    ) external;
    // Calculates duration, charges driver via x402, marks NFT complete

    function getActiveSession(string calldata plateNumber)
        external view returns (ParkingSession memory);

    function isParked(string calldata plateNumber) external view returns (bool);
}
```

### 4.3 Fee Calculation

```
fee = ceil(duration_minutes / billing_increment) × rate_per_increment

Example (lot configured with EUR):
- Rate: 8 EUR/hour
- Billing increment: 15 minutes
- Duration: 2h 10m (130 min) → ceil(130/15) = 9 increments
- Fee: 9 × (8/60 × 15) = 9 × 2.00 = 18.00 EUR
- x402 stablecoin equivalent: 18.00 × 1.08 (FX_RATE_EUR_USD) = 19.44 USDC
```

Fees are calculated in the lot's configured currency (ISO 4217). Each lot defines its own currency, rate, and billing settings. For the x402 crypto rail, fees are converted to stablecoin using configurable FX rates.

## 5. ALPR (License Plate Recognition)

### 5.1 MVP Approach
- **Phone camera** simulates gate camera (MVP)
- Capture image → send to backend → OCR pipeline
- Use Google Cloud Vision API or OpenALPR for plate detection
- Country-aware plate normalization (IL, US, EU formats supported)

### 5.2 Pipeline
```
Camera Frame → Preprocessing (crop, contrast) → OCR API → Plate String → Normalize → Lookup
```

### 5.3 Production Approach
- Dedicated ALPR cameras (e.g., Hikvision with built-in ALPR)
- Direct API integration with camera hardware
- Edge processing for low latency

## 6. x402 Payment Integration

### 6.1 Overview
Parker supports two parallel payment rails per lot, both optional:
- **x402 (stablecoin)** — Coinbase's HTTP 402 protocol. Fee converted from lot currency to stablecoin via FX rate. Near-zero gas on Base L2.
- **Stripe (credit card)** — Stripe Checkout in the lot's native currency. Webhook-driven session closure.

Both rails result in the same outcome: session closed in DB, NFT burned on Hedera, gate opened.

### 6.2 Payment Flow
```
1. Gate app calls: POST /api/gate/exit
2. Backend calculates fee in the lot's local currency
3. Backend returns payment options based on lot config:
   a. x402: stablecoin amount (FX-converted), token, network, receiver
   b. Stripe: checkout URL in local currency
4a. x402 path: driver wallet signs payment, request retried with X-PAYMENT header
4b. Stripe path: driver redirected to Stripe Checkout; webhook confirms payment
5. On confirmation (either rail): NFT burned on Hedera, session closed
6. Gate opens, driver app notified via WebSocket
```

### 6.3 Server Integration
```typescript
// x402 middleware intercepts exit route
app.use('/api/gate/exit', createPaymentMiddleware({
  network: process.env.X402_NETWORK || 'base-sepolia',
  token: process.env.X402_STABLECOIN || 'USDC',
  receiverWallet: process.env.LOT_OPERATOR_WALLET,
}));

// Stripe webhook (raw body for signature verification)
app.use('/api/webhooks', webhooksRouter);
```

### 6.4 Multi-Currency Design
- Each lot defines its own `currency` (ISO 4217) and `paymentMethods` array
- Stripe charges in the lot's native currency directly (USD, EUR, GBP, etc.)
- x402 converts local currency fees to stablecoin via `FX_RATE_{FROM}_{TO}` env vars
- Pricing service supports bidirectional FX lookup (direct or inverse rate)

## 7. Driver App — Detailed Spec

### 7.1 Screens

**Onboarding:**
1. Welcome / value prop
2. Connect wallet (Coinbase Smart Wallet — passkey-based, no seed phrase)
3. Register vehicle (plate, country, make, model)
4. Link payment method (wallet already connected + optional card)

**Main Dashboard:**
- Active session card (if parked): lot name, duration timer, estimated cost
- "Not parked" state when idle
- Quick actions: view history, edit profile

**Session Detail:**
- Map showing lot location
- Entry time, current duration
- Real-time cost estimate
- NFT token ID

**History:**
- List of past sessions with date, lot, duration, amount paid
- Each session links to on-chain NFT (block explorer)

**Profile:**
- Vehicle details
- Wallet address
- Payment methods
- Settings (notifications, currency display)

### 7.2 Notifications
- Entry detected: "You parked at [Lot Name] at [Time]"
- Approaching max time (if lot has limits): "You've been parked for 4h"
- Payment charged: "12.00 EUR charged for 2h 15m at [Lot Name]"

## 8. Gate App — Detailed Spec

### 8.1 Screens

**Live Gate View:**
- Camera feed with ALPR overlay
- Last detected plate + driver status
- Entry/exit mode toggle
- Manual plate entry (fallback)

**Session Manager:**
- List of active sessions in this lot
- Search by plate
- Manual session end (for disputes)

**Operator Dashboard:**
- Current occupancy (cars in / capacity)
- Revenue today / this week / this month
- Average session duration
- Unregistered vehicle count

**Settings:**
- Lot ID and name
- Pricing configuration (rate, billing increment, max daily fee)
- Camera configuration
- Authorized operators

### 8.2 Gate Hardware Integration (Future)
```
Gate App ←WebSocket→ Parker Backend ←API→ Gate Controller (relay/GPIO)
```
MVP: gate is simulated (green/red screen indicator)

## 9. Data Models

### 9.1 Off-Chain (PostgreSQL)

```sql
-- Fast plate lookups (mirrors on-chain DriverRegistry)
CREATE TABLE drivers (
    id            UUID PRIMARY KEY,
    wallet        VARCHAR(42) NOT NULL,
    plate_number  VARCHAR(20) NOT NULL UNIQUE,
    country_code  VARCHAR(2) NOT NULL,
    car_make      VARCHAR(50),
    car_model     VARCHAR(50),
    active        BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Session index (mirrors on-chain ParkingNFT)
CREATE TABLE sessions (
    id                UUID PRIMARY KEY,
    token_id          BIGINT UNIQUE,          -- Hedera NFT serial number
    plate_number      VARCHAR(20) NOT NULL,
    lot_id            VARCHAR(50) NOT NULL,
    entry_time        TIMESTAMPTZ NOT NULL,
    exit_time         TIMESTAMPTZ,
    fee_amount        DECIMAL(10, 6),         -- in the lot's currency
    fee_currency      VARCHAR(10),            -- ISO 4217 (e.g. "USD", "EUR")
    stripe_payment_id VARCHAR(255),           -- Stripe Checkout session ID (if card)
    tx_hash           VARCHAR(66),            -- payment tx (if x402)
    status            VARCHAR(20) DEFAULT 'active',  -- active | completed | cancelled
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Parking lot configuration
CREATE TABLE lots (
    id              VARCHAR(50) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    address         TEXT,
    lat             DECIMAL(10, 7),
    lng             DECIMAL(10, 7),
    capacity        INT,
    rate_per_hour   DECIMAL(10, 2) NOT NULL, -- in the lot's currency
    billing_minutes INT DEFAULT 15,           -- billing increment
    max_daily_fee   DECIMAL(10, 2),
    currency        VARCHAR(10) NOT NULL DEFAULT 'USD',  -- ISO 4217
    payment_methods TEXT[] DEFAULT '{stripe,x402}',
    operator_wallet VARCHAR(42) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

## 10. API Endpoints

### Driver API
```
POST   /api/drivers/register        — Register new driver + vehicle
GET    /api/drivers/:plate           — Get driver profile
PUT    /api/drivers/:plate           — Update profile
DELETE /api/drivers/:plate           — Deactivate driver

GET    /api/sessions/active/:plate   — Get active parking session
GET    /api/sessions/history/:plate  — Get session history
```

### Gate API
```
POST   /api/gate/entry               — Process vehicle entry (plate image or string)
POST   /api/gate/exit                 — Process vehicle exit + return payment options
POST   /api/gate/scan                 — ALPR: upload image, get plate string
GET    /api/gate/lot/:lotId/status    — Lot occupancy, config, currency, payment methods
GET    /api/gate/lot/:lotId/sessions  — Active sessions list
PUT    /api/gate/lot/:lotId           — Update lot settings (rates, currency, payment methods)
```

### Webhooks
```
POST   /api/webhooks/stripe           — Stripe payment confirmation (closes session + burns NFT)
```

### WebSocket Events
```
WS     /ws/gate/:lotId               — Real-time gate events (entry, exit with payment method)
WS     /ws/driver/:plate             — Real-time session updates for driver
```

## 11. Resilience Architecture: On-Chain vs Off-Chain

### 11.1 Problem: Centralized Bottleneck at the Gate

Parker's MVP exit flow depends on the PostgreSQL database as the source of truth for session lookup, fee calculation, and session closure. The Hedera NFT is minted on entry and burned on exit, but both operations are **fire-and-forget side effects** — if Hedera is down, the system continues; if the DB is down, gates stop working.

This mirrors the exact failure mode of today's centralized parking apps: a server outage during peak hours means cars can't exit. The blockchain layer, as currently integrated, doesn't help with this.

### 11.2 Industry Pattern: Hybrid Architecture

Research into Hedera-based ticketing (MINGO Tickets, LimeChain reference implementations) and Hedera's own ["Pragmatic Blockchain Design Patterns"](https://hedera.com/blog/pragmatic-blockchain-design-patterns-integrating-blockchain-into-business-processes/) reveals a consistent pattern:

- **Centralized DB is the fast operational path** — real-time lookups, fee calculation, session management
- **Blockchain is the trust/verification layer** — immutable proof of ownership, anti-fraud, audit trail
- **Mirror Node is the fallback read path** — Hedera's Mirror Node REST API provides cost-effective, high-throughput queries of all on-chain state without hitting consensus nodes

MINGO explicitly describes Hedera as an "invisible trust layer operating in the background" while Stripe handles payments and their own platform handles ticket lifecycle. This is the same pattern Parker currently uses.

The key difference between event ticketing and parking: **at a concert, a 30-second scan delay is annoying; at a parking gate, it blocks every car behind you.** Parking demands a higher resilience bar.

### 11.3 Resilience Strategy

Parker's resilience design uses three layers:

```
Layer 1 (default):   PostgreSQL — fast path for all operations
Layer 2 (fallback):  Hedera Mirror Node — read-only fallback when DB is unreachable
Layer 3 (offline):   Gate-side cache — local session cache from WebSocket events
```

#### Layer 1: DB as Fast Path (current — no change)

The PostgreSQL database remains the primary operational store. It handles session CRUD, fee calculation, lot config, and driver lookup. This is the standard pattern used by MINGO and recommended by Hedera.

#### Layer 2: Mirror Node Fallback

When the DB is unreachable, the exit flow falls back to Hedera's Mirror Node REST API:

```
Normal exit:
  DB.getActiveSession(plate) → fee calc → payment → DB.endSession() → Hedera.burn()

DB-down exit:
  MirrorNode.getNFTByPlate(plate) → verify NFT exists + read metadata
  → fee calc from NFT metadata (entry time, lot ID) + lot config cache
  → payment → Hedera.burn() → queue DB sync for when it recovers
```

The Mirror Node query verifies:
1. **NFT existence** — proves the car entered and has an active parking session
2. **NFT metadata** — contains `plateHash` (keccak256), lot ID, and entry timestamp (enough to calculate the fee)
3. **NFT not burned** — confirms the session hasn't already been closed

**Privacy-compatible lookup:** The gate already knows the plate (from ALPR scan). It computes `hashPlate(plate)` and scans active NFTs for a matching `plateHash`. This works without ever storing the raw plate on-chain (see §12.1).

The entry route mints the Hedera NFT **before writing to the DB** (write-ahead), so the on-chain record is always the leading indicator. If the DB write fails after a successful mint, the gate still opens and the session is recoverable from the NFT.

#### Layer 3: Gate-Side Session Cache

The gate app already receives WebSocket events for every entry and exit. By caching these locally:

- The gate knows which plates are currently parked without querying anything
- Fee calculation can use cached lot config (rate, billing increment, max daily)
- If both DB and Mirror Node are unreachable, the gate can still validate exits and calculate fees
- Sessions closed offline are queued and synced when connectivity returns

This gives the gate **offline-capable exit validation** — the strongest resilience guarantee.

### 11.4 Entry Order: Write-Ahead NFT

Entry order (implemented):
```
1. Hedera: mint NFT (contains plateHash, lot ID, entry time in metadata)
2. DB: create session record (includes Hedera serial number)
3. If DB write fails: session still exists on-chain — gate opens, session is recoverable
```

With write-ahead, the Hedera NFT is the authoritative proof of entry. The DB is a fast index of on-chain state, not the other way around. If the DB loses a record, the on-chain NFT proves the car is parked.

### 11.5 Implementation Status

| Component | Effort | Impact | Priority | Status |
|-----------|--------|--------|----------|--------|
| Write-ahead NFT (entry order swap) | Low | High — enables all fallback paths | P0 | **Done** |
| Mirror Node fallback in exit route | Medium | High — DB-down resilience | P1 | **Done** |
| Gate-side session cache | Medium | Very high — offline capability | P1 | **Done** |
| DB sync queue (reconciliation) | Medium | Medium — data consistency after outage | P2 | Planned |
| Health-check circuit breaker (auto-switch to fallback) | Low | Medium — smooth degradation | P2 | Planned |

## 12. Security & Privacy

### 12.1 On-Chain Privacy Model

The Hedera Mirror Node is a **public REST API** — anyone can query all NFTs in a token collection and read their metadata. This creates a privacy risk: if plate numbers were stored in plaintext, anyone could build a complete parking location history for any vehicle.

**Design principle: hash on-chain, plaintext off-chain.**

```
On-chain (Hedera — public):
  NFT metadata = { "plateHash": "0xa1b2c3...", "lotId": "lot-01", "entryTime": 1707840000 }

Off-chain (PostgreSQL — access-controlled):
  sessions = { plate_number: "1234567", hedera_serial: 42, lot_id: "lot-01", ... }
```

The plate number is hashed using `keccak256` (via `hashPlate()` from `@parker/core`) before being written to the NFT metadata. This is a **one-way hash** — a third party scanning the Mirror Node sees only opaque hex strings, not plate numbers. They cannot:
- Reverse a hash to get a plate number
- Link two parking sessions to the same vehicle (without already knowing the plate)
- Build a location history for a driver

The API server correlates NFTs to sessions by computing `hashPlate(plate)` and matching it against the on-chain `plateHash`. This works for the Mirror Node fallback path (§11.3) because the gate already knows the plate (from ALPR) and can hash it to look up the matching NFT.

**What remains public on-chain:**
- `lotId` — an internal identifier (e.g., "lot-01"), not a street address. An observer can see how many sessions a lot has, but not who parked there.
- `entryTime` — timestamp of when a session started
- Mint/burn transaction history — proves a session existed and when it ended

**What is NOT on-chain:**
- Plate numbers (only hashes)
- Driver identity, wallet address (not in NFT metadata)
- Fee amounts, payment details
- Car make/model, country code

### 12.2 Other Security Considerations

- **Wallet signatures:** All state changes require wallet signature from authorized parties
- **Lot authorization:** Only whitelisted lot operator wallets can mint/close sessions
- **Rate limiting:** ALPR endpoint rate-limited to prevent abuse
- **Data retention:** Session data retained per local regulations (GDPR, CCPA, or equivalent)
- **Off-chain access control:** PostgreSQL contains PII (plates, wallet addresses); secured via network isolation and authentication

## 13. MVP Scope (Phase 1)

**In scope:**
- [ ] Driver registration (web app + wallet connect)
- [ ] Phone camera ALPR (simulates gate camera)
- [ ] Parking NFT minting on entry
- [ ] Duration tracking + fee calculation
- [ ] x402 payment on exit
- [ ] Basic gate UI (entry/exit simulation)
- [ ] Session history for drivers
- [ ] Deploy on Base Sepolia (testnet)

**Out of scope (Phase 2+):**
- Resilience: DB sync queue, health-check circuit breaker (see §11 — layers 1-3 are implemented)
- Physical gate hardware integration
- Multi-lot network
- Insurance verification
- Subscription / monthly pass NFTs
- Dynamic pricing (demand-based)
- Integration with municipal systems
- Native mobile app (iOS/Android)
- Live FX rate feeds (CoinGecko / Circle API)

## 14. Development Plan

| Phase | Duration | Deliverables |
|-------|----------|-------------|
| 1. Foundation | Week 1-2 | Smart contracts, deploy testnet, project scaffolding |
| 2. Driver App | Week 3-4 | Registration, wallet connect, session view, history |
| 3. Gate App | Week 5-6 | ALPR integration, entry/exit flow, operator dashboard |
| 4. Payments | Week 7 | x402 integration, fee calculation, settlement |
| 5. Polish & Test | Week 8 | E2E testing, UI polish, documentation |

## 15. Open Questions

1. ~~**Which chain?**~~ Resolved: dual-chain — Hedera (parking NFTs via HTS) + Base Sepolia (driver registry + x402 payments)
2. ~~**Currency conversion:**~~ Resolved: each lot sets its own currency; Stripe charges natively, x402 converts via FX rates
3. ~~**DB single point of failure:**~~ Resolved: write-ahead NFT + Mirror Node fallback + gate-side cache implemented (§11). Remaining P2 items: DB sync queue + circuit breaker.
4. **Unregistered cars:** Refuse entry? Allow with traditional ticket fallback?
5. **Insurance verification:** API to check valid insurance by plate? (country-specific registries)
6. **Multi-plate:** Drivers with multiple vehicles?
7. **Disputes:** What happens if driver claims wrong charge? On-chain evidence helps but need a process
8. **Live FX rates:** Replace static env var rates with CoinGecko / Circle API / oracle?
