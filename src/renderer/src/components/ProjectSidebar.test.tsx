// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AGENT_KINDS, type AgentKind } from '../../../shared/agent-kinds'
import type {
  AppInfo,
  AppSnapshot,
  AppState,
  CapabilityState,
  DeleteSessionResult,
  ProjectRecord,
  SessionRecord,
  ToolAvailability,
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateInstallResult
} from '../../../shared/contracts'
import { EXTERNAL_LINKS } from '../../../shared/links'
import type { TerminalReplay } from '../../../shared/pty-protocol'
import closeIconUrl from '../assets/close.svg'
import gitIconUrl from '../assets/git.svg'
import githubIconUrl from '../assets/github.svg'
import gitlabIconUrl from '../assets/gitlab.svg'
import optionsIconUrl from '../assets/options.svg'
import removeIconUrl from '../assets/remove.svg'
import { useAppStore } from '../store/use-app-store'
import ProjectSidebar from './ProjectSidebar'

type FakeApi = Window['codeflai']

const createFakeApi = (): FakeApi => ({
  saveWorkspace: vi.fn(async () => undefined),
  getSnapshot: vi.fn(async (): Promise<AppSnapshot> => ({
    platform: 'win32',
    state: { version: 1, projects: [], sessions: [] },
    capabilities: defaultCapabilities()
  })),
  addProject: vi.fn(async (): Promise<ProjectRecord | null> => null),
  reopenProject: vi.fn(async (): Promise<ProjectRecord> => { throw new Error('reopenProject not stubbed') }),
  removeRecentProject: vi.fn(async (): Promise<void> => undefined),
  selectCloneDirectory: vi.fn(async (): Promise<string | null> => null),
  cloneProject: vi.fn(async (): Promise<ProjectRecord> => { throw new Error('cloneProject not stubbed') }),
  reorderProjects: vi.fn(async (): Promise<ProjectRecord[]> => []),
  openProjectInVSCode: vi.fn(async (_projectId: string): Promise<void> => undefined),
  openProjectFolder: vi.fn(async (_projectId: string): Promise<void> => undefined),
  openProjectRepository: vi.fn(async (_projectId: string): Promise<void> => undefined),
  removeProject: vi.fn(async (_projectId: string): Promise<void> => undefined),
  createSession: vi.fn(async () => {
    throw new Error('createSession not stubbed for this test')
  }),
  restoreSession: vi.fn(async (_sessionId: string): Promise<SessionRecord> => {
    throw new Error('restoreSession not stubbed for this test')
  }),
  deleteSession: vi.fn(async (_sessionId: string): Promise<DeleteSessionResult> => ({ status: 'deleted' })),
  renameSession: vi.fn(async (_sessionId: string, title: string): Promise<SessionRecord> => ({ ...runningWorktreeSession, title })),
  stopSession: vi.fn(async (_sessionId: string): Promise<void> => undefined),
  reorderSessions: vi.fn(async (): Promise<SessionRecord[]> => []),
  submitFirstInput: vi.fn(async () => undefined),
  setTheme: vi.fn(async (): Promise<void> => undefined),
  setWindowPinned: vi.fn(async (pinned: boolean): Promise<boolean> => pinned),
  getAppInfo: vi.fn(async (): Promise<AppInfo> => ({ version: '0.0.0-test', links: EXTERNAL_LINKS })),
  checkForUpdates: vi.fn(async (): Promise<UpdateCheckResult> => ({ status: 'none', currentVersion: '0.0.0-test' })),
  downloadUpdate: vi.fn(async (): Promise<UpdateDownloadResult> => ({ status: 'cancelled' })),
  cancelUpdateDownload: vi.fn(async (): Promise<void> => undefined),
  installUpdate: vi.fn(async (): Promise<UpdateInstallResult> => ({ status: 'launched' })),
  openExternalLink: vi.fn(async (): Promise<void> => undefined),
  getAutoLaunch: vi.fn(async (): Promise<boolean> => false),
  setAutoLaunch: vi.fn(async (enabled: boolean): Promise<boolean> => enabled),
  writeTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
  replayTerminal: vi.fn(async (_sessionId: string): Promise<TerminalReplay | undefined> => undefined),
  onStateChanged: vi.fn(() => () => undefined),
  onTerminalData: vi.fn(() => () => undefined),
  onTerminalExit: vi.fn(() => () => undefined),
  onUpdateProgress: vi.fn(() => () => undefined)
})

// A real snapshot carries one entry per agent kind; built from the registry so adding a CLI
// does not mean hand-editing every fixture in this file.
const agentCapabilities = (detail = ''): Record<AgentKind, ToolAvailability> =>
  Object.fromEntries(AGENT_KINDS.map((kind) => [kind, { available: true, detail }])) as Record<AgentKind, ToolAvailability>

const defaultCapabilities = (): CapabilityState => ({
  ...agentCapabilities('C:\\agents\\cli.exe'),
  vscode: { available: true, detail: 'C:\\Code\\Code.exe' }
})

const project1: ProjectRecord = {
  id: 'project-1',
  name: 'demo-project',
  path: 'C:\\work\\demo-project',
  createdAt: '2026-08-20T00:00:00.000Z'
}

const stoppedSession: SessionRecord = {
  id: 'session-ps',
  projectId: 'project-1',
  kind: 'powershell',
  title: 'New PowerShell session',
  titleState: 'pending',
  createdAt: '2026-08-20T00:01:00.000Z',
  mode: 'ordinary',
  launchPath: 'C:\\work\\demo-project',
  status: 'stopped'
}

const runningWorktreeSession: SessionRecord = {
  id: 'session-claude',
  projectId: 'project-1',
  kind: 'claude',
  title: 'Fix login bug',
  titleState: 'complete',
  createdAt: '2026-08-20T00:02:00.000Z',
  mode: 'worktree',
  worktreeName: 'worktree-260820-1',
  worktreePath: 'C:\\work\\demo-project\\.worktrees\\worktree-260820-1',
  branchName: 'worktree-260820-1',
  launchPath: 'C:\\work\\demo-project\\.worktrees\\worktree-260820-1',
  status: 'running'
}

const seedStore = (state: AppState, capabilities: CapabilityState = defaultCapabilities()): void => {
  useAppStore.setState({ appState: state, capabilities, activeProjectId: null, activeSessionId: null, launcherOpen: false, searchQuery: '', notice: null })
}

let api: FakeApi

beforeEach(() => {
  useAppStore.getState().reset()
  api = createFakeApi()
  window.codeflai = api
})

afterEach(() => {
  vi.restoreAllMocks()
})

const projectOptionsName = (projectName: string): string => `Project options for ${projectName}`

const requestSessionDelete = async (user: ReturnType<typeof userEvent.setup>, title: string): Promise<HTMLElement> => {
  const trigger = screen.getByRole('button', { name: `Session options for ${title}` })
  await user.click(trigger)
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  return trigger
}

describe('session organization controls', () => {
  beforeEach(() => seedStore({ version: 1, projects: [project1], sessions: [runningWorktreeSession, stoppedSession] }))

  it('renames inline with Enter and cancels subsequent edits with Escape', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Session options for Fix login bug' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Session name' })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, 'Investigate sign-in{Enter}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Session name' })).not.toBeInTheDocument())
    expect(api.renameSession).toHaveBeenCalledWith(runningWorktreeSession.id, 'Investigate sign-in')
    expect(screen.getByText('Investigate sign-in')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Session options for Investigate sign-in' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Session options for Investigate sign-in' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await user.type(screen.getByRole('textbox', { name: 'Session name' }), ' discarded{Escape}')
    expect(api.renameSession).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Investigate sign-in')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Session options for Investigate sign-in' })).toHaveFocus()
  })

  it('keeps failed rename edits and prevents blank names', async () => {
    const user = userEvent.setup()
    vi.mocked(api.renameSession).mockRejectedValueOnce(new Error('Cannot write state'))
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Session options for Fix login bug' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Session name' })
    await user.clear(input)
    await user.type(input, '   {Enter}')
    expect(api.renameSession).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'Retry name{Enter}')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Cannot write state'))
    expect(input).toHaveValue('Retry name')
    expect(input).toHaveFocus()
  })

  it('returns focus to search when a rename removes the row from search results', async () => {
    const user = userEvent.setup()
    useAppStore.getState().setSearchQuery('login')
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Session options for Fix login bug' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Session name' })
    await user.clear(input)
    await user.type(input, 'Different task{Enter}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Session name' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Search sessions' })).toHaveFocus()
  })

  it('gives every session menu item a decorative icon without changing its name', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Session options for Fix login bug' }))

    for (const name of ['Rename', 'Stop', 'Delete']) {
      const glyph = screen.getByRole('menuitem', { name }).querySelector('svg')
      expect(glyph).not.toBeNull()
      expect(glyph).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('confirms before stopping a running session', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Session options for Fix login bug' }))
    await user.click(screen.getByRole('menuitem', { name: 'Stop' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Stop session' })
    expect(api.stopSession).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }))

    expect(api.stopSession).toHaveBeenCalledWith(runningWorktreeSession.id)
    expect(api.deleteSession).not.toHaveBeenCalled()
    expect(api.restoreSession).not.toHaveBeenCalled()
  })

  it('abandons a stop when the confirmation is dismissed', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Session options for Fix login bug' }))
    await user.click(screen.getByRole('menuitem', { name: 'Stop' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog', { name: 'Stop session' })).not.toBeInTheDocument()
    expect(api.stopSession).not.toHaveBeenCalled()
  })

  it('disables Stop for a session that is already stopped', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: `Session options for ${stoppedSession.title}` }))

    expect(screen.getByRole('menuitem', { name: 'Stop' })).toBeDisabled()
  })

  const fakeDataTransfer = () => {
    const values = new Map<string, string>()
    return {
      effectAllowed: '',
      dropEffect: '',
      setData: (type: string, value: string) => { values.set(type, value) },
      getData: (type: string) => values.get(type) ?? ''
    }
  }

  it('reorders sessions within a project by dragging', async () => {
    render(<ProjectSidebar />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveAttribute('draggable', 'true')

    fireEvent.dragStart(rows[0]!, { dataTransfer: fakeDataTransfer() })
    fireEvent.dragOver(rows[1]!, { dataTransfer: fakeDataTransfer(), clientY: 500 })
    fireEvent.drop(rows[1]!, { dataTransfer: fakeDataTransfer(), clientY: 500 })

    expect(api.reorderSessions).toHaveBeenCalledWith([stoppedSession.id, runningWorktreeSession.id])
  })

  it('does not offer a drop target in another project', async () => {
    const otherProject: ProjectRecord = { ...project1, id: 'project-2', name: 'Other', path: 'C:\other' }
    seedStore({
      version: 1,
      projects: [project1, otherProject],
      sessions: [runningWorktreeSession, { ...stoppedSession, projectId: otherProject.id }]
    })
    render(<ProjectSidebar />)
    const rows = screen.getAllByRole('listitem')

    fireEvent.dragStart(rows[0]!, { dataTransfer: fakeDataTransfer() })
    fireEvent.drop(rows[1]!, { dataTransfer: fakeDataTransfer(), clientY: 500 })

    expect(api.reorderSessions).not.toHaveBeenCalled()
  })

  it('disables session dragging while a filter is active', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session status' }), 'running')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('draggable', 'false')
  })

  it('offers only a status filter, with stopped covering put-away sessions', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))

    expect(screen.queryByRole('combobox', { name: 'Session visibility' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session status' }), 'stopped')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getByText(stoppedSession.title)).toBeVisible()
    expect(screen.queryByText('Fix login bug')).not.toBeInTheDocument()
  })

  it('combines status with search and discards unapplied filter changes', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session status' }), 'stopped')
    await user.keyboard('{Escape}')
    expect(screen.getByText('Fix login bug')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    expect(screen.getByRole('combobox', { name: 'Session status' })).toHaveValue('all')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session status' }), 'running')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    act(() => useAppStore.getState().setSearchQuery('login'))
    expect(screen.getByText('Fix login bug')).toBeVisible()
    expect(screen.queryByText(stoppedSession.title)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('combobox', { name: 'Session status' })).toHaveValue('all')
  })

  it('describes unread sessions and shows project counts without duplicating status dots', () => {
    useAppStore.setState({ unreadSessionIds: [runningWorktreeSession.id] })
    render(<ProjectSidebar />)
    const rowButton = screen.getByText(runningWorktreeSession.title).closest('button')!
    expect(rowButton).toHaveAccessibleDescription('Unread output')
    expect(screen.queryByRole('img', { name: 'Unread output' })).not.toBeInTheDocument()
    expect(rowButton.closest('.session-row')).toHaveAttribute('data-unread', 'true')
    expect(screen.getByLabelText('1 unread session(s)')).toHaveTextContent('1')
    expect(screen.getByRole('img', { name: 'Running' })).toBeVisible()
    act(() => useAppStore.setState({ unreadSessionIds: [] }))
    expect(rowButton).not.toHaveAccessibleDescription()
    expect(rowButton.closest('.session-row')).not.toHaveAttribute('data-unread')
    expect(screen.queryByLabelText('1 unread session(s)')).not.toBeInTheDocument()
  })
})

it('keeps creation feedback visible after dismissing and reopening the launcher', async () => {
  const user = userEvent.setup()
  let resolve!: (session: SessionRecord) => void
  vi.mocked(api.createSession).mockReturnValueOnce(new Promise((done) => { resolve = done }))
  seedStore({ version: 1, projects: [project1], sessions: [] })
  render(<ProjectSidebar />)
  await openProjectOptions(user)
  await user.click(screen.getByRole('menuitem', { name: 'New session' }))
  const entry = screen.getByRole('button', { name: 'Claude (new worktree)' })
  await user.click(entry)

  expect(screen.getByRole('status')).toHaveTextContent('Creating session...')
  expect(screen.getByRole('status')).toHaveTextContent(project1.name)
  expect(entry).toHaveAttribute('aria-busy', 'true')
  expect(entry).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(screen.queryByLabelText('Create session')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toBeVisible()

  await openProjectOptions(user)
  await user.click(screen.getByRole('menuitem', { name: 'New session' }))
  expect(screen.getByRole('button', { name: 'Claude (new worktree)' })).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('button', { name: 'PowerShell' })).toBeDisabled()
  expect(api.createSession).toHaveBeenCalledTimes(1)

  await act(async () => resolve(runningWorktreeSession))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Create session')).not.toBeInTheDocument()
  expect(useAppStore.getState().activeSessionId).toBe(runningWorktreeSession.id)
})

it('replaces loading with an error and re-enables creation after failure', async () => {
  const user = userEvent.setup()
  let reject!: (reason: Error) => void
  vi.mocked(api.createSession).mockReturnValueOnce(new Promise((_done, fail) => { reject = fail }))
  seedStore({ version: 1, projects: [project1], sessions: [] })
  render(<ProjectSidebar />)
  await openProjectOptions(user)
  await user.click(screen.getByRole('menuitem', { name: 'New session' }))
  const entry = screen.getByRole('button', { name: 'PowerShell' })
  await user.click(entry)
  act(() => useAppStore.setState({ locale: 'zh-CN' }))
  expect(screen.getByRole('status')).toHaveTextContent('正在创建会话…')

  await act(async () => reject(new Error('Session launch failed')))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Session launch failed')
  expect(entry).toBeEnabled()
  expect(entry).not.toHaveAttribute('aria-busy', 'true')
})

it('shows loading for the macOS new-shell shortcut and ignores repeated shortcuts', async () => {
  let resolve!: (session: SessionRecord) => void
  vi.mocked(api.createSession).mockReturnValueOnce(new Promise((done) => { resolve = done }))
  seedStore({ version: 1, projects: [project1], sessions: [] })
  useAppStore.setState({ platform: 'darwin', activeProjectId: project1.id })
  useAppStore.getState().setSessionKindPreference('shell', { enabled: true })
  render(<ProjectSidebar />)
  fireEvent.keyDown(document, { key: 't', code: 'KeyT', metaKey: true })
  expect(screen.getByRole('status')).toHaveTextContent('Creating session...')
  fireEvent.keyDown(document, { key: 't', code: 'KeyT', metaKey: true })
  expect(api.createSession).toHaveBeenCalledTimes(1)
  expect(api.createSession).toHaveBeenCalledWith(project1.id, 'shell', false)
  await act(async () => resolve({ ...stoppedSession, kind: 'shell', status: 'running' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

const openProjectOptions = async (
  user: ReturnType<typeof userEvent.setup>,
  projectName = project1.name
): Promise<HTMLElement> => {
  await user.click(screen.getByRole('button', { name: projectOptionsName(projectName) }))
  return screen.getByRole('menu', { name: projectOptionsName(projectName) })
}

const geometry = (top: number, bottom: number, left = 0, right = 300): DOMRect =>
  ({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    top,
    right,
    bottom,
    left,
    toJSON: () => ({})
  }) as DOMRect

const controlProjectOptionsGeometry = (state: {
  rowTop: number
  rowBottom: number
  triggerTop?: number
  triggerBottom?: number
  scrollportTop: number
  scrollportBottom: number
  menuHeight: number
  menuRectHeight?: number
  clampedMenuRectHeight?: number
  menuBorderTop?: number
  menuBorderBottom?: number
}): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('project-groups')) return geometry(state.scrollportTop, state.scrollportBottom)
    if (this.hasAttribute('data-project-row')) return geometry(state.rowTop, state.rowBottom)
    if (this.classList.contains('project-options-trigger')) {
      return geometry(state.triggerTop ?? state.rowTop, state.triggerBottom ?? state.rowBottom)
    }
    if (this.classList.contains('project-options-menu')) {
      const clamped = this.style.getPropertyValue('--project-options-menu-max-height') !== ''
      const height = clamped ? state.clampedMenuRectHeight ?? state.menuRectHeight ?? 0 : state.menuRectHeight ?? 0
      return geometry(0, height)
    }
    return geometry(0, 0)
  })
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('project-groups')
      ? ([geometry(state.scrollportTop, state.scrollportBottom)] as unknown as DOMRectList)
      : ([] as unknown as DOMRectList)
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('project-options-menu') ? state.menuHeight : 0
  })
  const originalGetComputedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    if (!element.classList.contains('project-options-menu')) return originalGetComputedStyle(element)
    const style = originalGetComputedStyle(element)
    return new Proxy(style, {
      get(target, property) {
        if (property === 'borderTopWidth') return `${state.menuBorderTop ?? 0}px`
        if (property === 'borderBottomWidth') return `${state.menuBorderBottom ?? 0}px`
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  })
}

const openSearch = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByRole('button', { name: 'Search sessions' })
  if (trigger.getAttribute('aria-expanded') !== 'true') await user.click(trigger)
  return screen.getByRole('searchbox', { name: 'Search sessions' })
}

describe('ProjectSidebar', () => {
  it('renders Add Project, search, and the project group', () => {
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    expect(screen.getByRole('button', { name: 'Add Project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search sessions' })).toBeInTheDocument()
    expect(screen.getByText(project1.name)).toBeInTheDocument()
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
  })

  it('opens the source dialog, then adds the selected project directory', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [], sessions: [] })
    render(<ProjectSidebar />)

    await user.click(screen.getByRole('button', { name: 'Add Project' }))

    expect(screen.getByRole('dialog', { name: 'Add Project' })).toBeInTheDocument()
    expect(api.addProject).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Choose project directory' }))

    expect(api.addProject).toHaveBeenCalledTimes(1)
  })

  it('keeps the dialog open when directory selection is cancelled and restores focus on Escape', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    const trigger = screen.getByRole('button', { name: 'Add Project' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Choose project directory' }))
    expect(screen.getByRole('dialog', { name: 'Add Project' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('lists only historical projects outside the current list and reopens the chosen record', async () => {
    const user = userEvent.setup()
    const recent = { ...project1, id: 'recent', name: 'Historical project', path: 'C:\\history' }
    const duplicate = { ...project1, id: 'alias', path: 'c:/work/demo-project/' }
    seedStore({ version: 1, projects: [project1], recentProjects: [project1, duplicate, recent], sessions: [] })
    vi.mocked(api.reopenProject).mockResolvedValue(recent)
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Add Project' }))
    await user.click(screen.getByRole('button', { name: 'Recent projects' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText(project1.name)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^Historical project/ }))
    expect(api.reopenProject).toHaveBeenCalledWith('recent')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useAppStore.getState().activeProjectId).toBe('recent')
    expect(useAppStore.getState().appState.recentProjects).not.toContainEqual(recent)
  })

  it('deletes history without reopening it and keeps the dialog open through the empty state', async () => {
    const user = userEvent.setup()
    const recent = { ...project1, id: 'recent', name: 'Historical project', path: 'C:\\history' }
    const other = { ...recent, id: 'other', name: 'Other project' }
    seedStore({ version: 1, projects: [project1], recentProjects: [recent, other], sessions: [stoppedSession] })
    const selected = useAppStore.getState().activeProjectId
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Add Project' }))
    await user.click(screen.getByRole('button', { name: 'Recent projects' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove Historical project from history' }))
    expect(api.removeRecentProject).toHaveBeenCalledWith(recent.id)
    expect(api.reopenProject).not.toHaveBeenCalled()
    expect(api.removeProject).not.toHaveBeenCalled()
    expect(within(dialog).queryByText(recent.name)).not.toBeInTheDocument()
    expect(within(dialog).getByText(other.name)).toBeInTheDocument()
    expect(useAppStore.getState().appState).toEqual({ version: 1, projects: [project1], recentProjects: [other], sessions: [stoppedSession] })
    expect(useAppStore.getState().activeProjectId).toBe(selected)
    const remove = within(dialog).getByRole('button', { name: 'Remove Other project from history' })
    remove.focus()
    await user.keyboard('{Enter}')
    expect(within(dialog).getByText('No recent projects outside your project list.')).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
  })

  it('locks the dialog while deleting and retains history with a retryable error when saving fails', async () => {
    const user = userEvent.setup()
    const recent = { ...project1, id: 'recent', name: 'Historical project' }
    seedStore({ version: 1, projects: [], recentProjects: [recent], sessions: [] })
    let reject!: (reason: Error) => void
    vi.mocked(api.removeRecentProject).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Add Project' }))
    await user.click(screen.getByRole('button', { name: 'Recent projects' }))
    const dialog = screen.getByRole('dialog')
    const remove = within(dialog).getByRole('button', { name: 'Remove Historical project from history' })
    await user.click(remove)
    expect(within(dialog).getByRole('status')).toHaveTextContent('Removing from history...')
    for (const button of within(dialog).getAllByRole('button')) expect(button).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()
    await act(async () => reject(new Error('disk full')))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not remove project from history: disk full')
    expect(within(dialog).getByText(recent.name)).toBeInTheDocument()
    expect(useAppStore.getState().appState.recentProjects).toEqual([recent])
    await user.click(remove)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).getByText('No recent projects outside your project list.')).toBeInTheDocument()
  })

  it('shows an empty history and keeps a missing-project error inside the dialog', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Add Project' }))
    await user.click(screen.getByRole('button', { name: 'Recent projects' }))
    expect(screen.getByText('No recent projects outside your project list.')).toBeInTheDocument()
    act(() => useAppStore.setState({ appState: { version: 1, projects: [], recentProjects: [project1], sessions: [] } }))
    vi.mocked(api.reopenProject).mockRejectedValue(new Error('Project folder is missing'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^demo-project/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Project folder is missing')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('requires a repository URL and chosen directory, previews the destination, and blocks duplicate cloning', async () => {
    const user = userEvent.setup()
    let resolveClone!: (project: ProjectRecord) => void
    vi.mocked(api.cloneProject).mockImplementation(() => new Promise((resolve) => { resolveClone = resolve }))
    vi.mocked(api.selectCloneDirectory).mockResolvedValue('C:\\Projects')
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Add Project' }))
    await user.click(screen.getByRole('button', { name: 'Clone Git repository' }))
    const submit = screen.getByRole('button', { name: 'Clone and open' })
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText('Git repository URL'), 'git@github.com:team/repo.git')
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Browse...' }))
    expect(screen.getByLabelText('Target directory')).toHaveValue('C:\\Projects')
    expect(screen.getByText('Save to: C:\\Projects\\repo')).toBeInTheDocument()
    await user.dblClick(submit)
    expect(api.cloneProject).toHaveBeenCalledTimes(1)
    expect(api.cloneProject).toHaveBeenCalledWith({ repositoryUrl: 'git@github.com:team/repo.git', targetDirectory: 'C:\\Projects' })
    expect(screen.getByRole('status')).toHaveTextContent('Cloning repository')
    expect(submit).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => resolveClone(project1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useAppStore.getState().activeProjectId).toBe(project1.id)
  })

  it('retains clone form values on failure and preserves a chosen directory when browsing is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(api.selectCloneDirectory).mockResolvedValueOnce('C:\\Projects').mockResolvedValueOnce(null)
    vi.mocked(api.cloneProject).mockRejectedValue(new Error('Authentication failed'))
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Add Project' }))
    await user.click(screen.getByRole('button', { name: 'Clone Git repository' }))
    await user.type(screen.getByLabelText('Git repository URL'), 'https://example.com/repo.git')
    await user.click(screen.getByRole('button', { name: 'Browse...' }))
    await user.click(screen.getByRole('button', { name: 'Browse...' }))
    expect(screen.getByLabelText('Target directory')).toHaveValue('C:\\Projects')
    await user.click(screen.getByRole('button', { name: 'Clone and open' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Authentication failed')
    expect(screen.getByLabelText('Git repository URL')).toHaveValue('https://example.com/repo.git')
    expect(screen.getByRole('button', { name: 'Clone and open' })).toBeEnabled()
  })

  it('places Add Project before search and docks Settings in the sidebar footer', () => {
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const addButton = screen.getByRole('button', { name: 'Add Project' })
    expect(addButton).toHaveClass('add-project-button')
    expect(addButton.closest('.project-sidebar-header')).not.toBeNull()
    const search = screen.getByRole('button', { name: 'Search sessions' })
    expect(addButton.nextElementSibling).toBe(search.parentElement)
    expect(search.parentElement?.nextElementSibling).toBe(screen.getByRole('button', { name: 'Filter sessions' }).parentElement)
    expect(screen.getByRole('button', { name: 'Settings' }).closest('.project-sidebar-footer')).not.toBeNull()
  })

  it('filters session rows to those matching the search query', async () => {
    const user = userEvent.setup()
    const otherSession: SessionRecord = { ...stoppedSession, id: 'session-other', title: 'Investigate crash' }
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession, otherSession] })
    render(<ProjectSidebar />)

    await user.type(await openSearch(user), 'crash')

    expect(screen.getByText(otherSession.title)).toBeInTheDocument()
    expect(screen.queryByText(stoppedSession.title)).not.toBeInTheDocument()
  })

  it('collapses search into an icon, retains live results on dismissal, and clears from the popup', async () => {
    const user = userEvent.setup()
    const otherSession = { ...stoppedSession, id: 'other', title: 'Investigate crash' }
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession, otherSession] })
    render(<ProjectSidebar />)
    const trigger = screen.getByRole('button', { name: 'Search sessions' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    const search = await openSearch(user)
    expect(search).toHaveFocus()
    await user.type(search, 'crash')
    expect(screen.queryByText(stoppedSession.title)).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('data-active', 'true')
    expect(trigger).toHaveAttribute('title', 'Search sessions: crash')
    expect(await openSearch(user)).toHaveValue('crash')
    await user.keyboard('{Enter}')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    await openSearch(user)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('searchbox')).toHaveFocus()
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(trigger).not.toHaveAttribute('data-active')
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close search' }))
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('dismisses search for other controls without stealing focus and translates the popup', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await openSearch(user)
    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Session status' })).toHaveFocus()
    await openSearch(user)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.tab()
    await user.tab()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter sessions' })).toHaveFocus()
    act(() => useAppStore.getState().setLocale('zh-CN'))
    await user.click(screen.getByRole('button', { name: '搜索会话' }))
    expect(screen.getByRole('searchbox', { name: '搜索会话' })).toHaveFocus()
    expect(screen.getByRole('button', { name: '关闭搜索' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument()
  })

  describe('bulk project folding', () => {
    const secondProject = { ...project1, id: 'project-2', name: 'second-project' }
    const emptyProject = { ...project1, id: 'project-empty', name: 'empty-project' }
    const setup = () => {
      seedStore({ version: 1, projects: [project1, secondProject, emptyProject], sessions: [
        runningWorktreeSession, { ...stoppedSession, projectId: secondProject.id }
      ] })
      return render(<ProjectSidebar />)
    }
    const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

    it('uses one button after the filter to collapse mixed projects and expand them all, including empty projects', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(row(project1.name))
      const toggle = screen.getByRole('button', { name: 'Collapse all projects' })
      expect(screen.getByRole('button', { name: 'Filter sessions' }).parentElement?.nextElementSibling).toBe(toggle)
      const collapseIcon = toggle.querySelector('svg')!.innerHTML
      await user.click(toggle)
      for (const project of [project1, secondProject, emptyProject]) expect(row(project.name)).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveAccessibleName('Expand all projects')
      expect(toggle).toHaveAttribute('title', 'Expand all projects')
      expect(toggle.querySelector('svg')!.innerHTML).not.toBe(collapseIcon)
      expect(useAppStore.getState().collapsedProjectIds).toHaveLength(3)
      await user.keyboard('{Enter}')
      for (const project of [project1, secondProject, emptyProject]) expect(row(project.name)).toHaveAttribute('aria-expanded', 'true')
      expect(toggle).toHaveAccessibleName('Collapse all projects')
      expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
      expect(useAppStore.getState().collapsedProjectIds).toEqual([])
    })

    it.each(['search', 'status', 'combined'])('folds only %s results and restores saved project folds when cleared', async (mode) => {
      const user = userEvent.setup()
      setup()
      await user.click(row(secondProject.name))
      act(() => useAppStore.setState({ activeProjectId: project1.id, activeSessionId: runningWorktreeSession.id }))
      if (mode !== 'search') {
        await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
        await user.selectOptions(screen.getByRole('combobox', { name: 'Session status' }), 'running')
        await user.click(screen.getByRole('button', { name: 'Apply' }))
      }
      if (mode !== 'status') await user.type(await openSearch(user), 'login')
      expect(screen.getByText(runningWorktreeSession.title)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Collapse results' }))
      expect(row(project1.name)).toHaveAttribute('aria-expanded', 'false')
      expect(row(secondProject.name)).toHaveAttribute('aria-expanded', 'false')
      expect(row(emptyProject.name)).toHaveAttribute('aria-expanded', 'true')
      expect(screen.queryByText(runningWorktreeSession.title)).not.toBeInTheDocument()
      expect(screen.queryByText('No matching sessions')).not.toBeInTheDocument()
      expect(useAppStore.getState().collapsedProjectIds).toEqual([secondProject.id])
      expect(useAppStore.getState().activeSessionId).toBe(runningWorktreeSession.id)
      await user.click(screen.getByRole('button', { name: 'Expand results' }))
      expect(screen.getByText(runningWorktreeSession.title)).toBeInTheDocument()
      expect(row(secondProject.name)).toHaveAttribute('aria-expanded', 'false')
      await user.click(row(project1.name))
      expect(screen.getByRole('button', { name: 'Expand results' })).toBeEnabled()
      await user.type(await openSearch(user), 'no-match')
      expect(screen.getByRole('button', { name: 'Expand results' })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(row(project1.name)).toHaveAttribute('aria-expanded', 'true')
      expect(row(secondProject.name)).toHaveAttribute('aria-expanded', 'false')
    })

    it('reveals new results after changing criteria and updates the toggle for live matches', async () => {
      const user = userEvent.setup()
      setup()
      await user.type(await openSearch(user), 'login')
      await user.click(screen.getByRole('button', { name: 'Collapse results' }))
      await user.clear(await openSearch(user))
      await user.type(await openSearch(user), 'PowerShell')
      expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Collapse results' }))
      act(() => useAppStore.setState({ appState: { ...useAppStore.getState().appState, sessions: [
        { ...runningWorktreeSession, title: 'PowerShell debugging' }, { ...stoppedSession, projectId: secondProject.id }
      ] } }))
      expect(screen.getByRole('button', { name: 'Collapse results' })).toBeEnabled()
      expect(screen.getByText('PowerShell debugging')).toBeInTheDocument()
      expect(screen.queryByText(stoppedSession.title)).not.toBeInTheDocument()
    })

    it('disables the empty-project-list toggle and translates both states', async () => {
      const user = userEvent.setup()
      render(<ProjectSidebar />)
      expect(screen.getByRole('button', { name: 'Expand all projects' })).toBeDisabled()
      act(() => {
        seedStore({ version: 1, projects: [project1], sessions: [runningWorktreeSession] })
        useAppStore.setState({ locale: 'zh-CN' })
      })
      await user.click(screen.getByRole('button', { name: '全部折叠' }))
      expect(screen.getByRole('button', { name: '全部展开' })).toBeEnabled()
      await user.click(screen.getByRole('button', { name: '搜索会话' }))
      await user.type(screen.getByRole('searchbox', { name: '搜索会话' }), 'login')
      await user.click(screen.getByRole('button', { name: '折叠搜索/筛选结果' }))
      expect(screen.getByRole('button', { name: '展开搜索/筛选结果' })).toBeEnabled()
    })
  })

  describe('session status filter', () => {
    const chooseStatus = async (user: ReturnType<typeof userEvent.setup>, status: string) => {
      await user.click(screen.getByRole('button', { name: 'Filter sessions' }))
      await user.selectOptions(screen.getByRole('combobox', { name: 'Session status' }), status)
      await user.click(screen.getByRole('button', { name: 'Apply' }))
    }
    const sessions: SessionRecord[] = [
      { ...runningWorktreeSession, id: 'busy', title: 'Busy agent' },
      { ...runningWorktreeSession, id: 'done', title: 'Done agent' },
      { ...stoppedSession, id: 'shell', title: 'Running shell', status: 'running' },
      ...(['stopped', 'creating', 'missing', 'error'] as const).map((status) => ({
        ...stoppedSession, id: status, title: `${status} session`, status
      }))
    ]

    const setup = () => {
      seedStore({ version: 1, projects: [project1], sessions })
      useAppStore.setState({ idleAgentSessionIds: { done: true, shell: true, stopped: true } })
      return render(<ProjectSidebar />)
    }

    it('defaults to all and filters by the displayed status, including idle agents but not idle shells', async () => {
      const user = userEvent.setup()
      const { container } = setup()
      const filter = screen.getByRole('button', { name: 'Filter sessions' })
      expect(filter).toHaveAttribute('aria-expanded', 'false')
      expect(filter.closest('.session-status-filter')).toHaveAttribute('title', 'Session status: All statuses')
      expect(filter.closest('.session-status-filter')).not.toHaveAttribute('data-active')
      expect(container.querySelectorAll('.session-row')).toHaveLength(7)

      for (const [status, titles] of [
        ['running', ['Busy agent', 'Running shell']],
        ['done', ['Done agent']],
        ['stopped', ['stopped session']],
        ['creating', ['creating session']],
        ['missing', ['missing session']],
        ['error', ['error session']]
      ] as const) {
        await chooseStatus(user, status)
        expect(filter.closest('.session-status-filter')).toHaveAttribute('data-active', 'true')
        expect(Array.from(container.querySelectorAll('.session-title'), (node) => node.textContent)).toEqual(titles)
      }

      await chooseStatus(user, 'all')
      expect(filter.closest('.session-status-filter')).not.toHaveAttribute('data-active')
      expect(container.querySelectorAll('.session-row')).toHaveLength(7)
    })

    it('combines status with title search and clears both from the empty state', async () => {
      const user = userEvent.setup()
      setup()
      const filter = screen.getByRole('button', { name: 'Filter sessions' })
      await chooseStatus(user, 'running')
      await user.type(await openSearch(user), '  SHELL ')
      expect(screen.getByText('Running shell')).toBeInTheDocument()
      expect(screen.queryByText('Busy agent')).not.toBeInTheDocument()

      await chooseStatus(user, 'done')
      expect(screen.getByRole('status')).toHaveTextContent('No matching sessions')
      expect(screen.getByRole('button', { name: projectOptionsName(project1.name) })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(filter).toHaveAttribute('title', 'Session status: All statuses')
      expect(useAppStore.getState().searchQuery).toBe('')
      expect(screen.getByRole('button', { name: 'Search sessions' })).toHaveFocus()
      expect(screen.getByText('Done agent')).toBeInTheDocument()
      expect(screen.queryByText('No matching sessions')).not.toBeInTheDocument()
    })

    it('updates matches on idle and lifecycle events without changing the active session', async () => {
      const user = userEvent.setup()
      setup()
      act(() => useAppStore.setState({ activeProjectId: project1.id, activeSessionId: 'busy' }))
      await chooseStatus(user, 'done')
      expect(screen.queryByText('Busy agent')).not.toBeInTheDocument()
      act(() => useAppStore.setState({ idleAgentSessionIds: { busy: true } }))
      expect(screen.getByText('Busy agent')).toBeInTheDocument()
      expect(screen.queryByText('Done agent')).not.toBeInTheDocument()
      act(() => useAppStore.setState({
        appState: { version: 1, projects: [project1], sessions: sessions.map((session) =>
          session.id === 'busy' ? { ...session, status: 'stopped' } : session) }
      }))
      expect(screen.queryByText('Busy agent')).not.toBeInTheDocument()
      expect(useAppStore.getState().activeSessionId).toBe('busy')
      expect(api.restoreSession).not.toHaveBeenCalled()
    })

    it('reveals matches across collapsed projects and restores folds after clearing', async () => {
      const user = userEvent.setup()
      const secondProject = { ...project1, id: 'project-2', name: 'second-project' }
      seedStore({ version: 1, projects: [project1, secondProject], sessions: [
        runningWorktreeSession, { ...stoppedSession, projectId: secondProject.id }
      ] })
      useAppStore.setState({ collapsedProjectIds: [project1.id, secondProject.id] })
      const { container } = render(<ProjectSidebar />)
      await chooseStatus(user, 'stopped')
      expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
      expect(screen.queryByText(runningWorktreeSession.title)).not.toBeInTheDocument()
      for (const row of container.querySelectorAll('[data-project-row]')) expect(row).toHaveAttribute('draggable', 'false')
      await chooseStatus(user, 'running')
      expect(screen.getByText(runningWorktreeSession.title)).toBeInTheDocument()
      await chooseStatus(user, 'all')
      expect(container.querySelectorAll('.session-row')).toHaveLength(0)
      expect(useAppStore.getState().collapsedProjectIds).toEqual([project1.id, secondProject.id])
      expect(api.saveWorkspace).not.toHaveBeenCalled()
    })

    it('translates the filter and empty state into Chinese', async () => {
      const user = userEvent.setup()
      seedStore({ version: 1, projects: [project1], sessions: [] })
      useAppStore.setState({ locale: 'zh-CN' })
      render(<ProjectSidebar />)
      await user.click(screen.getByRole('button', { name: '筛选会话' }))
      const filter = screen.getByRole('combobox', { name: '会话状态' })
      expect(within(filter).getAllByRole('option').map((option) => option.textContent)).toEqual([
        '全部状态', '运行中', '已完成', '已停止', '启动中…', '路径不存在', '错误'
      ])
      await user.selectOptions(filter, 'done')
      await user.click(screen.getByRole('button', { name: '应用' }))
      expect(screen.getByRole('status')).toHaveTextContent('没有符合条件的会话')
      expect(screen.getByRole('button', { name: '清除筛选' })).toBeInTheDocument()
    })

    it('edits filters in a form, applies explicitly, and discards cancelled drafts', async () => {
      const user = userEvent.setup()
      const { container } = setup()
      const trigger = screen.getByRole('button', { name: 'Filter sessions' })
      await user.click(trigger)
      const dialog = screen.getByRole('dialog', { name: 'Filter sessions' })
      const select = within(dialog).getByRole('combobox', { name: 'Session status' })
      expect(select).toHaveFocus()
      await user.selectOptions(select, 'done')
      expect(container.querySelectorAll('.session-row')).toHaveLength(7)
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
      await user.click(trigger)
      await user.tab({ shift: true })
      await user.tab({ shift: true })
      expect(trigger).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
      await chooseStatus(user, 'done')
      expect(container.querySelectorAll('.session-row')).toHaveLength(1)
      expect(trigger).toHaveFocus()
      await user.click(trigger)
      await user.click(screen.getByRole('button', { name: 'Reset' }))
      expect(screen.getByRole('combobox', { name: 'Session status' })).toHaveValue('all')
      expect(container.querySelectorAll('.session-row')).toHaveLength(1)
      await user.click(await openSearch(user))
      expect(screen.queryByRole('dialog', { name: 'Filter sessions' })).not.toBeInTheDocument()
      await user.click(trigger)
      expect(screen.getByRole('combobox', { name: 'Session status' })).toHaveValue('done')
      await user.click(screen.getByRole('button', { name: 'Reset' }))
      await user.click(screen.getByRole('button', { name: 'Apply' }))
      expect(container.querySelectorAll('.session-row')).toHaveLength(7)
    })
  })

  it('collapses the project actions into one labelled options menu', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New session' })).not.toBeInTheDocument()

    const menu = await openProjectOptions(user)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      'New session',
      'Open project in VS Code',
      'Open project folder',
      'Remove from list'
    ])

    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('swaps the options glyph for a close glyph while the menu is open', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    const glyph = () => trigger.querySelector('img')
    expect(glyph()).toHaveAttribute('src', optionsIconUrl)

    await user.click(trigger)
    expect(glyph()).toHaveAttribute('src', closeIconUrl)

    await user.click(trigger)
    expect(glyph()).toHaveAttribute('src', optionsIconUrl)
  })

  it('offers Open Git repository with the GitHub mark and opens it through the main process', async () => {
    const user = userEvent.setup()
    const github: ProjectRecord = { ...project1, repoRemote: { host: 'github', webUrl: 'https://github.com/me/app' } }
    seedStore({ version: 1, projects: [github], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      'New session',
      'Open project in VS Code',
      'Open project folder',
      'Open Git repository',
      'Remove from list'
    ])
    const item = within(menu).getByRole('menuitem', { name: 'Open Git repository' })
    expect(item.querySelector('img')).toHaveAttribute('src', githubIconUrl)
    // GitHub's mark is a mono glyph, so it takes the dark-theme inversion like the other mono icons.
    expect(item.querySelector('img')).toHaveClass('icon-mono')

    await user.click(item)

    expect(api.openProjectRepository).toHaveBeenCalledWith(github.id)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each([
    ['gitlab', gitlabIconUrl],
    ['git', gitIconUrl]
  ] as const)('uses the brand-colored %s mark without inversion for that host', async (host, iconUrl) => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [{ ...project1, repoRemote: { host, webUrl: 'https://example.com/me/app' } }], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    const icon = within(menu).getByRole('menuitem', { name: 'Open Git repository' }).querySelector('img')
    expect(icon).toHaveAttribute('src', iconUrl)
    expect(icon).not.toHaveClass('icon-mono')
  })

  it('hides Open Git repository for projects without a browsable remote', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    expect(within(menu).queryByRole('menuitem', { name: 'Open Git repository' })).not.toBeInTheDocument()
  })

  it('asks for confirmation before removing a project and forgets it on confirm', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    const item = within(menu).getByRole('menuitem', { name: 'Remove from list' })
    expect(item.querySelector('img')).toHaveAttribute('src', removeIconUrl)
    await user.click(item)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(api.removeProject).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: 'Remove project' })
    expect(dialog).toHaveTextContent(`Remove "${project1.name}" from the list? Nothing on disk is deleted.`)

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(api.removeProject).toHaveBeenCalledWith(project1.id)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('mentions how many sessions go with the project when it still has some', async () => {
    const user = userEvent.setup()
    const otherSession: SessionRecord = { ...stoppedSession, id: 'session-other', title: 'Investigate crash' }
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession, otherSession] })
    render(<ProjectSidebar />)

    await user.click(within(await openProjectOptions(user)).getByRole('menuitem', { name: 'Remove from list' }))

    expect(screen.getByRole('alertdialog', { name: 'Remove project' })).toHaveTextContent(
      `Remove "${project1.name}" from the list? Its 2 session(s) will be removed too. Nothing on disk is deleted.`
    )
  })

  it('keeps the project when the removal is cancelled', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    await user.click(within(await openProjectOptions(user)).getByRole('menuitem', { name: 'Remove from list' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))

    expect(api.removeProject).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText(project1.name)).toBeInTheDocument()
  })

  it('translates the project options trigger and menu items when the locale changes', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    useAppStore.getState().setLocale('zh-CN')
    render(<ProjectSidebar />)

    const menuName = `${project1.name} 的项目选项`
    await user.click(screen.getByRole('button', { name: menuName }))

    const menu = screen.getByRole('menu', { name: menuName })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      '新建会话',
      '在 VS Code 中打开项目',
      '打开项目文件夹',
      '从列表中移除'
    ])
  })

  it('places the options menu below its row when the scrollport has room', async () => {
    const user = userEvent.setup()
    controlProjectOptionsGeometry({ rowTop: 80, rowBottom: 112, scrollportTop: 40, scrollportBottom: 300, menuHeight: 100 })
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)

    expect(menu).toHaveAttribute('data-placement', 'below')
    expect(menu).toHaveAttribute('data-clamped', 'false')
  })

  it('places the options menu above a lower row when below space is insufficient', async () => {
    const user = userEvent.setup()
    controlProjectOptionsGeometry({ rowTop: 240, rowBottom: 272, scrollportTop: 40, scrollportBottom: 300, menuHeight: 100 })
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)

    expect(menu).toHaveAttribute('data-placement', 'above')
    expect(menu).toHaveAttribute('data-clamped', 'false')
  })

  it('clamps the menu to the roomier side and keeps keyboard navigation available when neither side fits', async () => {
    const user = userEvent.setup()
    controlProjectOptionsGeometry({ rowTop: 80, rowBottom: 112, scrollportTop: 40, scrollportBottom: 160, menuHeight: 100 })
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    const newSession = within(menu).getByRole('menuitem', { name: 'New session' })
    const vscode = within(menu).getByRole('menuitem', { name: 'Open project in VS Code' })

    expect(menu).toHaveAttribute('data-placement', 'below')
    expect(menu).toHaveAttribute('data-clamped', 'true')
    expect(menu.style.getPropertyValue('--project-options-menu-max-height')).toBe('42px')
    await user.keyboard('{ArrowDown}')
    expect(vscode).toHaveFocus()
    expect(newSession).not.toHaveFocus()
  })

  it('clamps the menu above its row when above has more room than below', async () => {
    const user = userEvent.setup()
    controlProjectOptionsGeometry({ rowTop: 100, rowBottom: 132, scrollportTop: 40, scrollportBottom: 160, menuHeight: 100 })
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)

    expect(menu).toHaveAttribute('data-placement', 'above')
    expect(menu).toHaveAttribute('data-clamped', 'true')
    expect(menu.style.getPropertyValue('--project-options-menu-max-height')).toBe('54px')
  })

  it('recomputes placement while open after scroll and resize geometry changes', async () => {
    const user = userEvent.setup()
    const state = { rowTop: 80, rowBottom: 112, scrollportTop: 40, scrollportBottom: 300, menuHeight: 100 }
    controlProjectOptionsGeometry(state)
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    const scrollport = document.querySelector('.project-groups') as HTMLElement
    expect(menu).toHaveAttribute('data-placement', 'below')

    state.rowTop = 240
    state.rowBottom = 272
    fireEvent.scroll(scrollport)
    expect(menu).toHaveAttribute('data-placement', 'above')

    state.rowTop = 80
    state.rowBottom = 112
    fireEvent(window, new Event('resize'))
    expect(menu).toHaveAttribute('data-placement', 'below')
  })

  it('keeps a border-box menu clamped across consecutive scroll and resize measurements', async () => {
    const user = userEvent.setup()
    controlProjectOptionsGeometry({
      rowTop: 80,
      rowBottom: 112,
      scrollportTop: 40,
      scrollportBottom: 158,
      menuHeight: 40,
      menuRectHeight: 42,
      clampedMenuRectHeight: 40,
      menuBorderTop: 1,
      menuBorderBottom: 1
    })
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    const scrollport = document.querySelector('.project-groups') as HTMLElement
    expect(menu).toHaveAttribute('data-clamped', 'true')
    expect(menu.style.getPropertyValue('--project-options-menu-max-height')).toBe('40px')

    fireEvent.scroll(scrollport)
    expect(menu).toHaveAttribute('data-clamped', 'true')
    expect(menu.style.getPropertyValue('--project-options-menu-max-height')).toBe('40px')
    fireEvent(window, new Event('resize'))

    expect(menu).toHaveAttribute('data-clamped', 'true')
    expect(menu.style.getPropertyValue('--project-options-menu-max-height')).toBe('40px')
  })

  it.each([
    ['above', 0, 32],
    ['below', 320, 352]
  ])('closes the menu without restoring focus when its row scrolls fully %s the scrollport', async (_direction, rowTop, rowBottom) => {
    const user = userEvent.setup()
    const state = { rowTop: 80, rowBottom: 112, scrollportTop: 40, scrollportBottom: 300, menuHeight: 100 }
    controlProjectOptionsGeometry(state)
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    const menu = await openProjectOptions(user)
    const scrollport = document.querySelector('.project-groups') as HTMLElement
    expect(menu).toBeInTheDocument()

    state.rowTop = rowTop
    state.rowBottom = rowBottom
    fireEvent.scroll(scrollport)

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).not.toHaveFocus()
  })

  it('closes the menu when a laid-out scrollport collapses around its trigger', async () => {
    const user = userEvent.setup()
    const state = {
      rowTop: 20,
      rowBottom: 52,
      triggerTop: 32,
      triggerBottom: 48,
      scrollportTop: 40,
      scrollportBottom: 300,
      menuHeight: 100
    }
    controlProjectOptionsGeometry(state)
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    await openProjectOptions(user)
    const scrollport = document.querySelector('.project-groups') as HTMLElement
    state.scrollportBottom = state.scrollportTop
    fireEvent.scroll(scrollport)

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it.each([
    ['above', 20, 52, 8, 32],
    ['below', 288, 320, 308, 332]
  ])(
    'closes the menu when its trigger scrolls fully %s the scrollport while its row still intersects',
    async (_direction, rowTop, rowBottom, triggerTop, triggerBottom) => {
      const user = userEvent.setup()
      const state = {
        rowTop: 80,
        rowBottom: 112,
        triggerTop: 84,
        triggerBottom: 108,
        scrollportTop: 40,
        scrollportBottom: 300,
        menuHeight: 100
      }
      controlProjectOptionsGeometry(state)
      seedStore({ version: 1, projects: [project1], sessions: [] })
      render(<ProjectSidebar />)

      const menu = await openProjectOptions(user)
      const scrollport = document.querySelector('.project-groups') as HTMLElement
      expect(menu).toBeInTheDocument()

      Object.assign(state, { rowTop, rowBottom, triggerTop, triggerBottom })
      fireEvent.scroll(scrollport)

      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    }
  )

  it('keeps the menu open and places it when its trigger remains partially visible in the scrollport', async () => {
    const user = userEvent.setup()
    const state = {
      rowTop: 80,
      rowBottom: 112,
      triggerTop: 84,
      triggerBottom: 108,
      scrollportTop: 40,
      scrollportBottom: 300,
      menuHeight: 100
    }
    controlProjectOptionsGeometry(state)
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    const scrollport = document.querySelector('.project-groups') as HTMLElement
    state.rowTop = 20
    state.rowBottom = 52
    state.triggerTop = 28
    state.triggerBottom = 52
    fireEvent.scroll(scrollport)

    expect(menu).toBeInTheDocument()
    expect(menu).toHaveAttribute('data-placement', 'below')
  })

  it('keeps one scroll and resize listener while open, then removes them on close and unmount', async () => {
    const user = userEvent.setup()
    controlProjectOptionsGeometry({ rowTop: 80, rowBottom: 112, scrollportTop: 40, scrollportBottom: 300, menuHeight: 100 })
    seedStore({ version: 1, projects: [project1], sessions: [] })
    const view = render(<ProjectSidebar />)
    const scrollport = document.querySelector('.project-groups') as HTMLElement
    const addScroll = vi.spyOn(scrollport, 'addEventListener')
    const removeScroll = vi.spyOn(scrollport, 'removeEventListener')
    const addResize = vi.spyOn(window, 'addEventListener')
    const removeResize = vi.spyOn(window, 'removeEventListener')

    await openProjectOptions(user)
    expect(addScroll).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(addResize).toHaveBeenCalledWith('resize', expect.any(Function))
    const scrollListenerCount = addScroll.mock.calls.filter(([type]) => type === 'scroll').length
    const resizeListenerCount = addResize.mock.calls.filter(([type]) => type === 'resize').length

    fireEvent.scroll(scrollport)
    fireEvent(window, new Event('resize'))
    expect(addScroll.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(scrollListenerCount)
    expect(addResize.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(resizeListenerCount)

    await user.keyboard('{Escape}')
    expect(removeScroll).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(removeResize).toHaveBeenCalledWith('resize', expect.any(Function))

    await openProjectOptions(user)
    view.unmount()
    expect(removeScroll.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(2)
    expect(removeResize.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(2)
  })

  it('replaces scroll and resize listeners when the open menu switches projects', async () => {
    const user = userEvent.setup()
    const project2: ProjectRecord = { ...project1, id: 'project-2', name: 'second-project', path: 'C:\\work\\second' }
    controlProjectOptionsGeometry({ rowTop: 80, rowBottom: 112, scrollportTop: 40, scrollportBottom: 300, menuHeight: 100 })
    seedStore({ version: 1, projects: [project1, project2], sessions: [] })
    const view = render(<ProjectSidebar />)
    const scrollport = document.querySelector('.project-groups') as HTMLElement
    const addScroll = vi.spyOn(scrollport, 'addEventListener')
    const removeScroll = vi.spyOn(scrollport, 'removeEventListener')
    const addResize = vi.spyOn(window, 'addEventListener')
    const removeResize = vi.spyOn(window, 'removeEventListener')

    await openProjectOptions(user, project1.name)
    await openProjectOptions(user, project2.name)

    expect(addScroll.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(2)
    expect(removeScroll.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1)
    expect(addResize.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(2)
    expect(removeResize.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1)

    view.unmount()
    expect(removeScroll.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(2)
    expect(removeResize.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(2)
  })

  it('focuses the first enabled menu item and supports wrapping keyboard navigation', async () => {
    const user = userEvent.setup()
    seedStore(
      { version: 1, projects: [project1], sessions: [] },
      { ...agentCapabilities(), vscode: { available: false, detail: 'Install VS Code or the code command.' } }
    )
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    const newSession = within(menu).getByRole('menuitem', { name: 'New session' })
    const folder = within(menu).getByRole('menuitem', { name: 'Open project folder' })
    const remove = within(menu).getByRole('menuitem', { name: 'Remove from list' })
    expect(newSession).toHaveFocus()

    // The disabled VS Code entry is skipped; the enabled ring is New session → folder → remove.
    await user.keyboard('{ArrowDown}')
    expect(folder).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(remove).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(newSession).toHaveFocus()
    await user.keyboard('{End}')
    expect(remove).toHaveFocus()
    await user.keyboard('{Home}')
    expect(newSession).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(remove).toHaveFocus()
  })

  it('closes on Escape and restores focus to the options trigger', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    await openProjectOptions(user)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on outside click and Tab without stealing the destination focus', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    await openProjectOptions(user)
    const search = await openSearch(user)
    await user.click(search)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(search).toHaveFocus()

    await openProjectOptions(user)
    await user.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus()

    await openProjectOptions(user)
    await user.tab({ shift: true })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: projectOptionsName(project1.name) })).toHaveFocus()
  })

  it('keeps only one project menu open and clears stale state when a project disappears', async () => {
    const user = userEvent.setup()
    const project2: ProjectRecord = {
      id: 'project-2',
      name: 'second-project',
      path: 'C:\\work\\second',
      createdAt: '2026-08-21T00:00:00.000Z'
    }
    const state = { version: 1 as const, projects: [project1, project2], sessions: [] }
    seedStore(state)
    render(<ProjectSidebar />)

    await openProjectOptions(user, project1.name)
    await openProjectOptions(user, project2.name)
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.getByRole('menu', { name: projectOptionsName(project2.name) })).toBeInTheDocument()

    act(() => useAppStore.setState({ appState: { ...state, projects: [project1] } }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    act(() => useAppStore.setState({ appState: state }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('returns focus to the options trigger after a folder action and after closing the launcher', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    let menu = await openProjectOptions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Open project folder' }))
    expect(trigger).toHaveFocus()

    menu = await openProjectOptions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'New session' }))
    expect(screen.getByLabelText('Create session')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close launcher' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('dismisses an open launcher when the options menu is reopened', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'New session' }))
    expect(screen.getByLabelText('Create session')).toBeInTheDocument()

    // Both popovers anchor to the same row edge, so they must never be open together.
    await openProjectOptions(user)
    expect(screen.queryByLabelText('Create session')).not.toBeInTheDocument()
  })

  it('keeps the launcher open for inside clicks and dismisses it on outside blank space', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    await user.click(within(await openProjectOptions(user)).getByRole('menuitem', { name: 'New session' }))
    const launcher = screen.getByLabelText('Create session')
    await user.click(within(launcher).getByText('New session'))
    expect(launcher).toBeInTheDocument()

    await user.click(document.body)
    expect(screen.queryByLabelText('Create session')).not.toBeInTheDocument()
    expect(useAppStore.getState().launcherOpen).toBe(false)
    expect(api.createSession).not.toHaveBeenCalled()
  })

  it('dismisses the launcher without taking focus from the clicked search input', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    await user.click(within(await openProjectOptions(user)).getByRole('menuitem', { name: 'New session' }))
    const search = await openSearch(user)
    await user.click(search)

    expect(screen.queryByLabelText('Create session')).not.toBeInTheDocument()
    expect(search).toHaveFocus()
  })

  it('moves keyboard focus into the launcher and restores it after launcher Escape', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    await openProjectOptions(user)
    await user.keyboard('{Enter}')

    expect(screen.getByLabelText('Create session')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PowerShell' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByLabelText('Create session')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('refocuses the newly selected project launcher when New session is reopened', async () => {
    const user = userEvent.setup()
    const project2: ProjectRecord = {
      id: 'project-2',
      name: 'second-project',
      path: 'C:\\work\\second',
      createdAt: '2026-08-21T00:00:00.000Z'
    }
    seedStore({ version: 1, projects: [project1, project2], sessions: [] })
    render(<ProjectSidebar />)

    await openProjectOptions(user, project1.name)
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'PowerShell' })).toHaveFocus()

    await openProjectOptions(user, project1.name)
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'PowerShell' })).toHaveFocus()

    const project2Trigger = screen.getByRole('button', { name: projectOptionsName(project2.name) })
    await openProjectOptions(user, project2.name)
    await user.keyboard('{Enter}')

    expect(useAppStore.getState().activeProjectId).toBe(project2.id)
    expect(screen.getByRole('button', { name: 'PowerShell' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByLabelText('Create session')).not.toBeInTheDocument())
    expect(project2Trigger).toHaveFocus()
  })

  it('renders the supplied options SVG as a decorative trigger icon', () => {
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    const icon = trigger.querySelector('img.icon-options') as HTMLImageElement | null
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('src')
    expect(icon).toHaveAttribute('alt', '')
  })

  it('does not put the project-row label or session-row label inside a role="button" ancestor', () => {
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    const projectLabel = screen.getByText(project1.name).closest('button') as HTMLElement
    expect(projectLabel.closest('[role="button"]')).toBeNull()

    const sessionLabel = screen.getByText(stoppedSession.title).closest('button') as HTMLElement
    expect(sessionLabel.closest('[role="button"]')).toBeNull()
  })

  it('toggles the project with Enter and Space without changing the active project', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const label = screen.getByText(project1.name).closest('button') as HTMLButtonElement
    expect(label).toHaveAttribute('aria-expanded', 'true')
    label.focus()
    await user.keyboard('{Enter}')

    expect(label).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard(' ')
    expect(label).toHaveAttribute('aria-expanded', 'true')
    expect(useAppStore.getState().activeProjectId).toBeNull()
  })

  it('restores a stopped session when its row label is activated with the keyboard', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    const restarted: SessionRecord = { ...stoppedSession, status: 'running' }
    api.restoreSession = vi.fn(async () => restarted)
    window.codeflai = api
    render(<ProjectSidebar />)

    const label = screen.getByText(stoppedSession.title).closest('button') as HTMLButtonElement
    label.focus()
    await user.keyboard('{Enter}')

    expect(api.restoreSession).toHaveBeenCalledWith(stoppedSession.id)
  })

  it('does not toggle the project row or restore a session when opening VS Code', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    await openProjectOptions(user)
    await user.click(screen.getByRole('menuitem', { name: 'Open project in VS Code' }))

    expect(api.openProjectInVSCode).toHaveBeenCalledWith('project-1')
    expect(api.restoreSession).not.toHaveBeenCalled()
    expect(useAppStore.getState().activeProjectId).toBeNull()
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('does not toggle the project row or restore a session when opening the folder', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    await openProjectOptions(user)
    await user.click(screen.getByRole('menuitem', { name: 'Open project folder' }))

    expect(api.openProjectFolder).toHaveBeenCalledWith('project-1')
    expect(api.restoreSession).not.toHaveBeenCalled()
    expect(useAppStore.getState().activeProjectId).toBeNull()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not start a project drag from the options trigger, menu, or launcher', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const transfer = { setData: vi.fn(), getData: vi.fn(() => ''), effectAllowed: '', dropEffect: '' }
    const row = screen.getByText(project1.name).closest('[data-project-row]') as HTMLElement
    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    fireEvent.pointerDown(trigger)
    fireEvent.dragStart(row, { dataTransfer: transfer })

    const menu = await openProjectOptions(user)
    const newSession = within(menu).getByRole('menuitem', { name: 'New session' })
    fireEvent.pointerDown(newSession)
    fireEvent.dragStart(row, { dataTransfer: transfer })
    fireEvent.pointerUp(newSession)

    await user.click(newSession)
    const launcherAction = screen.getByRole('button', { name: 'PowerShell' })
    fireEvent.pointerDown(launcherAction)
    fireEvent.dragStart(row, { dataTransfer: transfer })

    expect(transfer.setData).not.toHaveBeenCalled()
  })

  it('does not mark any project as current when sessions are selected or project labels are clicked', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [runningWorktreeSession] })
    render(<ProjectSidebar />)

    await user.click(screen.getByText(runningWorktreeSession.title))
    expect(screen.getByText(runningWorktreeSession.title).closest('button')).toHaveAttribute('aria-current', 'true')
    const row = screen.getByText(project1.name).closest('[data-project-row]')
    expect(row).not.toHaveAttribute('aria-current')
    await user.click(screen.getByText(project1.name))

    expect(row).not.toHaveAttribute('aria-current')
    expect(useAppStore.getState().activeSessionId).toBe(runningWorktreeSession.id)
  })

  it('collapses and expands each project independently', async () => {
    const user = userEvent.setup()
    const project2: ProjectRecord = { id: 'project-2', name: 'second-project', path: 'C:\\work\\second', createdAt: '2026-08-21T00:00:00.000Z' }
    const sessionInP2: SessionRecord = { ...stoppedSession, id: 'session-p2', projectId: 'project-2', title: 'P2 session' }
    seedStore({ version: 1, projects: [project1, project2], sessions: [stoppedSession, sessionInP2] })
    render(<ProjectSidebar />)

    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
    expect(screen.getByText('P2 session')).toBeInTheDocument()

    await user.click(screen.getByText(project2.name))
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
    expect(screen.queryByText('P2 session')).not.toBeInTheDocument()

    await user.click(screen.getByText(project1.name))
    expect(screen.queryByText(stoppedSession.title)).not.toBeInTheDocument()
    expect(screen.queryByText('P2 session')).not.toBeInTheDocument()

    await user.click(screen.getByText(project1.name))
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
    expect(screen.queryByText('P2 session')).not.toBeInTheDocument()

    await user.click(screen.getByText(project2.name))
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
    expect(screen.getByText('P2 session')).toBeInTheDocument()
  })

  it('preserves each project collapse state when switching sessions or opening the launcher', async () => {
    const user = userEvent.setup()
    const project2: ProjectRecord = { ...project1, id: 'project-2', name: 'second-project' }
    seedStore({ version: 1, projects: [project1, project2], sessions: [runningWorktreeSession] })
    useAppStore.setState({ activeProjectId: project2.id })
    render(<ProjectSidebar />)

    await user.click(screen.getByText(project2.name))
    await user.click(screen.getByText(runningWorktreeSession.title))
    expect(screen.getByText(project1.name).closest('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(project2.name).closest('button')).toHaveAttribute('aria-expanded', 'false')

    await user.click(within(await openProjectOptions(user, project2.name)).getByRole('menuitem', { name: 'New session' }))
    expect(screen.getByLabelText('Create session')).toBeInTheDocument()
    expect(screen.getByText(project1.name).closest('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(project2.name).closest('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('reveals matching sessions while searching and restores collapse state after clearing search', async () => {
    const user = userEvent.setup()
    const project2: ProjectRecord = { id: 'project-2', name: 'second-project', path: 'C:\\work\\second', createdAt: '2026-08-21T00:00:00.000Z' }
    const sessionInP2: SessionRecord = { ...stoppedSession, id: 'session-p2', projectId: 'project-2', title: 'Special P2 session' }
    seedStore({ version: 1, projects: [project1, project2], sessions: [stoppedSession, sessionInP2] })
    render(<ProjectSidebar />)

    await user.click(screen.getByText(project2.name))
    expect(screen.queryByText('Special P2 session')).not.toBeInTheDocument()
    await user.type(await openSearch(user), 'special')
    expect(screen.getByText('Special P2 session')).toBeInTheDocument()
    expect(screen.getByText(project2.name).closest('button')).toHaveAttribute('aria-expanded', 'true')

    await user.clear(await openSearch(user))
    expect(screen.queryByText('Special P2 session')).not.toBeInTheDocument()
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
    expect(screen.getByText(project2.name).closest('button')).toHaveAttribute('aria-expanded', 'false')
  })

  describe('project drag reordering', () => {
    const project2: ProjectRecord = { ...project1, id: 'project-2', name: 'other-app', path: 'C:\\work\\other-app' }
    const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(() => ''), effectAllowed: '', dropEffect: '' })

    const projectRows = (): HTMLElement[] => Array.from(document.querySelectorAll('.project-row'))

    it('marks project rows draggable and calls reorderProjects with the dropped order', async () => {
      seedStore({ version: 1, projects: [project1, project2], sessions: [] })
      api.reorderProjects = vi.fn(async () => [project2, project1])
      window.codeflai = api
      render(<ProjectSidebar />)

      const [firstRow, secondRow] = projectRows()
      expect(firstRow).toHaveAttribute('draggable', 'true')

      const transfer = dataTransfer()
      fireEvent.dragStart(firstRow!, { dataTransfer: transfer })
      // jsdom rects are all zeros, so clientY 0 is not above the midpoint: position is 'after'.
      fireEvent.dragOver(secondRow!, { dataTransfer: transfer, clientY: 0 })
      expect(secondRow).toHaveAttribute('data-drop', 'after')
      fireEvent.drop(secondRow!, { dataTransfer: transfer })

      await waitFor(() => expect(api.reorderProjects).toHaveBeenCalledWith(['project-2', 'project-1']))
      expect(secondRow).not.toHaveAttribute('data-drop')
    })

    it('does not call reorderProjects when the row is dropped back onto itself', () => {
      seedStore({ version: 1, projects: [project1, project2], sessions: [] })
      render(<ProjectSidebar />)

      const [firstRow] = projectRows()
      const transfer = dataTransfer()
      fireEvent.dragStart(firstRow!, { dataTransfer: transfer })
      fireEvent.dragOver(firstRow!, { dataTransfer: transfer, clientY: 0 })
      fireEvent.drop(firstRow!, { dataTransfer: transfer })

      expect(api.reorderProjects).not.toHaveBeenCalled()
    })

    it('disables dragging while a search filter is active', async () => {
      const user = userEvent.setup()
      seedStore({ version: 1, projects: [project1, project2], sessions: [] })
      render(<ProjectSidebar />)

      await user.type(await openSearch(user), 'x')

      for (const row of projectRows()) {
        expect(row).toHaveAttribute('draggable', 'false')
      }
    })
  })

  it('renders an SVG brand icon per session kind instead of a text glyph', () => {
    const cmdSession: SessionRecord = { ...stoppedSession, id: 'session-cmd', kind: 'cmd' }
    const codexSession: SessionRecord = { ...runningWorktreeSession, id: 'session-codex', kind: 'codex' }
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession, cmdSession, runningWorktreeSession, codexSession] })
    render(<ProjectSidebar />)

    for (const kind of ['powershell', 'cmd', 'claude', 'codex']) {
      const icon = document.querySelector(`.session-kind-icon[data-kind="${kind}"] img`)
      expect(icon).not.toBeNull()
    }
    expect(screen.queryByText('PS')).not.toBeInTheDocument()
    expect(screen.queryByText('CMD')).not.toBeInTheDocument()
    expect(screen.queryByText('CL')).not.toBeInTheDocument()
    expect(screen.queryByText('CX')).not.toBeInTheDocument()
  })

  it('shows worktree name for a worktree session and "Ordinary session" for a fallback session', () => {
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession, runningWorktreeSession] })
    render(<ProjectSidebar />)

    expect(screen.getByText('Ordinary session')).toBeInTheDocument()
    expect(screen.getByText(runningWorktreeSession.worktreeName as string)).toBeInTheDocument()
  })

  it('marks a stopped session with a restore-hinting status dot and calls restoreSession on click', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    const restarted: SessionRecord = { ...stoppedSession, status: 'running' }
    api.restoreSession = vi.fn(async () => restarted)
    window.codeflai = api
    render(<ProjectSidebar />)

    expect(screen.getByRole('img', { name: 'Click to restore' })).toHaveAttribute('data-status', 'stopped')
    await user.click(screen.getByText(stoppedSession.title))

    expect(api.restoreSession).toHaveBeenCalledWith(stoppedSession.id)
  })

  it('marks a running session with a running status dot and only switches to it on click', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [runningWorktreeSession] })
    render(<ProjectSidebar />)

    expect(screen.getByRole('img', { name: 'Running' })).toHaveAttribute('data-status', 'running')
    await user.click(screen.getByText(runningWorktreeSession.title))

    expect(api.restoreSession).not.toHaveBeenCalled()
    expect(useAppStore.getState().activeSessionId).toBe(runningWorktreeSession.id)
  })

  it('shows a done-tinted status dot for a running agent session whose output has gone quiet', () => {
    seedStore({ version: 1, projects: [project1], sessions: [runningWorktreeSession] })
    useAppStore.setState({ idleAgentSessionIds: { [runningWorktreeSession.id]: true } })
    render(<ProjectSidebar />)

    const status = screen.getByRole('img', { name: 'Done' })
    expect(status).toHaveAttribute('data-status', 'done')
    expect(screen.queryByRole('img', { name: 'Running' })).not.toBeInTheDocument()
  })

  it('keeps the running status dot for a quiet shell session even when it is marked idle', () => {
    const runningShell: SessionRecord = { ...stoppedSession, id: 'session-shell', status: 'running' }
    seedStore({ version: 1, projects: [project1], sessions: [runningShell] })
    useAppStore.setState({ idleAgentSessionIds: { [runningShell.id]: true } })
    render(<ProjectSidebar />)

    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Done' })).not.toBeInTheDocument()
  })

  it('offers deletion only in the session menu and opens a confirmation without activating', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [runningWorktreeSession] })
    render(<ProjectSidebar />)

    expect(screen.queryByRole('button', { name: `Delete ${runningWorktreeSession.title}` })).not.toBeInTheDocument()
    await requestSessionDelete(user, runningWorktreeSession.title)

    expect(api.restoreSession).not.toHaveBeenCalled()
    expect(useAppStore.getState().activeSessionId).toBeNull()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('focuses Cancel by default when the delete confirmation opens', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    await requestSessionDelete(user, stoppedSession.title)

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('cancels the delete confirmation on Escape without deleting', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    await requestSessionDelete(user, stoppedSession.title)
    await user.keyboard('{Escape}')

    expect(api.deleteSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
  })

  it('does not delete a session when Enter is pressed immediately after the confirmation opens', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    await requestSessionDelete(user, stoppedSession.title)
    await user.keyboard('{Enter}')

    expect(api.deleteSession).not.toHaveBeenCalled()
  })

  it('never deletes when the confirmation is canceled', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    await requestSessionDelete(user, stoppedSession.title)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(api.deleteSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
  })

  it('shows the dirty-delete message after confirming and keeps the session', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    api.deleteSession = vi.fn(async () => ({ status: 'dirty', changedFiles: 2 }) as DeleteSessionResult)
    window.codeflai = api
    render(<ProjectSidebar />)

    await requestSessionDelete(user, stoppedSession.title)
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Worktree has 2 changed files. Commit or discard them before deleting.')).toBeInTheDocument()
    expect(screen.getByText(stoppedSession.title)).toBeInTheDocument()
  })

  it('keeps an unavailable VS Code menu item disabled without showing an installation warning', async () => {
    const user = userEvent.setup()
    const detail = 'Install VS Code or the code command.'
    seedStore(
      { version: 1, projects: [project1], sessions: [] },
      { ...agentCapabilities(), vscode: { available: false, detail } }
    )
    render(<ProjectSidebar />)

    expect(screen.queryByText(detail)).not.toBeInTheDocument()

    const menu = await openProjectOptions(user)
    const item = within(menu).getByRole('menuitem', { name: 'Open project in VS Code' })
    expect(item).toBeDisabled()
    expect(item).toHaveAttribute('title', detail)
    expect(screen.queryByText(detail)).not.toBeInTheDocument()

    await user.click(item)
    expect(api.openProjectInVSCode).not.toHaveBeenCalled()
    expect(screen.getByRole('menu', { name: projectOptionsName(project1.name) })).toBeInTheDocument()
  })

  it('does not render a visible VS Code hint when the capability is available', () => {
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    expect(screen.queryByText(/install vs code/i)).not.toBeInTheDocument()
  })

  it('renders the bundled VS Code SVG asset inside the menu item', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    const menu = await openProjectOptions(user)
    const item = within(menu).getByRole('menuitem', { name: 'Open project in VS Code' })
    const icon = item.querySelector('img.icon-vscode') as HTMLImageElement | null
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('src')
    expect(icon).toHaveAttribute('alt', '')
  })

  it('gives the session secondary label (worktree name / "Ordinary session") a title attribute for ellipsized text', () => {
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession, runningWorktreeSession] })
    render(<ProjectSidebar />)

    expect(screen.getByText('Ordinary session')).toHaveAttribute('title', 'Ordinary session')
    expect(screen.getByText(runningWorktreeSession.worktreeName as string)).toHaveAttribute('title', runningWorktreeSession.worktreeName)
  })

  it('exposes accessible names for the project and session options buttons', () => {
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    const trigger = screen.getByRole('button', { name: projectOptionsName(project1.name) })
    expect(trigger.getAttribute('aria-label')).toBeTruthy()

    const optionsButton = screen.getByRole('button', { name: `Session options for ${stoppedSession.title}` })
    expect(optionsButton.getAttribute('aria-label')).toBeTruthy()
  })

  it('returns focus to the session options button that opened the confirmation after Cancel', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    const optionsButton = await requestSessionDelete(user, stoppedSession.title)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(optionsButton).toHaveFocus()
  })

  it('returns focus to the session options button that opened the confirmation after Escape', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    render(<ProjectSidebar />)

    const optionsButton = await requestSessionDelete(user, stoppedSession.title)
    await user.keyboard('{Escape}')

    expect(optionsButton).toHaveFocus()
  })

  it('returns focus to the session options button after a dirty-delete result leaves the session in place', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [stoppedSession] })
    api.deleteSession = vi.fn(async () => ({ status: 'dirty', changedFiles: 1 }) as DeleteSessionResult)
    window.codeflai = api
    render(<ProjectSidebar />)

    const optionsButton = await requestSessionDelete(user, stoppedSession.title)
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await screen.findByText('Worktree has 1 changed files. Commit or discard them before deleting.')
    expect(optionsButton).toHaveFocus()
  })
})
