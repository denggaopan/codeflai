import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import type { ThemePreference } from '../shared/contracts'
import { THEME_CHROME } from '../shared/themes'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

/** Must match the .title-bar height in styles.css so the native caption buttons the
 * titleBarOverlay draws line up exactly with the renderer's custom title-bar strip. */
export const TITLE_BAR_HEIGHT = 36

/**
 * Applies a theme to everything the renderer's CSS cannot reach: the native theme source
 * (native scrollbars/dialogs), the window background painted behind the renderer, and the
 * native caption-button overlay colors. Called at startup implicitly via the window's
 * creation defaults (dark) and afterwards from the theme:set IPC handler whenever the
 * renderer applies its persisted preference or the user switches themes in Settings.
 */
export function applyWindowTheme(window: BrowserWindow, theme: ThemePreference, platform: NodeJS.Platform = process.platform): void {
  const colors = THEME_CHROME[theme]
  // The themeSource follows the theme's base scheme, not its id: 'monokai' means nothing to
  // Chromium, but every theme but one is a dark one.
  nativeTheme.themeSource = colors.base
  window.setBackgroundColor(colors.canvas)
  if (platform === 'win32') {
    window.setTitleBarOverlay({ color: colors.titleBar, symbolColor: colors.text, height: TITLE_BAR_HEIGHT })
  }
}

/**
 * Pins (or unpins) the window above every other window. Called from the window:pinned-set
 * IPC handler when the user toggles the title bar's pin button, and once at startup when the
 * renderer replays its persisted preference. The flag is read back off the window rather than
 * echoed: a window manager that refuses to keep the window on top should leave the button
 * showing what actually happened, not what was asked for.
 */
export function applyWindowPinned(window: BrowserWindow, pinned: boolean): boolean {
  window.setAlwaysOnTop(pinned)
  return window.isAlwaysOnTop()
}

const safeDevelopmentRendererUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  try {
    const url = new URL(value)
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
    return (url.protocol === 'http:' || url.protocol === 'https:') && loopbackHosts.has(url.hostname) ? value : undefined
  } catch {
    return undefined
  }
}

export function createMainWindow(platform: NodeJS.Platform = process.platform): BrowserWindow {
  // Codeflai has no menu commands: remove the application menu entirely (also disables the
  // default Alt-key menu reveal); autoHideMenuBar is belt-and-braces for any platform path
  // that still attaches a default menu to the window.
  Menu.setApplicationMenu(null)

  // Codeflai starts dark: the renderer re-applies its persisted theme preference over the
  // theme:set IPC channel right after it loads (see use-app-store.ts initialize()), so a
  // light-theme user sees at most one dark first frame. Forcing the native theme here (not
  // 'system') keeps native scrollbars/dialogs consistent with the app theme; backgroundColor
  // keeps the first painted frame dark instead of flashing white before the renderer loads.
  nativeTheme.themeSource = 'dark'

  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: THEME_CHROME.dark.canvas,
    ...(platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: THEME_CHROME.dark.titleBar,
            symbolColor: THEME_CHROME.dark.text,
            height: TITLE_BAR_HEIGHT
          }
        }),
    // In a packaged build the window/taskbar icon comes from the exe (electron-builder
    // win.icon); build/icon.ico only exists in the repo, so it is wired up for dev runs.
    ...(app.isPackaged || platform !== 'win32' ? {} : { icon: join(currentDirectory, '../../build/icon.ico') }),
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The Done edge that drives notifications is a three-second timer in the renderer, and
      // Chromium aligns timers in a hidden renderer to roughly one minute once it has been out
      // of sight for five — which is exactly when a notification matters most. Auto shutdown is
      // unaffected: `countdownTick` computes from an absolute deadline, so it is correct either
      // way (that is why it was written that way).
      backgroundThrottling: false
    }
  })

  // Codeflai is a workspace, not a utility panel: a terminal beside a project sidebar wants all
  // the screen it can get, so the window opens maximized. The constructor width/height above
  // stay windowed-sized on purpose — they become the restore bounds when the user un-maximizes.
  window.maximize()

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const developmentUrl = app.isPackaged ? undefined : safeDevelopmentRendererUrl(process.env.ELECTRON_RENDERER_URL)
  if (developmentUrl) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }

  return window
}
