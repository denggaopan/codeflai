# Session Stop, Precise Unread, and Manual Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the archive concept with an explicit Stop action, make unread mean "an agent turn finished" instead of "bytes arrived", and let the user order sessions by hand within a project.

**Architecture:** Renderer-side unread bookkeeping moves from the `onTerminalData` byte check to the existing agent idle (Done) edge, with a live-vs-replay flag so replay never fabricates unread. `archived` is retired: the schema keeps accepting it so 0.23.x state files still parse, `SessionStore` strips it on load, and a new `session:stop` IPC calls the `SessionCoordinator.stop()` that already exists. Session ordering reuses the quick-prompt drag-sort hook, generalized, with `projectId` as the drag surface so same-project-only falls out of existing code.

**Tech Stack:** Electron 4-process layout, React 19, TypeScript, zustand, zod `strictObject` contracts, Vitest (jsdom for renderer, hand-written fakes — never module mocks), Playwright for Electron E2E.

**Spec:** `docs/superpowers/specs/2026-09-10-session-stop-and-ordering-design.md`

## Global Constraints

- Every new UI string needs a key in **both** `src/renderer/src/i18n/en.ts` and `src/renderer/src/i18n/zh-CN.ts`. `en.ts` derives `TranslationKey`, so a missing `zh-CN` key fails typecheck. Tests and E2E assert English copy.
- All cross-process payloads are zod `strictObject`. Every IPC handler parses its request schema before touching a service.
- State changes in the main process persist **before** broadcasting (`emit`).
- Tests live beside sources as `*.test.ts(x)`, use constructor injection with hand-written fakes, and never mock modules.
- `SessionCoordinator.withLock` is **not reentrant**. Private helpers like `stopAndPersist` assume the caller already holds the session lock.
- Rejections crossing `ipcRenderer.invoke` lose their subclass identity — renderer code may only read `error.message`, never branch on error type.
- Do not bump `package.json` version in this plan. The version bump is a separate `chore` commit at release time (MINOR, per SemVer).
- Commit messages: English, Conventional Commits prefix, focused on *why*. End each with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Unread only at the agent Done edge

**Files:**
- Modify: `src/renderer/src/store/use-app-store.ts` (`noteAgentOutput` ~363-385, `initialize`'s `recordUnread` ~429-437, snapshot handler ~533, `hydrateActivity` ~443-451, `onTerminalData` ~569-580)
- Test: `src/renderer/src/store/use-app-store.test.ts` (`describe('unread session activity')` ~180-248)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `noteAgentOutput(sessionId: string, data: string, replay?: boolean, onIdle?: (sessionId: string) => void): void` — the idle-timer callback invokes `onIdle(sessionId)` only when the timer was armed by live (non-replay) output. No later task calls it.

**Why a callback parameter:** `noteAgentOutput` lives in the `create()` closure, but `recordUnread` closes over `initialize`'s locals (`snapshotLoaded`, `pendingUnread`, `startupRead`), so it cannot be referenced from the outer scope. All three `noteAgentOutput` call sites are inside `initialize`, so passing `recordUnread` in is the smallest correct wiring.

**Test fixtures already in the file:** `claudeSession` (id `session-claude`, kind `claude`, running), `powershellSession` (id `session-ps`, kind `powershell`, running), `seededState`, `api` (the fake `window.codeflai`), `dispose`, and the imported `AGENT_IDLE_MS`. The suite uses fake timers.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/store/use-app-store.test.ts`, replace the first three cases of `describe('unread session activity')` with these four and add the fifth:

```ts
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
  })

  it('marks a shell session unread on any output', () => {
    useAppStore.getState().setActiveSession(claudeSession.id)
    api.emitTerminalData({ sessionId: powershellSession.id, data: 'PS C:\\> ' })
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
    const project: ProjectRecord = { id: 'project-1', name: 'Project', path: 'C:\\project', createdAt: claudeSession.createdAt }
    api.getSnapshot.mockResolvedValue({ platform: 'win32', capabilities: defaultCapabilities(), state: {
      ...seededState, projects: [project], workspace: { activeProjectId: project.id, activeSessionId: null, collapsedProjectIds: [] }
    } })
    api.replayTerminal.mockResolvedValue({ data: 'old output', cols: 80, rows: 24, throughSequence: 7 })
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_MS)
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
  })
```

Leave the two later cases — `'marks background exits and removes unread flags when a session is deleted'` and `'restores unread IDs, discards deleted IDs, and never marks historical replay unread'` — untouched. Exits stay byte-independent, and the second already covers replay exclusion on the persisted path.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts -t "unread session activity"`
Expected: FAIL — `marks an agent session unread only once its turn finishes` gets `[ 'session-claude' ]` where it expects `[]`, because output currently marks unread on arrival.

- [ ] **Step 3: Import `isAgentKind`**

In `src/renderer/src/store/use-app-store.ts`, extend the existing agent-kinds import (line 3):

```ts
import { AGENT_KINDS, isAgentKind, type AgentKind } from '../../../shared/agent-kinds'
```

- [ ] **Step 4: Raise unread from the idle timer instead of from bytes**

Replace `noteAgentOutput` (~363-385) with this version. Three changes: the kind gate widens to `isAgentKind`, the signature takes `onIdle`, and the timer reports the Done edge only when armed by live output.

```ts
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
```

- [ ] **Step 5: Stop raising unread from agent bytes, keep it for shells**

In `initialize`, replace the `onTerminalData` subscription (~569-580):

```ts
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
        noteAgentOutput(event.sessionId, event.data, false, recordUnread)
      })
```

- [ ] **Step 6: Forward the reporter through the replay path**

In `hydrateActivity` (~443-451):

```ts
          if (replay?.data) noteAgentOutput(sessionId, replay.data, true, recordUnread)
          for (const event of pending) {
            if (replay && event.sequence !== undefined && event.sequence <= replay.throughSequence) continue
            noteAgentOutput(sessionId, event.data, false, recordUnread)
          }
```

- [ ] **Step 7: Drop queued pre-snapshot unread for agent sessions**

In the snapshot `.then()` (~533), the queued ids were collected before kinds were known. Agent sessions must re-derive unread from the Done edge:

```ts
          for (const sessionId of pendingUnread) {
            const queued = appState.sessions.find((candidate) => candidate.id === sessionId)
            if (queued && isAgentKind(queued.kind)) continue
            noteUnreadOutput(sessionId)
          }
          pendingUnread.clear()
```

- [ ] **Step 8: Widen the remaining activity gates**

Three call sites still hardcode claude/codex, so without this the five opt-in agents would never hydrate their activity snapshot on startup and their first Done judgement after a restart would be made blind. In `initialize`, replace each:

`:538` (dropping queued activity for sessions that are no longer eligible):

```ts
            if (!appState.sessions.some((session) => session.id === sessionId && session.status === 'running' &&
              isAgentKind(session.kind))) pendingActivity.delete(sessionId)
```

`:541` (hydrating from the snapshot):

```ts
          for (const session of appState.sessions) {
            if (session.status === 'running' && isAgentKind(session.kind)) hydrateActivity(session.id)
          }
```

`:565` (hydrating a session that just started running):

```ts
          if (session.status === 'running' && isAgentKind(session.kind) &&
            !previousSessions.some((previous) => previous.id === session.id && previous.status === 'running')) hydrateActivity(session.id)
```

- [ ] **Step 9: Run the whole store suite**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts`
Expected: PASS — the existing Done/idle cases elsewhere in the file must not regress.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/store/use-app-store.ts src/renderer/src/store/use-app-store.test.ts
git commit -F - <<'EOF'
fix: raise unread activity at the agent Done edge

Agent TUIs repaint spinners and elapsed-time counters continuously, so a
byte-based unread marker meant every backgrounded agent session was
permanently unread and the one moment worth surfacing — the turn
finishing — was buried. Unread now follows the existing Done edge for
agent sessions, while shells, which do not repaint, keep byte-based
marking. The idle timer records whether it was armed by live output so
replaying the retained tail on startup cannot fabricate unread activity.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Stop replaces Archive, end to end

The `archived` field, its IPC, its store action, and its menu item are typed against each other, so TypeScript forces this to land as one change.

**Files:**
- Modify: `src/shared/contracts.ts` (`commonSessionRecordShape:53`, delete `setSessionArchivedRequestSchema:133-136`)
- Modify: `src/shared/ipc.ts:17`
- Modify: `src/main/services/session-store.ts` (`normalizeRuntimeStatuses:42-48`)
- Modify: `src/main/services/session-coordinator.ts` (delete `setArchived:196-201`)
- Modify: `src/main/ipc/register-ipc.ts` (imports ~21, handler ~213-219)
- Modify: `src/preload/index.ts:42,89`
- Modify: `src/renderer/src/store/use-app-store.ts` (`AppStore` member ~114, `setSessionArchived` ~941-954)
- Modify: `src/renderer/src/components/SessionRow.tsx` (props ~11-19, `:24`, `:110`, `:130`, menu item `:153-160`)
- Modify: `src/renderer/src/components/ProjectSidebar.tsx` (stop confirmation state, handler, dialog, row prop)
- Modify: `src/renderer/src/i18n/en.ts:54-56`, `src/renderer/src/i18n/zh-CN.ts:54-56`
- Modify: `src/renderer/src/styles.css` (delete the `[data-archived]` rules)
- Test: `src/main/services/session-store.test.ts`, `src/main/services/session-coordinator.test.ts`, `src/main/ipc/register-ipc.test.ts`, `src/renderer/src/store/use-app-store.test.ts`, `src/renderer/src/components/ProjectSidebar.test.tsx`

**Interfaces:**
- Consumes: `forgetAgentActivity` (existing) and Task 1's `noteAgentOutput` signature.
- Produces:
  - `IPC.sessionStop = 'session:stop'`
  - `window.codeflai.stopSession(sessionId: string): Promise<void>`
  - store action `stopSession(sessionId: string): Promise<void>`
  - `SessionRowProps.onRequestStop: (trigger: HTMLButtonElement) => void`
  - keys `sidebar.stopSession`, `sidebar.stopSessionTitle`, `sidebar.stopSessionPrompt`
  - `SessionCoordinator.setArchived` no longer exists.

- [ ] **Step 1: Write the failing main-process tests**

In `src/main/services/session-store.test.ts`, add inside `describe('SessionStore')`. `filePath`, `writeFile`, `stateWith`, and `stoppedSession` are all already in scope:

```ts
  it('strips the retired archived field while keeping the rest of a 0.23.x record', async () => {
    const legacy = { ...stateWith([]), sessions: [{ ...stoppedSession, status: 'running', archived: true }] }
    await writeFile(filePath, JSON.stringify(legacy), 'utf8')

    const loaded = await new SessionStore(filePath).load()

    expect(loaded.sessions[0]).not.toHaveProperty('archived')
    expect(loaded.sessions[0]).toMatchObject({ id: 's1', title: 'Terminal', status: 'running' })
  })
```

In `src/main/services/session-coordinator.test.ts`, replace the archive cases with this one. `buildHarness` returns `{ store, projectService, worktreeService, terminalService, titleService, coordinator }`, and `runningSession` is the existing record factory:

```ts
  it('stops the PTY and persists stopped without touching the worktree', async () => {
    const { store, terminalService, worktreeService, coordinator } = buildHarness({
      initial: { version: 1, projects: [], sessions: [runningSession({ status: 'running' })] }
    })

    await coordinator.stop('session-1')

    expect(terminalService.stop).toHaveBeenCalledWith('session-1')
    expect((await store.load()).sessions[0]?.status).toBe('stopped')
    expect(worktreeService.remove).not.toHaveBeenCalled()
  })
```

In `src/main/ipc/register-ipc.test.ts`, rename `FakeCoordinator`'s `readonly setArchived = vi.fn()` (`:89`) to `readonly stop = vi.fn()`, then replace the two set-archived cases (~586-593, ~605-615) with:

```ts
  it('parses the stop request and stops the session', async () => {
    const { ipcMain, coordinator } = buildHarness()

    await expect(ipcMain.invoke(IPC.sessionStop, { sessionId: session.id })).resolves.toBeUndefined()
    expect(coordinator.stop).toHaveBeenCalledWith(session.id)
  })

  it('rejects invalid stop requests before touching the coordinator', async () => {
    const { ipcMain, coordinator } = buildHarness()

    for (const invalid of [{}, { sessionId: '' }, { sessionId: session.id, archived: true }]) {
      await expect(ipcMain.invoke(IPC.sessionStop, invalid)).rejects.toBeInstanceOf(z.ZodError)
    }
    expect(coordinator.stop).not.toHaveBeenCalled()
  })
```

The `'rejects both metadata requests from another window'` case (~617-625) also references `coordinator.setArchived` and `IPC.sessionSetArchived` — point both at stop.

- [ ] **Step 2: Run the main-process tests to verify they fail**

Run: `npx vitest run src/main/services/session-store.test.ts src/main/services/session-coordinator.test.ts src/main/ipc/register-ipc.test.ts`
Expected: FAIL — `IPC.sessionStop` does not exist (TypeScript error), and `archived` survives `load()`.

- [ ] **Step 3: Retire the contract**

In `src/shared/contracts.ts`, annotate the field inside `commonSessionRecordShape`:

```ts
  titleManuallySet: z.boolean().optional(),
  // Retired: sessions are stopped, not archived. Still accepted because both branches of
  // sessionRecordSchema are strictObject, so dropping it outright would make every
  // state.json written by 0.23.x fail validation and fall into the recovery path.
  // SessionStore strips it on load, so it disappears after one startup.
  archived: z.boolean().optional(),
```

Delete `setSessionArchivedRequestSchema` (`:133-136`) — `session:stop` reuses the existing `sessionIdRequestSchema`.

- [ ] **Step 4: Rename the channel**

In `src/shared/ipc.ts`, replace line 17:

```ts
  sessionStop: 'session:stop',
```

- [ ] **Step 5: Strip the field on load**

In `src/main/services/session-store.ts`, replace `normalizeRuntimeStatuses`:

```ts
const normalizeRuntimeStatuses = (state: AppState): AppState => ({
  ...state,
  projects: [...state.projects],
  // `archived` is retired (see contracts.ts): dropping it here is the whole migration —
  // the next write simply no longer contains it.
  sessions: state.sessions.map(({ archived: _retired, ...session }) =>
    session.status === 'creating' ? { ...session, status: 'stopped' } : { ...session }
  )
})
```

- [ ] **Step 6: Delete `setArchived` and wire the handler**

Delete `SessionCoordinator.setArchived` (`:196-201`); `stop()` (`:242`) already does the work with the right locking.

In `src/main/ipc/register-ipc.ts`, drop `setSessionArchivedRequestSchema` from the imports and replace the handler:

```ts
    [
      IPC.sessionStop,
      async (_event, payload): Promise<void> => {
        const { sessionId } = sessionIdRequestSchema.parse(payload)
        await coordinator.stop(sessionId)
      }
    ],
```

- [ ] **Step 7: Rename the preload method**

In `src/preload/index.ts`, replace line 42 and line 89:

```ts
  stopSession(sessionId: string): Promise<void>
```

```ts
  stopSession: (sessionId) => ipcRenderer.invoke(IPC.sessionStop, { sessionId }),
```

- [ ] **Step 8: Run the main-process tests to verify they pass**

Run: `npx vitest run src/main/services/session-store.test.ts src/main/services/session-coordinator.test.ts src/main/ipc/register-ipc.test.ts`
Expected: PASS

- [ ] **Step 9: Write the failing renderer tests**

In `src/renderer/src/store/use-app-store.test.ts`, rename the fake API entry `setSessionArchived` to:

```ts
    stopSession: vi.fn(async (_sessionId: string): Promise<void> => undefined),
```

and replace the `setSessionArchived` cases (~160-177) with:

```ts
  it('stops a session, clearing its unread marker', async () => {
    api.emitTerminalData({ sessionId: powershellSession.id, data: 'output' })
    expect(useAppStore.getState().unreadSessionIds).toEqual([powershellSession.id])

    await useAppStore.getState().stopSession(powershellSession.id)

    expect(api.stopSession).toHaveBeenCalledWith(powershellSession.id)
    expect(useAppStore.getState().unreadSessionIds).toEqual([])
  })

  it('reports a stop failure as a notice', async () => {
    api.stopSession.mockRejectedValueOnce(new Error('PTY host unavailable'))

    await useAppStore.getState().stopSession(claudeSession.id)

    expect(useAppStore.getState().notice).toEqual({ message: 'PTY host unavailable', tone: 'error' })
  })
```

In `src/renderer/src/components/ProjectSidebar.test.tsx`, rename that file's fake `setSessionArchived` entry (`:58`) to:

```ts
  stopSession: vi.fn(async (_sessionId: string): Promise<void> => undefined),
```

and replace the archive-menu case inside `describe('session organization controls')` with these two. That describe's `beforeEach` already seeds `[runningWorktreeSession, stoppedSession]`; `runningWorktreeSession` is titled `Fix login bug` and `stoppedSession` is titled `New PowerShell session`:

```ts
  it('confirms before stopping a running session', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Session options for Fix login bug' }))
    await user.click(screen.getByRole('menuitem', { name: 'Stop' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Stop session' })
    expect(api.stopSession).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }))

    expect(api.stopSession).toHaveBeenCalledWith(runningWorktreeSession.id)
  })

  it('disables Stop for a session that is already stopped', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Session options for New PowerShell session' }))

    expect(screen.getByRole('menuitem', { name: 'Stop' })).toBeDisabled()
  })
```

- [ ] **Step 10: Run the renderer tests to verify they fail**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts src/renderer/src/components/ProjectSidebar.test.tsx`
Expected: FAIL — `stopSession` is not a store action and no `Stop` menu item exists.

- [ ] **Step 11: Replace the store action**

In `src/renderer/src/store/use-app-store.ts`, change the `AppStore` member (~114) to:

```ts
  stopSession: (sessionId: string) => Promise<void>
```

Replace the `setSessionArchived` implementation (~941-954) with:

```ts
    stopSession: async (sessionId) => {
      try {
        await window.codeflai.stopSession(sessionId)
        // The stopped record itself arrives via onStateChanged, the durable source of truth.
        // Only renderer-local activity bookkeeping needs clearing here: the process is gone,
        // so a retained unread marker or activity snapshot is stale.
        forgetAgentActivity(sessionId)
        set((state) => ({
          unreadSessionIds: state.unreadSessionIds.filter((id) => id !== sessionId),
          notice: null
        }))
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },
```

- [ ] **Step 12: Swap the translation keys**

In `src/renderer/src/i18n/en.ts`, replace lines 54-56:

```ts
  'sidebar.stopSession': 'Stop',
  'sidebar.stopSessionTitle': 'Stop session',
  'sidebar.stopSessionPrompt': 'Stop "{title}"? The session can be restored later and will continue the same conversation.',
```

In `src/renderer/src/i18n/zh-CN.ts`, replace lines 54-56:

```ts
  'sidebar.stopSession': '停止',
  'sidebar.stopSessionTitle': '停止会话',
  'sidebar.stopSessionPrompt': '要停止“{title}”吗？之后可以恢复该会话，并继续同一段对话。',
```

- [ ] **Step 13: Replace the menu item in `SessionRow`**

In `src/renderer/src/components/SessionRow.tsx`:
1. Add `onRequestStop: (trigger: HTMLButtonElement) => void` to `SessionRowProps` and to the destructured parameter list.
2. Delete the `setSessionArchived` selector (`:24`).
3. Drop `data-archived={...}` from the `<li>` (`:110`).
4. Simplify the secondary label (`:130`) to `<span className="session-secondary" title={secondary}>{secondary}</span>`.
5. Replace the archive menu item (`:153-160`) with:

```tsx
          <button type="button" role="menuitem" className="project-options-menu-item"
            disabled={session.status !== 'running' && session.status !== 'creating'}
            onClick={() => {
              closeMenu(); if (triggerRef.current) onRequestStop(triggerRef.current)
            }}>{t('sidebar.stopSession')}</button>
```

- [ ] **Step 14: Add the stop confirmation to `ProjectSidebar`**

Mirror the existing delete-confirmation trio. Beside `pendingDelete` (`:77`):

```ts
  const [pendingStop, setPendingStop] = useState<SessionRecord | null>(null)
```

Beside the other store selectors, add `const stopSession = useAppStore((state) => state.stopSession)`.

Beside `pendingDeleteTriggerRef` (`:245`):

```ts
  const pendingStopTriggerRef = useRef<HTMLButtonElement | null>(null)

  const handleRequestStop = (session: SessionRecord, trigger: HTMLButtonElement): void => {
    pendingStopTriggerRef.current = trigger
    setPendingStop(session)
  }

  const restoreStopTriggerFocus = (): void => {
    pendingStopTriggerRef.current?.focus()
    pendingStopTriggerRef.current = null
  }

  const handleConfirmStop = async (): Promise<void> => {
    if (!pendingStop) return
    const session = pendingStop
    setPendingStop(null)
    await stopSession(session.id)
    restoreStopTriggerFocus()
  }

  const handleCancelStop = (): void => {
    setPendingStop(null)
    restoreStopTriggerFocus()
  }
```

Pass the handler to the row (`:704-711`):

```tsx
                      onRequestStop={(trigger) => handleRequestStop(session, trigger)}
```

Add the dialog beside the delete one (~750). The missing `destructive` is deliberate: Stop is reversible, so Confirm keeps initial focus and Cancel-first focus stays reserved for Delete.

```tsx
      <ConfirmDialog
        open={pendingStop !== null}
        title={t('sidebar.stopSessionTitle')}
        description={pendingStop ? t('sidebar.stopSessionPrompt', { title: pendingStop.title }) : undefined}
        confirmLabel={t('sidebar.stopSession')}
        onConfirm={() => void handleConfirmStop()}
        onCancel={handleCancelStop}
      />
```

- [ ] **Step 15: Remove the archived styling**

In `src/renderer/src/styles.css`, delete every rule selecting `[data-archived` — the attribute no longer exists. Find them with `grep -n "data-archived" src/renderer/src/styles.css`.

- [ ] **Step 16: Run the affected tests, then typecheck**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts src/renderer/src/components/ProjectSidebar.test.tsx src/shared/contracts.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS. Any surviving `archived` / `setSessionArchived` reference surfaces here — delete each one. `contracts.test.ts` may still assert that a record carrying `archived` parses; that is correct and should stay.

- [ ] **Step 17: Commit**

```bash
git add -A src/shared src/main src/preload src/renderer
git commit -F - <<'EOF'
feat: replace session archive with an explicit stop

Archive was a label that left a bypass-approved agent running and writing
to a worktree while the row implied the session had been put away. Stop
terminates the PTY and persists stopped, which is also what the status
filter already understands, so the archive concept is no longer earning
its keep. Stop always confirms because it interrupts the running turn,
but is not marked destructive: restoring the session resumes the same
conversation, and worktrees and branches are untouched.

The archived field stays declared so state files written by 0.23.x keep
parsing; SessionStore strips it on load, so it disappears after one
startup without a separate migration step.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Icons on the session options menu

**Files:**
- Modify: `src/renderer/src/components/SessionRow.tsx` (glyph components above the default export, then one per menu item)
- Test: `src/renderer/src/components/ProjectSidebar.test.tsx`

**Interfaces:**
- Consumes: Task 2's Stop menu item.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

In `src/renderer/src/components/ProjectSidebar.test.tsx`, inside `describe('session organization controls')`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/components/ProjectSidebar.test.tsx -t "decorative icon"`
Expected: FAIL — `expected null not to be null`; the menu items contain no `svg`.

- [ ] **Step 3: Add the glyphs**

In `src/renderer/src/components/SessionRow.tsx`, above `export default function SessionRow`, following the `FolderGlyph` pattern at `ProjectSidebar.tsx:29`:

```tsx
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
```

- [ ] **Step 4: Render one per menu item**

Put `<PencilGlyph />` immediately before `{t('sidebar.renameSession')}`, `<StopGlyph />` before `{t('sidebar.stopSession')}`, and `<TrashGlyph />` before `{t('common.delete')}`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/components/ProjectSidebar.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SessionRow.tsx src/renderer/src/components/ProjectSidebar.test.tsx
git commit -F - <<'EOF'
feat: add icons to the session options menu

Matches the project options menu, which already leads each item with an
icon. The glyphs are aria-hidden, so the accessible name stays the item's
own text.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Remove the archive visibility filter

**Files:**
- Modify: `src/renderer/src/components/SessionFilters.tsx` (the whole archive half)
- Modify: `src/renderer/src/components/ProjectSidebar.tsx` (`:19`, `:79`, `:309-319`, `:462`, `:502`)
- Modify: `src/renderer/src/i18n/en.ts:57-60`, `src/renderer/src/i18n/zh-CN.ts:57-60`
- Test: `src/renderer/src/components/ProjectSidebar.test.tsx`

**Interfaces:**
- Consumes: Task 2 (the archive concept is already gone from the data model).
- Produces: `SessionFilters` props narrow to `{ value, onChange }`; `SessionArchiveFilter` no longer exists.

- [ ] **Step 1: Write the failing test**

In `src/renderer/src/components/ProjectSidebar.test.tsx`, inside `describe('session organization controls')` (its `beforeEach` seeds a running `Fix login bug` and a stopped `New PowerShell session`):

```ts
  it('offers only a status filter, with stopped covering put-away sessions', async () => {
    const user = userEvent.setup()
    render(<ProjectSidebar />)
    await user.click(screen.getByRole('button', { name: 'Filter sessions' }))

    expect(screen.queryByRole('combobox', { name: 'Session visibility' })).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session status' }), 'stopped')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getByText('New PowerShell session')).toBeVisible()
    expect(screen.queryByText('Fix login bug')).toBeNull()
  })
```

Delete any existing case that drives the `Session visibility` select.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/components/ProjectSidebar.test.tsx -t "only a status filter"`
Expected: FAIL — the `Session visibility` combobox is still rendered.

- [ ] **Step 3: Narrow `SessionFilters`**

In `src/renderer/src/components/SessionFilters.tsx`, delete: the `SessionArchiveFilter` type export, the `archiveValue`/`onArchiveChange` props and their destructuring, the `draftArchive` state, the `archiveLabel` constant, the second `<select>`, and the archive halves of `active`, `title`, the trigger's `onClick` draft reset, `onReset`, and `onSubmit`. Then:

```ts
  const active = value !== 'all'
```

and the trigger's title becomes:

```ts
        title={`${t('sidebar.sessionStatus')}: ${statusLabel}`}
```

- [ ] **Step 4: Narrow `ProjectSidebar`**

Drop `type SessionArchiveFilter` from the import (`:19`), delete the `archiveFilter` state (`:79`), and replace `:309-319` with:

```ts
  const filtering = normalizedQuery !== '' || statusFilter !== 'all'
  const [resultFolds, setResultFolds] = useState<{ query: string; status: SessionStatusFilter; ids: string[] }>({
    query: normalizedQuery, status: statusFilter, ids: []
  })
  // New criteria reveal matches; folding results never overwrites saved workspace folds.
  if (resultFolds.query !== normalizedQuery || resultFolds.status !== statusFilter) {
    setResultFolds({ query: normalizedQuery, status: statusFilter, ids: [] })
  }
  const dragEnabled = !filtering
  const filteredSessions = appState.sessions.filter((session) => {
    const status = isAgentDone(session, idleAgentSessionIds[session.id] === true) ? 'done' : session.status
    return (statusFilter === 'all' || status === statusFilter) && session.title.toLowerCase().includes(normalizedQuery)
  })
```

Render it as `<SessionFilters value={statusFilter} onChange={setStatusFilter} />` (`:462`), and drop `setArchiveFilter('active')` from the clear-filters button (`:502`).

- [ ] **Step 5: Delete the retired keys**

Remove `sidebar.sessionVisibility`, `sidebar.activeSessions`, `sidebar.archivedSessions`, and `sidebar.allSessions` from **both** `en.ts` and `zh-CN.ts` (lines 57-60 of each).

- [ ] **Step 6: Run the tests, then typecheck**

Run: `npx vitest run src/renderer/src/components/ProjectSidebar.test.tsx`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A src/renderer
git commit -F - <<'EOF'
refactor: drop the archive visibility filter

With archive replaced by stop, a put-away session is simply a stopped
one, and the status filter already selects those. The second select was
asking the user to distinguish two things that are now one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Persist a manual session order

**Files:**
- Modify: `src/shared/contracts.ts` (add `reorderSessionsRequestSchema` beside `reorderProjectsRequestSchema`)
- Modify: `src/shared/ipc.ts` (add `sessionReorder`)
- Modify: `src/main/services/session-coordinator.ts` (add `SessionOrderMismatchError`, `reorder`)
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/store/use-app-store.ts` (add `reorderSessions`)
- Test: `src/main/services/session-coordinator.test.ts`, `src/main/ipc/register-ipc.test.ts`, `src/renderer/src/store/use-app-store.test.ts`

**Interfaces:**
- Consumes: Task 2's contract cleanup.
- Produces:
  - `reorderSessionsRequestSchema` with field `orderedSessionIds: string[]` (min 1)
  - `IPC.sessionReorder = 'session:reorder'`
  - `SessionCoordinator.reorder(orderedSessionIds: readonly string[]): Promise<SessionRecord[]>`
  - `SessionOrderMismatchError`
  - `window.codeflai.reorderSessions(orderedSessionIds: readonly string[]): Promise<SessionRecord[]>`
  - store action `reorderSessions(orderedSessionIds: readonly string[]): Promise<void>`

- [ ] **Step 1: Write the failing tests**

In `src/main/services/session-coordinator.test.ts`, import `SessionOrderMismatchError` from `./session-coordinator` and add:

```ts
describe('SessionCoordinator.reorder', () => {
  const twoSessions = {
    version: 1 as const,
    projects: [],
    sessions: [runningSession({ id: 'session-a' }), runningSession({ id: 'session-b' })]
  }

  it('persists an exact permutation of the session order', async () => {
    const { store, coordinator } = buildHarness({ initial: twoSessions })

    const reordered = await coordinator.reorder(['session-b', 'session-a'])

    expect(reordered.map((session) => session.id)).toEqual(['session-b', 'session-a'])
    expect((await store.load()).sessions.map((session) => session.id)).toEqual(['session-b', 'session-a'])
  })

  it('rejects an order that is not an exact permutation', async () => {
    const { coordinator } = buildHarness({ initial: twoSessions })

    await expect(coordinator.reorder(['session-a'])).rejects.toBeInstanceOf(SessionOrderMismatchError)
    await expect(coordinator.reorder(['session-a', 'session-a'])).rejects.toBeInstanceOf(SessionOrderMismatchError)
    await expect(coordinator.reorder(['session-a', 'session-c'])).rejects.toBeInstanceOf(SessionOrderMismatchError)
  })
})
```

In `src/main/ipc/register-ipc.test.ts`, add `readonly reorder = vi.fn(async () => [])` to `FakeCoordinator` and:

```ts
  it('parses the reorder request', async () => {
    const { ipcMain, coordinator } = buildHarness()

    await ipcMain.invoke(IPC.sessionReorder, { orderedSessionIds: ['b', 'a'] })

    expect(coordinator.reorder).toHaveBeenCalledWith(['b', 'a'])
  })

  it('rejects an empty reorder request', async () => {
    const { ipcMain, coordinator } = buildHarness()

    await expect(ipcMain.invoke(IPC.sessionReorder, { orderedSessionIds: [] })).rejects.toBeInstanceOf(z.ZodError)
    expect(coordinator.reorder).not.toHaveBeenCalled()
  })
```

In `src/renderer/src/store/use-app-store.test.ts`, add `reorderSessions: vi.fn(async (): Promise<SessionRecord[]> => [])` to the fake API and:

```ts
  it('merges the reordered sessions returned by the main process', async () => {
    api.reorderSessions.mockResolvedValueOnce([powershellSession, claudeSession])

    await useAppStore.getState().reorderSessions([powershellSession.id, claudeSession.id])

    expect(useAppStore.getState().appState.sessions.map((session) => session.id))
      .toEqual([powershellSession.id, claudeSession.id])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/services/session-coordinator.test.ts src/main/ipc/register-ipc.test.ts src/renderer/src/store/use-app-store.test.ts -t "reorder"`
Expected: FAIL — `SessionOrderMismatchError`, `coordinator.reorder`, and `IPC.sessionReorder` do not exist.

- [ ] **Step 3: Add the contract and channel**

In `src/shared/contracts.ts`, beside `reorderProjectsRequestSchema`:

```ts
// The full ordered id list (not a moved-id/index pair) so the request is idempotent and the
// coordinator can verify it is an exact permutation of the currently persisted sessions.
export const reorderSessionsRequestSchema = z.strictObject({
  orderedSessionIds: z.array(z.string().min(1)).min(1)
})
```

In `src/shared/ipc.ts`, beside the other session channels:

```ts
  sessionReorder: 'session:reorder',
```

- [ ] **Step 4: Implement `reorder`**

In `src/main/services/session-coordinator.ts`, add the error beside the other exported errors:

```ts
export class SessionOrderMismatchError extends Error {
  constructor() {
    super('The session order does not match the sessions on record.')
    this.name = 'SessionOrderMismatchError'
  }
}
```

Add the method after `rename`:

```ts
  /**
   * Persists a new display order for the sessions. The order must be an exact permutation of
   * the sessions persisted at commit time — validated inside the update transaction, so a
   * session created concurrently (after the renderer read its now-stale list) is never
   * silently dropped. Mirrors ProjectService.reorder.
   */
  async reorder(orderedSessionIds: readonly string[]): Promise<SessionRecord[]> {
    let reordered: SessionRecord[] = []
    await this.store.update((latest) => {
      const byId = new Map(latest.sessions.map((session) => [session.id, session]))
      const isPermutation =
        orderedSessionIds.length === byId.size &&
        new Set(orderedSessionIds).size === orderedSessionIds.length &&
        orderedSessionIds.every((id) => byId.has(id))
      if (!isPermutation) throw new SessionOrderMismatchError()

      reordered = orderedSessionIds.map((id) => byId.get(id)!)
      return { ...latest, sessions: reordered }
    })
    return reordered
  }
```

- [ ] **Step 5: Wire IPC, preload, and the store**

`src/main/ipc/register-ipc.ts` — import `reorderSessionsRequestSchema`, then:

```ts
    [
      IPC.sessionReorder,
      async (_event, payload): Promise<SessionRecord[]> => {
        const { orderedSessionIds } = reorderSessionsRequestSchema.parse(payload)
        return coordinator.reorder(orderedSessionIds)
      }
    ],
```

`src/preload/index.ts`:

```ts
  reorderSessions(orderedSessionIds: readonly string[]): Promise<SessionRecord[]>
```

```ts
  reorderSessions: (orderedSessionIds) => ipcRenderer.invoke(IPC.sessionReorder, { orderedSessionIds: [...orderedSessionIds] }),
```

`src/renderer/src/store/use-app-store.ts` — the `AppStore` member beside `stopSession`:

```ts
  reorderSessions: (orderedSessionIds: readonly string[]) => Promise<void>
```

and the action, following `reorderProjects` (~815):

```ts
    reorderSessions: async (orderedSessionIds) => {
      try {
        const sessions = await window.codeflai.reorderSessions(orderedSessionIds)
        set((state) => ({ appState: { ...state.appState, sessions } }))
      } catch (error) {
        set({ notice: { message: errorMessage(error, get().locale), tone: 'error' } })
      }
    },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/main/services/session-coordinator.test.ts src/main/ipc/register-ipc.test.ts src/renderer/src/store/use-app-store.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A src/shared src/main src/preload src/renderer
git commit -F - <<'EOF'
feat: persist a manual session order

Carries the complete ordered id list rather than a moved-id/index pair so
the request is idempotent, and validates the permutation inside the store
transaction so a session created between the renderer's read and the
commit is never silently dropped.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Drag sessions into order within a project

**Files:**
- Rename: `src/renderer/src/components/use-quick-prompt-sort.ts` → `src/renderer/src/components/use-drag-sort.ts`
- Modify: `src/renderer/src/components/QuickPrompts.tsx` (`:15`, `:46`, `:142`)
- Modify: `src/renderer/src/components/QuickPrompts.test.tsx` (import path only, if it imports the hook)
- Modify: `src/renderer/src/components/SessionRow.tsx` (accept and spread `dragProps`)
- Modify: `src/renderer/src/components/ProjectSidebar.tsx` (own the hook, convert a move into an ordered id list)
- Modify: `src/renderer/src/styles.css` (drop indicator for `.session-row`)
- Test: `src/renderer/src/components/ProjectSidebar.test.tsx`

**Interfaces:**
- Consumes: `reorderSessions` from Task 5.
- Produces:
  - `useDragSort(mimeType: string, onMove: (sourceId: string, targetId: string, placement: DropPlacement) => void)` returning `{ cancel, sourceProps, targetProps, rootProps }`, where `sourceProps(id: string, surface: string, enabled: boolean)` and `targetProps(id: string, surface: string, enabled: boolean)`.
  - `export type DropPlacement = 'before' | 'after'`
  - `SessionRowProps.dragProps: Record<string, unknown>`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/ProjectSidebar.test.tsx`. The file already imports `fireEvent`. `project1` is the seeded project; add a second project fixture inline. jsdom reports a zero-height rect, so any positive `clientY` lands past the midpoint and yields placement `after`:

```ts
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
    const otherProject: ProjectRecord = { ...project1, id: 'project-2', name: 'Other', path: 'C:\\other' }
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
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session status' }), 'stopped')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('draggable', 'false')
  })
```

If the seeded projects render collapsed, expand them first the way the neighbouring cases in this describe already do.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/ProjectSidebar.test.tsx -t "dragging"`
Expected: FAIL — session rows carry no `draggable` attribute.

- [ ] **Step 3: Generalize the hook**

`git mv src/renderer/src/components/use-quick-prompt-sort.ts src/renderer/src/components/use-drag-sort.ts`, then change exactly four things in it:

Replace the import and type aliases at the top:

```ts
import { useCallback, useRef, useState, type DragEvent, type MouseEvent } from 'react'

export type DropPlacement = 'before' | 'after'

type DragSource = { id: string; surface: string }
type DropTarget = DragSource & { placement: DropPlacement }
```

(The `QuickPromptPlacement` import and the `type Surface = 'bar' | 'manage'` alias both go away.)

Replace the function signature and its doc comment:

```ts
/**
 * Drag-to-reorder for a list, shared by quick prompts and session rows.
 *
 * `surface` scopes a drag: a source can only be dropped on a target declaring the same
 * surface, which is how session rows stay inside their own project without a separate check.
 * `mimeType` must be caller-specific and must never be text/plain — dropping a row onto xterm
 * has to be inert rather than pasting itself as a command. The click that would otherwise
 * fire at the end of a drag is suppressed through rootProps, which for a session row would
 * otherwise switch terminals.
 */
export function useDragSort(
  mimeType: string,
  onMove: (sourceId: string, targetId: string, placement: DropPlacement) => void
) {
```

Widen the two `surface: Surface` parameters in `sourceProps` and `targetProps` to `surface: string`, and use the caller's MIME type in `onDragStart`:

```ts
      event.dataTransfer.setData(mimeType, id)
```

Everything else in the body stays exactly as it is.

- [ ] **Step 4: Migrate `QuickPrompts` onto it**

In `src/renderer/src/components/QuickPrompts.tsx`: the import (`:15`) becomes `import { useDragSort } from './use-drag-sort'`, the prop type (`:46`) becomes `ReturnType<typeof useDragSort>`, and the call (`:142`) becomes:

```ts
  const sorting = useDragSort('application/x-codeflai-quick-prompt', reorder)
```

The `sourceProps`/`targetProps` call sites (`:95`, `:332`, `:334`) keep their `'bar'` / `'manage'` arguments unchanged. Update any `use-quick-prompt-sort` import in `QuickPrompts.test.tsx` to the new path.

- [ ] **Step 5: Accept drag props in `SessionRow`**

Add to `SessionRowProps` and the destructured list:

```ts
  dragProps: Record<string, unknown>
```

Spread it on the `<li>`:

```tsx
    <li className="session-row" {...dragProps} data-active={active ? 'true' : undefined} data-unread={unread ? 'true' : undefined}>
```

- [ ] **Step 6: Own the hook in `ProjectSidebar`**

Add the import:

```ts
import { useDragSort, type DropPlacement } from './use-drag-sort'
```

Add the selector and the move handler beside the other session handlers (~247):

```ts
  const reorderSessions = useAppStore((state) => state.reorderSessions)

  // The hook reports a single move; the IPC takes the complete order, so the move is replayed
  // against the persisted list. Sessions in other projects keep their positions, and the
  // drag surface has already confined source and target to the same project.
  const handleSessionMove = (sourceId: string, targetId: string, placement: DropPlacement): void => {
    const orderedIds = appState.sessions.map((session) => session.id).filter((id) => id !== sourceId)
    const targetIndex = orderedIds.indexOf(targetId)
    if (targetIndex === -1) return
    orderedIds.splice(placement === 'before' ? targetIndex : targetIndex + 1, 0, sourceId)
    if (orderedIds.some((id, index) => appState.sessions[index]?.id !== id)) void reorderSessions(orderedIds)
  }

  const sessionSorting = useDragSort('application/x-codeflai-session', handleSessionMove)
```

Spread `sessionSorting.rootProps` on the `.project-groups` container (`:498`), and pass the per-row props (`:704-711`). Passing `project.id` as the surface is what confines a drag to one project:

```tsx
                      dragProps={{
                        ...sessionSorting.sourceProps(session.id, project.id, dragEnabled),
                        ...sessionSorting.targetProps(session.id, project.id, dragEnabled)
                      }}
```

- [ ] **Step 7: Style the drop indicator**

In `src/renderer/src/styles.css`, add beside the existing `.project-row[data-drop=...]` rules (~770-783). Note the attribute is `data-drop-position` — that is what this hook emits, unlike the project rows' `data-drop`:

```css
.session-row[data-dragging='true'] {
  opacity: 0.45;
  cursor: grabbing;
}

/* Insertion indicator while dragging a session row, matching the project rows above. */
.session-row[data-drop-position='before'] {
  box-shadow: inset 0 2px 0 var(--color-accent);
}

.session-row[data-drop-position='after'] {
  box-shadow: inset 0 -2px 0 var(--color-accent);
}
```

- [ ] **Step 8: Run the tests, then typecheck**

Run: `npx vitest run src/renderer/src/components/ProjectSidebar.test.tsx src/renderer/src/components/QuickPrompts.test.tsx`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A src/renderer
git commit -F - <<'EOF'
feat: drag sessions into order within a project

Reuses the quick-prompt sort hook rather than duplicating drag handlers:
it already suppresses the click that ends a drag — which for a session
row would switch terminals — and avoids text/plain so a row dropped onto
xterm cannot paste itself as a command. Passing projectId as the drag
surface is what keeps a session inside the project its worktree lives in.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: E2E, docs, and full verification

**Files:**
- Modify: `e2e/session-organization.spec.ts`
- Modify: `README.md`, `README.zh-CN.md`, `CLAUDE.md`
- Test: the full unit suite plus Electron E2E

**Interfaces:**
- Consumes: every earlier task.
- Produces: nothing.

- [ ] **Step 1: Update the E2E flow**

In `e2e/session-organization.spec.ts`:

1. Delete the `scope` helper (`:58-62`) and all three calls to it.
2. `MARKER_BETA` goes to a `claude` session, so unread now arrives after the quiet window rather than immediately:

```ts
    await page.evaluate(() => window.codeflai.writeTerminal('beta', 'MARKER_BETA\r'))
    await expect(row('beta task')).toHaveAttribute('data-unread', 'true', { timeout: 15_000 })
```

3. Replace the Archive interaction with Stop plus its confirmation, and assert the session really stopped:

```ts
    await page.getByRole('menuitem', { name: 'Stop', exact: true }).click()
    const stopDialog = page.getByRole('alertdialog', { name: 'Stop session', exact: true })
    await stopDialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect.poll(() => page.evaluate(async () =>
      (await window.codeflai.getSnapshot()).state.sessions.find((session) => session.id === 'alpha')?.status
    )).toBe('stopped')
    const stopped = await page.evaluate(async () =>
      (await window.codeflai.getSnapshot()).state.sessions.find((session) => session.id === 'alpha'))
    expect(stopped).toMatchObject({ status: 'stopped', title: 'Renamed alpha', titleManuallySet: true })
    expect(stopped).not.toHaveProperty('archived')
```

4. Delete the Unarchive interaction and any later assertion that assumed `alpha` was still running.
5. Add drag ordering before `closeUi()`, and re-assert it after the second `launch()`. Use `dragTo`, which drives real HTML5 drag events — a synthetic `mouse.down()`/`mouse.up()` sequence does not fire `dragstart`:

```ts
    const order = () => page.locator('.session-row .session-title').allInnerTexts()
    expect(await order()).toEqual(['Renamed alpha', 'beta task'])
    await page.locator('.session-row').first().dragTo(page.locator('.session-row').last())
    await expect.poll(order).toEqual(['beta task', 'Renamed alpha'])
```

After the restart, assert `await order()` still equals `['beta task', 'Renamed alpha']`.

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e`
Expected: PASS. It builds first, so a compile error from any earlier task surfaces here.

- [ ] **Step 3: Update the docs**

- `README.md` / `README.zh-CN.md`: replace the archive/unarchive description with Stop (terminates the PTY, persists stopped, keeps the worktree and branch, restore resumes the conversation, always confirms); state that unread means an agent turn finished — plus any output for shells, plus exits; drop the session-visibility filter from the filter description; document drag-to-order within a project.
- `CLAUDE.md`: update the `SessionCoordinator` bullet (`setArchived` gone, `reorder` added with in-transaction permutation validation), the `SessionStore` bullet (load also strips the retired `archived`), the renderer bullet describing unread and the filter form, and the E2E bullet listing what `session-organization.spec.ts` asserts.

- [ ] **Step 4: Run the full verification**

```bash
npm run typecheck && npm test && npm run build
```
Expected: all PASS. Report the actual output — never claim success without it.

- [ ] **Step 5: Commit**

```bash
git add -A e2e README.md README.zh-CN.md CLAUDE.md
git commit -F - <<'EOF'
test: cover session stop, precise unread, and manual ordering

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Launch the dev build**

Run: `npm run dev`
Check by hand: the session menu shows Rename/Stop/Delete with icons; Stop confirms and leaves a stopped row that restores on click; the filter popover has only a status select; sessions drag into order within a project but not across projects.
