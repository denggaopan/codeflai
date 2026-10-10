import type { AppState } from '../../shared/contracts'
import type { IssueOutcomeResult } from './session-coordinator'

/** The slice of SessionCoordinator the watcher needs: state to read, and one action to ask for. */
export interface IssueOutcomeSource {
  onStateChanged(listener: (state: AppState) => void): () => void
  snapshot(): Promise<AppState>
  consumeIssueOutcome(sessionId: string): Promise<IssueOutcomeResult>
}

/** One read per watched session per tick: cheap enough that a short interval costs nothing. */
export const ISSUE_OUTCOME_POLL_MS = 3_000

/** Consecutive unreadable results before a session is given up on, so a torn write survives. */
export const ISSUE_OUTCOME_INVALID_LIMIT = 3

/**
 * Polls the result files of automatic issue sessions while they run, so a claimed issue
 * renames the session the moment the agent reports it and a "no issue" round disappears
 * without waiting for an exit that an interactive agent may never produce (Claude Code
 * cannot end its own session; most rounds finish idle, not exited).
 *
 * Nothing is tracked explicitly: the set to watch is derived from every state broadcast —
 * automatic sessions that are alive and have no issue on record — so the coordinator never
 * has to know this class exists. Sessions the coordinator reports as kept, or whose file
 * keeps failing to parse, go onto an ignore list that is pruned as they leave the state.
 */
export class IssueOutcomeWatcher {
  private tracked = new Set<string>()
  private readonly ignored = new Set<string>()
  private readonly invalidCounts = new Map<string, number>()
  private timer: ReturnType<typeof setInterval> | undefined
  private ticking = false
  private unsubscribe: (() => void) | undefined

  constructor(
    private readonly source: IssueOutcomeSource,
    private readonly intervalMs = ISSUE_OUTCOME_POLL_MS
  ) {}

  async start(): Promise<void> {
    this.unsubscribe = this.source.onStateChanged((state) => this.track(state))
    this.track(await this.source.snapshot())
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.stopTimer()
    this.tracked.clear()
  }

  private track(state: AppState): void {
    const alive = new Set(state.sessions.map((session) => session.id))
    for (const id of this.ignored) if (!alive.has(id)) this.ignored.delete(id)
    for (const id of this.invalidCounts.keys()) if (!alive.has(id)) this.invalidCounts.delete(id)

    this.tracked = new Set(
      state.sessions
        .filter(
          (session) =>
            session.automation === 'issue' &&
            session.issue === undefined &&
            (session.status === 'running' || session.status === 'creating') &&
            !this.ignored.has(session.id)
        )
        .map((session) => session.id)
    )

    if (this.tracked.size === 0) this.stopTimer()
    else if (this.timer === undefined) this.timer = setInterval(() => void this.tick(), this.intervalMs)
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  private async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const sessionId of [...this.tracked]) {
        try {
          this.note(sessionId, await this.source.consumeIssueOutcome(sessionId))
        } catch (error) {
          console.error(`IssueOutcomeWatcher: could not read the result of session ${sessionId}.`, error)
        }
      }
    } finally {
      this.ticking = false
    }
  }

  private note(sessionId: string, result: IssueOutcomeResult): void {
    switch (result) {
      case 'invalid': {
        const count = (this.invalidCounts.get(sessionId) ?? 0) + 1
        this.invalidCounts.set(sessionId, count)
        if (count >= ISSUE_OUTCOME_INVALID_LIMIT) {
          console.warn(`IssueOutcomeWatcher: giving up on session ${sessionId}, its result file never parsed.`)
          this.ignore(sessionId)
        }
        return
      }
      case 'kept':
        this.ignore(sessionId)
        return
      case 'pending':
        this.invalidCounts.delete(sessionId)
        return
      default:
        // 'deleted' and 'claimed' change the state, and the broadcast re-derives the set.
        return
    }
  }

  private ignore(sessionId: string): void {
    this.ignored.add(sessionId)
    this.invalidCounts.delete(sessionId)
    this.tracked.delete(sessionId)
    if (this.tracked.size === 0) this.stopTimer()
  }
}
