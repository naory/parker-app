/**
 * On-chain payment watcher.
 *
 * Watches for USDC Transfer events on Base Sepolia to auto-settle parking
 * sessions when drivers pay via EIP-681 QR codes (scanned with any wallet).
 *
 * Flow:
 * 1. Gate exit registers a pending payment (expected amount + receiver)
 * 2. This watcher sees the Transfer event on-chain
 * 3. Matches it to a pending payment (receiver + amount within 1% tolerance)
 * 4. Settles the session: ends DB session, burns NFT, notifies gate + driver
 */

import type { PublicClient, Log } from 'viem'
import { parseAbi } from 'viem'
import { USDC_ADDRESSES } from '@parker/core'
import type { SettlementResult, Asset } from '@parker/policy-core'

import { db } from '../db'
import { enforceOrReject } from './policy/enforceOrReject'
import { notifyGate, notifyDriver } from '../ws/index'
import { isHederaEnabled, endParkingSessionOnHedera } from './hedera'

const CHAIN_ID_BY_NETWORK: Record<string, number> = {
  'base-sepolia': 84532,
  'base': 8453,
}

// ---- Types ----

export interface PendingPayment {
  plate: string
  lotId: string
  sessionId: string
  /** Expected stablecoin amount as a decimal string (e.g. "1.500000") */
  expectedAmount: string
  /** Operator wallet that should receive the transfer */
  receiverWallet: string
  fee: number
  feeCurrency: string
  tokenId?: number
  createdAt: number
  /** Policy decision binding (for enforcement at settlement) */
  decisionId?: string
  policyHash?: string
  rail?: string
  /** Asset as JSON string if needed (e.g. IOU/ERC20) */
  asset?: string
}

// ---- State ----

const pendingPayments = new Map<string, PendingPayment>()

// ---- Public API ----

export function addPendingPayment(pending: PendingPayment) {
  pendingPayments.set(pending.sessionId, pending)
  console.log(
    `[paymentWatcher] Registered pending payment: session=${pending.sessionId}, amount=${pending.expectedAmount}, receiver=${pending.receiverWallet}`,
  )
}

export function removePendingPayment(sessionId: string) {
  const removed = pendingPayments.delete(sessionId)
  if (removed) {
    console.log(`[paymentWatcher] Removed pending payment: session=${sessionId}`)
  }
}

export function getPendingPaymentByPlateLot(plate: string, lotId: string): PendingPayment | null {
  for (const pending of pendingPayments.values()) {
    if (pending.plate === plate && pending.lotId === lotId) {
      return pending
    }
  }
  return null
}

// ---- ERC-20 Transfer ABI ----

const ERC20_TRANSFER_EVENT = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])

// ---- Watcher ----

const PRUNE_INTERVAL_MS = 5 * 60_000 // 5 minutes
const MAX_PENDING_AGE_MS = 30 * 60_000 // 30 minutes

export function startPaymentWatcher(publicClient: PublicClient | null, network = 'base-sepolia') {
  if (!publicClient) {
    console.warn('[paymentWatcher] No publicClient provided — on-chain payment watching disabled')
    return
  }

  const usdcAddress = USDC_ADDRESSES[network]
  if (!usdcAddress) {
    console.warn(`[paymentWatcher] No USDC address for network "${network}" — watcher disabled`)
    return
  }

  console.log(`[paymentWatcher] Watching USDC Transfer events on ${network} (${usdcAddress})`)

  const chainId = CHAIN_ID_BY_NETWORK[network] ?? 0

  // Watch for Transfer events on the USDC contract
  publicClient.watchContractEvent({
    address: usdcAddress,
    abi: ERC20_TRANSFER_EVENT,
    eventName: 'Transfer',
    onLogs: (logs) => {
      for (const log of logs) {
        handleTransferEvent(log, { usdcAddress, chainId })
      }
    },
    onError: (error) => {
      console.error('[paymentWatcher] Event subscription error:', error.message)
    },
  })

  // Periodic cleanup of stale pending payments
  const pruneTimer = setInterval(() => {
    const now = Date.now()
    for (const [sessionId, pending] of pendingPayments) {
      if (now - pending.createdAt > MAX_PENDING_AGE_MS) {
        pendingPayments.delete(sessionId)
        console.log(`[paymentWatcher] Pruned stale pending payment: session=${sessionId}`)
      }
    }
  }, PRUNE_INTERVAL_MS)

  // Don't prevent process from exiting
  pruneTimer.unref()
}

// ---- Event handler ----

async function handleTransferEvent(
  log: Log,
  ctx: { usdcAddress: string; chainId: number },
) {
  const args = (log as any).args as { from: string; to: string; value: bigint } | undefined
  if (!args) return

  const txHash = log.transactionHash ?? ''
  const { to, value } = args

  // Find a pending payment where the receiver matches
  for (const [sessionId, pending] of pendingPayments) {
    if (to.toLowerCase() !== pending.receiverWallet.toLowerCase()) continue

    // Check amount within 1% tolerance
    const expectedSmallestUnit = parseDecimalToSmallestUnit(pending.expectedAmount, 6)
    if (expectedSmallestUnit === 0n) continue

    const tolerance = expectedSmallestUnit / 100n // 1%
    const diff =
      value > expectedSmallestUnit ? value - expectedSmallestUnit : expectedSmallestUnit - value

    if (diff > tolerance) continue

    // Replay protection: same tx_hash must not settle twice
    const alreadySettled = await db.hasSettlementForTxHash(txHash)
    if (alreadySettled) {
      await db.insertPolicyEvent({
        eventType: 'riskSignal',
        payload: { signal: 'REPLAY_SUSPICION', txHash, sessionId: pending.sessionId },
        sessionId: pending.sessionId,
        txHash,
      })
      console.warn(`[paymentWatcher] Replay ignored: tx=${txHash}`)
      return
    }

    // Same contract as XRPL route + Stripe webhook: enforceOrReject before close, persist events
    if (!pending.decisionId) {
      console.warn(`[paymentWatcher] No decisionId bound — skipping settlement for session=${sessionId}`)
      return
    }
    const asset: Asset = pending.asset
      ? (JSON.parse(pending.asset) as Asset)
      : { kind: 'ERC20', chainId: ctx.chainId, token: ctx.usdcAddress }
    const settlement: SettlementResult = {
      amount: value.toString(),
      asset,
      rail: 'evm',
      txHash,
      payer: args.from,
    }
    const enforcement = await enforceOrReject(
      db.getDecisionPayloadByDecisionId.bind(db),
      pending.decisionId,
      settlement,
    )
    if (!enforcement.allowed) {
      await db.insertPolicyEvent({
        eventType: 'enforcementFailed',
        payload: {
          decisionId: pending.decisionId,
          reason: enforcement.reason,
          settlement: { amount: settlement.amount, rail: settlement.rail, txHash },
        },
        sessionId: pending.sessionId,
        decisionId: pending.decisionId,
        txHash,
      })
      console.warn(
        `[paymentWatcher] Enforcement failed: session=${sessionId}, reason=${enforcement.reason}`,
      )
      return
    }
    // Decision→grant linkage: decision must reference session's grant when session has one
    const session = await db.getActiveSession(pending.plate)
    if (session?.policyGrantId && pending.decisionId) {
      const decisionPayload = (await db.getDecisionPayloadByDecisionId(pending.decisionId)) as
        | { sessionGrantId?: string | null }
        | null
      if (
        decisionPayload?.sessionGrantId != null &&
        decisionPayload.sessionGrantId !== session.policyGrantId
      ) {
        await db.insertPolicyEvent({
          eventType: 'enforcementFailed',
          payload: {
            decisionId: pending.decisionId,
            reason: 'NEEDS_APPROVAL',
            settlement: { amount: settlement.amount, rail: settlement.rail, txHash },
          },
          sessionId: pending.sessionId,
          decisionId: pending.decisionId,
          txHash,
        })
        console.warn(
          `[paymentWatcher] Grant mismatch: session=${sessionId}, sessionGrantId !== session.policyGrantId`,
        )
        return
      }
    }
    await db.insertPolicyEvent({
      eventType: 'settlementVerified',
      payload: {
        decisionId: pending.decisionId,
        amount: value.toString(),
        rail: 'evm',
      },
      sessionId: pending.sessionId,
      decisionId: pending.decisionId,
      txHash,
    })

    // Match found — settle
    console.log(
      `[paymentWatcher] On-chain payment matched: session=${sessionId}, tx=${txHash}`,
    )
    pendingPayments.delete(sessionId)

    try {
      await settleSession(pending)
    } catch (err) {
      console.error(`[paymentWatcher] Failed to settle session=${sessionId}:`, err)
    }

    return // One transfer settles one session
  }
}

async function settleSession(pending: PendingPayment) {
  const { plate, lotId, sessionId, fee, feeCurrency, tokenId } = pending

  // Burn parking NFT on Hedera if applicable
  if (isHederaEnabled() && tokenId) {
    try {
      await endParkingSessionOnHedera(tokenId)
    } catch (err) {
      console.error(`[paymentWatcher] Hedera NFT burn failed for session=${sessionId}:`, err)
    }
  }

  // End session in DB
  try {
    await db.endSession(plate, {
      feeAmount: fee,
      feeCurrency,
    })
  } catch (err) {
    console.error(`[paymentWatcher] DB endSession failed for session=${sessionId}:`, err)
  }

  // Notify gate + driver via WebSocket
  try {
    notifyGate(lotId, {
      type: 'exit',
      session: { id: sessionId, plateNumber: plate, lotId },
      plate,
      fee,
      currency: feeCurrency,
      paymentMethod: 'crypto-onchain',
    })
    notifyDriver(plate, {
      type: 'session_ended',
      session: { id: sessionId, plateNumber: plate, lotId },
      fee,
      currency: feeCurrency,
      paymentMethod: 'crypto-onchain',
    })
  } catch {
    // WS notifications are best-effort
  }

  console.log(
    `[paymentWatcher] Session settled: session=${sessionId}, plate=${plate}, fee=${fee} ${feeCurrency}`,
  )
}

// ---- Helpers ----

function parseDecimalToSmallestUnit(amount: string, decimals: number): bigint {
  const [whole = '0', frac = ''] = amount.split('.')
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole + paddedFrac)
}
