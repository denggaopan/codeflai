import { describe, expect, it } from 'vitest'

import {
  CHIME_GRACE_MS,
  DEFAULT_ROCKET,
  HOUR_MS,
  MAX_CHIME_ROCKETS,
  chimeLaunchOrigins,
  msFromNearestHour,
  msUntilNextHour,
  nearestHourStart,
  parseStoredRocket,
  rocketsAtHour
} from './rocket-chime'

/** A local wall-clock moment, which is the only clock this module reads. */
const at = (hours: number, minutes = 0, seconds = 0, ms = 0): Date =>
  new Date(2026, 8, 22, hours, minutes, seconds, ms)

const VIEWPORT = { width: 1440, height: 900 }

describe('rocketsAtHour', () => {
  it('drops one rocket per hour on the dial', () => {
    expect(rocketsAtHour(at(9))).toBe(9)
    expect(rocketsAtHour(at(17))).toBe(5)
    expect(rocketsAtHour(at(13))).toBe(1)
  })

  // Noon and midnight are twelve o'clock, not zero o'clock: an hour that dropped nothing
  // would read as the feature being broken rather than as the clock striking.
  it('reads noon and midnight as twelve', () => {
    expect(rocketsAtHour(at(12))).toBe(12)
    expect(rocketsAtHour(at(0))).toBe(12)
    expect(MAX_CHIME_ROCKETS).toBe(12)
  })
})

describe('msUntilNextHour', () => {
  it('measures the local clock rather than the epoch', () => {
    expect(msUntilNextHour(at(9, 30))).toBe(30 * 60_000)
    expect(msUntilNextHour(at(9, 59, 59, 500))).toBe(500)
  })

  // A zero here would let the chained timer fire again immediately and spin.
  it('hands back a whole hour exactly on the hour', () => {
    expect(msUntilNextHour(at(9))).toBe(HOUR_MS)
  })
})

describe('nearestHourStart', () => {
  it('rounds a tick to the hour it belongs to', () => {
    expect(nearestHourStart(at(9, 0, 0, 1)).getHours()).toBe(9)
    expect(nearestHourStart(at(9, 20)).getHours()).toBe(9)
  })

  // A timer allowed to fire a millisecond early lands in the previous hour's last
  // millisecond; that tick is still this hour's chime, and still nine rockets at 09:00.
  it('reads a tick that fired a hair early as the hour it was waiting for', () => {
    const early = at(8, 59, 59, 999)
    expect(nearestHourStart(early).getHours()).toBe(9)
    expect(rocketsAtHour(nearestHourStart(early))).toBe(9)
    expect(msFromNearestHour(early)).toBe(1)
  })

  it('measures how far a late tick missed its hour by', () => {
    expect(msFromNearestHour(at(9, 2))).toBe(2 * 60_000)
    // The far side of the half-hour belongs to the next hour, so the distance shrinks again.
    expect(msFromNearestHour(at(9, 50))).toBe(10 * 60_000)
    expect(msFromNearestHour(at(9, 20))).toBeGreaterThan(CHIME_GRACE_MS)
  })
})

describe('chimeLaunchOrigins', () => {
  it('spreads a chime evenly across the top of the window', () => {
    const origins = chimeLaunchOrigins({ count: 4, viewport: VIEWPORT, y: 36 })

    expect(origins).toHaveLength(4)
    expect(origins.every((origin) => origin.y === 36)).toBe(true)
    const gaps = origins.slice(1).map((origin, index) => origin.x - origins[index].x)
    expect(new Set(gaps.map((gap) => gap.toFixed(6))).size).toBe(1)
    // Half a share of clearance at each end, so the fan is symmetric about the centre.
    expect(origins[0].x - 32).toBeCloseTo(VIEWPORT.width - 32 - origins[3].x, 6)
  })

  it('keeps every rocket inside the window, twelve of them included', () => {
    const origins = chimeLaunchOrigins({ count: MAX_CHIME_ROCKETS, viewport: VIEWPORT, y: 36 })

    expect(origins).toHaveLength(MAX_CHIME_ROCKETS)
    expect(origins.every((origin) => origin.x > 0 && origin.x < VIEWPORT.width)).toBe(true)
  })

  it('centres a single rocket', () => {
    expect(chimeLaunchOrigins({ count: 1, viewport: VIEWPORT, y: 36 })[0].x).toBeCloseTo(VIEWPORT.width / 2, 6)
  })

  it('survives a window narrower than its own margins', () => {
    const origins = chimeLaunchOrigins({ count: 3, viewport: { width: 40, height: 400 }, y: 36 })

    expect(origins).toHaveLength(3)
    expect(origins.every((origin) => origin.x === 32)).toBe(true)
  })

  it('has nothing to launch for an empty chime', () => {
    expect(chimeLaunchOrigins({ count: 0, viewport: VIEWPORT, y: 36 })).toEqual([])
  })
})

describe('parseStoredRocket', () => {
  it('gives a first launch the whole easter egg', () => {
    expect(parseStoredRocket(null)).toEqual(DEFAULT_ROCKET)
    expect(DEFAULT_ROCKET).toEqual({ enabled: true, hourlyEnabled: true })
  })

  it('reads back both switches', () => {
    expect(parseStoredRocket('{"enabled":false,"hourlyEnabled":false}')).toEqual({
      enabled: false,
      hourlyEnabled: false
    })
    // The hourly switch keeps its own value while the easter egg is off, so switching the
    // egg back on restores the configuration rather than a default.
    expect(parseStoredRocket('{"enabled":false,"hourlyEnabled":true}')).toEqual({
      enabled: false,
      hourlyEnabled: true
    })
  })

  // A build that predates the switches wrote nothing, and that reads as the behaviour it
  // had: the easter egg on.
  it('falls back to on for anything it cannot read', () => {
    expect(parseStoredRocket('not json')).toEqual(DEFAULT_ROCKET)
    expect(parseStoredRocket('null')).toEqual(DEFAULT_ROCKET)
    expect(parseStoredRocket('7')).toEqual(DEFAULT_ROCKET)
    expect(parseStoredRocket('{}')).toEqual(DEFAULT_ROCKET)
    expect(parseStoredRocket('{"enabled":"no"}')).toEqual(DEFAULT_ROCKET)
  })
})
