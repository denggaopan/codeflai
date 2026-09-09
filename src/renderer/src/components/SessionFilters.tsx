import { useEffect, useId, useRef, useState } from 'react'

import type { SessionRecord } from '../../../shared/contracts'
import { useTranslation } from '../i18n/use-translation'

export type SessionStatusFilter = 'all' | 'done' | SessionRecord['status']
export type SessionArchiveFilter = 'active' | 'archived' | 'all'

type SessionFiltersProps = {
  value: SessionStatusFilter
  onChange: (value: SessionStatusFilter) => void
  archiveValue: SessionArchiveFilter
  onArchiveChange: (value: SessionArchiveFilter) => void
}

export default function SessionFilters({ value, onChange, archiveValue, onArchiveChange }: SessionFiltersProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftStatus, setDraftStatus] = useState(value)
  const [draftArchive, setDraftArchive] = useState(archiveValue)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const dialogId = useId()
  const statusLabel = value === 'all' ? t('sidebar.allStatuses') : value === 'stopped' ? t('sidebar.stoppedStatus') : t(`status.${value}`)
  const active = value !== 'all' || archiveValue !== 'active'
  const archiveLabel = t(archiveValue === 'all' ? 'sidebar.allSessions' : archiveValue === 'archived' ? 'sidebar.archivedSessions' : 'sidebar.activeSessions')

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    selectRef.current?.focus()
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [open])

  return (
    <div
      ref={containerRef}
      className="session-filter-control"
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !containerRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="session-status-filter"
        aria-label={t('sidebar.filterSessions')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        data-active={active ? 'true' : undefined}
        title={`${t('sidebar.sessionStatus')}: ${statusLabel}${archiveValue === 'active' ? '' : `; ${archiveLabel}`}`}
        onClick={() => {
          setDraftStatus(value)
          setDraftArchive(archiveValue)
          setOpen(!open)
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
        </svg>
      </button>
      {open && (
        <form
          id={dialogId}
          className="session-filter-popover"
          role="dialog"
          aria-label={t('sidebar.filterSessions')}
          onReset={() => { setDraftStatus('all'); setDraftArchive('active') }}
          onSubmit={(event) => {
            event.preventDefault()
            onChange(draftStatus)
            onArchiveChange(draftArchive)
            close()
          }}
        >
          <div className="session-filter-heading">
            <strong>{t('sidebar.filterTitle')}</strong>
            <button type="button" aria-label={t('sidebar.closeFilters')} onClick={close}>&times;</button>
          </div>
          <select
            ref={selectRef}
            className="session-filter-field"
            aria-label={t('sidebar.sessionStatus')}
            value={draftStatus}
            onChange={(event) => setDraftStatus(event.target.value as SessionStatusFilter)}
          >
            <option value="all">{t('sidebar.allStatuses')}</option>
            <option value="running">{t('status.running')}</option>
            <option value="done">{t('status.done')}</option>
            <option value="stopped">{t('sidebar.stoppedStatus')}</option>
            <option value="creating">{t('status.creating')}</option>
            <option value="missing">{t('status.missing')}</option>
            <option value="error">{t('status.error')}</option>
          </select>
          <select className="session-filter-field" aria-label={t('sidebar.sessionVisibility')} value={draftArchive}
            onChange={(event) => setDraftArchive(event.target.value as SessionArchiveFilter)}>
            <option value="active">{t('sidebar.activeSessions')}</option>
            <option value="archived">{t('sidebar.archivedSessions')}</option>
            <option value="all">{t('sidebar.allSessions')}</option>
          </select>
          <div className="session-filter-actions">
            <button type="reset">{t('sidebar.resetFilters')}</button>
            <button type="submit">{t('sidebar.applyFilters')}</button>
          </div>
        </form>
      )}
    </div>
  )
}
