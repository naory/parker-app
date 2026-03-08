import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { emitSessionEvent } from '../../src/events/emitSessionEvent'
import { SESSION_EVENTS } from '../../src/events/types'

describe('emitSessionEvent', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts the expected session_events row', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) } as any
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')

    await emitSessionEvent(db, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      eventType: SESSION_EVENTS.SESSION_CREATED,
      metadata: { lotId: 'lot-1', vehicleId: 'veh-1' },
    })

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO session_events (id, session_id, event_type, metadata)'),
      [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-4111-8111-111111111111',
        SESSION_EVENTS.SESSION_CREATED,
        JSON.stringify({ lotId: 'lot-1', vehicleId: 'veh-1' }),
      ],
    )
  })
})
