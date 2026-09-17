# Codeflai Release Notes — 0.26.0 / 2026-09-17

## Overview

Codeflai now raises a system notification when a session finishes, and carries an unread marker on the taskbar and the Dock — so you no longer have to keep the window in sight.

## New Features

- **Why it matters:** Once you switch away or minimize the window, there is no way to tell when an agent has finished. The bold titles and unread count in the sidebar only help while you can see the window, so waiting on a long task usually meant switching back every few minutes to check.
- **What it is:** When an agent finishes a turn, or a session exits on its own, a system notification appears — the session's name as the title, its project as the body. The taskbar on Windows and the Dock on macOS carry an unread marker at the same time. Clicking the notification brings Codeflai to the front and opens that session.
- **When to use it:** Any time you hand a task over and go do something else — writing, a meeting, or just minimizing the window while a long build runs.
- **Where to find it:** Settings → General → "Notify when a session finishes". On by default.

## Tips & Guidelines

- **Nothing pops up while the window is in front of you.** The sidebar's bold title is already telling you, and a notification on top of it would only be noise.
- **Stopping or deleting a session yourself does not notify you.** You pressed the button; you do not need to be told about it.
- **Restarting or reconnecting never replays old notifications.** The output redrawn at startup is history, not news.
- **Windows shows a dot, macOS shows the number.** The Windows taskbar overlay takes only an image and cannot draw digits, and the sidebar already breaks the count down per project — so the taskbar only answers whether there is anything at all. The macOS Dock takes text natively, so it shows the total.
- **A notification the operating system blocks fails silently.** Windows Focus assist and macOS Do Not Disturb both suppress notifications without telling the app. If none arrive, check that Codeflai is allowed to notify you in your system settings.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
