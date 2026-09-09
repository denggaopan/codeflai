# Session organization

The user approved implementing the recommended next increment: rename and archive
sessions, show unread activity, and verify recovery of multiple sessions sharing a
directory. The existing terminal-workspace layout and English/Chinese localization
remain the visual and interaction conventions.

## Behavior

- Each session gains an options menu with Rename, Archive/Unarchive, and Delete.
  Retain the existing direct delete action for compatibility and quick access.
- Rename uses an inline field with Enter to save and Escape to cancel. Trim names,
  reject blank names and names longer than 200 characters, and preserve manual
  names even when an asynchronous generated title arrives later. Failure keeps the
  edit available and reports the error.
- Archive is an immediately persisted, reversible organizational change. It never
  stops a process, removes a worktree, or deletes a branch. Unarchive also never
  starts a process. Archiving the selected session clears the terminal selection.
- Extend the existing filter form with Active sessions (default), Archived
  sessions, and All sessions. This combines with title search and status filters.
  Draft/apply/reset/dismiss behavior stays consistent with the current form.
- Unread means new live terminal output or an exit event observed while that
  session is not being viewed. It does not assert task success or completion.
  Replayed historical output never creates unread activity. Viewing a session in
  a focused, visible window clears its unread flag. Background window output may
  mark the selected session unread; focusing the window clears it.
- Persist unread session IDs with existing workspace navigation state, only on
  transitions. Remove IDs for deleted sessions/projects. Existing state files
  without any of the new fields continue to load.
- Show a small accessible unread marker on session rows and an unread count on
  the corresponding project. Archived activity is available in the archive view.
- No desktop notifications, pinning, tags, automatic merging, or new recovery
  identifiers are included in this increment. Recovery is audited and documented;
  changing vendor-specific conversation recovery requires separately verified CLI
  support.

## Architecture

Session metadata is owned by SessionCoordinator and stored using SessionStore's
validated atomic writes. Dedicated rename/archive IPC requests validate values
and sender identity. The preload exposes only typed methods taking session IDs.
Manual naming must win both before and during background title generation.

Unread bookkeeping belongs to the existing renderer event subscription and
workspace persistence path. Host protocol and output replay stay unchanged.
Sidebar row editing/actions live in a focused component so ProjectSidebar keeps
responsibility for grouping, filtering, navigation, and deletion confirmation.

## Verification

Cover legacy state parsing, request validation, rename/title-generation races,
archive persistence without PTY/worktree effects, search/filter combinations,
rename cancellation/errors, unread clearing/persistence, and replay exclusion.
Run targeted tests first, then typecheck, the full unit suite, build, and Electron
E2E including an organization flow and existing status/restore regressions. Audit
same-directory recovery with code evidence and focused tests; do not claim live
vendor CLI verification from fake-agent E2E.
