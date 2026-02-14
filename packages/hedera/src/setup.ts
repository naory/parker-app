/**
 * One-time setup script to create the "Parker Parking Sessions" NFT collection
 * on Hedera testnet.
 *
 * Usage:
 *   HEDERA_ACCOUNT_ID=0.0.xxxxx HEDERA_PRIVATE_KEY=302e... pnpm --filter @parker/hedera setup
 *
 * After running, copy the output HEDERA_TOKEN_ID into your .env files.
 */

import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  PrivateKey,
} from '@hashgraph/sdk'
import { createHederaClient } from './client'

async function main() {
  const accountId = process.env.HEDERA_ACCOUNT_ID
  const privateKey = process.env.HEDERA_PRIVATE_KEY
  const network = (process.env.HEDERA_NETWORK as 'testnet' | 'mainnet') || 'testnet'

  if (!accountId || !privateKey) {
    console.error('Error: HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are required')
    console.error('')
    console.error('Usage:')
    console.error('  HEDERA_ACCOUNT_ID=0.0.xxxxx HEDERA_PRIVATE_KEY=302e... pnpm --filter @parker/hedera setup')
    process.exit(1)
  }

  console.log(`Creating Parker NFT collection on Hedera ${network}...`)
  console.log(`  Operator: ${accountId}`)

  const client = createHederaClient({ accountId, privateKey, network })
  const supplyKey = PrivateKey.fromStringDer(privateKey)

  const tx = new TokenCreateTransaction()
    .setTokenName('Parker Parking Sessions')
    .setTokenSymbol('PARK')
    .setTokenType(TokenType.NonFungibleUnique)
    .setDecimals(0)
    .setInitialSupply(0)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(client.operatorAccountId!)
    .setSupplyKey(supplyKey)
    .setAdminKey(supplyKey)
    .freezeWith(client)

  const signedTx = await tx.sign(supplyKey)
  const response = await signedTx.execute(client)
  const receipt = await response.getReceipt(client)

  const tokenId = receipt.tokenId!.toString()

  console.log('')
  console.log('=== Parker NFT Collection Created ===')
  console.log(`  Token ID:       ${tokenId}`)
  console.log(`  Transaction:    ${response.transactionId.toString()}`)
  console.log(`  Network:        ${network}`)
  console.log('')
  console.log('Add to your .env:')
  console.log(`  HEDERA_TOKEN_ID=${tokenId}`)

  client.close()
}

main().catch((err) => {
  console.error('Setup failed:', err)
  process.exit(1)
})
