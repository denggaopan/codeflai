import { describe, expect, it } from 'vitest'

import { recordRocketClick, type RocketClickStreak } from './rocket-click-streak'

describe('recordRocketClick', () => {
  it('launches two rockets at 32 clicks and three at 48 clicks within a minute', () => {
    let streak: RocketClickStreak = { clicks: [], rocketCount: 1 }
    for (let index = 1; index <= 48; index++) {
      streak = recordRocketClick(streak, index * 500)
      expect(streak.rocketCount).toBe(index >= 48 ? 3 : index >= 32 ? 2 : 1)
    }
    expect(streak.clicks).toEqual([24_000])
  })

  it('includes a click exactly sixty seconds old', () => {
    const clicks = Array.from({ length: 31 }, (_, index) => index * 2000)
    expect(recordRocketClick({ clicks, rocketCount: 1 }, 60_000).rocketCount).toBe(2)
  })

  it('discards clicks older than sixty seconds', () => {
    const clicks = Array.from({ length: 31 }, (_, index) => index * 2000)
    const next = recordRocketClick({ clicks, rocketCount: 1 }, 60_001)
    expect(next.rocketCount).toBe(1)
    expect(next.clicks).toEqual([...clicks.slice(1), 60_001])
  })

  it('uses a rolling window and keeps recent clicks when the oldest expires', () => {
    const clicks = Array.from({ length: 31 }, (_, index) => index * 2000)
    const first = recordRocketClick({ clicks, rocketCount: 1 }, 60_001)
    expect(first.rocketCount).toBe(1)
    expect(first.clicks).toHaveLength(31)
    expect(recordRocketClick(first, 60_002).rocketCount).toBe(2)
    expect(clicks).toHaveLength(31)
  })

  it('requires 48 clicks within a rolling minute for triple launches', () => {
    const clicks = Array.from({ length: 47 }, (_, index) => index * 1300)
    expect(recordRocketClick({ clicks, rocketCount: 2 }, 60_000).rocketCount).toBe(3)
    const expired = recordRocketClick({ clicks, rocketCount: 2 }, 60_001)
    expect(expired.rocketCount).toBe(2)
    expect(recordRocketClick(expired, 60_002).rocketCount).toBe(3)
  })

  it('keeps the unlocked tier as long as clicks remain consecutive', () => {
    let streak: RocketClickStreak = { clicks: [], rocketCount: 1 }
    for (let index = 1; index <= 201; index++) {
      streak = recordRocketClick(streak, index * 400)
      expect(streak.rocketCount).toBe(index >= 48 ? 3 : index >= 32 ? 2 : 1)
      expect(streak.clicks.length).toBe(index >= 48 ? 1 : index)
    }
    expect(recordRocketClick(streak, 3_600_000)).toEqual({ clicks: [3_600_000], rocketCount: 1 })
  })

  it('preserves paired launches if the rolling count drops before reaching 48', () => {
    let streak: RocketClickStreak = { clicks: Array.from({ length: 32 }, (_, index) => index * 1800), rocketCount: 2 }
    for (let now = 58_800; now <= 145_800; now += 3000) {
      streak = recordRocketClick(streak, now)
      expect(streak.rocketCount).toBe(2)
    }
    expect(streak.clicks).toHaveLength(21)
  })

  it.each([1, 2, 3] as const)('resets after a gap over three seconds (tier: %s)', (rocketCount) => {
    const previous = { clicks: Array(31).fill(1000), rocketCount }
    expect(recordRocketClick(previous, 4001)).toEqual({ clicks: [4001], rocketCount: 1 })
    expect(previous.clicks).toHaveLength(31)
  })

  it.each([1, 2, 3] as const)('keeps a gap of exactly three seconds (tier: %s)', (rocketCount) => {
    expect(recordRocketClick({ clicks: Array(31).fill(1000), rocketCount }, 4000).rocketCount).toBe(Math.max(2, rocketCount))
  })

  it('requires new streaks to unlock both tiers after a triple launch is interrupted', () => {
    let streak = recordRocketClick({ clicks: [1000], rocketCount: 3 }, 4001)
    for (let index = 1; index < 48; index++) {
      streak = recordRocketClick(streak, 4001 + index * 100)
      expect(streak.rocketCount).toBe(index >= 47 ? 3 : index >= 31 ? 2 : 1)
    }
  })

  it('starts with ordinary rockets in a fresh window', () => {
    expect(recordRocketClick({ clicks: [], rocketCount: 1 }, 0)).toEqual({ clicks: [0], rocketCount: 1 })
  })
})
