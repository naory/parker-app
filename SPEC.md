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
    string plateNumber;      // e.g., "12-345-67"
    string countryCode;      // ISO 3166-1 alpha-2, e.g., "IL"
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

Example:
- Rate: 12 ILS/hour (≈ 3.30 USDC) → 0.055 USDC/min
- Billing increment: 15 minutes
- Duration: 2h 10m (130 min) → ceil(130/15) = 9 increments
- Fee: 9 × (0.055 × 15) = 9 × 0.825 = 7.43 USDC
```

Rates are set per-lot by the operator and stored on-chain or in a rate oracle.

## 5. ALPR (License Plate Recognition)

### 5.1 MVP Approach
- **Phone camera** simulates gate camera (MVP)
- Capture image → send to backend → OCR pipeline
- Use Google Cloud Vision API or OpenALPR for plate detection
- Support Israeli plates (format: `XX-XXX-XX` or `XXX-XX-XXX`)

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
x402 is Coinbase's open payment protocol built on HTTP 402 (Payment Required).
- Repo: https://github.com/coinbase/x402
- Zero protocol fees
- USDC on Base (L2) — near-zero gas costs
- One line of middleware on the server

### 6.2 Payment Flow
```
1. Gate app calls: POST /api/sessions/{plate}/end
2. Backend calculates fee
3. Backend responds with HTTP 402 + payment details
4. Driver wallet (auto or manual) signs payment
5. x402 facilitator verifies & settles on-chain
6. Backend receives confirmation → opens gate
```

### 6.3 Server Integration
```typescript
import { paymentMiddleware } from "@x402/express";

app.use(paymentMiddleware({
  "POST /api/sessions/:plate/end": {
    accepts: [
      {
        network: "base",
        token: "USDC",
        maxAmountRequired: "$50.00", // Max parking fee
      }
    ],
    description: "Parking fee payment",
  },
}));
```

### 6.4 Fiat Fallback
For drivers without crypto wallets:
- Coinbase Onramp for card → USDC conversion
- Or traditional Stripe integration as fallback
- Driver app supports both payment rails

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
- Payment charged: "₪12.00 charged for 2h 15m at [Lot Name]"

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
    id            UUID PRIMARY KEY,
    token_id      BIGINT UNIQUE,          -- NFT token ID
    plate_number  VARCHAR(20) NOT NULL,
    lot_id        VARCHAR(50) NOT NULL,
    entry_time    TIMESTAMPTZ NOT NULL,
    exit_time     TIMESTAMPTZ,
    fee_usdc      DECIMAL(10, 6),
    tx_hash       VARCHAR(66),            -- payment tx
    status        VARCHAR(20) DEFAULT 'active',  -- active | completed | disputed
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Parking lot configuration
CREATE TABLE lots (
    id              VARCHAR(50) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    address         TEXT,
    lat             DECIMAL(10, 7),
    lng             DECIMAL(10, 7),
    capacity        INT,
    rate_per_hour   DECIMAL(10, 2),       -- in USDC
    billing_minutes INT DEFAULT 15,        -- billing increment
    max_daily_fee   DECIMAL(10, 2),
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
POST   /api/gate/exit                 — Process vehicle exit + trigger payment
POST   /api/gate/scan                 — ALPR: upload image, get plate string
GET    /api/gate/lot/:lotId/status    — Lot occupancy & stats
```

### Webhook / Events
```
WS     /ws/gate/:lotId               — Real-time gate events
WS     /ws/driver/:plate             — Real-time session updates for driver
```

## 11. Security Considerations

- **Plate privacy:** Plate numbers stored as hashes on-chain; plaintext only off-chain with access control
- **Wallet signatures:** All state changes require wallet signature from authorized parties
- **Lot authorization:** Only whitelisted lot operator wallets can mint/close sessions
- **Rate limiting:** ALPR endpoint rate-limited to prevent abuse
- **Data retention:** Session data retained per local regulations (Israel: check GDPR-equivalent)

## 12. MVP Scope (Phase 1)

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
- Physical gate hardware integration
- Multi-lot network
- Insurance verification
- Subscription / monthly pass NFTs
- Dynamic pricing (demand-based)
- Integration with municipal systems
- Native mobile app (iOS/Android)
- Multi-chain support (Hedera, etc.)

## 13. Development Plan

| Phase | Duration | Deliverables |
|-------|----------|-------------|
| 1. Foundation | Week 1-2 | Smart contracts, deploy testnet, project scaffolding |
| 2. Driver App | Week 3-4 | Registration, wallet connect, session view, history |
| 3. Gate App | Week 5-6 | ALPR integration, entry/exit flow, operator dashboard |
| 4. Payments | Week 7 | x402 integration, fee calculation, settlement |
| 5. Polish & Test | Week 8 | E2E testing, UI polish, documentation |

## 14. Open Questions

1. **Which chain?** Base (x402 native) vs Hedera (original inspiration) — starting with Base for x402 compatibility
2. **ILS conversion:** Display fees in ILS but settle in USDC? Need a price oracle
3. **Unregistered cars:** Refuse entry? Allow with traditional ticket fallback?
4. **Insurance verification:** API to check valid insurance by plate? (Israel Misrad HaRishui)
5. **Multi-plate:** Drivers with multiple vehicles?
6. **Disputes:** What happens if driver claims wrong charge? On-chain evidence helps but need a process
