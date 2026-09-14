import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { useTranslation } from '../i18n/use-translation'
import { useAppStore } from '../store/use-app-store'

/**
 * The last thing standing between an idle machine and a forced shutdown: auto shutdown found
 * no running session, and this counts down from ten before powering the host off.
 *
 * Unlike UpdateDialog, doing nothing here is not the safe option — it is the one that shuts
 * the machine down — so every dismissal gesture means *cancel*: Escape and a backdrop click
 * both stop the shutdown, exactly as the Cancel button does. A stray click that accidentally
 * saves a machine is a far cheaper mistake than one that powers it off.
 *
 * Renders nothing while no countdown is running (`shutdownCountdown` is null).
 */
export default function ShutdownCountdownDialog() {
  const { t } = useTranslation()
  const secondsLeft = useAppStore((state) => state.shutdownCountdown)
  const cancelAutoShutdown = useAppStore((state) => state.cancelAutoShutdown)
  const shutdownNow = useAppStore((state) => state.shutdownNow)

  useEffect(() => {
    if (secondsLeft === null) return undefined

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelAutoShutdown()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [secondsLeft, cancelAutoShutdown])

  if (secondsLeft === null) return null

  return createPortal(
    <div className="confirm-dialog-backdrop shutdown-dialog-backdrop" onClick={cancelAutoShutdown}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="shutdown-dialog-title"
        aria-describedby="shutdown-dialog-description"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="shutdown-dialog-title" className="confirm-dialog-title">
          {t('shutdown.title')}
        </h2>
        {/* aria-live so a screen reader announces the seconds ticking away rather than only
            the opening frame — the number is the whole content of this dialog. */}
        <p id="shutdown-dialog-description" className="confirm-dialog-description" aria-live="polite">
          {t('shutdown.countdown', { seconds: secondsLeft })}
        </p>
        <div className="confirm-dialog-actions">
          {/* Cancel takes initial focus: a stray Enter must never be what powers the machine
              off, the same rule ConfirmDialog follows for destructive confirmations. */}
          <button type="button" className="confirm-dialog-cancel" onClick={cancelAutoShutdown} autoFocus>
            {t('shutdown.cancel')}
          </button>
          <button
            type="button"
            className="confirm-dialog-confirm confirm-dialog-confirm--destructive"
            onClick={() => void shutdownNow()}
          >
            {t('shutdown.now')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
