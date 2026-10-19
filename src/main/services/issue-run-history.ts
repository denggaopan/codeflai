import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { issueRunSchema, type IssueRun } from '../../shared/contracts'

/** Rounds kept per project. Older ones drop off the end: this is a recent-activity log, not an audit trail. */
export const ISSUE_RUN_HISTORY_LIMIT = 50

export type IssueRunStart = Pick<IssueRun, 'sessionId' | 'projectId' | 'agent' | 'startedAt'>
export type IssueRunSettlement = Pick<IssueRun, 'outcome' | 'finishedAt'> & Partial<Pick<IssueRun, 'issue' | 'error'>>

/**
 * The log behind the project menu's issue-automation history. Written by SessionCoordinator at
 * the moments a round's fate is decided (started, claimed, nothing to do, failed to start), and
 * read back per project.
 *
 * Every method resolves and never rejects: a history that cannot be written is a missing line
 * in a list, and must never fail the session operation that tried to note it.
 */
export interface IssueRunHistory {
  /** Newest first. */
  list(projectId: string): Promise<IssueRun[]>
  started(run: IssueRunStart): Promise<void>
  /** Records a round's final outcome. A session id with no started entry is ignored. */
  settle(sessionId: string, settlement: IssueRunSettlement): Promise<void>
}

// Each run is parsed on its own, so a single entry written by a newer build (an outcome this
// one does not know) costs that line rather than the whole history.
const historyFileSchema = z.object({ version: z.literal(1), runs: z.array(z.unknown()) })

const capPerProject = (runs: readonly IssueRun[]): IssueRun[] => {
  const counts = new Map<string, number>()
  return runs.filter((run) => {
    const count = (counts.get(run.projectId) ?? 0) + 1
    counts.set(run.projectId, count)
    return count <= ISSUE_RUN_HISTORY_LIMIT
  })
}

export class FileIssueRunHistory implements IssueRunHistory {
  // Writes are read-modify-write on one file; chaining them keeps two settlements landing in
  // the same tick from overwriting each other.
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async list(projectId: string): Promise<IssueRun[]> {
    await this.queue
    return (await this.read()).filter((run) => run.projectId === projectId)
  }

  started(run: IssueRunStart): Promise<void> {
    return this.mutate((runs) => capPerProject([{ ...run, outcome: 'running' }, ...runs.filter((entry) => entry.sessionId !== run.sessionId)]))
  }

  settle(sessionId: string, settlement: IssueRunSettlement): Promise<void> {
    return this.mutate((runs) =>
      runs.map((run) => {
        if (run.sessionId !== sessionId) return run
        const { issue: _issue, error: _error, ...rest } = run
        return issueRunSchema.parse({
          ...rest,
          ...settlement,
          ...(settlement.error === undefined ? {} : { error: settlement.error.slice(0, 500) })
        })
      })
    )
  }

  private mutate(change: (runs: IssueRun[]) => IssueRun[]): Promise<void> {
    const next = this.queue.then(async () => {
      try {
        const runs = change(await this.read())
        await mkdir(dirname(this.path), { recursive: true })
        const temporary = `${this.path}.tmp`
        await writeFile(temporary, `${JSON.stringify({ version: 1, runs }, null, 2)}\n`, 'utf8')
        await rename(temporary, this.path)
      } catch (error) {
        console.error(`IssueRunHistory: could not update ${this.path}.`, error)
      }
    })
    this.queue = next
    return next
  }

  private async read(): Promise<IssueRun[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`IssueRunHistory: could not read ${this.path}.`, error)
      return []
    }
    try {
      const file = historyFileSchema.parse(JSON.parse(text))
      return file.runs.flatMap((entry) => {
        const parsed = issueRunSchema.safeParse(entry)
        return parsed.success ? [parsed.data] : []
      })
    } catch (error) {
      console.error(`IssueRunHistory: ignoring unreadable ${this.path}.`, error)
      return []
    }
  }
}

/** The coordinator's default when no history was injected (tests that do not care about it). */
export const noIssueRunHistory: IssueRunHistory = {
  list: async () => [],
  started: async () => undefined,
  settle: async () => undefined
}
