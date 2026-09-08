import { describe, expect, it } from 'vitest'

import { planBurstRocketFlight } from './burst-rocket-flight'
import { headingDirection } from './rocket-flight'

const origin = { x: 70, y: 36 }

function randomFrom(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

function decode(transform: string): { x: number; y: number; heading: number } {
  const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) rotate\((-?[\d.]+)deg\)/.exec(transform)
  if (!match) throw new Error(`Unexpected transform: ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]), heading: Number(match[3]) }
}

describe('planBurstRocketFlight', () => {
  it.each([
    { width: 1440, height: 900 },
    { width: 800, height: 600 },
    { width: 900, height: 600 },
    { width: 3840, height: 2160 }
  ])('drops, glides rapidly and fully exits a $width x $height window', (viewport) => {
    for (const seed of [...Array.from({ length: 20 }, (_, index) => index + 1), 412, 6952]) {
      const flight = planBurstRocketFlight({ viewport, origin, random: randomFrom(seed) })
      const frames = flight.keyframes.map((frame) => ({ ...decode(frame.transform), offset: frame.offset }))
      expect(frames[0]).toMatchObject({ x: 0, y: 0, heading: 180, offset: 0 })
      expect(frames[1].x).toBe(0)
      expect(frames[1].y).toBeGreaterThan(100)
      expect(frames[1].y).toBeLessThanOrEqual(500)
      expect(frames[1].heading).toBe(180)
      expect(frames[2]).toMatchObject({ x: 0, y: frames[1].y })
      const glide = frames.slice(2)
      for (let index = 1; index < glide.length; index++) {
        const from = glide[index - 1]
        const to = glide[index]
        expect(to.x).toBeGreaterThan(from.x)
        expect(to.offset).toBeGreaterThan(from.offset)
        expect(origin.y + to.y).toBeGreaterThanOrEqual(64)
        expect(origin.y + to.y).toBeLessThanOrEqual(viewport.height - 64)
        const speed = Math.hypot(to.x - from.x, to.y - from.y) / ((to.offset - from.offset) * flight.totalMs / 1000)
        expect(speed).toBeGreaterThan(650)
        expect(Math.abs(to.heading - from.heading)).toBeLessThan(15)
      }
      const exit = glide[glide.length - 1]
      expect(origin.x + exit.x).toBeGreaterThanOrEqual(viewport.width + 120)
      expect(exit.offset).toBe(1)
      expect(flight.totalMs).toBeGreaterThan(1000)
      expect(flight.totalMs).toBeLessThanOrEqual(2500)
    }
  })

  it('keeps the nose tangent to randomized curved glides', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const flight = planBurstRocketFlight({ viewport: { width: 1440, height: 900 }, origin, random: randomFrom(seed) })
      const glide = flight.keyframes.slice(2).map((frame) => decode(frame.transform))
      for (let index = 1; index < glide.length - 1; index++) {
        const dx = glide[index + 1].x - glide[index - 1].x
        const dy = glide[index + 1].y - glide[index - 1].y
        const distance = Math.hypot(dx, dy)
        const nose = headingDirection(glide[index].heading)
        expect((nose.x * dx + nose.y * dy) / distance).toBeGreaterThan(0.999)
      }
    }
  })

  it('randomizes directions and curve shapes independently for every rocket', () => {
    const viewport = { width: 1440, height: 900 }
    const flights = Array.from({ length: 20 }, (_, seed) =>
      planBurstRocketFlight({ viewport, origin, random: randomFrom(seed + 1) }).keyframes.slice(2).map((frame) => decode(frame.transform)))
    const headings = flights.map((frames) => frames[0].heading)
    expect(new Set(headings).size).toBeGreaterThan(15)
    expect(headings.some((heading) => heading < 80)).toBe(true)
    expect(headings.some((heading) => heading > 100)).toBe(true)
    const normalized = flights.map((frames) => frames.map((frame) => +(frame.y - frames[0].y).toFixed(1)))
    expect(new Set(normalized.map((frames) => JSON.stringify(frames))).size).toBe(20)
    expect(planBurstRocketFlight({ viewport, origin, random: randomFrom(42) }))
      .toEqual(planBurstRocketFlight({ viewport, origin, random: randomFrom(42) }))
  })

  it.each([0, 0.5, 0.999999])('keeps finite frames and increasing offsets in tiny windows (random: %s)', (value) => {
    const flight = planBurstRocketFlight({ viewport: { width: 120, height: 60 }, origin, random: () => value })
    expect(decode(flight.keyframes[1].transform).y).toBeGreaterThanOrEqual(0)
    flight.keyframes.forEach((frame, index) => {
      expect(Object.values(decode(frame.transform)).every(Number.isFinite)).toBe(true)
      expect(Number.isFinite(frame.offset)).toBe(true)
      if (index) expect(frame.offset).toBeGreaterThan(flight.keyframes[index - 1].offset)
    })
  })
})
