import { describe, it, expect } from 'vitest'
import { normalizePlate, isValidPlate } from '../normalize'

describe('normalizePlate', () => {
  describe('IL plates', () => {
    it('normalizes 7-digit IL plate', () => {
      expect(normalizePlate('1234567', 'IL')).toBe('12-345-67')
    })

    it('normalizes 8-digit IL plate', () => {
      expect(normalizePlate('12345678', 'IL')).toBe('123-45-678')
    })

    it('strips dashes before normalizing', () => {
      expect(normalizePlate('12-345-67', 'IL')).toBe('12-345-67')
    })

    it('rejects alpha chars for IL', () => {
      expect(normalizePlate('ABC1234', 'IL')).toBeNull()
    })

    it('rejects wrong-length digits for IL', () => {
      expect(normalizePlate('123456', 'IL')).toBeNull()
      expect(normalizePlate('123456789', 'IL')).toBeNull()
    })
  })

  describe('US plates', () => {
    it('normalizes alphanumeric US plate', () => {
      expect(normalizePlate('ABC1234', 'US')).toBe('ABC1234')
    })

    it('strips dashes and spaces', () => {
      expect(normalizePlate('ABC-1234', 'US')).toBe('ABC1234')
    })

    it('rejects >7 chars', () => {
      expect(normalizePlate('ABCDEFGH', 'US')).toBeNull()
    })

    it('accepts 1-char plate', () => {
      expect(normalizePlate('A', 'US')).toBe('A')
    })
  })

  describe('EU plates', () => {
    for (const cc of ['GB', 'DE', 'FR', 'ES', 'IT', 'NL']) {
      it(`normalizes generic EU plate for ${cc}`, () => {
        expect(normalizePlate('AB12CD', cc)).toBe('AB12CD')
      })
    }

    it('rejects >8 chars for EU', () => {
      expect(normalizePlate('ABCDEFGHI', 'DE')).toBeNull()
    })
  })

  describe('no country (auto-detect)', () => {
    it('matches IL format first for 7-digit', () => {
      expect(normalizePlate('1234567')).toBe('12-345-67')
    })

    it('falls back to EU for alpha plates', () => {
      expect(normalizePlate('ABC123')).toBe('ABC123')
    })
  })

  it('returns null for empty input', () => {
    expect(normalizePlate('')).toBeNull()
    expect(normalizePlate('---')).toBeNull()
  })
})

describe('isValidPlate', () => {
  it('returns true for valid IL plate', () => {
    expect(isValidPlate('1234567', 'IL')).toBe(true)
  })

  it('returns false for invalid IL plate', () => {
    expect(isValidPlate('ABC', 'IL')).toBe(false)
  })

  it('works without country', () => {
    expect(isValidPlate('ABC123')).toBe(true)
    expect(isValidPlate('')).toBe(false)
  })
})
