# Codeflai Release Notes — 0.23.1 / 2026-09-10

## Overview

This release gets two things right: putting a session away now actually stops it instead of just hiding it, and the unread marker only lights up when an agent has genuinely finished a turn. Sessions can also be dragged into whatever order suits you.

## What's New

### Stop a session

- **Why it matters:** Until now the only option was to *archive* a session. Archiving merely hid it from the default list — its agent kept running, kept writing to the worktree, and kept its all-permissions-granted mode. You couldn't see it, but it was still working.
- **What it is:** The session menu's Archive entry is now **Stop**. Stopping really ends that session's process and records it as stopped. Nothing on disk is touched: the worktree stays, the branch is never deleted, and the session stays in the list. Click the row to bring it back — it picks up the same conversation where it left off.
- **When to use it:** When a task is done for now and you want the machine to go quiet. The difference from Delete: a stopped session can always be restored and continued, while deleting is permanent.
- **Where to find it:** The options button on a session row → **Stop**. Because it interrupts whatever turn the agent is running, it always asks for confirmation. Only running or still-starting sessions offer it.

### Drag sessions into order

- **Why it matters:** Sessions were locked to the order they were created in, so once a project had seven or eight of them, the one you wanted was always somewhere in the middle.
- **What it is:** Drag a session row to reorder it. The order saves immediately and is still there when you reopen the window. Stopping or restoring a session never rearranges it.
- **When to use it:** Pull the sessions you're actively working on to the top, or group related ones together.
- **Where to find it:** Press and drag a session row up or down. A session can't be dragged into a different project (its worktree lives in the one it belongs to), and dragging is turned off while a search or status filter is active, since a filtered list isn't the full order.

## Improvements

- **Sharper notifications:** The unread marker (a bold title) now appears only when an agent **finishes a turn** — three quiet seconds with no pending background agent. Previously any terminal output at all counted as unread, and since an agent's spinner and elapsed-time counter refresh constantly, the marker effectively meant "this is still running" — burying the one moment actually worth your attention. Command-line sessions don't refresh themselves, so any output from those still counts as unread, and a session exiting always notifies.
- **Easier-to-scan menu:** The session options menu now leads Rename, Stop, and Delete with icons, matching the project menu, so the item you want is easier to spot at a glance.
- **Simpler filtering:** The visibility filter (Active / Archived / All sessions) is gone. Stopping a session records it as stopped, so the status filter's **Stopped** entry already shows you everything you've put away — the two filters were asking the same question.

## Tips & Guidelines

- **What happens to sessions you archived before:** After updating they appear in the session list as normal (no longer hidden), with their status unchanged. If one of them is still running and you'd rather it wasn't, use the new Stop to end it.
- **A restored session starts with a clean screen:** Stopping really ends the process, so restoring gives you a fresh terminal — the output from before the stop does not come back, though the conversation itself continues. If you want to keep what's on screen, just switch to another session instead of stopping it.
- **Quitting Codeflai still doesn't interrupt sessions:** Unchanged in this release. Closing the window, a crash, or an in-place upgrade all leave running sessions alone, and the next launch reconnects to them. Only stopping a session yourself, deleting it, removing its project from the list, or restarting the machine actually ends one. Stopped sessions are never started back up automatically on launch.

## Feedback & Support

If you hit a problem after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
