# Codeflai Release Notes — 0.28.0 / 2026-09-21

## Overview

This release moves messages out of the sidebar. A copied path, a refused delete, a shutdown that would not run — each now appears as a small panel floating over the top of the window, and each closes itself after a few seconds instead of sitting in the sidebar until you dismiss it.

## What's New

### Messages float over the window

- **Why it matters:** The message used to be a strip wedged into the sidebar, between the search row and the project list. Every time one appeared it pushed the whole project list down: the row you had just clicked moved, and so did the one you were about to click. The sidebar is also the narrowest column in the app, so a message carrying a full path took three lines of it.
- **What it is:** Messages now appear in a small panel centred near the top of the window, above the interface and **taking no layout at all** — nothing moves when one appears or leaves.
- **When to use it:** Any time Codeflai has something to tell you: a project path it copied, a session delete it refused, an auto shutdown that did not go through.
- **Where to find it:** Nothing to configure; every message uses it.

### Messages close themselves

- **Why it matters:** The old strip stayed until you clicked its ×. A message from days ago could still be sitting in the sidebar, waiting to be noticed and cleared — even though most of them ("Project path copied") are finished the moment you have read them.
- **What it is:** A message **dismisses itself**: about four seconds for a confirmation, about seven for an error, since an error usually carries an instruction that takes longer to read. **Hovering pauses the countdown** and leaving restarts it, so a long path does not vanish mid-read. The × is still there for closing one early.
- **When to use it:** Most often right after copying a project path — glance at it to confirm the right path was copied, then forget about it.
- **Where to find it:** As above, automatic.

## Fixes

- **Fixed successes being shown as red errors.** "Project path copied" wore the same red border as a failed delete, which made it look like something had gone wrong. The colours now differ: confirmations use the theme's purple, only errors are red.
- **Fixed a dialog hiding the very error it raised.** The clearest case was deleting a worktree with uncommitted changes: the explanation for the refusal is raised by the delete dialog, but appeared in the sidebar behind it. Messages now float above every dialog.
- **Fixed the message background being a smudge on light themes.** It was a hard-coded dark red that only suited the dark themes; it is now mixed from the current theme's own colours.

## Notes and Guidance

- **One message at a time.** As before, a new message replaces the previous one — each is the answer to the single action you just took, so there is nothing to queue up.
- **Messages no longer need handling.** If you are in the habit of clicking × on every one, you can stop; leaving them alone now works.

## Feedback and Support

If you hit a problem after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
