import { describe, expect, it } from 'vitest'

import type { SessionRecord } from '../../shared/contracts'
import {
  AUTO_SHUTDOWN_INTERVAL_OPTIONS,
  AUTO_SHUTDOWN_TIME_OPTIONS,
  DEFAULT_AUTO_SHUTDOWN,
  DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS,
  DEFAULT_AUTO_SHUTDOWN_TIME_RANGE,
  SHUTDOWN_COUNTDOWN_SECONDS,
  countdownTick,
  formatAutoShutdownInterval,
  formatTimeOfDay,
  hasRunningSessions,
  isAutoShutdownAllowedAt,
  isAutoShutdownInterval,
  isAutoShutdownTimeRange,
  isWithinTimeRange,
  minutesSinceMidnight,
  parseStoredAutoShutdown,
  parseTimeOfDay,
  type AutoShutdownPreference
} from './auto-shutdown'

const session = (status: SessionRecord['status'], kind: SessionRecord['kind'] = 'claude'): SessionRecord => ({
  id: `session-${kind}-${status}`,
  projectId: 'project-1',
  kind,
  title: 'Session',
  titleState: 'complete',
  createdAt: '2026-08-20T00:00:00.000Z',
  mode: 'ordinary',
  launchPath: 'C:\\work\\demo-project',
  status
})

const done = (record: SessionRecord): Record<string, true> => ({ [record.id]: true })

/** The whole preference as it is when nobody has touched it: off, five minutes, no window. */
const defaults = (): AutoShutdownPreference => ({
  enabled: false,
  intervalMs: DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS,
  timeRangeEnabled: false,
  timeRange: { start: '20:00', end: '08:00' }
})

describe('auto shutdown intervals', () => {
  it('offers the nine documented frequencies from one minute to an hour', () => {
    expect(AUTO_SHUTDOWN_INTERVAL_OPTIONS.map(formatAutoShutdownInterval)).toEqual([
      '1m',
      '2m',
      '3m',
      '4m',
      '5m',
      '10m',
      '15m',
      '30m',
      '1h'
    ])
  })

  it('defaults to the five-minute check', () => {
    expect(AUTO_SHUTDOWN_INTERVAL_OPTIONS).toContain(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)
    expect(formatAutoShutdownInterval(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)).toBe('5m')
  })

  it('accepts only intervals the dropdown actually offers', () => {
    expect(isAutoShutdownInterval(60_000)).toBe(true)
    expect(isAutoShutdownInterval(90_000)).toBe(false)
    expect(isAutoShutdownInterval('60000')).toBe(false)
    expect(isAutoShutdownInterval(undefined)).toBe(false)
  })
})

describe('parseStoredAutoShutdown', () => {
  it('restores a stored preference', () => {
    expect(
      parseStoredAutoShutdown(
        JSON.stringify({ enabled: true, intervalMs: 900_000, timeRangeEnabled: true, timeRange: { start: '22:30', end: '06:15' } })
      )
    ).toEqual({
      enabled: true,
      intervalMs: 900_000,
      timeRangeEnabled: true,
      timeRange: { start: '22:30', end: '06:15' }
    })
  })

  it('falls back to the defaults for a missing, unreadable, or non-object value', () => {
    for (const stored of [null, 'not json', '"string"', '42']) {
      expect(parseStoredAutoShutdown(stored)).toEqual(defaults())
    }
  })

  it('keeps a readable half of the preference and defaults the rest', () => {
    expect(parseStoredAutoShutdown(JSON.stringify({ enabled: true }))).toEqual({ ...defaults(), enabled: true })
    expect(parseStoredAutoShutdown(JSON.stringify({ intervalMs: 120_000 }))).toEqual({ ...defaults(), intervalMs: 120_000 })
  })

  // A preference written by 0.25.x and earlier has neither key, and it has to keep meaning
  // what it meant then: shut the machine down at whatever hour it goes idle.
  it('reads a preference written before the time range existed as unrestricted', () => {
    expect(parseStoredAutoShutdown(JSON.stringify({ enabled: true, intervalMs: 60_000 }))).toEqual({
      ...defaults(),
      enabled: true,
      intervalMs: 60_000
    })
  })

  it('normalizes a stored time so the control always gets an HH:MM value', () => {
    expect(
      parseStoredAutoShutdown(JSON.stringify({ timeRangeEnabled: true, timeRange: { start: '8:05', end: '20:00:00' } })).timeRange
    ).toEqual({ start: '08:05', end: '20:00' })
  })

  // An unreadable window with the restriction switched on falls back to the default window,
  // not to no window: a restriction was asked for, and the night is a far better guess at
  // what was meant than powering the machine off at any hour.
  it('falls back to the default window rather than dropping an unreadable one', () => {
    for (const timeRange of [undefined, null, 'nightly', { start: '25:00', end: '08:00' }, { start: '20:00' }]) {
      const stored = parseStoredAutoShutdown(JSON.stringify({ timeRangeEnabled: true, timeRange }))
      expect(stored.timeRangeEnabled).toBe(true)
      expect(stored.timeRange).toEqual({ ...DEFAULT_AUTO_SHUTDOWN_TIME_RANGE })
    }
  })

  it('treats anything but a literal true as no time restriction', () => {
    expect(parseStoredAutoShutdown(JSON.stringify({ timeRangeEnabled: 'true' })).timeRangeEnabled).toBe(false)
    expect(parseStoredAutoShutdown(JSON.stringify({ timeRangeEnabled: 1 })).timeRangeEnabled).toBe(false)
  })

  it('treats anything but a literal true as switched off', () => {
    expect(parseStoredAutoShutdown(JSON.stringify({ enabled: 'true', intervalMs: 60_000 })).enabled).toBe(false)
    expect(parseStoredAutoShutdown(JSON.stringify({ enabled: 1, intervalMs: 60_000 })).enabled).toBe(false)
  })

  it('drops an interval this build no longer offers', () => {
    expect(parseStoredAutoShutdown(JSON.stringify({ enabled: true, intervalMs: 7_000 })).intervalMs).toBe(
      DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS
    )
  })
})

describe('times of day', () => {
  it('reads a clock time as minutes since midnight', () => {
    expect(parseTimeOfDay('00:00')).toBe(0)
    expect(parseTimeOfDay('08:00')).toBe(8 * 60)
    expect(parseTimeOfDay('20:30')).toBe(20 * 60 + 30)
    expect(parseTimeOfDay('23:59')).toBe(23 * 60 + 59)
  })

  // The two shapes a stored or hand-edited value differs in from what the control emits.
  it('accepts a single-digit hour and a trailing seconds field', () => {
    expect(parseTimeOfDay('8:05')).toBe(8 * 60 + 5)
    expect(parseTimeOfDay('20:00:00')).toBe(20 * 60)
    expect(parseTimeOfDay(' 20:00 ')).toBe(20 * 60)
  })

  it('rejects anything that is not a time of day', () => {
    for (const value of ['', '24:00', '20:60', '2000', '20:0', 'noon', '20', 1200, null, undefined, {}]) {
      expect(parseTimeOfDay(value)).toBeNull()
    }
  })

  it('renders minutes back as the zero-padded value a time input expects', () => {
    expect(formatTimeOfDay(0)).toBe('00:00')
    expect(formatTimeOfDay(8 * 60 + 5)).toBe('08:05')
    expect(formatTimeOfDay(23 * 60 + 59)).toBe('23:59')
  })

  it('reads the local wall clock, not UTC', () => {
    const local = new Date(2026, 8, 16, 21, 45)
    expect(minutesSinceMidnight(local)).toBe(21 * 60 + 45)
  })

  // Both ends of the window are picked from this list rather than typed.
  it('offers every half hour of the day', () => {
    expect(AUTO_SHUTDOWN_TIME_OPTIONS).toHaveLength(48)
    expect(AUTO_SHUTDOWN_TIME_OPTIONS.slice(0, 3)).toEqual(['00:00', '00:30', '01:00'])
    expect(AUTO_SHUTDOWN_TIME_OPTIONS.at(-1)).toBe('23:30')
    expect(AUTO_SHUTDOWN_TIME_OPTIONS).toContain(DEFAULT_AUTO_SHUTDOWN_TIME_RANGE.start)
    expect(AUTO_SHUTDOWN_TIME_OPTIONS).toContain(DEFAULT_AUTO_SHUTDOWN_TIME_RANGE.end)
    // Sorted as strings, which is what lets an off-grid time be spliced in with .sort().
    expect([...AUTO_SHUTDOWN_TIME_OPTIONS].sort()).toEqual([...AUTO_SHUTDOWN_TIME_OPTIONS])
  })

  it('recognizes a pair of times as a window', () => {
    expect(isAutoShutdownTimeRange({ start: '20:00', end: '08:00' })).toBe(true)
    expect(isAutoShutdownTimeRange({ start: '20:00', end: '' })).toBe(false)
    expect(isAutoShutdownTimeRange({ start: '20:00' })).toBe(false)
    expect(isAutoShutdownTimeRange('20:00-08:00')).toBe(false)
    expect(isAutoShutdownTimeRange(null)).toBe(false)
  })
})

// The window people actually want wraps midnight, so that is the case to get right: the
// overnight range is the one the feature was asked for.
describe('isWithinTimeRange', () => {
  const at = (hours: number, minutes = 0): number => hours * 60 + minutes

  it('takes the start and has already closed at the end', () => {
    const range = { start: '08:00', end: '17:00' }
    expect(isWithinTimeRange(range, at(8))).toBe(true)
    expect(isWithinTimeRange(range, at(16, 59))).toBe(true)
    expect(isWithinTimeRange(range, at(17))).toBe(false)
    expect(isWithinTimeRange(range, at(7, 59))).toBe(false)
  })

  it('wraps midnight when the start is later than the end', () => {
    const range = { start: '20:00', end: '08:00' }
    expect(isWithinTimeRange(range, at(20))).toBe(true)
    expect(isWithinTimeRange(range, at(23, 59))).toBe(true)
    expect(isWithinTimeRange(range, at(0))).toBe(true)
    expect(isWithinTimeRange(range, at(7, 59))).toBe(true)
    expect(isWithinTimeRange(range, at(8))).toBe(false)
    expect(isWithinTimeRange(range, at(12))).toBe(false)
    expect(isWithinTimeRange(range, at(19, 59))).toBe(false)
  })

  // Reading equal ends as "all day" would quietly throw away the restriction somebody had
  // just configured and power the machine off at noon — the expensive direction of the two.
  it('holds nothing inside a window whose ends are equal', () => {
    for (const hour of [0, 8, 12, 20, 23]) {
      expect(isWithinTimeRange({ start: '08:00', end: '08:00' }, at(hour))).toBe(false)
    }
  })

  it('refuses a window it cannot read rather than treating it as permission', () => {
    expect(isWithinTimeRange({ start: 'later', end: '08:00' }, at(2))).toBe(false)
    expect(isWithinTimeRange({ start: '20:00', end: '' }, at(2))).toBe(false)
  })
})

describe('isAutoShutdownAllowedAt', () => {
  const nightly = (): AutoShutdownPreference => ({
    ...defaults(),
    enabled: true,
    timeRangeEnabled: true,
    timeRange: { start: '20:00', end: '08:00' }
  })

  it('allows any hour while no restriction is switched on', () => {
    for (const hour of [0, 9, 13, 21]) {
      expect(isAutoShutdownAllowedAt({ ...DEFAULT_AUTO_SHUTDOWN, enabled: true }, new Date(2026, 8, 16, hour))).toBe(true)
    }
  })

  it('allows only the configured window once one is', () => {
    expect(isAutoShutdownAllowedAt(nightly(), new Date(2026, 8, 16, 21, 30))).toBe(true)
    expect(isAutoShutdownAllowedAt(nightly(), new Date(2026, 8, 16, 3, 0))).toBe(true)
    expect(isAutoShutdownAllowedAt(nightly(), new Date(2026, 8, 16, 14, 0))).toBe(false)
    expect(isAutoShutdownAllowedAt(nightly(), new Date(2026, 8, 16, 8, 0))).toBe(false)
  })
})

describe('hasRunningSessions', () => {
  it('counts an agent that is actually working, and one that is still starting', () => {
    expect(hasRunningSessions([session('running')])).toBe(true)
    expect(hasRunningSessions([session('creating')])).toBe(true)
  })

  // The whole point of the judgement: an agent waiting for input reads as Done in the
  // sidebar, and a machine full of Done agents is exactly what should power itself off.
  // Judging by the raw status would keep every session you ever talked to "running" until
  // you stopped it by hand, which puts the shutdown out of reach.
  it('does not count an agent the sidebar shows as Done', () => {
    const idle = session('running')
    expect(hasRunningSessions([idle], done(idle))).toBe(false)
  })

  it('still counts a Done agent alongside one that is working', () => {
    const idle = session('running')
    const busy = { ...session('running', 'codex'), id: 'busy' }
    expect(hasRunningSessions([idle, busy], done(idle))).toBe(true)
  })

  it('counts a live shell, which never reports Done', () => {
    const shell = session('running', 'powershell')
    // Even if something claimed the shell was idle, it holds the shutdown off: a prompt
    // sitting quiet says nothing about whether a build is running behind it.
    expect(hasRunningSessions([shell], done(shell))).toBe(true)
  })

  it('ignores sessions that ended, failed, or were never found', () => {
    expect(hasRunningSessions([session('stopped'), session('error'), session('missing')])).toBe(false)
    expect(hasRunningSessions([])).toBe(false)
  })

  it('treats an unknown idle map as nothing being idle', () => {
    expect(hasRunningSessions([session('running')])).toBe(true)
  })
})

// The countdown is driven by a renderer timer, and a renderer whose window has been hidden
// for minutes is throttled by Chromium to roughly one wake-up a minute. Reading the deadline
// rather than counting ticks is what keeps ten seconds ten seconds.
describe('countdownTick', () => {
  const deadline = 1_000_000

  it('counts the documented ten seconds down from a fresh deadline', () => {
    expect(countdownTick(deadline, deadline - SHUTDOWN_COUNTDOWN_SECONDS * 1_000)).toBe(SHUTDOWN_COUNTDOWN_SECONDS)
  })

  it('rounds the remaining time up to whole seconds', () => {
    expect(countdownTick(deadline, deadline - 10_000)).toBe(10)
    expect(countdownTick(deadline, deadline - 9_500)).toBe(10)
    expect(countdownTick(deadline, deadline - 1_001)).toBe(2)
    expect(countdownTick(deadline, deadline - 1)).toBe(1)
  })

  it('shuts down once the deadline has passed', () => {
    expect(countdownTick(deadline, deadline)).toBe('shutdown')
    expect(countdownTick(deadline, deadline + 1)).toBe('shutdown')
  })

  // The threshold has to clear every throttling delay. With a short one, each once-a-minute
  // tick of an unattended countdown reads as a clock jump, restarts the countdown, and is a
  // minute late again — a machine that never powers off.
  it('does not mistake throttled ticks for a clock jump', () => {
    for (const lateMs of [30_000, 60_000, 120_000, 4 * 60_000]) {
      expect(countdownTick(deadline, deadline + lateMs)).toBe('shutdown')
    }
  })

  it('starts over when the clock really did jump', () => {
    expect(countdownTick(deadline, deadline + 5 * 60_000 + 1)).toBe('restart')
    expect(countdownTick(deadline, deadline + 8 * 60 * 60 * 1_000)).toBe('restart')
  })
})
