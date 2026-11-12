/**
 * Gap between a typed line and the Enter that submits it. Agent TUIs treat a burst of
 * characters as a paste: Claude Code and Codex both read an Enter that arrives inside the burst
 * as a newline in the input box rather than as "send". A pause after the text makes the Enter a
 * separate key press.
 */
export const AGENT_SUBMIT_DELAY_MS = 500

export type TypeIntoAgent = (sessionId: string, line: string) => Promise<void>

/**
 * Types `line` into a session's PTY as if at the keyboard, then presses Enter. `write` is the
 * terminal's own write (the same path the renderer's keystrokes take); a failure of either write
 * rejects. The line must already be free of control characters (larkFollowUpLine sees to it).
 */
export function createAgentTyper(
  write: (sessionId: string, data: string) => void,
  delay: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  submitDelayMs = AGENT_SUBMIT_DELAY_MS
): TypeIntoAgent {
  return async (sessionId, line) => {
    write(sessionId, line)
    await delay(submitDelayMs)
    write(sessionId, '\r')
  }
}
