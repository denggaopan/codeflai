import { describe, expect, it } from 'vitest'

import { recordRocketClick, type RocketClickStreak } from './rocket-click-streak'

describe('recordRocketClick', () => {
  it('unlocks burst rockets on the 32nd click within a minute', () => {
    let streak: RocketClickStreak = { clicks: [], burst: false }
    for (let index = 0; index < 32; index++) {
      streak = recordRocketClick(streak, index * 500)
      expect(streak.burst).toBe(index === 31)
    }
    expect(streak.clicks).toEqual([])
  })

  it('includes a click exactly sixty seconds old', () => {
    expect(recordRocketClick({ clicks: Array(31).fill(0), burst: false }, 60_000).burst).toBe(true)
  })

  it('discards clicks older than sixty seconds', () => {
    expect(recordRocketClick({ clicks: Array(31).fill(0), burst: false }, 60_001)).toEqual({ clicks: [60_001], burst: false })
  })

  it('uses a rolling window and keeps recent clicks when the oldest expires', () => {
    const clicks = [0, ...Array(30).fill(30_000)]
    const first = recordRocketClick({ clicks, burst: false }, 60_001)
    expect(first.burst).toBe(false)
    expect(first.clicks).toHaveLength(31)
    expect(recordRocketClick(first, 60_002).burst).toBe(true)
    expect(clicks).toHaveLength(31)
  })

  it('keeps every subsequent click burst without accumulating more timestamps', () => {
    let streak: RocketClickStreak = { clicks: [], burst: false }
    for (let index = 1; index <= 201; index++) {
      streak = recordRocketClick(streak, index * 400)
      expect(streak.burst).toBe(index >= 32)
      expect(streak.clicks.length).toBe(index >= 32 ? 0 : index)
    }
    expect(recordRocketClick(streak, 3_600_000)).toEqual({ clicks: [], burst: true })
  })

  it('starts with ordinary rockets in a fresh window', () => {
    expect(recordRocketClick({ clicks: [], burst: false }, 0)).toEqual({ clicks: [0], burst: false })
  })
})
