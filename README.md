# Parker 🅿️

Decentralized parking management powered by blockchain and the x402 payment protocol.

## Motivation

Most parking lots today are fully automated: they scan license plates at entry and exit and charge the driver's credit card at the gate. Many lots also offer integrated apps to streamline payment. Yet the experience remains fragmented and frustrating. Some lots issue physical cards with barcodes or QR codes; others don't. To pay via app, drivers must scan a QR code — which often fails during peak hours. Some lots still require scanning the card at exit even after the driver has already paid through the app. Parker addresses these broken flows by moving parking onto the blockchain: tickets become NFTs, payments run on-chain via x402, and verification is instant — no cards, no QR scans, no gate confusion.

## Overview

Parker replaces broken centralized parking apps (like Tango) with a trustless, blockchain-based system. Parking tickets are NFTs, payments happen on-chain via x402, and verification is instant — no more "communication errors" at the gate.

## How It Works

```
┌─────────────┐         ┌──────────────┐         ┌────────────┐
│  Driver App  │◄───────►│  Blockchain  │◄───────►│  Gate App  │
│  (Mobile)    │         │  (NFTs/x402) │         │  (Lot Ops) │
└─────────────┘         └──────────────┘         └────────────┘
```

### Entry Flow
1. Car arrives at gate
2. Gate camera captures plate image, ALPR extracts plate number via Google Vision API
3. API checks if plate belongs to a registered driver
4. Parking NFT minted on-chain (entry time, plate, lot ID)
5. Session created in DB, WebSocket notifies driver app in real-time
6. Gate opens

### Exit Flow
1. Car approaches exit, plate scanned again
2. System finds active parking session and calculates fee (duration x rate, with billing increments and daily cap)
3. API responds with HTTP 402 + x402 payment details (USDC amount, receiver wallet)
4. Driver wallet signs and sends payment, request retried with proof
5. NFT marked as completed on-chain, session closed in DB
6. Gate opens, driver app notified via WebSocket

## Architecture

The app has three main components:

### 🚗 Driver App (PWA)
- Register with license plate, country, car make/model — on-chain via DriverRegistry contract + off-chain via API
- Coinbase Smart Wallet integration (passkey-based, no seed phrase)
- Live dashboard with active parking session card (real-time duration timer + estimated cost)
- Full parking history with date, lot, duration, fee, NFT token ID
- Profile page with vehicle details and wallet address
- Real-time WebSocket updates when sessions start/end

### 🚧 Gate App (PWA)
- Camera feed with ALPR overlay — captures frame, sends to scan API, gets plate back
- Entry/exit mode toggle with manual plate input fallback
- Live gate status indicator (open/closed) with operation result feedback
- Session manager — searchable table of active sessions with live duration and estimated fees
- Operator dashboard — lot occupancy, active session count, average duration
- Lot settings page — configure pricing (rate/hr, billing increment, daily cap), capacity, address
- WebSocket connection with live status indicator

### 🔧 API Server
- Express.js with PostgreSQL for off-chain indexing
- ALPR pipeline via `@parker/alpr` (Google Cloud Vision)
- On-chain integration via viem — mints parking NFTs on entry, ends sessions on exit (gracefully disabled when env vars not set)
- x402 payment middleware — returns HTTP 402 with payment instructions on exit, verifies payment proof on retry
- WebSocket server for real-time gate and driver events
- Full CRUD for drivers, sessions, and lots

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js 14 (PWA, mobile-first, Tailwind CSS) |
| Driver Wallet | Coinbase Smart Wallet via wagmi |
| Payments | x402 protocol (USDC on Base Sepolia) |
| Smart Contracts | Solidity 0.8.20 + Hardhat (Base L2) |
| ALPR | Google Cloud Vision API |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 16 (Docker) |
| Real-time | WebSocket (ws) |
| NFT Standard | ERC-721 (ParkingNFT) |
| Blockchain Client | viem |

## Quick Start

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- pnpm 9+
- Docker (for PostgreSQL)

### Setup

```bash
# Install dependencies
pnpm install

# Start PostgreSQL (creates schema + seeds demo data)
docker compose -f infra/docker-compose.yml up -d

# Copy environment files
cp apps/api/.env.example apps/api/.env
cp apps/driver/.env.example apps/driver/.env
cp apps/gate/.env.example apps/gate/.env

# Start all apps in dev mode
pnpm dev
```

This starts:
- **API** on `http://localhost:3001`
- **Driver app** on `http://localhost:3000`
- **Gate app** on `http://localhost:3002`

### Seed Data

The database is auto-seeded with:
- **Parker HQ** (lot-01) — 50 spaces, 3.30 USDC/hr, 15min billing, 25 USDC daily cap
- **Azrieli Center** (lot-02) — 200 spaces, 5.00 USDC/hr, 15min billing, 35 USDC daily cap
- A test driver (plate `1234567` / `12-345-67`, Toyota Corolla)

> Plates are stored in normalized form (digits only, no dashes). The API normalizes
> all incoming plates automatically, so `12-345-67`, `12 345 67`, and `1234567` all
> resolve to the same driver.

### Smart Contracts

```bash
# Compile contracts
pnpm contracts:compile

# Run tests
pnpm contracts:test

# Deploy to Base Sepolia (requires PRIVATE_KEY in contracts/.env)
pnpm contracts:deploy
```

## Project Structure

```
parker-app/
├── apps/
│   ├── api/             # Express API server
│   │   ├── src/
│   │   │   ├── db/          # PostgreSQL schema, queries, seed data
│   │   │   ├── routes/      # drivers, gate, sessions endpoints
│   │   │   ├── services/    # blockchain integration (viem)
│   │   │   ├── middleware/   # wallet auth
│   │   │   └── ws/          # WebSocket server
│   │   └── ...
│   ├── driver/          # Driver PWA (Next.js)
│   │   ├── src/
│   │   │   ├── app/         # pages: dashboard, register, history, profile, session detail
│   │   │   ├── components/  # SessionCard, WalletButton
│   │   │   ├── hooks/       # useDriverProfile, useParkerSocket
│   │   │   ├── lib/         # API client
│   │   │   └── providers/   # WalletProvider (wagmi + Coinbase Smart Wallet)
│   │   └── ...
│   └── gate/            # Gate operator app (Next.js)
│       ├── src/
│       │   ├── app/         # pages: live gate, dashboard, sessions, settings
│       │   ├── components/  # CameraFeed, PlateResult, GateStatus
│       │   ├── hooks/       # useGateSocket
│       │   └── lib/         # API client
│       └── ...
├── contracts/           # Solidity smart contracts
│   ├── contracts/       # DriverRegistry.sol, ParkingNFT.sol
│   ├── test/            # Full test suites for both contracts
│   └── scripts/         # Deploy script
├── packages/
│   ├── core/            # Shared types, utils (calculateFee, formatPlate, hashPlate), contract ABIs
│   ├── alpr/            # License plate recognition (Google Vision + Israeli plate normalization)
│   ├── x402/            # x402 payment middleware (server) + payment client (browser)
│   ├── tsconfig/        # Shared TypeScript configs
│   └── eslint-config/   # Shared ESLint config
├── infra/               # Docker Compose (PostgreSQL)
├── SPEC.md              # Detailed technical specification
└── turbo.json           # Turborepo pipeline config
```

## API Endpoints

### Driver API
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/drivers/register` | Register new driver + vehicle |
| GET | `/api/drivers/wallet/:address` | Look up driver by wallet address |
| GET | `/api/drivers/:plate` | Get driver profile by plate |
| PUT | `/api/drivers/:plate` | Update driver profile |
| DELETE | `/api/drivers/:plate` | Deactivate driver |

### Session API
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/active/:plate` | Get active parking session |
| GET | `/api/sessions/history/:plate` | Get session history |

### Gate API
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/gate/entry` | Process vehicle entry (plate string or image) |
| POST | `/api/gate/exit` | Process vehicle exit + trigger x402 payment |
| POST | `/api/gate/scan` | ALPR: upload image, get plate number |
| GET | `/api/gate/lot/:lotId/status` | Lot occupancy and config |
| GET | `/api/gate/lot/:lotId/sessions` | Active sessions list |
| PUT | `/api/gate/lot/:lotId` | Update lot settings |

### WebSocket
| Path | Description |
|------|-------------|
| `/ws/gate/:lotId` | Real-time gate events (entry/exit) |
| `/ws/driver/:plate` | Real-time session updates for driver |

## Validation & Safety

The API enforces the following invariants:

- **Plate normalization** — all plates are stripped of dashes/spaces before storage and lookup, so format differences never cause mismatches
- **Lot validation on entry** — entry is rejected if the lot doesn't exist, if it's full (capacity check), or if the driver is unregistered
- **Lot mismatch on exit** — a car can only exit from the lot it entered; mismatched `lotId` returns `400`
- **One active session per plate** — enforced at both application level and via a PostgreSQL partial unique index (`WHERE status = 'active'`)
- **Fee guardrails** — `calculateFee` handles zero/negative duration (minimum 1 billing increment), zero rate (fee = 0), and division-by-zero on billing interval (defaults to 15 min). Fees are rounded to 6 decimal places (USDC precision) and capped by `maxDailyFee`
- **Payment-before-close** — the exit route returns `402 Payment Required` without closing the session; the session is only closed after payment proof is provided
- **Input validation** — required fields are checked on all mutation endpoints; numeric lot settings reject `NaN`; session history `limit`/`offset` are sanitized and capped
- **Duplicate registration** — returns `409` with a clear error message instead of a generic 500
- **Status constraints** — `sessions.status` is enforced via `CHECK` constraint (`active`, `completed`, `cancelled`)

## Status

🚧 **MVP in active development**

- [x] Smart contracts (DriverRegistry + ParkingNFT) with tests
- [x] API server with full CRUD, ALPR, blockchain integration
- [x] Driver app: registration, wallet connect, session view, history, profile
- [x] Gate app: camera feed, ALPR scan, dashboard, sessions, settings
- [x] x402 payment flow (middleware + client)
- [x] Real-time WebSocket events
- [x] Database schema + seed data
- [x] Input validation, fee guardrails, race-condition guards
- [x] End-to-end smoke testing
- [ ] Deploy contracts to Base Sepolia
- [ ] On-chain payment verification (x402 signature check)
- [ ] Wallet authentication (SIWE / EIP-4361)
- [ ] Push notifications
- [ ] Physical gate hardware integration (Phase 2)

## License

MIT
