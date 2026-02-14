import type { SessionRecord, DriverRecord, LotStatus } from '@parker/core'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/** Fetch helper with auth token or wallet address header */
async function apiFetch<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    wallet?: string
    token?: string | null
  } = {},
): Promise<T> {
  const { method = 'GET', body, wallet, token } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Prefer JWT auth, fall back to wallet header
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  } else if (wallet) {
    headers['x-wallet-address'] = wallet
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `API error: ${res.status}`)
  }

  return res.json()
}

// ---- Driver API ----

export async function getDriverByPlate(plate: string): Promise<DriverRecord> {
  return apiFetch<DriverRecord>(`/api/drivers/${encodeURIComponent(plate)}`)
}

export async function getDriverByWallet(wallet: string): Promise<DriverRecord | null> {
  // The API doesn't have a get-by-wallet endpoint, so we'll use sessions API
  // For now, we store the plate locally after registration
  return null
}

export async function updateDriver(
  plate: string,
  updates: { carMake?: string; carModel?: string },
): Promise<DriverRecord> {
  return apiFetch<DriverRecord>(`/api/drivers/${encodeURIComponent(plate)}`, {
    method: 'PUT',
    body: updates,
  })
}

// ---- Lot API ----

export async function getLotStatus(lotId: string): Promise<LotStatus | null> {
  try {
    return await apiFetch<LotStatus>(`/api/gate/lot/${encodeURIComponent(lotId)}/status`)
  } catch {
    return null
  }
}

// ---- Session API ----

export async function getActiveSession(plate: string): Promise<SessionRecord | null> {
  try {
    return await apiFetch<SessionRecord>(`/api/sessions/active/${encodeURIComponent(plate)}`)
  } catch {
    return null // 404 = no active session
  }
}

export async function getSessionHistory(
  plate: string,
  limit = 50,
  offset = 0,
): Promise<SessionRecord[]> {
  return apiFetch<SessionRecord[]>(
    `/api/sessions/history/${encodeURIComponent(plate)}?limit=${limit}&offset=${offset}`,
  )
}

export { apiFetch }
