import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIFECYCLE_EVENT } from '@parker/core'

vi.mock('../../src/db/index', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../src/db/events', () => ({
  emitSessionEvent: vi.fn(),
}))

import { pool } from '../../src/db/index'
import { emitSessionEvent } from '../../src/db/events'
import { db } from '../../src/db/queries'

describe('db.insertPolicyEvent session correlation metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
    vi.mocked(emitSessionEvent).mockResolvedValue(undefined)
  })

  it('enriches mirrored session event metadata with correlation identifiers', async () => {
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.SETTLEMENT_VERIFIED,
      sessionId: 'sess-1',
      payload: {
        expectedPolicyHash: 'ph-123',
        settlement: {
          decisionId: 'dec-1',
          txHash: '0xabc',
          rail: 'evm',
          asset: { kind: 'native' },
          lotId: 'LOT-9',
        },
        plateNumber: '12-345-67',
      },
    })

    expect(emitSessionEvent).toHaveBeenCalledWith(
      'sess-1',
      LIFECYCLE_EVENT.SETTLEMENT_VERIFIED,
      expect.objectContaining({
        decisionId: 'dec-1',
        policyHash: 'ph-123',
        txHash: '0xabc',
        rail: 'evm',
        asset: { kind: 'native' },
        vehicleId: '12-345-67',
        lotId: 'LOT-9',
      }),
      expect.objectContaining({
        decisionId: 'dec-1',
        policyHash: 'ph-123',
        txHash: '0xabc',
        vehicleId: '12-345-67',
        lotId: 'LOT-9',
      }),
    )
  })

  it('preserves payload-provided metadata values over inferred values', async () => {
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.PAYMENT_DECISION_CREATED,
      sessionId: 'sess-1',
      decisionId: 'dec-input',
      txHash: '0xinput',
      payload: {
        decisionId: 'dec-payload',
        txHash: '0xpayload',
        rail: 'stripe',
        asset: { symbol: 'USD' },
        vehicleId: 'veh-payload',
        lotId: 'LOT-payload',
        policyHash: 'ph-payload',
        settlement: {
          decisionId: 'dec-inferred',
          txHash: '0xinferred',
          rail: 'evm',
          lotId: 'LOT-inferred',
        },
      },
    })

    expect(emitSessionEvent).toHaveBeenCalledWith(
      'sess-1',
      LIFECYCLE_EVENT.PAYMENT_DECISION_CREATED,
      expect.objectContaining({
        decisionId: 'dec-payload',
        txHash: '0xpayload',
        rail: 'stripe',
        asset: { symbol: 'USD' },
        vehicleId: 'veh-payload',
        lotId: 'LOT-payload',
        policyHash: 'ph-payload',
      }),
      expect.objectContaining({
        decisionId: 'dec-input',
        txHash: '0xinput',
      }),
    )
  })
})
