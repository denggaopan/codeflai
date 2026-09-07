import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readStoredQuickPrompts } from './quick-prompts'
import { useAppStore } from './store/use-app-store'

let dispose: (() => void) | undefined
beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  useAppStore.getState().reset()
  window.codeflai = {
    setTheme: async () => undefined,
    setWindowPinned: async (value: boolean) => value,
    getSnapshot: async () => ({ platform: 'win32', state: { version: 1, projects: [], sessions: [] }, capabilities: {} }),
    saveWorkspace: async () => undefined,
    onStateChanged: () => () => undefined,
    onTerminalData: () => () => undefined,
    onTerminalExit: () => () => undefined,
    onUpdateProgress: () => () => undefined
  } as unknown as typeof window.codeflai
})
afterEach(() => { dispose?.(); dispose = undefined; vi.restoreAllMocks() })

const initialize = async () => {
  dispose = useAppStore.getState().initialize()
  await Promise.resolve()
}

describe('CodeFly preference migration', () => {
  it('loads all legacy preferences and writes the new namespace', async () => {
    const values = {
      theme: 'light', locale: 'zh-CN', windowPinned: 'true', sidebarWidth: '420',
      showQuickPrompts: 'true', sessionKinds: JSON.stringify({ comate: { enabled: true, worktree: false } }),
      quickPrompts: JSON.stringify([{ id: 'saved', starred: true, content: 'Keep this prompt' }])
    }
    for (const [key, value] of Object.entries(values)) window.localStorage.setItem(`codefly.${key}`, value)
    await initialize()
    const state = useAppStore.getState()
    expect(state.theme).toBe('light')
    expect(state.locale).toBe('zh-CN')
    expect(state.windowPinned).toBe(true)
    expect(state.sidebarWidth).toBe(420)
    expect(state.showQuickPrompts).toBe(true)
    expect(state.sessionKindPreferences.comate).toEqual({ enabled: true, worktree: false })
    expect(state.quickPrompts).toEqual([{ id: 'saved', starred: true, content: 'Keep this prompt' }])
    for (const [key, value] of Object.entries(values)) {
      expect(window.localStorage.getItem(`codeflai.${key}`)).toBe(value)
      expect(window.localStorage.getItem(`codefly.${key}`)).toBe(value)
    }
  })

  it('keeps new false and empty values instead of resurrecting old preferences', async () => {
    window.localStorage.setItem('codefly.windowPinned', 'true')
    window.localStorage.setItem('codeflai.windowPinned', 'false')
    window.localStorage.setItem('codefly.quickPrompts', '[{"id":"old","content":"Old"}]')
    window.localStorage.setItem('codeflai.quickPrompts', '[]')
    await initialize()
    expect(useAppStore.getState().windowPinned).toBe(false)
    expect(readStoredQuickPrompts()).toEqual([])
  })

  it('imports the earlier quickPhrases keys and normalizes the saved prompts', async () => {
    window.localStorage.setItem('codefly.quickPhrases', '[{"id":"old","title":"Old title","content":"Keep me"}]')
    window.localStorage.setItem('codefly.showQuickPhrases', 'true')
    await initialize()
    expect(useAppStore.getState().showQuickPrompts).toBe(true)
    expect(readStoredQuickPrompts()).toEqual([{ id: 'old', starred: false, content: 'Keep me' }])
  })

  it('still reads old settings when writing migrated keys fails', async () => {
    window.localStorage.setItem('codefly.theme', 'light')
    window.localStorage.setItem('codefly.quickPrompts', '[{"id":"saved","content":"Keep me"}]')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disk full') })
    await initialize()
    expect(useAppStore.getState().theme).toBe('light')
    expect(readStoredQuickPrompts()).toEqual([{ id: 'saved', starred: false, content: 'Keep me' }])
  })
})
