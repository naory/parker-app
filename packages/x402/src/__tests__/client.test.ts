import { describe, it, expect, vi } from 'vitest'
import { createPaymentClient } from '../client'

describe('createPaymentClient', () => {
  it('returns null for non-402 responses', async () => {
    const client = createPaymentClient()
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 })
    const result = await client.handlePaymentRequired(response, {
      url: 'http://test',
      method: 'POST',
      headers: {},
    })
    expect(result).toBeNull()
  })

  it('returns null when 402 response lacks x402 details', async () => {
    const client = createPaymentClient()
    const response = new Response(JSON.stringify({ error: 'pay up' }), { status: 402 })
    const result = await client.handlePaymentRequired(response, {
      url: 'http://test',
      method: 'POST',
      headers: {},
    })
    expect(result).toBeNull()
  })

  it('returns null when no sendPayment function provided', async () => {
    const client = createPaymentClient()
    const response = new Response(
      JSON.stringify({
        x402: {
          version: '1',
          network: 'base-sepolia',
          token: 'USDC',
          amount: '5.00',
          receiver: '0xABC',
          description: 'Parking',
          metadata: { plateNumber: 'ABC', sessionId: 's1' },
        },
      }),
      { status: 402 },
    )
    const result = await client.handlePaymentRequired(response, {
      url: 'http://test',
      method: 'POST',
      headers: {},
    })
    expect(result).toBeNull()
  })

  it('sends payment and retries request on 402', async () => {
    const sendPayment = vi.fn().mockResolvedValue('0xtxhash')
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    const client = createPaymentClient({ sendPayment })
    const response = new Response(
      JSON.stringify({
        x402: {
          version: '1',
          network: 'base-sepolia',
          token: 'USDC',
          amount: '5.00',
          receiver: '0xABC',
          description: 'Parking',
          metadata: { plateNumber: 'ABC', sessionId: 's1' },
        },
      }),
      { status: 402 },
    )

    const result = await client.handlePaymentRequired(response, {
      url: 'http://test/exit',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    expect(sendPayment).toHaveBeenCalledWith({
      to: '0xABC',
      amount: '5.00',
      token: 'USDC',
      network: 'base-sepolia',
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test/exit',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-PAYMENT': '0xtxhash' }),
      }),
    )
    expect(result).toBeTruthy()

    vi.unstubAllGlobals()
  })

  it('returns null when sendPayment throws', async () => {
    const sendPayment = vi.fn().mockRejectedValue(new Error('wallet declined'))
    const client = createPaymentClient({ sendPayment })
    const response = new Response(
      JSON.stringify({
        x402: {
          version: '1',
          network: 'base-sepolia',
          token: 'USDC',
          amount: '5.00',
          receiver: '0xABC',
          description: 'Parking',
          metadata: { plateNumber: 'ABC', sessionId: 's1' },
        },
      }),
      { status: 402 },
    )

    const result = await client.handlePaymentRequired(response, {
      url: 'http://test',
      method: 'POST',
      headers: {},
    })
    expect(result).toBeNull()
  })
})
