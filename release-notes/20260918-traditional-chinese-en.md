# Codeflai Release Notes — 0.27.0 / 2026-09-18

## Overview

The interface is now available in Traditional Chinese, and the Language setting has become a dropdown.

## New Features

- **Why it matters:** The interface came in English and Simplified Chinese only. Readers of Traditional Chinese had to make do with Simplified — and with wording that reads like a character-by-character conversion rather than the vocabulary a Traditional Chinese interface actually uses.
- **What it is:** **繁體中文** (Traditional Chinese), covering every string in the app: Settings, the sidebar, the New session menu, quick prompts, the update and shutdown dialogs, and system notifications. It is a translation in its own right, written to Taiwan conventions rather than converted from the Simplified dictionary.
- **When to use it:** Any time you would rather read the app in Traditional Chinese.
- **Where to find it:** Settings → General → **Language** → **繁體中文**.

## Improvements

- **Language is now a dropdown.** Three languages side by side no longer fit on one row, so the setting matches the Theme dropdown above it. **Every entry is still written in its own language** (English / 简体中文 / 繁體中文), so if you land in one you cannot read, yours is still recognizable in the list and one selection away.

## Tips & Guidelines

- **The setting covers the interface only.** Hints about locating a command-line tool, errors reported by a session, and **session titles that were already generated** stay in the language they were produced in. Switching does not rewrite them.
- **English remains the default** rather than following your OS language. Your choice is remembered across restarts.
- **Upgrading does not change the language you are on.** Simplified Chinese stays Simplified Chinese; English stays English.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
