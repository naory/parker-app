# Parker 🅿️

Decentralized parking management powered by blockchain and the x402 payment protocol.

## Motivation

Most parking lots today are fully automated: they scan license plates at entry and exit and charge the driver's credit card at the gate. Many lots also offer integrated apps to streamline payment. Yet the experience remains fragmented and frustrating. Some lots issue physical cards with barcodes or QR codes; others don't. To pay via app, drivers must scan a QR code—which often fails during peak hours. Some lots still require scanning the card at exit even after the driver has already paid through the app. Parker addresses these broken flows by moving parking onto the blockchain: tickets become NFTs, payments run on-chain via x402, and verification is instant—no cards, no QR scans, no gate confusion.

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
1. Car arrives → Gate camera reads license plate (ALPR)
2. Gate app checks if plate is linked to a registered Driver wallet
3. Gate opens → Parking NFT minted (entry time, plate, lot ID)

### Exit Flow
1. Car approaches exit → Gate camera reads plate
2. System finds parking NFT → calculates fee (duration × rate)
3. Driver wallet is charged via x402 (USDC or fiat fallback)
4. NFT marked as completed → gate opens

## Architecture

The app has two sections:

### 🚗 Driver
- Register with license plate, country, insurance, car make/model
- Link payment method (crypto wallet + optional credit card)
- View active parking sessions (live duration & estimated cost)
- History of all parking events (NFT receipts)
- Push notifications on entry/exit/charge

### 🚧 Gate
- Camera feed with ALPR (Automatic License Plate Recognition)
- Real-time plate → driver lookup
- Mint parking NFTs on entry
- Calculate fees & charge wallets on exit
- Operator dashboard (occupancy, revenue, session log)
- Fallback for unregistered vehicles

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (PWA, mobile-first) |
| Driver Wallet | Coinbase Smart Wallet / WalletConnect |
| Payments | x402 protocol (USDC on Base) |
| Smart Contracts | Solidity (Base L2) |
| ALPR | Google Vision API / OpenALPR |
| Backend | Node.js + Express |
| Database | PostgreSQL (off-chain index) |
| NFT Standard | ERC-721 (parking tickets) |

## Quick Start

```bash
# Coming soon
npm install
npm run dev
```

## Project Structure

```
parker-app/
├── README.md
├── SPEC.md              # Technical specification
├── contracts/           # Solidity smart contracts
├── apps/
│   ├── driver/          # Driver PWA (Next.js)
│   └── gate/            # Gate operator app (Next.js)
├── packages/
│   ├── core/            # Shared types, utils, blockchain client
│   ├── alpr/            # License plate recognition module
│   └── x402/            # x402 payment integration
└── infra/               # Docker, deployment configs
```

## Status

🚧 **MVP in development** — Specification phase

## License

MIT
