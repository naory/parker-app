'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'

// ---- Types ----

/** Cached session built from WebSocket events */
export interface CachedSession {
  plate: string
  lotId: string
  entryTime: number // epoch ms
  fee?: number
  currency?: string
}

// ---- Configuration ----

/** Max age for cached sessions (24 hours). Sessions older than this are auto-pruned. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
/** Max number of cached sessions (safety cap against memory leaks). */
const MAX_CACHE_SIZE = 500

// ---- Session Cache (singleton, persists across re-renders) ----

/** In-memory map of plate → session, populated by WebSocket events */
const cache = new Map<string, CachedSession>()
let revision = 0 // bumped on every mutation to trigger React re-renders
const listeners = new Set<() => void>()

function notify() {
  revision++
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): number {
  return revision
}

/** Remove sessions older than TTL and enforce max size */
function pruneStale() {
  const now = Date.now()
  let pruned = false

  for (const [plate, session] of cache) {
    if (now - session.entryTime > SESSION_TTL_MS) {
      cache.delete(plate)
      pruned = true
    }
  }

  // If still over max size, remove oldest entries
  if (cache.size > MAX_CACHE_SIZE) {
    const sorted = Array.from(cache.entries()).sort((a, b) => a[1].entryTime - b[1].entryTime)
    const toRemove = sorted.slice(0, cache.size - MAX_CACHE_SIZE)
    for (const [plate] of toRemove) {
      cache.delete(plate)
    }
    pruned = true
  }

  if (pruned) notify()
}

// Run TTL cleanup every 5 minutes (module-level, runs once)
if (typeof window !== 'undefined') {
  setInterval(pruneStale, 5 * 60 * 1000)
}

// ---- Hook ----

/**
 * Gate-side session cache built from WebSocket events.
 *
 * Resilience Layer 3: keeps an in-memory replica of active sessions at this lot.
 * If both the DB and Mirror Node are unreachable, the gate can still:
 * - Validate that a plate has an active session
 * - Calculate an approximate fee from cached lot config
 * - Open the gate based on local knowledge
 *
 * Includes automatic TTL pruning (24h) and a max-size cap (500 sessions)
 * to prevent unbounded memory growth.
 *
 * Usage:
 *   const { sessions, addEntry, removeExit, getSession } = useSessionCache()
 *   // Feed it from the WebSocket event handler:
 *   if (event.type === 'entry') addEntry(event)
 *   if (event.type === 'exit')  removeExit(event.plate)
 */
export function useSessionCache() {
  // Subscribe to cache mutations so React re-renders when sessions change
  const rev = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const addEntry = useCallback((event: Record<string, unknown>) => {
    const plate = String(event.plate || '')
    const lotId = String(event.lotId || '')
    if (!plate) return

    const session = event.session as Record<string, unknown> | undefined
    const entryTime =
      session && typeof session.entryTime === 'string'
        ? new Date(session.entryTime).getTime()
        : Date.now()

    cache.set(plate, { plate, lotId, entryTime })
    pruneStale() // also calls notify()
    console.log(`[cache] Entry cached: ${plate} at lot ${lotId} (total: ${cache.size})`)
  }, [])

  const removeExit = useCallback((event: Record<string, unknown>) => {
    const plate = String(event.plate || '')
    if (!plate) return

    cache.delete(plate)
    notify()
    console.log(`[cache] Exit removed: ${plate} (total: ${cache.size})`)
  }, [])

  const getSession = useCallback((plate: string): CachedSession | undefined => {
    return cache.get(plate)
  }, [])

  // Memoize the sessions array so it's stable across renders (only changes on revision bump)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sessions = useMemo(() => Array.from(cache.values()), [rev])

  const sessionCount = cache.size

  return {
    /** All currently cached active sessions (stable reference per revision) */
    sessions,
    /** Number of cached active sessions */
    sessionCount,
    /** Cache an entry event */
    addEntry,
    /** Remove a session on exit */
    removeExit,
    /** Look up a single session by plate */
    getSession,
  }
}
