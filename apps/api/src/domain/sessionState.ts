import type { SessionState } from '@parker/core'
import { SESSION_TRANSITIONS, assertSessionTransition } from '@parker/core'

export type { SessionState }
export { SESSION_TRANSITIONS }

export function assertSessionStateTransition(from: SessionState, to: SessionState): void {
  assertSessionTransition(from, to)
}
