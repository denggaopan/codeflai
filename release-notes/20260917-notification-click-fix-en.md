# Codeflai Release Notes — 0.26.1 / 2026-09-17

## Overview

Fixes notifications doing nothing when clicked in 0.26.0, and removes the small unread dot from the taskbar icon.

## Bug Fixes

- **Clicking a notification now actually brings Codeflai to the front.** In 0.26.0 it did nothing at all — the window stayed where it was and the session did not change. The cause: once a notification had been shown, the app was not holding on to it, so the system-level notification was reclaimed in the background and took the click with it. Nothing reported an error anywhere, which is why it simply looked like the click went nowhere. Notifications are now held until you deal with them, so clicking one from the notification centre after stepping away works too.

## Improvements

- **The unread dot on the taskbar icon is gone.** Previously 0.26.0 drew a small dot on the corner of the taskbar icon to mark unread sessions. The sidebar's bold titles and per-project unread count already say this, and the notification itself tells you as well, so the dot was one layer too many. The unread number on the macOS Dock goes with it. The **Notify when a session finishes** switch in Settings now governs notifications alone.

## Tips & Guidelines

- **Nothing about the notifications themselves has changed.** When they appear and when they stay quiet — while the window is in front of you, for sessions you stopped yourself, for output redrawn after a restart — is exactly as it was in 0.26.0.
- **If you already installed 0.26.0, just install this one over it.** Your switch setting is preserved.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
