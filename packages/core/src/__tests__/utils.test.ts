import { describe, it, expect } from 'vitest'
import { normalizePlate, formatPlate, hashPlate, formatFee, calculateFee } from '../utils'

describe('normalizePlate', () => {
  it('strips dashes and spaces, uppercases', () => {
    expect(normalizePlate('12-345-67')).toBe('1234567')
    expect(normalizePlate('12 345 67')).toBe('1234567')
    expect(normalizePlate('abc 1234')).toBe('ABC1234')
  })

  it('handles already-clean input', () => {
    expect(normalizePlate('ABC1234')).toBe('ABC1234')
  })
})

describe('formatPlate', () => {
  it('formats 7-digit IL plates', () => {
    expect(formatPlate('1234567', 'IL')).toBe('12-345-67')
  })

  it('formats 8-digit IL plates', () => {
    expect(formatPlate('12345678', 'IL')).toBe('123-45-678')
  })

  it('returns raw for non-matching IL', () => {
    expect(formatPlate('ABC123', 'IL')).toBe('ABC123')
  })

  it('returns normalized for unknown country', () => {
    expect(formatPlate('abc-123', 'US')).toBe('ABC123')
  })

  it('tries IL format when no country given', () => {
    expect(formatPlate('1234567')).toBe('12-345-67')
  })
})

describe('hashPlate', () => {
  it('returns a hex string', () => {
    const hash = hashPlate('1234567')
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/)
  })

  it('is deterministic', () => {
    expect(hashPlate('ABC')).toBe(hashPlate('ABC'))
  })

  it('differs for different plates', () => {
    expect(hashPlate('ABC')).not.toBe(hashPlate('DEF'))
  })
})

describe('formatFee', () => {
  it('formats whole amounts', () => {
    expect(formatFee(7_000_000n)).toBe('7')
  })

  it('formats fractional amounts', () => {
    expect(formatFee(7_430_000n)).toBe('7.43')
  })

  it('formats zero', () => {
    expect(formatFee(0n)).toBe('0')
  })

  it('preserves trailing significant digits', () => {
    expect(formatFee(100_100n)).toBe('0.1001')
  })
})

describe('calculateFee', () => {
  it('calculates basic fee', () => {
    // 130 min at 8/hr, 15-min increments: ceil(130/15)=9, 9*(8/60*15)=9*2=18
    expect(calculateFee(130, 8, 15)).toBe(18)
  })

  it('minimum 1 increment for very short stays', () => {
    // 0 minutes → 1 increment
    expect(calculateFee(0, 8, 15)).toBe(2)
  })

  it('negative duration → 1 increment', () => {
    expect(calculateFee(-5, 8, 15)).toBe(2)
  })

  it('returns 0 for zero rate', () => {
    expect(calculateFee(60, 0, 15)).toBe(0)
  })

  it('defaults billing increment to 15 if <= 0', () => {
    expect(calculateFee(60, 8, 0)).toBe(8)
  })

  it('caps at maxDailyFee', () => {
    // 24 hours at 8/hr = 192, but max = 50
    expect(calculateFee(1440, 8, 15, 50)).toBe(50)
  })

  it('does not cap if fee is below max', () => {
    expect(calculateFee(30, 8, 15, 50)).toBe(4)
  })

  it('ignores maxDailyFee if 0 or negative', () => {
    expect(calculateFee(1440, 8, 15, 0)).toBe(192)
    expect(calculateFee(1440, 8, 15, -10)).toBe(192)
  })
})
