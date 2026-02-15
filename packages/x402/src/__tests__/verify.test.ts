import { describe, it, expect, vi } from 'vitest'
import { verifyERC20Transfer } from '../verify'

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function mockClient(receipt: any) {
  return {
    getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
  } as any
}

function makeTransferLog(from: string, to: string, amount: bigint, tokenAddress = '0xtoken') {
  // Encode Transfer(address,address,uint256) log
  const padAddress = (addr: string) => '0x' + addr.replace('0x', '').toLowerCase().padStart(64, '0')
  return {
    address: tokenAddress,
    topics: [
      TRANSFER_TOPIC,
      padAddress(from),
      padAddress(to),
    ],
    data: '0x' + amount.toString(16).padStart(64, '0'),
  }
}

describe('verifyERC20Transfer', () => {
  it('decodes a successful ERC20 Transfer event', async () => {
    const from = '0x1111111111111111111111111111111111111111'
    const to = '0x2222222222222222222222222222222222222222'
    const amount = 10_000000n // 10 USDC

    const receipt = {
      status: 'success',
      logs: [makeTransferLog(from, to, amount)],
    }

    const result = await verifyERC20Transfer(mockClient(receipt), '0x' + 'ab'.repeat(32) as `0x${string}`)
    expect(result.from.toLowerCase()).toBe(from.toLowerCase())
    expect(result.to.toLowerCase()).toBe(to.toLowerCase())
    expect(result.amount).toBe(amount)
    expect(result.confirmed).toBe(true)
  })

  it('throws on reverted transaction', async () => {
    const receipt = { status: 'reverted', logs: [] }
    await expect(
      verifyERC20Transfer(mockClient(receipt), '0x' + 'ab'.repeat(32) as `0x${string}`),
    ).rejects.toThrow('Transaction reverted')
  })

  it('throws when no Transfer event found', async () => {
    const receipt = { status: 'success', logs: [] }
    await expect(
      verifyERC20Transfer(mockClient(receipt), '0x' + 'ab'.repeat(32) as `0x${string}`),
    ).rejects.toThrow('No ERC20 Transfer event found')
  })

  it('filters by expectedToken when provided', async () => {
    const from = '0x1111111111111111111111111111111111111111'
    const to = '0x2222222222222222222222222222222222222222'

    const receipt = {
      status: 'success',
      logs: [
        makeTransferLog(from, to, 5_000000n, '0xOtherToken'),
        makeTransferLog(from, to, 10_000000n, '0xUSDC'),
      ],
    }

    const result = await verifyERC20Transfer(
      mockClient(receipt),
      '0x' + 'ab'.repeat(32) as `0x${string}`,
      '0xUSDC',
    )
    expect(result.amount).toBe(10_000000n)
  })

  it('throws when expectedToken has no matching Transfer', async () => {
    const receipt = {
      status: 'success',
      logs: [
        makeTransferLog(
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
          5_000000n,
          '0xOtherToken',
        ),
      ],
    }

    await expect(
      verifyERC20Transfer(
        mockClient(receipt),
        '0x' + 'ab'.repeat(32) as `0x${string}`,
        '0xUSDC',
      ),
    ).rejects.toThrow('No ERC20 Transfer event found')
  })
})
