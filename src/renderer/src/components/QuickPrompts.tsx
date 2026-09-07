import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import type { TranslationKey } from '../i18n'
import { useTranslation } from '../i18n/use-translation'
import {
  MAX_QUICK_PROMPTS,
  MAX_QUICK_PROMPT_CONTENT,
  moveQuickPrompt,
  quickPromptPreview,
  quickPromptSchema,
  type QuickPrompt,
  type QuickPromptPlacement
} from '../quick-prompts'
import { useAppStore } from '../store/use-app-store'
import { useQuickPromptSort } from './use-quick-prompt-sort'

type QuickPromptsProps = {
  sessionId: string | null
  running: boolean
  onInsert: (content: string) => TranslationKey | null
  onFocusTerminal: () => void
}

type View = 'closed' | 'browse' | 'starred' | 'manage' | 'edit' | 'delete'

function PromptIcon({ kind }: { kind: 'bolt' | 'plus' | 'manage' | 'close' | 'delete' | 'star' | 'grip' }) {
  const paths = {
    bolt: 'M9 1 3 9h4l-1 6 7-9H9l1-5Z',
    plus: 'M8 3v10M3 8h10',
    manage: 'M3 4h10M3 8h10M3 12h10M6 2v4M10 6v4M6 10v4',
    close: 'm4 4 8 8M4 12l8-8',
    delete: 'M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4M9 7v4',
    star: 'm8 1.5 2 4.1 4.5.7-3.2 3.1.7 4.5-4-2.1-4 2.1.7-4.5L1.5 6.3l4.5-.7Z',
    grip: 'M5 4h.01M11 4h.01M5 8h.01M11 8h.01M5 12h.01M11 12h.01'
  }
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>
}

function StarredPromptBar({ prompts, running, insertedId, onInsert, onBrowse, expanded, sorting }: {
  prompts: QuickPrompt[]
  running: boolean
  insertedId: string | null
  onInsert: (prompt: QuickPrompt) => void
  onBrowse: () => void
  expanded: boolean
  sorting: ReturnType<typeof useQuickPromptSort>
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(MAX_QUICK_PROMPTS)

  useLayoutEffect(() => {
    const container = containerRef.current
    const measurement = measurementRef.current
    if (!container || !measurement || !prompts.length) return
    const fit = (): void => {
      const style = getComputedStyle(container)
      const available = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      if (!(available > 0)) return
      const gap = parseFloat(style.columnGap)
      const widths = Array.from(measurement.children, (child) => child.getBoundingClientRect().width)
      const moreWidth = widths.pop()!
      const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1)
      if (total <= available) {
        setVisibleCount(prompts.length)
        return
      }
      let used = moreWidth
      let count = 0
      for (const width of widths) {
        if (used + gap + width > available) break
        used += gap + width
        count++
      }
      setVisibleCount(count)
    }
    // Measure untabbable copies so hidden prompts never remain in the keyboard tab order.
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    for (const child of measurement.children) observer.observe(child)
    return () => observer.disconnect()
  }, [prompts])

  const hiddenCount = Math.max(0, prompts.length - visibleCount)
  return (
    <div ref={containerRef} className="quick-prompts-chips" aria-label={t('quickPrompts.starred')}>
      <div ref={measurementRef} className="quick-prompts-measure" aria-hidden="true">
        {prompts.map((prompt) => <span key={prompt.id} className="quick-prompts-chip">{quickPromptPreview(prompt.content)}</span>)}
        <span className="quick-prompts-more">+{prompts.length}</span>
      </div>
      {prompts.length === 0 && <span className="quick-prompts-empty-inline">{t('quickPrompts.emptyBar')}</span>}
      {prompts.slice(0, visibleCount).map((prompt) => <button type="button" key={prompt.id} className="quick-prompts-chip" disabled={!running}
        {...sorting.sourceProps(prompt.id, 'bar', running)} {...sorting.targetProps(prompt.id, 'bar', running)}
        data-inserted={prompt.id === insertedId ? 'true' : undefined} aria-label={t('quickPrompts.insert', { name: quickPromptPreview(prompt.content) })}
        title={running ? `${prompt.content}\n${t('quickPrompts.dragHint')}` : t('quickPrompts.stopped')} onClick={() => onInsert(prompt)}>{quickPromptPreview(prompt.content)}</button>)}
      {hiddenCount > 0 && <button type="button" className="quick-prompts-more" aria-expanded={expanded}
        aria-label={t('quickPrompts.moreStarred', { count: hiddenCount })} title={t('quickPrompts.moreStarred', { count: hiddenCount })}
        onClick={onBrowse}>+{hiddenCount}</button>}
    </div>
  )
}

export default function QuickPrompts({ sessionId, running, onInsert, onFocusTerminal }: QuickPromptsProps) {
  const { t } = useTranslation()
  const platform = useAppStore((state) => state.platform)
  const enabled = useAppStore((state) => state.showQuickPrompts)
  const prompts = useAppStore((state) => state.quickPrompts)
  const setQuickPrompts = useAppStore((state) => state.setQuickPrompts)
  const [view, setView] = useState<View>('closed')
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [draft, setDraft] = useState<QuickPrompt | null>(null)
  const [pendingDelete, setPendingDelete] = useState<QuickPrompt | null>(null)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [insertedId, setInsertedId] = useState<string | null>(null)
  const [sortAnnouncement, setSortAnnouncement] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const shortcut = platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P'
  const starred = useMemo(() => prompts.filter((prompt) => prompt.starred), [prompts])
  const browsing = view === 'browse' || view === 'starred'
  const filtered = (view === 'starred' ? starred : prompts).filter((prompt) => prompt.content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selected = Math.min(selectedIndex, Math.max(0, filtered.length - 1))
  const canSortList = view === 'manage' && !query.trim()

  const reorder = (sourceId: string, targetId: string, placement: QuickPromptPlacement): void => {
    const next = moveQuickPrompt(prompts, sourceId, targetId, placement)
    if (next === prompts) return
    if (!setQuickPrompts(next)) {
      setError('quickPrompts.reorderFailed')
      return
    }
    setError(null)
    const index = next.findIndex((prompt) => prompt.id === sourceId)
    setSortAnnouncement(t('quickPrompts.reordered', { name: quickPromptPreview(next[index].content), position: index + 1, count: next.length }))
  }
  const sorting = useQuickPromptSort(reorder)

  useEffect(() => { sorting.cancel() }, [sessionId, enabled, view, query, prompts, sorting.cancel])

  useEffect(() => {
    setView('closed')
    setError(null)
    setInsertedId(null)
  }, [sessionId, enabled])

  useEffect(() => {
    if (view === 'edit') contentRef.current?.focus()
    else if (view === 'delete') cancelDeleteRef.current?.focus()
    else if (view !== 'closed') searchRef.current?.focus()
  }, [view])

  useEffect(() => {
    if (!insertedId) return
    const timer = setTimeout(() => setInsertedId(null), 2500)
    return () => clearTimeout(timer)
  }, [insertedId])

  useEffect(() => {
    if (!sessionId || !enabled) return
    const handleShortcut = (event: globalThis.KeyboardEvent): void => {
      const modifier = platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      if (!modifier || !event.shiftKey || event.altKey || event.repeat || event.isComposing ||
        (event.code !== 'KeyP' && event.key.toLowerCase() !== 'p')) return
      const target = event.target
      if (!(target instanceof Element) || (!target.closest('.terminal-workspace') && !rootRef.current?.contains(target))) return
      // Capture before xterm so opening the picker cannot also send a control key to the CLI.
      event.preventDefault()
      event.stopPropagation()
      setQuery('')
      setSelectedIndex(0)
      setError(null)
      setView('browse')
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', handleShortcut, true)
    return () => document.removeEventListener('keydown', handleShortcut, true)
  }, [sessionId, platform, enabled])

  useEffect(() => {
    if (view === 'browse' || view === 'starred') document.getElementById(`${panelId}-option-${selected}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [view, selected, query, panelId])

  const close = (): void => {
    setView('closed')
    setError(null)
    onFocusTerminal()
  }

  const insert = (prompt: QuickPrompt): void => {
    if (!running) return
    const failure = onInsert(prompt.content)
    setError(failure)
    if (failure) setInsertedId(null)
    if (!failure) {
      setInsertedId(prompt.id)
      setView('closed')
      onFocusTerminal()
    }
  }

  const startAdding = (): void => {
    setDraft((current) => current ?? { id: crypto.randomUUID(), content: '', starred: false })
    setView('edit')
    setError(null)
  }

  const save = (): void => {
    if (!draft) return
    const parsed = quickPromptSchema.safeParse(draft)
    if (!parsed.success) {
      setError('quickPrompts.invalid')
      return
    }
    const next = prompts.some((prompt) => prompt.id === parsed.data.id)
      ? prompts.map((prompt) => prompt.id === parsed.data.id ? parsed.data : prompt)
      : [...prompts, parsed.data]
    if (!setQuickPrompts(next)) {
      setError('quickPrompts.saveFailed')
      return
    }
    setDraft(null)
    close()
  }

  const deletePrompt = (): void => {
    if (!pendingDelete) return
    if (!setQuickPrompts(prompts.filter((prompt) => prompt.id !== pendingDelete.id))) {
      setError('quickPrompts.saveFailed')
      return
    }
    setPendingDelete(null)
    setError(null)
    setView('manage')
  }

  const toggleStar = (prompt: QuickPrompt): void => {
    const next = prompts.map((item) => item.id === prompt.id ? { ...item, starred: !item.starred } : item)
    if (!setQuickPrompts(next)) {
      setError('quickPrompts.saveFailed')
      return
    }
    if (draft?.id === prompt.id) setDraft({ ...draft, starred: !prompt.starred })
    setError(null)
  }

  const openBrowse = (starredOnly = false): void => {
    setView(starredOnly ? 'starred' : 'browse')
    setQuery('')
    setSelectedIndex(0)
    setError(null)
  }

  const searchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!browsing || event.nativeEvent.isComposing || !filtered.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((selected + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      insert(filtered[selected])
    }
  }

  if (!sessionId || !enabled) return null

  return (
    <div ref={rootRef} className="quick-prompts" {...sorting.rootProps} onKeyDown={(event) => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      sorting.cancel()
      close()
    }}>
      {view !== 'closed' && (
        <section className="quick-prompts-panel" id={panelId} aria-labelledby={`${panelId}-title`}>
          <div className="quick-prompts-heading">
            <h2 id={`${panelId}-title`}>{t(view === 'edit' ? (prompts.some((prompt) => prompt.id === draft?.id) ? 'quickPrompts.editTitle' : 'quickPrompts.add') : view === 'delete' ? 'quickPrompts.deleteTitle' : view === 'manage' ? 'quickPrompts.manage' : view === 'starred' ? 'quickPrompts.starred' : 'quickPrompts.title')}</h2>
            <span className="quick-prompts-panel-hint" id={`${panelId}-hint`}>{t(browsing ? 'quickPrompts.keyboardHint' : view === 'manage' ? (canSortList ? 'quickPrompts.reorderHint' : 'quickPrompts.filteredSortHint') : 'quickPrompts.sharedHint')}</span>
            <button type="button" className="quick-prompts-icon-button" aria-label={t('quickPrompts.close')} title={t('quickPrompts.close')} onClick={close}><PromptIcon kind="close" /></button>
          </div>
          {view === 'edit' && draft ? (
            <form className="quick-prompts-form" onSubmit={(event) => { event.preventDefault(); save() }}>
              <label className="quick-prompts-content-field">
                {t('quickPrompts.content')}
                <textarea ref={contentRef} required rows={4} maxLength={MAX_QUICK_PROMPT_CONTENT} value={draft.content}
                  placeholder={t('quickPrompts.contentPlaceholder')}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      save()
                    }
                  }} />
              </label>
              <div className="quick-prompts-form-footer">
                <button type="button" className="quick-prompts-star-toggle" aria-pressed={draft.starred}
                  onClick={() => setDraft({ ...draft, starred: !draft.starred })}>
                  <PromptIcon kind="star" />{t('quickPrompts.showInBar')}
                </button>
                <div className="quick-prompts-actions">
                  <button type="button" className="quick-prompts-action" onClick={() => { setDraft(null); close() }}>{t('common.cancel')}</button>
                  <button type="submit" className="quick-prompts-primary" disabled={!draft.content.trim()}>{t('quickPrompts.save')}</button>
                </div>
              </div>
            </form>
          ) : view === 'delete' && pendingDelete ? (
            <div className="quick-prompts-delete-confirmation">
              <p className="quick-prompts-hint">{t('quickPrompts.deletePrompt', { name: quickPromptPreview(pendingDelete.content) })}</p>
              <div className="quick-prompts-actions">
                <button ref={cancelDeleteRef} type="button" className="quick-prompts-action" onClick={() => { setPendingDelete(null); setError(null); setView('manage') }}>{t('common.cancel')}</button>
                <button type="button" className="quick-prompts-action quick-prompts-delete" onClick={deletePrompt}>{t('common.delete')}</button>
              </div>
            </div>
          ) : (
            <>
              <input ref={searchRef} className="quick-prompts-search" type="search" aria-label={t('quickPrompts.search')}
                role={browsing ? 'combobox' : undefined} aria-autocomplete={browsing ? 'list' : undefined}
                aria-expanded={browsing ? true : undefined} aria-controls={browsing ? `${panelId}-list` : undefined}
                aria-activedescendant={browsing && filtered.length ? `${panelId}-option-${selected}` : undefined}
                placeholder={t('quickPrompts.search')} value={query} onKeyDown={searchKeyDown}
                onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0) }} />
              <ul className="quick-prompts-list" id={`${panelId}-list`} role={browsing ? 'listbox' : undefined} aria-label={t(view === 'starred' ? 'quickPrompts.starred' : 'quickPrompts.title')}>
                {filtered.map((prompt, index) => (
                  <li key={prompt.id} className="quick-prompts-item" role={browsing ? 'presentation' : undefined}
                    {...sorting.targetProps(prompt.id, 'manage', canSortList)}>
                    {view === 'manage' && <button type="button" className="quick-prompts-icon-button quick-prompts-drag-handle"
                      disabled={!canSortList} {...sorting.sourceProps(prompt.id, 'manage', canSortList)}
                      aria-label={t('quickPrompts.reorder', { name: quickPromptPreview(prompt.content) })}
                      aria-describedby={`${panelId}-hint`} aria-keyshortcuts="ArrowUp ArrowDown"
                      title={t(canSortList ? 'quickPrompts.reorderHint' : 'quickPrompts.filteredSortHint')}
                      onKeyDown={(event) => {
                        if (!canSortList || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
                          (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                        event.preventDefault()
                        event.stopPropagation()
                        const previous = event.key === 'ArrowUp'
                        const neighbor = prompts[index + (previous ? -1 : 1)]
                        if (neighbor) reorder(prompt.id, neighbor.id, previous ? 'before' : 'after')
                      }}><PromptIcon kind="grip" /></button>}
                    <button type="button" className="quick-prompts-result" disabled={browsing && !running}
                      role={browsing ? 'option' : undefined} aria-selected={browsing ? index === selected : undefined}
                      id={`${panelId}-option-${index}`} aria-label={t(browsing ? 'quickPrompts.insert' : 'quickPrompts.edit', { name: quickPromptPreview(prompt.content) })}
                      title={prompt.content}
                      onClick={() => {
                        if (browsing) insert(prompt)
                        else { setDraft({ ...prompt }); setView('edit'); setError(null) }
                      }}>
                      <span className="quick-prompts-preview">{prompt.content}</span>
                      <span className="quick-prompts-result-action" aria-hidden="true">{browsing ? 'Enter' : t('quickPrompts.editAction')}</span>
                    </button>
                    {view === 'manage' && <>
                      <button type="button" className="quick-prompts-icon-button quick-prompts-star-toggle" aria-pressed={prompt.starred}
                        aria-label={t('quickPrompts.star', { name: quickPromptPreview(prompt.content) })}
                        title={t(prompt.starred ? 'quickPrompts.unstar' : 'quickPrompts.star', { name: quickPromptPreview(prompt.content) })}
                        onClick={() => toggleStar(prompt)}><PromptIcon kind="star" /></button>
                      <button type="button" className="quick-prompts-icon-button quick-prompts-delete" aria-label={t('quickPrompts.delete', { name: quickPromptPreview(prompt.content) })}
                        title={t('quickPrompts.delete', { name: quickPromptPreview(prompt.content) })}
                        onClick={() => { setPendingDelete(prompt); setView('delete'); setError(null) }}><PromptIcon kind="delete" /></button>
                    </>}
                  </li>
                ))}
              </ul>
              {filtered.length === 0 && <p className="quick-prompts-empty">{t(prompts.length ? 'quickPrompts.noResults' : 'quickPrompts.empty')}</p>}
            </>
          )}
        </section>
      )}
      {error && <p className="quick-prompts-error" role="alert">{t(error)}</p>}
      <div className="quick-prompts-bar">
        <button type="button" className="quick-prompts-trigger" aria-label={t('quickPrompts.title')} title={`${t('quickPrompts.search')} (${shortcut})`}
          aria-expanded={view === 'browse'} aria-controls={view === 'browse' ? panelId : undefined}
          aria-keyshortcuts={platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P'}
          onClick={() => { if (view === 'browse') close(); else openBrowse() }}>
          <PromptIcon kind="bolt" /><span>{t('quickPrompts.title')}</span>
        </button>
        <StarredPromptBar prompts={starred} running={running} insertedId={insertedId} onInsert={insert} sorting={sorting}
          expanded={view === 'starred'} onBrowse={() => { if (view === 'starred') close(); else openBrowse(true) }} />
        <span className="quick-prompts-feedback" aria-live="polite" aria-atomic="true">{insertedId ? t('quickPrompts.inserted') : ''}</span>
        <span className="quick-prompts-sort-announcement" aria-live="polite" aria-atomic="true">{sortAnnouncement}</span>
        <button type="button" className="quick-prompts-icon-button" disabled={prompts.length >= MAX_QUICK_PROMPTS && !draft}
          aria-label={t('quickPrompts.add')} title={prompts.length >= MAX_QUICK_PROMPTS ? t('quickPrompts.limit', { count: MAX_QUICK_PROMPTS }) : t('quickPrompts.add')}
          onClick={startAdding}><PromptIcon kind="plus" /></button>
        <button type="button" className="quick-prompts-icon-button" aria-label={t('quickPrompts.manage')} title={t('quickPrompts.manage')}
          aria-expanded={view === 'manage'} onClick={() => { if (view === 'manage') close(); else { setView('manage'); setQuery(''); setError(null) } }}><PromptIcon kind="manage" /></button>
      </div>
    </div>
  )
}
