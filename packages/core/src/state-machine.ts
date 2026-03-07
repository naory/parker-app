import type { SessionState } from './types'
import type { DecisionState } from './types'
import type { SettlementState } from './types'

export const SESSION_TRANSITIONS: Record<SessionState, SessionState[]> = {
  pending_entry: ['active', 'denied'],
  active: ['payment_required', 'approval_required', 'denied'],
  payment_required: ['payment_verified', 'payment_failed', 'approval_required'],
  approval_required: ['payment_required', 'denied', 'closed'],
  payment_verified: ['closed'],
  payment_failed: ['payment_required', 'closed'],
  closed: [],
  denied: [],
}

export function assertSessionTransition(from: SessionState, to: SessionState): void {
  const allowed = SESSION_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new Error(`Invalid session transition: ${from} -> ${to}`)
  }
}

export function assertSessionTransitionPath(states: SessionState[]): void {
  if (states.length < 2) {
    throw new Error('Invalid session transition path: expected at least 2 states')
  }
  for (let i = 0; i < states.length - 1; i += 1) {
    assertSessionTransition(states[i], states[i + 1])
  }
}

export const DECISION_TRANSITIONS: Record<DecisionState, DecisionState[]> = {
  created: ['approved', 'consumed', 'expired', 'rejected'],
  approved: ['consumed', 'expired'],
  consumed: [],
  expired: [],
  rejected: [],
}

export function assertDecisionTransition(from: DecisionState, to: DecisionState): void {
  const allowed = DECISION_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new Error(`Invalid decision transition: ${from} -> ${to}`)
  }
}

export const SETTLEMENT_TRANSITIONS: Record<SettlementState, SettlementState[]> = {
  pending: ['verified', 'rejected'],
  verified: [],
  rejected: [],
}

export function assertSettlementTransition(from: SettlementState, to: SettlementState): void {
  const allowed = SETTLEMENT_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new Error(`Invalid settlement transition: ${from} -> ${to}`)
  }
}
