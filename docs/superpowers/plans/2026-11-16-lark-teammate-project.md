# Lark Teammate Project Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner picks a project when adding a Lark teammate; that teammate's commands always run in that project and need no project name.

**Architecture:** The pending pairing code carries an optional `projectId`; redeeming it writes the id onto the member record. `LarkBridgeService` reads the member's `projectId` when a command arrives: a bound member skips project-name matching, and is refused for anything outside that project (including follow-ups).

**Tech Stack:** TypeScript, zod, Electron IPC, React 19, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-lark-teammate-project-design.md`

## Global Constraints

- A restriction that cannot be honoured refuses; it never degrades to "unrestricted".
- Members without `projectId` (every existing config) and the owner behave exactly as before.
- New replies, verbatim: `projectGone: '你绑定的项目已不在 Codeflai 中，请联系管理员重新添加'`. A restricted follow-up outside the project answers the existing `LARK_REPLY.denied`.
- New UI copy goes into all three dictionaries (`en.ts`, `zh-CN.ts`, `zh-TW.ts`); zh-TW is its own translation (專案, not 项目).
- Commit messages: English, Conventional Commits. Run vitest with the sandbox off.

## Review Focus

1. A bound member's project is removed from Codeflai later → `projectGone`, no session (Task 3).
2. An existing member redeems a new code with no project → unrestricted again; with another project → rebound (Task 1).
3. The owner redeems a member code that carries a project → owner unchanged, no `projectId` on the owner (Task 1).
4. A bound member's message names two other projects → runs in the bound project, no `ambiguousProject` (Task 2).
5. A bound member sends only a skill token (`/fast-do`) → `empty`, not a session whose instruction is the token (Task 2).

---

### Task 1: Contracts and store

**Files:**
- Modify: `src/shared/contracts.ts` (lark schemas, ~411–448)
- Modify: `src/main/lark/lark-store.ts` (`pairingSchema`, `status`, `startPairing`, `redeemPairing`)
- Test: `src/main/lark/lark-store.test.ts`, `src/shared/contracts.test.ts`

**Interfaces:**
- Produces: `larkMemberSchema.projectId?: string (min 1)`; `larkStatusSchema.pairing.projectId?: string`; `larkPairingRequestSchema = { role, projectId?: string (min 1) }`; `LarkStore.startPairing(role: 'owner' | 'member', projectId?: string): Promise<void>`.

- [ ] **Step 1: Failing tests in `lark-store.test.ts`**
  - `startPairing('member', 'p1')` → `status().pairing` equals `{ code, role: 'member', expiresAt, projectId: 'p1' }`; redeeming it yields a member with `projectId: 'p1'`.
  - `startPairing('owner', 'p1')` rejects with `'Only a teammate can be bound to a project.'`.
  - A member bound to `p1` redeems a later `startPairing('member')` code → member has no `projectId` key; redeems a `startPairing('member', 'p2')` code → `projectId: 'p2'`; `addedAt` unchanged in both.
  - The owner redeems a `startPairing('member', 'p1')` code → still owner, no `projectId`.
  - A `config.json` written without any `projectId` still lists its members.
- [ ] **Step 2: Run** `npx vitest run src/main/lark/lark-store.test.ts` → the new cases fail.
- [ ] **Step 3: Implement.** Add the optional fields to the three contracts schemas and to `pairingSchema`; `status` passes `projectId` through; `startPairing` stores it; `redeemPairing` builds the entry with the pairing's `projectId` (key omitted when undefined, never inherited from the previous entry).
- [ ] **Step 4: Run** the store and contracts tests → pass.
- [ ] **Step 5: Commit** `feat: let a Lark pairing code carry a project`

### Task 2: Command parsing for a bound member

**Files:**
- Modify: `src/main/lark/lark-command.ts`
- Test: `src/main/lark/lark-command.test.ts`

**Interfaces:**
- Produces: `parseLarkCommand(text: string, projects: readonly LarkProjectRef[], bound?: LarkProjectRef): LarkCommand`. With `bound`, `projects` is not consulted.

- [ ] **Step 1: Failing tests**
  - `parseLarkCommand('修一下登录页', projects, { id: 'p9', name: 'web' })` → `{ type: 'run', agent: 'claude', projectId: 'p9', projectName: 'web', instruction: '修一下登录页' }`.
  - Text naming two listed projects, with `bound` → `run` in the bound project.
  - `'/fast-do 修一下'` with `bound` → `skill: 'fast-do'`, `instruction: '修一下'`.
  - `'/fast-do'` with `bound` → `{ type: 'error', reason: 'empty' }`.
  - `'用 codex 修一下'` with `bound` → `agent: 'codex'`; `'claude codex'` → `ambiguousAgent`; `'绑定 123456'` → `bind`.
- [ ] **Step 2: Run** `npx vitest run src/main/lark/lark-command.test.ts` → fail.
- [ ] **Step 3: Implement.** `bound` replaces the matching block; a hoisted skill with nothing after it is `empty` (only reachable with `bound`).
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat: parse Lark commands for a project-bound teammate`

### Task 3: Bridge enforcement

**Files:**
- Modify: `src/main/lark/lark-bridge-service.ts` (`handle`, `followUp`, new `startPairing`), `src/main/lark/lark-replies.ts`
- Test: `src/main/lark/lark-bridge-service.test.ts`, `src/main/lark/lark-replies.test.ts`

**Interfaces:**
- Consumes: Task 1 `LarkStore.startPairing`, `LarkMember.projectId`; Task 2 `parseLarkCommand(..., bound)`.
- Produces: `LarkBridgeService.startPairing(role: 'owner' | 'member', projectId?: string): Promise<void>` — rejects with `'That project is no longer in Codeflai.'` when `projectId` is not in `sessions.snapshot().projects`, otherwise delegates to the store. `LARK_REPLY.projectGone`.

- [ ] **Step 1: Failing tests**
  - A member bound to `p2` sends `修一下` (no project name) → `sessions.created` has one entry with `projectId: 'p2'`.
  - Same member sends a message naming project `p1`'s name → created in `p2`.
  - Member bound to an id absent from the snapshot → replies `[LARK_REPLY.projectGone]`, nothing created.
  - Member bound to `p2` replies (parentId = trigger) in a running session whose record has `projectId: 'p1'` → replies `[LARK_REPLY.denied]`, `typeInto` not called; the same reply in a `p2` session is typed.
  - Unbound member and owner: existing tests stay green untouched.
  - `bridge.startPairing('member', 'nope')` rejects; `('member', 'p1')` leaves a pairing with `projectId: 'p1'`.
- [ ] **Step 2: Run** `npx vitest run src/main/lark/lark-bridge-service.test.ts` → fail.
- [ ] **Step 3: Implement.** In `handle`, after the member lookup: resolve the bound project from the snapshot (missing → `projectGone` before the conversation lookup is acted on for a new command) and pass it to `parseLarkCommand`. `followUp` takes the member and answers `denied` when `member.projectId !== undefined && record.projectId !== member.projectId`, after the `followUpGone` check and before anything is downloaded or typed.
- [ ] **Step 4: Run** bridge and replies tests → pass.
- [ ] **Step 5: Commit** `feat: confine a project-bound Lark teammate to that project`

### Task 4: IPC wiring

**Files:**
- Modify: `src/main/ipc/register-ipc.ts` (`LarkIpcPort.startPairing(role, projectId?)`, handler passes the parsed `projectId`), `src/main/index.ts` (`startPairing: (role, projectId) => bridge.startPairing(role, projectId)`), `src/preload/index.ts` (`larkStartPairing(role, projectId?)`, payload omits the key when undefined)
- Test: `src/main/ipc/register-ipc.test.ts`

- [ ] **Step 1: Failing tests** — invoking `IPC.larkStartPairing` with `{ role: 'member', projectId: 'p1' }` calls the fake port with `('member', 'p1')`; `{ role: 'member', projectId: '' }` and an unknown extra key reject.
- [ ] **Step 2: Run** `npx vitest run src/main/ipc/register-ipc.test.ts` → fail.
- [ ] **Step 3: Implement** the three edits.
- [ ] **Step 4: Run** the test and `npm run typecheck` → pass.
- [ ] **Step 5: Commit** `feat: pass the teammate's project through the pairing IPC`

### Task 5: Settings UI

**Files:**
- Modify: `src/renderer/src/components/LarkSettings.tsx`, `src/renderer/src/i18n/{en,zh-CN,zh-TW}.ts`, `src/renderer/src/styles.css` only if the row needs spacing
- Test: `src/renderer/src/components/SettingsDialog.test.tsx`

New keys (en / zh-CN / zh-TW):
- `settings.larkTeammateProject`: `Project for the new teammate` / `新同事可用的项目` / `新同事可用的專案`
- `settings.larkAllProjects`: `All projects` / `所有项目` / `所有專案`
- `settings.larkMemberProject`: `Only {project}` / `仅限 {project}` / `僅限 {project}`
- `settings.larkProjectRemoved`: `Project removed` / `项目已移除` / `專案已移除`

- [ ] **Step 1: Failing tests**
  - With an owner bound, a `combobox` named `Project for the new teammate` lists `All projects` plus each project of the store's snapshot, `All projects` selected; it is absent while there is no owner.
  - Choosing a project then clicking Add teammate calls `larkStartPairing('member', '<id>')`; with `All projects` it calls `larkStartPairing('member')` with no second argument defined. The owner buttons still call `larkStartPairing('owner')`.
  - A member with `projectId` of a listed project shows `Only <name>`; of an unknown id shows `Project removed`; the pairing panel shows the same line when `pairing.projectId` is set.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/components/SettingsDialog.test.tsx` → fail.
- [ ] **Step 3: Implement.** Projects come from `useAppStore` (`appState.projects`); the select uses `settings-select` and sits in the same `settings-dialog-section` as the Add teammate button; a selected project that disappears from the list falls back to `All projects`.
- [ ] **Step 4: Run** the test and `npm run typecheck` → pass.
- [ ] **Step 5: Commit** `feat: choose a project when adding a Lark teammate`

### Task 6: e2e and docs

**Files:**
- Modify: the Lark e2e spec under `e2e/` (the one driving `FileLarkClient`), `CLAUDE.md` (Lark 会话触发), `README.md` (Lark section + Manual smoke checklist)

- [ ] **Step 1:** Add an e2e case: add a teammate with a project chosen in Settings, redeem the code as a second sender through the inbox, send a command with no project name, assert a session row appears under that project and the started reply names it.
- [ ] **Step 2: Run** `env -u ELECTRON_RUN_AS_NODE npm run test:e2e -- <that spec>` → pass.
- [ ] **Step 3:** Document in CLAUDE.md: where `projectId` lives, bound members skip name matching, `projectGone`, the follow-up check, and the rollback cost (an older build reads the whole Lark config as empty). README: the new dropdown and a smoke step.
- [ ] **Step 4: Run** `npm run typecheck` and `npm test` → pass (one random load flake is known; rerun that file alone).
- [ ] **Step 5: Commit** `test: cover a project-bound Lark teammate end to end` and `docs: describe project-bound Lark teammates`
