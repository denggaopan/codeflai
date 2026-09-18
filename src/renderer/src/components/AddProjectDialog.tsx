import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { CloneProgress } from '../../../shared/contracts'

import { cloneDirectoryName } from '../../../shared/git-clone'
import { normalizeProjectPath } from '../../../shared/project-path'
import closeIconUrl from '../assets/close.svg'
import removeIconUrl from '../assets/remove.svg'
import { useTranslation } from '../i18n/use-translation'
import { useAppStore } from '../store/use-app-store'

type Mode = 'folder' | 'recent' | 'clone'

export default function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const appState = useAppStore((state) => state.appState)
  const platform = useAppStore((state) => state.platform)
  const addProject = useAppStore((state) => state.addProject)
  const removeRecentProject = useAppStore((state) => state.removeRecentProject)
  const [mode, setMode] = useState<Mode>('folder')
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [targetDirectory, setTargetDirectory] = useState('')
  const [busy, setBusy] = useState<Mode | 'directory' | 'remove' | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  // Set by the Cancel button so the rejection it provokes is not reported back as a failure.
  const cancelled = useRef(false)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.getElementById('root')
    const wasInert = root?.inert ?? false
    if (root) root.inert = true
    panel.current?.querySelector<HTMLButtonElement>('[data-mode]')?.focus()
    return () => {
      if (root) root.inert = wasInert
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  useEffect(() => {
    if (busy) panel.current?.focus()
  }, [busy])

  useEffect(() => window.codeflai.onCloneProgress((next) => {
    // Git restarts the percentage at 0% for every phase and omits it entirely on
    // announcements and summaries. Carrying the previous value forward keeps the bar from
    // dropping to zero on a line that simply has nothing to say about progress.
    setProgress((current) => ({ line: next.line, ...(next.percent === undefined ? current?.percent === undefined ? {} : { percent: current.percent } : { percent: next.percent }) }))
  }), [])

  const recentProjects = (appState.recentProjects ?? []).filter((recent) => !appState.projects.some((project) =>
    project.id === recent.id || normalizeProjectPath(project.path, platform) === normalizeProjectPath(recent.path, platform)))
  const directoryName = cloneDirectoryName(repositoryUrl)
  const destination = targetDirectory && directoryName
    ? `${targetDirectory.replace(/[\\/]+$/u, '')}${platform === 'win32' ? '\\' : '/'}${directoryName}`
    : null

  const run = async (operation: () => Promise<boolean>, activity: typeof busy): Promise<void> => {
    if (pending.current) return
    pending.current = true
    cancelled.current = false
    setBusy(activity)
    setError(null)
    try {
      if (await operation()) onClose()
    } catch (failure) {
      // A cancelled clone always rejects -- that is the requested outcome, not an error.
      if (!cancelled.current) {
        setError(t(activity === 'remove' ? 'addProject.removeFailed' : 'addProject.failed', {
          reason: failure instanceof Error ? failure.message : t('notice.genericError')
        }))
      }
    } finally {
      pending.current = false
      cancelled.current = false
      setBusy(null)
      setCancelling(false)
      // A retry must not open on the previous attempt's last line.
      setProgress(null)
    }
  }

  const close = (): void => {
    if (!pending.current) onClose()
  }

  /**
   * Asks the main process to end the clone. The dialog stays open and busy until the clone's
   * own rejection lands, which is what releases the form.
   */
  const cancelClone = async (): Promise<void> => {
    cancelled.current = true
    setCancelling(true)
    try {
      await window.codeflai.cancelProjectClone()
    } catch {
      // Nothing was cancelled, so undo the suppression: the clone is still running and its
      // eventual failure is a real one the user needs to see.
      cancelled.current = false
      setCancelling(false)
    }
  }

  return createPortal(
    <div className="settings-dialog-backdrop" onClick={close}>
      <div
        ref={panel}
        className="settings-dialog add-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
          if (event.key !== 'Tab') return
          const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])
          const first = focusable[0]
          const last = focusable.at(-1)
          if (!first || !last) {
            event.preventDefault()
            panel.current?.focus()
          } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className="settings-dialog-header">
          <h2 id="add-project-title" className="settings-dialog-title">{t('sidebar.addProject')}</h2>
          <button type="button" className="settings-dialog-close" aria-label={t('addProject.close')} disabled={busy !== null} onClick={close}>
            <img src={closeIconUrl} alt="" width={14} height={14} className="icon-mono" />
          </button>
        </div>
        <div className="add-project-modes" role="group" aria-label={t('addProject.source')}>
          {(['folder', 'recent', 'clone'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              data-mode={entry}
              aria-pressed={mode === entry}
              disabled={busy !== null}
              onClick={() => { setMode(entry); setError(null) }}
            >
              {t(`addProject.${entry}`)}
            </button>
          ))}
        </div>

        {mode === 'folder' && (
          <div className="add-project-section">
            <p className="add-project-hint">{t('addProject.folderHint')}</p>
            <button type="button" className="add-project-primary" disabled={busy !== null} onClick={() => void run(() => addProject(), 'folder')}>
              {t('addProject.chooseFolder')}
            </button>
          </div>
        )}

        {mode === 'recent' && (
          <div className="add-project-section">
            <p className="add-project-hint">{t('addProject.recentHint')}</p>
            {recentProjects.length === 0 ? <p className="add-project-empty">{t('addProject.noRecent')}</p> : (
              <ul className="add-project-recent-list">
                {recentProjects.map((project) => (
                  <li key={project.id}>
                    <button type="button" className="add-project-recent-open" disabled={busy !== null} onClick={() => void run(() => addProject({ recentProjectId: project.id }), 'recent')}>
                      <span>{project.name}</span>
                      <span className="add-project-path" title={project.path}>{project.path}</span>
                    </button>
                    <button
                      type="button"
                      className="add-project-recent-remove"
                      aria-label={t('addProject.removeRecent', { name: project.name })}
                      title={t('addProject.removeRecent', { name: project.name })}
                      disabled={busy !== null}
                      onClick={() => void run(async () => {
                        await removeRecentProject(project.id)
                        return false
                      }, 'remove')}
                    >
                      <img src={removeIconUrl} alt="" width={16} height={16} className="icon-mono" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode === 'clone' && (
          <form className="add-project-section" onSubmit={(event) => {
            event.preventDefault()
            if (directoryName && targetDirectory) void run(() => addProject({ repositoryUrl: repositoryUrl.trim(), targetDirectory }), 'clone')
          }}>
            <label className="add-project-field" htmlFor="clone-repository-url">
              {t('addProject.repositoryUrl')}
              <input
                id="clone-repository-url"
                value={repositoryUrl}
                onChange={(event) => setRepositoryUrl(event.target.value)}
                placeholder="https://github.com/owner/repository.git"
                disabled={busy !== null}
                required
                maxLength={4096}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!repositoryUrl.trim() && !directoryName}
                aria-describedby="clone-url-hint"
              />
            </label>
            <p id="clone-url-hint" className="add-project-hint">
              {t(repositoryUrl.trim() && !directoryName ? 'addProject.invalidUrl' : 'addProject.urlHint')}
            </p>
            <label className="add-project-field" htmlFor="clone-target-directory">
              {t('addProject.targetDirectory')}
            </label>
            <div className="add-project-directory">
              <input id="clone-target-directory" value={targetDirectory} readOnly placeholder={t('addProject.directoryPlaceholder')} title={targetDirectory} />
              <button type="button" className="settings-update-button" disabled={busy !== null} onClick={() => void run(async () => {
                const selected = await window.codeflai.selectCloneDirectory()
                if (selected) setTargetDirectory(selected)
                return false
              }, 'directory')}>
                {t('addProject.browse')}
              </button>
            </div>
            <p className="add-project-hint">{t('addProject.cloneHint')}</p>
            {destination && <p className="add-project-destination">{t('addProject.destination', { path: destination })}</p>}
            <button type="submit" className="add-project-primary" disabled={busy !== null || !directoryName || !targetDirectory}>
              {t('addProject.cloneAction')}
            </button>
          </form>
        )}

        {busy && (
          <div className="add-project-activity">
            <p id="add-project-activity-label" role="status" className="add-project-progress">{t(busy === 'clone' ? 'addProject.cloning' : busy === 'remove' ? 'addProject.removing' : 'addProject.opening')}</p>
            {busy === 'clone' && (
              <button type="button" className="settings-update-button add-project-cancel" disabled={cancelling} onClick={() => void cancelClone()}>
                {t('addProject.cancelClone')}
              </button>
            )}
          </div>
        )}
        {busy === 'clone' && progress && (
          <>
            {/* Labelled by the status line above rather than a string of its own: Git's text is
                English and the localized "Cloning repository..." already names the activity. */}
            <div
              className={progress.percent === undefined ? 'progress-track add-project-progress-track progress-track--indeterminate' : 'progress-track add-project-progress-track'}
              role="progressbar"
              aria-labelledby="add-project-activity-label"
              aria-valuemin={0}
              aria-valuemax={progress.percent === undefined ? undefined : 100}
              aria-valuenow={progress.percent}
            >
              <div className="progress-fill" style={progress.percent === undefined ? undefined : { width: `${progress.percent}%` }} />
            </div>
            <p className="add-project-git-progress">{progress.line}</p>
          </>
        )}
        {error && <p role="alert" className="settings-dialog-error add-project-error">{error}</p>}
      </div>
    </div>,
    document.body
  )
}
