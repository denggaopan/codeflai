import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppState, SessionRecord } from '../../shared/contracts'
import { ISSUE_OUTCOME_INVALID_LIMIT, ISSUE_OUTCOME_POLL_MS, IssueOutcomeWatcher, type IssueOutcomeSource } from './issue-outcome-watcher'
import type { IssueOutcomeResult } from './session-coordinator'

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord =>
  ({
    id: 'session-1',
    projectId: 'project-1',
    kind: 'claude',
    title: 'Auto issue 10-09 14:30',
    titleState: 'complete',
    titleManuallySet: true,
    createdAt: '2026-10-09T06:30:00.000Z',
    mode: 'worktree',
    worktreeName: 'w',
    worktreePath: 'p',
    branchName: 'w',
    launchPath: 'p',
    status: 'running',
    automation: 'issue',
    ...overrides
  }) as SessionRecord

const stateWith = (...sessions: SessionRecord[]): AppState => ({ version: 1, projects: [], sessions })

/** A coordinator stand-in: the watcher only ever reads state from it and asks it to consume. */
class FakeSource implements IssueOutcomeSource {
  private readonly listeners = new Set<(state: AppState) => void>()
  state: AppState = stateWith()
  readonly consumeIssueOutcome = vi.fn(async (_sessionId: string): Promise<IssueOutcomeResult> => 'pending')

  onStateChanged(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async snapshot(): Promise<AppState> {
    return this.state
  }

  emit(state: AppState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
}

const tick = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ISSUE_OUTCOME_POLL_MS)
}

describe('IssueOutcomeWatcher', () => {
  let source: FakeSource
  let watcher: IssueOutcomeWatcher

  beforeEach(() => {
    vi.useFakeTimers()
    source = new FakeSource()
    watcher = new IssueOutcomeWatcher(source)
  })

  afterEach(() => {
    watcher.dispose()
    vi.useRealTimers()
  })

  it('polls only running automatic sessions that have not reported an issue yet', async () => {
    source.state = stateWith(
      session({ id: 'watch-running' }),
      session({ id: 'watch-creating', status: 'creating' }),
      session({ id: 'claimed', issue: { number: 1, title: 'Done' } }),
      session({ id: 'stopped', status: 'stopped' }),
      session({ id: 'manual', automation: undefined })
    )
    await watcher.start()

    await tick()

    expect(source.consumeIssueOutcome.mock.calls.map(([id]) => id).sort()).toEqual(['watch-creating', 'watch-running'])
  })

  it('does not poll at all while there is nothing to watch', async () => {
    await watcher.start()

    await tick()
    await tick()

    expect(source.consumeIssueOutcome).not.toHaveBeenCalled()
  })

  it('starts polling when a state change brings an automatic session, a full interval later', async () => {
    await watcher.start()

    source.emit(stateWith(session()))
    await vi.advanceTimersByTimeAsync(ISSUE_OUTCOME_POLL_MS - 1)
    expect(source.consumeIssueOutcome).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(source.consumeIssueOutcome).toHaveBeenCalledWith('session-1')
  })

  it('stops polling a session once the state shows it claimed or gone', async () => {
    source.state = stateWith(session({ id: 'a' }), session({ id: 'b' }))
    await watcher.start()
    await tick()
    expect(source.consumeIssueOutcome).toHaveBeenCalledTimes(2)

    source.emit(stateWith(session({ id: 'a', issue: { number: 3, title: 'Fix' } })))
    await tick()

    expect(source.consumeIssueOutcome).toHaveBeenCalledTimes(2)
  })

  it('keeps polling through pending results', async () => {
    source.state = stateWith(session())
    await watcher.start()

    await tick()
    await tick()
    await tick()

    expect(source.consumeIssueOutcome).toHaveBeenCalledTimes(3)
  })

  it('stops asking about a session the coordinator kept', async () => {
    source.state = stateWith(session())
    source.consumeIssueOutcome.mockResolvedValue('kept')
    await watcher.start()

    await tick()
    await tick()

    expect(source.consumeIssueOutcome).toHaveBeenCalledTimes(1)
  })

  // A half-written file reads as invalid for a tick or two; a file that never parses is noise.
  it('gives up on a session after repeated unreadable results and says so', async () => {
    source.state = stateWith(session())
    source.consumeIssueOutcome.mockResolvedValue('invalid')
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await watcher.start()

    for (let i = 0; i < ISSUE_OUTCOME_INVALID_LIMIT + 2; i += 1) await tick()

    expect(source.consumeIssueOutcome).toHaveBeenCalledTimes(ISSUE_OUTCOME_INVALID_LIMIT)
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('session-1'))
    consoleWarn.mockRestore()
  })

  it('resets the unreadable count once a result reads as pending again', async () => {
    source.state = stateWith(session())
    source.consumeIssueOutcome
      .mockResolvedValueOnce('invalid')
      .mockResolvedValueOnce('invalid')
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('invalid')
      .mockResolvedValueOnce('invalid')
    await watcher.start()

    for (let i = 0; i < 6; i += 1) await tick()

    expect(source.consumeIssueOutcome).toHaveBeenCalledTimes(6)
  })

  it('never overlaps a tick with one still running', async () => {
    source.state = stateWith(session())
    let release: (() => void) | undefined
    source.consumeIssueOutcome.mockImplementationOnce(
      () =>
        new Promise<IssueOutcomeResult>((resolve) => {
          release = () => resolve('pending')
        })
    )
    await watcher.start()

    await tick()
    await tick()
    expect(source.consumeIssueOutcome).toHaveBeenCalledTimes(1)

    release!()
    await tick()
    expect(source.consumeIssueOutcome).toHaveBeenCalledTimes(2)
  })

  it('logs and carries on when consuming rejects', async () => {
    source.state = stateWith(session())
    source.consumeIssueOutcome.mockRejectedValueOnce(new Error('disk gone'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await watcher.start()

    await tick()
    await tick()

    expect(source.consumeIssueOutcome).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('session-1'), expect.any(Error))
    consoleError.mockRestore()
  })

  it('stops the timer and the subscription on dispose', async () => {
    source.state = stateWith(session())
    await watcher.start()

    watcher.dispose()
    source.emit(stateWith(session({ id: 'later' })))
    await tick()

    expect(source.consumeIssueOutcome).not.toHaveBeenCalled()
  })
})
