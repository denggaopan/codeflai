/**
 * The terminal's font size preference: the offered sizes and how a stored value is read back.
 *
 * Pure functions and one table, like `sidebar-width.ts` — the store owns persistence and
 * `TerminalWorkspace` owns applying it to the live xterm instances.
 *
 * Only the size is configurable, not the font family. The even-device-pixel correction in
 * `terminal/block-glyph-alignment.ts` recomputes itself on every fit, so it follows a size
 * change on its own; but its reasoning is derived from Cascadia Mono's specific fractional
 * advance width, and a different family would invalidate that analysis in a way only a human
 * looking at the agent's startup logo could detect.
 */

/** xterm's own default. Matching it means this preference changes nothing until it is touched. */
export const DEFAULT_TERMINAL_FONT_SIZE = 15

/**
 * Every size the Settings dropdown offers, ascending — the menu renders this table directly.
 *
 * Coarse on purpose, and coarser as it grows: one point matters at 10px and does not at 20px.
 * A `<select>` over a fixed table rather than a number input, for the reason the auto-shutdown
 * time dropdowns give: an input's empty and half-typed states would have to be papered over by
 * echoing the old value back, and the precision buys nothing here.
 */
export const TERMINAL_FONT_SIZES: ReadonlyArray<number> = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24]

/**
 * Whether a size is one this build can actually apply. The store gates on this before storing
 * anything: an absurd size makes `fitAddon.proposeDimensions()` hand back degenerate cols and
 * rows, and a value outside the table would leave the `<select>` rendering blank — which is a
 * UI that lies about what is in effect.
 */
export const isTerminalFontSize = (size: number): boolean => TERMINAL_FONT_SIZES.includes(size)

/**
 * Interprets the raw localStorage string. A missing key on first launch, a hand-edited value,
 * or an off-grid size from some future format all degrade to the default rather than being
 * clamped to a neighbour: a size this build cannot put in its menu is not a size it should
 * silently pretend to honour.
 */
export const parseStoredTerminalFontSize = (stored: string | null): number => {
  if (stored === null || stored.trim() === '') return DEFAULT_TERMINAL_FONT_SIZE
  const parsed = Number(stored)
  return isTerminalFontSize(parsed) ? parsed : DEFAULT_TERMINAL_FONT_SIZE
}
