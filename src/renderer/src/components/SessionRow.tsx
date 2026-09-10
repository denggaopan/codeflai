import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { SessionRecord } from '../../../shared/contracts'
import optionsIconUrl from '../assets/options.svg'
import { useTranslation } from '../i18n/use-translation'
import { sessionKindIconUrl } from '../session-kind-icons'
import { isAgentDone, sessionStatusLabel } from '../session-status'
import { useAppStore } from '../store/use-app-store'

type SessionRowProps = {
  session: SessionRecord
  active: boolean
  onActivate: () => void
  onRequestStop: (trigger: HTMLButtonElement) => void
  onRequestDelete: (trigger: HTMLButtonElement) => void
  onRowHidden: () => void
}

function PencilGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" className="icon icon-rename"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z" />
    </svg>
  )
}

function StopGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" className="icon icon-stop">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  )
}

function TrashGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" className="icon icon-delete"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12M10 11v6M14 11v6" />
    </svg>
  )
}

export default function SessionRow({ session, active, onActivate, onRequestStop, onRequestDelete, onRowHidden }: SessionRowProps) {
  const { t } = useTranslation()
  const agentIdle = useAppStore((state) => state.idleAgentSessionIds[session.id] === true)
  const unread = useAppStore((state) => state.unreadSessionIds.includes(session.id))
  const renameSession = useAppStore((state) => state.renameSession)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const [busy, setBusy] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef(false)
  const menuId = useId()
  const secondary = session.mode === 'worktree' ? session.worktreeName : t('sidebar.ordinarySession')
  const statusLabel = sessionStatusLabel(t, session, agentIdle)

  const closeMenu = (restoreFocus = true): void => {
    setMenuOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useLayoutEffect(() => {
    if (restoreFocusRef.current && !editing && !busy) {
      restoreFocusRef.current = false
      triggerRef.current?.focus()
    }
  }, [editing, busy])

  useLayoutEffect(() => {
    if (!menuOpen) return
    const anchor = triggerRef.current?.getBoundingClientRect()
    const menu = menuRef.current?.getBoundingClientRect()
    if (!anchor || !menu) return
    setPosition({
      top: Math.max(8, anchor.bottom + 4 + menu.height <= window.innerHeight - 8 ? anchor.bottom + 4 : anchor.top - menu.height - 4),
      left: Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8))
    })
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) closeMenu(false)
    }
    const dismissOnLayout = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      closeMenu(false)
    }
    document.addEventListener('pointerdown', dismissOutside)
    window.addEventListener('resize', dismissOnLayout)
    document.addEventListener('scroll', dismissOnLayout, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      window.removeEventListener('resize', dismissOnLayout)
      document.removeEventListener('scroll', dismissOnLayout, true)
    }
  }, [menuOpen])

  const cancelRename = (): void => {
    if (busy) return
    restoreFocusRef.current = true
    setEditing(false)
    setInvalid(false)
  }

  const saveRename = async (): Promise<void> => {
    if (busy) return
    const title = draft.trim()
    if (!title || title.length > 200) { setInvalid(true); inputRef.current?.focus(); return }
    setBusy(true)
    const saved = await renameSession(session.id, title)
    setBusy(false)
    setInvalid(!saved)
    if (saved) {
      restoreFocusRef.current = true
      setEditing(false)
      if (!triggerRef.current?.isConnected) onRowHidden()
    }
    else inputRef.current?.focus()
  }

  return (
    <li className="session-row" data-active={active ? 'true' : undefined} data-unread={unread ? 'true' : undefined}>
      {editing ? (
        <form className="session-rename" onSubmit={(event) => { event.preventDefault(); void saveRename() }} onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelRename() }
        }}>
          <input ref={inputRef} aria-label={t('sidebar.sessionName')} aria-invalid={invalid || undefined} value={draft} maxLength={200} disabled={busy}
            onChange={(event) => { setDraft(event.target.value); setInvalid(false) }} autoFocus />
          <button type="submit" disabled={busy || !draft.trim()} aria-label={t('sidebar.saveSessionName')} title={t('sidebar.saveSessionName')}>&#10003;</button>
          <button type="button" disabled={busy} onClick={cancelRename} aria-label={t('common.cancel')} title={t('common.cancel')}>&times;</button>
        </form>
      ) : (
        <button type="button" className="session-row-content" aria-current={active ? 'true' : undefined}
          aria-description={unread ? t('sidebar.unreadOutput') : undefined} onClick={onActivate}>
          <span className="session-icon">
            <span aria-hidden="true" className="session-kind-icon" data-kind={session.kind}>
              <img src={sessionKindIconUrl(session.kind)} alt="" width={16} height={16} />
            </span>
            <span className="session-status-dot" data-status={isAgentDone(session, agentIdle) ? 'done' : session.status} role="img" aria-label={statusLabel} title={statusLabel}>&bull;</span>
          </span>
          <span className="session-title" title={session.title}>{session.title}</span>
          <span className="session-secondary" title={secondary}>{secondary}</span>
        </button>
      )}
      <button ref={triggerRef} type="button" className="session-options-trigger" aria-label={t('sidebar.sessionOptions', { title: session.title })}
        aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} disabled={busy || editing}
        onClick={() => setMenuOpen(!menuOpen)}>
        <img src={optionsIconUrl} className="icon icon-options" alt="" width={16} height={16} />
      </button>
      {menuOpen && createPortal(
        <div ref={menuRef} id={menuId} className="session-options-menu" role="menu" aria-label={t('sidebar.sessionOptions', { title: session.title })} style={position}
          onBlur={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== triggerRef.current) closeMenu(false) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
            items[next]?.focus()
          }}>
          <button type="button" role="menuitem" className="project-options-menu-item" onClick={() => {
            closeMenu(false); setDraft(session.title); setInvalid(false); setEditing(true)
          }}><PencilGlyph />{t('sidebar.renameSession')}</button>
          <button type="button" role="menuitem" className="project-options-menu-item"
            disabled={session.status !== 'running' && session.status !== 'creating'}
            onClick={() => {
              closeMenu(); if (triggerRef.current) onRequestStop(triggerRef.current)
            }}><StopGlyph />{t('sidebar.stopSession')}</button>
          <button type="button" role="menuitem" className="project-options-menu-item" onClick={() => {
            closeMenu(); if (triggerRef.current) onRequestDelete(triggerRef.current)
          }}><TrashGlyph />{t('common.delete')}</button>
        </div>, document.body
      )}
    </li>
  )
}
