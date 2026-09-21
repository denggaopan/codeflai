import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useTranslation } from '../i18n/use-translation'
import { useAppStore, type Notice } from '../store/use-app-store'

/**
 * How long a notice stays on screen before it dismisses itself, per tone. Errors get longer
 * than confirmations because they are the ones worth reading: "Worktree has 7 changed files…"
 * is a sentence with an instruction in it, while "Project path copied: …" only has to be seen.
 * Exported so the tests state the same numbers the component uses instead of hard-coding them.
 */
export const NOTICE_TIMEOUT_MS: Record<Notice['tone'], number> = {
  error: 7000,
  info: 4000
}

/**
 * The app's single notice surface: a floating toast over the whole window, not a strip wedged
 * into the sidebar. It portals to document.body and sits above every dialog, so a failure
 * raised *by* a dialog (a delete that a dirty worktree refuses) is still readable, and it
 * costs the sidebar no layout — the old strip pushed the project list down every time it
 * appeared.
 *
 * It dismisses itself: the store holds one notice at a time, and this component owns the timer
 * that clears it. The timer restarts whenever the notice object changes identity, which the
 * store guarantees for every `set` — so the same message raised twice in a row gets its full
 * few seconds the second time too, rather than inheriting whatever was left of the first.
 *
 * Pointer or keyboard focus pauses the countdown (and restarts it on the way out): the longest
 * notices are the ones carrying a path the user is about to read, and a toast that vanishes
 * mid-read is worse than no toast. The × stays for dismissing one early.
 *
 * Renders nothing while there is no notice.
 */
export default function NoticeToast() {
  const { t } = useTranslation()
  const notice = useAppStore((state) => state.notice)
  const dismissNotice = useAppStore((state) => state.dismissNotice)
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!notice || held) return undefined

    const timer = window.setTimeout(dismissNotice, NOTICE_TIMEOUT_MS[notice.tone])
    return () => {
      window.clearTimeout(timer)
    }
  }, [notice, held, dismissNotice])

  // A toast that is gone has nothing to hold: drop the hold so the next notice starts counting
  // down immediately, even if the pointer never left where the previous one stood.
  useEffect(() => {
    if (!notice) setHeld(false)
  }, [notice])

  if (!notice) return null

  return createPortal(
    <div className="notice-toast-layer">
      <div
        className="notice-toast"
        data-tone={notice.tone}
        role="alert"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        <span>{notice.message}</span>
        <button type="button" aria-label={t('notice.dismiss')} onClick={dismissNotice}>
          ×
        </button>
      </div>
    </div>,
    document.body
  )
}
