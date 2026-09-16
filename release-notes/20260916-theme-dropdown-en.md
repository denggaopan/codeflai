# Codeflai Release Notes — 0.25.3 / 2026-09-16

## Overview

The theme setting is now a dropdown instead of a pair of buttons, and it offers three ports of familiar editor themes: Visual Studio Dark, Abyss, and Monokai. Picking one changes the whole window, terminals included.

## New Features

- **Three new themes.** **Visual Studio Dark** is the neutral grey of VS Code's default dark look, **Abyss** is a near-black navy, and **Monokai** is the warm olive-grey palette with its cyan, green, purple and orange. Together with the original **Dark** and **Light** that makes five.
- **The theme is chosen from a dropdown.** Five entries no longer fit on a single row of buttons, and the list is expected to keep growing. The two original looks stay first, in the order they have always been in.
- **The whole window follows, not just the interface.** The sidebar, the dialogs, the terminal background and cursor, and the native title-bar buttons all change together — never half old and half new.
- **Each theme brings its own state colors.** The running / Done / warning / destructive dots and badges use the greens, purples, yellows and reds of the palette you picked, rather than carrying the dark theme's colors over unchanged.

## Tips & Guidelines

- **Your theme is unchanged after updating.** Dark stays dark, light stays light; nothing needs to be set up again.
- **The theme is still remembered per window** and restored on the next launch, stored alongside the language and sidebar width rather than in the session state file.
- **Programs running in the terminal keep their own colors.** What changes is the terminal's background, foreground and selection; the ANSI colors in an agent's or a shell's output are still that program's business.
- All three new themes are dark ones, so window furniture drawn by the system — scrollbars, native dropdown popups — is drawn dark as well. Only **Light** switches those to the light scheme.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
