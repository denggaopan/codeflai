import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FileIssueRunHistory, ISSUE_RUN_HISTORY_LIMIT, type IssueRunStart } from './issue-run-history'

const created: string[] = []

const historyPath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'codeflai-issue-runs-'))
  created.push(directory)
  // A subdirectory that does not exist yet: the first write has to create it.
  return join(directory, 'issue-automation', 'history.json')
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true })
})

const start = (overrides: Partial<IssueRunStart> = {}): IssueRunStart => ({
  sessionId: 'session-1',
  projectId: 'project-1',
  agent: 'claude',
  startedAt: '2026-10-19T08:00:00.000Z',
  ...overrides
})

describe('FileIssueRunHistory', () => {
  it('lists nothing before anything was written', async () => {
    const history = new FileIssueRunHistory(await historyPath())

    await expect(history.list('project-1')).resolves.toEqual([])
  })

  it('records a started round as running and lists it for its project only, newest first', async () => {
    const history = new FileIssueRunHistory(await historyPath())

    await history.started(start())
    await history.started(start({ sessionId: 'session-2', startedAt: '2026-10-19T09:00:00.000Z' }))
    await history.started(start({ sessionId: 'session-3', projectId: 'project-2' }))

    const runs = await history.list('project-1')
    expect(runs.map((run) => run.sessionId)).toEqual(['session-2', 'session-1'])
    expect(runs[0]).toMatchObject({ outcome: 'running', agent: 'claude' })
  })

  it('settles a round with its outcome, issue and finish time', async () => {
    const history = new FileIssueRunHistory(await historyPath())
    await history.started(start())

    await history.settle('session-1', {
      outcome: 'claimed',
      finishedAt: '2026-10-19T08:05:00.000Z',
      issue: { number: 42, title: 'Fix login crash' }
    })

    expect(await history.list('project-1')).toEqual([
      {
        sessionId: 'session-1',
        projectId: 'project-1',
        agent: 'claude',
        startedAt: '2026-10-19T08:00:00.000Z',
        finishedAt: '2026-10-19T08:05:00.000Z',
        outcome: 'claimed',
        issue: { number: 42, title: 'Fix login crash' }
      }
    ])
  })

  it('ignores a settlement for a session it never saw start', async () => {
    const history = new FileIssueRunHistory(await historyPath())
    await history.started(start())

    await history.settle('session-9', { outcome: 'none', finishedAt: '2026-10-19T08:05:00.000Z' })

    expect((await history.list('project-1'))[0]).toMatchObject({ sessionId: 'session-1', outcome: 'running' })
  })

  it('caps the error text so a long failure cannot bloat the file', async () => {
    const history = new FileIssueRunHistory(await historyPath())
    await history.started(start())

    await history.settle('session-1', { outcome: 'failed', finishedAt: '2026-10-19T08:00:01.000Z', error: 'x'.repeat(2_000) })

    expect((await history.list('project-1'))[0]?.error).toHaveLength(500)
  })

  it(`keeps the newest ${ISSUE_RUN_HISTORY_LIMIT} rounds per project, leaving other projects alone`, async () => {
    const history = new FileIssueRunHistory(await historyPath())
    await history.started(start({ sessionId: 'other', projectId: 'project-2' }))
    for (let index = 0; index <= ISSUE_RUN_HISTORY_LIMIT; index += 1) {
      await history.started(start({ sessionId: `session-${index}` }))
    }

    const runs = await history.list('project-1')
    expect(runs).toHaveLength(ISSUE_RUN_HISTORY_LIMIT)
    expect(runs[0]?.sessionId).toBe(`session-${ISSUE_RUN_HISTORY_LIMIT}`)
    expect(runs.some((run) => run.sessionId === 'session-0')).toBe(false)
    expect(await history.list('project-2')).toHaveLength(1)
  })

  // Two settlements in the same tick are each a read-modify-write of the whole file.
  it('does not lose a write when two land at once', async () => {
    const history = new FileIssueRunHistory(await historyPath())
    await history.started(start())
    await history.started(start({ sessionId: 'session-2' }))

    await Promise.all([
      history.settle('session-1', { outcome: 'none', finishedAt: '2026-10-19T08:05:00.000Z' }),
      history.settle('session-2', { outcome: 'kept', finishedAt: '2026-10-19T08:05:00.000Z' })
    ])

    const outcomes = Object.fromEntries((await history.list('project-1')).map((run) => [run.sessionId, run.outcome]))
    expect(outcomes).toEqual({ 'session-1': 'none', 'session-2': 'kept' })
  })

  it('drops only the entries it cannot read, such as one written by a newer build', async () => {
    const path = await historyPath()
    const history = new FileIssueRunHistory(path)
    await history.started(start())
    const file = JSON.parse(await readFile(path, 'utf8')) as { runs: unknown[] }
    file.runs.push({ ...(file.runs[0] as object), sessionId: 'future', outcome: 'abandoned' })
    await writeFile(path, JSON.stringify(file), 'utf8')

    expect((await history.list('project-1')).map((run) => run.sessionId)).toEqual(['session-1'])
  })

  it('starts over from an unreadable file instead of rejecting', async () => {
    const path = await historyPath()
    const history = new FileIssueRunHistory(path)
    await history.started(start())
    await writeFile(path, '{ not json', 'utf8')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(history.list('project-1')).resolves.toEqual([])
    await history.started(start({ sessionId: 'session-2' }))
    expect((await history.list('project-1')).map((run) => run.sessionId)).toEqual(['session-2'])
  })
})
