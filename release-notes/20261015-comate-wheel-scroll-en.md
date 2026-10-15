# Codeflai Release Notes — 0.33.0 / 2026-10-15

## Overview

Comate sessions now scroll their transcript with the mouse wheel — no more paging through it with PageUp / PageDown.

## What's New

- **Why it matters:** On Windows, turning the mouse wheel in a Comate session did not scroll back through the conversation; instead it replaced what was in the input box with earlier messages from its history. Looking back meant PageUp / PageDown / Home / End.
- **What it is:** Turning the wheel in a Comate session now scrolls the transcript, three lines per notch, with Comate's "N lines above · M lines below" hint at the bottom; scrolling all the way down returns to the latest output. Whatever you are typing in the input box is left alone, and trackpad swipes scroll smoothly too.
- **When to use it:** After Comate finishes a long task, wheel back up to see what it did along the way and which files it touched, just as you would scroll a web page.
- **Where to find it:** Nothing to set up — turn the mouse wheel over a Comate session's terminal.

## Tips & Guidelines

- **Only Comate sessions are affected.** The wheel behaves exactly as before in Claude Code, Codex, the other agents, and PowerShell / CMD / Shell sessions.
- **PageUp / PageDown / Home / End still work**, for jumping a whole page at a time or straight to the top or bottom.
- If you set `ZULU_TUI_MOUSE=0` to turn off Comate's mouse support, the wheel still scrolls the transcript on Windows.

## Feedback & Support

If something goes wrong after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
