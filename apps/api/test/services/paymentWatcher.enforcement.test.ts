import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/db', () => ({
  db: {
    settleSessionAfterVerified: vi.fn(),
    transitionSession: vi.fn(),
    hasSettlementForTxHash: vi.fn(() => Promise.resolve(false)),
    hasSettlementForDecisionRail: vi.fn(() => Promise.resolve(false)),
    consumeDecisionOnce: vi.fn(() => Promise.resolve(true)),
    getDecisionPayloadByDecisionId: vi.fn(() =>
      Promise.resolve({
        action: 'ALLOW',
        rail: 'evm',
        asset: { kind: 'ERC20', chainId: 84532, token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
        reasons: ['OK'],
        maxSpend: { perTxMinor: '10000000' },
      }),
    ),
    insertPolicyEvent: vi.fn(() => Promise.resolve()),
    getActiveSession: vi.fn(() =>
      Promise.resolve({
        id: 'sess-1',
        plateNumber: 'ABC123',
        lotId: 'LOT-1',
        entryTime: new Date(),
        status: 'payment_required',
        policyGrantId: null,
      }),
    ),
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

describe('paymentWatcher enforcement', () => {
  let onLogs: (logs: any[]) => void

  function startWatcherAndCaptureOnLogs() {
    const watchContractEvent = vi.fn()
    const mockClient = { watchContractEvent } as any
    startPaymentWatcher(mockClient, 'base-sepolia')
    onLogs = watchContractEvent.mock.calls[0][0].onLogs
  }

  beforeEach(() => {
    vi.clearAllMocks()
    removePendingPayment('sess-1')
    removePendingPayment('sess-2')
    startWatcherAndCaptureOnLogs()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enforcement blocks close on rail mismatch even after watcher amount/receiver match', async () => {
    vi.mocked(db.getDecisionPayloadByDecisionId).mockResolvedValueOnce({
      action: 'ALLOW',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'USDC', issuer: 'rIssuer' },
      reasons: ['OK'],
      maxSpend: { perTxMinor: '10000000' },
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      decisionId: 'dec-1',
      policyHash: 'ph-1',
    } as any)
    addPendingPayment(makePending())

    onLogs([makeTransferLog('0xReceiver', 1_500_000n, '0xtx-rail-mismatch')])
    await new Promise((r) => setTimeout(r, 50))

    expect(db.settleSessionAfterVerified).not.toHaveBeenCalled()
    expect(db.insertPolicyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'SETTLEMENT_REJECTED',
        payload: expect.objectContaining({ reason: 'RAIL_NOT_ALLOWED' }),
      }),
    )
  })

  it('enforcement blocks close on asset mismatch and amount mismatch', async () => {
    vi.mocked(db.getDecisionPayloadByDecisionId).mockResolvedValueOnce({
      action: 'ALLOW',
      rail: 'evm',
      asset: { kind: 'ERC20', chainId: 84532, token: '0xDifferentToken' },
      reasons: ['OK'],
      maxSpend: { perTxMinor: '10000000' },
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      decisionId: 'dec-1',
      policyHash: 'ph-1',
    } as any)
    addPendingPayment(makePending())
    onLogs([makeTransferLog('0xReceiver', 1_500_000n, '0xtx-asset-mismatch')])
    await new Promise((r) => setTimeout(r, 50))

    expect(db.settleSessionAfterVerified).not.toHaveBeenCalled()
    expect(db.insertPolicyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'SETTLEMENT_REJECTED',
        payload: expect.objectContaining({ reason: 'ASSET_NOT_ALLOWED' }),
      }),
    )

    vi.mocked(db.getDecisionPayloadByDecisionId).mockResolvedValueOnce({
      action: 'ALLOW',
      rail: 'evm',
      asset: { kind: 'ERC20', chainId: 84532, token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
      reasons: ['OK'],
      maxSpend: { perTxMinor: '1499999' },
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      decisionId: 'dec-1',
      policyHash: 'ph-1',
    } as any)
    addPendingPayment(makePending({ sessionId: 'sess-2' }))
    onLogs([makeTransferLog('0xReceiver', 1_500_000n, '0xtx-amount-mismatch')])
    await new Promise((r) => setTimeout(r, 50))

    expect(db.settleSessionAfterVerified).not.toHaveBeenCalled()
    expect(db.insertPolicyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'SETTLEMENT_REJECTED',
        payload: expect.objectContaining({ reason: 'CAP_EXCEEDED_TX' }),
      }),
    )
  })

  it('enforcement blocks close on destination mismatch via quote destination binding', async () => {
    vi.mocked(db.getDecisionPayloadByDecisionId).mockResolvedValueOnce({
      action: 'ALLOW',
      rail: 'evm',
      asset: { kind: 'ERC20', chainId: 84532, token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
      reasons: ['OK'],
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      settlementQuotes: [
        {
          quoteId: 'q1',
          rail: 'evm',
          asset: { kind: 'ERC20', chainId: 84532, token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
          amount: { amount: '1500000', decimals: 6 },
          destination: '0xAnotherReceiver',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    } as any)
    addPendingPayment(makePending())

    onLogs([makeTransferLog('0xReceiver', 1_500_000n, '0xtx-destination-mismatch')])
    await new Promise((r) => setTimeout(r, 50))

    expect(db.settleSessionAfterVerified).not.toHaveBeenCalled()
    expect(db.insertPolicyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'SETTLEMENT_REJECTED',
        payload: expect.objectContaining({ reason: 'DESTINATION_MISMATCH' }),
      }),
    )
  })
})
