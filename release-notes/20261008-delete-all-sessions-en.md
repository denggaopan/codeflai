# Codeflai Release Notes — 0.30.0 / 2026-10-08

## Overview

The project menu gains **Delete all sessions**, which clears every session under a project in one go — no more opening each session's menu to delete them one at a time.

## New Features

- **Added "Delete all sessions".** Open a project's ⋯ menu and it sits directly above "Remove from list". It asks for confirmation first, naming the project and how many sessions are about to go; on confirm, the sessions are stopped and deleted one after another in the order the sidebar lists them, running ones included. The project itself stays in the list.
- **Worktrees with uncommitted changes are kept.** Every session goes through exactly the same checks as deleting it on its own: a session whose worktree still has uncommitted changes is left in place, and once the rest are gone a notice says how many were kept for that reason. Commit or discard those changes, then delete them individually.
- **Disabled while the project has no sessions.** The entry still shows, just greyed out.

## Tips & Guidelines

- "Delete all sessions" and "Remove from list" are different things: the first deletes the sessions and keeps the project; the second takes the project off the list, and its session records go with it, but nothing on disk is touched.
- Deleting a session removes its worktree directory, but **branches are never deleted** — the same as when deleting a session on its own.
- The project menu now has seven entries (when the repository has a remote): New session / Open project in VS Code / Open project folder / Copy project path / Open Git repository / Delete all sessions / Remove from list.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
