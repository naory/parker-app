import type { DecisionState } from '@parker/core'
import { DECISION_TRANSITIONS, assertDecisionTransition } from '@parker/core'

export type { DecisionState }
export { DECISION_TRANSITIONS }

export function assertDecisionStateTransition(from: DecisionState, to: DecisionState): void {
  assertDecisionTransition(from, to)
}
