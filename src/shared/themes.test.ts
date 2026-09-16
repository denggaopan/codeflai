import { describe, expect, it } from 'vitest'

import { themePreferenceSchema } from './contracts'
import { THEME_CHROME, THEME_PREFERENCES } from './themes'

describe('theme table', () => {
  // The wire format is hand-written in contracts.ts and the menu order is hand-written here,
  // exactly like sessionKindSchema and AGENT_KINDS. This is what keeps the duplication honest.
  it('lists the same themes as the contract schema', () => {
    expect([...THEME_PREFERENCES].sort()).toEqual([...themePreferenceSchema.options].sort())
    expect(Object.keys(THEME_CHROME).sort()).toEqual([...themePreferenceSchema.options].sort())
  })

  it('keeps the original two themes first, then the editor ports', () => {
    expect(THEME_PREFERENCES).toEqual(['dark', 'light', 'vs-dark', 'abyss', 'monokai'])
  })

  // `base` is what reaches Electron's nativeTheme and the CSS color-scheme of native select
  // popups, neither of which understands a theme id: only `light` is a light theme.
  it('marks every theme but light as dark', () => {
    for (const theme of THEME_PREFERENCES) {
      expect(THEME_CHROME[theme].base).toBe(theme === 'light' ? 'light' : 'dark')
    }
  })

  it('gives every theme opaque hex chrome colors and a translucent selection fill', () => {
    for (const theme of THEME_PREFERENCES) {
      const chrome = THEME_CHROME[theme]
      expect(chrome.canvas).toMatch(/^#[0-9a-f]{6}$/)
      expect(chrome.titleBar).toMatch(/^#[0-9a-f]{6}$/)
      expect(chrome.text).toMatch(/^#[0-9a-f]{6}$/)
      expect(chrome.selection).toMatch(/^rgba\(/)
    }
  })
})
