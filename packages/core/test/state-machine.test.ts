import { describe, expect, it } from 'vitest'

import {
  DECISION_TRANSITIONS,
  SETTLEMENT_TRANSITIONS,
  assertDecisionTransition,
  assertSettlementTransition,
  SESSION_TRANSITIONS,
  assertSessionTransition,
  assertSessionTransitionPath,
} from '../src/state-machine'

describe('session state machine', () => {
  it('defines allowed transitions for all states', () => {
    expect(SESSION_TRANSITIONS.pending_entry).toEqual(['active', 'denied'])
    expect(SESSION_TRANSITIONS.payment_verified).toEqual(['closed'])
    expect(SESSION_TRANSITIONS.payment_required).toEqual([
      'payment_verified',
      'payment_failed',
      'approval_required',
    ])
    expect(SESSION_TRANSITIONS.closed).toEqual([])
    expect(SESSION_TRANSITIONS.denied).toEqual([])
  })

  it('allows valid transition', () => {
    expect(() => assertSessionTransition('active', 'payment_required')).not.toThrow()
  })

  it('rejects invalid transition', () => {
    expect(() => assertSessionTransition('closed', 'active')).toThrow(
      'Invalid session transition: closed -> active',
    )
  })

  it('rejects direct active to closed transition', () => {
    expect(() => assertSessionTransition('active', 'closed')).toThrow(
      'Invalid session transition: active -> closed',
    )
  })

  it('allows settlement completion path via intermediate states', () => {
    expect(() =>
      assertSessionTransitionPath(['active', 'payment_required', 'payment_verified', 'closed']),
    ).not.toThrow()
  })
})

describe('decision state machine', () => {
  it('defines expected decision transitions', () => {
    expect(DECISION_TRANSITIONS.created).toEqual(['approved', 'consumed', 'expired', 'rejected'])
    expect(DECISION_TRANSITIONS.approved).toEqual(['consumed', 'expired'])
    expect(DECISION_TRANSITIONS.consumed).toEqual([])
    expect(DECISION_TRANSITIONS.expired).toEqual([])
    expect(DECISION_TRANSITIONS.rejected).toEqual([])
  })

  it('allows valid decision transition', () => {
    expect(() => assertDecisionTransition('created', 'consumed')).not.toThrow()
  })

  it('rejects reuse transition from consumed', () => {
    expect(() => assertDecisionTransition('consumed', 'consumed')).toThrow(
      'Invalid decision transition: consumed -> consumed',
    )
  })
})

describe('settlement state machine', () => {
  it('defines expected settlement transitions', () => {
    expect(SETTLEMENT_TRANSITIONS.pending).toEqual(['verified', 'rejected'])
    expect(SETTLEMENT_TRANSITIONS.verified).toEqual([])
    expect(SETTLEMENT_TRANSITIONS.rejected).toEqual([])
  })

  it('allows pending to verified/rejected', () => {
    expect(() => assertSettlementTransition('pending', 'verified')).not.toThrow()
    expect(() => assertSettlementTransition('pending', 'rejected')).not.toThrow()
  })

  it('rejects terminal settlement transitions', () => {
    expect(() => assertSettlementTransition('verified', 'rejected')).toThrow(
      'Invalid settlement transition: verified -> rejected',
    )
  })
})
