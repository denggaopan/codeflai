# Codeflai Release Notes — 0.23.2 / 2026-09-10

## Overview

This release is all about Settings: what used to be one long single column is now two panes, with a menu on the left that jumps straight to the setting you are after.

## What's New

### A section menu in Settings

- **Why it matters:** Settings had collected a lot — launch at startup, theme, language, session kinds, version and updates, About — all stacked top to bottom in one narrow window. Changing any one of them meant scrolling past all the others, and expanding the five opt-in agent CLIs under Session kinds pushed everything below it well out of sight.
- **What it is:** The Settings window now has two panes. On the left are four sections — **General**, **Session kinds**, **Updates**, **About Codeflai** — and clicking one scrolls the right pane to it. It works the other way round too: whichever section you scroll to lights up in the menu, so the two never disagree. The window itself is also close to twice as wide as before.
- **When to use it:** Any time you want to change one particular setting without hunting for it.
- **Where to find it:** The gear button at the bottom of the sidebar, then pick a section on the left.

## Improvements

- **Preferences kept together:** Theme and language now sit with launch at startup and the quick prompt bar under General, so the four everyday preferences are on one screen instead of at opposite ends of the window.
- **A wider window:** Each row has more room between its label and its switch, and the session-kind switch table is no longer cramped.
- **Scrollbar follows the theme:** The scrollbar in Settings used to be the pale system default, which glared against the dark theme. It now matches the surrounding panel, sits as a quiet empty gutter most of the time, and only shows its handle while the pointer is over the window.
- **A calmer gear button:** Hovering the Settings button in the sidebar used to light up a purple ring, which made a harmless button look like it was about to do something irreversible. It now just lifts slightly.

## Tips & Guidelines

- **The menu jumps, it does not page:** The right side is still one continuous page — the menu only scrolls you there. Pick the wrong section and you can simply keep scrolling to what you wanted; nothing is hidden behind a menu entry.
- **Every visit starts the same way:** Reopening Settings always returns the menu to General and keeps "More agent CLIs" collapsed, exactly as before.
- **The settings themselves are unchanged:** Only their arrangement and appearance moved. Every switch means what it did before, with the same defaults and your saved choices intact.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
