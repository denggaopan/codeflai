# Quick Prompts Drag Sort

**Goal:** Continue the existing worktree and its failing moveQuickPrompt tests, adding persistent drag sorting without inserting prompt text.

**Approach:** Execute inline using the existing React, localStorage, and native drag-and-drop patterns. Keep one saved array as the ordering source for management, search, and the starred bar. Moving a prompt preserves all other prompts' relative order, contents, and stars. No dependency or storage migration is needed.

## Implementation and verification

- [x] Complete `src/renderer/src/quick-prompts.ts` against the existing tests: explicit before/after placement, immutable changes, unchanged reference for no-ops and unknown IDs.
- [x] Extend `src/renderer/src/components/QuickPrompts.test.tsx` before implementation: management handle drag, starred bar drag, keyboard movement, filtered-list restrictions, cancellation, persistence failures, and no accidental insertion.
- [x] Add a focused drag hook and connect it to `QuickPrompts.tsx`. Use a private drag type containing only a prompt ID, accept local drags within the same surface, mark insertion edges, and save only on drop. Management supports Up/Down on the focused handle, including stopped sessions. Disable management sorting while a search filter is active.
- [x] Add matching English/Chinese labels, theme-aware styles, and README instructions. Preserve current click-to-insert, editing, and starring behavior.
- [x] Run relevant Vitest tests and `npm run build` (includes typechecking). Drive real Electron drag gestures and reload through the existing quick-prompts Playwright suite; verify no terminal input, persistence, overflow, compact layout, and both themes.
- [x] Review the diff and run the full unit suite. Leave verified changes in this worktree; no commit, merge, push, release, or version change is authorized.

## Baseline

`npm test -- src/renderer/src/quick-prompts.test.ts src/renderer/src/components/QuickPrompts.test.tsx src/renderer/src/terminal/insert-quick-prompt.test.ts`: 33 passed; the two pre-existing `moveQuickPrompt` tests fail because the function is not implemented.

## Verification notes

- The six new component sorting tests failed before implementation; all passed afterwards. Four additional cancellation cases (session, view, visibility, filter) also pass.
- `npm run build` passes; `npm run typecheck` passes again after the final component test additions.
- `$env:ELECTRON_RUN_AS_NODE = $null; npx playwright test e2e/quick-prompts.spec.ts`: 2 passed. The inherited `ELECTRON_RUN_AS_NODE=1` must be cleared for Electron GUI tests in this terminal.
- Electron tests cover horizontal and vertical drag placement, drop indicators, keyboard focus retention, search restrictions, Escape cancellation, dropping onto xterm without input, reload persistence, and existing quick-prompt behavior. Screenshots were inspected for the drag indicator, saved order, and compact light theme.
- The full `npm test` run passed 1258 tests in 49 files, with a pre-existing loading failure in `scripts/prune-releases.test.mjs` (`SyntaxError: Invalid or unexpected token`). Running that same script test in the untouched main checkout reproduced the failure. Release scripts are outside this task and remain unchanged.
- Final `npm test -- src`: 1261 tests passed across all 48 source test files, including the four additional cancellation cases. `git diff --check` is clean.
- An independent read-only code review found no actionable defects. Its cancellation coverage gap is addressed by the four additional component cases and the Electron focus assertion.
