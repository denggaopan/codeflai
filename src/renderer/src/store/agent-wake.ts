/**
 * Deciding when a Done agent session has really started working again.
 *
 * Entering Done is "three seconds without output", but an idle agent TUI is not silent: focus
 * reports make it repaint the prompt, Claude rewrites the window title, a status line refreshes,
 * and the prompt echoes whatever the user types. Treating every one of those bursts as "running
 * again" made the sidebar dot flicker Done -> Running -> Done, and every return to Done raised
 * the unread marker and the system notification once more. So leaving Done needs evidence of a
 * new turn: the user submitting a line, the CLI's own progress signal, or visible output that
 * keeps coming (a spinner) — never one burst.
 */

/** Visible output must keep arriving for this long before a Done session counts as running. */
export const WAKE_SUSTAIN_MS = 1_500
/** A pause longer than this ends a streak of visible output; the next chunk starts a new one. */
export const WAKE_GAP_MS = 1_000
/** Output this soon after a keystroke is the prompt echoing it, not the agent working. */
export const ECHO_WINDOW_MS = 500

// Bracketed paste first, so a newline inside pasted text is never read as Enter; then OSC/DCS
// strings, CSI, and any other two-byte escape (which also covers Shift+Enter's ESC CR).
const PASTE = /\u001b\[200~[\s\S]*?\u001b\[201~/g
const STRING_SEQUENCE = /\u001b[\]P^_X][\s\S]*?(?:\u0007|\u001b\\|$)/g
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g
const ESCAPE = /\u001b[\s\S]?/g

const stripEscapes = (data: string): string =>
  data.replace(STRING_SEQUENCE, '').replace(CSI, '').replace(ESCAPE, '')

/** Whether a chunk of PTY output draws any visible character once escape sequences are removed. */
export const hasVisibleText = (data: string): boolean => /[^\s\u0000-\u001f\u007f]/.test(stripEscapes(data))

export type TerminalInputKind = 'submit' | 'typing' | 'control'

/**
 * What a chunk of user input means for the agent: a submitted line starts a turn, typing only
 * produces echo, and pure control traffic (focus reports, Shift+Enter) means nothing at all.
 */
export const classifyTerminalInput = (data: string): TerminalInputKind => {
  const pasted = PASTE.test(data)
  PASTE.lastIndex = 0
  const rest = stripEscapes(data.replace(PASTE, ''))
  if (rest.includes('\r')) return 'submit'
  return pasted || rest.length > 0 ? 'typing' : 'control'
}

type Streak = { start: number; last: number }

/** Per-session bookkeeping for leaving Done; module-level state lives in the store. */
export class AgentWakeTracker {
  private readonly lastTyped = new Map<string, number>()
  private readonly streaks = new Map<string, Streak>()

  noteTyping(sessionId: string, now: number): void {
    this.lastTyped.set(sessionId, now)
    this.streaks.delete(sessionId)
  }

  /** Feeds one live output chunk of a Done session; true once it is evidence of a new turn. */
  wakes(sessionId: string, data: string, now: number): boolean {
    if (!hasVisibleText(data)) return false
    const typed = this.lastTyped.get(sessionId)
    if (typed !== undefined && now - typed < ECHO_WINDOW_MS) return false
    const previous = this.streaks.get(sessionId)
    const streak = previous && now - previous.last <= WAKE_GAP_MS ? { start: previous.start, last: now } : { start: now, last: now }
    this.streaks.set(sessionId, streak)
    return now - streak.start >= WAKE_SUSTAIN_MS
  }

  /** Called whenever the session enters or leaves Done, so a stale streak never carries over. */
  resetStreak(sessionId: string): void {
    this.streaks.delete(sessionId)
  }

  forget(sessionId: string): void {
    this.lastTyped.delete(sessionId)
    this.streaks.delete(sessionId)
  }

  clear(): void {
    this.lastTyped.clear()
    this.streaks.clear()
  }
}
