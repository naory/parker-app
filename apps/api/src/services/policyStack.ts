/**
 * Build PolicyStack for entry (platform from env/config; operator/vehicle/lot from DB when available).
 * Precedence: platform < owner < vehicle < lot (merge.ts).
 */

import type { Policy, PolicyStack } from '@parker/policy-core'
import { POLICY_SCHEMA_VERSION } from '@parker/policy-core'

/** Default platform policy: no restrictions (allow all). */
function defaultPlatformPolicy(): Policy {
  return {
    version: POLICY_SCHEMA_VERSION,
  }
}

/** Parse optional PLATFORM_POLICY_JSON env (JSON string). Must be a valid Policy. */
function getPlatformPolicyFromEnv(): Policy | null {
  const raw = process.env.PLATFORM_POLICY_JSON
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && 'version' in parsed && (parsed as Policy).version === 1) {
      return parsed as Policy
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Platform policy: PLATFORM_POLICY_JSON env (if valid) else default (no restrictions).
 */
export function getPlatformPolicy(): Policy {
  return getPlatformPolicyFromEnv() ?? defaultPlatformPolicy()
}

/**
 * Build stack for entry. Today: platform only.
 * TODO: merge in from DB when available:
 *   - lot policy overrides (e.g. lot-specific caps / rail allowlist)
 *   - vehicle/owner policy overrides (e.g. by plate or wallet)
 */
export function buildEntryPolicyStack(_lotId: string, _plateNumber?: string): PolicyStack {
  return {
    platform: getPlatformPolicy(),
    owner: undefined,
    vehicle: undefined,
    lot: undefined,
  }
}
