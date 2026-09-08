import { MAX_DROP_DISTANCE, type Point, type RocketKeyframe, type Viewport } from './rocket-flight'

const ROCKET_MARGIN = 64
const EXIT_MARGIN = 120
const DROP_MS = 480
const TURN_MS = 140
const GLIDE_PIXELS_PER_SECOND = 1200
const MIN_GLIDE_MS = 1100
const MAX_GLIDE_MS = 1800
const GLIDE_SAMPLES = 240
const MAX_GLIDE_SLOPE = 1.1

/** A fast decorative Qian Xuesen-style glide with independently randomized maneuvers. */
export function planBurstRocketFlight({ viewport, origin, random }: { viewport: Viewport; origin: Point; random: () => number }): {
  keyframes: RocketKeyframe[]
  totalMs: number
} {
  const room = Math.max(0, viewport.height - origin.y - ROCKET_MARGIN)
  const drop = Math.min(MAX_DROP_DISTANCE, room) * (0.55 + random() * 0.45)
  const distance = Math.max(EXIT_MARGIN, viewport.width - origin.x + EXIT_MARGIN)
  const initialPitchScale = 0.75 + random() * 0.5
  const segments = 3 + Math.floor(random() * 3)
  const weights = Array.from({ length: segments }, () => 0.6 + random())
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  const top = Math.min(drop, Math.max(0, ROCKET_MARGIN - origin.y))
  const bottom = Math.max(drop, Math.min(room, drop + 280))
  const points: Point[] = [{ x: 0, y: drop }]
  let x = 0
  for (let index = 0; index < segments; index++) {
    const previous = points[index]
    x += distance * weights[index] / weightSum
    // Short legs cannot jump across the window's height and force an abrupt pitch change.
    const reach = (x - previous.x) * MAX_GLIDE_SLOPE
    const low = Math.max(top, previous.y - reach)
    const high = Math.min(bottom, previous.y + reach)
    points.push({ x: index === segments - 1 ? distance : x, y: low + (high - low) * (0.1 + random() * 0.8) })
  }
  const slopes = points.map((point, index) => {
    const before = points[Math.max(0, index - 1)]
    const after = points[Math.min(segments, index + 1)]
    const slope = (after.y - before.y) / (after.x - before.x) * (index === 0 ? initialPitchScale : 1)
    // Shared tangents keep joins smooth; bounded Bezier controls keep the entire glide visible.
    const incoming = point.x - before.x
    const outgoing = after.x - point.x
    const minSlope = Math.max(
      incoming ? 3 * (point.y - bottom) / incoming : -Infinity,
      outgoing ? 3 * (top - point.y) / outgoing : -Infinity
    )
    const maxSlope = Math.min(
      incoming ? 3 * (point.y - top) / incoming : Infinity,
      outgoing ? 3 * (bottom - point.y) / outgoing : Infinity
    )
    return Math.max(minSlope, Math.min(maxSlope, slope))
  })
  const glide: { point: Point; heading: number; travelled: number }[] = []
  let travelled = 0

  const samplesPerSegment = Math.ceil(GLIDE_SAMPLES / segments)
  for (let segment = 0; segment < segments; segment++) {
    const from = points[segment]
    const to = points[segment + 1]
    const width = to.x - from.x
    const control1 = from.y + slopes[segment] * width / 3
    const control2 = to.y - slopes[segment + 1] * width / 3
    for (let index = segment === 0 ? 0 : 1; index <= samplesPerSegment; index++) {
      const t = index / samplesPerSegment
      const u = 1 - t
      const point = {
        x: from.x + width * t,
        y: u ** 3 * from.y + 3 * u * u * t * control1 + 3 * u * t * t * control2 + t ** 3 * to.y
      }
      const dy = 3 * u * u * (control1 - from.y) + 6 * u * t * (control2 - control1) + 3 * t * t * (to.y - control2)
      const heading = 90 + Math.atan2(dy, width) * 180 / Math.PI
      const previous = glide.at(-1)?.point
      if (previous) travelled += Math.hypot(point.x - previous.x, point.y - previous.y)
      glide.push({ point, heading, travelled })
    }
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
      offset: index === glide.length - 1 ? 1 : (DROP_MS + TURN_MS + arcLength / travelled * glideMs) / totalMs,
      transform: transform(point, heading),
      easing: 'linear'
    }))
  ]
  return { keyframes, totalMs }
}
