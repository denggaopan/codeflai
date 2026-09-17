import { describe, expect, it, vi } from 'vitest'

import {
  MAX_RETAINED_NOTIFICATIONS,
  NotificationService,
  type NotificationFactory,
  type NotificationSurface,
  type PlatformNotification
} from './notification-service'

class FakeSurface implements NotificationSurface {
  readonly calls: string[] = []
  minimized = false

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

const build = () => {
  const surface = new FakeSurface()
  const factory = new FakeFactory()
  return { surface, factory, service: new NotificationService(surface, factory) }
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




  it('never throws when the platform refuses a notification', () => {
    const { factory, service } = build()
    factory.throwOnCreate = true
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })).not.toThrow()

    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('never throws when the surface fails during click handling', () => {
    const { surface, factory, service } = build()
    surface.minimized = true
    surface.restore = () => {
      throw new Error('window destroyed')
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })
    expect(() => factory.created[0]?.notification.click()).not.toThrow()

    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('never throws when a listener fails during click handling', () => {
    const { factory, service } = build()
    service.onActivate(() => {
      throw new Error('listener crashed')
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })
    expect(() => factory.created[0]?.notification.click()).not.toThrow()

    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
  // These lock the bound, not the garbage-collection behaviour itself — a fake is never
  // collected, so no unit test can prove the real fix. What they do prove is that a shown
  // notification is referenced at all, which is the property the click path depends on.
  it('keeps a reference to every notification it shows', () => {
    const { service } = build()

    service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })

    expect(service.retainedCount).toBe(1)
  })

  it('retains nothing where the platform has no notifications', () => {
    const { factory, service } = build()
    factory.supported = false

    service.notify({ sessionId: 's1', title: 'Add the parser', body: 'codeflai · Done' })

    expect(service.retainedCount).toBe(0)
  })

  it('drops the oldest reference once the bound is reached, keeping recent ones clickable', () => {
    const { factory, service } = build()
    const activated: string[] = []
    service.onActivate((sessionId) => activated.push(sessionId))

    for (let index = 0; index <= MAX_RETAINED_NOTIFICATIONS; index++) {
      service.notify({ sessionId: `s${index}`, title: 'Add the parser', body: 'codeflai · Done' })
    }

    expect(service.retainedCount).toBe(MAX_RETAINED_NOTIFICATIONS)
    factory.created.at(-1)!.notification.click()
    expect(activated).toEqual([`s${MAX_RETAINED_NOTIFICATIONS}`])
  })
})
