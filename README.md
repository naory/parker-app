# Parker 🅿️

Decentralized parking management powered by blockchain, the x402 payment protocol, and multi-currency Stripe checkout.

## Motivation

Most parking lots today are fully automated: they scan license plates at entry and exit and charge the driver's credit card at the gate. Many lots also offer integrated apps to streamline payment. Yet the experience remains fragmented and frustrating. Some lots issue physical cards with barcodes or QR codes; others don't. To pay via app, drivers must scan a QR code — which often fails during peak hours. Some lots still require scanning the card at exit even after the driver has already paid through the app. Parker addresses these broken flows by moving parking onto the blockchain: tickets become NFTs, payments run on-chain via x402, and verification is instant — no cards, no QR scans, no gate confusion.

## Overview

Parker replaces broken centralized parking apps (like Tango) with a trustless, blockchain-based system. Parking tickets are NFTs, payments happen via x402 (stablecoin) or Stripe (credit card) — each lot configures its own local currency and accepted payment methods. Verification is instant — no more "communication errors" at the gate.

### White-Label Deployment Model

Parker is a multi-country, currency-agnostic platform — but each deployment is operated by a **country or regional entity** that white-labels it for their market. A single deployment is scoped to one country (e.g., Israel, US) or one region (e.g., EU).

The `DEPLOYMENT_COUNTRIES` environment variable controls:
- **Driver registration** — only countries in the deployment are shown; single-country deployments auto-select and hide the picker
- **ALPR** — plate format validation is restricted to the deployment's country patterns
- **Currency & payments** — each lot configures its own currency, but all lots in a deployment typically share the same local currency and FX rate

```
# Single-country deployment (Israel)
DEPLOYMENT_COUNTRIES=IL

# Regional deployment (EU)
DEPLOYMENT_COUNTRIES=DE,FR,ES,IT,NL,GB,AT,BE
```

## How It Works

```
                         ┌───────────────────┐
                         │   Hedera (NFTs)   │
                         │   HTS Token Svc   │
                         └────────▲──────────┘
                                  │
┌─────────────┐         ┌────────┴─────────┐         ┌────────────┐
│  Driver App  │◄───────►│   Parker API     │◄───────►│  Gate App  │
│  (Wallet)    │         │  (Express.js)    │         │  (Lot Ops) │
└──────┬──────┘         └───────┬──────────┘         └────────────┘
       │                        │
       ▼                        ▼
┌──────────────┐        ┌──────────────┐
│  Base Sepolia │        │    Stripe    │
│ (x402/USDC)  │        │ (Card/local) │
└──────────────┘        └──────────────┘
```

**Hedera-first + dual-rail architecture (with optional Base components):**
- **Hedera** — Parking session NFTs via native Token Service (mint on entry, burn on exit)
- **Base Sepolia (optional per deployment)** — DriverRegistry sync and x402 stablecoin rail
- **Stripe** — Credit card payments in the lot's local currency (any Stripe-supported currency)

### Entry Flow
1. Car arrives at gate
2. Gate camera captures plate image, ALPR extracts plate number via Google Vision API
3. API checks if plate belongs to a registered driver
4. Parking NFT minted on **Hedera** via HTS (AES-256-GCM encrypted metadata carrying `plateHash`, lot ID, entry time) — **write-ahead**: the on-chain NFT is the authoritative proof of entry
5. Session created in DB, WebSocket notifies driver app in real-time
6. Gate opens

### Exit Flow
1. Car approaches exit, plate scanned again
2. System finds active parking session and calculates fee in the lot's local currency
3. API returns **payment options** based on lot config:
   - **x402 (crypto)** — fee converted to stablecoin (e.g. USDC) via FX rate; driver wallet signs and sends payment, request retried with proof
   - **Stripe (card)** — Stripe Checkout session created in the lot's currency; driver redirected to Stripe-hosted page; webhook confirms payment
4. On payment confirmation (either rail): parking NFT burned on **Hedera**, session closed in DB
5. Gate opens automatically, driver app notified via WebSocket

### Resilience: On-Chain vs Off-Chain

Following the [Hedera pragmatic design patterns](https://hedera.com/blog/pragmatic-blockchain-design-patterns-integrating-blockchain-into-business-processes/) and the same hybrid model used by [MINGO Tickets](https://mingoapps.com/), Parker uses a layered resilience strategy:

| Layer | Source | When |
|-------|--------|------|
| **1. PostgreSQL** | Fast path for all operations | Default — DB is up |
| **2. Hedera Mirror Node** | Read-only fallback — verifies NFT exists + reads entry metadata | DB unreachable |
| **3. Gate-side cache** | Local session cache built from WebSocket events | Both DB and Mirror Node down |

**Why not make Hedera the primary?** Blockchain consensus is fast (~3-5s on Hedera) but PostgreSQL is faster (~1ms). At a busy parking gate, every second matters. The DB handles the operational speed; Hedera provides the trust guarantee and fallback. This matches how MINGO uses Hedera as an "invisible trust layer" rather than the operational database.

**Key design principle:** The Hedera NFT is minted *before* the DB write on entry (write-ahead). This means the on-chain record is always the leading indicator — if the DB loses a record, the NFT on Hedera proves the car is parked. See `SPEC.md` §11 for the full resilience architecture.

## Architecture

The app has three main components:

### 🚗 Driver App (PWA)
- Register with license plate, country, car make/model — off-chain via API, with optional on-chain sync to `DriverRegistry` on Base
- Coinbase Smart Wallet integration (passkey-based, no seed phrase)
- Live dashboard with active parking session card (lot name, address with Google Maps link, real-time duration timer + estimated cost)
- Full parking history with date, lot, duration, fee, NFT token ID
- Profile page with vehicle details and wallet address
- Real-time WebSocket updates when sessions start/end

### 🚧 Gate App (PWA)
- Camera feed with ALPR overlay — captures frame, sends to scan API, gets plate back
- Lot name and address displayed in header (fetched from lot status API)
- Entry/exit mode toggle with manual plate input fallback
- Live gate status indicator (open/closed) with operation result feedback
- Session manager — searchable table of active sessions with live duration and estimated fees
- Operator dashboard — lot occupancy, active session count, average duration
- Lot settings page — configure pricing (rate/hr, billing increment, daily cap), capacity, address
- WebSocket connection with live status indicator
- **Offline-capable**: local session cache built from WebSocket events — if the API is unreachable, the gate can still validate exits from its cache and open the gate (payment deferred)

### 🔧 API Server
- Express.js with PostgreSQL for off-chain indexing
- ALPR pipeline via `@parker/alpr` (Google Cloud Vision)
- **Hedera integration** via `@parker/hedera` (`@hashgraph/sdk`) — mints parking NFTs on entry, burns on exit
- **Optional Base integration** via viem — DriverRegistry reads/sync on Base Sepolia
- **Multi-currency payment** — each lot defines its own currency (USD, EUR, GBP, etc.) and accepted payment methods
- **x402 payment middleware** — returns HTTP 402 with stablecoin amount (FX-converted from local currency); verifies payment proof on retry
- **Stripe Checkout** — creates payment sessions in the lot's local currency; webhook-driven session closure
- **Pricing service** — currency-agnostic FX conversion via configurable rates (`FX_RATE_{FROM}_{TO}` env vars)
- WebSocket server for real-time gate and driver events
- Full CRUD for drivers, sessions, and lots

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js 14 (PWA, mobile-first, Tailwind CSS) |
| Driver Wallet | Coinbase Smart Wallet via wagmi |
| Payments (crypto) | x402 protocol (stablecoin on Base Sepolia) |
| Payments (card) | Stripe Checkout (any Stripe-supported currency) |
| Parking NFTs | Hedera Token Service (native HTS, `@hashgraph/sdk`) |
| Driver Registry (optional) | Solidity 0.8.20 + Hardhat (Base Sepolia) |
| ALPR | Google Cloud Vision API |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 16 (Docker) |
| Real-time | WebSocket (ws) |
| Blockchain Clients | `@hashgraph/sdk` (Hedera) + viem (Base) |

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

# Set deployment country (controls ALPR plate format + driver registration)
# Edit each .env and set DEPLOYMENT_COUNTRIES to your target market, e.g.:
#   DEPLOYMENT_COUNTRIES=IL          (Israel)
#   DEPLOYMENT_COUNTRIES=US          (United States)
#   DEPLOYMENT_COUNTRIES=DE,FR,ES    (EU region)

# Start all apps in dev mode
pnpm dev
```

This starts:
- **API** on `http://localhost:3001`
- **Driver app** on `http://localhost:3000`
- **Gate app** on `http://localhost:3002`

### Seed Data

The database is auto-seeded with two demo lots and a test driver. Each lot has its own currency, rates, and payment methods — see `apps/api/src/db/seed.sql` for details.

> The system is fully currency-agnostic — each lot configures its own ISO 4217 currency and rates. Seed data uses sample values for demonstration.

> Plates are stored in normalized form (alphanumeric, no dashes). The API normalizes
> all incoming plates automatically, so `12-345-67`, `12 345 67`, and `1234567` all
> resolve to the same driver.

### Try It Now (Seed Data)

Use the default seeded values:
- `lotId=lot-01`
- `plateNumber=1234567`

```bash
# Entry (starts session + mints Hedera HTS NFT when configured)
curl -X POST http://localhost:3001/api/gate/entry \
  -H "Content-Type: application/json" \
  -d '{"plateNumber":"1234567","lotId":"lot-01"}'

# Exit (returns fee + payment options; session closes after payment confirmation)
curl -X POST http://localhost:3001/api/gate/exit \
  -H "Content-Type: application/json" \
  -d '{"plateNumber":"1234567","lotId":"lot-01"}'
```

Where to look:
- **Gate UI:** `http://localhost:3002` (live entry/exit status + cache badge)
- **Driver UI:** `http://localhost:3000` (active session, payment flow, history)
- **Hedera NFT:** in Driver history, click the Hashscan link (set `NEXT_PUBLIC_HEDERA_TOKEN_ID` in `apps/driver/.env` to enable links)

### Hedera Setup (Parking NFTs)

```bash
# 1. Create a Hedera testnet account at https://portal.hedera.com/register
# 2. Add credentials to apps/api/.env:
#      HEDERA_ACCOUNT_ID=0.0.xxxxx
#      HEDERA_PRIVATE_KEY=302e...
#      HEDERA_NETWORK=testnet

# 3. Create the NFT collection on Hedera:
pnpm --filter @parker/hedera setup

# 4. Copy the output HEDERA_TOKEN_ID into apps/api/.env
```

### Payment Configuration

Parker supports two payment rails per lot, both optional:

**Stripe (credit card)** — charges in the lot's configured currency (USD, EUR, GBP, etc.):
```bash
# Add to apps/api/.env:
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=http://localhost:3000/payment/success
STRIPE_CANCEL_URL=http://localhost:3000/payment/cancel
```

**x402 (stablecoin)** — converts the lot's local currency fee to stablecoin via FX rate:
```bash
# Add to apps/api/.env:
X402_STABLECOIN=USDC
X402_NETWORK=base-sepolia
LOT_OPERATOR_WALLET=0x...

# FX rates (only needed when lot currency differs from stablecoin base):
FX_RATE_EUR_USD=1.08
FX_RATE_GBP_USD=1.27
```

Each lot's `currency` and `paymentMethods` are stored in the database and can be updated via `PUT /api/gate/lot/:lotId`.

### Smart Contracts (Base — DriverRegistry)

```bash
# Compile contracts
pnpm contracts:compile

# Run tests
pnpm contracts:test

# Deploy DriverRegistry to Base Sepolia (requires PRIVATE_KEY in contracts/.env)
pnpm contracts:deploy
```

## Project Structure

```
parker-app/
├── apps/
│   ├── api/             # Express API server
│   │   ├── src/
│   │   │   ├── db/          # PostgreSQL schema, queries, seed data
│   │   │   ├── routes/      # drivers, gate, sessions, webhooks endpoints
│   │   │   ├── services/    # hedera.ts, blockchain.ts, stripe.ts, pricing.ts
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
│       │   ├── hooks/       # useGateSocket, useSessionCache (offline resilience)
│       │   └── lib/         # API client
│       └── ...
├── contracts/           # Solidity smart contracts
│   ├── contracts/       # DriverRegistry.sol (+ legacy ParkingNFT.sol reference contract)
│   ├── test/            # Full test suites for both contracts
│   └── scripts/         # Deploy script
├── packages/
│   ├── core/            # Shared types, utils (calculateFee, formatPlate, hashPlate), contract ABIs
│   ├── hedera/          # Hedera HTS integration (mint/burn NFTs, mirror node queries, setup script)
│   ├── alpr/            # License plate recognition (Google Vision + country-aware plate normalization)
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
| POST | `/api/gate/exit` | Process vehicle exit + return payment options (x402 + Stripe) |
| POST | `/api/gate/scan` | ALPR: upload image, get plate number |
| GET | `/api/gate/lot/:lotId/status` | Lot occupancy, config, currency, payment methods |
| GET | `/api/gate/lot/:lotId/sessions` | Active sessions list |
| PUT | `/api/gate/lot/:lotId` | Update lot settings (rates, currency, payment methods) |

### Webhooks
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhooks/stripe` | Stripe payment confirmation (closes session + burns NFT) |

### WebSocket
| Path | Description |
|------|-------------|
| `/ws/gate/:lotId` | Real-time gate events (entry/exit) |
| `/ws/driver/:plate` | Real-time session updates for driver |

## Privacy & Security

**On-chain privacy:** Plate numbers are **never stored in plaintext** on Hedera. Parker hashes the plate (`plateHash`) and then stores NFT metadata as an **AES-256-GCM encrypted binary payload** on HTS. Public Mirror Node readers see ciphertext bytes, not readable plate/lot/time fields. The API can decrypt metadata with `NFT_ENCRYPTION_KEY` for fallback lookups, while plaintext plate data remains only in the access-controlled PostgreSQL database. See `SPEC.md` §12.1 for the full privacy model.

## Validation & Safety

The API enforces the following invariants:

- **Plate normalization** — all plates are stripped of dashes/spaces before storage and lookup, so format differences never cause mismatches. ALPR plate detection is scoped to the deployment's configured countries (`DEPLOYMENT_COUNTRIES`) for higher accuracy
- **Lot validation on entry** — entry is rejected if the lot doesn't exist, if it's full (capacity check), or if the driver is unregistered
- **Lot mismatch on exit** — a car can only exit from the lot it entered; mismatched `lotId` returns `400`
- **One active session per plate** — enforced at both application level and via a PostgreSQL partial unique index (`WHERE status = 'active'`)
- **Fee guardrails** — `calculateFee` handles zero/negative duration (minimum 1 billing increment), zero rate (fee = 0), and division-by-zero on billing interval (defaults to 15 min). Fees are rounded to 6 decimal places and capped by `maxDailyFee`
- **Multi-currency** — each lot defines its own currency (ISO 4217); the pricing service converts to stablecoin via configurable FX rates for the x402 rail, while Stripe charges in the lot's native currency directly
- **Payment-before-close** — the exit route returns payment options without closing the session; the session is only closed after payment confirmation (x402 proof header or Stripe webhook)
- **Idempotent webhooks** — Stripe webhook handler checks if the session is still active before closing, preventing duplicate closures on retry
- **Input validation** — required fields are checked on all mutation endpoints; numeric lot settings reject `NaN`; session history `limit`/`offset` are sanitized and capped
- **Duplicate registration** — returns `409` with a clear error message instead of a generic 500
- **Status constraints** — `sessions.status` is enforced via `CHECK` constraint (`active`, `completed`, `cancelled`)

## Status

🚧 **MVP in active development**

- [x] On-chain architecture: Hedera HTS parking NFTs + optional Base DriverRegistry/x402 rail
- [x] API server with full CRUD, ALPR, blockchain integration
- [x] Driver app: registration, wallet connect, session view, history, profile
- [x] Gate app: camera feed, ALPR scan, dashboard, sessions, settings
- [x] x402 payment flow (middleware + client)
- [x] Multi-currency support: per-lot currency config, FX conversion for x402 rail
- [x] Stripe Checkout integration: credit card payments in any local currency
- [x] Dual payment rails: Stripe (card) + x402 (stablecoin) per lot config
- [x] Stripe webhook with idempotent session closure
- [x] Real-time WebSocket events (gate auto-opens on payment from any rail)
- [x] Database schema + seed data
- [x] Input validation, fee guardrails, race-condition guards
- [x] End-to-end smoke testing
- [ ] Deploy DriverRegistry to Base Sepolia (if Base registry sync is enabled)
- [ ] Create Hedera NFT collection on testnet
- [x] Write-ahead NFT minting (mint before DB write on entry)
- [x] Mirror Node fallback for exit when DB is unreachable
- [x] Gate-side session cache for offline-capable exit validation
- [x] On-chain payment verification (x402 ERC20 transfer verification via viem)
- [ ] Live FX rate feed (CoinGecko / Circle API) to replace static env var rates
- [x] Wallet authentication (SIWE / EIP-4361)
- [ ] Push notifications
- [ ] Physical gate hardware integration (Phase 2)

## License

MIT
