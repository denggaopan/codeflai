import { MAX_DROP_DISTANCE, type Point, type RocketKeyframe, type Viewport } from './rocket-flight'

const ROCKET_MARGIN = 64
const EXIT_MARGIN = 220
const DROP_MS = 480
const TURN_MS = 140
const GLIDE_PIXELS_PER_SECOND = 1200
const MIN_GLIDE_MS = 1100
const MAX_GLIDE_MS = 1800
const GLIDE_SAMPLES = 240

/** A fast decorative Qian Xuesen-style skip glide with diminishing arcs. */
export function planGrandRocketFlight({ viewport, origin }: { viewport: Viewport; origin: Point }): {
  keyframes: RocketKeyframe[]
  totalMs: number
} {
  const drop = Math.max(0, Math.min(MAX_DROP_DISTANCE, viewport.height - origin.y - ROCKET_MARGIN))
  const amplitude = Math.max(0, Math.min(220, origin.y + drop - ROCKET_MARGIN))
  const distance = Math.max(EXIT_MARGIN, viewport.width - origin.x + EXIT_MARGIN)
  const frequency = 2.5 * Math.PI
  const decay = 0.65
  const glide: { point: Point; heading: number; travelled: number }[] = []
  let travelled = 0

  for (let index = 0; index <= GLIDE_SAMPLES; index++) {
    const t = index / GLIDE_SAMPLES
    const wave = Math.sin(frequency * t)
    const envelope = amplitude * Math.exp(-decay * t)
    const point = { x: distance * t, y: drop - envelope * wave * wave }
    const dy = envelope * (decay * wave * wave - 2 * frequency * wave * Math.cos(frequency * t))
    const heading = 90 + Math.atan2(dy, distance) * 180 / Math.PI
    if (index > 0) {
      const previous = glide[index - 1].point
      travelled += Math.hypot(point.x - previous.x, point.y - previous.y)
    }
    glide.push({ point, heading, travelled })
  }

  // Arc-length timing preserves the fast sweep; cap its duration on ultrawide displays.
  const glideMs = Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, travelled / GLIDE_PIXELS_PER_SECOND * 1000))
  const totalMs = DROP_MS + TURN_MS + glideMs
  const transform = ({ x, y }: Point, heading: number): string =>
    `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${heading.toFixed(2)}deg)`
  const keyframes: RocketKeyframe[] = [
    { offset: 0, transform: transform({ x: 0, y: 0 }, 180), easing: 'cubic-bezier(0.33, 0, 0.8, 0.4)' },
    { offset: DROP_MS / totalMs, transform: transform({ x: 0, y: drop }, 180), easing: 'ease-in-out' },
    ...glide.map(({ point, heading, travelled: arcLength }, index) => ({
      offset: index === GLIDE_SAMPLES ? 1 : (DROP_MS + TURN_MS + arcLength / travelled * glideMs) / totalMs,
      transform: transform(point, heading),
      easing: 'linear'
    }))
  ]
  return { keyframes, totalMs }
}
