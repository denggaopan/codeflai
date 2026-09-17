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
