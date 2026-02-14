# Parker App — TODO

## Features

- [ ] **Gate: Payment QR code fallback**
  Display a QR code on the gate exit screen containing the payment request details (fee, receiver wallet, session ID). Serves as a fallback when the driver's WebSocket connection is unreliable — the driver can scan the QR to open a payment page directly.

- [ ] **Parking history: View NFT on Hedera explorer**
  Add a link/button on each completed session in the parking history page that opens the parking NFT on hashscan.io (e.g. `https://hashscan.io/testnet/token/{tokenId}/{serial}`).

## Technical Debt

- [ ] **Real x402 payment verification**
  The x402 middleware currently trusts the `X-PAYMENT` header (MVP pass-through). Implement on-chain verification of the USDC transfer before marking payment as confirmed.

- [ ] **Stripe webhook integration**
  Wire up Stripe webhook endpoint to confirm card payments and trigger gate open via WebSocket.

- [ ] **ALPR: Google Cloud credentials**
  `recognizePlate()` requires `GOOGLE_APPLICATION_CREDENTIALS` to be configured. Currently untested with real credentials.
