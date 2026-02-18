import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecute = vi.fn()

vi.mock('@hashgraph/sdk', () => {
  const SUCCESS = 'SUCCESS'

  class MockTokenMintTransaction {
    setTokenId() {
      return this
    }
    addMetadata() {
      return this
    }
    async execute() {
      return {
        getReceipt: async () => ({
          status: SUCCESS,
          serials: [{ toNumber: () => 42 }],
        }),
        transactionId: { toString: () => '0.0.123@1234567890.000' },
      }
    }
  }

  class MockTokenBurnTransaction {
    setTokenId() {
      return this
    }
    setSerials() {
      return this
    }
    async execute() {
      return {
        getReceipt: async () => ({ status: SUCCESS }),
        transactionId: { toString: () => '0.0.123@1234567891.000' },
      }
    }
  }

  return {
    TokenId: { fromString: (id: string) => id },
    TokenMintTransaction: MockTokenMintTransaction,
    TokenBurnTransaction: MockTokenBurnTransaction,
    Status: { Success: SUCCESS },
    Client: { forTestnet: () => ({}) },
  }
})

import { mintParkingNFT, burnParkingNFT, getNftInfo } from '../nft'

describe('mintParkingNFT', () => {
  it('mints and returns serial + txId', async () => {
    const client = {} as any
    const result = await mintParkingNFT(client, '0.0.999', {
      plateNumber: 'ABC123',
      lotId: 'LOT-1',
      entryTime: 1700000000,
    })
    expect(result.serial).toBe(42)
    expect(result.transactionId).toContain('0.0.123')
  })
})

describe('burnParkingNFT', () => {
  it('burns and returns txId', async () => {
    const client = {} as any
    const result = await burnParkingNFT(client, '0.0.999', 42)
    expect(result.transactionId).toContain('0.0.123')
  })
})

describe('getNftInfo', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns exists=true for valid NFT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            deleted: false,
            metadata: Buffer.from('{"plateNumber":"ABC"}').toString('base64'),
          }),
      }),
    )

    const info = await getNftInfo('0.0.999', 1, 'testnet')
    expect(info.exists).toBe(true)
    expect(info.metadata).toContain('ABC')
    vi.unstubAllGlobals()
  })

  it('returns exists=false for 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    const info = await getNftInfo('0.0.999', 999, 'testnet')
    expect(info.exists).toBe(false)
    expect(info.deleted).toBe(true)
    vi.unstubAllGlobals()
  })

  it('uses correct mirror node URL for each network', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', mockFetch)

    await getNftInfo('0.0.1', 1, 'mainnet')
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('mainnet-public'))

    await getNftInfo('0.0.1', 1, 'testnet')
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('testnet'))

    vi.unstubAllGlobals()
  })
})
