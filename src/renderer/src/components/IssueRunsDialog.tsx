import { useEffect, useState } from 'react'

import type { IssueRun, ProjectRecord } from '../../../shared/contracts'
import { formatIssueAutomationTime } from '../../../shared/issue-automation'
import type { Translator } from '../i18n'
import { useTranslation } from '../i18n/use-translation'
import { sessionKindLabelKey } from '../session-kind-options'
import { useAppStore } from '../store/use-app-store'

type IssueRunsDialogProps = {
  /** The project whose rounds to list; null renders nothing. */
  project: ProjectRecord | null
  onClose: () => void
}

type Loaded = { status: 'loading' } | { status: 'ready'; runs: IssueRun[] } | { status: 'error'; message: string }

/**
 * What became of a round, in one line. A round still marked running whose session is gone
 * ended without ever reporting (stopped and deleted by hand, or its result file never parsed),
 * and saying "running" about it would be a lie the list tells forever.
 */
export const describeIssueRun = (run: IssueRun, sessionAlive: boolean, t: Translator): string => {
  switch (run.outcome) {
    case 'running':
      return sessionAlive ? t('issueHistory.running') : t('issueHistory.ended')
    case 'claimed':
      return run.issue ? t('issueHistory.claimed', { number: run.issue.number, title: run.issue.title }) : t('issueHistory.running')
    case 'none':
      return t('issueHistory.none')
    case 'kept':
      return t('issueHistory.kept')
    case 'failed':
      return t('issueHistory.failed', { reason: run.error ?? t('notice.genericError') })
  }
}

/**
 * The project menu's record of automatic issue rounds. Read from the main process on open and
 * again on every state broadcast while open, because the rounds it lists are settled by the
 * same writes that change the sidebar: a claim renames a row, a "no issue" round deletes one.
 */
export default function IssueRunsDialog({ project, onClose }: IssueRunsDialogProps) {
  const { t } = useTranslation()
  const appState = useAppStore((state) => state.appState)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const projectId = project?.id ?? null

  useEffect(() => {
    if (projectId === null) return undefined
    setLoaded({ status: 'loading' })
    return undefined
  }, [projectId])

  useEffect(() => {
    if (projectId === null) return undefined
    let cancelled = false
    void window.codeflai
      .getIssueRuns(projectId)
      .then((runs) => {
        if (!cancelled) setLoaded({ status: 'ready', runs })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoaded({ status: 'error', message: error instanceof Error ? error.message : t('notice.genericError') })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, appState, t])

  useEffect(() => {
    if (projectId === null) return undefined
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [projectId, onClose])

  if (!project) return null

  const aliveSessionIds = new Set(appState.sessions.map((session) => session.id))

  return (
    <div className="confirm-dialog-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog issue-runs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-runs-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="issue-runs-dialog-title" className="confirm-dialog-title">
          {t('issueHistory.title', { project: project.name })}
        </h2>

        {loaded.status === 'loading' && <p className="confirm-dialog-description">{t('issueHistory.loading')}</p>}
        {loaded.status === 'error' && (
          <p className="confirm-dialog-description" role="alert">
            {t('issueHistory.loadFailed', { reason: loaded.message })}
          </p>
        )}
        {loaded.status === 'ready' && loaded.runs.length === 0 && (
          <p className="confirm-dialog-description">{t('issueHistory.empty')}</p>
        )}
        {loaded.status === 'ready' && loaded.runs.length > 0 && (
          <ul className="issue-runs-list" aria-labelledby="issue-runs-dialog-title">
            {loaded.runs.map((run) => (
              <li key={run.sessionId} className="issue-runs-item" data-outcome={run.outcome}>
                <span className="issue-runs-meta">
                  <time dateTime={run.startedAt}>{formatIssueAutomationTime(new Date(run.startedAt))}</time>
                  <span>{t(sessionKindLabelKey(run.agent))}</span>
                </span>
                <span className="issue-runs-outcome">{describeIssueRun(run, aliveSessionIds.has(run.sessionId), t)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-dialog-cancel" onClick={onClose} autoFocus>
            {t('issueHistory.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
