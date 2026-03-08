import { Router, type Request } from 'express'
import { normalizePlate } from '@parker/core'

import { db } from '../db'
import { logger } from '../services/observability'

export const sessionsRouter = Router()
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hasTimelineAccess(req: Request): boolean {
  const expectedApiKey = process.env.SESSION_TIMELINE_API_KEY || process.env.GATE_API_KEY
  if (!expectedApiKey) return true
  return req.header('x-gate-api-key') === expectedApiKey
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNonNegativeInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function formatMinorAmount(amountMinor: string | undefined, minorUnit: number | undefined, currency: string | undefined): string | undefined {
  if (!amountMinor || minorUnit === undefined || !currency) return undefined
  if (!/^\d+$/.test(amountMinor)) return undefined
  try {
    const minor = BigInt(amountMinor)
    const base = 10n ** BigInt(minorUnit)
    const whole = minor / base
    const fraction = (minor % base).toString().padStart(minorUnit, '0')
    const value = minorUnit === 0 ? whole.toString() : `${whole.toString()}.${fraction}`
    return `${value} ${currency}`
  } catch {
    return undefined
  }
}

function extractBudgetAuthorization(budget: unknown): Record<string, unknown> | null {
  const b = asRecord(budget)
  if (!b) return null
  const authorization = asRecord(b.authorization)
  return authorization ?? b
}

function toAssetLabel(asset: unknown): string | undefined {
  if (typeof asset === 'string') return asset
  const record = asRecord(asset)
  if (!record) return undefined
  return (
    asString(record.symbol) ??
    asString(record.currency) ??
    asString(record.code) ??
    asString(record.asset) ??
    asString(record.kind)
  )
}

function findChosenQuote(decision: Record<string, unknown>): Record<string, unknown> | null {
  const chosen = asRecord(decision.chosen)
  const quotesRaw = decision.settlementQuotes
  const quotes = Array.isArray(quotesRaw) ? quotesRaw.map(asRecord).filter(Boolean) : []
  if (!quotes.length) return null
  const chosenQuoteId = asString(chosen?.quoteId)
  const decisionRail = asString(decision.rail)
  if (chosenQuoteId) {
    return quotes.find((q) => asString(q?.quoteId) === chosenQuoteId) ?? null
  }
  if (decisionRail) {
    return quotes.find((q) => asString(q?.rail) === decisionRail) ?? null
  }
  return quotes[0] ?? null
}

function extractSettlementFacts(settlement: unknown): {
  amount?: string
  rail?: string
  asset?: unknown
  destination?: string
} {
  const root = asRecord(settlement)
  if (!root) return {}
  const payload = asRecord(root.payload)
  const nested = asRecord(payload?.settlement)
  return {
    amount: asString(payload?.amount) ?? asString(nested?.amount),
    rail: asString(payload?.rail) ?? asString(nested?.rail),
    asset: payload?.asset ?? nested?.asset,
    destination: asString(payload?.destination) ?? asString(nested?.destination),
  }
}

function evaluateInvariants(input: {
  budget: unknown
  decision: unknown
  signedAuthorization: unknown
  settlement: unknown
}) {
  const decision = asRecord(input.decision)
  const budgetAuth = extractBudgetAuthorization(input.budget)
  const signedAuthEnvelope = asRecord(input.signedAuthorization)
  const signedAuth = asRecord(signedAuthEnvelope?.authorization)
  const settlement = extractSettlementFacts(input.settlement)

  let decisionWithinBudget = true
  if (decision && budgetAuth) {
    const decisionMinor = asString(asRecord(decision.priceFiat)?.amountMinor)
    const maxMinor = asString(budgetAuth.maxAmountMinor)
    if (decisionMinor && maxMinor) {
      decisionWithinBudget = BigInt(decisionMinor) <= BigInt(maxMinor)
    }
  }

  let authorizationMatchesDecision = true
  if (decision && signedAuth) {
    const quote = findChosenQuote(decision)
    const quoteAmount = asString(asRecord(quote?.amount)?.amount)
    const quoteDestination = asString(quote?.destination)
    authorizationMatchesDecision =
      asString(signedAuth.decisionId) === asString(decision.decisionId) &&
      asString(signedAuth.policyHash) === asString(decision.policyHash) &&
      (!asString(decision.rail) || asString(signedAuth.rail) === asString(decision.rail)) &&
      (!decision.asset || canonicalJson(signedAuth.asset) === canonicalJson(decision.asset)) &&
      (!quoteAmount || asString(signedAuth.amount) === quoteAmount) &&
      (!quoteDestination || asString(signedAuth.destination) === quoteDestination)
  }

  let settlementMatchesAuthorization = true
  if (signedAuth && (settlement.amount || settlement.rail || settlement.asset || settlement.destination)) {
    settlementMatchesAuthorization =
      (!settlement.amount || asString(signedAuth.amount) === settlement.amount) &&
      (!settlement.rail || asString(signedAuth.rail) === settlement.rail) &&
      (settlement.asset == null ||
        canonicalJson(signedAuth.asset) === canonicalJson(settlement.asset)) &&
      (!settlement.destination || asString(signedAuth.destination) === settlement.destination)
  }

  let settlementMatchesPolicy = true
  if (decision && (settlement.amount || settlement.rail || settlement.asset || settlement.destination)) {
    const quote = findChosenQuote(decision)
    const quoteAmount = asString(asRecord(quote?.amount)?.amount)
    const quoteDestination = asString(quote?.destination)
    settlementMatchesPolicy =
      (!settlement.rail || asString(decision.rail) === settlement.rail) &&
      (settlement.asset == null || canonicalJson(decision.asset) === canonicalJson(settlement.asset)) &&
      (!quoteAmount || settlement.amount === quoteAmount) &&
      (!quoteDestination || settlement.destination === quoteDestination)
  }

  return {
    decisionWithinBudget,
    authorizationMatchesDecision,
    settlementMatchesAuthorization,
    settlementMatchesPolicy,
  }
}

function withDerivedBudgetAmount(budget: unknown): unknown {
  const budgetRecord = asRecord(budget)
  if (!budgetRecord) return budget

  const result: Record<string, unknown> = { ...budgetRecord }
  const authorization = asRecord(budgetRecord.authorization)
  const source = authorization ?? budgetRecord
  const display = formatMinorAmount(
    asString(source.maxAmountMinor),
    asNonNegativeInt(source.minorUnit),
    asString(source.currency),
  )

  if (!display) return budget
  if (authorization) {
    result.authorization = { ...authorization, maxAmount: display }
  } else {
    result.maxAmount = display
  }
  return result
}

function withDerivedSettlementAmount(settlement: unknown, decision: unknown, budget: unknown): unknown {
  const settlementRecord = asRecord(settlement)
  if (!settlementRecord) return settlement
  const payload = asRecord(settlementRecord.payload)
  const nested = asRecord(payload?.settlement)
  const decisionRecord = asRecord(decision)
  const budgetAuth = extractBudgetAuthorization(budget)

  const explicitAmountMinor = asString(payload?.amountMinor) ?? asString(nested?.amountMinor)
  const amountString = asString(payload?.amount) ?? asString(nested?.amount)
  const amountMinor = explicitAmountMinor ?? (amountString && /^\d+$/.test(amountString) ? amountString : undefined)
  const minorUnit =
    asNonNegativeInt(payload?.minorUnit) ??
    asNonNegativeInt(nested?.minorUnit) ??
    asNonNegativeInt(budgetAuth?.minorUnit)
  const currency =
    asString(payload?.currency) ??
    asString(nested?.currency) ??
    asString(decisionRecord?.quoteCurrency) ??
    asString(asRecord(asRecord(decisionRecord?.payload)?.priceFiat)?.currency) ??
    asString(budgetAuth?.currency)

  const minorDisplay = formatMinorAmount(amountMinor, minorUnit, currency)
  const assetDisplay =
    amountString && !minorDisplay
      ? `${amountString}${toAssetLabel(payload?.asset ?? nested?.asset) ? ` ${toAssetLabel(payload?.asset ?? nested?.asset)}` : ''}`.trim()
      : undefined
  const amountDisplay = minorDisplay ?? assetDisplay

  if (!amountDisplay) return settlement
  return {
    ...settlementRecord,
    amountDisplay,
    ...(payload ? { payload: { ...payload, amountDisplay } } : {}),
  }
}

// GET /api/sessions/active/:plate — Get active parking session
sessionsRouter.get('/active/:plate', async (req, res) => {
  try {
    const session = await db.getActiveSession(normalizePlate(req.params.plate))
    if (!session) {
      return res.status(404).json({ error: 'No active session' })
    }
    res.json(session)
  } catch (error) {
    console.error('Failed to get active session:', error)
    res.status(500).json({ error: 'Failed to get active session' })
  }
})

// GET /api/sessions/history/:plate — Get session history
sessionsRouter.get('/history/:plate', async (req, res) => {
  try {
    const rawLimit = parseInt(req.query.limit as string)
    const rawOffset = parseInt(req.query.offset as string)
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50
    const offset = !isNaN(rawOffset) && rawOffset >= 0 ? rawOffset : 0

    const sessions = await db.getSessionHistory(normalizePlate(req.params.plate), limit, offset)
    res.json(sessions)
  } catch (error) {
    console.error('Failed to get session history:', error)
    res.status(500).json({ error: 'Failed to get session history' })
  }
})

// GET /api/sessions/:sessionId/timeline — Get ordered lifecycle event timeline
sessionsRouter.get('/:sessionId/timeline', async (req, res) => {
  try {
    if (!UUID_V4_REGEX.test(req.params.sessionId)) {
      return res.status(400).json({ error: 'Invalid sessionId format' })
    }
    if (!hasTimelineAccess(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const rawLimit = parseInt(req.query.limit as string)
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 500
    const sessionId = req.params.sessionId
    const state = await db.getSessionState(sessionId)
    if (!state) {
      return res.status(404).json({ error: 'Session not found' })
    }
    const timeline = await db.getSessionTimeline(sessionId, limit)
    logger.info('timeline.fetch', { sessionId, eventCount: timeline.length })
    res.json({
      sessionId,
      state,
      eventCount: timeline.length,
      events: timeline.map((event) => ({
        eventType: event.eventType,
        createdAt: event.timestamp,
        metadata: event.metadata ?? {},
      })),
    })
  } catch (error) {
    console.error('Failed to get session timeline:', error)
    res.status(500).json({ error: 'Failed to get session timeline' })
  }
})

// GET /api/sessions/:sessionId/debug — Operator-focused session diagnostics bundle
sessionsRouter.get('/:sessionId/debug', async (req, res) => {
  try {
    if (!UUID_V4_REGEX.test(req.params.sessionId)) {
      return res.status(400).json({ error: 'Invalid sessionId format' })
    }
    if (!hasTimelineAccess(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const sessionId = req.params.sessionId
    const debugRecord = await db.getSessionDebugRecord(sessionId)
    if (!debugRecord) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const rawLimit = parseInt(req.query.limit as string)
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 500
    const timeline = await db.getSessionTimeline(sessionId, limit)
    const budget = withDerivedBudgetAmount(debugRecord.budget)
    const settlement = withDerivedSettlementAmount(
      debugRecord.settlement,
      debugRecord.decision,
      debugRecord.budget,
    )

    logger.info('session.debug.fetch', { sessionId, eventCount: timeline.length })

    return res.json({
      debugVersion: 1,
      session: debugRecord.session,
      grant: debugRecord.grant,
      budget,
      decision: debugRecord.decision,
      signedAuthorization: debugRecord.signedAuthorization,
      settlement,
      invariants: evaluateInvariants({
        budget,
        decision: debugRecord.decision,
        signedAuthorization: debugRecord.signedAuthorization,
        settlement,
      }),
      timeline: timeline.map((event) => ({
        eventType: event.eventType,
        createdAt: event.timestamp,
        metadata: event.metadata ?? {},
      })),
    })
  } catch (error) {
    console.error('Failed to get session debug bundle:', error)
    return res.status(500).json({ error: 'Failed to get session debug bundle' })
  }
})
