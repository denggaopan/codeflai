import { AGENT_LAUNCH, isAgentKind } from '../../../shared/agent-kinds'
import type { SessionKind } from '../../../shared/contracts'

/** SGR mouse report for one wheel notch (button 64 up / 65 down). Comate ignores the
 * coordinates of wheel reports, but its parser rejects a 0, so the top-left cell is sent. */
export const SGR_WHEEL_UP = '\x1b[<64;1;1M'
export const SGR_WHEEL_DOWN = '\x1b[<65;1;1M'

/** The subset of WheelEvent the translator looks at; xterm hands the raw DOM event to us. */
export type TerminalWheelEvent = Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'shiftKey'>

/** What the terminal looks like at the moment of the wheel event. */
export type TerminalWheelState = {
  /** `terminal.buffer.active.type`. */
  bufferType: 'normal' | 'alternate'
  /** `terminal.modes.mouseTrackingMode`. */
  mouseTrackingMode: string
  /** One cell's height in CSS pixels; 0 when unknown. */
  cellHeight: number
}

export type TerminalWheelAction =
  /** Let xterm handle the event as it normally would. */
  | { action: 'xterm' }
  /** Skip xterm and swallow the event: a trackpad delta still below one line. */
  | { action: 'consume' }
  /** Skip xterm and write this to the PTY instead. The caller must preventDefault the event. */
  | { action: 'send'; data: string }

const DOM_DELTA_PIXEL = 0

/**
 * Decides how a wheel event over a session's terminal is handled before xterm sees it.
 *
 * A TUI drawn in the alternate buffer has no scrollback for the wheel to move, so xterm
 * either forwards the wheel as a mouse report (when the app enabled mouse tracking) or turns
 * it into ↑/↓ keys. On Windows the first never happens: ConPTY swallows the DECSET a TUI writes
 * to enable mouse reporting, and Comate — which scrolls its transcript with the wheel, and
 * otherwise only with PageUp/PageDown — receives arrow keys that walk its prompt history
 * instead. For CLIs registered with `sgrWheelInput` this writes the SGR wheel report the app
 * asked for, exactly as xterm would have had the DECSET come through.
 *
 * One report per wheel event, matching xterm's own reporting: a mouse notch is one report,
 * while trackpad deltas accumulate (damped like xterm's) until they amount to a line. The
 * pending fraction is per terminal, hence a class rather than a pure function.
 */
export class TerminalWheelTranslator {
  private partialLines = 0

  translate(kind: SessionKind, event: TerminalWheelEvent, state: TerminalWheelState): TerminalWheelAction {
    if (!isAgentKind(kind) || AGENT_LAUNCH[kind].sgrWheelInput !== true) return { action: 'xterm' }
    // Mouse tracking reached xterm (macOS, or a ConPTY that passes it through): xterm already
    // sends these reports itself.
    if (state.mouseTrackingMode !== 'none') return { action: 'xterm' }
    // The normal buffer has scrollback of its own for the wheel to scroll.
    if (state.bufferType !== 'alternate') return { action: 'xterm' }
    // Horizontal (Shift+wheel) scrolling: xterm ignores it, and so does the TUI.
    if (event.deltaY === 0 || event.shiftKey) return { action: 'xterm' }

    if (event.deltaMode === DOM_DELTA_PIXEL && state.cellHeight > 0) {
      const isLikelyTrackpad = Math.abs(event.deltaY) < 50
      this.partialLines += (event.deltaY / state.cellHeight) * (isLikelyTrackpad ? 0.3 : 1)
      if (Math.abs(this.partialLines) < 1) return { action: 'consume' }
      this.partialLines %= 1
    }
    return { action: 'send', data: event.deltaY < 0 ? SGR_WHEEL_UP : SGR_WHEEL_DOWN }
  }
}
