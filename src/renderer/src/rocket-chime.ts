import type { Point, Viewport } from './rocket-flight'

/**
 * The rocket easter egg's clock: on every wall-clock hour it drops one rocket per hour on the
 * dial — nine at 09:00, five at 17:00, twelve at noon and at midnight — and the two switches
 * that decide whether any of it happens.
 *
 * Everything here is pure so the timing policy can be tested without a clock or a window,
 * exactly like auto-shutdown.ts next door. The preference lives here rather than in
 * rocket-flight.ts because that module is the flight geometry and knows nothing about when a
 * flight is allowed to start.
 */

export const HOUR_MS = 60 * 60_000

/** Twelve at noon and at midnight, not zero: this is the dial, not the 24-hour clock. */
export const rocketsAtHour = (hour: Date): number => hour.getHours() % 12 || 12

/** The most rockets one chime can put in the air, i.e. `rocketsAtHour` at 12. */
export const MAX_CHIME_ROCKETS = 12

/**
 * How long until the next wall-clock hour.
 *
 * Read off the local clock's own minute/second fields rather than by taking the epoch
 * milliseconds modulo an hour: a handful of zones are offset by thirty or forty-five minutes
 * (India, Nepal), where epoch arithmetic would put "the hour" at HH:30 local time.
 *
 * Exactly on the hour this answers a whole hour, never zero, so a timer chained on it cannot
 * spin.
 */
export const msUntilNextHour = (now: Date): number => HOUR_MS - msIntoHour(now)

const msIntoHour = (now: Date): number =>
  now.getMinutes() * 60_000 + now.getSeconds() * 1_000 + now.getMilliseconds()

/**
 * The hour a tick belongs to: the nearest HH:00, which may be the one just gone or the one
 * just ahead.
 *
 * Rounding to the nearest hour rather than flooring is what makes a timer that fires a
 * millisecond early — which is allowed, and which an early tick at HH-1:59:59.999 looks like
 * — still count as this hour's chime and still drop this hour's number of rockets, instead of
 * being read as an hour that is 59 minutes stale and skipped.
 */
export const nearestHourStart = (now: Date): Date => {
  const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())
  const into = now.getTime() - floor.getTime()
  return into * 2 <= HOUR_MS ? floor : new Date(floor.getTime() + HOUR_MS)
}

/** How far this moment is from the hour it belongs to, in either direction. */
export const msFromNearestHour = (now: Date): number => Math.abs(now.getTime() - nearestHourStart(now).getTime())

/**
 * How late a tick may be and still be worth firing.
 *
 * A machine that slept through 09:00 and wakes at 11:20 runs its overdue timer immediately,
 * and nine rockets at twenty past eleven are not a chime — they are a lie about the time. So
 * a tick that missed its hour by more than this is dropped and only the next hour is
 * rescheduled. Five minutes is well above any scheduling delay (and above the ~1/minute
 * wake-up a throttled renderer would get, which window.ts switches off anyway) and far below
 * any real sleep.
 */
export const CHIME_GRACE_MS = 5 * 60_000

/**
 * The gap between one rocket of a chime and the next. Twelve rockets leaving at once read as
 * a single blur; a short stagger makes them count themselves out, which is the whole point of
 * dropping one per hour on the dial.
 */
export const CHIME_STAGGER_MS = 140

/** Keeps the outermost rockets of a chime clear of the window's own edges. */
const CHIME_EDGE_MARGIN = 32

/**
 * Where a chime's rockets start: spread evenly across the top of the window rather than
 * stacked on the brand button the click easter egg launches from. Twelve rockets fanned out
 * from one point would be off the left edge before the first one fell, and a chime is about
 * the whole window anyway — it is the clock striking, not somebody poking the logo.
 *
 * Each rocket sits in the middle of its own share of the usable width, so one rocket is
 * centred and twelve are evenly pitched with half-gaps at both ends.
 */
export const chimeLaunchOrigins = (input: { count: number; viewport: Viewport; y: number }): Point[] => {
  const { count, viewport, y } = input
  if (count <= 0) return []
  const usable = Math.max(0, viewport.width - CHIME_EDGE_MARGIN * 2)
  return Array.from({ length: count }, (_, index) => ({
    x: CHIME_EDGE_MARGIN + (usable * (index + 0.5)) / count,
    y
  }))
}

/**
 * The two switches in Settings. `hourlyEnabled` is kept apart from `enabled` — and survives
 * it being switched off — for the same reason the auto-shutdown window survives its own
 * switch: switching the easter egg off and on again must not silently reconfigure it.
 */
export type RocketPreference = {
  /** The easter egg as a whole: the brand-button launch and the hourly chime. */
  enabled: boolean
  /** Whether the clock drops rockets on the hour. Only acts while `enabled`. */
  hourlyEnabled: boolean
}

/**
 * Both default on. Unlike auto shutdown — which is off by default because it is
 * irreversible — a rocket costs nothing and cannot be discovered from a switch that is
 * already off, so an install that has never opened Settings gets the whole easter egg, and
 * the switches are there to turn it down rather than to find it.
 */
export const DEFAULT_ROCKET: Readonly<RocketPreference> = {
  enabled: true,
  hourlyEnabled: true
}

/**
 * Reads the stored preference leniently, like the other renderer-owned preferences. Both
 * flags default to on, so only a literal `false` switches either off: anything unreadable,
 * partially written, or left by an older build (which carries neither key) keeps the whole
 * easter egg — the harmless direction for a preference nothing depends on.
 */
export const parseStoredRocket = (raw: string | null): RocketPreference => {
  if (raw === null) return { ...DEFAULT_ROCKET }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_ROCKET }
    const { enabled, hourlyEnabled } = parsed as { enabled?: unknown; hourlyEnabled?: unknown }
    return { enabled: enabled !== false, hourlyEnabled: hourlyEnabled !== false }
  } catch {
    return { ...DEFAULT_ROCKET }
  }
}
