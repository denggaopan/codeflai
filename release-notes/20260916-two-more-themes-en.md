# Codeflai Release Notes — 0.25.4 / 2026-09-16

## Overview

Two more entries in the theme dropdown: Solarized Dark and Tomorrow Night Blue. With the three added in 0.25.3 that makes seven.

## New Features

- **Solarized Dark.** Ethan Schoonover's classic teal-dark ground under low-saturation text, with its blue as the accent and its green, yellow, violet and red doing the state colors.
- **Tomorrow Night Blue.** Deep navy under plain white text, with that palette's own pastels — pale green, purple, orange and pink — for the status colors.
- Both sit in the same dropdown, after the five that were already there, and are switched the same way.

## Tips & Guidelines

- **Solarized's surface levels were shifted by one.** The palette defines two dark grounds where Codeflai wants four, and taking them literally left the project path in the sidebar at a 4.1:1 contrast ratio — too faint to read comfortably. Putting base03 on the panels and taking the canvas a step deeper brings body text and paths back to 5.6 and 4.8, without lightening any of the palette's own colors.
- **Tomorrow Night Blue's delete button carries dark text.** That palette's red is a pale pink, and white on it is all but invisible, so the "Delete session" button uses the theme's own navy for its label instead.
- **Your theme is unchanged after updating** — whichever one you picked is still the one you get.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
