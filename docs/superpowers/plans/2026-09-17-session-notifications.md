# Session Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise a system notification and a taskbar/Dock badge when a session finishes while the Codeflai window is not in front of the user.

**Architecture:** The renderer already detects the Done edge (`noteAgentOutput`'s `onIdle`) and already tracks unread sessions. This adds an outlet: the renderer decides *whether* to notify and supplies the wording, a new main-process `NotificationService` performs the OS-level effect, and a third channel carries a notification click back so the renderer can switch sessions. No second definition of "done" is introduced anywhere.

**Tech Stack:** Electron (`Notification`, `BrowserWindow.setOverlayIcon`, `app.dock.setBadge`, `nativeImage`), React 19, zustand, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-session-notifications-design.md`

## Global Constraints

- Every cross-process payload is a zod `strictObject` in `src/shared/contracts.ts`, parsed in the main process before any service is touched.
- `title`, `body` and `label` are capped at **200 characters**. `sessionRecordSchema.title` has no upper bound, so the renderer must `.slice(0, 200)` before sending.
- The main process service **never throws**: its callers are `ipcMain.on` listeners, which have no rejection path back to the renderer.
- The preference lives in `localStorage` under `codeflai.notifications`, **defaults to on**, and never enters `AppState`.
- Every new UI string needs a key in **both** `src/renderer/src/i18n/en.ts` and `src/renderer/src/i18n/zh-CN.ts` — `zh-CN.ts` is type-constrained to implement every key, so a missing one fails `npm run typecheck`.
- Notifications are suppressed in four cases: replayed output, before the snapshot loads, while the window is attended, and for exits the user asked for.
- Commit messages: English, Conventional Commits prefix, ending with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Run `npm run typecheck` before every commit. It covers both tsc projects.

---

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `src/main/services/notification-service.ts` | Decides what the OS is asked to do. Pure logic over two injected structural interfaces — imports nothing from `electron`, so it is unit-testable. |
| `src/main/services/notification-service.test.ts` | Hand-written fakes, no module mocking. |
| `src/main/infrastructure/electron-notifications.ts` | The only file that touches Electron's notification/badge APIs. Sits beside `net-fetch.ts`, which exists for the same reason. |
| `e2e/notifications.spec.ts` | The Settings switch on its own Electron instance. |

**Modify:**

| File | Change |
| --- | --- |
| `src/shared/ipc.ts` | Three channel names. |
| `src/shared/contracts.ts` | Two request schemas. |
| `src/preload/index.ts` | Two sends and one subscription. |
| `src/main/ipc/register-ipc.ts` | Two `ipcMain.on` listeners, one publisher, one dependency. |
| `src/main/index.ts` | Instantiate and inject; an E2E build that cannot raise a real toast. |
| `src/main/window.ts` | `backgroundThrottling: false`. |
| `src/renderer/src/store/use-app-store.ts` | `isWindowAttended`, `notifySessionEvent`, `expectedExits`, `syncBadge`, the preference, the activate subscription. |
| `src/renderer/src/components/SettingsDialog.tsx` | One switch in the `general` section. |
| `src/renderer/src/i18n/en.ts`, `zh-CN.ts` | Three keys each. |

---

### Task 1: NotificationService

The main-process service, with no Electron import so it can be tested directly.

**Files:**
- Create: `src/main/services/notification-service.ts`
- Test: `src/main/services/notification-service.test.ts`

**Interfaces:**
- Consumes: `HostPlatform` from `src/shared/contracts.ts` (`'win32' | 'darwin'`).
- Produces: `NotificationService` with `notify(notification: SessionNotification): void`, `setUnread(count: number, label: string): void`, `onActivate(listener: (sessionId: string) => void): () => void`. Types `SessionNotification`, `NotificationFactory`, `PlatformNotification`, `NotificationSurface`, and the constant `UNREAD_BADGE_DATA_URL`. Task 2 injects the service into `registerIpc` and implements its two interfaces against Electron.

- [ ] **Step 1: Write the failing test**

Create `src/main/services/notification-service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import {
  NotificationService,
  UNREAD_BADGE_DATA_URL,
  type NotificationFactory,
  type NotificationSurface,
  type PlatformNotification
} from './notification-service'

class FakeSurface implements NotificationSurface {
  readonly calls: string[] = []
  minimized = false
  overlay: { dataUrl: string | null; description: string } | undefined
  dockBadge: string | undefined

  isMinimized(): boolean {
    return this.minimized
  }
  restore(): void {
    this.calls.push('restore')
  }
  show(): void {
    this.calls.push('show')
  }
  focus(): void {
    this.calls.push('focus')
  }
  setOverlayIcon(dataUrl: string | null, description: string): void {
    this.calls.push('setOverlayIcon')
    this.overlay = { dataUrl, description }
  }
  setDockBadge(text: string): void {
    this.calls.push('setDockBadge')
    this.dockBadge = text
  }
}

class FakeNotification implements PlatformNotification {
  shown = false
  private clickListener: (() => void) | undefined

  show(): void {
    this.shown = true
  }
  onClick(listener: () => void): void {
    this.clickListener = listener
  }
  click(): void {
    this.clickListener?.()
  }
}

class FakeFactory implements NotificationFactory {
  readonly created: Array<{ title: string; body: string; notification: FakeNotification }> = []
  supported = true
  throwOnCreate = false

  isSupported(): boolean {
    return this.supported
  }
  create(title: string, body: string): PlatformNotification {
    if (this.throwOnCreate) throw new Error('notification centre unavailable')
    const notification = new FakeNotification()
    this.created.push({ title, body, notification })
    return notification
  }
}

const build = (platform: 'win32' | 'darwin' = 'win32') => {
  const surface = new FakeSurface()
  const factory = new FakeFactory()
  return { surface, factory, service: new NotificationService(surface, factory, platform) }
}

describe('NotificationService', () => {
  it('shows a notification carrying the wording it was given', () => {
    const { factory, service } = build()

    service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })

    expect(factory.created).toHaveLength(1)
    expect(factory.created[0]?.title).toBe('Add the parser')
    expect(factory.created[0]?.body).toBe('codeflai · Done')
    expect(factory.created[0]?.notification.shown).toBe(true)
  })

  it('stays silent where the platform has no notifications', () => {
    const { factory, service } = build()
    factory.supported = false

    service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })

    expect(factory.created).toEqual([])
  })

  it('restores a minimized window before focusing it, then reports the session', () => {
    const { surface, factory, service } = build()
    surface.minimized = true
    const activated: string[] = []
    service.onActivate((sessionId) => activated.push(sessionId))

    service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })
    factory.created[0]?.notification.click()

    expect(surface.calls).toEqual(['restore', 'show', 'focus'])
    expect(activated).toEqual(['s1'])
  })

  it('does not restore a window that is not minimized', () => {
    const { surface, factory, service } = build()

    service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })
    factory.created[0]?.notification.click()

    expect(surface.calls).toEqual(['show', 'focus'])
  })

  it('stops reporting to a listener that unsubscribed', () => {
    const { factory, service } = build()
    const activated: string[] = []
    const unsubscribe = service.onActivate((sessionId) => activated.push(sessionId))
    unsubscribe()

    service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })
    factory.created[0]?.notification.click()

    expect(activated).toEqual([])
  })

  it('badges Windows with a dot and the accessible label', () => {
    const { surface, service } = build('win32')

    service.setUnread(3, '3 unread session(s)')

    expect(surface.overlay).toEqual({ dataUrl: UNREAD_BADGE_DATA_URL, description: '3 unread session(s)' })
    expect(surface.dockBadge).toBeUndefined()
  })

  it('badges macOS with the count itself', () => {
    const { surface, service } = build('darwin')

    service.setUnread(3, '3 unread session(s)')

    expect(surface.dockBadge).toBe('3')
    expect(surface.overlay).toBeUndefined()
  })

  it('clears the badge on both platforms when nothing is unread', () => {
    const windows = build('win32')
    windows.service.setUnread(0, '')
    expect(windows.surface.overlay).toEqual({ dataUrl: null, description: '' })

    const mac = build('darwin')
    mac.service.setUnread(0, '')
    expect(mac.surface.dockBadge).toBe('')
  })

  it('never throws when the platform refuses a notification', () => {
    const { factory, service } = build()
    factory.throwOnCreate = true
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })).not.toThrow()

    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/services/notification-service.test.ts`
Expected: FAIL — `Failed to resolve import "./notification-service"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/services/notification-service.ts`:

```ts
import type { HostPlatform } from '../../shared/contracts'

export type SessionNotification = { sessionId: string; title: string; body: string }

/** One OS notification. Wrapping it keeps Electron's `Notification` out of this module. */
export type PlatformNotification = {
  show(): void
  onClick(listener: () => void): void
}

export type NotificationFactory = {
  isSupported(): boolean
  create(title: string, body: string): PlatformNotification
}

/**
 * The window operations this service performs, structural rather than a `BrowserWindow`, for
 * the same reason `SessionCoordinator` depends on `SessionTerminal`: the real implementation
 * imports `electron`, and a test must not.
 *
 * `setOverlayIcon` takes a data URL rather than a `NativeImage` so that no Electron type
 * reaches this module either; the adapter does the conversion.
 */
export type NotificationSurface = {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  setOverlayIcon(dataUrl: string | null, description: string): void
  setDockBadge(text: string): void
}

/**
 * The Windows taskbar overlay: a 16x16 dot in the brand accent (`--color-accent`) with a white
 * rim, so it stays visible on both a dark and a light taskbar — the overlay sits on OS chrome
 * that no app theme controls.
 *
 * It is a dot rather than a number because `setOverlayIcon` takes only an image and has no
 * digit rendering, while the sidebar already carries an exact per-project count; the taskbar
 * only has to answer whether there is anything at all. Inlining it as a data URL avoids both
 * an electron-builder resource entry and a packaged/dev path branch of the kind `window.ts`
 * already documents as troublesome. macOS needs none of this: `app.dock.setBadge` takes text.
 */
export const UNREAD_BADGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAdklEQVR42q2TwQ3AIAhFncTpXKBjeO9OHYBtuLymCU2osdEWTf6F+J8gkIAUUS+YgQoIoCaxWB4BihnYt+MhO2p3uoDSM76ASgu4UtOR2UH0LucG1JnXmyyqB8is2UHEA/QHQJcCwiWEPzHcxvAgLRnlJcv0WSd1DhHSJm8CJQAAAABJRU5ErkJggg=='

/**
 * Raises OS notifications and keeps the taskbar/Dock unread badge current.
 *
 * Like `PowerService` this **never throws**: every caller is an `ipcMain.on` listener, whose
 * only alternative would be an unhandled rejection nobody reads. A platform that refuses a
 * notification is logged and dropped.
 *
 * It decides nothing about *when* to notify. The renderer owns that, because the Done edge and
 * the window-attended check both live there, and duplicating either here would create a second
 * definition of "done" — the mistake auto shutdown already made once.
 */
export class NotificationService {
  private readonly activateListeners = new Set<(sessionId: string) => void>()

  constructor(
    private readonly surface: NotificationSurface,
    private readonly factory: NotificationFactory,
    private readonly platform: HostPlatform
  ) {}

  notify(notification: SessionNotification): void {
    try {
      if (!this.factory.isSupported()) return
      const toast = this.factory.create(notification.title, notification.body)
      toast.onClick(() => {
        this.focusWindow()
        for (const listener of this.activateListeners) listener(notification.sessionId)
      })
      toast.show()
    } catch (error) {
      console.error('NotificationService: failed to raise a notification.', error)
    }
  }

  setUnread(count: number, label: string): void {
    try {
      if (this.platform === 'darwin') {
        this.surface.setDockBadge(count > 0 ? String(count) : '')
        return
      }
      this.surface.setOverlayIcon(count > 0 ? UNREAD_BADGE_DATA_URL : null, count > 0 ? label : '')
    } catch (error) {
      console.error('NotificationService: failed to update the unread badge.', error)
    }
  }

  onActivate(listener: (sessionId: string) => void): () => void {
    this.activateListeners.add(listener)
    return () => {
      this.activateListeners.delete(listener)
    }
  }

  private focusWindow(): void {
    if (this.surface.isMinimized()) this.surface.restore()
    this.surface.show()
    this.surface.focus()
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/services/notification-service.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/main/services/notification-service.ts src/main/services/notification-service.test.ts
git commit -m "feat: add a notification service for session events

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The IPC layer, the Electron adapter, and the wiring

Three channels, their validation, the only file that touches Electron's notification APIs, and
the composition-root wiring that makes them reachable.

These arrive as one task because they cannot be split: the moment `registerIpc` gains a
required `notificationService` dependency, `src/main/index.ts` stops compiling until something
constructs one — and constructing one needs the adapter. A reviewer cannot meaningfully approve
half of that, and the Global Constraints require `npm run typecheck` to pass before every
commit.

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/preload/index.ts`
- Create: `src/main/infrastructure/electron-notifications.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/window.ts:88` (the `webPreferences` block)
- Test: `src/main/ipc/register-ipc.test.ts`

**Interfaces:**
- Consumes: `NotificationService`, `NotificationFactory`, `NotificationSurface`, `PlatformNotification` from Task 1.
- Produces: `IPC.notificationIdle`, `IPC.notificationUnread`, `IPC.notificationActivate`; schemas `notificationIdleRequestSchema`, `notificationUnreadRequestSchema`; preload methods `notifySessionIdle(sessionId: string, title: string, body: string): void`, `setUnreadBadge(count: number, label: string): void`, `onNotificationActivate(listener: (event: { sessionId: string }) => void): () => void`; `electronNotificationFactory()` and `electronNotificationSurface(window)`. Task 4 calls all three preload methods; Task 3 calls `setUnreadBadge`.

- [ ] **Step 1: Add the channel names**

In `src/shared/ipc.ts`, add to the `IPC` object — the first two beside `terminalWrite`/`terminalResize` (they are sends), the third beside `stateChanged` (it is a publish):

```ts
  notificationIdle: 'notification:idle',
  notificationUnread: 'notification:unread',
  notificationActivate: 'notification:activate',
```

- [ ] **Step 2: Add the schemas**

In `src/shared/contracts.ts`, after `terminalResizeRequestSchema`:

```ts
/**
 * A finished session, on its way to an OS notification.
 *
 * The wording crosses IPC because the i18n dictionaries live entirely in the renderer and the
 * main process cannot translate. Text is not executable content, so this does not weaken the
 * rule that keeps URLs and commands out of renderer hands (see UpdaterService resolving its
 * own installer URL) — but an uncapped string still has no business crossing the boundary,
 * and `sessionRecordSchema.title` has no upper bound of its own.
 */
export const notificationIdleRequestSchema = z.strictObject({
  sessionId: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(200)
})

// `label` is the accessible description for the Windows taskbar overlay, translated by the
// renderer for the same reason as the rest of the wording. It is empty when the count is zero.
export const notificationUnreadRequestSchema = z.strictObject({
  count: z.number().int().min(0).max(9999),
  label: z.string().max(200)
})
```

- [ ] **Step 3: Extend the preload bridge**

In `src/preload/index.ts`, add to the `CodeflaiApi` type beside `writeTerminal`:

```ts
  // One-way like the terminal writes: a notification nobody can raise is not worth a round trip.
  notifySessionIdle(sessionId: string, title: string, body: string): void
  setUnreadBadge(count: number, label: string): void
  onNotificationActivate(listener: (event: { sessionId: string }) => void): () => void
```

And to the `api` object, beside `resizeTerminal`:

```ts
  notifySessionIdle: (sessionId, title, body) => {
    ipcRenderer.send(IPC.notificationIdle, { sessionId, title, body })
  },
  setUnreadBadge: (count, label) => {
    ipcRenderer.send(IPC.notificationUnread, { count, label })
  },
```

And beside `onUpdateProgress`:

```ts
  onNotificationActivate: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { sessionId: string }): void => listener(payload)
    ipcRenderer.on(IPC.notificationActivate, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC.notificationActivate, wrapped)
    }
  },
```

- [ ] **Step 4: Write the adapter**

Create `src/main/infrastructure/electron-notifications.ts`:

```ts
import { app, nativeImage, Notification, type BrowserWindow } from 'electron'

import type {
  NotificationFactory,
  NotificationSurface,
  PlatformNotification
} from '../services/notification-service'

/**
 * The only file that touches Electron's notification and badge APIs, so that
 * `NotificationService` stays unit-testable — the same split `net-fetch.ts` exists for.
 */
export const electronNotificationFactory = (): NotificationFactory => ({
  isSupported: () => Notification.isSupported(),
  create: (title, body): PlatformNotification => {
    const notification = new Notification({ title, body })
    return {
      show: () => notification.show(),
      onClick: (listener) => {
        notification.on('click', listener)
      }
    }
  }
})

export const electronNotificationSurface = (window: BrowserWindow): NotificationSurface => ({
  isMinimized: () => window.isMinimized(),
  restore: () => window.restore(),
  show: () => window.show(),
  focus: () => window.focus(),
  setOverlayIcon: (dataUrl, description) => {
    window.setOverlayIcon(dataUrl === null ? null : nativeImage.createFromDataURL(dataUrl), description)
  },
  // `app.dock` exists only on macOS; the service never calls this on Windows, but the optional
  // chain keeps a mis-wired platform from crashing the main process.
  setDockBadge: (text) => {
    app.dock?.setBadge(text)
  }
})
```

- [ ] **Step 5: Extend the test harness**

`src/main/ipc/register-ipc.test.ts` already has everything needed: `FakeIpcMain` with `emit(channel, payload)` and `emitFrom(sender, channel, payload)`, and `fakeWindow()` whose `webContents.send` is a `vi.fn()`.

Add this fake beside `FakeUpdaterService` (~line 156):

```ts
class FakeNotificationService {
  readonly notified: Array<{ sessionId: string; title: string; body: string }> = []
  readonly unread: Array<{ count: number; label: string }> = []
  private readonly listeners = new Set<(sessionId: string) => void>()

  notify(notification: { sessionId: string; title: string; body: string }): void {
    this.notified.push(notification)
  }

  setUnread(count: number, label: string): void {
    this.unread.push({ count, label })
  }

  onActivate(listener: (sessionId: string) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emitActivate(sessionId: string): void {
    for (const listener of [...this.listeners]) listener(sessionId)
  }

  listenerCount(): number {
    return this.listeners.size
  }
}
```

Add `notificationService: FakeNotificationService` to the `Harness` type (beside `powerService`), construct it in `buildHarness` (`const notificationService = new FakeNotificationService()`), pass `notificationService: notificationService as unknown as NotificationService` in the `registerIpc({ ... })` call, and add `notificationService,` to the returned object.

- [ ] **Step 6: Write the failing tests**

Follow the file's conventions: destructure what each case needs from `buildHarness()`, and do **not** call `dispose()` — only the `describe('registerIpc: disposer')` block at the bottom of the file does that.

Add these beside the existing terminal-write cases:

```ts
  it('raises a notification for a well-formed request', () => {
    const { ipcMain, notificationService } = buildHarness()

    ipcMain.emit(IPC.notificationIdle, { sessionId: 's1', title: 'Add the parser', body: 'demo · Done' })

    expect(notificationService.notified).toEqual([
      { sessionId: 's1', title: 'Add the parser', body: 'demo · Done' }
    ])
  })

  it('drops a notification request from another sender', () => {
    const { ipcMain, notificationService } = buildHarness()

    ipcMain.emitFrom({}, IPC.notificationIdle, { sessionId: 's1', title: 'Add the parser', body: 'demo · Done' })

    expect(notificationService.notified).toEqual([])
  })

  it('drops a notification whose title exceeds the cap', () => {
    const { ipcMain, notificationService } = buildHarness()

    ipcMain.emit(IPC.notificationIdle, { sessionId: 's1', title: 'x'.repeat(201), body: 'demo · Done' })

    expect(notificationService.notified).toEqual([])
  })

  it('drops a notification carrying an unknown field', () => {
    const { ipcMain, notificationService } = buildHarness()

    ipcMain.emit(IPC.notificationIdle, { sessionId: 's1', title: 'Add the parser', body: 'demo · Done', urgency: 'critical' })

    expect(notificationService.notified).toEqual([])
  })

  it('forwards an unread count to the badge', () => {
    const { ipcMain, notificationService } = buildHarness()

    ipcMain.emit(IPC.notificationUnread, { count: 3, label: '3 unread session(s)' })

    expect(notificationService.unread).toEqual([{ count: 3, label: '3 unread session(s)' }])
  })

  it('drops a negative unread count', () => {
    const { ipcMain, notificationService } = buildHarness()

    ipcMain.emit(IPC.notificationUnread, { count: -1, label: '' })

    expect(notificationService.unread).toEqual([])
  })

  it('publishes a notification click to the renderer', () => {
    const { window, notificationService } = buildHarness()

    notificationService.emitActivate('s1')

    expect(window.webContents.send).toHaveBeenCalledWith(IPC.notificationActivate, { sessionId: 's1' })
  })
```

And add this one inside the existing `describe('registerIpc: disposer')` block, alongside the cases that already assert `coordinator.listenerCount()` and friends drop to zero:

```ts
  it('stops listening for notification clicks', () => {
    const { notificationService, dispose } = buildHarness()

    dispose()

    expect(notificationService.listenerCount()).toBe(0)
  })
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run src/main/ipc/register-ipc.test.ts`
Expected: FAIL — the `notificationService` dependency does not exist.

- [ ] **Step 8: Wire the handlers**

In `src/main/ipc/register-ipc.ts`:

Add the schemas to the import from `../../shared/contracts`, add `import type { NotificationService } from '../services/notification-service'`, add `notificationService: NotificationService` to `RegisterIpcDependencies`, and destructure it in `registerIpc`.

Then, beside `onTerminalWrite`/`onTerminalResize`:

```ts
  const onNotificationIdle = (event: IpcMainEvent, payload: unknown): void => {
    if (event.sender !== window.webContents) return
    const parsed = notificationIdleRequestSchema.safeParse(payload)
    if (!parsed.success) return
    notificationService.notify(parsed.data)
  }

  const onNotificationUnread = (event: IpcMainEvent, payload: unknown): void => {
    if (event.sender !== window.webContents) return
    const parsed = notificationUnreadRequestSchema.safeParse(payload)
    if (!parsed.success) return
    notificationService.setUnread(parsed.data.count, parsed.data.label)
  }
```

Register them beside the existing sends, and add the publisher beside `unsubscribeUpdateProgress`:

```ts
  ipcMain.on(IPC.notificationIdle, onNotificationIdle)
  ipcMain.on(IPC.notificationUnread, onNotificationUnread)
```

```ts
  const unsubscribeNotificationActivate = notificationService.onActivate((sessionId) => {
    publish(window, IPC.notificationActivate, { sessionId })
  })
```

Add all three to the returned cleanup:

```ts
    ipcMain.removeListener(IPC.notificationIdle, onNotificationIdle)
    ipcMain.removeListener(IPC.notificationUnread, onNotificationUnread)
    unsubscribeNotificationActivate()
```

Neither listener needs a try/catch: `NotificationService` never throws.

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run src/main/ipc/register-ipc.test.ts`
Expected: PASS.

- [ ] **Step 10: Wire the composition root**

In `src/main/index.ts`, add the imports:

```ts
import { NotificationService } from './services/notification-service'
import { electronNotificationFactory, electronNotificationSurface } from './infrastructure/electron-notifications'
```

Add an E2E build beside `buildE2EPowerService`:

```ts
/**
 * A NotificationService that cannot raise a toast. Notifications default to on and fire when
 * the window is unattended, which a Playwright-driven window frequently is — without this the
 * suite would spray real system notifications across the machine running it. The badge is left
 * alone: it is confined to the app's own taskbar button.
 */
const buildE2ENotificationService = (window: BrowserWindow, platform: HostPlatform): NotificationService =>
  new NotificationService(
    electronNotificationSurface(window),
    { isSupported: () => false, create: () => ({ show: () => undefined, onClick: () => undefined }) },
    platform
  )
```

After `window` is created and before `registerIpc`:

```ts
  const notificationService = isE2E
    ? buildE2ENotificationService(window, runtimePlatform)
    : new NotificationService(electronNotificationSurface(window), electronNotificationFactory(), runtimePlatform)
```

Add `notificationService,` to the `registerIpc({ ... })` argument object, beside `powerService`.

- [ ] **Step 11: Stop Chromium throttling the renderer**

In `src/main/window.ts`, add to `webPreferences`:

```ts
      // The Done edge that drives notifications is a three-second timer in the renderer, and
      // Chromium aligns timers in a hidden renderer to roughly one minute once it has been out
      // of sight for five — which is exactly when a notification matters most. Auto shutdown is
      // unaffected: `countdownTick` computes from an absolute deadline, so it is correct either
      // way (that is why it was written that way).
      backgroundThrottling: false,
```

- [ ] **Step 12: Typecheck, run the full suite, and commit**

Run: `npm run typecheck && npm test`
Expected: PASS. The renderer still sends nothing, so behaviour is unchanged — this task only
makes the channels reachable.

```bash
git add src/shared/ipc.ts src/shared/contracts.ts src/preload/index.ts src/main/infrastructure/electron-notifications.ts src/main/ipc/register-ipc.ts src/main/ipc/register-ipc.test.ts src/main/index.ts src/main/window.ts
git commit -m "feat: add notification IPC channels and wire the service

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 3: The preference, its wording, and the Settings switch

Deliberately ahead of the notification logic: after this task the switch exists and persists, and Task 4 reads it.

**Files:**
- Modify: `src/renderer/src/i18n/en.ts`
- Modify: `src/renderer/src/i18n/zh-CN.ts`
- Modify: `src/renderer/src/store/use-app-store.ts`
- Modify: `src/renderer/src/components/SettingsDialog.tsx`
- Test: `src/renderer/src/store/use-app-store.test.ts`

**Interfaces:**
- Consumes: `setUnreadBadge` from Task 2.
- Produces: store state `notificationsEnabled: boolean`, action `setNotificationsEnabled(enabled: boolean): void`, exported `NOTIFICATIONS_STORAGE_KEY`, and the keys `settings.notifications`, `notification.agentDone`, `notification.sessionExited`. Task 4 reads `notificationsEnabled` and both `notification.*` keys.

- [ ] **Step 1: Add the translation keys**

In `src/renderer/src/i18n/en.ts`, beside `'settings.showQuickPrompts'`:

```ts
  'settings.notifications': 'Notify when a session finishes',
```

and beside the other top-level groups:

```ts
  'notification.agentDone': '{project} · Done',
  'notification.sessionExited': '{project} · Session exited',
```

In `src/renderer/src/i18n/zh-CN.ts`, at the matching positions:

```ts
  'settings.notifications': '会话完成时通知',
```

```ts
  'notification.agentDone': '{project} · 已完成',
  'notification.sessionExited': '{project} · 会话已退出',
```

- [ ] **Step 2: Write the failing test**

Add to `src/renderer/src/store/use-app-store.test.ts`. The preference is read during `initialize()`, and the file's `beforeEach` already clears `localStorage` and initializes with a fresh fake API, so these tests re-initialize against a seeded storage value. `readStoredNotifications` stays module-private — do not export it just to test it.

First add this helper beside the existing `idleIds` helper:

```ts
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
```

```ts
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
```

Add the two new methods to `createFakeApi`'s returned object, beside `resizeTerminal`, so the type matches `CodeflaiApi` (Task 4 extends this with the activate listener):

```ts
    notifySessionIdle: vi.fn(),
    setUnreadBadge: vi.fn(),
    onNotificationActivate: vi.fn((_listener: (event: { sessionId: string }) => void) => () => undefined),
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts`
Expected: FAIL — `setNotificationsEnabled` is not a function.

- [ ] **Step 4: Implement the preference**

In `src/renderer/src/store/use-app-store.ts`, beside `SHOW_QUICK_PROMPTS_STORAGE_KEY`:

```ts
export const NOTIFICATIONS_STORAGE_KEY = 'codeflai.notifications'
```

Beside `readStoredShowQuickPrompts`:

```ts
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
```

Add `notificationsEnabled: boolean` to the store type beside `showQuickPrompts`, and `setNotificationsEnabled: (enabled: boolean) => void` to the actions.

Add `notificationsEnabled: true` to both initial-state objects (the one near `showQuickPrompts: false` at ~line 564 and the reset at ~line 826), and `notificationsEnabled: readStoredNotifications()` to the `set({ ... })` in `initialize()` beside `showQuickPrompts: readStoredShowQuickPrompts()`.

Add the action beside `setShowQuickPrompts`:

```ts
    setNotificationsEnabled: (enabled) => {
      set({ notificationsEnabled: enabled })
      try {
        window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, String(enabled))
      } catch {
        // Match other presentation preferences when localStorage is unavailable.
      }
      // Switching off must take the badge with it; a count that will never update again is
      // worse than no badge at all. Task 4 replaces this with syncBadge().
      if (!enabled) window.codeflai.setUnreadBadge(0, '')
    },
```

- [ ] **Step 5: Add the Settings switch**

In `src/renderer/src/components/SettingsDialog.tsx`, read `notificationsEnabled` and `setNotificationsEnabled` from the store the same way the component already reads `showQuickPrompts`/`setShowQuickPrompts`, then add this block in the `general` section immediately after the quick-prompts block (before the closing `</section>`):

```tsx
              <div className="settings-dialog-section">
                <span className="settings-dialog-label" id="settings-notifications-label">
                  {t('settings.notifications')}
                </span>
                <button
                  type="button"
                  className="settings-switch"
                  role="switch"
                  aria-checked={notificationsEnabled}
                  aria-labelledby="settings-notifications-label"
                  onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                >
                  <span className="settings-switch-thumb" aria-hidden="true" />
                </button>
              </div>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts src/renderer/src/components/SettingsDialog.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/src/i18n src/renderer/src/store/use-app-store.ts src/renderer/src/store/use-app-store.test.ts src/renderer/src/components/SettingsDialog.tsx
git commit -m "feat: add a notifications preference to Settings

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Raising notifications and driving the badge

The behavioural core. Everything before this was plumbing.

**Files:**
- Modify: `src/renderer/src/store/use-app-store.ts`
- Test: `src/renderer/src/store/use-app-store.test.ts`

**Interfaces:**
- Consumes: `notifySessionIdle`, `setUnreadBadge`, `onNotificationActivate` (Task 2); `notificationsEnabled` (Task 3).
- Produces: no new public surface — this task wires existing pieces together.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `src/renderer/src/store/use-app-store.test.ts`. The file's `beforeEach` already initializes the store with `claudeSession` (id `session-claude`, title `Fix login bug`, kind `claude`) and `powershellSession` (id `session-ps`, kind `powershell`), both `running`, and already spies on `document.hasFocus`.

`seededState.projects` is **empty**, so a project has to be pushed in for the wording to have a name — the file already does this in the unread tests via `api.onStateChanged.mock.calls.at(-1)![0]({ ...seededState, projects: [project] })`. Reuse that shape rather than changing the shared fixture, which other tests depend on.

```ts
describe('session notifications', () => {
  const project: ProjectRecord = {
    id: 'project-1', name: 'Project', path: 'C:\\project', createdAt: claudeSession.createdAt
  }

  const seedProject = (sessions: SessionRecord[] = [claudeSession, powershellSession]): void => {
    api.onStateChanged.mock.calls.at(-1)![0]({ ...seededState, projects: [project], sessions })
  }

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

    api.emitTerminalData({ sessionId: powershellSession.id, data: 'PS C:\\> ' })
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
```

Change `onNotificationActivate` in `createFakeApi` from the stub added in Task 3 to one that records its listener, matching how `onStateChanged` is stubbed:

```ts
    onNotificationActivate: vi.fn((_listener: (event: { sessionId: string }) => void) => () => undefined),
```

That stub is already sufficient — the tests above reach the listener through `.mock.calls`, exactly as the existing tests do for `onStateChanged`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts`
Expected: FAIL — no notifications are recorded.

- [ ] **Step 3: Extract the attended check**

Replace `src/renderer/src/store/use-app-store.ts:151-152` with:

```ts
// Whether the user can actually see the window right now. Three things need this: unread
// markers, the Done-edge notification, and the badge.
const isWindowAttended = (): boolean => document.visibilityState !== 'hidden' && document.hasFocus()

const isViewingSession = (sessionId: string, activeSessionId: string | null): boolean =>
  sessionId === activeSessionId && isWindowAttended()
```

- [ ] **Step 4: Add the notification and badge helpers**

These go in **two different scopes**, and the split is load-bearing.

In the `create` closure, beside `noteUnreadOutput` — the actions need both of these, and neither depends on startup state:

```ts
  /**
   * Sessions the user asked to end. The window-attended check already covers the common case —
   * the window has focus at the moment Stop or Delete is clicked — but "stop it, then switch
   * away before the exit event lands" is a real race, and a toast reporting that a session the
   * user just stopped has stopped is worse than no toast.
   */
  const expectedExits = new Set<string>()

  const syncBadge = (): void => {
    const { notificationsEnabled, unreadSessionIds, locale } = get()
    const count = notificationsEnabled ? unreadSessionIds.length : 0
    window.codeflai.setUnreadBadge(count, count > 0 ? translate(locale, 'sidebar.unreadCount', { count }) : '')
  }
```

Inside `initialize()`, beside `recordUnread` — **not** in the outer closure. `snapshotLoaded` is a local of `initialize()`, and without reading it the "never notify before the snapshot loads" rule silently does nothing: `onStateChanged` can populate `appState` while the snapshot request is still in flight, so the session lookup would succeed and a toast would go out for every session in the pre-snapshot backlog.

```ts
      const notifySessionEvent = (sessionId: string, reason: 'idle' | 'exit'): void => {
        const { notificationsEnabled, appState, locale } = get()
        if (!snapshotLoaded || !notificationsEnabled || isWindowAttended()) return
        const session = appState.sessions.find((candidate) => candidate.id === sessionId)
        if (!session) return
        const project = appState.projects.find((candidate) => candidate.id === session.projectId)
        const body = translate(
          locale,
          reason === 'idle' ? 'notification.agentDone' : 'notification.sessionExited',
          { project: project?.name ?? '' }
        )
        // sessionRecordSchema.title has no upper bound but notificationIdleRequestSchema caps
        // it at 200, so an over-long title would be dropped by our own validation.
        window.codeflai.notifySessionIdle(sessionId, session.title.slice(0, 200), body)
      }
```

Import `translate` from `../i18n` if the module does not already.

- [ ] **Step 5: Call them from the existing edges**

1. Append `syncBadge()` to the end of `markViewedSessionRead` and `noteUnreadOutput` (inside the branch that actually calls `set`, after it).

2. In `initialize()`, replace the `recordUnread`-as-`onIdle` argument with a callback that does both. Define it beside `recordUnread`:

```ts
      const onAgentIdle = (sessionId: string): void => {
        recordUnread(sessionId)
        notifySessionEvent(sessionId, 'idle')
      }
```

Pass `onAgentIdle` in place of `recordUnread` at all three `noteAgentOutput(...)` call sites (~lines 604, 607, 749). The replay call at ~604 keeps working unchanged: `noteAgentOutput` only invokes `onIdle` when `replay` is false, which is what makes "a replay never notifies" true for free — do not weaken that guard.

3. In the `onTerminalExit` handler:

```ts
      const disposeExit = window.codeflai.onTerminalExit(({ sessionId }) => {
        recordUnread(sessionId)
        if (!expectedExits.delete(sessionId)) notifySessionEvent(sessionId, 'exit')
        pendingActivity.delete(sessionId)
        forgetAgentActivity(sessionId)
      })
```

4. In `stopSession` and `deleteSession`, add `expectedExits.add(sessionId)` before the `window.codeflai` call.

5. In the `onStateChanged` handler, after the state is replaced, prune stale ids and refresh the badge:

```ts
        for (const id of expectedExits) {
          if (!state.sessions.some((session) => session.id === id)) expectedExits.delete(id)
        }
        syncBadge()
```

6. After the snapshot restores `unreadSessionIds` (~line 689), call `syncBadge()` — unread survives restarts, so the badge must be drawn from the restored count rather than from zero.

7. Replace the `window.codeflai.setUnreadBadge(0, '')` line added in Task 3's `setNotificationsEnabled` with `syncBadge()`, which already returns zero when the preference is off.

- [ ] **Step 6: Subscribe to notification clicks**

In `initialize()`, beside the other subscriptions:

```ts
      const disposeActivate = window.codeflai.onNotificationActivate(({ sessionId }) => {
        // The main process has already focused the window. If the session is gone, stop there:
        // setActiveSession does not guard against unknown ids and would blank the terminal pane.
        const session = get().appState.sessions.find((candidate) => candidate.id === sessionId)
        if (!session) return
        get().setActiveSession(sessionId, session.projectId)
      })
```

Add `disposeActivate()` to the cleanup alongside `disposeData()`/`disposeExit()`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS. If an existing unread test now also observes a notification, that is correct behaviour — update the expectation, do not weaken the source.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/store/use-app-store.ts src/renderer/src/store/use-app-store.test.ts
git commit -m "feat: notify and badge when a session finishes unattended

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: End-to-end coverage of the switch

**Files:**
- Create: `e2e/notifications.spec.ts`

**Interfaces:**
- Consumes: the Settings switch from Task 3.
- Produces: nothing other code depends on.

- [ ] **Step 1: Write the spec**

Create `e2e/notifications.spec.ts`, modelled on `e2e/auto-shutdown.spec.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

/**
 * The notifications switch on its own Electron instance, because the preference persists in the
 * user-data directory and this spec restarts the app to prove it survives.
 *
 * Only the control surface is asserted. A system notification is OS chrome that Playwright
 * cannot see, and the suite replaces the notification factory with one reporting no support
 * (see buildE2ENotificationService in src/main/index.ts) precisely so a Playwright-driven
 * window — which is unattended most of the time — cannot spray real toasts across the machine
 * running the tests. The four suppression rules and the badge are covered by the store's unit
 * tests, where the clock and the focus state can both be controlled. This mirrors how
 * e2e/auto-shutdown.spec.ts splits its coverage.
 */
test('switches notifications off and keeps them off across a restart', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'codeflai-notifications-e2e-'))
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: resolve('.'),
      env: {
        ...process.env,
        CODEFLAI_E2E: '1',
        CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
        CODEFLAI_PTY_HOST_IDLE_MS: '250'
      }
    })

  let app = await launch()
  let page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  const openSettings = async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    return page.getByRole('switch', { name: 'Notify when a session finishes' })
  }
  const stored = () => page.evaluate(() => window.localStorage.getItem('codeflai.notifications'))

  try {
    // On by default, and nothing written until the user touches it.
    let toggle = await openSettings()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(await stored()).toBeNull()

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(await stored()).toBe('false')

    // `.catch()` matches e2e/auto-shutdown.spec.ts: close() waits on every process in
    // Electron's Windows job object, including the pty-host, and must never fail the test.
    await app.close().catch(() => undefined)

    app = await launch()
    page = await app.firstWindow()
    toggle = await openSettings()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(await stored()).toBe('true')

    expect(errors).toEqual([])
  } finally {
    await app.close().catch(() => undefined)
  }
})
```

The Settings trigger's accessible name is `Settings` (see `e2e/codeflai.spec.ts:181`).

- [ ] **Step 2: Run the spec**

Run: `npm run test:e2e -- notifications`

**If you are running this from a terminal inside an Electron app (Claude Code, VS Code), clear `ELECTRON_RUN_AS_NODE` first** — `env -u ELECTRON_RUN_AS_NODE npm run test:e2e -- notifications`, or `Remove-Item Env:ELECTRON_RUN_AS_NODE` in PowerShell. Otherwise every case fails with `Process failed to launch!` and nothing is actually broken. See CLAUDE.md.

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/notifications.spec.ts
git commit -m "test: cover the notifications switch end to end

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Documentation

The spec is a dated archive and is not updated; README is the living description.

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the feature in README**

Add a section after **Organizing sessions** (it is about the sidebar's unread markers, which this extends), covering: a notification fires when an agent finishes a turn or a session exits, only while the window is not in front of you; clicking it brings Codeflai forward and opens that session; the taskbar/Dock carries an unread count (a dot on Windows, the number on macOS); the switch is in Settings under General and is on by default. Match the surrounding voice — second person, no marketing.

Add one Troubleshooting entry:

```markdown
**No notifications arrive.** Check **Notify when a session finishes** in Settings, and then
your OS notification settings — Windows Focus assist and macOS Do Not Disturb both suppress
them without telling the app. Notifications are deliberately silent while the Codeflai window
is in front of you; the sidebar dot is the signal then.
```

- [ ] **Step 2: Document the constraints in CLAUDE.md**

In the renderer section, after the existing "未读活动的来源是 Done 边沿,不是字节" bullet, add a bullet covering: notifications and the badge hang off the same Done edge; the four suppression rules and why each exists; `backgroundThrottling: false` and why the Done edge forced it; the wording crossing IPC and the 200-character cap; Windows getting a dot while macOS gets the number, and why.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: describe session notifications and the unread badge

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
