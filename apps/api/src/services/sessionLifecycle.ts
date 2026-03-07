import type { SessionRecord } from '@parker/core'
import { LIFECYCLE_EVENT } from '@parker/core'

import { db } from '../db'
import { assertSessionStateTransition } from '../domain/sessionState'

interface ActivateSessionInput {
  plateNumber: string
  lotId: string
  tokenId?: number
}

interface LifecycleTransitionInput {
  reason: string
  decisionId?: string
  txHash?: string
  metadata?: Record<string, unknown>
  feeAmount?: number
  feeCurrency?: string
  stripePaymentId?: string
}

type SessionLifecycleErrorCode =
  | 'INVALID_TRANSITION'
  | 'MISSING_POLICY_GRANT'
  | 'MISSING_DECISION'
  | 'MISSING_SETTLEMENT_PROOF'

export class SessionLifecycleError extends Error {
  code: SessionLifecycleErrorCode

  constructor(code: SessionLifecycleErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Single session state machine engine:
 * validates transition intent, delegates guarded persistence to DB transition
 * methods, and ensures lifecycle events are emitted consistently.
 */
export class SessionLifecycleService {
  private assertCanTransition(session: SessionRecord, to: SessionRecord['status']) {
    if (!session.status) {
      throw new SessionLifecycleError('INVALID_TRANSITION', 'Missing session status')
    }
    try {
      assertSessionStateTransition(session.status, to)
    } catch (err) {
      throw new SessionLifecycleError(
        'INVALID_TRANSITION',
        (err as Error).message || `Invalid session transition: ${session.status} -> ${to}`,
      )
    }
  }

  async activateSession(input: ActivateSessionInput): Promise<SessionRecord> {
    const session = await db.createSession(input)
    await db.insertPolicyEvent({
      eventType: LIFECYCLE_EVENT.SESSION_CREATED,
      payload: {
        plateNumber: input.plateNumber,
        lotId: input.lotId,
        tokenId: input.tokenId ?? null,
      },
      sessionId: session.id,
    })
    return session
  }

  async requirePayment(
    session: SessionRecord,
    input: LifecycleTransitionInput,
  ): Promise<SessionRecord | null> {
    if (session.status === 'payment_required') return session
    this.assertCanTransition(session, 'payment_required')
    if (!session.policyGrantId) {
      throw new SessionLifecycleError(
        'MISSING_POLICY_GRANT',
        'Cannot require payment without policy grant',
      )
    }
    return db.transitionSession(session, {
      to: 'payment_required',
      reason: input.reason,
      decisionId: input.decisionId,
      txHash: input.txHash,
      metadata: {
        ...(input.metadata ?? {}),
        entryPolicyPassed: true,
      },
    })
  }

  async requireApproval(
    session: SessionRecord,
    input: LifecycleTransitionInput,
  ): Promise<SessionRecord | null> {
    if (session.status === 'approval_required') return session
    this.assertCanTransition(session, 'approval_required')
    return db.transitionSession(session, {
      to: 'approval_required',
      reason: input.reason,
      decisionId: input.decisionId,
      txHash: input.txHash,
      metadata: input.metadata,
    })
  }

  async markPaymentVerified(
    session: SessionRecord,
    input: LifecycleTransitionInput,
  ): Promise<SessionRecord | null> {
    if (session.status === 'payment_verified') return session
    this.assertCanTransition(session, 'payment_verified')
    if (!input.decisionId) {
      throw new SessionLifecycleError(
        'MISSING_DECISION',
        'Cannot mark payment verified without decisionId',
      )
    }
    if (input.metadata?.settlementProofVerified !== true) {
      throw new SessionLifecycleError(
        'MISSING_SETTLEMENT_PROOF',
        'Cannot mark payment verified without settlement proof',
      )
    }
    return db.transitionSession(session, {
      to: 'payment_verified',
      reason: input.reason,
      decisionId: input.decisionId,
      txHash: input.txHash,
      metadata: {
        ...(input.metadata ?? {}),
        decisionValidated: true,
        decisionNotExpired: true,
        settlementProofVerified: true,
        enforcementPassed: true,
        txHashUnique: true,
      },
    })
  }

  async markPaymentFailed(
    session: SessionRecord,
    input: LifecycleTransitionInput,
  ): Promise<SessionRecord | null> {
    let current = session
    if (current.status === 'payment_failed') return current
    if (current.status === 'active') {
      if (!current.policyGrantId) {
        return this.requireApproval(current, {
          reason: input.reason,
          decisionId: input.decisionId,
          txHash: input.txHash,
          metadata: {
            ...(input.metadata ?? {}),
            autoTransition: true,
            fallbackState: 'approval_required',
          },
        })
      }
      const required = await this.requirePayment(current, {
        reason: input.reason,
        decisionId: input.decisionId,
        txHash: input.txHash,
        metadata: {
          ...(input.metadata ?? {}),
          autoTransition: true,
        },
      })
      if (!required) return null
      current = required
    }
    this.assertCanTransition(current, 'payment_failed')
    return db.transitionSession(current, {
      to: 'payment_failed',
      reason: input.reason,
      decisionId: input.decisionId,
      txHash: input.txHash,
      metadata: input.metadata,
    })
  }

  async closeSession(
    session: SessionRecord,
    input: LifecycleTransitionInput,
  ): Promise<SessionRecord | null> {
    if (session.status !== 'payment_verified' && session.status !== 'payment_required' && session.status !== 'active' && session.status !== 'payment_failed') {
      this.assertCanTransition(session, 'closed')
    }
    return db.settleSessionAfterVerified(session, {
      reason: input.reason,
      decisionId: input.decisionId,
      txHash: input.txHash,
      metadata: input.metadata,
      feeAmount: input.feeAmount,
      feeCurrency: input.feeCurrency,
      stripePaymentId: input.stripePaymentId,
    })
  }

  async denySession(
    session: SessionRecord,
    input: LifecycleTransitionInput,
  ): Promise<SessionRecord | null> {
    if (session.status === 'denied') return session
    this.assertCanTransition(session, 'denied')
    return db.transitionSession(session, {
      to: 'denied',
      reason: input.reason,
      decisionId: input.decisionId,
      txHash: input.txHash,
      metadata: input.metadata,
    })
  }
}

export const sessionLifecycleService = new SessionLifecycleService()
