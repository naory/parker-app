import { describe, it, expect, vi } from 'vitest'
import { getSessionTimeline } from '../../src/events/getSessionTimeline'

describe('getSessionTimeline', () => {
  it('returns events ordered by created_at then id', async () => {
    const rows = [
      { id: '1', event_type: 'SESSION.CREATED', created_at: '2026-03-08T10:00:00Z', metadata: {} },
      { id: '2', event_type: 'SESSION.CLOSED', created_at: '2026-03-08T10:05:00Z', metadata: {} },
    ]
    const db = { query: vi.fn().mockResolvedValue({ rows }) } as any

    const result = await getSessionTimeline(db, '11111111-1111-4111-8111-111111111111')

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at ASC, id ASC'),
      ['11111111-1111-4111-8111-111111111111'],
    )
    expect(result).toEqual(rows)
  })
})
