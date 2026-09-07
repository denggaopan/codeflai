import { describe, expect, it, vi } from 'vitest'
import { attachSessions, type TerminalImplementation } from './session-attachment'
import type { PtyHostConnectResult } from './pty-host-client'

const harness = (result: PtyHostConnectResult) => {
  const fallback: TerminalImplementation = {
    start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), stopAll: vi.fn(async () => undefined),
    on: () => () => undefined, write: () => undefined, resize: () => undefined, isRunning: () => false
  }
  const client = { ...fallback, connect: async () => result }
  const terminal = { bind: vi.fn() }
  const coordinator = { reconcile: vi.fn(async () => undefined) }
  return { fallback, client, terminal, coordinator }
}

describe('terminal attachment safety', () => {
  it('rejects an ambiguous live host without exposing fallback restores or changing saved session status', async () => {
    const options = harness({ status: 'incompatible', hostProtocolVersion: 0, message: 'Legacy host did not answer' })
    await expect(attachSessions(options)).rejects.toThrow('Legacy host did not answer')
    expect(options.terminal.bind).not.toHaveBeenCalled()
    expect(options.coordinator.reconcile).not.toHaveBeenCalled()
    expect(options.fallback.start).not.toHaveBeenCalled()
  })

  it('allows fallback only after discovery has established that no host exists', async () => {
    const options = harness({ status: 'unavailable', message: 'Could not spawn' })
    await attachSessions(options)
    expect(options.terminal.bind).toHaveBeenCalledWith(options.fallback)
    expect(options.coordinator.reconcile).toHaveBeenCalledWith(new Set(), { autoResume: true })
  })

  it('reconciles against the sessions held by the connected host', async () => {
    const options = harness({ status: 'connected', hostAppVersion: '0.19.0', hostPid: 42, sessions: [{
      sessionId: 'saved', kind: 'claude', launchPath: 'C:\\project', cols: 80, rows: 24, startedAt: '2026-09-07T00:00:00.000Z'
    }] })
    const onHostAttached = vi.fn()
    await attachSessions({ ...options, onHostAttached })
    expect(options.terminal.bind).toHaveBeenCalledWith(options.client)
    expect(options.coordinator.reconcile).toHaveBeenCalledWith(new Set(['saved']), { autoResume: true })
    expect(onHostAttached).toHaveBeenCalledWith(42)
  })
})
