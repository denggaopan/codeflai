# Codeflai Release Notes — 0.25.1 / 2026-09-15

## Overview

Fixes the New session menu being cut off for projects near the bottom of the sidebar. Once you have enough projects for the sidebar to scroll, the menu on those bottom rows only showed its top half — the session kinds below it sat behind the settings bar, out of sight and out of reach. The menu now opens upward on its own.

## Bug Fixes

- **Fixed: the New session menu was clipped on bottom projects.** It used to open downward from every row, while having to stay inside the sidebar's project list — so the closer a project sat to the bottom, the more of the menu was lost. The more session kinds you had switched on (Gemini, Copilot and the rest, enabled in Settings), the more entries disappeared with it. The menu now looks at how much room the row has on either side, and opens upward on bottom rows so the whole menu, every entry included, stays visible.
- **Fixed: entries vanished when neither side had room.** With a short window, the extra entries were simply gone. The menu now shrinks to the height that fits and lets you scroll the rest into view inside it.
- **Fixed: the open menu no longer drifts while the project list scrolls.** It now re-picks up or down as you scroll, and if you scroll its row out of view the menu closes itself — without yanking the list back to where that row was.

## Tips & Guidelines

- With few enough projects that the sidebar doesn't scroll, the menu still opens downward — there is room below it there, and nothing has changed.
- A project's ⋯ menu has always behaved this way; this release brings the New session menu onto the same rules, so the two no longer disagree.
- Nothing changes about how you use it: click the ⋯ on the right of a project, then New session.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
