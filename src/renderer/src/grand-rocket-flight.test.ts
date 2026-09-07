import { describe, expect, it } from 'vitest'

import { planGrandRocketFlight } from './grand-rocket-flight'
import { headingDirection } from './rocket-flight'

const origin = { x: 70, y: 36 }

function decode(transform: string): { x: number; y: number; heading: number } {
  const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) rotate\((-?[\d.]+)deg\)/.exec(transform)
  if (!match) throw new Error(`Unexpected transform: ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]), heading: Number(match[3]) }
}

describe('planGrandRocketFlight', () => {
  it.each([
    { width: 1440, height: 900 },
    { width: 800, height: 600 },
    { width: 3840, height: 2160 }
  ])('drops, skip-glides rapidly and fully exits a $width x $height window', (viewport) => {
    const flight = planGrandRocketFlight({ viewport, origin })
    const frames = flight.keyframes.map((frame) => ({ ...decode(frame.transform), offset: frame.offset }))
    expect(frames[0]).toMatchObject({ x: 0, y: 0, heading: 180, offset: 0 })
    expect(frames[1].x).toBe(0)
    expect(frames[1].y).toBeGreaterThan(100)
    expect(frames[1].y).toBeLessThanOrEqual(500)
    expect(frames[1].heading).toBe(180)
    expect(frames[2]).toMatchObject({ x: 0, y: frames[1].y, heading: 90 })

    const glide = frames.slice(2)
    const turns: number[] = []
    let previousDirection = 0
    for (let index = 1; index < glide.length; index++) {
      const from = glide[index - 1]
      const to = glide[index]
      expect(to.x).toBeGreaterThan(from.x)
      expect(to.offset).toBeGreaterThan(from.offset)
      expect(origin.y + to.y).toBeGreaterThanOrEqual(64)
      expect(origin.y + to.y).toBeLessThanOrEqual(viewport.height - 64)
      const speed = Math.hypot(to.x - from.x, to.y - from.y) / ((to.offset - from.offset) * flight.totalMs / 1000)
      expect(speed).toBeGreaterThan(900)
      const direction = Math.sign(to.y - from.y)
      if (direction && previousDirection && direction !== previousDirection) turns.push(from.y)
      if (direction) previousDirection = direction
    }
    expect(turns.length).toBeGreaterThanOrEqual(4)
    // Each skip has a lower crest as the glide settles.
    expect(turns[2]).toBeGreaterThan(turns[0])
    const exit = glide[glide.length - 1]
    expect(origin.x + exit.x).toBeGreaterThanOrEqual(viewport.width + 220)
    expect(exit.offset).toBe(1)
    expect(flight.totalMs).toBeGreaterThan(1000)
    expect(flight.totalMs).toBeLessThanOrEqual(2500)
  })

  it('keeps the nose tangent to the curved glide', () => {
    const flight = planGrandRocketFlight({ viewport: { width: 1440, height: 900 }, origin })
    const glide = flight.keyframes.slice(2).map((frame) => decode(frame.transform))
    for (let index = 1; index < glide.length - 1; index++) {
      const dx = glide[index + 1].x - glide[index - 1].x
      const dy = glide[index + 1].y - glide[index - 1].y
      const distance = Math.hypot(dx, dy)
      const nose = headingDirection(glide[index].heading)
      expect((nose.x * dx + nose.y * dy) / distance).toBeGreaterThan(0.999)
    }
  })

  it('does not invert the fall or produce invalid frames in a tiny window', () => {
    const flight = planGrandRocketFlight({ viewport: { width: 120, height: 60 }, origin })
    expect(decode(flight.keyframes[1].transform).y).toBeGreaterThanOrEqual(0)
    for (const frame of flight.keyframes) {
      expect(Object.values(decode(frame.transform)).every(Number.isFinite)).toBe(true)
    }
  })
})
