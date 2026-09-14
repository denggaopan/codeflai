import type { SessionRecord } from '../../shared/contracts'

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
 * `creating` counts: a session whose PTY is still being started is about to be running, and
 * powering the machine off in that window would be the worst possible moment.
 */
export const hasRunningSessions = (sessions: readonly SessionRecord[]): boolean =>
  sessions.some((session) => session.status === 'running' || session.status === 'creating')
