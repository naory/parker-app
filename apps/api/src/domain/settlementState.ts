import type { SettlementState } from '@parker/core'
import { SETTLEMENT_TRANSITIONS, assertSettlementTransition } from '@parker/core'

export type { SettlementState }
export { SETTLEMENT_TRANSITIONS }

export function assertSettlementStateTransition(from: SettlementState, to: SettlementState): void {
  assertSettlementTransition(from, to)
}
