# Automatic issue resolution

Lets a project work through its open issues on its own. While a project is switched on and
has no running session, Codeflai starts an agent session in a fresh worktree whose first
prompt tells the agent to pick one open issue, claim it, resolve it with the user's `fast-do`
skill, wait for the test deployment that the push triggers, and close the issue if that
deployment succeeds. Codeflai is only the trigger and the prompt: everything that touches
the issue tracker or the CI happens inside the agent session, with whatever CLI the agent
finds (`gh`, `glab`, or an API), where the user can watch and intervene.

This is "option A" of the three designs discussed on 2026-10-09: the thinnest one. The two
alternatives (Codeflai picks and claims the issue, or Codeflai runs the whole state machine
and polls CI itself) were rejected for now because they embed hosting-platform knowledge in
an app that is otherwise a terminal manager. Nothing here prevents moving a step into
Codeflai later.

## Scope and non-goals

- One prompt template, global, editable in Settings. One switch per project.
- Hosts: GitHub, GitLab and anything else. Codeflai never calls a hosting API; it hands the
  agent the host kind and the repository URL and lets it choose a tool.
- Agents: Claude Code or Codex, chosen in Settings. Both accept a positional prompt
  (`claude [options] [prompt]`, `codex [OPTIONS] [PROMPT]`), which is how the session gets
  its first instruction without anything being typed into the PTY.
- Not a background service: the watcher lives in the renderer, so Codeflai has to be open.
  Closing the window (on Windows, quitting the app) stops new rounds; it does not stop a
  round that is already running, because that session lives in the pty-host like any other.
- Codeflai does not learn the outcome of a round. Claiming, closing, failing and giving up
  are the agent's job, described in the template. The sidebar's existing Done edge, unread
  marker and system notification are how the user finds out that a round ended.

## Behavior

### The per-project switch

The project options menu gains two entries, placed after **Open Git repository** (after
**Copy project path** when the project has no remote) and before **Delete all sessions**:

- **Auto-resolve issues** — a checkable entry. On, the project is included in the periodic
  check. The project row shows a small glyph next to its name while the switch is on, with a
  full-sentence tooltip, so the user can see at a glance which projects run on their own.
- **Resolve one issue now** — runs one round immediately, without waiting for the timer and
  without the "no running session" condition: the user asked for it. This is also the only
  way an e2e test can exercise the launch chain, since the shortest interval is minutes.

Both entries are disabled, with the reason in their `title`, when the project has no
`repoRemote`: a repository without a remote has no issue tracker to read. When the chosen
agent kind is switched off in Settings or its CLI is missing, only **Resolve one issue now**
is disabled; the switch stays usable so a project that is already on can still be switched
off, and its `title` names the agent problem. The glyph on the row is shown whenever the
switch is on, even while the agent is unavailable — the switch is the user's intent and the
Settings page is where the agent gets fixed.

Switching a project off never stops a running automation session. Stop it from its row.

### The watcher

Lives in the renderer store, next to the auto-shutdown watcher and shaped like it:

- One `setInterval` for the whole feature, at the preference's `intervalMs`, running while
  at least one project is switched on. Enabling the first project starts it, disabling the
  last clears it, changing the interval restarts it. Toggling one project while others stay
  on does **not** restart it, so the cadence is unaffected.
- The first check after starting or restarting is one full interval later. Checking
  immediately would make "switch it on" mean "start an agent now", which is what the manual
  entry is for.
- Each tick walks the enabled projects in sidebar order. A project is launched when all of
  these hold: it still exists in the snapshot and has a `repoRemote`; it has no running
  session; the chosen agent kind is enabled and its CLI is available. "Running" is the
  sidebar's definition — `creating`, or `running` and not Done — restricted to that
  project's sessions (`hasRunningSessionsIn`), so an agent sitting at Done does not block the
  next round, the same way it does not block auto shutdown. A project whose agent is
  unavailable is skipped silently; a notice per interval would be spam, and the menu entry
  already explains.
- A launch is one `session:create` call with the rendered prompt and a title. Automatic
  launches do **not** change the active session: an agent starting on its own must not pull
  the user away from what they are looking at. The manual entry does switch to the new
  session, because the user just asked to watch it.
- Rounds are serial per project by construction: the agent stays running while it waits
  for CI, which keeps the project "running" until it exits. Two projects can run one round
  each at the same time.
- Cost of an idle project: every interval starts an agent that lists issues, finds nothing,
  and exits. That is a few thousand tokens per interval. The default of 30 minutes is the
  trade-off between "do not wait too long after a round" and "do not spin"; the user can
  pick 5, 10, 15, 30, 60, 120 or 240 minutes.

### The prompt template

- One template for all projects, stored in the renderer's localStorage under
  `codeflai.issueAutomation` together with the agent, the interval and the list of enabled
  project ids. Not part of `AppState`; the main process never reads it.
- Settings gains a section **Issue automation**, between **Session kinds** and **Updates**
  (`SETTINGS_SECTIONS` gets the id so the anchor menu follows): an agent dropdown
  (Claude Code / Codex), an interval dropdown, a monospace textarea of about twelve rows,
  a **Reset to default** button, and one line listing the placeholders.
- `template` is `null` until the user edits it. Null means "the default for the current
  interface language", looked up in the i18n dictionaries at render time, so a user who
  never touched the textarea follows the language switch. Resetting writes null back.
- Placeholders, replaced by Codeflai immediately before the session is created:

  | Placeholder       | Value                                                        |
  | ----------------- | ------------------------------------------------------------ |
  | `{{repoUrl}}`     | `project.repoRemote.webUrl`                                  |
  | `{{host}}`        | `github`, `gitlab`, or `unknown` for the generic `git` host  |
  | `{{projectPath}}` | `project.path`                                               |
  | `{{projectName}}` | `project.name`                                               |
  | `{{fastDo}}`      | `/fast-do` for Claude Code, `$fast-do` for Codex             |

  Unknown placeholders are left verbatim; the agent can read them as what they are.

- The English default. zh-CN and zh-TW are independent translations following the same
  steps, not word-for-word conversions, like every other dictionary entry.

  ```
  You are in a Codeflai automatic issue session. Repository: {{repoUrl}} (host: {{host}}).
  Local checkout: {{projectPath}}. Never ask the user anything; work through these steps:

  1. List the open issues. Use `gh` on GitHub, `glab` on GitLab, and whatever CLI or API
     is available elsewhere. Skip issues that are assigned to someone, or carry the label
     `codeflai:in-progress` or `codeflai:needs-human`. Take the oldest one that remains.
     If nothing qualifies, or the issues cannot be listed, say why and exit.
  2. Add the label `codeflai:in-progress` to the issue and comment that Codeflai has
     started on it.
  3. Resolve the issue with {{fastDo}} in one go: commit, merge, and push to the default
     branch. Do not package and do not publish a release.
  4. After the push, wait for the test deployment it triggered. On GitHub, find the run
     for that commit with `gh run list --commit <sha>` and wait for it with
     `gh run watch <id> --exit-status`; use the equivalent elsewhere.
  5. If the deployment succeeded, close the issue with a comment linking the commit and
     remove the `codeflai:in-progress` label. If it failed, or nothing has finished after
     30 minutes, leave the issue open, comment what happened, and replace the label with
     `codeflai:needs-human`.
  6. Exit the session.
  ```

- Two lines in the default are not optional: "do not package and do not publish", because
  `fast-do` packages and publishes client applications by default and a release per issue
  is not what anyone wants; and the `needs-human` label, because without it a failed round
  would be picked up again next interval forever. Users who want a release per issue edit
  the template.
- The test deployment is described as "the run that commit triggered" rather than by name.
  Repositories with several workflows on push name the right one in the template.

### Hosts

`project.repoRemote.host` is already computed by `ProjectService` (`github` when the
hostname contains "github", `gitlab` for "gitlab", `git` otherwise). The template tells the
agent which it is and what the web URL is; the agent picks the tool. For an unknown host
the agent may still manage (an API token in the environment, a vendor CLI) and if it cannot,
step 1 of the template ends the round with an explanation. No Codeflai code branches on the
host beyond rendering the placeholder.

## Architecture

### Shared: `src/shared/issue-automation.ts`

Pure functions shared by renderer, main and pty-host, with its own test file:

- `ISSUE_AUTOMATION_AGENT_KINDS = ['claude', 'codex'] as const` and the prefix table
  `{ claude: '/fast-do', codex: '$fast-do' }`.
- `ISSUE_AUTOMATION_INTERVAL_MINUTES = [5, 10, 15, 30, 60, 120, 240]` and the default
  (30 minutes), mirroring the auto-shutdown constants.
- `renderIssueAutomationTemplate(template, values)` — placeholder substitution.
- `issueAutomationPromptArgument(kind, promptFilePath)` — the single argv string:
  `"<prefix> Read the task file at <path> and carry it out exactly, without asking questions."`
  The prefix goes into argv, not only into the file, so the skill is loaded by the first
  message deterministically instead of relying on the model to think of it.
- `validatePromptFilePath(path)` — the same character blacklist as `validateShimPath`
  (`% ! " & | < > ^` and control characters), because the path is pasted into a `cmd.exe`
  command line on the npm-shim path. A user name that contains one of those characters gets
  a clear error rather than an escaping attempt that cannot survive cmd's two parsing
  passes.

### Renderer

- Preference `codeflai.issueAutomation`:
  `{ agent: 'claude' | 'codex', intervalMs: number, template: string | null, projects: string[] }`.
  Defaults: `claude`, 30 minutes, `null`, `[]`. Parsing is lenient the way
  `parseStoredAutoShutdown` is: an unknown agent or interval falls back to the default,
  `projects` is filtered to ids present in the current snapshot on every read and write, so
  a removed project leaves nothing behind.
- Store actions: `setIssueAutomationAgent`, `setIssueAutomationInterval` (rejects values
  outside the table, like `setAutoShutdownInterval`), `setIssueAutomationTemplate`
  (`null` resets), `setProjectIssueAutomation(projectId, enabled)`,
  `resolveIssueNow(projectId)`. The watcher is module-level state like
  `autoShutdownTimer`, started from `initialize()` once the stored preference is read.
- `hasRunningSessionsIn(projectId, sessions, idleAgentSessionIds)` next to
  `hasRunningSessions` in `auto-shutdown.ts`, sharing `isAgentDone` so the sidebar, auto
  shutdown and this watcher can never disagree about what "running" means.
- Launching: render the template (user's or locale default), build the title from the i18n
  key `session.autoIssueTitle` with the local time (`Auto issue 10-09 14:30`), call
  `window.codeflai.createSession(projectId, kind, true, { initialPrompt, title })`. The
  preload signature gains that optional fourth argument so existing callers are untouched.
  Always a worktree: the project directory may hold the user's uncommitted work, and the
  worktree is what lets the user keep working in parallel.
- A failed launch (rejected IPC) switches that project off and raises an error notice, the
  way a failed shutdown switches auto shutdown off: the same error every interval helps
  nobody.

### Launch chain

1. `createSessionRequestSchema` gains `initialPrompt: z.string().min(1).max(20_000).optional()`
   and `title: z.string().trim().min(1).max(200).optional()`. Both absent: everything behaves
   exactly as today, including the e2e tests that assert exact argv.
2. `SessionCoordinator.create(projectId, kind, { worktree, initialPrompt, title })`:
   - With `title`, the record is created with that title, `titleState: 'complete'` and
     `titleManuallySet: true`. The prompt never passes through the PTY, so the first-input
     tracker would never fire for it; and a generated title would be the same for every
     round anyway. Later typing by the user does not retitle it, same as a renamed session.
   - With `initialPrompt`, the text is written to `<userData>/issue-automation/<sessionId>.md`
     through an injected `PromptFileStore` (`write(sessionId, text) → absolute path`,
     `remove(sessionId)` never rejects; the composition root decides the directory). The
     path is passed as `terminalService.start(record, { initialPromptFile })`. The file is
     removed when the start fails and when the session is deleted; it is kept while the
     session exists so a restart can be diagnosed by reading it.
   - `restore` and `reconcile` never pass a prompt. Resuming runs the agent's own
     `--continue` / `resume --last`; feeding the prompt again would redo the round.
3. `TerminalStartOptions` / `SessionTerminal.start` gain `initialPromptFile?: string`.
   `PtyHostClient` forwards it in the `spawn` message; the in-process `TerminalService`
   forwards it to its own launch-spec resolution.
4. `pty-protocol.ts`: the `spawn` message gains `initialPromptFile: z.string().min(1).max(1024).optional()`
   and `PTY_PROTOCOL_VERSION` goes from 1 to 2. The message schemas are `strictObject`, so a
   version 1 host would reject the field; version negotiation retires it once, which kills
   its PTYs, after which `reconcile` restores every `running` session with resume. This is
   the documented path for protocol changes and must be called out in the release notes:
   upgrading to this version restarts running sessions once.
5. Both launch adapters — `src/pty-host/launch-spec.ts` and
   `TerminalService.resolveLaunchSpec` — change from `(kind, resume)` to
   `(kind, { resume, initialPromptFile })`. When `initialPromptFile` is set and `resume` is
   false, the argv becomes `[...bypassArgs, ...extraArgs, promptArgument]` — the prompt is
   always last. On the direct `.exe` path it is one more element of the args array; on the
   cmd-hosted shim path it is wrapped in double quotes inside the `/s` outer pair, which is
   why its characters are restricted (the sentence is fixed ASCII, the path is validated).
   A prompt together with `resume: true` is a programming error and throws.

### Settings and sidebar

- `SettingsDialog`: new section with the controls above. The textarea is uncontrolled while
  focused and committed on blur, so every keystroke does not rewrite localStorage. The
  agent dropdown lists only the two automation kinds, regardless of which session kinds are
  enabled: enabling is the Session kinds section's job, and the project menu reports when
  the chosen one is off.
- `ProjectSidebar`: two menu entries with inline SVG glyphs in the existing style, the
  row glyph, and the disabled reasons. The existing e2e assertion on the exact project menu
  entries (seven with a GitHub remote) becomes nine.

## Error handling

- Launch failure of any kind (worktree creation, missing CLI, unsafe path, IPC rejection):
  the project's switch goes off, an error notice names the project and the message. The
  manual entry reports the same error without touching the switch.
- Agent-side failure: entirely the template's business. Codeflai cannot tell a round that
  closed an issue from one that gave up; it only sees the session end.
- localStorage unavailable (the memory-only store the storage marker detects): every
  project reads as off and the template as default. The failure direction is "nothing
  runs", which is the right one for a feature that launches bypass-mode agents.
- Agent kind switched off or CLI missing after a project was enabled: the tick skips the
  project silently; the menu entry explains.
- Window hidden for long: `backgroundThrottling: false` is already set for the
  notification path, so the interval keeps its cadence. Nothing here is timing-critical.
- Project removed from the list: its id is dropped from `projects` on the next read.

## Testing

- `issue-automation.test.ts`: placeholder rendering (all five, unknown left alone, host
  label for each `RepoHost`), prompt argument per kind, path validation accepting the
  standard Windows and macOS userData paths and rejecting each blacklisted character,
  preference parsing (defaults, unknown agent, off-table interval, project filtering).
- `use-app-store.test.ts` with fake timers: first check one interval after enabling; a
  project with a running session is skipped and one at Done is launched; the create call
  carries `worktree: true`, the rendered prompt and the title; automatic launch keeps the
  active session, manual launch switches to the new one; a rejected create switches the
  project off and raises a notice; changing the interval restarts the timer; toggling a
  second project does not; disabling the last project clears it.
- `session-coordinator.test.ts`: `create` with prompt and title writes the file, starts
  with `initialPromptFile`, persists the title fields; a failed start removes the file;
  `delete` removes the file; `restore` and `reconcile` start without a prompt.
- `launch-spec.test.ts` and `terminal-service.test.ts`: exact argv for Claude and Codex
  with and without a prompt file, on the `.exe` and the shim path, on win32 and darwin;
  the prompt is last; `resume` with a prompt throws; an unsafe path throws.
- `pty-host-client.test.ts`: the spawn message carries `initialPromptFile`. The protocol
  version bump is covered by the existing negotiation tests.
- `contracts.test.ts`: the new request fields; `i18n/index.test.ts`: the three dictionaries
  type-check with the new keys, including the long template strings.
- `e2e/issue-automation.spec.ts`, its own Electron instance: the fixture repository already
  has a GitHub-shaped `origin`. Switch the project on through the menu, assert the row glyph
  and that it survives a restart. Click **Resolve one issue now**: the fake agent's recorded
  argv ends with the prompt argument whose path lies under the suite's user-data directory;
  read that file and assert it equals the default English template with the placeholders
  replaced; a worktree session row appears with the `Auto issue …` title. Switch the agent
  to Codex in Settings and repeat: the argv prefix is `$fast-do`. On Windows the fake agent
  is launched through `fake-agent.cmd`, so this test exercises the cmd-hosted quoting path
  for real.
- Before implementation, a half-hour spike with the real CLI: start
  `claude --dangerously-skip-permissions "/fast-do …"` by hand and confirm the slash command
  in the positional prompt is honored; then run one round against a throwaway issue in a
  test repository and watch claim, fast-do, `gh run watch` and close. The outcome only
  affects the wording of the default template.
- One real-machine verification before release: a real Claude session, a real repository,
  one disposable issue, from claim to close. Its conclusion is recorded in CLAUDE.md the
  way the notification and font-size verifications are, since no automated test reaches
  a logged-in CLI.

## Documentation

- README: a section **Resolving issues automatically** (switch, manual entry, template,
  placeholders, what the agent is told to do, what Codeflai does and does not know), one
  line under **What Codeflai remembers** for the new localStorage key, and the new Settings
  rows.
- CLAUDE.md: one architecture bullet covering the watcher's placement, the prompt-file
  argv rule and why the prompt cannot travel in argv, the protocol bump, and the "both
  launch adapters" reminder.
- Release notes: the protocol version change and its one-time restart of running sessions.
