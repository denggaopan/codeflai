# Session stop, precise unread, and manual ordering

Replaces the archive concept introduced in `2026-09-09-session-organization-design.md`
with an explicit Stop action, makes unread activity mean "a turn finished" rather than
"bytes arrived", and lets the user order sessions by hand. The existing sidebar layout,
English/Chinese localization, and drag-sort interaction conventions remain.

## Behavior

### Stop replaces Archive

- The session options menu offers Rename, Stop, and Delete. Stop replaces
  Archive/Unarchive; the archive concept is retired entirely, because `stopped` already
  says everything `archived` said.
- Stop terminates the session's PTY and persists `stopped`. It never touches the
  worktree, never deletes a branch, and never removes the session record. The stopped
  row keeps its existing "Click to restore" affordance, which relaunches with the
  vendor resume argument and continues the same conversation.
- Stop always asks for confirmation, because it interrupts whatever turn the agent is
  running. The dialog is not marked destructive: Stop is reversible, so Confirm keeps
  initial focus and Cancel-first focus stays reserved for Delete.
- Stop is offered only while the session is `running` or `creating`; on an
  already-stopped session the menu item is disabled.
- Stopping clears that session's unread marker and forgets its activity snapshot. The
  process is gone, so both would be stale.
- Stop does not reorder anything. Session order is manual (below) and no status change
  ever rearranges it.

### Retiring the `archived` field

- `archived` stays declared in `commonSessionRecordShape` as an optional boolean.
  Both branches of `sessionRecordSchema` are `z.strictObject`, so removing the field
  outright would make every `state.json` written by 0.23.0 fail validation and fall
  into the recovery path, losing session records on upgrade.
- `normalizeRuntimeStatuses` in `session-store.ts` strips the field on load, alongside
  the existing `creating` → `stopped` reconciliation. It already rebuilds each session
  object, so the retired field disappears permanently after one startup with no
  separate migration step.
- A schema comment records that the field is retired and accepted only so older state
  files keep parsing.

### Unread means a turn finished

- For agent sessions, unread is raised at the Done edge: the moment
  `AgentActivityTracker` reports the session is no longer running and the three-second
  quiet window elapses. That is the same signal the sidebar already renders as Done.
  Spinners, elapsed-time counters, and TUI repaints no longer raise unread.
- For shell sessions, unread stays byte-based. A shell does not repaint itself, so any
  output really is new content.
- An exit event still raises unread, for every session kind.
- Replayed output must never raise unread. Because replay also arms the idle timer, the
  timer records whether it was armed by live output or by replay, and only the live case
  raises unread. Live output re-arms the timer anyway, so a session that replays and
  then produces real output is still reported correctly.
- The activity-tracking kind gate widens from hardcoded claude/codex to `isAgentKind`.
  The five opt-in agents are repainting TUIs too; `AgentActivityTracker.running`
  returns `undefined` for them, which degrades to "three seconds of silence means
  Done" — the best available approximation without vendor activity signals.

### Manual session ordering

- Sessions can be dragged into any order within their own project. Drag across
  projects is not offered and shows no drop indicator: a session is bound to its
  `projectId` and `launchPath`, so moving the row without moving the worktree would let
  the sidebar grouping and the on-disk layout disagree.
- Dragging is disabled while a search or status filter is active, because a filtered
  list is not the full order and committing it would corrupt the stored order.
- The drag must not activate the session it started from. Order is persisted
  immediately, survives restart, and is unaffected by status changes, stop, or restore.

### Removing the archive filter

- The session visibility filter (Active/Archived/All) is removed. With archive replaced
  by Stop, the existing status filter already covers the same need through `stopped`.
- The filter form keeps its status select and its draft/apply/reset/dismiss behavior.

### Menu icons

- Each session options menu item carries a leading icon, matching the project options
  menu: a pencil for Rename, a stop glyph for Stop, a trash glyph for Delete. Icons are
  decorative (`aria-hidden`); the accessible name stays the item's text.

## Architecture

### Contracts and IPC

`session:set-archived` and `setSessionArchivedRequestSchema` are replaced by
`session:stop`, reusing the existing `sessionIdRequestSchema`. The handler calls the
`SessionCoordinator.stop()` that already exists, so the locking and stop-then-persist
behavior is unchanged. The handler returns nothing: the `stopped` record reaches the
renderer through the `onStateChanged` broadcast, which is already the durable source of
truth, rather than through a second return path.

`session:reorder` carries `orderedSessionIds` — the complete session order, not a
project-scoped slice and not a moved-id/index pair. `SessionCoordinator.reorder()`
mirrors `ProjectService.reorder()`: it validates inside the store transaction that the
list is an exact permutation of the sessions persisted at commit time and throws a
typed mismatch error otherwise, so the request is idempotent and a session created
concurrently is never silently dropped.

### Renderer

Unread bookkeeping stays in the existing store subscription. The change is which event
raises it: the idle-timer callback for agent sessions, `onTerminalData` for shells,
`onTerminalExit` for both. The idle timer gains a live-versus-replay flag; nothing about
the host protocol, the replay tail, or workspace persistence changes.

Session drag-sort reuses the hook behind quick-prompt sorting rather than duplicating
the project row handlers. That hook already solves the non-obvious parts: it suppresses
the click that would otherwise fire at the end of a drag (critical here, since clicking
a session row switches the terminal), it avoids `text/plain` so a row dragged onto xterm
cannot paste itself as a command, and its `surface` concept scopes a drag to one list.
The hook is generalized — `Surface` widens from the quick-prompt literals to a string,
placement becomes a local `'before' | 'after'` type, and the drag MIME type is supplied
by the caller — and is renamed to `use-drag-sort.ts` with `QuickPrompts` migrated onto it. Sessions pass
their `projectId` as the surface, which is what makes same-project-only fall out of the
existing code instead of needing a new check. `ProjectSidebar` converts the hook's
move callback into the full ordered id list and calls the store action.

`SessionRow` renders the drag attributes on its `<li>` and receives the hook's props
from `ProjectSidebar`, which keeps ownership of grouping, filtering, navigation, and the
confirmation dialogs. The stop confirmation is lifted to `ProjectSidebar` the same way
delete already is. Menu icons are inline SVG components local to `SessionRow`, following
the `FolderGlyph` pattern in `ProjectSidebar`.

Retired translation keys (`sidebar.archiveSession`, `sidebar.unarchiveSession`,
`sidebar.archivedSession`, `sidebar.sessionVisibility`, `sidebar.activeSessions`,
`sidebar.archivedSessions`, `sidebar.allSessions`) are removed from both dictionaries;
`en.ts` remains the single source of key names, so a missed key fails typecheck.

## Verification

Unit coverage: unread raised at the Done edge and not by intermediate output; replay
never raising unread; shells still byte-based; exit still raising unread; stop
terminating the PTY, persisting `stopped`, and clearing unread; reorder permutation
validation including a concurrently created session; legacy `state.json` carrying
`archived` still parsing and losing the field after one load; the filter form without
its visibility select; session rows carrying drag attributes only when unfiltered, and
not offering a cross-project drop; menu items exposing icons without changing their
accessible names.

Then typecheck, the full unit suite, build, and Electron E2E. `session-organization.spec.ts`
needs the visibility-scope helper removed, its archive assertions changed to a stopped
session, its unread assertion given room for the three-second quiet window, and a new
drag-ordering case that survives a restart. README, README.zh-CN, and CLAUDE.md sections
describing archive, unread, and session filters are updated to match. The version bump
follows the project's SemVer convention as a separate `chore` commit at release time.
