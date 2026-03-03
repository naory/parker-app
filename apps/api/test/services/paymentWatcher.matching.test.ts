import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies before imports (asset must match watcher settlement: base-sepolia USDC)
vi.mock('../../src/db', () => ({
  db: {
    endSession: vi.fn(),
    hasSettlementForTxHash: vi.fn(() => Promise.resolve(false)),
    hasSettlementForDecisionRail: vi.fn(() => Promise.resolve(false)),
    getDecisionPayloadByDecisionId: vi.fn(() =>
      Promise.resolve({
        action: 'ALLOW',
        decisionId: 'dec-1',
        policyHash: 'ph-1',
        expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
        rail: 'evm',
        asset: { kind: 'ERC20', chainId: 84532, token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
        reasons: ['OK'],
        maxSpend: { perTxMinor: '10000000' },
      }),
    ),
    insertPolicyEvent: vi.fn(() => Promise.resolve()),
    getActiveSession: vi.fn(() => Promise.resolve({ policyGrantId: null })),
  },
}))

vi.mock('../../src/ws/index', () => ({
  notifyGate: vi.fn(),
  notifyDriver: vi.fn(),
}))

vi.mock('../../src/services/hedera', () => ({
  isHederaEnabled: vi.fn(() => false),
  endParkingSessionOnHedera: vi.fn(),
}))

import {
  addPendingPayment,
  removePendingPayment,
  startPaymentWatcher,
  type PendingPayment,
} from '../../src/services/paymentWatcher'
import { db } from '../../src/db'
import { notifyGate, notifyDriver } from '../../src/ws/index'
import { isHederaEnabled, endParkingSessionOnHedera } from '../../src/services/hedera'

function makePending(overrides: Partial<PendingPayment> = {}): PendingPayment {
  return {
    plate: 'ABC123',
    lotId: 'LOT-1',
    sessionId: 'sess-1',
    expectedAmount: '1.500000',
    receiverWallet: '0xReceiver',
    fee: 1.5,
    feeCurrency: 'USDC',
    createdAt: Date.now(),
    decisionId: 'dec-1',
    ...overrides,
  }
}

function makeTransferLog(
  to: string,
  value: bigint,
  txHash = '0xtx1',
  overrides: Record<string, unknown> = {},
) {
  return {
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    chainId: 84532,
    args: { from: '0xSender', to, value },
    transactionHash: txHash,
    ...overrides,
  }
}

describe('paymentWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clean up any pending payments from previous tests
    removePendingPayment('sess-1')
    removePendingPayment('sess-2')
    removePendingPayment('sess-stale')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ---- addPendingPayment / removePendingPayment ----

  describe('addPendingPayment / removePendingPayment', () => {
    it('adds and then removes a pending payment', () => {
      const pending = makePending()
      // add should not throw
      expect(() => addPendingPayment(pending)).not.toThrow()
      // remove should not throw
      expect(() => removePendingPayment('sess-1')).not.toThrow()
      // removing again is a no-op
      expect(() => removePendingPayment('sess-1')).not.toThrow()
    })
  })

  // ---- startPaymentWatcher ----

  describe('startPaymentWatcher', () => {
    it('logs warning and does not throw when publicClient is null', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => startPaymentWatcher(null)).not.toThrow()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No publicClient provided'))
      warnSpy.mockRestore()
    })

    it('calls watchContractEvent with USDC address', () => {
      const watchContractEvent = vi.fn()
      const mockClient = { watchContractEvent } as any

      startPaymentWatcher(mockClient, 'base-sepolia')

      expect(watchContractEvent).toHaveBeenCalledOnce()
      expect(watchContractEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          eventName: 'Transfer',
        }),
      )
    })

    it('logs warning for unknown network', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mockClient = { watchContractEvent: vi.fn() } as any

      startPaymentWatcher(mockClient, 'unknown-network')

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No USDC address'))
      expect(mockClient.watchContractEvent).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  // ---- Transfer event handling (via onLogs callback) ----

  describe('handleTransferEvent (via onLogs)', () => {
    let onLogs: (logs: any[]) => void

    function startWatcherAndCaptureOnLogs() {
      const watchContractEvent = vi.fn()
      const mockClient = { watchContractEvent } as any
      startPaymentWatcher(mockClient, 'base-sepolia')
      onLogs = watchContractEvent.mock.calls[0][0].onLogs
    }

    beforeEach(() => {
      startWatcherAndCaptureOnLogs()
    })

    it('settles session when transfer matches pending payment', async () => {
      const pending = makePending({ receiverWallet: '0xReceiver' })
      addPendingPayment(pending)

      // 1.500000 USDC = 1_500_000 smallest units (6 decimals)
      const log = makeTransferLog('0xReceiver', 1_500_000n)
      onLogs([log])

      // Allow async settleSession to complete
      await vi.waitFor(() => {
        expect(db.endSession).toHaveBeenCalledOnce()
      })

      expect(db.endSession).toHaveBeenCalledWith('ABC123', {
        feeAmount: 1.5,
        feeCurrency: 'USDC',
      })
      expect(notifyGate).toHaveBeenCalledWith(
        'LOT-1',
        expect.objectContaining({ type: 'exit', plate: 'ABC123', paymentMethod: 'crypto-onchain' }),
      )
      expect(notifyDriver).toHaveBeenCalledWith(
        'ABC123',
        expect.objectContaining({ type: 'session_ended', paymentMethod: 'crypto-onchain' }),
      )
    })

    it('does NOT settle when token address does not match watched USDC', async () => {
      addPendingPayment(makePending())

      const log = makeTransferLog('0xReceiver', 1_500_000n, '0xtx-token', {
        address: '0x0000000000000000000000000000000000000002',
      })
      onLogs([log])

      await new Promise((r) => setTimeout(r, 50))
      expect(db.endSession).not.toHaveBeenCalled()
    })

    it('does NOT settle when chain id does not match watched network', async () => {
      addPendingPayment(makePending())

      const log = makeTransferLog('0xReceiver', 1_500_000n, '0xtx-chain', {
        chainId: 1,
      })
      onLogs([log])

      await new Promise((r) => setTimeout(r, 50))
      expect(db.endSession).not.toHaveBeenCalled()
    })

    it('settles when amount is within 1% tolerance', async () => {
      const pending = makePending({ expectedAmount: '10.000000' })
      addPendingPayment(pending)

      // Expected: 10_000_000. 1% = 100_000. Send 9_910_000 (0.9% off — within tolerance)
      const log = makeTransferLog('0xReceiver', 9_910_000n)
      onLogs([log])

      await vi.waitFor(() => {
        expect(db.endSession).toHaveBeenCalledOnce()
      })
    })

    it('settles on exact required amount (no rounding path)', async () => {
      addPendingPayment(makePending({ expectedAmount: '10.000000' }))

      const log = makeTransferLog('0xReceiver', 10_000_000n, '0xtx-exact')
      onLogs([log])

      await vi.waitFor(() => {
        expect(db.endSession).toHaveBeenCalledOnce()
      })
    })

    it('settles on exact 1% boundary and rejects above boundary', async () => {
      addPendingPayment(makePending({ expectedAmount: '10.000000', sessionId: 'sess-1' }))
      addPendingPayment(makePending({ expectedAmount: '10.000000', sessionId: 'sess-2' }))

      onLogs([makeTransferLog('0xReceiver', 9_900_000n, '0xtx-boundary-ok')]) // exactly 1% low
      await vi.waitFor(() => {
        expect(db.endSession).toHaveBeenCalledOnce()
      })

      onLogs([makeTransferLog('0xReceiver', 9_899_999n, '0xtx-boundary-fail')]) // just above 1%
      await new Promise((r) => setTimeout(r, 50))
      expect(db.endSession).toHaveBeenCalledTimes(1)
    })

    it('does NOT settle when amount is outside 1% tolerance', async () => {
      const pending = makePending({ expectedAmount: '10.000000' })
      addPendingPayment(pending)

      // Expected: 10_000_000. 1% = 100_000. Send 9_800_000 (2% off — outside tolerance)
      const log = makeTransferLog('0xReceiver', 9_800_000n)
      onLogs([log])

      // Give async a chance to run
      await new Promise((r) => setTimeout(r, 50))
      expect(db.endSession).not.toHaveBeenCalled()
    })

    it('does NOT settle when receiver does not match', async () => {
      addPendingPayment(makePending({ receiverWallet: '0xCorrectReceiver' }))

      const log = makeTransferLog('0xWrongReceiver', 1_500_000n)
      onLogs([log])

      await new Promise((r) => setTimeout(r, 50))
      expect(db.endSession).not.toHaveBeenCalled()
    })

    it('does not crash with no pending payments', () => {
      const log = makeTransferLog('0xAnyone', 1_000_000n)
      expect(() => onLogs([log])).not.toThrow()
    })

    it('matches receiver case-insensitively', async () => {
      addPendingPayment(makePending({ receiverWallet: '0xAbCdEf' }))

      const log = makeTransferLog('0xabcdef', 1_500_000n)
      onLogs([log])

      await vi.waitFor(() => {
        expect(db.endSession).toHaveBeenCalledOnce()
      })
    })

    it('replay: does NOT settle when tx_hash already has settlementVerified (replay protection)', async () => {
      vi.mocked(db.hasSettlementForTxHash).mockResolvedValueOnce(true)
      addPendingPayment(makePending())

      const log = makeTransferLog('0xReceiver', 1_500_000n, '0xtx-replay')
      onLogs([log])

      await new Promise((r) => setTimeout(r, 50))
      expect(db.endSession).not.toHaveBeenCalled()
      expect(db.insertPolicyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'riskSignal',
          payload: expect.objectContaining({ signal: 'REPLAY_SUSPICION', txHash: '0xtx-replay' }),
          txHash: '0xtx-replay',
        }),
      )
    })

    it('skips log with no args', () => {
      addPendingPayment(makePending())
      // Log without args field
      expect(() => onLogs([{ transactionHash: '0x123' }])).not.toThrow()
    })
  })

  // ---- Hedera NFT burn ----

  describe('settlement with Hedera', () => {
    let onLogs: (logs: any[]) => void

    beforeEach(() => {
      const watchContractEvent = vi.fn()
      const mockClient = { watchContractEvent } as any
      startPaymentWatcher(mockClient, 'base-sepolia')
      onLogs = watchContractEvent.mock.calls[0][0].onLogs
    })

    it('burns Hedera NFT when enabled and tokenId is set', async () => {
      vi.mocked(isHederaEnabled).mockReturnValue(true)
      vi.mocked(endParkingSessionOnHedera).mockResolvedValue(undefined as any)

      addPendingPayment(makePending({ tokenId: 42 }))

      onLogs([makeTransferLog('0xReceiver', 1_500_000n)])

      await vi.waitFor(() => {
        expect(endParkingSessionOnHedera).toHaveBeenCalledWith(42)
      })
    })

    it('skips NFT burn when Hedera is disabled', async () => {
      vi.mocked(isHederaEnabled).mockReturnValue(false)

      addPendingPayment(makePending({ tokenId: 42 }))

      onLogs([makeTransferLog('0xReceiver', 1_500_000n)])

      await vi.waitFor(() => {
        expect(db.endSession).toHaveBeenCalledOnce()
      })
      expect(endParkingSessionOnHedera).not.toHaveBeenCalled()
    })

    it('skips NFT burn when tokenId is not set', async () => {
      vi.mocked(isHederaEnabled).mockReturnValue(true)

      addPendingPayment(makePending({ tokenId: undefined }))

      onLogs([makeTransferLog('0xReceiver', 1_500_000n)])

      await vi.waitFor(() => {
        expect(db.endSession).toHaveBeenCalledOnce()
      })
      expect(endParkingSessionOnHedera).not.toHaveBeenCalled()
    })
  })

  // ---- Pruning ----

  describe('stale payment pruning', () => {
    it('removes payments older than 30 minutes', () => {
      vi.useFakeTimers()

      const watchContractEvent = vi.fn()
      const mockClient = { watchContractEvent } as any
      startPaymentWatcher(mockClient, 'base-sepolia')
      const onLogs = watchContractEvent.mock.calls[0][0].onLogs

      // Add a pending payment with a creation time 31 minutes in the past
      const stalePayment = makePending({
        sessionId: 'sess-stale',
        createdAt: Date.now() - 31 * 60_000,
      })
      addPendingPayment(stalePayment)

      // Advance past the prune interval (5 minutes)
      vi.advanceTimersByTime(5 * 60_000 + 100)

      // The stale payment should have been pruned — a matching transfer should not settle
      onLogs([makeTransferLog('0xReceiver', 1_500_000n)])

      // Since the payment was pruned, handleTransferEvent won't find a match,
      // so settleSession (and thus db.endSession) should never be called
      expect(db.endSession).not.toHaveBeenCalled()
    })
  })
})
