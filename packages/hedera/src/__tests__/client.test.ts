import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSetOperator = vi.fn()

vi.mock('@hashgraph/sdk', () => ({
  Client: {
    forTestnet: () => ({ setOperator: mockSetOperator, _network: 'testnet' }),
    forMainnet: () => ({ setOperator: mockSetOperator, _network: 'mainnet' }),
    forPreviewnet: () => ({ setOperator: mockSetOperator, _network: 'previewnet' }),
  },
  AccountId: { fromString: (id: string) => id },
  PrivateKey: { fromStringDer: (key: string) => key },
}))

import { createHederaClient } from '../client'

describe('createHederaClient', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a testnet client and calls setOperator', () => {
    const client = createHederaClient({
      accountId: '0.0.12345',
      privateKey: '302e...',
      network: 'testnet',
    })
    expect(mockSetOperator).toHaveBeenCalledWith('0.0.12345', '302e...')
    expect((client as any)._network).toBe('testnet')
  })

  it('creates a mainnet client', () => {
    const client = createHederaClient({
      accountId: '0.0.12345',
      privateKey: '302e...',
      network: 'mainnet',
    })
    expect((client as any)._network).toBe('mainnet')
  })

  it('creates a previewnet client', () => {
    const client = createHederaClient({
      accountId: '0.0.12345',
      privateKey: '302e...',
      network: 'previewnet',
    })
    expect((client as any)._network).toBe('previewnet')
  })

  it('defaults to testnet', () => {
    const client = createHederaClient({
      accountId: '0.0.12345',
      privateKey: '302e...',
      network: 'testnet',
    })
    expect((client as any)._network).toBe('testnet')
  })
})
