# Codeflai Release Notes — 0.34.1 / 2026-11-02

## Overview

An idle agent session no longer flickers between Done and Running, and it no longer notifies you about the same finished turn over and over.

## Bug Fixes

- **An idle session now stays Done.** Before, a Claude or Codex session that had finished would jump back to Running for three seconds whenever you switched sessions, moved focus away from the window and back, or typed at its prompt. An idle agent is not completely quiet: a focus change makes it redraw its prompt, and typing is echoed back — and Codeflai used to read any output at all as "working again". Now a session only counts as Running again when you send it an instruction (press Enter), when the agent itself reports that it is working, or when it keeps producing output for a while (such as a progress spinner).
- **No more repeated notifications or unread markers for the same session.** Every flicker back to Done used to count as another finished turn, so a session that was just sitting idle kept becoming unread again and, while the window was in the background, kept raising system notifications. With the fix above, each finished turn notifies you once.

## Tips & Guidelines

- **The status still turns Running the moment you send an instruction**, as before.
- For agents that do not report their own progress (Gemini, GitHub Copilot, Cursor, Comate, Qwen Code), if one starts working without you pressing Enter, its status turns Running about a second and a half later.
- **Install this version over the old one**: running sessions are not interrupted and your settings are kept.

## Feedback & Support

If something goes wrong after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
