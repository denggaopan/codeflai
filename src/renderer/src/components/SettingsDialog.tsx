import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { AppInfo, UpdateCheckResult } from '../../../shared/contracts'
import type { ExternalLinkTarget } from '../../../shared/links'
import { LOCALES, type TranslationKey, type Translator } from '../i18n'
import { useTranslation } from '../i18n/use-translation'
import { sessionKindOptions, type SessionKindOption } from '../session-kind-options'
import { resolveActiveSection, SETTINGS_SECTIONS, type SettingsSectionId } from '../settings-sections'
import { useAppStore } from '../store/use-app-store'

type SettingsDialogProps = {
  open: boolean
  onClose: () => void
}

// Order matches the About section top to bottom: where the project lives, what changed,
// where to get a build. Each entry is a whitelisted target key rather than a URL — the main
// process resolves it against shared/links.ts, so the renderer can never ask it to open an
// arbitrary address.
const LINK_ITEMS: ReadonlyArray<{ target: ExternalLinkTarget; labelKey: TranslationKey }> = [
  { target: 'repository', labelKey: 'settings.linkRepository' },
  { target: 'changelog', labelKey: 'settings.linkChangelog' },
  { target: 'download', labelKey: 'settings.linkDownload' }
]

// Breathing room left above a section the menu jumped to, so its heading is not flush against
// the pane's edge. Stays under ACTIVE_SECTION_MARGIN or the jump would land short of its own
// highlight line and light up the previous entry.
const SCROLL_TARGET_INSET = 12

type UpdateState = { phase: 'idle' } | { phase: 'checking' } | { phase: 'done'; result: UpdateCheckResult }

const updateMessage = (result: UpdateCheckResult, t: Translator): string => {
  switch (result.status) {
    case 'up-to-date':
      return t('settings.upToDate')
    case 'available':
      return t('settings.updateAvailable', { version: result.latestVersion })
    case 'none':
      return t('settings.updateNoReleases')
    case 'error':
      return t('settings.updateFailed', { reason: result.message })
  }
}

const failureReason = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback)

/**
 * Application settings modal, opened from the title bar's gear button. Renders nothing when
 * `open` is false. Follows ConfirmDialog's modal conventions: fixed full-window backdrop
 * (click closes), Escape closes, and clicks inside the panel never bubble to the backdrop.
 *
 * Laid out as an anchor menu beside a single scrolling pane: every section is always mounted
 * and reachable by scrolling, and the menu is a shortcut to one of them rather than a tab bar
 * that swaps the content — so a setting the user is looking for can be found by scrolling even
 * when they guess the wrong menu entry.
 *
 * Sections, in order: general preferences (startup, theme, language, prompt bar), the per-kind
 * session switches that decide which entries the New session launcher offers, the installed
 * version with its update check, and the About links. Everything the main process owns —
 * version, update check, startup flag, link opening — is read lazily when the dialog opens
 * rather than kept in the app store, since none of it is needed until the user looks.
 */
export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation()
  const platform = useAppStore((state) => state.platform)
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const locale = useAppStore((state) => state.locale)
  const setLocale = useAppStore((state) => state.setLocale)
  const showQuickPrompts = useAppStore((state) => state.showQuickPrompts)
  const setShowQuickPrompts = useAppStore((state) => state.setShowQuickPrompts)
  const sessionKindPreferences = useAppStore((state) => state.sessionKindPreferences)
  const setSessionKindPreference = useAppStore((state) => state.setSessionKindPreference)
  const beginUpdate = useAppStore((state) => state.beginUpdate)
  const startUpdateDownload = useAppStore((state) => state.startUpdateDownload)

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  // null while the main process has not answered yet: the switch stays disabled rather than
  // rendering a guessed "off" that the user could toggle against the real setting.
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null)
  const [autoLaunchError, setAutoLaunchError] = useState<string | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' })
  const [moreKindsExpanded, setMoreKindsExpanded] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general')

  const contentRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Partial<Record<SettingsSectionId, HTMLElement | null>>>({})
  // The section a menu click is scrolling towards. Smooth scrolling walks past every section
  // in between, and letting those light up in turn reads as flicker, so intermediate scroll
  // positions are ignored until the destination is reached.
  const pendingSectionRef = useRef<SettingsSectionId | null>(null)

  useEffect(() => {
    if (!open) return undefined

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
  }, [open, onClose])

  // Re-read on every open (not once per mount): the startup flag can be changed outside
  // Codeflai, and a stale update result from a previous visit would be misleading.
  useEffect(() => {
    if (!open) return undefined

    let cancelled = false
    setUpdateState({ phase: 'idle' })
    setAutoLaunchError(null)
    void window.codeflai
      .getAppInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info)
      })
      .catch(() => undefined)

    void window.codeflai
      .getAutoLaunch()
      .then((enabled) => {
        if (!cancelled) setAutoLaunch(enabled)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [open])

  // The dialog stays mounted while closed, so the disclosure would otherwise reopen however
  // the user last left it. It always reopens collapsed instead, whether or not an opt-in CLI
  // is enabled: Settings is about the established kinds, and an enabled one keeps its switches
  // one caret click away rather than pushing the rest of the dialog down on every visit.
  // Collapsed here — while hidden — rather than in the "every open" effect above: an effect
  // runs after the reopened dialog has painted, so the user would catch one expanded frame.
  // The menu highlight is reset the same way and for the same reason: the pane unmounts with
  // the dialog, so it comes back scrolled to the top and must not claim otherwise.
  if (!open) {
    if (moreKindsExpanded) setMoreKindsExpanded(false)
    if (activeSection !== 'general') setActiveSection('general')
    pendingSectionRef.current = null
    return null
  }

  const handleAutoLaunchToggle = async (): Promise<void> => {
    if (autoLaunch === null) return
    const next = !autoLaunch
    setAutoLaunchError(null)
    try {
      // The main process answers with the value it read back after writing, so a setting the
      // OS silently refused shows as unchanged instead of as a switch that lies.
      setAutoLaunch(await window.codeflai.setAutoLaunch(next))
    } catch (error) {
      setAutoLaunchError(t('settings.launchAtLoginFailed', { reason: failureReason(error, t('notice.genericError')) }))
    }
  }

  const handleCheckForUpdates = async (): Promise<void> => {
    setUpdateState({ phase: 'checking' })
    try {
      setUpdateState({ phase: 'done', result: await window.codeflai.checkForUpdates() })
    } catch (error) {
      setUpdateState({
        phase: 'done',
        result: { status: 'error', message: failureReason(error, t('notice.genericError')) }
      })
    }
  }

  const openLink = (target: ExternalLinkTarget): void => {
    void window.codeflai.openExternalLink(target).catch(() => undefined)
  }

  // Hands the check's outcome to the app store instead of making UpdateDialog repeat the
  // round trip, then closes Settings so the update dialog is the only thing on screen.
  const handleUpdateNow = (version: string): void => {
    beginUpdate(version, true)
    void startUpdateDownload()
    onClose()
  }

  const registerSection =
    (id: SettingsSectionId) =>
    (element: HTMLElement | null): void => {
      sectionRefs.current[id] = element
    }

  // Only the scroll position moves; the highlight follows from it via the scroll handler, so
  // the menu can never disagree with what is actually on screen. Assigning `scrollTop` (rather
  // than calling scrollIntoView) keeps the smooth easing in CSS, where it can be turned off.
  const jumpToSection = (id: SettingsSectionId): void => {
    const container = contentRef.current
    const target = sectionRefs.current[id]
    if (!container || !target) return

    pendingSectionRef.current = id
    setActiveSection(id)
    container.scrollTop = Math.max(0, target.offsetTop - SCROLL_TARGET_INSET)
  }

  const handleContentScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const container = event.currentTarget
    const offsets = SETTINGS_SECTIONS.flatMap((section) => {
      const element = sectionRefs.current[section.id]
      return element ? [{ id: section.id, top: element.offsetTop }] : []
    })
    const resolved = resolveActiveSection(container, offsets)
    if (!resolved) return

    if (pendingSectionRef.current !== null) {
      if (resolved !== pendingSectionRef.current) return
      pendingSectionRef.current = null
    }
    setActiveSection(resolved)
  }

  const kindOptions = sessionKindOptions(platform)
  const primaryKinds = kindOptions.filter((item) => item.group === 'primary')
  const additionalKinds = kindOptions.filter((item) => item.group === 'additional')

  // One row shape for both groups: a kind behind the disclosure gets exactly the switches an
  // always-visible one does, so enabling it there is not a different interaction.
  const renderKindRow = (item: SessionKindOption) => {
    const preference = sessionKindPreferences[item.kind]
    const kindLabel = t(item.labelKey)
    return (
      <li key={item.kind} className="settings-kind-row">
        <span className="settings-kind-name">{kindLabel}</span>
        <button
          type="button"
          className="settings-switch"
          role="switch"
          aria-checked={preference.enabled}
          aria-label={t('settings.enableKind', { kind: kindLabel })}
          onClick={() => setSessionKindPreference(item.kind, { enabled: !preference.enabled })}
        >
          <span className="settings-switch-thumb" aria-hidden="true" />
        </button>
        {/* A kind that is not offered at all cannot offer a worktree variant: the switch
            keeps its stored value but is disabled until the kind is back on. */}
        <button
          type="button"
          className="settings-switch"
          role="switch"
          aria-checked={preference.worktree}
          aria-label={t('settings.worktreeForKind', { kind: kindLabel })}
          disabled={!preference.enabled}
          onClick={() => setSessionKindPreference(item.kind, { worktree: !preference.worktree })}
        >
          <span className="settings-switch-thumb" aria-hidden="true" />
        </button>
      </li>
    )
  }

  // Extracted before the JSX so the narrowing survives into the click handler's closure.
  const downloadableUpdate =
    updateState.phase === 'done' && updateState.result.status === 'available' && updateState.result.asset
      ? updateState.result
      : null

  return createPortal(
    <div className="settings-dialog-backdrop" onClick={onClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-dialog-header">
          <h2 id="settings-dialog-title" className="settings-dialog-title">
            {t('settings.title')}
          </h2>
          <button type="button" className="settings-dialog-close" aria-label={t('settings.close')} onClick={onClose} autoFocus>
            ✕
          </button>
        </div>

        <div className="settings-dialog-body">
          <nav className="settings-nav" aria-label={t('settings.sections')}>
            <ul className="settings-nav-list">
              {SETTINGS_SECTIONS.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    className="settings-nav-item"
                    // aria-current rather than aria-selected: these are links into one
                    // document, not tabs over separate panels.
                    aria-current={activeSection === section.id ? 'true' : undefined}
                    onClick={() => jumpToSection(section.id)}
                  >
                    {t(section.labelKey)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="settings-dialog-content" ref={contentRef} onScroll={handleContentScroll}>
            <section className="settings-section" ref={registerSection('general')} aria-labelledby="settings-section-general">
              <h3 className="settings-section-title" id="settings-section-general">
                {t('settings.sectionGeneral')}
              </h3>

              <div className="settings-dialog-section">
                <span className="settings-dialog-label" id="settings-startup-label">
                  {t('settings.launchAtLogin')}
                </span>
                <button
                  type="button"
                  className="settings-switch"
                  role="switch"
                  aria-checked={autoLaunch === true}
                  aria-labelledby="settings-startup-label"
                  disabled={autoLaunch === null}
                  onClick={() => void handleAutoLaunchToggle()}
                >
                  <span className="settings-switch-thumb" aria-hidden="true" />
                </button>
              </div>
              {autoLaunchError && (
                <p className="settings-dialog-error" role="alert">
                  {autoLaunchError}
                </p>
              )}

              <div className="settings-dialog-section">
                <span className="settings-dialog-label" id="settings-theme-label">
                  {t('settings.theme')}
                </span>
                <div className="settings-theme-toggle" role="group" aria-labelledby="settings-theme-label">
                  <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
                    {t('settings.themeDark')}
                  </button>
                  <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
                    {t('settings.themeLight')}
                  </button>
                </div>
              </div>

              <div className="settings-dialog-section">
                <span className="settings-dialog-label" id="settings-language-label">
                  {t('settings.language')}
                </span>
                <div className="settings-theme-toggle" role="group" aria-labelledby="settings-language-label">
                  {LOCALES.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={locale === option.value}
                      onClick={() => setLocale(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-dialog-section">
                <span className="settings-dialog-label" id="settings-quick-prompts-label">
                  {t('settings.showQuickPrompts')}
                </span>
                <button
                  type="button"
                  className="settings-switch"
                  role="switch"
                  aria-checked={showQuickPrompts}
                  aria-labelledby="settings-quick-prompts-label"
                  onClick={() => setShowQuickPrompts(!showQuickPrompts)}
                >
                  <span className="settings-switch-thumb" aria-hidden="true" />
                </button>
              </div>
            </section>

            <section className="settings-section" ref={registerSection('sessionKinds')} aria-labelledby="settings-session-kinds-label">
              <h3 className="settings-section-title" id="settings-session-kinds-label">
                {t('settings.sessionKinds')}
              </h3>
              <p className="settings-dialog-hint">{t('settings.sessionKindsHint')}</p>
              <ul className="settings-kind-list" aria-labelledby="settings-session-kinds-label">
                {/* Column captions only: each switch below carries its own full accessible name
                    ("Enable Claude", "New worktree for Claude"), so these are decorative. */}
                <li className="settings-kind-row settings-kind-head" aria-hidden="true">
                  <span />
                  <span>{t('settings.columnEnabled')}</span>
                  <span>{t('settings.columnWorktree')}</span>
                </li>
                {primaryKinds.map(renderKindRow)}
              </ul>
              {/* The opt-in agent CLIs are all switched off by default, so listing them next to
                  the four that are on would bury them in a ten-row wall. They are removed from
                  the page while collapsed rather than dimmed: a row the user cannot act on yet
                  is noise, and the disclosure says how many are waiting. */}
              {additionalKinds.length > 0 && (
                <>
                  <button
                    type="button"
                    id="settings-more-kinds-toggle"
                    className="settings-kind-more-toggle"
                    aria-expanded={moreKindsExpanded}
                    onClick={() => setMoreKindsExpanded((expanded) => !expanded)}
                  >
                    {t('settings.moreSessionKinds', { count: additionalKinds.length })}
                  </button>
                  {moreKindsExpanded && (
                    <ul className="settings-kind-list" aria-labelledby="settings-more-kinds-toggle">
                      {additionalKinds.map(renderKindRow)}
                    </ul>
                  )}
                </>
              )}
            </section>

            <section className="settings-section" ref={registerSection('updates')} aria-labelledby="settings-section-updates">
              <h3 className="settings-section-title" id="settings-section-updates">
                {t('settings.sectionUpdates')}
              </h3>

              <div className="settings-dialog-section">
                <span className="settings-dialog-label">
                  {t('settings.version')}
                  <span className="settings-version-value">{appInfo?.version ?? t('settings.versionUnknown')}</span>
                </span>
                <button
                  type="button"
                  className="settings-update-button"
                  disabled={updateState.phase === 'checking'}
                  onClick={() => void handleCheckForUpdates()}
                >
                  {updateState.phase === 'checking' ? t('settings.checking') : t('settings.checkForUpdates')}
                </button>
              </div>
              {updateState.phase === 'done' && (
                <p className="settings-update-status" role="status" data-status={updateState.result.status}>
                  {updateMessage(updateState.result, t)}
                  {/* Only a release with an installer supported by this platform can be downloaded
                      in-app; otherwise the Releases page stays the only thing to offer. */}
                  {downloadableUpdate && (
                    <button
                      type="button"
                      className="settings-inline-action"
                      onClick={() => handleUpdateNow(downloadableUpdate.latestVersion)}
                    >
                      {t('settings.updateNow')}
                    </button>
                  )}
                  {updateState.result.status === 'available' && (
                    <button type="button" className="settings-inline-link" onClick={() => openLink('download')}>
                      {t('settings.linkDownload')}
                    </button>
                  )}
                </p>
              )}
            </section>

            <section className="settings-section" ref={registerSection('about')} aria-labelledby="settings-section-about">
              <h3 className="settings-section-title" id="settings-section-about">
                {t('settings.about')}
              </h3>
              <ul className="settings-link-list">
                {LINK_ITEMS.map((item) => (
                  <li key={item.target}>
                    <button
                      type="button"
                      className="settings-link"
                      title={appInfo?.links[item.target]}
                      onClick={() => openLink(item.target)}
                    >
                      <span className="settings-link-label">{t(item.labelKey)}</span>
                      <svg
                        className="settings-link-icon"
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
