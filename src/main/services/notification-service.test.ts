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
