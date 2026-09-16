import type { SessionRecord } from '../../shared/contracts'
import { isAgentDone } from './session-status'

/**
 * Auto shutdown: while it is switched on, the renderer checks every `intervalMs` whether any
 * session is still running and, when none is, opens a countdown dialog that powers the
 * machine off unless the user stops it. Everything in this module is pure so the timing
 * policy can be tested without a clock, a store, or a window.
 */

/** Selectable check frequencies, in minutes, in the order the dropdown lists them. */
export const AUTO_SHUTDOWN_INTERVAL_MINUTES = [1, 2, 3, 4, 5, 10, 15, 30, 60] as const

export const AUTO_SHUTDOWN_INTERVAL_OPTIONS: readonly number[] = AUTO_SHUTDOWN_INTERVAL_MINUTES.map(
  (minutes) => minutes * 60_000
)

/** The documented default: check every five minutes. */
export const DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS = 5 * 60_000

/**
 * The time-of-day window the shutdown is confined to while the restriction is on, as two
 * 24-hour `HH:MM` clock readings. The start is inclusive and the end exclusive, and a start
 * later than its end wraps midnight — which is the whole point of the feature: the window
 * people actually want is the night, 20:00–08:00.
 *
 * Kept as the clock strings the dropdowns offer, so the preference, the control, and what
 * lands in localStorage are all one representation; minutes since midnight exist only inside
 * the comparison below.
 */
export type AutoShutdownTimeRange = {
  start: string
  end: string
}

/** The night shift, and the example this feature was asked for. */
export const DEFAULT_AUTO_SHUTDOWN_TIME_RANGE: Readonly<AutoShutdownTimeRange> = {
  start: '20:00',
  end: '08:00'
}

const MINUTES_PER_DAY = 24 * 60

/**
 * Reads an `HH:MM` clock time as minutes since midnight, or null when it is not one.
 *
 * Lenient in the two ways a stored or hand-edited value differs from what the control emits:
 * a single-digit hour (`8:00`) and a trailing seconds field (`20:00:00`), which is what a
 * time input carrying a `step` would produce. Anything else — a 25th hour, a 60th minute, an
 * empty string, a number — is not a time of day.
 */
export const parseTimeOfDay = (value: unknown): number | null => {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Renders minutes since midnight as the zero-padded `HH:MM` the dropdowns list. */
export const formatTimeOfDay = (minutes: number): string => {
  const wrapped = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

/**
 * How far apart the times the dropdowns offer are.
 *
 * Both ends of the window are picked from a list rather than typed: this is a coarse "not
 * before the evening" rule, and half an hour is as fine as it needs to be — an hour cannot
 * express 22:30, and anything finer turns a 48-row menu into one nobody can scan. A window
 * that arrives from somewhere else off this grid is still honoured; it is the menu that is
 * rounded, not the rule (see isWithinTimeRange, which takes any time of day).
 */
export const AUTO_SHUTDOWN_TIME_STEP_MINUTES = 30

/** Every time the dropdowns offer, from midnight to the last half hour of the day. */
export const AUTO_SHUTDOWN_TIME_OPTIONS: readonly string[] = Array.from(
  { length: MINUTES_PER_DAY / AUTO_SHUTDOWN_TIME_STEP_MINUTES },
  (_, index) => formatTimeOfDay(index * AUTO_SHUTDOWN_TIME_STEP_MINUTES)
)

export const isAutoShutdownTimeRange = (value: unknown): value is AutoShutdownTimeRange => {
  if (typeof value !== 'object' || value === null) return false
  const { start, end } = value as { start?: unknown; end?: unknown }
  return parseTimeOfDay(start) !== null && parseTimeOfDay(end) !== null
}

/** The local wall-clock time of day, in minutes since midnight. */
export const minutesSinceMidnight = (now: Date): number => now.getHours() * 60 + now.getMinutes()

/**
 * Whether a time of day falls inside the window.
 *
 * The start is inclusive and the end exclusive — 20:00–08:00 takes 20:00 and has already
 * closed at 08:00 — and a start later than its end wraps midnight, which is the only shape
 * an overnight window can have.
 *
 * Two cases deliberately answer *no*:
 *
 * - **A window that cannot be read.** It should never get here (`parseStoredAutoShutdown`
 *   drops an unreadable range), but a restriction nobody can interpret must not be read as
 *   permission to power the machine off.
 * - **A window whose ends are equal.** It is zero minutes long, so nothing is inside it.
 *   Reading it as "all day" instead would quietly turn the restriction somebody had just
 *   configured into no restriction at all and power the machine off at noon — the one
 *   direction of this mistake that costs somebody their afternoon.
 */
export const isWithinTimeRange = (range: AutoShutdownTimeRange, timeOfDayMinutes: number): boolean => {
  const start = parseTimeOfDay(range.start)
  const end = parseTimeOfDay(range.end)
  if (start === null || end === null || start === end) return false
  return start < end
    ? timeOfDayMinutes >= start && timeOfDayMinutes < end
    : timeOfDayMinutes >= start || timeOfDayMinutes < end
}

/**
 * How long the confirmation dialog counts down before it shuts the machine down on its own.
 * Short enough that an idle machine does power off unattended — the whole point — and long
 * enough that someone sitting in front of it can stop it.
 */
export const SHUTDOWN_COUNTDOWN_SECONDS = 10

/**
 * How far past its deadline a tick has to arrive before it is read as the clock having
 * jumped — the machine slept or hibernated — rather than as a late tick.
 *
 * It has to sit well above any throttling delay, and that is the whole reason it is five
 * minutes and not ten seconds. A renderer hidden for a few minutes is throttled by Chromium
 * to roughly one wake-up a minute, so with a small threshold *every* tick of an unattended
 * countdown would look like a clock jump, restart the countdown, and be a minute late again
 * — the machine would never power off at all. Five minutes is longer than any throttling
 * interval and far shorter than a real sleep.
 */
const COUNTDOWN_CLOCK_JUMP_MS = 5 * 60_000

/**
 * What the countdown should do on a given tick, worked out from the deadline rather than by
 * subtracting one from the last number shown.
 *
 * The tick that drives this is a renderer timer, and a renderer whose window has been hidden
 * for minutes — which is the whole unattended run this feature exists for — is throttled by
 * Chromium to about one wake-up a minute. Counting ticks would stretch ten seconds into ten
 * minutes and show numbers that have nothing to do with the clock; reading the deadline
 * instead means a throttled tick shuts the machine down late by at most one wake-up, and
 * never displays a second that has already passed.
 *
 * A deadline missed by more than `COUNTDOWN_CLOCK_JUMP_MS` starts the countdown over:
 * someone opening a lid deserves the same ten seconds to stop it as someone sitting in front
 * of the screen.
 */
export const countdownTick = (deadlineMs: number, nowMs: number): number | 'shutdown' | 'restart' => {
  const remainingMs = deadlineMs - nowMs
  if (remainingMs > 0) return Math.ceil(remainingMs / 1000)
  return remainingMs < -COUNTDOWN_CLOCK_JUMP_MS ? 'restart' : 'shutdown'
}

export type AutoShutdownPreference = {
  enabled: boolean
  intervalMs: number
  /**
   * Whether the shutdown is confined to `timeRange`. Kept apart from the range itself so the
   * range survives being switched off, exactly as the interval survives the whole feature
   * being switched off: an accidental click must not lose the hours somebody typed.
   */
  timeRangeEnabled: boolean
  timeRange: AutoShutdownTimeRange
}

export const DEFAULT_AUTO_SHUTDOWN: Readonly<AutoShutdownPreference> = {
  enabled: false,
  intervalMs: DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS,
  timeRangeEnabled: false,
  timeRange: { ...DEFAULT_AUTO_SHUTDOWN_TIME_RANGE }
}

/**
 * Whether the preference allows a shutdown at this moment.
 *
 * `false` only ever means "not now": the watcher keeps its cadence and asks again next
 * interval, which is how a machine that goes idle at lunchtime still powers itself off once
 * the window opens in the evening.
 */
export const isAutoShutdownAllowedAt = (preference: AutoShutdownPreference, now: Date): boolean =>
  !preference.timeRangeEnabled || isWithinTimeRange(preference.timeRange, minutesSinceMidnight(now))

export const isAutoShutdownInterval = (value: unknown): value is number =>
  typeof value === 'number' && AUTO_SHUTDOWN_INTERVAL_OPTIONS.includes(value)

/**
 * Renders an interval as the dropdown's label: "1m" … "30m" for minutes, "1h" for the hour.
 * Deliberately untranslated — these are the same unit letters in every locale Codeflai
 * ships, and they have to stay narrow enough for a title-bar control.
 */
export const formatAutoShutdownInterval = (intervalMs: number): string => {
  const minutes = Math.round(intervalMs / 60_000)
  return minutes % 60 === 0 && minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`
}

/**
 * Reads the stored preference leniently, exactly like the other renderer-owned preferences:
 * anything unreadable, partially written, or carrying an interval this build no longer
 * offers falls back to the defaults rather than leaving auto shutdown in a half-configured
 * state. A stored `enabled` that is not literally `true` means off — the safe direction for
 * a feature that powers the machine down.
 */
export const parseStoredAutoShutdown = (raw: string | null): AutoShutdownPreference => {
  if (raw === null) return { ...DEFAULT_AUTO_SHUTDOWN }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_AUTO_SHUTDOWN }
    const { enabled, intervalMs, timeRangeEnabled, timeRange } = parsed as {
      enabled?: unknown
      intervalMs?: unknown
      timeRangeEnabled?: unknown
      timeRange?: unknown
    }
    return {
      enabled: enabled === true,
      intervalMs: isAutoShutdownInterval(intervalMs) ? intervalMs : DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS,
      // A preference written before this build carries neither key, and that reads as the
      // default — no restriction — so an installation that already powers itself off keeps
      // doing it at whatever hour it did. A range that cannot be read while the restriction
      // is on falls back to the default *window* rather than to no window: a restriction was
      // asked for, and the night is a much better guess at what was meant than "any time".
      timeRangeEnabled: timeRangeEnabled === true,
      timeRange: isAutoShutdownTimeRange(timeRange)
        ? { start: formatTimeOfDay(parseTimeOfDay(timeRange.start)!), end: formatTimeOfDay(parseTimeOfDay(timeRange.end)!) }
        : { ...DEFAULT_AUTO_SHUTDOWN_TIME_RANGE }
    }
  } catch {
    return { ...DEFAULT_AUTO_SHUTDOWN }
  }
}

/**
 * Whether any session still counts as running, which is what holds the shutdown off.
 *
 * "Running" here means exactly what the sidebar shows, not whether a PTY happens to be
 * alive: an agent that has finished its turn and is waiting for input reads as **Done**
 * there, and `isAgentDone` is imported rather than re-derived so the two can never disagree.
 * Judging by the raw status instead would make this feature unreachable in practice — every
 * agent session you have ever talked to stays `running` until you stop it by hand, so the
 * machine would only ever power off after you had already walked back to it.
 *
 * `creating` does hold the shutdown off (the sidebar calls it *Starting…*): a session whose
 * PTY is still coming up is about to be running, and powering the machine off in that window
 * would be the worst possible moment. Shells never go Done — they idle at their prompt and
 * cannot say whether a build is running — so a live shell always holds the shutdown off.
 */
export const hasRunningSessions = (
  sessions: readonly SessionRecord[],
  idleAgentSessionIds: Readonly<Record<string, true>> = {}
): boolean =>
  sessions.some(
    (session) =>
      session.status === 'creating' ||
      (session.status === 'running' && !isAgentDone(session, idleAgentSessionIds[session.id] === true))
  )
