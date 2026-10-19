# Codeflai Release Notes — 0.34.0 / 2026-10-19

## Overview

The project menu has a new Issue history: what came of every automatic issue round, including the ones whose session was cleaned up on its own.

## What's New

- **Why it matters:** When issues are resolved automatically, a round that finds nothing to do deletes its session, and a round that fails to start never leaves one. After an unattended night, the sidebar could not tell you how many rounds ran, how many came up empty, or why one never started.
- **What it is:** A list of the project's automatic rounds, newest first: when each started, which agent ran it, and how it ended — the issue it claimed (for example "issue#42 Fix login crash"), no issue to work on so the session was deleted, kept because its worktree has changes, failed to start and why, or ended without reporting a result. While it is open, new results appear in the list as they happen.
- **When to use it:** Back at your desk in the morning, to see which issues were picked up overnight and how many rounds came up empty — or when a project never seems to get a new session, to check whether every round is failing to start.
- **Where to find it:** Click "⋯" on the project row → "Issue history".

## Tips & Guidelines

- **Only rounds from this version on are listed**; rounds that ran before the update do not appear.
- **The last 50 rounds per project are kept**; older ones drop off.
- The entry is **always available**: even after a project loses its remote or its agent is switched off in Settings, its earlier rounds stay readable.
- The bypass warning on Qwen Code sessions is accurate for current Qwen Code: it now honours the full-access option Codeflai passes. Older versions may still ignore it, in which case the warning is more cautious than the CLI's real behaviour.

## Feedback & Support

If something goes wrong after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
