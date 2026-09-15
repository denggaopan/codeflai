import { describe, expect, it } from 'vitest'

import type { SessionRecord } from '../../shared/contracts'
import {
  AUTO_SHUTDOWN_INTERVAL_OPTIONS,
  DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS,
  SHUTDOWN_COUNTDOWN_SECONDS,
  countdownTick,
  formatAutoShutdownInterval,
  hasRunningSessions,
  isAutoShutdownInterval,
  parseStoredAutoShutdown
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
    expect(parseStoredAutoShutdown(JSON.stringify({ enabled: true, intervalMs: 900_000 }))).toEqual({
      enabled: true,
      intervalMs: 900_000
    })
  })

  it('falls back to the defaults for a missing, unreadable, or non-object value', () => {
    for (const stored of [null, 'not json', '"string"', '42']) {
      expect(parseStoredAutoShutdown(stored)).toEqual({ enabled: false, intervalMs: DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS })
    }
  })

  it('keeps a readable half of the preference and defaults the rest', () => {
    expect(parseStoredAutoShutdown(JSON.stringify({ enabled: true }))).toEqual({
      enabled: true,
      intervalMs: DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS
    })
    expect(parseStoredAutoShutdown(JSON.stringify({ intervalMs: 120_000 }))).toEqual({
      enabled: false,
      intervalMs: 120_000
    })
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
