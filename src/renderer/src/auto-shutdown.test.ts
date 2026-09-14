import { describe, expect, it } from 'vitest'

import type { SessionRecord } from '../../shared/contracts'
import {
  AUTO_SHUTDOWN_INTERVAL_OPTIONS,
  DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS,
  formatAutoShutdownInterval,
  hasRunningSessions,
  isAutoShutdownInterval,
  parseStoredAutoShutdown
} from './auto-shutdown'

const session = (status: SessionRecord['status']): SessionRecord => ({
  id: `session-${status}`,
  projectId: 'project-1',
  kind: 'claude',
  title: 'Session',
  titleState: 'complete',
  createdAt: '2026-08-20T00:00:00.000Z',
  mode: 'ordinary',
  launchPath: 'C:\\work\\demo-project',
  status
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
  it('counts running and still-starting sessions', () => {
    expect(hasRunningSessions([session('running')])).toBe(true)
    expect(hasRunningSessions([session('creating')])).toBe(true)
  })

  it('ignores sessions that ended, failed, or were never found', () => {
    expect(hasRunningSessions([session('stopped'), session('error'), session('missing')])).toBe(false)
    expect(hasRunningSessions([])).toBe(false)
  })
})
