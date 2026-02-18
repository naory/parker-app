import { X402_STABLECOIN, X402_NETWORK } from './pricing'
import type { PendingPayment } from './paymentWatcher'

interface XamanCreateResponse {
  payloadUuid: string
  deepLink?: string
  qrPng?: string
}

interface XamanPayloadStatus {
  resolved: boolean
  rejected: boolean
  txHash?: string
}

const DEFAULT_XAMAN_API_URL = 'https://xumm.app'

function getXamanConfig() {
  const apiUrl = process.env.XAMAN_API_URL || DEFAULT_XAMAN_API_URL
  const apiKey = process.env.XAMAN_API_KEY
  const apiSecret = process.env.XAMAN_API_SECRET
  return { apiUrl, apiKey, apiSecret }
}

function toHex(text: string): string {
  return Buffer.from(text, 'utf8').toString('hex').toUpperCase()
}

function decimalToDrops(value: string): string {
  const [wholeRaw, fracRaw = ''] = value.split('.')
  const whole = wholeRaw || '0'
  const fraction = (fracRaw + '000000').slice(0, 6)
  const normalized = `${whole}${fraction}`.replace(/^0+/, '') || '0'
  return normalized
}

function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) return value
  return value.replace(/\.?0+$/, '')
}

export function isXamanConfigured(): boolean {
  const { apiKey, apiSecret } = getXamanConfig()
  return Boolean(apiKey && apiSecret)
}

export async function createXamanPayloadForPendingPayment(
  pending: PendingPayment,
): Promise<XamanCreateResponse> {
  const { apiUrl, apiKey, apiSecret } = getXamanConfig()
  if (!apiKey || !apiSecret) {
    throw new Error('Xaman is not configured')
  }

  const token = X402_STABLECOIN
  const isXrp = token.toUpperCase() === 'XRP'
  const issuer = process.env.XRPL_ISSUER
  if (!isXrp && !issuer) {
    throw new Error('XRPL_ISSUER is required for non-XRP XRPL assets')
  }

  const memoData = {
    v: 1,
    paymentId: `${pending.sessionId}:${Date.now()}`,
    plate: pending.plate,
    lotId: pending.lotId,
    network: X402_NETWORK,
    amount: pending.expectedAmount,
    token,
  }

  const amount = isXrp
    ? decimalToDrops(pending.expectedAmount)
    : {
        currency: token.toUpperCase(),
        issuer: issuer!,
        value: trimTrailingZeros(pending.expectedAmount),
      }

  const body = {
    txjson: {
      TransactionType: 'Payment',
      Destination: pending.receiverWallet,
      Amount: amount,
      Memos: [
        {
          Memo: {
            MemoType: toHex('x402:xrpl:v1'),
            MemoData: toHex(JSON.stringify(memoData)),
          },
        },
      ],
    },
    options: {
      submit: true,
    },
    custom_meta: {
      instruction: `Pay ${pending.expectedAmount} ${token} for parking session ${pending.sessionId}`,
    },
  }

  const res = await fetch(`${apiUrl}/api/v1/platform/payload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-API-Secret': apiSecret,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`Xaman payload creation failed (${res.status})`)
  }

  const json = await res.json() as {
    uuid?: string
    next?: { always?: string }
    refs?: { qr_png?: string }
  }

  if (!json.uuid) {
    throw new Error('Xaman payload response missing uuid')
  }

  return {
    payloadUuid: json.uuid,
    deepLink: json.next?.always,
    qrPng: json.refs?.qr_png,
  }
}

export async function getXamanPayloadStatus(payloadUuid: string): Promise<XamanPayloadStatus> {
  const { apiUrl, apiKey, apiSecret } = getXamanConfig()
  if (!apiKey || !apiSecret) {
    throw new Error('Xaman is not configured')
  }

  const res = await fetch(`${apiUrl}/api/v1/platform/payload/${payloadUuid}`, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
      'X-API-Secret': apiSecret,
    },
  })

  if (!res.ok) {
    throw new Error(`Xaman payload status fetch failed (${res.status})`)
  }

  const json = await res.json() as {
    meta?: { resolved?: boolean; signed?: boolean }
    response?: { txid?: string }
  }

  const resolved = Boolean(json.meta?.resolved)
  const signed = Boolean(json.meta?.signed)
  const txHash = json.response?.txid
  return {
    resolved,
    rejected: resolved && !signed,
    ...(signed && txHash ? { txHash } : {}),
  }
}
