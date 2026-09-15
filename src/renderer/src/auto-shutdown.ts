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
}

export const DEFAULT_AUTO_SHUTDOWN: Readonly<AutoShutdownPreference> = {
  enabled: false,
  intervalMs: DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS
}

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
    const { enabled, intervalMs } = parsed as { enabled?: unknown; intervalMs?: unknown }
    return {
      enabled: enabled === true,
      intervalMs: isAutoShutdownInterval(intervalMs) ? intervalMs : DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS
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
