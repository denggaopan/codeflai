/** The slice of BrowserWindow a second launch needs to hand the user back to the running one. */
export type FocusableWindow = {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export type SecondInstanceOptions = {
  /** Every window this process owns; destroyed ones are skipped. */
  windows(): FocusableWindow[]
  /** Opens (and wires) a main window when none is alive — macOS keeps the app running without one. */
  openWindow(): void
}

/**
 * Handles Electron's `second-instance` event: the user launched Codeflai again while it was
 * already running — a click on the shortcut after launch-at-login opened it, or a double
 * launch — and the newer process has quit in favour of this one. What they wanted was to see
 * the app, so the running window is brought to the front, restoring it first when it is
 * minimized (focus alone leaves a minimized window where it is).
 */
export const createSecondInstanceHandler = ({ windows, openWindow }: SecondInstanceOptions) => (): void => {
  const window = windows().find((candidate) => !candidate.isDestroyed())
  if (!window) {
    openWindow()
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
