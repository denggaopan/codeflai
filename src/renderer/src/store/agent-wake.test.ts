import { describe, expect, it } from 'vitest'
import { AgentWakeTracker, ECHO_WINDOW_MS, WAKE_GAP_MS, WAKE_SUSTAIN_MS, classifyTerminalInput, hasVisibleText } from './agent-wake'

describe('hasVisibleText', () => {
  it('ignores cursor, erase and title sequences', () => {
    expect(hasVisibleText('\u001b[?25l\u001b[2K\u001b[3;1H\u001b[?25h')).toBe(false)
    expect(hasVisibleText('\u001b]0;✳ Claude Code\u0007\r\n')).toBe(false)
    expect(hasVisibleText('\u001b]9;4;0;\u001b\\')).toBe(false)
  })

  it('sees characters drawn between sequences', () => {
    expect(hasVisibleText('\u001b[38;5;174m✳\u001b[0m Thinking')).toBe(true)
  })
})

describe('classifyTerminalInput', () => {
  it('reads Enter as a submit, alone or after typed text', () => {
    expect(classifyTerminalInput('\r')).toBe('submit')
    expect(classifyTerminalInput('fix it\r')).toBe('submit')
  })

  it('does not read a pasted newline or Shift+Enter as a submit', () => {
    expect(classifyTerminalInput('\u001b[200~a\rb\u001b[201~')).toBe('typing')
    expect(classifyTerminalInput('\u001b\r')).toBe('control')
    // Run twice: a global regex keeps lastIndex between calls if it is not reset.
    expect(classifyTerminalInput('\u001b[200~a\rb\u001b[201~')).toBe('typing')
  })

  it('treats focus reports and arrow keys as control traffic', () => {
    expect(classifyTerminalInput('\u001b[I')).toBe('control')
    expect(classifyTerminalInput('\u001b[O')).toBe('control')
    expect(classifyTerminalInput('\u001b[A')).toBe('control')
  })

  it('treats printable keys and Ctrl+C as typing', () => {
    expect(classifyTerminalInput('a')).toBe('typing')
    expect(classifyTerminalInput('\u0003')).toBe('typing')
  })
})

describe('AgentWakeTracker', () => {
  it('wakes only once visible output has kept coming for the sustain window', () => {
    const tracker = new AgentWakeTracker()
    expect(tracker.wakes('s', 'a', 0)).toBe(false)
    expect(tracker.wakes('s', 'b', WAKE_GAP_MS)).toBe(false)
    expect(tracker.wakes('s', 'c', WAKE_SUSTAIN_MS - 1)).toBe(false)
    expect(tracker.wakes('s', 'd', WAKE_SUSTAIN_MS)).toBe(true)
  })

  it('restarts the streak after a pause longer than the gap', () => {
    const tracker = new AgentWakeTracker()
    tracker.wakes('s', 'a', 0)
    tracker.wakes('s', 'b', WAKE_GAP_MS + 1)
    expect(tracker.wakes('s', 'c', WAKE_GAP_MS + WAKE_SUSTAIN_MS)).toBe(false)
  })

  it('ignores echo arriving right after a keystroke', () => {
    const tracker = new AgentWakeTracker()
    tracker.noteTyping('s', 0)
    expect(tracker.wakes('s', 'x', ECHO_WINDOW_MS - 1)).toBe(false)
    tracker.noteTyping('s', WAKE_SUSTAIN_MS)
    expect(tracker.wakes('s', 'y', WAKE_SUSTAIN_MS + 1)).toBe(false)
  })
})
