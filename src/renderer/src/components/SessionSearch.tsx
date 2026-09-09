import { useEffect, useId, useRef, useState, type RefObject } from 'react'

import { useTranslation } from '../i18n/use-translation'

type SessionSearchProps = {
  value: string
  onChange: (value: string) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

export default function SessionSearch({ value, onChange, triggerRef }: SessionSearchProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogId = useId()
  const active = value.trim().length > 0

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [open])

  return (
    <div
      ref={containerRef}
      className="session-search-control"
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
        className="session-search-toggle"
        aria-label={t('sidebar.searchSessions')}
        title={active ? `${t('sidebar.searchSessions')}: ${value.trim()}` : t('sidebar.searchSessions')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        data-active={active ? 'true' : undefined}
        onClick={() => setOpen(!open)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </svg>
      </button>
      {open && (
        <form
          id={dialogId}
          className="session-filter-popover session-search-popover"
          role="dialog"
          aria-label={t('sidebar.searchSessions')}
          onSubmit={(event) => { event.preventDefault(); close() }}
        >
          <div className="session-filter-heading">
            <strong>{t('sidebar.searchTitle')}</strong>
            <button type="button" aria-label={t('sidebar.closeSearch')} onClick={close}>&times;</button>
          </div>
          <input
            ref={inputRef}
            type="search"
            className="session-search"
            aria-label={t('sidebar.searchSessions')}
            placeholder={t('sidebar.searchSessions')}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <div className="session-filter-actions">
            <button type="button" onClick={() => { onChange(''); inputRef.current?.focus() }}>
              {t('sidebar.clearSearch')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
