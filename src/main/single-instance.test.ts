import { describe, expect, it, vi } from 'vitest'

import { createSecondInstanceHandler, type FocusableWindow } from './single-instance'

const fakeWindow = (overrides: Partial<FocusableWindow> = {}): FocusableWindow => ({
  isDestroyed: () => false,
  isMinimized: () => false,
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  ...overrides
})

describe('createSecondInstanceHandler', () => {
  it('restores a minimized window before bringing it to the front', () => {
    const window = fakeWindow({ isMinimized: () => true })
    const openWindow = vi.fn()
    const handler = createSecondInstanceHandler({ windows: () => [window], openWindow })

    handler()

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('brings a visible window to the front without restoring it', () => {
    const window = fakeWindow()
    const openWindow = vi.fn()
    const handler = createSecondInstanceHandler({ windows: () => [window], openWindow })

    handler()

    expect(window.restore).not.toHaveBeenCalled()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('opens a window when none is alive, as macOS leaves the app running without one', () => {
    const destroyed = fakeWindow({ isDestroyed: () => true })
    const openWindow = vi.fn()
    const handler = createSecondInstanceHandler({ windows: () => [destroyed], openWindow })

    handler()

    expect(openWindow).toHaveBeenCalledOnce()
    expect(destroyed.show).not.toHaveBeenCalled()
    expect(destroyed.focus).not.toHaveBeenCalled()
  })

  it('skips destroyed windows in favour of a live one', () => {
    const destroyed = fakeWindow({ isDestroyed: () => true })
    const live = fakeWindow()
    const openWindow = vi.fn()
    const handler = createSecondInstanceHandler({ windows: () => [destroyed, live], openWindow })

    handler()

    expect(live.focus).toHaveBeenCalledOnce()
    expect(destroyed.focus).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })
})
