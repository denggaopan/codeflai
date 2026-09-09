# Session Organization Implementation Plan

> For agentic workers: use subagent-driven-development with explicit file ownership.
> Continue all authorized work in this session and review before completion.

**Goal:** Make sessions easy to rename, archive, and revisit when they have unread output.

**Architecture:** Persist session metadata through SessionCoordinator and validated
IPC. Persist unread IDs with workspace navigation. Keep terminal processes and
replay independent of sidebar organization.

**Tech Stack:** Electron, TypeScript, Zod, React, Zustand, Vitest, Playwright.

## Task 1: Session metadata and IPC

Files: `src/shared/contracts.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`,
`src/main/services/session-coordinator.ts`, `src/main/ipc/register-ipc.ts`, and
their existing tests.

- [x] Add failing tests for trimmed manual titles, blank/long rejection,
  title-generation races, legacy optional fields, archive persistence without
  stopping PTYs or deleting worktrees, unknown IDs, and IPC sender validation.
- [x] Add `archived?: boolean` and a manual-title marker to session records;
  add `unreadSessionIds?: string[]` to workspace records.
- [x] Implement `renameSession(sessionId, title): Promise<SessionRecord>` and
  `setSessionArchived(sessionId, archived): Promise<SessionRecord>` end to end.
  Serialize metadata operations using coordinator locks; persist before emitting.
- [x] Run contracts, coordinator, and IPC tests and inspect the final diff.

## Task 2: Renderer state and unread activity

Files: `src/renderer/src/store/use-app-store.ts`, its tests,
`src/shared/workspace-state.ts`, `src/main/services/session-store.ts`, and their tests.

- [x] Test metadata actions against typed fake API results and rejected requests.
- [x] Test unread live output/exit, foreground clearing, focus/visibility,
  persisted hydration, deleted ID cleanup, and historical replay exclusion.
- [x] Wire metadata actions; archiving selection clears the active session only
  after success. Return success to keep failed inline edits open.
- [x] Add unread IDs to workspace persistence and reconciliation. Keep old empty
  workspace wire representations compatible. Subscribe once and dispose listeners.
- [x] Run store and workspace tests.

## Task 3: Sidebar organization

Files: `src/renderer/src/components/SessionRow.tsx`, `ProjectSidebar.tsx`,
`SessionFilters.tsx`, component tests, `styles.css`, and `i18n/en.ts`/`zh-CN.ts`.

- [x] Add failing interaction tests for inline rename (Enter/Escape, errors),
  archive/unarchive, filter draft behavior, and accessible unread indicators.
- [x] Extract the existing row into SessionRow and add keyboard-accessible
  actions/editing using existing CSS variables and menu patterns.
- [x] Extend the filter form with archive scope and combine it with title/status.
  Preserve temporary expansion, project folding, and terminal selection rules.
- [x] Add both language dictionaries and run sidebar/filter tests.

## Task 4: Recovery audit, documentation, and integration

Files: `docs/superpowers/specs/2026-09-09-session-recovery-audit.md`,
`README.md`, `README.zh-CN.md`, `e2e/session-organization.spec.ts`.

- [x] Audit resume argv, persisted IDs, same-directory sessions, and live host
  adoption. Record concrete limitations without inventing vendor CLI guarantees.
- [x] Add Electron coverage for renamed/archived records surviving UI restart,
  archive filtering, and live background output producing unread indicators.
- [x] Update current README behavior and the recovery limitation.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, and relevant Electron
  E2E. Fix regressions and obtain independent spec and quality reviews.
- [x] Report verified results, the recovery audit outcome, and branch location.


## Verification results

- `npm run build`: passed, including both TypeScript projects.
- `npm test -- --maxWorkers=2 --reporter=dot`: 58 files, 1,459 tests passed.
  After the last startup-focus handler correction, the full renderer store file
  was rerun: 74 tests passed, including the new regression (observed red first).
- Targeted organization/sidebar/persistence tests: 198 passed before the final
  added focus cases; those additional focus cases also passed independently.
- Electron E2E: all 10 selected scenarios passed across the batch and focused
  rerun (organization, creation loading, status filters, folding, workspace
  restore). The first batch had two startup/timing failures; both passed when
  rerun alone without implementation changes.
- Local E2E execution clears inherited `ELECTRON_RUN_AS_NODE=1` in the command's
  environment so Electron launches as an application. The new worktree also
  required `node node_modules/electron/install.js` after dependency installation.
- Independent spec and quality reviews are complete with no remaining findings.
  Regressions found and fixed during review: unread hydration versus early
  navigation, unread acknowledgement on startup focus, and rename focus return.
- Work remains on `feat/session-organization` in `.worktrees/session-organization`.
  No native vendor conversation recovery claim is made after host loss.
