import { describe, it, expect } from 'vitest'
import { extractPaymentIdFromTxJson } from './index.js'

function toHex(s: string): string {
  return Buffer.from(s, 'utf8').toString('hex')
}

describe('extractPaymentIdFromTxJson', () => {
  it('extracts paymentId from memo with MemoType x402:xrpl:v1', () => {
    const paymentId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const memoData = JSON.stringify({ paymentId })
    const tx = {
      Memos: [
        {
          Memo: {
            MemoType: toHex('x402:xrpl:v1'),
            MemoData: toHex(memoData),
          },
        },
      ],
    }
    expect(extractPaymentIdFromTxJson(tx as any)).toBe(paymentId)
  })

  it('returns undefined when MemoType is not x402:xrpl:v1', () => {
    const tx = {
      Memos: [
        {
          Memo: {
            MemoType: toHex('application/custom'),
            MemoData: toHex('{"paymentId":"x"}'),
          },
        },
      ],
    }
    expect(extractPaymentIdFromTxJson(tx as any)).toBeUndefined()
  })

  it('returns undefined when no memos', () => {
    expect(extractPaymentIdFromTxJson({} as any)).toBeUndefined()
    expect(extractPaymentIdFromTxJson({ Memos: [] } as any)).toBeUndefined()
  })

  it('skips malformed memo and uses first valid x402:xrpl:v1', () => {
    const paymentId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
    const tx = {
      Memos: [
        { Memo: { MemoType: toHex('x402:xrpl:v1'), MemoData: toHex('not-json') } },
        { Memo: { MemoType: toHex('x402:xrpl:v1'), MemoData: toHex(JSON.stringify({ paymentId })) } },
      ],
    }
    expect(extractPaymentIdFromTxJson(tx as any)).toBe(paymentId)
  })

  it('trims paymentId and rejects empty', () => {
    const tx = {
      Memos: [
        {
          Memo: {
            MemoType: toHex('x402:xrpl:v1'),
            MemoData: toHex(JSON.stringify({ paymentId: '  id-123  ' })),
          },
        },
      ],
    }
    expect(extractPaymentIdFromTxJson(tx as any)).toBe('id-123')
  })
})
