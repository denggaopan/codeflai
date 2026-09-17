// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AppInfo,
  AppSnapshot,
  AppState,
  CapabilityState,
  DeleteSessionResult,
  ProjectRecord,
  SessionRecord,
  ShutdownResult,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateDownloadResult,
  UpdateInstallResult,
  WorkspaceState
} from '../../../shared/contracts'
import { EXTERNAL_LINKS } from '../../../shared/links'
import type { TerminalDataEvent, TerminalReplay } from '../../../shared/pty-protocol'
import { AGENT_KINDS, type AgentKind } from '../../../shared/agent-kinds'
import { DEFAULT_SESSION_KIND_PREFERENCES } from '../../../shared/contracts'
import { DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS, SHUTDOWN_COUNTDOWN_SECONDS } from '../auto-shutdown'
import {
  AGENT_IDLE_MS,
  AUTO_SHUTDOWN_STORAGE_KEY,
  SESSION_KINDS_STORAGE_KEY,
  WINDOW_PINNED_STORAGE_KEY,
  useAppStore
} from './use-app-store'

const defaultCapabilities = (): CapabilityState => ({
  ...(Object.fromEntries(AGENT_KINDS.map((kind) => [kind, { available: true, detail: '' }])) as Record<
    AgentKind,
    { available: boolean; detail: string }
  >),
  vscode: { available: true, detail: '' }
})

const claudeSession: SessionRecord = {
  id: 'session-claude',
  projectId: 'project-1',
  kind: 'claude',
  title: 'Fix login bug',
  titleState: 'complete',
  createdAt: '2026-08-20T00:02:00.000Z',
  mode: 'ordinary',
  launchPath: 'C:\\work\\demo-project',
  status: 'running'
}

const powershellSession: SessionRecord = {
  id: 'session-ps',
  projectId: 'project-1',
  kind: 'powershell',
  title: 'New PowerShell session',
  titleState: 'pending',
  createdAt: '2026-08-20T00:01:00.000Z',
  mode: 'ordinary',
  launchPath: 'C:\\work\\demo-project',
  status: 'running'
}

const seededState: AppState = { version: 1, projects: [], sessions: [claudeSession, powershellSession] }

const createFakeApi = () => {
  const dataListeners = new Set<(payload: TerminalDataEvent) => void>()
  const exitListeners = new Set<(payload: { sessionId: string; exitCode: number }) => void>()
  const progressListeners = new Set<(progress: UpdateDownloadProgress) => void>()
  return {
    setTheme: vi.fn(async (): Promise<void> => undefined),
    saveWorkspace: vi.fn(async (_workspace: WorkspaceState): Promise<void> => undefined),
    setWindowPinned: vi.fn(async (pinned: boolean): Promise<boolean> => pinned),
    getSnapshot: vi.fn(async (): Promise<AppSnapshot> => ({ platform: 'win32', state: seededState, capabilities: defaultCapabilities() })),
    addProject: vi.fn(async (): Promise<ProjectRecord | null> => null),
    reopenProject: vi.fn(async (): Promise<ProjectRecord> => { throw new Error('reopenProject not stubbed') }),
    removeRecentProject: vi.fn(async (): Promise<void> => undefined),
    selectCloneDirectory: vi.fn(async (): Promise<string | null> => null),
    cloneProject: vi.fn(async (): Promise<ProjectRecord> => { throw new Error('cloneProject not stubbed') }),
    openProjectInVSCode: vi.fn(async (): Promise<void> => undefined),
    openProjectFolder: vi.fn(async (): Promise<void> => undefined),
    openProjectRepository: vi.fn(async (): Promise<void> => undefined),
    copyProjectPath: vi.fn(async (): Promise<string> => 'E:\projects\app'),
    removeProject: vi.fn(async (): Promise<void> => undefined),
    createSession: vi.fn(async (): Promise<SessionRecord> => claudeSession),
    restoreSession: vi.fn(async (): Promise<SessionRecord> => claudeSession),
    renameSession: vi.fn(async (_id: string, title: string): Promise<SessionRecord> => ({ ...claudeSession, title })),
    stopSession: vi.fn(async (_sessionId: string): Promise<void> => undefined),
    reorderSessions: vi.fn(async (): Promise<SessionRecord[]> => []),
    reorderProjects: vi.fn(async (): Promise<ProjectRecord[]> => []),
    deleteSession: vi.fn(async (): Promise<DeleteSessionResult> => ({ status: 'deleted' })),
    submitFirstInput: vi.fn(async (): Promise<void> => undefined),
    getAppInfo: vi.fn(async (): Promise<AppInfo> => ({ version: '0.0.0-test', links: EXTERNAL_LINKS })),
    checkForUpdates: vi.fn(async (): Promise<UpdateCheckResult> => ({ status: 'none', currentVersion: '0.0.0-test' })),
    downloadUpdate: vi.fn(async (): Promise<UpdateDownloadResult> => ({ status: 'cancelled' })),
    cancelUpdateDownload: vi.fn(async (): Promise<void> => undefined),
    installUpdate: vi.fn(async (): Promise<UpdateInstallResult> => ({ status: 'launched' })),
    openExternalLink: vi.fn(async (): Promise<void> => undefined),
    getAutoLaunch: vi.fn(async (): Promise<boolean> => false),
    setAutoLaunch: vi.fn(async (enabled: boolean): Promise<boolean> => enabled),
    shutdownSystem: vi.fn(async (): Promise<ShutdownResult> => ({ status: 'launched' })),
    writeTerminal: vi.fn(),
    notifySessionIdle: vi.fn(),
    setUnreadBadge: vi.fn(),
    resizeTerminal: vi.fn(),
    replayTerminal: vi.fn(async (_sessionId: string): Promise<TerminalReplay | undefined> => undefined),
    onStateChanged: vi.fn((_listener: (state: AppState) => void) => () => undefined),
    onTerminalData: vi.fn((listener: (payload: TerminalDataEvent) => void) => {
      dataListeners.add(listener)
      return () => {
        dataListeners.delete(listener)
      }
    }),
    onTerminalExit: vi.fn((listener: (payload: { sessionId: string; exitCode: number }) => void) => {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    }),
    onUpdateProgress: vi.fn((listener: (progress: UpdateDownloadProgress) => void) => {
      progressListeners.add(listener)
      return () => {
        progressListeners.delete(listener)
      }
    }),
    onNotificationActivate: vi.fn((_listener: (event: { sessionId: string }) => void) => () => undefined),
    emitUpdateProgress: (progress: UpdateDownloadProgress) => {
      for (const listener of [...progressListeners]) listener(progress)
    },
    emitTerminalData: (payload: TerminalDataEvent) => {
      for (const listener of [...dataListeners]) listener(payload)
    },
    emitTerminalExit: (payload: { sessionId: string; exitCode: number }) => {
      for (const listener of [...exitListeners]) listener(payload)
    }
  }
}

type FakeApi = ReturnType<typeof createFakeApi>

let api: FakeApi
let dispose: () => void

const idleIds = (): Record<string, true> => useAppStore.getState().idleAgentSessionIds

// The preference is read once, during initialize(). Re-initializing is how a stored value is
// put in front of it without widening the module's public surface.
const reinitializeWith = async (stored: string | null): Promise<void> => {
  dispose()
  useAppStore.getState().reset()
  if (stored === null) window.localStorage.removeItem('codeflai.notifications')
  else window.localStorage.setItem('codeflai.notifications', stored)
  api = createFakeApi()
  window.codeflai = api
  dispose = useAppStore.getState().initialize()
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(async () => {
  vi.useFakeTimers()
  window.localStorage.clear()
  useAppStore.getState().reset()
  api = createFakeApi()
  window.codeflai = api
  dispose = useAppStore.getState().initialize()
  // getSnapshot resolves on the microtask queue; flush it so appState holds the sessions.
  await vi.advanceTimersByTimeAsync(0)
  expect(useAppStore.getState().appState.sessions).toHaveLength(2)
})

afterEach(() => {
  dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('session organization', () => {
  it('updates a renamed session and leaves failed edits available to retry', async () => {
    expect(await useAppStore.getState().renameSession(claudeSession.id, 'New task name')).toBe(true)
    expect(useAppStore.getState().appState.sessions[0]?.title).toBe('New task name')
    api.renameSession.mockRejectedValueOnce(new Error('disk full'))
    expect(await useAppStore.getState().renameSession(claudeSession.id, 'Other name')).toBe(false)
    expect(useAppStore.getState().appState.sessions[0]?.title).toBe('New task name')
    expect(useAppStore.getState().notice?.message).toBe('disk full')
  })

  it('stops a session, clearing its unread marker', async () => {
    api.emitTerminalData({ sessionId: powershellSession.id, data: 'output' })
    expect(useAppStore.getState().unreadSessionIds).toEqual([powershellSession.id])

    await useAppStore.getState().stopSession(powershellSession.id)

    expect(api.stopSession).toHaveBeenCalledWith(powershellSession.id)
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
    expect(api.restoreSession).not.toHaveBeenCalled()
    expect(api.deleteSession).not.toHaveBeenCalled()
  })

  it('merges the reordered sessions returned by the main process', async () => {
    api.reorderSessions.mockResolvedValueOnce([powershellSession, claudeSession])

    await useAppStore.getState().reorderSessions([powershellSession.id, claudeSession.id])

    expect(api.reorderSessions).toHaveBeenCalledWith([powershellSession.id, claudeSession.id])
    expect(useAppStore.getState().appState.sessions.map((session) => session.id))
      .toEqual([powershellSession.id, claudeSession.id])
  })

  it('reports a reorder failure as a notice and leaves the order alone', async () => {
    api.reorderSessions.mockRejectedValueOnce(new Error('order changed'))

    await useAppStore.getState().reorderSessions([powershellSession.id, claudeSession.id])

    expect(useAppStore.getState().notice).toEqual({ message: 'order changed', tone: 'error' })
    expect(useAppStore.getState().appState.sessions.map((session) => session.id))
      .toEqual([claudeSession.id, powershellSession.id])
  })

  it('reports a stop failure as a notice', async () => {
    api.stopSession.mockRejectedValueOnce(new Error('cannot save'))

    await useAppStore.getState().stopSession(claudeSession.id)

    expect(useAppStore.getState().notice).toEqual({ message: 'cannot save', tone: 'error' })
  })
})

describe('unread session activity', () => {
  beforeEach(() => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    window.dispatchEvent(new Event('focus'))
  })

  it('marks an agent session unread only once its turn finishes', async () => {
    useAppStore.getState().setActiveSession(powershellSession.id)
    api.saveWorkspace.mockClear()
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'thinking...' })
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'still working' })
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(useAppStore.getState().unreadSessionIds).toEqual([claudeSession.id])
    expect(api.saveWorkspace.mock.calls.at(-1)?.[0].unreadSessionIds).toEqual([claudeSession.id])
    useAppStore.getState().setActiveSession(claudeSession.id)
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
    expect(api.saveWorkspace.mock.calls.at(-1)?.[0].unreadSessionIds ?? []).toEqual([])
  })

  it('marks a shell session unread on any output', () => {
    useAppStore.getState().setActiveSession(claudeSession.id)
    api.emitTerminalData({ sessionId: powershellSession.id, data: 'PS C:\> ' })
    expect(useAppStore.getState().unreadSessionIds).toEqual([powershellSession.id])
  })

  it('marks the selected agent session unread while unfocused and clears it when focus returns', async () => {
    useAppStore.getState().setActiveSession(claudeSession.id)
    vi.mocked(document.hasFocus).mockReturnValue(false)
    window.dispatchEvent(new Event('blur'))
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'background output' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(useAppStore.getState().unreadSessionIds).toEqual([claudeSession.id])
    vi.mocked(document.hasFocus).mockReturnValue(true)
    window.dispatchEvent(new Event('focus'))
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
  })

  it('keeps hidden-window agent output unread until the selected terminal is visible', async () => {
    useAppStore.getState().setActiveSession(claudeSession.id)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'while hidden' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(useAppStore.getState().unreadSessionIds).toEqual([claudeSession.id])
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
  })

  it('never marks replayed history unread even after the quiet window elapses', async () => {
    dispose()
    useAppStore.getState().reset()
    const project: ProjectRecord = { id: 'project-1', name: 'Project', path: 'C:\project', createdAt: claudeSession.createdAt }
    api.getSnapshot.mockResolvedValue({ platform: 'win32', capabilities: defaultCapabilities(), state: {
      ...seededState, projects: [project], workspace: { activeProjectId: project.id, activeSessionId: null, collapsedProjectIds: [] }
    } })
    api.replayTerminal.mockResolvedValue({ data: 'old output', cols: 80, rows: 24, throughSequence: 7 })
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
  })

  it('marks background exits and removes unread flags when a session is deleted', async () => {
    api.emitTerminalExit({ sessionId: powershellSession.id, exitCode: 1 })
    expect(useAppStore.getState().unreadSessionIds).toEqual([powershellSession.id])
    await useAppStore.getState().deleteSession(powershellSession.id)
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
    api.emitTerminalData({ sessionId: 'deleted', data: 'late output' })
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
  })

  it('restores unread IDs, discards deleted IDs, and never marks historical replay unread', async () => {
    dispose()
    useAppStore.getState().reset()
    const project: ProjectRecord = { id: 'project-1', name: 'Project', path: 'C:\\project', createdAt: claudeSession.createdAt }
    api.getSnapshot.mockResolvedValue({ platform: 'win32', capabilities: defaultCapabilities(), state: {
      ...seededState, projects: [project], workspace: {
        activeProjectId: project.id, activeSessionId: null, collapsedProjectIds: [],
        unreadSessionIds: [powershellSession.id, 'deleted', powershellSession.id]
      }
    } })
    api.replayTerminal.mockResolvedValue({ data: 'old output', cols: 80, rows: 24, throughSequence: 7 })
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(useAppStore.getState().unreadSessionIds).toEqual([powershellSession.id])
    api.onStateChanged.mock.calls.at(-1)![0]({ ...seededState, projects: [project], sessions: [claudeSession] })
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
  })

  it('retains live output arriving while the initial snapshot is loading', async () => {
    dispose()
    useAppStore.getState().reset()
    let resolveSnapshot!: (snapshot: AppSnapshot) => void
    api.getSnapshot.mockReturnValueOnce(new Promise((resolve) => { resolveSnapshot = resolve }))
    dispose = useAppStore.getState().initialize()
    api.emitTerminalData({ sessionId: powershellSession.id, data: 'live while loading' })
    resolveSnapshot({ platform: 'win32', capabilities: defaultCapabilities(), state: seededState })
    await vi.advanceTimersByTimeAsync(0)
    expect(useAppStore.getState().unreadSessionIds).toEqual([powershellSession.id])
  })

  it('hydrates unread independently of navigation performed before the snapshot arrives', async () => {
    dispose()
    useAppStore.getState().reset()
    const project: ProjectRecord = { id: 'project-1', name: 'Project', path: 'C:\\project', createdAt: claudeSession.createdAt }
    let resolveSnapshot!: (snapshot: AppSnapshot) => void
    api.getSnapshot.mockReturnValueOnce(new Promise((resolve) => { resolveSnapshot = resolve }))
    dispose = useAppStore.getState().initialize()
    api.onStateChanged.mock.calls.at(-1)![0]({ ...seededState, projects: [project] })
    useAppStore.getState().setActiveSession(powershellSession.id)
    useAppStore.getState().toggleProjectCollapsed(project.id)
    expect(api.saveWorkspace.mock.calls.at(-1)?.[0]).not.toHaveProperty('unreadSessionIds')
    resolveSnapshot({ platform: 'win32', capabilities: defaultCapabilities(), state: {
      ...seededState, projects: [project], workspace: {
        activeProjectId: project.id, activeSessionId: null, collapsedProjectIds: [],
        unreadSessionIds: [claudeSession.id, powershellSession.id]
      }
    } })
    await vi.advanceTimersByTimeAsync(0)
    expect(useAppStore.getState().activeSessionId).toBe(powershellSession.id)
    expect(useAppStore.getState().collapsedProjectIds).toEqual([project.id])
    expect(useAppStore.getState().unreadSessionIds).toEqual([claudeSession.id])
  })

  it('acknowledges output viewed after regaining focus before startup hydration', async () => {
    dispose()
    useAppStore.getState().reset()
    const project: ProjectRecord = { id: 'project-1', name: 'Project', path: 'C:\\project', createdAt: claudeSession.createdAt }
    let resolveSnapshot!: (snapshot: AppSnapshot) => void
    api.getSnapshot.mockReturnValueOnce(new Promise((resolve) => { resolveSnapshot = resolve }))
    dispose = useAppStore.getState().initialize()
    api.onStateChanged.mock.calls.at(-1)![0]({ ...seededState, projects: [project] })
    vi.mocked(document.hasFocus).mockReturnValue(false)
    useAppStore.getState().setActiveSession(claudeSession.id)
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'output before focus' })
    vi.mocked(document.hasFocus).mockReturnValue(true)
    window.dispatchEvent(new Event('focus'))
    useAppStore.getState().setActiveSession(powershellSession.id)
    resolveSnapshot({ platform: 'win32', capabilities: defaultCapabilities(), state: { ...seededState, projects: [project] } })
    await vi.advanceTimersByTimeAsync(0)
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
  })
})

describe('workspace persistence', () => {
  const project: ProjectRecord = {
    id: 'project-1', name: 'Project', path: 'C:\\project', createdAt: '2026-08-20T00:00:00.000Z'
  }
  const secondProject = { ...project, id: 'project-2' }
  const snapshot: AppSnapshot = {
    platform: 'win32', capabilities: defaultCapabilities(),
    state: { ...seededState, projects: [secondProject, project] }
  }
  const stored = () => api.saveWorkspace.mock.calls.at(-1)![0]
  const restart = async () => {
    dispose()
    useAppStore.getState().reset()
    const workspace = stored()
    api.getSnapshot.mockResolvedValue({ ...snapshot, state: { ...snapshot.state, workspace } })
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
  }

  it('saves selection and independent folds before shutdown and restores the active terminal inside a folded project', async () => {
    await restart()
    useAppStore.getState().setActiveSession(powershellSession.id)
    useAppStore.getState().toggleProjectCollapsed(project.id)
    expect(stored()).toEqual({
      activeProjectId: project.id, activeSessionId: powershellSession.id, collapsedProjectIds: [project.id]
    })

    await restart()
    expect(useAppStore.getState()).toMatchObject(stored())
    expect(useAppStore.getState().activeSessionId).toBe(powershellSession.id)
    expect(useAppStore.getState().collapsedProjectIds).toEqual([project.id])
    expect(api.restoreSession).not.toHaveBeenCalled()
    useAppStore.getState().toggleProjectCollapsed(secondProject.id)
    useAppStore.getState().toggleProjectCollapsed(project.id)
    await restart()
    expect(useAppStore.getState().collapsedProjectIds).toEqual([secondProject.id])
  })

  it('saves a bulk fold in one update and preserves projects outside the operation', async () => {
    await restart()
    api.saveWorkspace.mockClear()
    useAppStore.getState().setProjectsCollapsed([project.id, secondProject.id], true)
    expect(api.saveWorkspace).toHaveBeenCalledTimes(1)
    expect(stored().collapsedProjectIds).toEqual([project.id, secondProject.id])
    await restart()
    useAppStore.getState().setProjectsCollapsed([project.id], false)
    expect(stored().collapsedProjectIds).toEqual([secondProject.id])
    await restart()
    expect(useAppStore.getState().collapsedProjectIds).toEqual([secondProject.id])
  })

  it('persists sessions selected through creation and restoration, and clears a deleted selection', async () => {
    await restart()
    await useAppStore.getState().createSession(project.id, 'claude', false)
    expect(stored().activeSessionId).toBe(claudeSession.id)
    api.restoreSession.mockResolvedValue(powershellSession)
    await useAppStore.getState().restoreSession(powershellSession.id)
    expect(stored().activeSessionId).toBe(powershellSession.id)
    await useAppStore.getState().deleteSession(powershellSession.id)
    expect(stored().activeSessionId).toBeNull()
  })

  it('opens a saved stopped session without restarting its process', async () => {
    dispose()
    useAppStore.getState().reset()
    const workspace = { activeProjectId: project.id, activeSessionId: claudeSession.id, collapsedProjectIds: [project.id] }
    api.getSnapshot.mockResolvedValue({
      ...snapshot, state: { ...snapshot.state, workspace, sessions: [{ ...claudeSession, status: 'stopped' }] }
    })
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(useAppStore.getState()).toMatchObject(workspace)
    expect(api.restoreSession).not.toHaveBeenCalled()
  })

  it('remembers an empty selection after adding a project and removes forgotten project folds', async () => {
    await restart()
    useAppStore.getState().setActiveSession(claudeSession.id)
    api.addProject.mockResolvedValue(secondProject)
    await useAppStore.getState().addProject()
    expect(stored()).toMatchObject({ activeProjectId: secondProject.id, activeSessionId: null })
    useAppStore.getState().toggleProjectCollapsed(secondProject.id)
    await useAppStore.getState().removeProject(secondProject.id)
    expect(stored().collapsedProjectIds).toEqual([])
  })

  it('ignores deleted records on startup without choosing an unrelated session', async () => {
    await api.saveWorkspace({
      activeProjectId: 'deleted', activeSessionId: 'deleted', collapsedProjectIds: ['deleted', project.id, project.id]
    })
    await restart()
    expect(stored()).toEqual({
      activeProjectId: secondProject.id, activeSessionId: null, collapsedProjectIds: [project.id]
    })
  })

  it('clears references when a state broadcast removes the active project', async () => {
    await restart()
    useAppStore.getState().setActiveSession(claudeSession.id)
    useAppStore.getState().toggleProjectCollapsed(project.id)
    const listener = api.onStateChanged.mock.calls.at(-1)![0] as (state: AppState) => void
    listener({ version: 1, projects: [secondProject], sessions: [] })
    expect(stored()).toEqual({ activeProjectId: secondProject.id, activeSessionId: null, collapsedProjectIds: [] })
  })

  it('does not overwrite preferences while the snapshot is pending or restore a disposed initialization', async () => {
    dispose()
    useAppStore.getState().reset()
    const preferences = { activeProjectId: project.id, activeSessionId: claudeSession.id, collapsedProjectIds: [project.id] }
    await api.saveWorkspace(preferences)
    let resolveSnapshot!: (value: AppSnapshot) => void
    api.getSnapshot.mockReturnValueOnce(new Promise((resolve) => { resolveSnapshot = resolve }))
    dispose = useAppStore.getState().initialize()
    expect(stored()).toEqual(preferences)
    dispose()
    useAppStore.getState().reset()
    resolveSnapshot(snapshot)
    await vi.advanceTimersByTimeAsync(0)
    expect(stored()).toEqual(preferences)
    expect(useAppStore.getState().appState.projects).toEqual([])
  })

  it('preserves a user selection made while loading and uses broadcasts newer than the snapshot', async () => {
    dispose()
    useAppStore.getState().reset()
    let resolveSnapshot!: (value: AppSnapshot) => void
    api.getSnapshot.mockReturnValueOnce(new Promise((resolve) => { resolveSnapshot = resolve }))
    dispose = useAppStore.getState().initialize()
    const listener = api.onStateChanged.mock.calls.at(-1)![0] as (state: AppState) => void
    listener(snapshot.state)
    useAppStore.getState().setActiveSession(powershellSession.id)
    expect(stored().activeSessionId).toBe(powershellSession.id)
    useAppStore.getState().toggleProjectCollapsed(project.id)
    expect(stored().collapsedProjectIds).toEqual([project.id])
    resolveSnapshot({ ...snapshot, state: { version: 1, projects: [], sessions: [] } })
    await vi.advanceTimersByTimeAsync(0)
    expect(useAppStore.getState().activeSessionId).toBe(powershellSession.id)
    expect(useAppStore.getState().appState).toEqual(snapshot.state)
    expect(stored().activeSessionId).toBe(powershellSession.id)
  })

  it('keeps navigation usable and reports a failed workspace save', async () => {
    await restart()
    api.saveWorkspace.mockRejectedValue(new Error('storage unavailable'))
    useAppStore.getState().setActiveSession(claudeSession.id)
    useAppStore.getState().toggleProjectCollapsed(project.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(useAppStore.getState().activeSessionId).toBe(claudeSession.id)
    expect(useAppStore.getState().collapsedProjectIds).toEqual([project.id])
    expect(useAppStore.getState().notice).toEqual({ message: 'storage unavailable', tone: 'error' })
  })
})

// The launcher reads availability by kind with no fallback, and it can be opened before the
// first snapshot arrives — a kind missing from the resting state would crash it.
describe('useAppStore resting capabilities', () => {
  it('carries a placeholder entry for every agent kind before the snapshot arrives', () => {
    useAppStore.getState().reset()

    const { capabilities } = useAppStore.getState()

    for (const kind of AGENT_KINDS) {
      expect(capabilities[kind]).toEqual({ available: false, detail: 'Checking availability…' })
    }
  })
})

describe('useAppStore.reorderProjects', () => {
  const projectAt = (id: string): ProjectRecord => ({ id, name: id, path: `C:\\${id}`, createdAt: '2026-08-20T00:00:00.000Z' })

  it('sends the order over IPC and applies the returned authoritative project list', async () => {
    const reordered = [projectAt('p2'), projectAt('p1')]
    api.reorderProjects.mockResolvedValue(reordered)

    await useAppStore.getState().reorderProjects(['p2', 'p1'])

    expect(api.reorderProjects).toHaveBeenCalledWith(['p2', 'p1'])
    expect(useAppStore.getState().appState.projects).toEqual(reordered)
  })

  it('surfaces a notice and keeps the current order when the reorder rejects', async () => {
    const before = useAppStore.getState().appState.projects
    api.reorderProjects.mockRejectedValue(new Error('Project not found: ghost'))

    await useAppStore.getState().reorderProjects(['ghost'])

    expect(useAppStore.getState().appState.projects).toEqual(before)
    expect(useAppStore.getState().notice).toEqual({ message: 'Project not found: ghost', tone: 'error' })
  })
})

describe('useAppStore.openProjectRepository', () => {
  it('names only the project over IPC and surfaces a rejection as a notice', async () => {
    await useAppStore.getState().openProjectRepository('project-1')
    expect(api.openProjectRepository).toHaveBeenCalledWith('project-1')
    expect(useAppStore.getState().notice).toBeNull()

    api.openProjectRepository.mockRejectedValue(new Error('Could not open https://github.com/me/app in the default browser: boom'))
    await useAppStore.getState().openProjectRepository('project-1')
    expect(useAppStore.getState().notice).toEqual({
      message: 'Could not open https://github.com/me/app in the default browser: boom',
      tone: 'error'
    })
  })
})

describe('useAppStore.copyProjectPath', () => {
  it('names only the project over IPC and confirms the copied path with an info notice', async () => {
    await useAppStore.getState().copyProjectPath('project-1')

    expect(api.copyProjectPath).toHaveBeenCalledWith('project-1')
    expect(useAppStore.getState().notice).toEqual({
      message: 'Project path copied: E:\projects\app',
      tone: 'info'
    })
  })

  it('surfaces a rejection as an error notice', async () => {
    api.copyProjectPath.mockRejectedValue(new Error('Project not found: ghost'))

    await useAppStore.getState().copyProjectPath('ghost')

    expect(useAppStore.getState().notice).toEqual({ message: 'Project not found: ghost', tone: 'error' })
  })
})

describe('useAppStore.removeProject', () => {
  const projectAt = (id: string): ProjectRecord => ({ id, name: id, path: `C:\\${id}`, createdAt: '2026-08-20T00:00:00.000Z' })

  beforeEach(() => {
    useAppStore.setState((state) => ({
      appState: { ...state.appState, projects: [projectAt('project-1'), projectAt('project-2')] },
      activeProjectId: 'project-1',
      activeSessionId: claudeSession.id,
      launcherOpen: true
    }))
  })

  it('forgets the project over IPC and moves the selection off its vanished records', async () => {
    await useAppStore.getState().removeProject('project-1')

    expect(api.removeProject).toHaveBeenCalledWith('project-1')
    const state = useAppStore.getState()
    expect(state.appState.projects.map((project) => project.id)).toEqual(['project-2'])
    expect(state.appState.sessions).toEqual([])
    expect(state.activeProjectId).toBe('project-2')
    expect(state.activeSessionId).toBeNull()
    expect(state.launcherOpen).toBe(false)
    expect(state.notice).toBeNull()
  })

  it('leaves the selection alone when a different project is removed', async () => {
    await useAppStore.getState().removeProject('project-2')

    const state = useAppStore.getState()
    expect(state.appState.projects.map((project) => project.id)).toEqual(['project-1'])
    expect(state.appState.sessions).toHaveLength(2)
    expect(state.activeProjectId).toBe('project-1')
    expect(state.activeSessionId).toBe(claudeSession.id)
    expect(state.launcherOpen).toBe(true)
  })

  it('keeps everything and surfaces a notice when the main process rejects', async () => {
    api.removeProject.mockRejectedValue(new Error('Project not found: project-1'))

    await useAppStore.getState().removeProject('project-1')

    const state = useAppStore.getState()
    expect(state.appState.projects).toHaveLength(2)
    expect(state.appState.sessions).toHaveLength(2)
    expect(state.activeProjectId).toBe('project-1')
    expect(state.notice).toEqual({ message: 'Project not found: project-1', tone: 'error' })
  })
})

describe('useAppStore.createSession', () => {
  it('tracks the whole request and ignores duplicate creation from any entry point', async () => {
    let resolve!: (session: SessionRecord) => void
    api.createSession.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const request = useAppStore.getState().createSession('project-1', 'claude', true)

    expect(useAppStore.getState().creatingSession).toEqual({ projectId: 'project-1', kind: 'claude', worktree: true })
    useAppStore.getState().closeLauncher()
    await useAppStore.getState().createSession('project-1', 'powershell', false)
    expect(api.createSession).toHaveBeenCalledTimes(1)

    resolve(claudeSession)
    await request
    expect(useAppStore.getState().creatingSession).toBeNull()
    expect(useAppStore.getState().activeSessionId).toBe(claudeSession.id)
  })

  it('clears pending state on failure and allows retry', async () => {
    api.createSession.mockRejectedValueOnce(new Error('Could not create worktree'))
    await useAppStore.getState().createSession('project-1', 'claude', true)
    expect(useAppStore.getState().creatingSession).toBeNull()
    expect(useAppStore.getState().notice?.message).toBe('Could not create worktree')

    await useAppStore.getState().createSession('project-1', 'claude', true)
    expect(api.createSession).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().creatingSession).toBeNull()
  })

  it('forwards the per-creation worktree choice to the main process verbatim', async () => {
    await useAppStore.getState().createSession('project-1', 'claude', true)
    expect(api.createSession).toHaveBeenLastCalledWith('project-1', 'claude', true)

    await useAppStore.getState().createSession('project-1', 'claude', false)
    expect(api.createSession).toHaveBeenLastCalledWith('project-1', 'claude', false)
  })
})

describe('useAppStore session-kind preferences', () => {
  const reinitializeWith = async (stored: string): Promise<void> => {
    dispose()
    window.localStorage.setItem(SESSION_KINDS_STORAGE_KEY, stored)
    useAppStore.getState().reset()
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
  }

  it('starts from the documented defaults when nothing is stored', () => {
    expect(useAppStore.getState().sessionKindPreferences).toEqual(DEFAULT_SESSION_KIND_PREFERENCES)
  })

  it('patches one field of one kind and persists the whole record', () => {
    useAppStore.getState().setSessionKindPreference('cmd', { worktree: true })
    useAppStore.getState().setSessionKindPreference('powershell', { enabled: false })

    const expected = {
      ...DEFAULT_SESSION_KIND_PREFERENCES,
      powershell: { enabled: false, worktree: false },
      cmd: { enabled: true, worktree: true }
    }
    expect(useAppStore.getState().sessionKindPreferences).toEqual(expected)
    expect(JSON.parse(window.localStorage.getItem(SESSION_KINDS_STORAGE_KEY)!)).toEqual(expected)
  })

  it('merges a partial stored value over the defaults field by field on initialize', async () => {
    await reinitializeWith(JSON.stringify({ claude: { worktree: false }, cmd: { enabled: false } }))

    expect(useAppStore.getState().sessionKindPreferences).toEqual({
      ...DEFAULT_SESSION_KIND_PREFERENCES,
      cmd: { enabled: false, worktree: false },
      claude: { enabled: true, worktree: false }
    })
  })

  it('falls back to the defaults when the stored value is unreadable', async () => {
    await reinitializeWith('not json')

    expect(useAppStore.getState().sessionKindPreferences).toEqual(DEFAULT_SESSION_KIND_PREFERENCES)
  })

  it('merges stored values over macOS defaults after the snapshot identifies the platform', async () => {
    dispose()
    window.localStorage.setItem(SESSION_KINDS_STORAGE_KEY, JSON.stringify({ shell: { worktree: true }, claude: { worktree: false } }))
    useAppStore.getState().reset()
    api.getSnapshot.mockResolvedValueOnce({ platform: 'darwin', state: seededState, capabilities: defaultCapabilities() })

    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(useAppStore.getState().platform).toBe('darwin')
    expect(document.documentElement.dataset.platform).toBe('darwin')
    expect(useAppStore.getState().sessionKindPreferences).toEqual({
      shell: { enabled: true, worktree: true },
      powershell: { enabled: false, worktree: false },
      cmd: { enabled: false, worktree: false },
      claude: { enabled: true, worktree: false },
      codex: { enabled: true, worktree: true },
      gemini: { enabled: false, worktree: true },
      copilot: { enabled: false, worktree: true },
      cursor: { enabled: false, worktree: true },
      comate: { enabled: false, worktree: true },
      qwen: { enabled: false, worktree: true }
    })
  })
})

describe('useAppStore agent idle tracking', () => {
  it('restores background status for inactive sessions from replay after a renderer reload', async () => {
    dispose()
    useAppStore.getState().reset()
    api.replayTerminal.mockImplementation(async (sessionId) => sessionId === claudeSession.id
      ? { data: '\u001b]9;4;3;\u0007', cols: 80, rows: 24, throughSequence: 10 }
      : undefined)
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS * 2)
    expect(api.replayTerminal).toHaveBeenCalledWith(claudeSession.id)
    expect(idleIds()).toEqual({})
    api.emitTerminalData({ sessionId: claudeSession.id, data: '\u001b]9;4;0;\u0007', sequence: 11 })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })
  })

  it('orders replay before newer live completion and skips data already covered by its sequence', async () => {
    dispose()
    useAppStore.getState().reset()
    let resolveReplay!: (replay: TerminalReplay) => void
    api.replayTerminal.mockImplementation(() => new Promise((resolve) => { resolveReplay = resolve }))
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
    api.emitTerminalData({ sessionId: claudeSession.id, data: '\u001b]9;4;0;\u0007', sequence: 11 })
    resolveReplay({ data: '\u001b]9;4;3;\u0007', cols: 80, rows: 24, throughSequence: 10 })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })
  })

  it('does not resurrect background state from a replay that resolves after exit', async () => {
    dispose()
    useAppStore.getState().reset()
    let resolveReplay!: (replay: TerminalReplay) => void
    api.replayTerminal.mockImplementation(() => new Promise((resolve) => { resolveReplay = resolve }))
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
    api.emitTerminalExit({ sessionId: claudeSession.id, exitCode: 0 })
    resolveReplay({ data: '\u001b]9;4;3;\u0007', cols: 80, rows: 24, throughSequence: 10 })
    await vi.advanceTimersByTimeAsync(0)
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'restored prompt' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })
  })

  it('does not reapply a live start already included in a completed replay', async () => {
    dispose()
    useAppStore.getState().reset()
    let resolveReplay!: (replay: TerminalReplay) => void
    api.replayTerminal.mockImplementation(() => new Promise((resolve) => { resolveReplay = resolve }))
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
    api.emitTerminalData({ sessionId: claudeSession.id, data: '\u001b]9;4;3;\u0007', sequence: 9 })
    resolveReplay({ data: '\u001b]9;4;0;\u0007', cols: 80, rows: 24, throughSequence: 10 })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })
  })

  it('trusts the host aggregate until all tasks finish when their starts were trimmed from replay', async () => {
    dispose()
    useAppStore.getState().reset()
    api.getSnapshot.mockResolvedValueOnce({ platform: 'win32', state: { ...seededState, sessions: [{ ...claudeSession, kind: 'codex' }] }, capabilities: defaultCapabilities() })
    api.replayTerminal.mockResolvedValueOnce({ data: '\u001b]777;codeflai-activity;1\u0007output tail', cols: 80, rows: 24, throughSequence: 10 })
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
    api.emitTerminalData({ sessionId: claudeSession.id, data: '\u2022 Completed `/root/one`\n', sequence: 11 })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS * 2)
    expect(idleIds()).toEqual({})
    api.emitTerminalData({ sessionId: claudeSession.id, data: '\u2022 Completed `/root/two`\n\u001b]777;codeflai-activity;0\u0007', sequence: 12 })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })
  })

  it('does not keep buffering shell output that arrived before the initial snapshot', async () => {
    dispose()
    useAppStore.getState().reset()
    let resolveSnapshot!: (snapshot: AppSnapshot) => void
    api.getSnapshot.mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve }))
    dispose = useAppStore.getState().initialize()
    api.emitTerminalData({ sessionId: powershellSession.id, data: 'PS>' })
    resolveSnapshot({ platform: 'win32', state: seededState, capabilities: defaultCapabilities() })
    await vi.advanceTimersByTimeAsync(0)
    // Reusing the id for an agent exposes a leftover queue: new data must be processed.
    useAppStore.setState({ appState: { ...seededState, sessions: [{ ...claudeSession, id: powershellSession.id }] } })
    api.emitTerminalData({ sessionId: powershellSession.id, data: 'idle prompt' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [powershellSession.id]: true })
  })

  it('keeps multiple Codex agents Running until the last completes or is interrupted', async () => {
    const session = { ...claudeSession, kind: 'codex' as const }
    useAppStore.setState({ appState: { ...seededState, sessions: [session] } })
    api.emitTerminalData({ sessionId: session.id, data: '\u2022 Started `/root/one`\n\u2022 Started `/root/two`\n' })
    api.emitTerminalData({ sessionId: session.id, data: '\u2022 Completed `/root/one`\n' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS * 3)
    expect(idleIds()).toEqual({})
    api.emitTerminalData({ sessionId: session.id, data: '\u2022 Interrupted `/root/two`\n' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [session.id]: true })
  })

  it('clears stale timers and activity when a broadcast removes or stops a session', async () => {
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'output' })
    api.onStateChanged.mock.calls[0]![0]({ ...seededState, sessions: [] })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS * 2)
    expect(idleIds()).toEqual({})
  })

  it('keeps background agents Running until the CLI clears its aggregate progress signal', async () => {
    api.emitTerminalData({ sessionId: claudeSession.id, data: '\u001b]9;4;3;\u0007' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS * 3)
    expect(idleIds()).toEqual({})

    api.emitTerminalData({ sessionId: claudeSession.id, data: '\u001b]9;4;0;\u0007' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })
  })

  it('marks an agent session Done only after its output has been quiet for the idle window', async () => {
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'thinking…' })
    expect(idleIds()).toEqual({})

    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS - 1)
    expect(idleIds()).toEqual({})

    await vi.advanceTimersByTimeAsync(1)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })
  })

  it('clears the Done mark the moment new output arrives, then re-marks after quiet', async () => {
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'first' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })

    api.emitTerminalData({ sessionId: claudeSession.id, data: 'more output' })
    expect(idleIds()).toEqual({})

    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })
  })

  it('never tracks shell sessions', async () => {
    api.emitTerminalData({ sessionId: powershellSession.id, data: 'PS>' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS * 2)
    expect(idleIds()).toEqual({})
  })

  it('ignores output for sessions not present in appState', async () => {
    api.emitTerminalData({ sessionId: 'unknown-session', data: 'x' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS * 2)
    expect(idleIds()).toEqual({})
  })

  it('clears tracking when the session process exits', async () => {
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'output' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })

    api.emitTerminalExit({ sessionId: claudeSession.id, exitCode: 0 })
    expect(idleIds()).toEqual({})
  })

  it('cancels a pending idle timer when the session exits before the window elapses', async () => {
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'output' })
    api.emitTerminalExit({ sessionId: claudeSession.id, exitCode: 0 })

    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS * 2)
    expect(idleIds()).toEqual({})
  })

  it('stops tracking and clears pending timers on dispose', async () => {
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'output' })
    dispose()

    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS * 2)
    expect(idleIds()).toEqual({})
  })

  it('reset clears the idle map and pending timers', async () => {
    api.emitTerminalData({ sessionId: claudeSession.id, data: 'output' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(idleIds()).toEqual({ [claudeSession.id]: true })

    useAppStore.getState().reset()
    expect(idleIds()).toEqual({})
  })
})

describe('useAppStore updater', () => {
  const availableResult = {
    status: 'available',
    currentVersion: '0.0.0-test',
    latestVersion: '2.0.0',
    releaseUrl: 'https://example.test/release',
    asset: { fileName: 'Codeflai-Setup-2.0.0-win-x64.exe', size: 1024 }
  } as const

  // Re-runs initialize() against a check result of the test's choosing; the file-level
  // beforeEach has already run one startup check (answered "none").
  const restartWithCheckResult = async (result: UpdateCheckResult): Promise<void> => {
    dispose()
    useAppStore.getState().reset()
    api.checkForUpdates.mockResolvedValueOnce(result)
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
  }

  it('checks for updates once on startup', () => {
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1)
    // The seeded fake answers "none", which must leave nothing on screen.
    expect(useAppStore.getState().updater).toEqual({ phase: 'idle' })
  })

  it('raises the dialog only when a newer version actually exists', async () => {
    await restartWithCheckResult(availableResult)

    expect(useAppStore.getState().updater).toEqual({ phase: 'available', version: '2.0.0', downloadable: true })
  })

  it('marks a release with no installer as not downloadable', async () => {
    const { asset: _asset, ...withoutAsset } = availableResult
    await restartWithCheckResult(withoutAsset)

    expect(useAppStore.getState().updater).toEqual({ phase: 'available', version: '2.0.0', downloadable: false })
  })

  it('stays silent when the background check fails', async () => {
    dispose()
    useAppStore.getState().reset()
    api.checkForUpdates.mockRejectedValueOnce(new Error('Network request failed.'))
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(useAppStore.getState().updater).toEqual({ phase: 'idle' })
    expect(useAppStore.getState().notice).toBeNull()
  })

  it('runs the download and lands on ready', async () => {
    useAppStore.getState().beginUpdate('2.0.0', true)
    api.downloadUpdate.mockResolvedValueOnce({ status: 'ready', version: '2.0.0', fileName: 'Setup.exe' })

    await useAppStore.getState().startUpdateDownload()

    expect(useAppStore.getState().updater).toEqual({ phase: 'ready', version: '2.0.0' })
  })

  it('returns to idle when the download is cancelled', async () => {
    useAppStore.getState().beginUpdate('2.0.0', true)
    api.downloadUpdate.mockResolvedValueOnce({ status: 'cancelled' })

    await useAppStore.getState().startUpdateDownload()

    expect(useAppStore.getState().updater).toEqual({ phase: 'idle' })
  })

  it('keeps the version alongside a download failure so retry knows what to fetch', async () => {
    useAppStore.getState().beginUpdate('2.0.0', true)
    api.downloadUpdate.mockResolvedValueOnce({ status: 'error', message: 'GitHub returned HTTP 500.' })

    await useAppStore.getState().startUpdateDownload()

    expect(useAppStore.getState().updater).toEqual({ phase: 'error', version: '2.0.0', message: 'GitHub returned HTTP 500.' })
  })

  it('folds a rejected invoke into the same error phase', async () => {
    useAppStore.getState().beginUpdate('2.0.0', true)
    api.downloadUpdate.mockRejectedValueOnce(new Error('Unauthorized IPC sender.'))

    await useAppStore.getState().startUpdateDownload()

    expect(useAppStore.getState().updater).toEqual({ phase: 'error', version: '2.0.0', message: 'Unauthorized IPC sender.' })
  })

  it('ignores a second download request while one is already running', async () => {
    useAppStore.getState().beginUpdate('2.0.0', true)
    const first = useAppStore.getState().startUpdateDownload()
    await useAppStore.getState().startUpdateDownload()
    await first

    expect(api.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('merges progress only while that version is downloading', () => {
    useAppStore.setState({ updater: { phase: 'downloading', version: '2.0.0', receivedBytes: 0, totalBytes: 0 } })

    api.emitUpdateProgress({ version: '2.0.0', receivedBytes: 512, totalBytes: 4096 })
    expect(useAppStore.getState().updater).toEqual({ phase: 'downloading', version: '2.0.0', receivedBytes: 512, totalBytes: 4096 })

    // A late event from an abandoned download must not resurrect the progress bar.
    useAppStore.getState().dismissUpdate()
    api.emitUpdateProgress({ version: '2.0.0', receivedBytes: 1024, totalBytes: 4096 })
    expect(useAppStore.getState().updater).toEqual({ phase: 'idle' })
  })

  it('holds the installing phase while the app quits, and reports a failure to launch', async () => {
    useAppStore.setState({ updater: { phase: 'ready', version: '2.0.0' } })
    await useAppStore.getState().installUpdate()
    // The app is on its way out; staying here avoids a flash of another state during teardown.
    expect(useAppStore.getState().updater).toEqual({ phase: 'installing', version: '2.0.0' })

    useAppStore.setState({ updater: { phase: 'ready', version: '2.0.0' } })
    api.installUpdate.mockResolvedValueOnce({ status: 'error', message: 'The downloaded installer is missing.' })
    await useAppStore.getState().installUpdate()
    expect(useAppStore.getState().updater).toEqual({
      phase: 'error',
      version: '2.0.0',
      message: 'The downloaded installer is missing.'
    })
  })

  it('refuses a second install once one is already handed to the OS', async () => {
    useAppStore.setState({ updater: { phase: 'ready', version: '2.0.0' } })

    // Quitting is not instant, so the user has a real window in which to click twice.
    await useAppStore.getState().installUpdate()
    await useAppStore.getState().installUpdate()

    expect(api.installUpdate).toHaveBeenCalledTimes(1)
  })

  it('adopts the version a progress event reports rather than dropping the frame', () => {
    useAppStore.setState({ updater: { phase: 'downloading', version: '2.0.0', receivedBytes: 0, totalBytes: 0 } })

    // The main process re-resolves the release when the download starts, so a release
    // published between the check and the click legitimately reports a newer version.
    api.emitUpdateProgress({ version: '2.1.0', receivedBytes: 64, totalBytes: 512 })

    expect(useAppStore.getState().updater).toEqual({ phase: 'downloading', version: '2.1.0', receivedBytes: 64, totalBytes: 512 })
  })

  it('asks the main process to cancel without pre-empting the download result', async () => {
    useAppStore.setState({ updater: { phase: 'downloading', version: '2.0.0', receivedBytes: 10, totalBytes: 100 } })

    await useAppStore.getState().cancelUpdateDownload()

    expect(api.cancelUpdateDownload).toHaveBeenCalledTimes(1)
    // Still downloading as far as this store knows: startUpdateDownload's own result decides.
    expect(useAppStore.getState().updater.phase).toBe('downloading')
  })

  it('reset returns the updater to idle', () => {
    useAppStore.setState({ updater: { phase: 'ready', version: '2.0.0' } })

    useAppStore.getState().reset()

    expect(useAppStore.getState().updater).toEqual({ phase: 'idle' })
  })
})
// Pinning is renderer-owned like the theme: the store keeps the preference, the main process
// owns the window flag, and the button renders whatever the window actually took.
describe('useAppStore window pinning', () => {
  it('starts unpinned and replays that default at startup so the window converges', () => {
    expect(useAppStore.getState().windowPinned).toBe(false)
    expect(api.setWindowPinned).toHaveBeenCalledWith(false)
  })

  it('pins the window, persists the preference, and unpins again', async () => {
    useAppStore.getState().setWindowPinned(true)

    expect(useAppStore.getState().windowPinned).toBe(true)
    expect(api.setWindowPinned).toHaveBeenLastCalledWith(true)
    expect(window.localStorage.getItem(WINDOW_PINNED_STORAGE_KEY)).toBe('true')
    await vi.advanceTimersByTimeAsync(0)
    expect(useAppStore.getState().windowPinned).toBe(true)

    useAppStore.getState().setWindowPinned(false)
    await vi.advanceTimersByTimeAsync(0)

    expect(api.setWindowPinned).toHaveBeenLastCalledWith(false)
    expect(window.localStorage.getItem(WINDOW_PINNED_STORAGE_KEY)).toBe('false')
    expect(useAppStore.getState().windowPinned).toBe(false)
  })

  it('replays a stored pin at startup', async () => {
    dispose()
    useAppStore.getState().reset()
    window.localStorage.setItem(WINDOW_PINNED_STORAGE_KEY, 'true')
    api = createFakeApi()
    window.codeflai = api

    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.setWindowPinned).toHaveBeenCalledWith(true)
    expect(useAppStore.getState().windowPinned).toBe(true)
  })

  it('shows the flag the window actually took when the request is refused', async () => {
    api.setWindowPinned.mockResolvedValueOnce(false)

    useAppStore.getState().setWindowPinned(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(useAppStore.getState().windowPinned).toBe(false)
  })

  it('lets a newer click win over a late refusal', async () => {
    api.setWindowPinned.mockResolvedValueOnce(false)

    useAppStore.getState().setWindowPinned(true)
    // Toggled off again before the refusal lands: the stale reply must not pin it back.
    useAppStore.getState().setWindowPinned(false)
    await vi.advanceTimersByTimeAsync(0)

    expect(useAppStore.getState().windowPinned).toBe(false)
  })

  it('keeps the preference when the main process is unreachable', async () => {
    api.setWindowPinned.mockRejectedValueOnce(new Error('window gone'))

    useAppStore.getState().setWindowPinned(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(useAppStore.getState().windowPinned).toBe(true)
  })
})

// Auto shutdown is renderer-owned like the pin: the store keeps the preference and runs the
// watcher, and the only thing that ever crosses IPC is the shutdown request itself.
describe('useAppStore auto shutdown', () => {
  const idleSessions = (): void => {
    useAppStore.setState({
      appState: { version: 1, projects: [], sessions: [{ ...claudeSession, status: 'stopped' }] }
    })
  }

  it('starts switched off and never shuts the machine down while nobody asked for it', async () => {
    expect(useAppStore.getState().autoShutdown).toEqual({
      enabled: false,
      intervalMs: DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS,
      timeRangeEnabled: false,
      timeRange: { start: '20:00', end: '08:00' }
    })
    idleSessions()

    await vi.advanceTimersByTimeAsync(60 * 60_000)

    expect(useAppStore.getState().shutdownCountdown).toBeNull()
    expect(api.shutdownSystem).not.toHaveBeenCalled()
  })

  it('leaves an idle machine alone for a full interval before it counts down', async () => {
    idleSessions()
    useAppStore.getState().setAutoShutdownEnabled(true)

    // Switching it on must not shut the machine down on the spot.
    expect(useAppStore.getState().shutdownCountdown).toBeNull()
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS - 1)
    expect(useAppStore.getState().shutdownCountdown).toBeNull()

    await vi.advanceTimersByTimeAsync(1)

    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS)
    expect(JSON.parse(window.localStorage.getItem(AUTO_SHUTDOWN_STORAGE_KEY)!)).toEqual({
      enabled: true,
      intervalMs: DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS,
      timeRangeEnabled: false,
      timeRange: { start: '20:00', end: '08:00' }
    })
  })

  it('counts down to zero and then shuts the machine down', async () => {
    idleSessions()
    useAppStore.getState().setAutoShutdownEnabled(true)
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS - 1)

    await vi.advanceTimersByTimeAsync((SHUTDOWN_COUNTDOWN_SECONDS - 1) * 1_000)

    expect(api.shutdownSystem).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().shutdownCountdown).toBeNull()
  })

  it('holds off entirely while a session is still running', async () => {
    useAppStore.getState().setAutoShutdownEnabled(true)

    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS * 3)

    expect(useAppStore.getState().shutdownCountdown).toBeNull()
    expect(api.shutdownSystem).not.toHaveBeenCalled()
  })

  // Agent sessions stay `running` for as long as their PTY lives, so without this the
  // feature would only ever fire on a machine whose sessions had all been stopped by hand.
  it('shuts down once every agent has gone quiet, without stopping any session', async () => {
    useAppStore.setState({
      appState: { version: 1, projects: [], sessions: [claudeSession] },
      idleAgentSessionIds: { [claudeSession.id]: true }
    })
    useAppStore.getState().setAutoShutdownEnabled(true)

    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)

    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS)
    expect(useAppStore.getState().appState.sessions[0]?.status).toBe('running')
  })

  it('waits while one agent is still working even though the others are done', async () => {
    useAppStore.setState({
      appState: { version: 1, projects: [], sessions: [claudeSession, { ...powershellSession, kind: 'codex' }] },
      idleAgentSessionIds: { [claudeSession.id]: true }
    })
    useAppStore.getState().setAutoShutdownEnabled(true)

    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS * 2)

    expect(useAppStore.getState().shutdownCountdown).toBeNull()
  })

  it('lets a live shell hold the shutdown off however quiet it is', async () => {
    useAppStore.setState({
      appState: { version: 1, projects: [], sessions: [powershellSession] },
      idleAgentSessionIds: { [powershellSession.id]: true }
    })
    useAppStore.getState().setAutoShutdownEnabled(true)

    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS * 2)

    expect(useAppStore.getState().shutdownCountdown).toBeNull()
  })

  it('counts a session that is still being created as running', async () => {
    useAppStore.setState({
      appState: { version: 1, projects: [], sessions: [{ ...claudeSession, status: 'creating' }] }
    })
    useAppStore.getState().setAutoShutdownEnabled(true)

    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)

    expect(useAppStore.getState().shutdownCountdown).toBeNull()
  })

  it('switches the whole feature off when the user cancels the shutdown', async () => {
    idleSessions()
    useAppStore.getState().setAutoShutdownEnabled(true)
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)
    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS)

    useAppStore.getState().cancelAutoShutdown()

    expect(useAppStore.getState().shutdownCountdown).toBeNull()
    expect(useAppStore.getState().autoShutdown.enabled).toBe(false)
    expect(JSON.parse(window.localStorage.getItem(AUTO_SHUTDOWN_STORAGE_KEY)!)).toMatchObject({
      enabled: false,
      intervalMs: DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS
    })

    // Neither the rest of this countdown nor a later check may bring it back.
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS * 3)
    expect(api.shutdownSystem).not.toHaveBeenCalled()
    expect(useAppStore.getState().shutdownCountdown).toBeNull()
  })

  it('shuts down immediately when the user skips the rest of the countdown', async () => {
    idleSessions()
    useAppStore.getState().setAutoShutdownEnabled(true)
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)

    await useAppStore.getState().shutdownNow()

    expect(api.shutdownSystem).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().shutdownCountdown).toBeNull()

    // The countdown timer is gone with it: no second request once its last second elapses.
    await vi.advanceTimersByTimeAsync(SHUTDOWN_COUNTDOWN_SECONDS * 1_000)
    expect(api.shutdownSystem).toHaveBeenCalledTimes(1)
  })

  it('restarts the clock on a new frequency and persists it', async () => {
    idleSessions()
    useAppStore.getState().setAutoShutdownEnabled(true)
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS - 1_000)

    useAppStore.getState().setAutoShutdownInterval(60_000)

    expect(JSON.parse(window.localStorage.getItem(AUTO_SHUTDOWN_STORAGE_KEY)!).intervalMs).toBe(60_000)
    // The old timer is gone, so the moment it would have fired passes quietly.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(useAppStore.getState().shutdownCountdown).toBeNull()

    await vi.advanceTimersByTimeAsync(59_000)
    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS)
  })

  it('ignores a frequency no dropdown offers', () => {
    useAppStore.getState().setAutoShutdownInterval(7_000)

    expect(useAppStore.getState().autoShutdown.intervalMs).toBe(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)
  })

  it('reports a refused shutdown and switches itself off rather than retrying forever', async () => {
    api.shutdownSystem.mockResolvedValueOnce({ status: 'error', message: 'Access is denied.' })
    idleSessions()
    useAppStore.getState().setAutoShutdownEnabled(true)
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)

    await useAppStore.getState().shutdownNow()

    expect(useAppStore.getState().autoShutdown.enabled).toBe(false)
    expect(useAppStore.getState().notice?.tone).toBe('error')
    expect(useAppStore.getState().notice?.message).toContain('Access is denied.')

    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS * 3)
    expect(api.shutdownSystem).toHaveBeenCalledTimes(1)
  })

  it('treats an unreachable main process the same as a refusal', async () => {
    api.shutdownSystem.mockRejectedValueOnce(new Error('window gone'))
    idleSessions()

    await useAppStore.getState().shutdownNow()

    expect(useAppStore.getState().autoShutdown.enabled).toBe(false)
    expect(useAppStore.getState().notice?.message).toContain('window gone')
  })

  it('arms the watcher from a stored preference at startup', async () => {
    dispose()
    useAppStore.getState().reset()
    window.localStorage.setItem(AUTO_SHUTDOWN_STORAGE_KEY, JSON.stringify({ enabled: true, intervalMs: 60_000 }))
    api = createFakeApi()
    api.getSnapshot.mockResolvedValue({
      platform: 'win32',
      state: { version: 1, projects: [], sessions: [{ ...claudeSession, status: 'stopped' }] },
      capabilities: defaultCapabilities()
    })
    window.codeflai = api

    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(useAppStore.getState().autoShutdown).toMatchObject({ enabled: true, intervalMs: 60_000 })

    await vi.advanceTimersByTimeAsync(60_000)

    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS)
  })

  // The time-of-day window. Everything here pins the clock first: these are the only
  // auto-shutdown tests whose answer depends on what hour it happens to be.
  it('waits for the window to open instead of losing its cadence', async () => {
    idleSessions()
    vi.setSystemTime(new Date(2026, 8, 16, 19, 58))
    useAppStore.getState().setAutoShutdownTimeRange({ start: '20:00', end: '08:00' })
    useAppStore.getState().setAutoShutdownTimeRangeEnabled(true)
    useAppStore.getState().setAutoShutdownEnabled(true)
    useAppStore.getState().setAutoShutdownInterval(60_000)

    // 19:59 — nothing is running, but the window has not opened, so the check passes quietly.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(useAppStore.getState().shutdownCountdown).toBeNull()
    expect(api.shutdownSystem).not.toHaveBeenCalled()

    // 20:00 — the same watcher, never restarted, finds the window open on its next tick.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS)
  })

  it('shuts the machine down at any hour while no window is switched on', async () => {
    idleSessions()
    vi.setSystemTime(new Date(2026, 8, 16, 13, 0))
    useAppStore.getState().setAutoShutdownEnabled(true)

    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS)

    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS)
  })

  it('keeps the window while the restriction is switched off', () => {
    useAppStore.getState().setAutoShutdownTimeRange({ start: '22:30', end: '06:00' })
    useAppStore.getState().setAutoShutdownTimeRangeEnabled(true)
    expect(JSON.parse(window.localStorage.getItem(AUTO_SHUTDOWN_STORAGE_KEY)!)).toMatchObject({
      timeRangeEnabled: true,
      timeRange: { start: '22:30', end: '06:00' }
    })

    useAppStore.getState().setAutoShutdownTimeRangeEnabled(false)

    // The hours somebody typed survive the click that switched them off, exactly as the
    // frequency survives the whole feature being switched off.
    expect(JSON.parse(window.localStorage.getItem(AUTO_SHUTDOWN_STORAGE_KEY)!)).toMatchObject({
      timeRangeEnabled: false,
      timeRange: { start: '22:30', end: '06:00' }
    })
  })

  it('ignores a window it cannot read', () => {
    useAppStore.getState().setAutoShutdownTimeRange({ start: '', end: '06:00' })

    expect(useAppStore.getState().autoShutdown.timeRange).toEqual({ start: '20:00', end: '08:00' })
  })

  // Unlike the frequency, editing the window must not restart the clock: with an hour
  // selected, every keystroke in the time control would otherwise cost an hour.
  it('does not push the next check back when the window is edited', async () => {
    idleSessions()
    vi.setSystemTime(new Date(2026, 8, 16, 22, 0))
    useAppStore.getState().setAutoShutdownInterval(60_000)
    useAppStore.getState().setAutoShutdownEnabled(true)
    await vi.advanceTimersByTimeAsync(59_000)

    useAppStore.getState().setAutoShutdownTimeRange({ start: '20:00', end: '08:00' })
    useAppStore.getState().setAutoShutdownTimeRangeEnabled(true)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS)
  })

  it('abandons a countdown the machine slept through when it wakes outside the window', async () => {
    idleSessions()
    vi.setSystemTime(new Date(2026, 8, 16, 7, 30))
    useAppStore.getState().setAutoShutdownTimeRange({ start: '20:00', end: '08:00' })
    useAppStore.getState().setAutoShutdownTimeRangeEnabled(true)
    useAppStore.getState().setAutoShutdownInterval(60_000)
    useAppStore.getState().setAutoShutdownEnabled(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(useAppStore.getState().shutdownCountdown).toBe(SHUTDOWN_COUNTDOWN_SECONDS)

    // The lid opened at nine, long after the window closed. A sleep of that length is the
    // one case the countdown restarts itself for, and restarting it here would power the
    // machine off at exactly the hour the user said not to.
    vi.setSystemTime(new Date(2026, 8, 16, 9, 0))
    await vi.advanceTimersByTimeAsync(1_000)

    expect(useAppStore.getState().shutdownCountdown).toBeNull()
    expect(api.shutdownSystem).not.toHaveBeenCalled()

    // The periodic check is back, and it stays quiet until the window opens again.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(useAppStore.getState().shutdownCountdown).toBeNull()
  })

  it('stops every timer when the store is torn down', async () => {
    idleSessions()
    useAppStore.getState().setAutoShutdownEnabled(true)

    dispose()
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_SHUTDOWN_INTERVAL_MS * 2)

    expect(api.shutdownSystem).not.toHaveBeenCalled()
    // afterEach calls dispose() again; a second call has to stay harmless.
    dispose = () => undefined
  })
})

describe('useAppStore notifications', () => {
  it('defaults notifications on when nothing is stored', async () => {
    await reinitializeWith(null)

    expect(useAppStore.getState().notificationsEnabled).toBe(true)
  })

  it('reads a stored off preference', async () => {
    await reinitializeWith('false')

    expect(useAppStore.getState().notificationsEnabled).toBe(false)
  })

  it('treats a malformed preference as on', async () => {
    await reinitializeWith('perhaps')

    expect(useAppStore.getState().notificationsEnabled).toBe(true)
  })

  it('clears the badge when notifications are switched off', () => {
    useAppStore.getState().setNotificationsEnabled(false)

    expect(useAppStore.getState().notificationsEnabled).toBe(false)
    expect(window.localStorage.getItem('codeflai.notifications')).toBe('false')
    // A number that will never update again is worse than no badge.
    expect(api.setUnreadBadge).toHaveBeenLastCalledWith(0, '')
  })
})

describe('session notifications', () => {
  const project: ProjectRecord = {
    id: 'project-1', name: 'Project', path: 'C:\project', createdAt: claudeSession.createdAt
  }

  const seedProject = (sessions: SessionRecord[] = [claudeSession, powershellSession]): void => {
    api.onStateChanged.mock.calls.at(-1)![0]({ ...seededState, projects: [project], sessions })
  }

  beforeEach(() => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })

  it('notifies at the Done edge while the window is unattended', async () => {
    seedProject()
    vi.mocked(document.hasFocus).mockReturnValue(false)

    api.emitTerminalData({ sessionId: claudeSession.id, data: 'working…' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)

    expect(api.notifySessionIdle).toHaveBeenCalledWith(claudeSession.id, 'Fix login bug', 'Project · Done')
  })

  it('stays silent at the Done edge while the window is attended', async () => {
    seedProject()
    vi.mocked(document.hasFocus).mockReturnValue(true)

    api.emitTerminalData({ sessionId: claudeSession.id, data: 'working…' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)

    expect(api.notifySessionIdle).not.toHaveBeenCalled()
  })

  it('stays silent when the preference is off', async () => {
    seedProject()
    vi.mocked(document.hasFocus).mockReturnValue(false)
    useAppStore.getState().setNotificationsEnabled(false)

    api.emitTerminalData({ sessionId: claudeSession.id, data: 'working…' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)

    expect(api.notifySessionIdle).not.toHaveBeenCalled()
  })

  // Shells still raise unread markers — they do not repaint themselves, so bytes really are
  // new content — but a notification per chunk of output would be unusable.
  it('never notifies for shell output, while still marking it unread', async () => {
    seedProject()
    vi.mocked(document.hasFocus).mockReturnValue(false)

    api.emitTerminalData({ sessionId: powershellSession.id, data: 'PS C:\> ' })
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)

    expect(api.notifySessionIdle).not.toHaveBeenCalled()
    expect(useAppStore.getState().unreadSessionIds).toContain(powershellSession.id)
  })

  // The retained tail redrawn on every startup and reconnect must never manufacture a toast.
  it('never notifies for replayed output', async () => {
    const stopped: SessionRecord = { ...claudeSession, status: 'stopped' }
    seedProject([stopped, powershellSession])
    vi.mocked(document.hasFocus).mockReturnValue(false)
    api.replayTerminal.mockResolvedValueOnce({ data: 'earlier output', cols: 120, rows: 30, throughSequence: 1 })

    // Going stopped -> running is what triggers hydration of the retained output.
    seedProject([claudeSession, powershellSession])
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)

    expect(api.notifySessionIdle).not.toHaveBeenCalled()
  })

  it('never notifies for output arriving before the snapshot loads', async () => {
    dispose()
    useAppStore.getState().reset()
    api = createFakeApi()
    window.codeflai = api
    // Never resolves: the store stays in its pre-snapshot state for the whole test.
    api.getSnapshot.mockReturnValueOnce(new Promise(() => undefined))
    dispose = useAppStore.getState().initialize()
    api.onStateChanged.mock.calls.at(-1)![0]({ ...seededState, projects: [project] })
    vi.mocked(document.hasFocus).mockReturnValue(false)

    api.emitTerminalExit({ sessionId: claudeSession.id, exitCode: 0 })

    expect(api.notifySessionIdle).not.toHaveBeenCalled()
  })

  it('notifies when a session exits on its own', () => {
    seedProject()
    vi.mocked(document.hasFocus).mockReturnValue(false)

    api.emitTerminalExit({ sessionId: claudeSession.id, exitCode: 0 })

    expect(api.notifySessionIdle).toHaveBeenCalledWith(claudeSession.id, 'Fix login bug', 'Project · Session exited')
  })

  it('does not notify for an exit the user asked for', async () => {
    seedProject()
    vi.mocked(document.hasFocus).mockReturnValue(false)

    await useAppStore.getState().stopSession(claudeSession.id)
    api.emitTerminalExit({ sessionId: claudeSession.id, exitCode: 0 })

    expect(api.notifySessionIdle).not.toHaveBeenCalled()
  })

  // sessionRecordSchema.title has no upper bound; notificationIdleRequestSchema caps it at 200,
  // so an untruncated long title would be dropped by our own validation.
  it('truncates a title that exceeds the schema cap', () => {
    seedProject([{ ...claudeSession, title: 'x'.repeat(250) }, powershellSession])
    vi.mocked(document.hasFocus).mockReturnValue(false)

    api.emitTerminalExit({ sessionId: claudeSession.id, exitCode: 0 })

    expect(api.notifySessionIdle.mock.calls.at(-1)?.[1]).toHaveLength(200)
  })

  it('pushes the unread count to the badge', () => {
    seedProject()
    vi.mocked(document.hasFocus).mockReturnValue(false)

    api.emitTerminalExit({ sessionId: claudeSession.id, exitCode: 0 })

    expect(api.setUnreadBadge).toHaveBeenLastCalledWith(1, '1 unread session(s)')
  })

  // Unread survives restarts (it is restored from workspace.unreadSessionIds), so the badge
  // has to be drawn from the restored count rather than starting at zero.
  it('draws the badge from unread restored at startup', async () => {
    dispose()
    useAppStore.getState().reset()
    api = createFakeApi()
    window.codeflai = api
    api.getSnapshot.mockResolvedValueOnce({
      platform: 'win32',
      capabilities: defaultCapabilities(),
      state: {
        ...seededState,
        projects: [project],
        workspace: {
          activeProjectId: null,
          activeSessionId: null,
          collapsedProjectIds: [],
          unreadSessionIds: [claudeSession.id]
        }
      }
    })
    vi.mocked(document.hasFocus).mockReturnValue(false)

    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.setUnreadBadge).toHaveBeenLastCalledWith(1, '1 unread session(s)')
  })

  it('switches to the session a clicked notification names', () => {
    seedProject()

    api.onNotificationActivate.mock.calls.at(-1)![0]({ sessionId: claudeSession.id })

    expect(useAppStore.getState().activeSessionId).toBe(claudeSession.id)
  })

  // setActiveSession does not guard against unknown ids and would blank the terminal pane.
  it('ignores a click naming a session that is gone', () => {
    seedProject()
    useAppStore.getState().setActiveSession(powershellSession.id)

    api.onNotificationActivate.mock.calls.at(-1)![0]({ sessionId: 'deleted-session' })

    expect(useAppStore.getState().activeSessionId).toBe(powershellSession.id)
  })
})
