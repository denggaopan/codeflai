# Codeflai Release Notes — 0.26.2 / 2026-09-18

## Overview

When a session finishes, the Codeflai icon on your taskbar now lights up alongside the notification — the same way it does for any other app with something new.

## New Features

- **Why it matters:** A notification disappears after a few seconds. If you happened to be looking away during those seconds, that turn is simply missed, and you are back to remembering to check the window yourself.
- **What it is:** At the same moment the notification appears, the taskbar button on Windows enters the system's "wants attention" state — the icon is highlighted and the line underneath it grows and changes colour — and on macOS the Dock icon bounces. The operating system draws this, so it looks exactly like it does for every other app.
- **When to use it:** Hand a task over, go do something else, and a glance at the taskbar tells you whether it has finished. No need to switch windows to check.
- **Where to find it:** Nothing new to configure. It follows the same **Notify when a session finishes** switch under **General** in Settings — if a notification would appear, the icon lights up.

## Tips & Guidelines

- **One look at the window clears it.** There is nothing to dismiss and it will not sit there nagging you — the moment you switch to Codeflai, the system puts the icon back to normal.
- **The notification rules themselves are unchanged.** When one appears and when it stays quiet — while the window is in front of you, for sessions you stopped yourself, for output redrawn after a restart — is exactly as before.
- **This is not the dot from 0.26.0.** That was an image painted onto the corner of the icon that had to be cleared by the app, and it was removed in 0.26.1. This uses the platform's own way of asking for your attention.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
