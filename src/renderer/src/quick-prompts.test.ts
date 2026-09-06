import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QUICK_PROMPTS_STORAGE_KEY, readStoredQuickPrompts } from './quick-prompts'
import { useAppStore } from './store/use-app-store'

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  useAppStore.getState().reset()
})

describe('stored quick prompts', () => {
  it('retains user text and an empty list across store resets', () => {
    const prompt = { id: 'review', starred: true, content: '  Check changes\r\nRun tests\n' }
    expect(useAppStore.getState().setQuickPrompts([prompt])).toBe(true)
    useAppStore.getState().reset()
    expect(readStoredQuickPrompts()).toEqual([{ ...prompt, content: '  Check changes\nRun tests\n' }])
    expect(useAppStore.getState().setQuickPrompts([])).toBe(true)
    expect(readStoredQuickPrompts()).toEqual([])
  })

  it('migrates named prompts without starring them or losing their content', () => {
    window.localStorage.setItem('codefly.quickPhrases', JSON.stringify([
      { id: 'old', title: 'Old name', content: '  Keep this\r\nexact content\n' },
      { id: 'new', content: 'Already starred', starred: true }
    ]))
    expect(readStoredQuickPrompts()).toEqual([
      { id: 'old', content: '  Keep this\nexact content\n', starred: false },
      { id: 'new', content: 'Already starred', starred: true }
    ])
    expect(JSON.parse(window.localStorage.getItem(QUICK_PROMPTS_STORAGE_KEY)!)).toEqual(readStoredQuickPrompts())
    expect(useAppStore.getState().setQuickPrompts([])).toBe(true)
    expect(readStoredQuickPrompts()).toEqual([])
  })

  it('still reads legacy content if migration storage is unavailable', () => {
    window.localStorage.setItem('codefly.quickPhrases', JSON.stringify([{ id: 'old', title: 'Old', content: 'Keep this' }]))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full') })
    expect(readStoredQuickPrompts()).toEqual([{ id: 'old', content: 'Keep this', starred: false }])
  })

  it.each(['{', '{}', '[null]', '[{"id":"a","content":""}]', '[{"id":"a","content":"x","starred":"yes"}]'])(
    'recovers from malformed storage: %s', (stored) => {
      window.localStorage.setItem(QUICK_PROMPTS_STORAGE_KEY, stored)
      expect(readStoredQuickPrompts()).toEqual([])
    }
  )

  it('rejects terminal control characters and duplicate IDs without overwriting saved content', () => {
    const prompt = { id: 'review', starred: false, content: 'Check changes' }
    useAppStore.getState().setQuickPrompts([prompt])
    expect(useAppStore.getState().setQuickPrompts([{ ...prompt, content: 'a\u001b[201~\rb' }])).toBe(false)
    expect(useAppStore.getState().setQuickPrompts([prompt, prompt])).toBe(false)
    expect(readStoredQuickPrompts()).toEqual([prompt])
    expect(useAppStore.getState().quickPrompts).toEqual([prompt])
  })
})
