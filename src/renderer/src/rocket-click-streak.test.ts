import { describe, expect, it } from 'vitest'

import { recordRocketClick } from './rocket-click-streak'

describe('recordRocketClick', () => {
  it('upgrades only the hundredth click within a minute', () => {
    let clicks: number[] = []
    for (let index = 0; index < 100; index++) {
      const result = recordRocketClick(clicks, index * 500)
      expect(result.grand).toBe(index === 99)
      clicks = result.clicks
    }
    expect(clicks).toEqual([])
  })

  it('includes a click exactly sixty seconds old', () => {
    expect(recordRocketClick(Array(99).fill(0), 60_000).grand).toBe(true)
  })

  it('discards clicks older than sixty seconds', () => {
    expect(recordRocketClick(Array(99).fill(0), 60_001)).toEqual({ clicks: [60_001], grand: false })
  })

  it('uses a rolling window and keeps recent clicks when the oldest expires', () => {
    const clicks = [0, ...Array(98).fill(30_000)]
    const first = recordRocketClick(clicks, 60_001)
    expect(first.grand).toBe(false)
    expect(first.clicks).toHaveLength(99)
    expect(recordRocketClick(first.clicks, 60_002).grand).toBe(true)
    expect(clicks).toHaveLength(99)
  })

  it('requires a fresh hundred clicks after each grand rocket', () => {
    let clicks: number[] = []
    const grandClicks: number[] = []
    for (let index = 1; index <= 201; index++) {
      const result = recordRocketClick(clicks, index)
      clicks = result.clicks
      if (result.grand) grandClicks.push(index)
      expect(clicks.length).toBeLessThan(100)
    }
    expect(grandClicks).toEqual([100, 200])
  })
})
