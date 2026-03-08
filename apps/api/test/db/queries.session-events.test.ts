import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIFECYCLE_EVENT } from '@parker/core'

vi.mock('../../src/db/index', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../src/events/emitSessionEvent', () => ({
  emitSessionEvent: vi.fn(),
}))

import { pool } from '../../src/db/index'
import { emitSessionEvent } from '../../src/events/emitSessionEvent'
import { db } from '../../src/db/queries'
import { SESSION_EVENTS } from '../../src/events/types'

describe('db.insertPolicyEvent mirrored session timeline metadata standardization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
    vi.mocked(emitSessionEvent).mockResolvedValue(undefined)
  })

  it('standardizes settlement verified metadata', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111'
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.SETTLEMENT_VERIFIED,
      sessionId,
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
      expect.objectContaining({ query: expect.any(Function) }),
      expect.objectContaining({
        sessionId,
        eventType: SESSION_EVENTS.SETTLEMENT_VERIFIED,
        metadata: expect.objectContaining({
          decisionId: 'dec-1',
          txHash: '0xabc',
          rail: 'evm',
          asset: 'native',
        }),
      }),
    )
  })

  it('standardizes payment decision metadata to compact shape', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222'
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.PAYMENT_DECISION_CREATED,
      sessionId,
      decisionId: 'dec-input',
      txHash: '0xinput',
      payload: {
        decisionId: 'dec-payload',
        rail: 'stripe',
        policyHash: 'ph-payload',
        priceFiat: {
          amountMinor: '12345',
          currency: 'USD',
        },
      },
    })

    expect(emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      expect.objectContaining({
        sessionId,
        eventType: SESSION_EVENTS.PAYMENT_DECISION_CREATED,
        metadata: expect.objectContaining({
          decisionId: 'dec-payload',
          rail: 'stripe',
          policyHash: 'ph-payload',
          amountMinor: '12345',
          currency: 'USD',
        }),
      }),
    )
  })

  it('standardizes session created and session closed metadata', async () => {
    const sessionId = '44444444-4444-4444-8444-444444444444'
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.SESSION_CREATED,
      sessionId,
      payload: { lotId: 'LOT-1', plateNumber: '1234567' },
    })
    expect(emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      expect.objectContaining({
        sessionId,
        eventType: SESSION_EVENTS.SESSION_CREATED,
        metadata: {
          lotId: 'LOT-1',
          vehicleId: '1234567',
          plateNumber: '1234567',
        },
      }),
    )

    vi.clearAllMocks()
    vi.mocked(emitSessionEvent).mockResolvedValue(undefined)
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.SESSION_CLOSED,
      sessionId,
      decisionId: 'dec-closed',
      txHash: '0xclosed',
      payload: { metadata: { rail: 'xrpl' } },
    })
    expect(emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      expect.objectContaining({
        sessionId,
        eventType: SESSION_EVENTS.SESSION_CLOSED,
        metadata: {
          decisionId: 'dec-closed',
          txHash: '0xclosed',
          rail: 'xrpl',
        },
      }),
    )
  })

  it('does not mirror into session_events for non-uuid session ids', async () => {
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.SESSION_CREATED,
      sessionId: 'hedera-42',
      payload: { plateNumber: '1234567' },
    })

    expect(emitSessionEvent).not.toHaveBeenCalled()
  })

  it('does not mirror lifecycle events outside the minimal first set', async () => {
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.POLICY_ENFORCEMENT_PASSED,
      sessionId: '33333333-3333-4333-8333-333333333333',
      payload: { decisionId: 'dec-3' },
    })

    expect(emitSessionEvent).not.toHaveBeenCalled()
  })

  it('standardizes session budget authorization metadata including minorUnit', async () => {
    const sessionId = '66666666-6666-4666-8666-666666666666'
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.SESSION_BUDGET_AUTHORIZATION_ISSUED,
      sessionId,
      payload: {
        budgetId: 'bud-1',
        maxAmountMinor: '3000',
        currency: 'USD',
        minorUnit: 2,
        budgetScope: 'SESSION',
        allowedRails: ['xrpl', 'stripe'],
        expiresAt: '2026-03-08T18:00:00Z',
      },
    })

    expect(emitSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      expect.objectContaining({
        sessionId,
        eventType: SESSION_EVENTS.SESSION_BUDGET_AUTHORIZATION_ISSUED,
        metadata: {
          budgetId: 'bud-1',
          maxAmountMinor: '3000',
          currency: 'USD',
          minorUnit: 2,
          budgetScope: 'SESSION',
          allowedRails: ['xrpl', 'stripe'],
          expiresAt: '2026-03-08T18:00:00Z',
        },
      }),
    )
  })

  it('emits settlement verified before session closed in timeline order', async () => {
    const sessionId = '55555555-5555-4555-8555-555555555555'
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.SETTLEMENT_VERIFIED,
      sessionId,
      decisionId: 'dec-order',
      txHash: '0xorder',
      payload: { decisionId: 'dec-order', rail: 'xrpl', amount: '12345000', asset: 'RLUSD' },
    })
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.SESSION_CLOSED,
      sessionId,
      decisionId: 'dec-order',
      txHash: '0xorder',
      payload: { metadata: { rail: 'xrpl' } },
    })

    const calls = vi.mocked(emitSessionEvent).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][1]).toMatchObject({ eventType: SESSION_EVENTS.SETTLEMENT_VERIFIED })
    expect(calls[1][1]).toMatchObject({ eventType: SESSION_EVENTS.SESSION_CLOSED })
  })
})
