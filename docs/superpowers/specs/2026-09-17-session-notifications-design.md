# Session notifications and the unread badge

Tells the user a session finished while the Codeflai window is not in front of them. A
system notification is raised at the same Done edge the sidebar already reports, and the
taskbar/Dock carries an unread badge. Both are driven from the renderer's existing unread
signal, so the sidebar and the notification can never disagree about what "done" means.

The sidebar dots, the unread markers, and the Done edge itself are unchanged. This adds an
outlet for a signal that already exists.

## Behavior

### When a notification is raised

- Only while the window is unattended: `document.visibilityState === 'hidden'` or the
  document does not have focus. With the window in front of the user the sidebar dot is
  already visible, and a system toast on top of it is noise.
- At the agent Done edge — `AgentActivityTracker` reports the session is no longer running
  and the three-second quiet window elapses. This is the same edge that raises unread, and
  it fires at most once per turn: any further output disarms the idle state, so a second
  notification needs a second turn.
- On session exit, for every session kind. A session ending is worth knowing about whether
  it was an agent or a shell.
- Never on shell byte output. Unread is raised there because shells do not repaint
  themselves, but a notification per chunk of output is unusable.

### When a notification is suppressed

Four cases, each of which would otherwise produce notifications the user never asked for:

- **Replayed output.** `noteAgentOutput` only invokes its `onIdle` callback for a timer
  armed by live output, so the retained tail replayed on startup cannot fabricate a Done
  edge. This existing guard now protects notifications as well as unread markers.
- **Before the snapshot loads.** `recordUnread` queues ids into `pendingUnread` until the
  session records arrive. Notifications do not follow that backlog; a restart would
  otherwise raise one per queued session.
- **While the window is attended.** As above.
- **Exits the user asked for.** `stopSession` and `deleteSession` record the session id in
  an `expectedExits` set, which the exit handler consumes and skips. The window normally
  still has focus at that moment and the attended check already covers it, but "stop the
  session, then switch away before the exit event lands" is a real race, and a toast saying
  a session the user just stopped has stopped is worse than no toast. An id whose exit event
  never arrives — the PTY was already gone — is dropped when the session record disappears,
  so the set cannot grow without bound.

The preference is checked in `notifySessionEvent` before anything else: with notifications
switched off no IPC is sent at all, rather than the main process being asked to discard it.

### Clicking a notification

Focuses the window and switches to that session. If the window is minimized it is restored
first. If the session no longer exists by the time the click is handled, the window is still
focused but nothing else happens — `setActiveSession` does not guard against unknown ids and
would leave `activeSessionId` pointing at a session that is gone, blanking the terminal pane.

### The unread badge

- One count for the whole app: the number of sessions carrying an unread marker.
- macOS shows the number, via `app.dock.setBadge`, which takes text natively.
- Windows shows a dot, via `setOverlayIcon`, which takes only a `nativeImage` and has no
  built-in number rendering. The sidebar already carries an exact per-project count; the
  taskbar only has to answer whether there is anything at all. Rendering digits would mean
  ten image resources, an electron-builder entry, and a second dev/packaged path branch of
  the kind `window.ts` already documents as troublesome.
- Unread survives restarts — it is restored from `workspace.unreadSessionIds` — so the badge
  is drawn from the restored count at startup, not from zero.
- The badge is cleared when the count reaches zero, and when the preference is switched off.
  A stale number that will never update again is worse than no badge.

### The preference

- One switch governs both the notifications and the badge. They answer the same question —
  what should reach the user when the window is not in front of them — and splitting them
  asks the user to make a distinction they do not care about.
- Default on. Unlike auto shutdown, which defaults off because shutting a machine down is
  irreversible, a notification only fires when the window is unattended and reports exactly
  the event the user is waiting for.
- Stored in `localStorage` under `codeflai.notifications`, alongside theme, locale, window
  pinning, and auto shutdown. It is a renderer preference and does not enter `AppState`.
  Anything unreadable or malformed falls back to on.
- Rendered in the Settings dialog's `general` section, beside launch-at-login, theme, and
  language.

### Wording

The notification title is the session title, so the toast names the session the way the
sidebar does. The body comes from one of two keys, each taking the project name as its only
placeholder, added to both the English and Chinese dictionaries:

| Key | English | Chinese |
| --- | --- | --- |
| `notification.agentDone` | `{project} · Done` | `{project} · 已完成` |
| `notification.sessionExited` | `{project} · Session exited` | `{project} · 会话已退出` |

The badge's accessible label reuses the existing `sidebar.unreadCount` key, which already
reads "{count} unread session(s)" in both dictionaries.

## Architecture

### Background throttling

`createMainWindow` gains `backgroundThrottling: false` in its `webPreferences`. The Done edge
is a three-second `setTimeout`, and Chromium aligns timers in a hidden renderer to roughly
one minute after five minutes out of sight — which is exactly the situation notifications
exist for. The cost is that the renderer is no longer throttled in the background at all;
`countdownTick` computes from an absolute deadline and is correct either way, so auto
shutdown is unaffected.

The alternative — detecting the Done edge a second time in the main process — was rejected.
It would put two definitions of "done" in the codebase, which is the mistake auto shutdown
already made once when `hasRunningSessions` judged by `status` instead of the sidebar's own
`isAgentDone` and consequently never fired.

### Contracts and IPC

Three channels. The first two are one-way sends validated like `terminal:write`: sender
checked against the window, payload parsed with a `strictObject` schema, parse failures and
downstream errors logged rather than thrown back across `ipcMain`'s listener dispatch.

| Channel | Direction | Payload |
| --- | --- | --- |
| `notification:idle` | renderer to main | `{ sessionId, title, body }` |
| `notification:unread` | renderer to main | `{ count, label }` |
| `notification:activate` | main to renderer | `{ sessionId }` |

`title`, `body`, and `label` are capped at 200 characters. The wording crosses IPC because
the i18n dictionaries live entirely in the renderer and the main process cannot translate.
This does not weaken the rule that the renderer can never name a URL or a command — text is
not executable content — but an uncapped string still has no business being passed through.

`label` carries the accessible description for `setOverlayIcon`, translated by the renderer
for the same reason as the rest of the wording.

### NotificationService

`src/main/services/notification-service.ts`, constructor-injected like `PowerService` and,
like it, **never throws**: its callers are `ipcMain.on` listeners with no rejection path.

    notify({ sessionId, title, body }): void
    setUnread(count: number, label: string): void
    onActivate(listener: (sessionId: string) => void): () => void

Two collaborators are injected so the service can be tested without Electron: a
`NotificationFactory` wrapping `Notification`, and a structural `NotificationWindow`
(`show` / `focus` / `isMinimized` / `restore` / `setOverlayIcon`) — the same reasoning that
has `SessionCoordinator` depend on `SessionTerminal` rather than a concrete service.
`Notification.isSupported()` is checked before constructing one; an unsupported platform is
silently skipped.

The Windows overlay dot is a 16x16 PNG inlined as a base64 constant and built with
`nativeImage.createFromDataURL`, which avoids both an electron-builder resource entry and a
packaged/dev path branch.

### Renderer

- `isWindowAttended()` is extracted from `isViewingSession`, which becomes
  `sessionId === activeSessionId && isWindowAttended()`. Three call sites now share the
  condition, so it gets a name.
- `notifySessionEvent(sessionId, reason: 'idle' | 'exit')` sits beside `recordUnread` rather
  than inside it. Of `recordUnread`'s three call sites only two should notify, so wrapping it
  would require the wrapper to re-derive which case it is in. `recordUnread` is unchanged.
  The `reason` picks the body key and nothing else.
- The badge is pushed explicitly from the places the unread set changes —
  `noteUnreadOutput`, `markViewedSessionRead`, wholesale snapshot replacement, and the
  delete/remove cleanups — through a single `syncBadge()`. Explicit calls beat comparing
  counts inside a `subscribe` callback, and match how the rest of the store is written.
  `unreadSessionIds` is already pruned when a session is deleted and when a project is
  removed, so the count cannot drift high.
- `notification:activate` is subscribed in `initialize()` and disposed with the other
  listeners.

## Verification

- `notification-service.test.ts`, with a hand-written `FakeNotificationFactory` and
  `FakeWindow`: silence when `isSupported()` is false; a click on a minimized window calls
  `restore` before `focus` before emitting the id; a count of zero clears the badge on both
  platforms; darwin uses `dock.setBadge` and win32 uses `setOverlayIcon`.
- Store tests for each of the four suppression rules, plus the positive case — an unattended
  Done edge does send `notification:idle`. `window.codeflai` is faked and `document.hasFocus`
  is controlled.
- `register-ipc` tests for sender validation, malformed payloads, and an over-length title
  being rejected by the schema.
- e2e asserts only that the Settings switch appears, toggles, and survives a restart.
  System notification UI cannot be asserted through Playwright, and this matches the
  precedent set by `e2e/auto-shutdown.spec.ts`, which likewise covers the control surface
  and leaves the mechanism to unit tests.
