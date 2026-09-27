# Codeflai Release Notes - 0.29.1 / 2026-09-27

## Overview

This patch fixes brief system Terminal windows appearing while Codex runs commands in Codeflai on Windows.

## Fix

Windows Codex sessions now start with `--no-daemon`, including when a stopped session is restored. This keeps Codex's command runner attached to the session's PTY. The permission and sandbox bypass setting is unchanged. macOS launch arguments are unchanged.

The fix was verified with Codex CLI 0.157.1. If an older CLI rejects `--no-daemon`, update Codex before starting a session with this Codeflai version.

## After Updating

Codeflai keeps running sessions in a resident PTY host through an in-place upgrade. Sessions already owned by the previous host keep their old launch settings. To use the fix, finish your work, stop all running sessions from their row menus, close Codeflai, wait at least 60 seconds for the idle host to exit, then reopen the app and restore the Codex sessions. A computer restart also starts a fresh host. Stopping a session keeps its record and worktree; Codex's `resume --last` is best effort when several Codex sessions share one directory.

## Feedback

If Terminal windows still appear after a fresh host starts, please open an issue at https://github.com/denggaopan/codeflai/issues with your Codex CLI version.
