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
