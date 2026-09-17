import { create } from 'zustand'

import { AGENT_KINDS, isAgentKind, type AgentKind } from '../../../shared/agent-kinds'
import { AgentActivityTracker } from '../../../shared/agent-activity'
import type { TerminalDataEvent } from '../../../shared/pty-protocol'
import type {
  AppState,
  CapabilityState,
  CloneProjectRequest,
  DeleteSessionResult,
  HostPlatform,
  ProjectRecord,
  SessionKind,
  SessionRecord,
  SessionKindPreference,
  SessionKindPreferences,
  ThemePreference,
  ToolAvailability
} from '../../../shared/contracts'
import { DEFAULT_SESSION_KIND_PREFERENCES, storedSessionKindPreferencesSchema } from '../../../shared/contracts'
import { THEME_PREFERENCES } from '../../../shared/themes'
import { emptyWorkspace, reconcileWorkspace } from '../../../shared/workspace-state'
import {
  DEFAULT_AUTO_SHUTDOWN,
  SHUTDOWN_COUNTDOWN_SECONDS,
  countdownTick,
  hasRunningSessions,
  isAutoShutdownAllowedAt,
  isAutoShutdownInterval,
  isAutoShutdownTimeRange,
  parseStoredAutoShutdown,
  type AutoShutdownPreference,
  type AutoShutdownTimeRange
} from '../auto-shutdown'
import { DEFAULT_LOCALE, isLocale, translate, type Locale } from '../i18n'
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, parseStoredSidebarWidth } from '../sidebar-width'
import { defaultSessionKindPreferences } from '../session-kind-options'
import { QUICK_PROMPTS_STORAGE_KEY, quickPromptsSchema, readStoredQuickPrompts, type QuickPrompt } from '../quick-prompts'
import { readMigratedStorage } from '../storage-migration'

export type Notice = {
  message: string
  tone: 'error' | 'info'
}

/**
 * The in-app update flow, from "a newer release exists" to "the installer is on disk".
 * `idle` is the resting state and the only one that renders no dialog, so every terminal
 * outcome — declined, cancelled, or installed — comes back here. `downloadable` is false
 * when this platform cannot install the release in-app: the only thing left to offer is the
 * download page.
 */
export type UpdaterState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string; downloadable: boolean }
  | { phase: 'downloading'; version: string; receivedBytes: number; totalBytes: number }
  | { phase: 'ready'; version: string }
  | { phase: 'installing'; version: string }
  | { phase: 'error'; version: string; message: string }

export type AppStore = {
  platform: HostPlatform
  appState: AppState
  capabilities: CapabilityState
  activeProjectId: string | null
  activeSessionId: string | null
  sessionFocusRequest: number
  collapsedProjectIds: string[]
  launcherOpen: boolean
  creatingSession: { projectId: string; kind: SessionKind; worktree: boolean } | null
  searchQuery: string
  notice: Notice | null
  /** Quiet agent sessions with no reported foreground or background work. */
  idleAgentSessionIds: Record<string, true>
  unreadSessionIds: string[]
  theme: ThemePreference
  locale: Locale
  /** Whether the window is kept above every other window (the title bar's pin button). */
  windowPinned: boolean
  /** The title bar's auto-shutdown switch and how often it checks for running sessions. */
  autoShutdown: AutoShutdownPreference
  /** Seconds left on the shutdown countdown, or null when no countdown is running. */
  shutdownCountdown: number | null
  /** Which kinds the New session launcher lists, and which of them offer a worktree entry. */
  sessionKindPreferences: SessionKindPreferences
  /** Project sidebar width in CSS pixels, already clamped (see sidebar-width.ts). */
  sidebarWidth: number
  quickPrompts: QuickPrompt[]
  showQuickPrompts: boolean
  notificationsEnabled: boolean
  /** Drives UpdateDialog; `idle` renders nothing at all. */
  updater: UpdaterState

  initialize: () => () => void
  reset: () => void

  checkForUpdatesInBackground: () => Promise<void>
  beginUpdate: (version: string, downloadable: boolean) => void
  startUpdateDownload: () => Promise<void>
  cancelUpdateDownload: () => Promise<void>
  installUpdate: () => Promise<void>
  dismissUpdate: () => void

  setTheme: (theme: ThemePreference) => void
  setLocale: (locale: Locale) => void
  setWindowPinned: (pinned: boolean) => void
  setAutoShutdownEnabled: (enabled: boolean) => void
  setAutoShutdownInterval: (intervalMs: number) => void
  /** Switches the time-of-day restriction on or off; the window itself is kept either way. */
  setAutoShutdownTimeRangeEnabled: (enabled: boolean) => void
  setAutoShutdownTimeRange: (timeRange: AutoShutdownTimeRange) => void
  /** Stops the countdown and switches auto shutdown off, which is what "Cancel" means here. */
  cancelAutoShutdown: () => void
  /** Skips the rest of the countdown and shuts the machine down now. */
  shutdownNow: () => Promise<void>
  setSessionKindPreference: (kind: SessionKind, change: Partial<SessionKindPreference>) => void
  /** Clamps to the current viewport before storing, so callers can pass raw pointer maths. */
  setSidebarWidth: (width: number) => void
  resetSidebarWidth: () => void
  setQuickPrompts: (prompts: QuickPrompt[]) => boolean
  setShowQuickPrompts: (show: boolean) => void
  setNotificationsEnabled: (enabled: boolean) => void

  addProject: (source?: { recentProjectId: string } | CloneProjectRequest) => Promise<boolean>
  removeRecentProject: (projectId: string) => Promise<void>
  reorderProjects: (orderedProjectIds: readonly string[]) => Promise<void>
  openProjectInVSCode: (projectId: string) => Promise<void>
  openProjectFolder: (projectId: string) => Promise<void>
  openProjectRepository: (projectId: string) => Promise<void>
  copyProjectPath: (projectId: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>

  openLauncher: () => void
  closeLauncher: () => void
  createSession: (projectId: string, kind: SessionKind, worktree: boolean) => Promise<void>

  setActiveProject: (projectId: string) => void
  toggleProjectCollapsed: (projectId: string) => void
  setProjectsCollapsed: (projectIds: string[], collapsed: boolean) => void
  setActiveSession: (sessionId: string, projectId?: string) => void
  restoreSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<boolean>
  stopSession: (sessionId: string) => Promise<void>
  reorderSessions: (orderedSessionIds: readonly string[]) => Promise<void>
  deleteSession: (sessionId: string) => Promise<DeleteSessionResult | undefined>

  setSearchQuery: (query: string) => void
  dismissNotice: () => void
}

const emptyAppState = (): AppState => ({ version: 1, projects: [], sessions: [] })

// Whether the user can actually see the window right now. Three things need this: unread
// markers, the Done-edge notification, and the badge.
//
// The `visibilityState` half is dead weight in production: window.ts sets
// `backgroundThrottling: false` (so the three-second Done-edge timer keeps firing while
// hidden), and Electron's own docs say that option "also affects the Page Visibility API" — a
// minimized/occluded window never reports hidden, so `visibilityState` stays 'visible'
// regardless. `hasFocus()` alone is what actually separates attended from unattended today.
// Left in place because it becomes live again if that throttling trade-off is ever revisited.
const isWindowAttended = (): boolean => document.visibilityState !== 'hidden' && document.hasFocus()

const isViewingSession = (sessionId: string, activeSessionId: string | null): boolean =>
  sessionId === activeSessionId && isWindowAttended()

// The resting state the launcher may already be reading from: it looks availability up by
// kind with nothing to fall back to, so every agent kind needs an entry before the first
// snapshot replaces the whole object.
const defaultCapabilities = (): CapabilityState => ({
  ...(Object.fromEntries(
    AGENT_KINDS.map((kind) => [kind, { available: false, detail: 'Checking availability…' }])
  ) as Record<AgentKind, ToolAvailability>),
  vscode: { available: false, detail: 'Checking availability…' }
})

const errorMessage = (error: unknown, locale: Locale): string =>
  error instanceof Error ? error.message : translate(locale, 'notice.genericError')

export const THEME_STORAGE_KEY = 'codeflai.theme'
export const LOCALE_STORAGE_KEY = 'codeflai.locale'
export const SESSION_KINDS_STORAGE_KEY = 'codeflai.sessionKinds'
export const SIDEBAR_WIDTH_STORAGE_KEY = 'codeflai.sidebarWidth'
export const WINDOW_PINNED_STORAGE_KEY = 'codeflai.windowPinned'
export const SHOW_QUICK_PROMPTS_STORAGE_KEY = 'codeflai.showQuickPrompts'
export const AUTO_SHUTDOWN_STORAGE_KEY = 'codeflai.autoShutdown'
export const NOTIFICATIONS_STORAGE_KEY = 'codeflai.notifications'

// The theme preference is renderer-owned (localStorage), not part of the main process's
// persisted AppState: it is pure presentation, and localStorage survives restarts without
// widening the state-file schema. Anything unrecognized (including a missing key on first
// launch) falls back to dark, the app's original and default look.
const readStoredTheme = (): ThemePreference => {
  try {
    const stored = readMigratedStorage(THEME_STORAGE_KEY)
    return THEME_PREFERENCES.find((theme) => theme === stored) ?? 'dark'
  } catch {
    return 'dark'
  }
}

// Applies a theme everywhere outside this store's own state: the CSS token switch
// (styles.css keys off html[data-theme]), the persisted preference, and the main process
// (native theme + window caption-button overlay colors, via theme:set).
const applyThemeEffects = (theme: ThemePreference): void => {
  document.documentElement.dataset.theme = theme
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // localStorage unavailable: the preference just won't survive a restart.
  }
  window.codeflai.setTheme(theme).catch(() => undefined)
}

// The UI language is renderer-owned (localStorage) for the same reasons as the theme: it is
// pure presentation and never crosses into the persisted AppState. Anything unrecognized —
// including a first launch with no stored key — falls back to DEFAULT_LOCALE (English), which
// keeps startup copy deterministic regardless of the host OS language.
const readStoredLocale = (): Locale => {
  try {
    const stored = readMigratedStorage(LOCALE_STORAGE_KEY)
    return isLocale(stored) ? stored : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

// Applies a locale everywhere outside this store's own state: the persisted preference and
// the document language (which drives font fallback and assistive-technology pronunciation).
const applyLocaleEffects = (locale: Locale): void => {
  document.documentElement.lang = locale
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // localStorage unavailable: the preference just won't survive a restart.
  }
}

// Pinning (always-on-top) is renderer-owned (localStorage) like the theme: pure window chrome
// that never belongs in the persisted AppState. Anything but an explicit "true" — including a
// first launch with no stored key — means unpinned, the ordinary window behaviour.
const readStoredWindowPinned = (): boolean => {
  try {
    return readMigratedStorage(WINDOW_PINNED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

const readStoredShowQuickPrompts = (): boolean => {
  try {
    const stored = readMigratedStorage(SHOW_QUICK_PROMPTS_STORAGE_KEY, ['codefly.showQuickPhrases', 'codeflai.showQuickPhrases'])
    return stored === 'true'
  } catch {
    return false
  }
}

/**
 * Unlike the other presentation preferences this defaults to **on**, so only an explicit
 * 'false' switches it off. A toast fires only while the window is unattended and reports
 * exactly the event the user is waiting for, and a storage failure must not silently take the
 * feature away. (Auto shutdown defaults off for the opposite reason: it is irreversible.)
 */
const readStoredNotifications = (): boolean => {
  try {
    return window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

// Applies pinning everywhere outside this store's own state: the persisted preference and the
// window itself (via window:pinned-set). Resolves with the flag the window actually ended up
// with, which is what the button should show if a window manager refused the request.
const applyWindowPinnedEffects = (pinned: boolean): Promise<boolean> => {
  try {
    window.localStorage.setItem(WINDOW_PINNED_STORAGE_KEY, String(pinned))
  } catch {
    // localStorage unavailable: the preference just won't survive a restart.
  }
  return window.codeflai.setWindowPinned(pinned).catch(() => pinned)
}

// Auto shutdown is renderer-owned (localStorage) like the theme and the pin: the preference
// configures a renderer-side watcher, and all that ever crosses IPC is the shutdown request
// itself. Unreadable storage means the defaults, which are "switched off" — the only safe
// direction for a preference that powers the machine down.
const readStoredAutoShutdown = (): AutoShutdownPreference => {
  try {
    return parseStoredAutoShutdown(readMigratedStorage(AUTO_SHUTDOWN_STORAGE_KEY))
  } catch {
    return { ...DEFAULT_AUTO_SHUTDOWN }
  }
}

const persistAutoShutdown = (preference: AutoShutdownPreference): void => {
  try {
    window.localStorage.setItem(AUTO_SHUTDOWN_STORAGE_KEY, JSON.stringify(preference))
  } catch {
    // localStorage unavailable: the preference just won't survive a restart.
  }
}

// The per-kind launcher preferences are renderer-owned (localStorage) for the same reasons as
// the theme and locale: they configure the launcher menu rather than any persisted session,
// and the actual worktree decision crosses IPC explicitly with every create request. Stored
// values are merged over the defaults field by field, so anything unreadable or partial
// degrades to the documented defaults instead of an empty or half-filled record.
const mergeStoredSessionKinds = (stored: unknown, platform: HostPlatform): SessionKindPreferences => {
  const defaults = defaultSessionKindPreferences(platform)
  const parsed = storedSessionKindPreferencesSchema.safeParse(stored)
  if (!parsed.success) return defaults
  const merged = { ...defaults }
  for (const kind of Object.keys(merged) as SessionKind[]) {
    merged[kind] = { ...merged[kind], ...parsed.data[kind] }
  }
  return merged
}

const readStoredSessionKindPreferences = (platform: HostPlatform): SessionKindPreferences => {
  try {
    const stored = readMigratedStorage(SESSION_KINDS_STORAGE_KEY)
    if (stored === null) return defaultSessionKindPreferences(platform)
    return mergeStoredSessionKinds(JSON.parse(stored), platform)
  } catch {
    return defaultSessionKindPreferences(platform)
  }
}

const persistSessionKindPreferences = (preferences: SessionKindPreferences): void => {
  try {
    window.localStorage.setItem(SESSION_KINDS_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // localStorage unavailable: the preference just won't survive a restart.
  }
}

// The sidebar width is renderer-owned (localStorage) like the theme: pure layout, never part
// of the persisted AppState. It is re-clamped against the viewport on read so a value saved
// on a wide monitor cannot swallow the workspace on a narrower one.
const readStoredSidebarWidth = (): number => {
  try {
    return parseStoredSidebarWidth(readMigratedStorage(SIDEBAR_WIDTH_STORAGE_KEY), window.innerWidth)
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

const persistSidebarWidth = (width: number): void => {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // localStorage unavailable: the preference just won't survive a restart.
  }
}

/**
 * How long a running agent session's PTY output must stay quiet before the session
 * counts as Done when the CLI has not reported ongoing foreground/background work.
 * Explicit activity survives silence; older CLIs retain the quiet-window fallback.
 */
export const AGENT_IDLE_MS = 3_000

// Pending quiet-window timers per session, module-level because they are bookkeeping for
// the store's idleAgentSessionIds, not renderable state themselves.
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
const agentActivities = new Map<string, AgentActivityTracker>()
let activityEpoch = 0

const clearIdleTimer = (sessionId: string): void => {
  const timer = idleTimers.get(sessionId)
  if (timer === undefined) return
  clearTimeout(timer)
  idleTimers.delete(sessionId)
}

// The auto-shutdown watcher's two timers, module-level for the same reason the idle timers
// are: they are bookkeeping for the store's state, not renderable state themselves. Only one
// of them ever runs — the periodic check is stopped while the countdown is on screen, so a
// second countdown can never be armed on top of the first.
let autoShutdownTimer: ReturnType<typeof setInterval> | undefined
let shutdownCountdownTimer: ReturnType<typeof setInterval> | undefined
// When the countdown runs out, in wall-clock terms. The tick reads this rather than counting
// itself down, so a throttled or delayed tick cannot stretch ten seconds into ten minutes.
let shutdownDeadline: number | undefined

const clearAutoShutdownTimers = (): void => {
  if (autoShutdownTimer !== undefined) clearInterval(autoShutdownTimer)
  if (shutdownCountdownTimer !== undefined) clearInterval(shutdownCountdownTimer)
  autoShutdownTimer = undefined
  shutdownCountdownTimer = undefined
  shutdownDeadline = undefined
}

const clearAllIdleTimers = (): void => {
  for (const timer of idleTimers.values()) clearTimeout(timer)
  idleTimers.clear()
  agentActivities.clear()
  activityEpoch += 1
}

const upsertProject = (state: AppState, project: ProjectRecord): AppState => {
  const index = state.projects.findIndex((candidate) => candidate.id === project.id)
  const projects = index === -1 ? [...state.projects, project] : state.projects.map((candidate, i) => (i === index ? project : candidate))
  return {
    ...state,
    projects,
    ...(state.recentProjects ? { recentProjects: state.recentProjects.filter((entry) => entry.id !== project.id) } : {})
  }
}

const upsertSession = (state: AppState, session: SessionRecord): AppState => {
  const index = state.sessions.findIndex((candidate) => candidate.id === session.id)
  const sessions = index === -1 ? [...state.sessions, session] : state.sessions.map((candidate, i) => (i === index ? session : candidate))
  return { ...state, sessions }
}

/**
 * Renderer-side application state. Actions call window.codeflai and merge the returned
 * record into appState immediately (an optimistic-but-authoritative update, since the
 * record IS what the main process just persisted); onStateChanged additionally replaces
 * appState wholesale whenever the main process broadcasts it, which is the durable source
 * of truth for anything this store did not itself just request. Rejections crossing
 * ipcRenderer.invoke arrive as generic Error instances (Electron strips subclass identity),
 * so every catch here only reads error.message and never branches on error type.
 */
export const useAppStore = create<AppStore>()((set, get) => {
  /**
   * Sessions the user asked to end. The window-attended check already covers the common case —
   * the window has focus at the moment Stop or Delete is clicked — but "stop it, then switch
   * away before the exit event lands" is a real race, and a toast reporting that a session the
   * user just stopped has stopped is worse than no toast.
   *
   * An entry only survives while a termination is actually pending: a refused or failed stop
   * or delete leaves the session running, and its eventual exit is its own news again.
   */
  const expectedExits = new Set<string>()

  const syncBadge = (): void => {
    const { notificationsEnabled, unreadSessionIds, locale } = get()
    const count = notificationsEnabled ? unreadSessionIds.length : 0
    window.codeflai.setUnreadBadge(count, count > 0 ? translate(locale, 'sidebar.unreadCount', { count }) : '')
  }

  const markViewedSessionRead = (): void => {
    const { activeSessionId, unreadSessionIds } = get()
    if (!activeSessionId || !unreadSessionIds.includes(activeSessionId) || !isViewingSession(activeSessionId, activeSessionId)) return
    set({ unreadSessionIds: unreadSessionIds.filter((id) => id !== activeSessionId) })
    syncBadge()
  }

  const noteUnreadOutput = (sessionId: string): void => {
    const { appState, activeSessionId, unreadSessionIds } = get()
    if (!appState.sessions.some((session) => session.id === sessionId) ||
      isViewingSession(sessionId, activeSessionId) || unreadSessionIds.includes(sessionId)) return
    set({ unreadSessionIds: [...unreadSessionIds, sessionId] })
    syncBadge()
  }

  const unmarkIdle = (sessionId: string): void => {
    clearIdleTimer(sessionId)
    if (get().idleAgentSessionIds[sessionId] !== true) return
    set((state) => {
      const { [sessionId]: _drop, ...rest } = state.idleAgentSessionIds
      return { idleAgentSessionIds: rest as Record<string, true> }
    })
  }

  const forgetAgentActivity = (sessionId: string): void => {
    agentActivities.delete(sessionId)
    unmarkIdle(sessionId)
  }

  // Any PTY output from an agent session restarts its quiet window; the session is marked
  // idle (Done) only when that window elapses with no further output. Shells and unknown
  // session ids (data can arrive before the snapshot loads) are ignored entirely.
  //
  // `onIdle` is how unread activity is raised: the Done edge — not the arrival of bytes — is
  // what the user actually wants to be told about, since agent TUIs repaint spinners and
  // elapsed-time counters continuously. It fires only for a timer armed by live output, so
  // replaying the retained tail on startup can never fabricate unread activity.
  const noteAgentOutput = (
    sessionId: string,
    data: string,
    replay = false,
    onIdle?: (sessionId: string) => void
  ): void => {
    const session = get().appState.sessions.find((candidate) => candidate.id === sessionId)
    if (!session || session.status !== 'running' || !isAgentKind(session.kind)) return

    let activity = agentActivities.get(sessionId)
    if (!activity) {
      activity = new AgentActivityTracker(session.kind)
      agentActivities.set(sessionId, activity)
    }
    if (replay) activity.writeReplay(data)
    else activity.write(data)
    unmarkIdle(sessionId)
    if (activity.running === true) return
    idleTimers.set(
      sessionId,
      setTimeout(() => {
        idleTimers.delete(sessionId)
        if (agentActivities.get(sessionId) !== activity || activity.running === true ||
          !get().appState.sessions.some((candidate) => candidate.id === sessionId && candidate.status === 'running')) return
        set((state) => ({ idleAgentSessionIds: { ...state.idleAgentSessionIds, [sessionId]: true } }))
        if (!replay) onIdle?.(sessionId)
      }, AGENT_IDLE_MS)
    )
  }

  /**
   * Powers the machine off. Never rejects: a refusal comes back from the main process as an
   * `error` result, and a rejected invoke is treated the same way.
   *
   * A failed shutdown also switches auto shutdown off. Whatever stopped the command — no
   * permission, a policy — will stop the next one too, and the alternative is a dialog that
   * reappears every interval forever. The user is told why in a notice.
   */
  const performShutdown = async (): Promise<void> => {
    clearAutoShutdownTimers()
    set({ shutdownCountdown: null })
    try {
      const result = await window.codeflai.shutdownSystem()
      if (result.status !== 'error') return
      get().setAutoShutdownEnabled(false)
      set({ notice: { message: translate(get().locale, 'notice.shutdownFailed', { reason: result.message }), tone: 'error' } })
    } catch (error) {
      get().setAutoShutdownEnabled(false)
      set({ notice: { message: translate(get().locale, 'notice.shutdownFailed', { reason: errorMessage(error, get().locale) }), tone: 'error' } })
    }
  }

  // Opens the countdown dialog and stops the periodic check: from here the only outcomes are
  // the user cancelling, the user shutting down now, or the countdown reaching zero.
  const startShutdownCountdown = (): void => {
    clearAutoShutdownTimers()
    shutdownDeadline = Date.now() + SHUTDOWN_COUNTDOWN_SECONDS * 1_000
    set({ shutdownCountdown: SHUTDOWN_COUNTDOWN_SECONDS })
    shutdownCountdownTimer = setInterval(() => {
      const step = countdownTick(shutdownDeadline ?? 0, Date.now())
      if (step === 'shutdown') {
        void performShutdown()
        return
      }
      // The machine slept through its own countdown: hand the ten seconds back rather than
      // powering off the moment the screen comes on. A sleep long enough to be noticed here
      // can also have carried the clock straight out of the allowed window — that is what an
      // 8am lid-open looks like — so the countdown is abandoned rather than restarted, and
      // the periodic check takes over again.
      if (step === 'restart') {
        if (!isAutoShutdownAllowedAt(get().autoShutdown, new Date())) {
          set({ shutdownCountdown: null })
          restartAutoShutdownWatcher()
          return
        }
        startShutdownCountdown()
        return
      }
      set({ shutdownCountdown: step })
    }, 1_000)
  }

  // One tick of the watcher: anything the sidebar still calls Running (or Starting…) buys the
  // machine another interval, and so does a clock outside the configured window. An agent
  // sitting at Done does not — see hasRunningSessions.
  const runAutoShutdownCheck = (): void => {
    if (get().shutdownCountdown !== null) return
    if (!isAutoShutdownAllowedAt(get().autoShutdown, new Date())) return
    if (hasRunningSessions(get().appState.sessions, get().idleAgentSessionIds)) return
    startShutdownCountdown()
  }

  /**
   * Restarts the periodic check from the preference in state. Called on every change to the
   * switch and the frequency, which deliberately restarts the countdown clock too: picking
   * "1m" should mean a minute from now, not a minute from whenever the last timer started.
   * The first check is always a full interval away — an immediate one would shut an idle
   * machine down the instant the switch was flicked.
   */
  const restartAutoShutdownWatcher = (): void => {
    clearAutoShutdownTimers()
    const { enabled, intervalMs } = get().autoShutdown
    if (!enabled) return
    autoShutdownTimer = setInterval(runAutoShutdownCheck, intervalMs)
  }

  return {
    platform: 'win32',
    appState: emptyAppState(),
    capabilities: defaultCapabilities(),
    activeProjectId: null,
    activeSessionId: null,
    sessionFocusRequest: 0,
    collapsedProjectIds: [],
    launcherOpen: false,
    creatingSession: null,
    searchQuery: '',
    notice: null,
    idleAgentSessionIds: {},
    unreadSessionIds: [],
    theme: 'dark',
    locale: DEFAULT_LOCALE,
    windowPinned: false,
    autoShutdown: { ...DEFAULT_AUTO_SHUTDOWN },
    shutdownCountdown: null,
    sessionKindPreferences: DEFAULT_SESSION_KIND_PREFERENCES,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    quickPrompts: [],
    showQuickPrompts: false,
    notificationsEnabled: true,
    updater: { phase: 'idle' },

    initialize: () => {
      let disposed = false
      let snapshotLoaded = false
      let hydratingWorkspace = false
      let workspaceChanged = false
      let latestBroadcast: AppState | undefined
      let unreadPersisted = false
      const pendingActivity = new Map<string, TerminalDataEvent[]>()
      const pendingUnread = new Set<string>()
      const startupRead = new Set<string>()
      const acknowledgeViewedSession = (): void => {
        const { activeSessionId } = get()
        if (!activeSessionId || !isViewingSession(activeSessionId, activeSessionId)) return
        if (!snapshotLoaded) {
          startupRead.add(activeSessionId)
          pendingUnread.delete(activeSessionId)
        }
        markViewedSessionRead()
      }
      const recordUnread = (sessionId: string): void => {
        if (snapshotLoaded) noteUnreadOutput(sessionId)
        else if (isViewingSession(sessionId, get().activeSessionId)) {
          startupRead.add(sessionId)
          pendingUnread.delete(sessionId)
        } else {
          pendingUnread.add(sessionId)
          startupRead.delete(sessionId)
        }
      }
      const notifySessionEvent = (sessionId: string, reason: 'idle' | 'exit'): void => {
        const { notificationsEnabled, appState, locale } = get()
        if (!snapshotLoaded || !notificationsEnabled || isWindowAttended()) return
        const session = appState.sessions.find((candidate) => candidate.id === sessionId)
        if (!session) return
        const project = appState.projects.find((candidate) => candidate.id === session.projectId)
        const reasonKey = reason === 'idle' ? 'notification.agentDone' : 'notification.sessionExited'
        // projectRecordSchema.name has no upper bound (a Windows/macOS path component can run to
        // ~255 chars) but notificationIdleRequestSchema.body caps at 200; an over-long body is
        // dropped by the main process's own safeParse with nothing logged (onNotificationIdle),
        // so that project would silently stop notifying forever. Reserve room for the template's
        // own fixed text (it varies by locale and reason) instead of guessing a fixed budget, so
        // the composed body can never cross the cap. A missing project falls back to a named
        // placeholder rather than leaving the template's separator dangling at the front.
        const fixedTextLength = translate(locale, reasonKey, { project: '' }).length
        const projectName = project?.name || translate(locale, 'notification.unknownProject')
        const body = translate(locale, reasonKey, { project: projectName.slice(0, Math.max(0, 200 - fixedTextLength)) })
        // sessionRecordSchema.title has no upper bound but notificationIdleRequestSchema caps
        // it at 200, so an over-long title would be dropped by our own validation.
        window.codeflai.notifySessionIdle(sessionId, session.title.slice(0, 200), body)
      }
      const onAgentIdle = (sessionId: string): void => {
        recordUnread(sessionId)
        notifySessionEvent(sessionId, 'idle')
      }
      const hydrateActivity = (sessionId: string): void => {
        const pending = pendingActivity.get(sessionId) ?? []
        pendingActivity.set(sessionId, pending)
        const epoch = activityEpoch
        void window.codeflai.replayTerminal(sessionId).catch(() => undefined).then((replay) => {
          if (disposed || pendingActivity.get(sessionId) !== pending) return
          pendingActivity.delete(sessionId)
          if (activityEpoch !== epoch) return
          if (replay?.data) noteAgentOutput(sessionId, replay.data, true, onAgentIdle)
          for (const event of pending) {
            if (replay && event.sequence !== undefined && event.sequence <= replay.throughSequence) continue
            noteAgentOutput(sessionId, event.data, false, onAgentIdle)
          }
        })
      }
      set({
        sidebarWidth: readStoredSidebarWidth(),
        quickPrompts: readStoredQuickPrompts(),
        showQuickPrompts: readStoredShowQuickPrompts(),
        notificationsEnabled: readStoredNotifications()
      })

      const persistWorkspace = (): void => {
        const { activeProjectId, activeSessionId, collapsedProjectIds, unreadSessionIds } = get()
        if (snapshotLoaded && unreadSessionIds.length > 0) unreadPersisted = true
        void window.codeflai.saveWorkspace({
          activeProjectId, activeSessionId, collapsedProjectIds,
          ...(snapshotLoaded && unreadPersisted ? { unreadSessionIds } : {})
        }).catch((error: unknown) => {
          if (!disposed) set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
        })
      }

      // Save every navigation change, including selections made by create/delete actions.
      // Suppress hydration writes, but persist clicks even while capabilities are loading.
      const disposeWorkspace = useAppStore.subscribe((state, previous) => {
        if (!snapshotLoaded && state.activeSessionId !== previous.activeSessionId && state.activeSessionId &&
          isViewingSession(state.activeSessionId, state.activeSessionId)) {
          startupRead.add(state.activeSessionId)
          pendingUnread.delete(state.activeSessionId)
        }
        if (state.activeSessionId !== previous.activeSessionId && state.activeSessionId &&
          state.unreadSessionIds.includes(state.activeSessionId) && isViewingSession(state.activeSessionId, state.activeSessionId)) {
          markViewedSessionRead()
          return
        }
        if (
          state.activeProjectId !== previous.activeProjectId ||
          state.activeSessionId !== previous.activeSessionId ||
          state.collapsedProjectIds !== previous.collapsedProjectIds ||
          state.unreadSessionIds !== previous.unreadSessionIds
        ) {
          workspaceChanged = true
          if (!hydratingWorkspace) persistWorkspace()
        }
      })

      const storedLocale = readStoredLocale()
      set({ locale: storedLocale })
      applyLocaleEffects(storedLocale)

      const storedTheme = readStoredTheme()
      set({ theme: storedTheme })
      // Re-applied on every startup (even for the dark default) so the main process's
      // nativeTheme/overlay colors always converge with the renderer preference.
      applyThemeEffects(storedTheme)

      const storedAutoShutdown = readStoredAutoShutdown()
      set({ autoShutdown: storedAutoShutdown })
      // Armed from the stored preference, so a machine left with auto shutdown on keeps
      // powering itself off after a restart. The first check is one full interval away.
      restartAutoShutdownWatcher()

      const storedPinned = readStoredWindowPinned()
      set({ windowPinned: storedPinned })
      // Replayed on every startup (even for the unpinned default) so the window's own
      // always-on-top flag converges with the renderer preference.
      void applyWindowPinnedEffects(storedPinned)

      window.codeflai
        .getSnapshot()
        .then((snapshot) => {
          if (disposed) return
          const appState = latestBroadcast ?? snapshot.state
          unreadPersisted = snapshot.state.workspace?.unreadSessionIds !== undefined
          document.documentElement.dataset.platform = snapshot.platform
          hydratingWorkspace = true
          set((state) => ({
            platform: snapshot.platform,
            appState,
            capabilities: snapshot.capabilities,
            sessionKindPreferences: readStoredSessionKindPreferences(snapshot.platform),
            ...reconcileWorkspace({
              ...(workspaceChanged ? state : snapshot.state.workspace ?? emptyWorkspace()),
              unreadSessionIds: (snapshot.state.workspace?.unreadSessionIds ?? []).filter((id) => !startupRead.has(id))
            }, appState),
            notice: snapshot.recoveryWarning ? { message: snapshot.recoveryWarning, tone: 'info' } : state.notice
          }))
          hydratingWorkspace = false
          snapshotLoaded = true
          // Unread survives restarts, so the badge has to start from the restored count.
          syncBadge()
          markViewedSessionRead()
          for (const sessionId of pendingUnread) {
            const queued = appState.sessions.find((candidate) => candidate.id === sessionId)
            if (queued && isAgentKind(queued.kind)) continue
            noteUnreadOutput(sessionId)
          }
          pendingUnread.clear()
          startupRead.clear()
          for (const sessionId of pendingActivity.keys()) {
            if (!appState.sessions.some((session) => session.id === sessionId && session.status === 'running' &&
              isAgentKind(session.kind))) pendingActivity.delete(sessionId)
          }
          for (const session of appState.sessions) {
            if (session.status === 'running' && isAgentKind(session.kind)) hydrateActivity(session.id)
          }
          persistWorkspace()
        })
        .catch((error: unknown) => {
          if (disposed) return
          snapshotLoaded = true
          pendingActivity.clear()
          pendingUnread.clear()
          startupRead.clear()
          set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
        })

      const disposeState = window.codeflai.onStateChanged((state) => {
        latestBroadcast = state
        const previousSessions = get().appState.sessions
        set((current) => ({ appState: state, ...(snapshotLoaded ? reconcileWorkspace(current, state) : {}) }))
        for (const previous of previousSessions) {
          if (!state.sessions.some((session) => session.id === previous.id && session.status === 'running')) {
            pendingActivity.delete(previous.id)
            forgetAgentActivity(previous.id)
          }
        }
        if (snapshotLoaded) for (const session of state.sessions) {
          if (session.status === 'running' && isAgentKind(session.kind) &&
            !previousSessions.some((previous) => previous.id === session.id && previous.status === 'running')) hydrateActivity(session.id)
        }
        for (const id of expectedExits) {
          if (!state.sessions.some((session) => session.id === id)) expectedExits.delete(id)
        }
        syncBadge()
      })
      const disposeData = window.codeflai.onTerminalData((event) => {
        // Shells do not repaint themselves, so for them any output really is new content.
        // Agent sessions are reported at the Done edge inside noteAgentOutput instead.
        // Before the snapshot loads the kind is unknown, so the id is queued and filtered
        // once the session records arrive.
        const session = get().appState.sessions.find((candidate) => candidate.id === event.sessionId)
        if (event.data.length > 0 && !(session && isAgentKind(session.kind))) recordUnread(event.sessionId)
        if (!snapshotLoaded || pendingActivity.has(event.sessionId)) {
          const pending = pendingActivity.get(event.sessionId) ?? []
          pending.push(event)
          pendingActivity.set(event.sessionId, pending)
          return
        }
        noteAgentOutput(event.sessionId, event.data, false, onAgentIdle)
      })
      const disposeExit = window.codeflai.onTerminalExit(({ sessionId }) => {
        recordUnread(sessionId)
        if (!expectedExits.delete(sessionId)) notifySessionEvent(sessionId, 'exit')
        pendingActivity.delete(sessionId)
        forgetAgentActivity(sessionId)
      })
      const disposeActivate = window.codeflai.onNotificationActivate(({ sessionId }) => {
        // The main process has already focused the window. If the session is gone, stop there:
        // setActiveSession does not guard against unknown ids and would blank the terminal pane.
        const session = get().appState.sessions.find((candidate) => candidate.id === sessionId)
        if (!session) return
        get().setActiveSession(sessionId, session.projectId)
      })
      // Merged only while a download is actually in progress, so an event arriving after a
      // cancel, a failure, or a completion cannot drag the dialog back into the downloading
      // phase. The version comes from the event rather than being matched against the stored
      // one: the main process re-resolves the release when the download starts, so a release
      // published between the check and the click legitimately reports a newer version, and
      // dropping those frames would freeze the progress bar at 0 for the whole transfer.
      const disposeUpdateProgress = window.codeflai.onUpdateProgress((progress) => {
        set((state) =>
          state.updater.phase === 'downloading'
            ? {
                updater: {
                  phase: 'downloading',
                  version: progress.version,
                  receivedBytes: progress.receivedBytes,
                  totalBytes: progress.totalBytes
                }
              }
            : {}
        )
      })

      // Fire-and-forget: a startup check that finds nothing, fails, or cannot reach the
      // network must leave the app exactly as quiet as it would have been without it.
      void get().checkForUpdatesInBackground()
      window.addEventListener('focus', acknowledgeViewedSession)
      // Inert in production alongside isWindowAttended's visibilityState half, and for the same
      // reason (window.ts's backgroundThrottling: false): the neighbouring focus listener is
      // what actually covers the restore path.
      document.addEventListener('visibilitychange', acknowledgeViewedSession)

      return () => {
        disposed = true
        disposeWorkspace()
        disposeState()
        disposeData()
        disposeExit()
        disposeActivate()
        disposeUpdateProgress()
        clearAllIdleTimers()
        clearAutoShutdownTimers()
        pendingActivity.clear()
        pendingUnread.clear()
        startupRead.clear()
        expectedExits.clear()
        window.removeEventListener('focus', acknowledgeViewedSession)
        document.removeEventListener('visibilitychange', acknowledgeViewedSession)
        set({ idleAgentSessionIds: {} })
      }
    },

    reset: () => {
      clearAllIdleTimers()
      clearAutoShutdownTimers()
      set({
        platform: 'win32',
        appState: emptyAppState(),
        capabilities: defaultCapabilities(),
        activeProjectId: null,
        activeSessionId: null,
        sessionFocusRequest: 0,
        collapsedProjectIds: [],
        launcherOpen: false,
        creatingSession: null,
        searchQuery: '',
        notice: null,
        idleAgentSessionIds: {},
        unreadSessionIds: [],
        theme: 'dark',
        locale: DEFAULT_LOCALE,
        windowPinned: false,
        autoShutdown: { ...DEFAULT_AUTO_SHUTDOWN },
        shutdownCountdown: null,
        sessionKindPreferences: DEFAULT_SESSION_KIND_PREFERENCES,
        sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
        quickPrompts: [],
        showQuickPrompts: false,
        notificationsEnabled: true,
        updater: { phase: 'idle' }
      })
    },

    // A background check is allowed exactly one outcome that the user can see: a newer
    // version exists. Up-to-date, no releases, a network failure, and a rejected invoke all
    // leave the updater idle and silent — unlike Settings' explicit check, nobody asked.
    checkForUpdatesInBackground: async () => {
      try {
        const result = await window.codeflai.checkForUpdates()
        if (result.status !== 'available') return
        set({ updater: { phase: 'available', version: result.latestVersion, downloadable: result.asset !== undefined } })
      } catch {
        // Silent by design.
      }
    },

    // Settings has just run its own check, so it hands the outcome over rather than making
    // the dialog repeat the round trip.
    beginUpdate: (version, downloadable) => set({ updater: { phase: 'available', version, downloadable } }),

    startUpdateDownload: async () => {
      const current = get().updater
      // Nothing to download from a resting dialog; a second call while bytes are already
      // moving would only reset the progress the main process is still reporting; and an
      // install already handed to the OS must not be undercut by a fresh download.
      if (current.phase === 'idle' || current.phase === 'downloading' || current.phase === 'installing') return
      const { version } = current

      set({ updater: { phase: 'downloading', version, receivedBytes: 0, totalBytes: 0 } })
      try {
        const result = await window.codeflai.downloadUpdate()
        if (result.status === 'ready') {
          set({ updater: { phase: 'ready', version: result.version } })
        } else if (result.status === 'cancelled') {
          set({ updater: { phase: 'idle' } })
        } else {
          set({ updater: { phase: 'error', version, message: result.message } })
        }
      } catch (error) {
        set({ updater: { phase: 'error', version, message: errorMessage(error, get().locale) } })
      }
    },

    // The in-flight downloadUpdate() call is what reports the outcome (`cancelled`), so this
    // only asks; setting a phase here would race that answer.
    cancelUpdateDownload: async () => {
      try {
        await window.codeflai.cancelUpdateDownload()
      } catch {
        // The download simply keeps going, and its own result still lands.
      }
    },

    // Quitting is not instant — the main process still has to tear down every PTY before the
    // app actually exits (see shutdown-controller) — so the dialog moves to `installing` and
    // stops offering the button. Two NSIS wizards racing on the same install directory is a
    // real outcome of a double click, and UpdaterService.install() is idempotent for the same
    // reason; this is the half the user can see.
    installUpdate: async () => {
      const current = get().updater
      if (current.phase === 'idle' || current.phase === 'installing') return
      const { version } = current

      set({ updater: { phase: 'installing', version } })
      try {
        const result = await window.codeflai.installUpdate()
        // `launched` means the app is already quitting: staying on `installing` avoids a
        // flash of some other state during teardown.
        if (result.status === 'error') set({ updater: { phase: 'error', version, message: result.message } })
      } catch (error) {
        set({ updater: { phase: 'error', version, message: errorMessage(error, get().locale) } })
      }
    },

    // "Later" in every phase. A downloaded installer is deliberately left on disk: the main
    // process reuses it, so choosing to update again skips straight to the install prompt.
    dismissUpdate: () => set({ updater: { phase: 'idle' } }),

    setTheme: (theme) => {
      set({ theme })
      applyThemeEffects(theme)
    },

    setLocale: (locale) => {
      set({ locale })
      applyLocaleEffects(locale)
    },

    setWindowPinned: (pinned) => {
      set({ windowPinned: pinned })
      void applyWindowPinnedEffects(pinned).then((actual) => {
        // Only ever corrects a refusal, and only while the user has not toggled again since:
        // a late reply from an older request must not undo a newer click.
        if (actual !== pinned && get().windowPinned === pinned) set({ windowPinned: actual })
      })
    },

    /**
     * Switching auto shutdown off also takes down any countdown already on screen: the
     * switch and the dialog describe the same intention, so leaving a countdown running
     * after the feature was switched off would shut the machine down against the user's
     * last instruction.
     */
    setAutoShutdownEnabled: (enabled) => {
      const next = { ...get().autoShutdown, enabled }
      set({ autoShutdown: next, shutdownCountdown: null })
      persistAutoShutdown(next)
      restartAutoShutdownWatcher()
    },

    setAutoShutdownInterval: (intervalMs) => {
      // Guards against a value no dropdown offers (a future build's preference, a hand-edited
      // localStorage entry): an interval of 0 or NaN would turn the watcher into a busy loop.
      if (!isAutoShutdownInterval(intervalMs)) return
      const next = { ...get().autoShutdown, intervalMs }
      set({ autoShutdown: next })
      persistAutoShutdown(next)
      restartAutoShutdownWatcher()
    },

    /**
     * The window and the switch that confines the shutdown to it. Neither restarts the
     * watcher, and that is the difference from the frequency: the cadence has not changed,
     * only the answer the next check will give. Restarting it would push that check a full
     * interval away on every keystroke in the time control — with an hour selected, editing
     * the window would cost an hour.
     */
    setAutoShutdownTimeRangeEnabled: (timeRangeEnabled) => {
      const next = { ...get().autoShutdown, timeRangeEnabled }
      set({ autoShutdown: next })
      persistAutoShutdown(next)
    },

    setAutoShutdownTimeRange: (timeRange) => {
      // Same guard as the interval, for the same reason: a half-written or hand-edited value
      // must not reach the watcher, where an unreadable window means "never shut down".
      if (!isAutoShutdownTimeRange(timeRange)) return
      const next = { ...get().autoShutdown, timeRange: { start: timeRange.start, end: timeRange.end } }
      set({ autoShutdown: next })
      persistAutoShutdown(next)
    },

    // "Cancel shutdown" is the user saying the machine is in use, so it switches the whole
    // feature off rather than just skipping this round — otherwise the dialog would be back
    // one interval later, which is exactly what someone who just cancelled does not want.
    cancelAutoShutdown: () => {
      get().setAutoShutdownEnabled(false)
    },

    shutdownNow: async () => {
      await performShutdown()
    },

    setSessionKindPreference: (kind, change) => {
      const current = get().sessionKindPreferences
      const next = { ...current, [kind]: { ...current[kind], ...change } }
      set({ sessionKindPreferences: next })
      persistSessionKindPreferences(next)
    },

    setSidebarWidth: (width) => {
      const next = clampSidebarWidth(width, window.innerWidth)
      if (next === get().sidebarWidth) return
      set({ sidebarWidth: next })
      persistSidebarWidth(next)
    },

    resetSidebarWidth: () => {
      set({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH })
      persistSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
    },

    setQuickPrompts: (prompts) => {
      const parsed = quickPromptsSchema.safeParse(prompts)
      if (!parsed.success) return false
      try {
        window.localStorage.setItem(QUICK_PROMPTS_STORAGE_KEY, JSON.stringify(parsed.data))
      } catch {
        return false
      }
      set({ quickPrompts: parsed.data })
      return true
    },

    setShowQuickPrompts: (show) => {
      set({ showQuickPrompts: show })
      try {
        window.localStorage.setItem(SHOW_QUICK_PROMPTS_STORAGE_KEY, String(show))
      } catch {
        // Match other presentation preferences when localStorage is unavailable.
      }
    },

    setNotificationsEnabled: (enabled) => {
      set({ notificationsEnabled: enabled })
      try {
        window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, String(enabled))
      } catch {
        // Match other presentation preferences when localStorage is unavailable.
      }
      // Switching off must take the badge with it; a count that will never update again is
      // worse than no badge at all.
      syncBadge()
    },

    addProject: async (source) => {
      const project = !source
        ? await window.codeflai.addProject()
        : 'recentProjectId' in source
          ? await window.codeflai.reopenProject(source.recentProjectId)
          : await window.codeflai.cloneProject(source)
      if (!project) return false
      set((state) => ({
        appState: upsertProject(state.appState, project),
        activeProjectId: project.id,
        activeSessionId: null,
        searchQuery: '',
        launcherOpen: false
      }))
      return true
    },

    removeRecentProject: async (projectId) => {
      await window.codeflai.removeRecentProject(projectId)
      set((state) => ({
        appState: { ...state.appState, recentProjects: (state.appState.recentProjects ?? []).filter((project) => project.id !== projectId) }
      }))
    },

    reorderProjects: async (orderedProjectIds) => {
      try {
        const projects = await window.codeflai.reorderProjects(orderedProjectIds)
        set((state) => ({ appState: { ...state.appState, projects } }))
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    openProjectInVSCode: async (projectId) => {
      try {
        await window.codeflai.openProjectInVSCode(projectId)
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    openProjectFolder: async (projectId) => {
      try {
        await window.codeflai.openProjectFolder(projectId)
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    openProjectRepository: async (projectId) => {
      try {
        await window.codeflai.openProjectRepository(projectId)
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    /**
     * The clipboard gives no visible feedback of its own, so a successful copy raises an
     * info notice naming the path — otherwise the menu item would look like it did nothing.
     */
    copyProjectPath: async (projectId) => {
      try {
        const path = await window.codeflai.copyProjectPath(projectId)
        set({ notice: { message: translate(get().locale, 'notice.projectPathCopied', { path }), tone: 'info' } })
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    removeProject: async (projectId) => {
      try {
        await window.codeflai.removeProject(projectId)
        for (const session of get().appState.sessions) {
          if (session.projectId === projectId) forgetAgentActivity(session.id)
        }
        // The main process has already broadcast the state without this project; this only
        // moves the selection off the records that vanished (and is a no-op for the state).
        set((state) => {
          const projects = state.appState.projects.filter((project) => project.id !== projectId)
          const sessions = state.appState.sessions.filter((session) => session.projectId !== projectId)
          const activeProjectRemoved = state.activeProjectId === projectId
          const activeSessionRemoved =
            state.activeSessionId !== null && !sessions.some((session) => session.id === state.activeSessionId)
          return {
            appState: { ...state.appState, projects, sessions },
            activeProjectId: activeProjectRemoved ? (projects[0]?.id ?? null) : state.activeProjectId,
            activeSessionId: activeSessionRemoved ? null : state.activeSessionId,
            collapsedProjectIds: state.collapsedProjectIds.filter((id) => id !== projectId),
            unreadSessionIds: state.unreadSessionIds.filter((id) => sessions.some((session) => session.id === id)),
            launcherOpen: activeProjectRemoved ? false : state.launcherOpen
          }
        })
        // The prune above can drop the project's own unread sessions; a local set() does not
        // broadcast, so nothing else re-syncs the badge (see syncBadge's other callers).
        syncBadge()
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    openLauncher: () => set({ launcherOpen: true }),
    closeLauncher: () => set({ launcherOpen: false }),

    createSession: async (projectId, kind, worktree) => {
      if (get().creatingSession) return
      set({ creatingSession: { projectId, kind, worktree }, notice: null })
      try {
        const session = await window.codeflai.createSession(projectId, kind, worktree)
        set((state) => ({
          appState: upsertSession(state.appState, session),
          activeProjectId: session.projectId,
          activeSessionId: session.id,
          launcherOpen: false,
          creatingSession: null
        }))
      } catch (error) {
        set({ creatingSession: null, notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    setActiveProject: (projectId) => set({ activeProjectId: projectId }),

    toggleProjectCollapsed: (projectId) => set((state) => ({
      collapsedProjectIds: state.collapsedProjectIds.includes(projectId)
        ? state.collapsedProjectIds.filter((id) => id !== projectId)
        : [...state.collapsedProjectIds, projectId]
    })),

    setProjectsCollapsed: (projectIds, collapsed) => set((state) => ({
      collapsedProjectIds: collapsed
        ? [...new Set([...state.collapsedProjectIds, ...projectIds])]
        : state.collapsedProjectIds.filter((id) => !projectIds.includes(id))
    })),

    setActiveSession: (sessionId, projectId) =>
      set((state) => ({
        activeSessionId: sessionId,
        sessionFocusRequest: state.sessionFocusRequest + 1,
        activeProjectId: projectId ?? state.appState.sessions.find((session) => session.id === sessionId)?.projectId ?? state.activeProjectId
      })),

    restoreSession: async (sessionId) => {
      try {
        const session = await window.codeflai.restoreSession(sessionId)
        set((state) => ({
          appState: upsertSession(state.appState, session),
          activeProjectId: session.projectId,
          activeSessionId: session.id
        }))
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    renameSession: async (sessionId, title) => {
      try {
        const session = await window.codeflai.renameSession(sessionId, title)
        set((state) => ({ appState: upsertSession(state.appState, session), notice: null }))
        return true
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
        return false
      }
    },

    reorderSessions: async (orderedSessionIds) => {
      try {
        const sessions = await window.codeflai.reorderSessions(orderedSessionIds)
        set((state) => ({ appState: { ...state.appState, sessions } }))
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    stopSession: async (sessionId) => {
      try {
        expectedExits.add(sessionId)
        await window.codeflai.stopSession(sessionId)
        // The stopped record itself arrives via onStateChanged, the durable source of truth.
        // Only renderer-local activity bookkeeping needs clearing here: the process is gone,
        // so a retained unread marker or activity snapshot is stale.
        forgetAgentActivity(sessionId)
        set((state) => ({
          unreadSessionIds: state.unreadSessionIds.filter((id) => id !== sessionId),
          notice: null
        }))
        // Stopping a session can drop its own unread marker; see the removeProject comment above.
        syncBadge()
      } catch (error) {
        expectedExits.delete(sessionId)
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },

    deleteSession: async (sessionId) => {
      try {
        expectedExits.add(sessionId)
        const result = await window.codeflai.deleteSession(sessionId)
        // A refused delete (a dirty worktree) or a failed one leaves the session running, so
        // the exit that eventually arrives is the session's own and must still be announced.
        if (result.status !== 'deleted') expectedExits.delete(sessionId)

        if (result.status === 'deleted') {
          forgetAgentActivity(sessionId)
          set((state) => ({
            appState: { ...state.appState, sessions: state.appState.sessions.filter((session) => session.id !== sessionId) },
            unreadSessionIds: state.unreadSessionIds.filter((id) => id !== sessionId),
            activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId
          }))
          // Deleting a session can drop its own unread marker; see the removeProject comment above.
          syncBadge()
        } else if (result.status === 'dirty') {
          set({
            notice: {
              message: translate(get().locale, 'notice.dirtyWorktree', { count: result.changedFiles }),
              tone: 'error'
            }
          })
        } else {
          set({ notice: { message: result.message, tone: 'error' } })
        }

        return result
      } catch (error) {
        expectedExits.delete(sessionId)
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
        return undefined
      }
    },

    setSearchQuery: (query) => set({ searchQuery: query }),
    dismissNotice: () => set({ notice: null })
  }
})
