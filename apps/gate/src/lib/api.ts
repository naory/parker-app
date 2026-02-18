import type { SessionRecord, LotStatus } from '@parker/core'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/** Fetch helper */
async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = 'GET', body } = options

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `API error: ${res.status}`)
  }

  return res.json()
}

// ---- Lot API ----

export async function getLotStatus(lotId: string): Promise<LotStatus> {
  return apiFetch<LotStatus>(`/api/gate/lot/${encodeURIComponent(lotId)}/status`)
}

// ---- Session API ----

export async function getActiveSessionsByLot(lotId: string): Promise<SessionRecord[]> {
  // The lot status endpoint returns count, but we need the actual sessions.
  // We'll add a query parameter to get full session list.
  // For now, use the lot status endpoint which returns the count.
  // We'll extend the API to support this.
  return apiFetch<SessionRecord[]>(`/api/gate/lot/${encodeURIComponent(lotId)}/sessions`)
}
