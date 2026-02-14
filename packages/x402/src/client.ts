/**
 * Client-side x402 payment helper for the driver app.
 *
 * Handles 402 responses from the API by:
 * 1. Parsing x402 payment details from the response body
 * 2. Initiating a wallet payment transaction
 * 3. Resending the original request with the payment proof
 */

export interface X402PaymentDetails {
  version: string
  network: string
  token: string
  amount: string
  maxAmount?: string
  receiver: string
  description: string
  metadata: {
    plateNumber: string
    sessionId: string
  }
}

export interface PaymentClient {
  /** Handle a 402 response — returns the successful response after payment, or null if payment failed */
  handlePaymentRequired: (
    response: Response,
    originalRequest: { url: string; method: string; headers: Record<string, string>; body?: string },
  ) => Promise<Response | null>
}

export interface PaymentClientOptions {
  /**
   * Sign and send a stablecoin transfer transaction.
   * Should return the transaction hash.
   */
  sendPayment?: (params: {
    to: string
    amount: string
    token: string
    network: string
  }) => Promise<string>
}

export function createPaymentClient(options: PaymentClientOptions = {}): PaymentClient {
  return {
    async handlePaymentRequired(
      response: Response,
      originalRequest: { url: string; method: string; headers: Record<string, string>; body?: string },
    ): Promise<Response | null> {
      if (response.status !== 402) {
        return null
      }

      const body = (await response.json()) as { x402?: X402PaymentDetails }
      const paymentDetails = body.x402

      if (!paymentDetails) {
        console.error('[x402] 402 response missing x402 payment details')
        return null
      }

      console.log(
        `[x402] Payment required: ${paymentDetails.amount} ${paymentDetails.token} to ${paymentDetails.receiver}`,
      )

      if (!options.sendPayment) {
        console.error('[x402] No sendPayment function provided')
        return null
      }

      try {
        // Send the payment transaction
        const txHash = await options.sendPayment({
          to: paymentDetails.receiver,
          amount: paymentDetails.amount,
          token: paymentDetails.token,
          network: paymentDetails.network,
        })

        console.log(`[x402] Payment sent: ${txHash}`)

        // Resend the original request with the payment proof
        const retryResponse = await fetch(originalRequest.url, {
          method: originalRequest.method,
          headers: {
            ...originalRequest.headers,
            'X-PAYMENT': txHash,
          },
          body: originalRequest.body,
        })

        return retryResponse
      } catch (err) {
        console.error('[x402] Payment failed:', err)
        return null
      }
    },
  }
}
