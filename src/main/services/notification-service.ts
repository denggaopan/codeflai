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
 */
export type NotificationSurface = {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * How many shown notifications stay referenced.
 *
 * Electron collects a `Notification` whose JS object nothing holds any more, and the native
 * toast silently loses its click handler along with it: clicking it then does nothing at all,
 * with no error raised anywhere (electron/electron#18746). Keeping a reference is what holds
 * the click path open, and nothing else in this service does.
 *
 * Releasing on the `close` event would be wrong twice over. Electron's own docs say `close` is
 * not guaranteed to fire; and on Windows it fires when the toast times out, while the
 * notification stays in the Action Center and is still clickable from there — so releasing
 * then would break exactly the case the user is most likely to hit after stepping away. The
 * set is bounded by count instead: the oldest entry is dropped once this many are outstanding,
 * trading the clickability of very old notifications for a hard ceiling on memory.
 */
export const MAX_RETAINED_NOTIFICATIONS = 100

/**
 * Raises OS notifications and brings the window forward when one is clicked.
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
  // Oldest first. See MAX_RETAINED_NOTIFICATIONS for why these are held at all.
  private readonly retained: PlatformNotification[] = []

  constructor(
    private readonly surface: NotificationSurface,
    private readonly factory: NotificationFactory
  ) {}

  notify(notification: SessionNotification): void {
    try {
      if (!this.factory.isSupported()) return
      const toast = this.factory.create(notification.title, notification.body)
      this.retained.push(toast)
      if (this.retained.length > MAX_RETAINED_NOTIFICATIONS) this.retained.shift()
      toast.onClick(() => {
        try {
          this.focusWindow()
          for (const listener of this.activateListeners) listener(notification.sessionId)
        } catch (error) {
          console.error('NotificationService: failed to handle notification activation.', error)
        }
      })
      toast.show()
    } catch (error) {
      console.error('NotificationService: failed to raise a notification.', error)
    }
  }


  /** How many shown notifications are still referenced. Exposed so the bound stays testable. */
  get retainedCount(): number {
    return this.retained.length
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
