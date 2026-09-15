# Codeflai Release Notes — 0.25.0 / 2026-09-15

## Overview

The project menu gains **Copy project path**, which puts the project's full directory path on the clipboard in one click — no more reading it off the sidebar and typing it out again.

## New Features

- **Added "Copy project path".** Open a project's ⋯ menu and it sits directly under "Open project folder". One click puts the project's full directory path (for example `E:\projects\app`) on the system clipboard, ready to paste into another terminal's `cd`, into a file dialog's address bar, or into a message to a colleague.
- **A successful copy says so.** The clipboard gives no feedback of its own, so copying raises a notice at the top of the sidebar spelling out the path that was copied — it confirms the copy worked, and lets you check the path before you paste it anywhere. The notice stays until you dismiss it with ×.

## Tips & Guidelines

- It copies the **project directory** — the folder you picked when adding the project — not a session's worktree directory.
- The path comes from what the main process has on record: if you originally picked a link or a short-name path, what lands on the clipboard is the real directory it resolves to.
- The project menu now has six entries (when the repository has a remote): New session / Open project in VS Code / Open project folder / Copy project path / Open Git repository / Remove from list.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
