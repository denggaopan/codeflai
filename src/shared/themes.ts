import type { ThemePreference } from './contracts'

/**
 * The themes the Settings dropdown offers, in menu order: the two original looks first, then
 * the ports of familiar editor themes. Hand-kept in step with `themePreferenceSchema`
 * (contracts.ts owns the wire format); themes.test.ts asserts the two never drift apart.
 */
export const THEME_PREFERENCES = [
  'dark',
  'light',
  'vs-dark',
  'abyss',
  'monokai',
  'solarized-dark',
  'tomorrow-night-blue'
] as const satisfies readonly ThemePreference[]

/**
 * The handful of colors CSS custom properties cannot reach, one entry per theme:
 *
 * - the native window — background painted behind the renderer, plus the caption-button
 *   overlay Windows draws itself (main/window.ts);
 * - xterm's canvas, which renders outside the DOM (renderer TerminalWorkspace.tsx).
 *
 * Every value mirrors a token in styles.css (`canvas` = --color-canvas, `titleBar` =
 * --color-title-bar, `text` = --color-text, `selection` = the accent at low alpha) — the CSS
 * block and this table are the same palette written twice, so change them together.
 *
 * `base` is the native/browser color scheme a theme belongs to. Everything except `light` is
 * a dark theme, so `nativeTheme.themeSource` and the `color-scheme` of native select popups
 * follow this rather than the theme id, which is not a value either of them understands.
 */
export type ThemeChrome = {
  base: 'dark' | 'light'
  canvas: string
  titleBar: string
  text: string
  selection: string
}

export const THEME_CHROME: Record<ThemePreference, ThemeChrome> = {
  dark: {
    base: 'dark',
    canvas: '#0b0f14',
    titleBar: '#181e27',
    text: '#e7edf5',
    selection: 'rgba(148, 113, 199, 0.35)'
  },
  light: {
    base: 'light',
    canvas: '#f5f7fa',
    titleBar: '#f0f3f7',
    text: '#1c2733',
    selection: 'rgba(110, 84, 148, 0.25)'
  },
  'vs-dark': {
    base: 'dark',
    canvas: '#1e1e1e',
    titleBar: '#323233',
    text: '#d4d4d4',
    selection: 'rgba(55, 148, 255, 0.35)'
  },
  abyss: {
    base: 'dark',
    canvas: '#000c18',
    titleBar: '#051336',
    text: '#dbe3f0',
    selection: 'rgba(130, 170, 255, 0.35)'
  },
  monokai: {
    base: 'dark',
    canvas: '#272822',
    titleBar: '#33342e',
    text: '#f8f8f2',
    selection: 'rgba(102, 217, 239, 0.30)'
  },
  'solarized-dark': {
    base: 'dark',
    canvas: '#00212b',
    titleBar: '#073642',
    text: '#93a1a1',
    selection: 'rgba(38, 139, 210, 0.35)'
  },
  'tomorrow-night-blue': {
    base: 'dark',
    canvas: '#002451',
    titleBar: '#00204a',
    text: '#ffffff',
    selection: 'rgba(187, 218, 255, 0.30)'
  }
}
