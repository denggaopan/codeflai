import { describe, expect, it, vi } from 'vitest'

import { AGENT_KINDS } from '../../../shared/agent-kinds'
import { insertQuickPrompt } from './insert-quick-prompt'
import { AGENT_NEWLINE_SEQUENCE } from './terminal-key-bindings'

const terminal = (bracketedPasteMode: boolean) => ({
  modes: { bracketedPasteMode }, paste: vi.fn(), input: vi.fn(), focus: vi.fn()
})

describe('insertQuickPrompt', () => {
  it('uses bracketed paste for multiline text, without adding a submit key', () => {
    const target = terminal(true)
    expect(insertQuickPrompt(target, 'claude', 'Review\r\n\tRun tests\n')).toBe(true)
    expect(target.paste).toHaveBeenCalledExactlyOnceWith('Review\n\tRun tests\n')
    expect(target.input).not.toHaveBeenCalled()
    expect(target.focus).toHaveBeenCalledOnce()
  })

  it.each(AGENT_KINDS)('uses the existing Shift+Enter encoding for %s without bracketed paste', (kind) => {
    const target = terminal(false)
    expect(insertQuickPrompt(target, kind, 'Review\r\n\tRun tests')).toBe(true)
    expect(target.paste.mock.calls).toEqual([['Review'], ['    Run tests']])
    expect(target.input).toHaveBeenCalledExactlyOnceWith(AGENT_NEWLINE_SEQUENCE, true)
  })

  it.each(['shell', 'powershell', 'cmd'] as const)('rejects multiline %s input when newlines could execute commands', (kind) => {
    const target = terminal(false)
    expect(insertQuickPrompt(target, kind, 'first\nsecond')).toBe(false)
    expect(target.paste).not.toHaveBeenCalled()
    expect(target.input).not.toHaveBeenCalled()
    expect(target.focus).not.toHaveBeenCalled()
    expect(insertQuickPrompt(target, kind, 'git status')).toBe(true)
    expect(target.paste).toHaveBeenCalledExactlyOnceWith('git status')
  })
})
