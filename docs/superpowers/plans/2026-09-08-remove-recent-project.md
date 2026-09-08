# Remove Recent Projects Implementation Plan

**Goal:** Delete individual history entries in Add Project while preserving folders, current projects, sessions, and the open dialog.

**Architecture:** Add `ProjectService.removeRecent` backed by the serialized SessionStore update, expose it through a validated IPC/preload method, and update only renderer history after persistence succeeds. Render sibling reopen/delete buttons using the existing remove icon and bilingual strings. Reuse dialog pending/error handling.

**Tech Stack:** Electron, React, TypeScript, Zustand, Zod, Vitest, Playwright.

Execution follows the user's fast-do workflow inline in the current checkout. Baseline: `0a57d5e` on `main`; pre-existing untracked `.claude/` stays untouched.

- [x] Add and run failing service/IPC/component regression tests: durable deletion, unknown ids, unchanged projects/sessions/files, request validation, pending state, error retention, empty state, and no accidental reopening.
- [x] Implement `removeRecentProject` across shared IPC, preload, ProjectService, register-ipc, the renderer store, AddProjectDialog, styles, and English/Chinese dictionaries. Update typed API fixtures and user documentation.
- [x] Run affected Vitest files, typecheck, and real Electron history deletion/restart/re-add coverage. Independent review finds no blocking issues. All 1,405 unit tests pass.
- [x] Launch dev preview. User explicitly selects version `0.22.2`; development window opens Add Project > history in Chinese with two copied history entries. Profile: `release/validation-history-0.22.2/dev-profile-wzz0yy`. User approves the preview and authorizes publication.
- [ ] Commit the feature and separate version change, build Windows/macOS packages through existing scripts, validate extracted Windows behavior and macOS archives, then publish and verify GitHub Release assets.
