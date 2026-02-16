import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { logger } from '../services/observability'

function extractLotId(req: Request): string | undefined {
  const fromBody = (req.body as any)?.lotId
  const fromParams = req.params?.lotId
  return fromBody || fromParams || undefined
}

function extractSessionId(req: Request): string | undefined {
  return (req.body as any)?.sessionId || req.params?.id || undefined
}

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.header('X-Request-Id') || randomUUID()
  const startedAt = Date.now()
  const lotId = extractLotId(req)
  const sessionId = extractSessionId(req)

  ;(res.locals as any).requestId = requestId
  res.setHeader('X-Request-Id', requestId)

  logger.info('request_started', {
    request_id: requestId,
    method: req.method,
    path: req.path,
    lot_id: lotId,
    session_id: sessionId,
  })

  res.on('finish', () => {
    logger.info('request_finished', {
      request_id: requestId,
      method: req.method,
      path: req.path,
      status_code: res.statusCode,
      duration_ms: Date.now() - startedAt,
      lot_id: lotId,
      session_id: sessionId,
    })
  })

  next()
}
