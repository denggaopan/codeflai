# Codeflai Release Notes — 0.26.3 / 2026-09-18

## Overview

The terminal font size is now yours to set, and closing the window on macOS no longer leaves you with a stuck one when you reopen it.

## New Features

- **Why it matters:** The terminal font size was fixed. On a large display it read small enough to tire your eyes; on a laptop screen, or when you wanted more output in view at once, it was larger than you needed. Either way you lived with it.
- **What it is:** A **Terminal font size** dropdown in Settings, ten steps from 10 to 24. The choice applies the moment you make it, to every terminal you have open — no restart, no switching sessions.
- **When to use it:** Turn it up when you plug into an external monitor, down when you want a laptop screen to hold more of a long log.
- **Where to find it:** Settings → General → **Terminal font size**.

## Bug Fixes

- **macOS: reopening from the Dock after closing the window no longer hangs.** Previously, closing the Codeflai window on macOS (which leaves the app running) and then clicking its Dock icon gave you a window stuck on loading forever, with no way out but force-quitting.

## Tips & Guidelines

- **The size is configurable, the typeface is not.** The block-character artwork terminals draw — an agent's startup logo, for instance — needs pixel-level alignment derived from the exact character width of the font to come out without hairline seams. That calculation redoes itself when the size changes; a different typeface would need the whole thing worked out again, so only the size is offered here.
- **Changing the size reflows the terminal.** A different number of characters fits per line, so a full-screen interface that is running (Claude, Codex and the like) repaints itself once. That is expected.
- **Your choice is remembered** across restarts.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
