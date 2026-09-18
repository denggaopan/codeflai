import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZES,
  isTerminalFontSize,
  parseStoredTerminalFontSize
} from './terminal-font'

describe('terminal font size', () => {
  it('defaults to xterm\'s own font size, so an existing install renders identically', () => {
    // xterm's built-in default is 15. Matching it means adding this preference changes nothing
    // for anyone who never touches it.
    expect(DEFAULT_TERMINAL_FONT_SIZE).toBe(15)
    expect(TERMINAL_FONT_SIZES).toContain(DEFAULT_TERMINAL_FONT_SIZE)
  })

  it('offers the sizes in ascending order', () => {
    // The table is rendered straight into a <select>, so its order is the menu's order.
    expect([...TERMINAL_FONT_SIZES]).toEqual([...TERMINAL_FONT_SIZES].sort((a, b) => a - b))
  })

  it('accepts only the sizes in the table', () => {
    for (const size of TERMINAL_FONT_SIZES) expect(isTerminalFontSize(size)).toBe(true)
    // 17 sits between two offered sizes and 100 is past the end: neither is selectable, and
    // letting one through would leave the <select> showing a blank value.
    expect(isTerminalFontSize(17)).toBe(false)
    expect(isTerminalFontSize(100)).toBe(false)
    // A degenerate size makes fitAddon propose degenerate cols/rows, so these matter most.
    expect(isTerminalFontSize(0)).toBe(false)
    expect(isTerminalFontSize(-15)).toBe(false)
    expect(isTerminalFontSize(Number.NaN)).toBe(false)
    expect(isTerminalFontSize(15.5)).toBe(false)
  })

  it('falls back to the default for anything it cannot read', () => {
    expect(parseStoredTerminalFontSize(null)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(parseStoredTerminalFontSize('')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(parseStoredTerminalFontSize('   ')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(parseStoredTerminalFontSize('large')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    // Off-grid values degrade rather than being clamped to a neighbour: a hand-edited or
    // future-format value is not a size this build can put in its menu.
    expect(parseStoredTerminalFontSize('17')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(parseStoredTerminalFontSize('0')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(parseStoredTerminalFontSize('-15')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
  })

  it('reads back every size it can write', () => {
    for (const size of TERMINAL_FONT_SIZES) {
      expect(parseStoredTerminalFontSize(String(size))).toBe(size)
    }
  })
})
