/**
 * Unit tests for resolveEffectivePolicy (allowlist intersection, scalar override).
 */
import { describe, it, expect } from 'vitest'
import { resolveEffectivePolicy } from '../merge.js'
import { POLICY_SCHEMA_VERSION, type Policy, type PolicyStack } from '../types.js'

const base: Policy = {
  version: POLICY_SCHEMA_VERSION,
  lotAllowlist: ['LOT-A', 'LOT-B'],
  railAllowlist: ['xrpl', 'stripe', 'evm'],
  assetAllowlist: [
    { kind: 'IOU', currency: 'USDC', issuer: 'rIssuer' },
    { kind: 'ERC20', chainId: 84532, token: '0xUSDC' },
  ],
  capPerTxMinor: '1000000',
  capPerSessionMinor: '5000000',
}

describe('resolveEffectivePolicy', () => {
  it('returns platform when no overrides', () => {
    const stack: PolicyStack = { platform: base }
    const out = resolveEffectivePolicy(stack)
    expect(out.lotAllowlist).toEqual(['LOT-A', 'LOT-B'])
    expect(out.railAllowlist).toEqual(['xrpl', 'stripe', 'evm'])
    expect(out.capPerTxMinor).toBe('1000000')
  })

  it('intersects lot allowlist when lot override provided', () => {
    const stack: PolicyStack = {
      platform: base,
      lot: { version: POLICY_SCHEMA_VERSION, lotAllowlist: ['LOT-B', 'LOT-C'] },
    }
    const out = resolveEffectivePolicy(stack)
    expect(out.lotAllowlist).toEqual(['LOT-B'])
  })

  it('intersects rail allowlist', () => {
    const stack: PolicyStack = {
      platform: base,
      lot: { version: POLICY_SCHEMA_VERSION, railAllowlist: ['stripe'] },
    }
    const out = resolveEffectivePolicy(stack)
    expect(out.railAllowlist).toEqual(['stripe'])
  })

  it('intersects asset allowlist by key', () => {
    const stack: PolicyStack = {
      platform: base,
      lot: {
        version: POLICY_SCHEMA_VERSION,
        assetAllowlist: [{ kind: 'ERC20', chainId: 84532, token: '0xUSDC' }],
      },
    }
    const out = resolveEffectivePolicy(stack)
    expect(out.assetAllowlist).toHaveLength(1)
    expect(out.assetAllowlist![0]).toMatchObject({ kind: 'ERC20', chainId: 84532, token: '0xUSDC' })
  })

  it('override scalar caps win', () => {
    const stack: PolicyStack = {
      platform: base,
      lot: {
        version: POLICY_SCHEMA_VERSION,
        capPerTxMinor: '500000',
        capPerSessionMinor: '2000000',
      },
    }
    const out = resolveEffectivePolicy(stack)
    expect(out.capPerTxMinor).toBe('500000')
    expect(out.capPerSessionMinor).toBe('2000000')
    expect(out.capPerDayMinor).toBe(base.capPerDayMinor)
  })

  it('merges platform → owner → vehicle → lot', () => {
    const stack: PolicyStack = {
      platform: { ...base, railAllowlist: ['xrpl', 'stripe', 'evm'] },
      owner: { version: POLICY_SCHEMA_VERSION, railAllowlist: ['xrpl', 'stripe'] },
      vehicle: { version: POLICY_SCHEMA_VERSION, railAllowlist: ['stripe'] },
      lot: { version: POLICY_SCHEMA_VERSION, capPerTxMinor: '100' },
    }
    const out = resolveEffectivePolicy(stack)
    expect(out.railAllowlist).toEqual(['stripe'])
    expect(out.capPerTxMinor).toBe('100')
  })
})
