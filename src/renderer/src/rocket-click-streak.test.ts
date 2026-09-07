import { describe, expect, it } from 'vitest'

import { recordRocketClick, type RocketClickStreak } from './rocket-click-streak'

describe('recordRocketClick', () => {
  it('unlocks grand rockets on the 32nd click within a minute', () => {
    let streak: RocketClickStreak = { clicks: [], grand: false }
    for (let index = 0; index < 32; index++) {
      streak = recordRocketClick(streak, index * 500)
      expect(streak.grand).toBe(index === 31)
    }
    expect(streak.clicks).toEqual([])
  })

  it('includes a click exactly sixty seconds old', () => {
    expect(recordRocketClick({ clicks: Array(31).fill(0), grand: false }, 60_000).grand).toBe(true)
  })

  it('discards clicks older than sixty seconds', () => {
    expect(recordRocketClick({ clicks: Array(31).fill(0), grand: false }, 60_001)).toEqual({ clicks: [60_001], grand: false })
  })

  it('uses a rolling window and keeps recent clicks when the oldest expires', () => {
    const clicks = [0, ...Array(30).fill(30_000)]
    const first = recordRocketClick({ clicks, grand: false }, 60_001)
    expect(first.grand).toBe(false)
    expect(first.clicks).toHaveLength(31)
    expect(recordRocketClick(first, 60_002).grand).toBe(true)
    expect(clicks).toHaveLength(31)
  })

  it('keeps every subsequent click grand without accumulating more timestamps', () => {
    let streak: RocketClickStreak = { clicks: [], grand: false }
    for (let index = 1; index <= 201; index++) {
      streak = recordRocketClick(streak, index * 400)
      expect(streak.grand).toBe(index >= 32)
      expect(streak.clicks.length).toBe(index >= 32 ? 0 : index)
    }
    expect(recordRocketClick(streak, 3_600_000)).toEqual({ clicks: [], grand: true })
  })

  it('starts with ordinary rockets in a fresh window', () => {
    expect(recordRocketClick({ clicks: [], grand: false }, 0)).toEqual({ clicks: [0], grand: false })
  })
})
