# Codeflai

English | [简体中文](README.zh-CN.md)

**Codeflai is a desktop app that manages the terminals and AI coding agent sessions of your
local projects in one window.**

Pick a project, pick a session kind, and Codeflai starts it — PowerShell or Command Prompt on
Windows, your login Shell on macOS, and up to seven coding-agent CLIs including Claude Code
and Codex.

It is a terminal workspace, not a code editor. Each session runs either directly in your
project directory or in its own isolated Git worktree and same-named branch, so an agent can
work without touching what you have open elsewhere. Every agent runs through the CLI you
already installed and signed in to: **Codeflai never collects, stores, or reads API keys or
CLI credentials.**

> **Before you start an agent session, read
> [Agent sessions and the permission bypass](#agent-sessions-and-the-permission-bypass).**
> Agent sessions deliberately run with the vendor's permission and sandbox checks switched
> off, and this release has no switch to turn that back on.

**[Download the latest release](https://github.com/denggaopan/codeflai/releases/latest)**

---

## Contents

- [Install](#install)
- [Your first session](#your-first-session)
- [The window](#the-window)
- [Adding projects](#adding-projects)
- [Starting a session](#starting-a-session)
- [Worktree sessions](#worktree-sessions)
- [Agent sessions and the permission bypass](#agent-sessions-and-the-permission-bypass)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Quick prompts](#quick-prompts)
- [Session titles](#session-titles)
- [The project options menu](#the-project-options-menu)
- [Keeping the window on top](#keeping-the-window-on-top)
- [Settings](#settings)
- [Updates](#updates)
- [Sessions keep running after you close the window](#sessions-keep-running-after-you-close-the-window)
- [What Codeflai remembers](#what-codeflai-remembers)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Install

### What you need

| | |
| --- | --- |
| **Windows** | Windows 10 or 11, x64. |
| **macOS** | An Intel or Apple Silicon Mac, using the archive that matches it. |
| **Git** *(recommended)* | Needed for worktree sessions and for cloning a repository from inside Codeflai. Without Git the app still works, but every session runs in the project's own directory. |
| **An agent CLI** *(per agent you want to use)* | Install and sign in to the CLI first — Codeflai launches it, it does not replace it. See the table in [Starting a session](#starting-a-session). |
| **VS Code** *(optional)* | For **Open project in VS Code** in the project options menu. |

### Windows

Download `Codeflai-Setup-<version>-win-x64.exe` from the
[Releases page](https://github.com/denggaopan/codeflai/releases/latest) and run it. The
installer is not code-signed, so SmartScreen may warn once — choose **More info** →
**Run anyway**. Afterwards Codeflai updates itself from inside the app (see
[Updates](#updates)).

### macOS

The macOS builds are unsigned and un-notarized internal-test bundles, so they need two
commands before their first launch.

1. Download the archive that matches your Mac: `Codeflai-<version>-mac-arm64.zip` for Apple
   Silicon, `Codeflai-<version>-mac-x64.zip` for Intel.
2. Extract it, then in Terminal, from the folder holding `Codeflai.app`:

   ```bash
   xattr -cr Codeflai.app
   codesign --force --deep --sign - Codeflai.app
   ```

3. Move `Codeflai.app` to `/Applications` if you like, then open it from Finder. If
   Gatekeeper still blocks it, allow it under **System Settings → Privacy & Security →
   Open Anyway**.

That ad-hoc signature applies only to your copy; it is not Developer ID signing.

**One macOS gotcha worth knowing up front:** an app launched from Finder does not inherit
Terminal's `PATH`. Codeflai therefore looks for agent CLIs through your login shell and in
the usual Homebrew and `~/.local/bin` locations. If a CLI you have installed shows up
disabled, check that `command -v claude` (or whichever CLI) succeeds in a *login* shell.

## Your first session

1. **Add a project.** Click the **Add Project** folder icon at the top of the sidebar and
   choose a folder on this computer — or clone a repository straight into place.
2. **Open the project's ⋯ menu** and choose **New session**.
3. **Pick a kind.** **PowerShell** or **Shell** gives you a plain terminal in the project
   directory. **Claude** or **Codex** starts that agent. An entry marked **(new worktree)**
   gives the session its own Git worktree and branch instead.
4. **Type.** The terminal is the real CLI — everything you would type in a terminal works
   here. Your first message also becomes the session's title.

Sessions stack up in the sidebar under their project, and the coloured dot in front of each
one tells you what it is doing. Closing the window does **not** stop them.

## The window

**Title bar** — the logo and **Codeflai** wordmark, the pin button that
[keeps the window above everything else](#keeping-the-window-on-top).

**Sidebar** — **Add Project**, **Search sessions**, filter, and fold icons at the top,
your projects below them, and the [Settings](#settings) gear at the bottom. Click the search
icon to open its input; results update as you type. Escape, Enter, or clicking outside
closes the search popup while keeping the query active. The search icon fills when
a query is active; reopen it to edit the query or use **Clear search**.

A project name toggles just that project's session list; switching sessions never re-folds anything. Searching temporarily reveals matching sessions
across every project, and clearing the search puts each project's fold state back. Each
project row has a ⋯ button for its [options menu](#the-project-options-menu), and each
session row has a delete button.

Click the small gray filter icon beside the search icon to open the filter form. Choose
**All statuses**, **Running**, **Done**, **Stopped**, **Starting…**, **Path missing**, or
**Error** in **Session status**, then click **Apply filters**. **Reset filters** resets the
form; closing it without applying discards those edits. Status and title
search work together, and matching sessions update as their status changes. Filters
temporarily unfold projects without changing their saved fold state or your active
terminal. **Clear filters** resets both controls when there are no matches. Status
filtering resets to **All statuses** when the window is reopened or reloaded. The icon
is borderless and changes from outline to filled when a status filter is applied; hover
over it to see the current filter.

The icon to the right of the filter toggles **Collapse all projects** and **Expand all
projects**. If any project is expanded, it folds them all; otherwise, it opens them all.
With search or a status filter active, it only folds or opens matching results, and each
matching project's name also toggles its results. Other projects keep their fold state.
Changing the search or filter reveals the new results, and clearing both restores the
saved project folds. The button is disabled when there are no projects or no matches.

**Terminal** — the active session's header (its title, its status, a **Restart session**
action when it is not running, and the bypass warning while an agent runs), the terminal
itself, and the optional [quick prompts](#quick-prompts) bar underneath. With nothing
selected it reads *"Select or start a session to see its terminal here."*

Drag the seam between the sidebar and the terminal to resize it. It also takes the keyboard:
focus it, then **←/→** nudge, **Home/End** jump to the limits, and a double-click restores
the default width. The sidebar stays between 200 and 640 pixels and never squeezes the
terminal below 360.

### Session status dots

| Dot | Means |
| --- | --- |
| **Running** | The terminal or agent is live, including while its background agents are still working. |
| **Done** | A Claude or Codex session with no reported ongoing work and no output for three seconds. Background-agent activity keeps it Running until all reported work finishes or stops, including after reopening the window. Shell sessions never show Done. |
| **Starting…** | The session is being created. |
| **Click to restore** | The session stopped (you stopped it, or the CLI exited). Click the row to restart it in the same directory — for agents, asking the CLI to continue the previous conversation. |
| **Path missing** | The session's directory is no longer there. |
| **Error** | Something went wrong; the row shows what. |

Background activity detection recognizes Claude and Codex task-status output. Older
CLI versions or settings without these signals use the three-second quiet-window fallback.

Codeflai opens maximized every time and restores a 1180×760 window when you un-maximize it.

## Adding projects

**Add Project** offers three ways in:

- **Local folder** — pick any project directory on this computer.
- **Recent projects** — reopen something you removed from the list earlier. Codeflai keeps up
  to 50 removed projects, across restarts, and hides ones already in your list. Reopening
  brings the folder back but not its old sessions. Use the trash button beside a history
  entry to forget it permanently, including entries whose folder no longer exists. This
  only removes the history record; project files and current sessions stay intact. You
  can add the folder again through **Local folder**.
- **Clone Git repository** — paste an HTTPS or SSH address (`git@host:owner/repository.git`
  works) and choose where to put it. Codeflai shows the full destination, creates a
  subdirectory named after the repository, and adds the project once Git finishes. An
  existing folder is never overwritten. Private repositories use your existing Git
  credentials or SSH configuration, so set that up before cloning.

## Starting a session

Open **New session** from a project's ⋯ menu. Click outside the launcher, press **Escape**,
or use its close button to dismiss it.

Which entries you see depends on your platform and on **Session kinds** in Settings:

| Session kind | The CLI Codeflai looks for | Available on |
| --- | --- | --- |
| **PowerShell** | — | Windows |
| **Command Prompt** | — | Windows |
| **Shell** | your login shell | macOS |
| **Claude** | `claude` | both |
| **Codex** | `codex` | both |
| **Gemini** | `gemini` | both, off by default |
| **GitHub Copilot** | `copilot` | both, off by default |
| **Cursor** | `agent` | both, off by default |
| **Comate** | `comatecli` | both, off by default |
| **Qwen Code** | `qwen` | both, off by default |

Note the last two executable names: Cursor's CLI is `agent` and Comate's is `comatecli`, not
the product name. That is also what the installation hints say, so the hint always names the
thing you actually need on `PATH`.

**A greyed-out entry means the CLI is missing, not that the kind is off.** Hover it for the
lookup hint. A kind you switched off in Settings does not appear in the menu at all; if you
switch every kind off, the launcher says so.

### Project directory or its own worktree

Kinds with **New worktree** enabled get *two* entries — **Claude** and
**Claude (new worktree)**, for example:

- the plain entry runs the session **in the project's own directory**, like opening a
  terminal there;
- the **(new worktree)** entry gives the session **its own Git worktree and a same-named
  branch**, so an agent can work without disturbing your checkout.

Out of the box the native shells offer only the plain entry (a quick terminal should not
create a branch) and the agents offer both.

### The five opt-in agent CLIs

Gemini, GitHub Copilot, Cursor, Comate, and Qwen Code sit behind **More agent CLIs** in
Settings and **ship switched off**, so a fresh install shows the same New session menu it
always did. The group also opens collapsed every time, whether or not you have enabled one —
Settings leads with the established kinds and an enabled one is a single caret click away.

Switch one on and it behaves like Claude or Codex: it appears in the menu with both a plain
and a **(new worktree)** entry, carries its own permission bypass, shows the bypass warning
while running, and takes Shift+Enter and Ctrl/Cmd+V. Two differences are deliberate:

- **No AI-generated session titles.** Their non-interactive output formats are not verified
  here, and a title process must never run with a permission bypass, so their titles come
  from your first message instead.
- **Comate cannot resume.** Restoring a stopped Comate session reopens its CLI in the same
  directory, but `comatecli` 1.0.8 has no resume flag, so it starts a fresh conversation
  rather than continuing the old one.

## Worktree sessions

Create a session from a **(new worktree)** entry in a project that is a Git repository with
at least one commit, and Codeflai makes an isolated Git worktree plus a same-named branch for
it, at `<repository-root>/.worktrees/worktree-YYMMDD-N` (today's date, `N` counting up per
repository per day). `.worktrees` goes into the repository's *local* exclude file
(`.git/info/exclude`), never the tracked `.gitignore`, so it never shows up as a change for
you to commit.

A session started from a plain entry is an **ordinary session** — it runs in the project
directory. A requested worktree also falls back to an ordinary session when the project is
not a Git repository, or is one with no commits yet. Either way the sidebar says
"Ordinary session" instead of a worktree name.

**Deleting a worktree session is protected.** Codeflai stops the session, runs `git status`
inside the worktree, and then:

- **if anything is uncommitted** — modified, staged, or untracked — the delete is
  **blocked**. The session and worktree stay exactly as they are and Codeflai tells you how
  many files changed. Commit or discard them yourself, then delete again.
- **if the worktree is clean**, it removes the worktree directory (never with `--force`) and
  the session record.

**The branch is never deleted.** Whatever the session did stays reachable on its branch
after the session and worktree are gone. Codeflai never force-removes a worktree and never
deletes commits, stashes, or anything in your original project.

## Agent sessions and the permission bypass

Every interactive agent session launches its CLI with that vendor's own permission bypass,
and nothing else:

| Session kind | Executable | Bypass carried on every interactive session |
| --- | --- | --- |
| Claude | `claude` | `--dangerously-skip-permissions` |
| Codex | `codex` | `--dangerously-bypass-approvals-and-sandbox` |
| Gemini | `gemini` | `--approval-mode=yolo` |
| GitHub Copilot | `copilot` | `--allow-all-tools` |
| Cursor | `agent` | `--force` |
| Comate | `comatecli` | `ZULU_TERMINAL_RUN_MODE=yolo` in the session's environment |
| Qwen Code | `qwen` | `--approval-mode=yolo` (see below) |

**This bypasses the agent's own permission and sandbox protections for the whole life of the
session.** The agent reads, writes, and runs commands in its directory without asking you to
confirm each action. That is a deliberate choice for a fast, low-friction workflow, and
Codeflai keeps it visible rather than hidden: while the active session is a running agent, a
**"Permissions and sandbox bypass enabled"** badge sits in its terminal header the entire
time.

**There is no per-session switch to turn the bypass off in this release.** If you do not
want an agent running with its protections bypassed, do not start an agent session in
Codeflai. Starting agents in a **(new worktree)** session is the cheapest way to limit what
they can disturb.

Two CLIs deviate, both in the safe direction:

- **Comate** has no bypass flag at all — its TUI resets its run mode on every launch, so the
  request has to travel as an environment variable. It is set only for that one session,
  never for Codeflai's own process.
- **Qwen Code** documents `--approval-mode=yolo`, but not every build implements it: 0.22.3
  ignores it silently and takes its approval mode from `~/.qwen/settings.json` or Shift+Tab
  in its TUI instead. Codeflai keeps sending the flag (it costs nothing and starts working
  the moment the CLI supports it) and never writes your settings file — so on such a build
  the badge warns about a bypass the CLI has not actually applied. An over-warning, never
  the reverse.

The background process Codeflai uses to [name a session](#session-titles) never gets either
bypass, does not share the session's terminal, and runs in a neutral directory rather than
your project or worktree.

## Keyboard shortcuts

| Shortcut | Where | Does |
| --- | --- | --- |
| **Ctrl+V** / **Cmd+V** | agent sessions | Paste clipboard text into the CLI prompt. |
| **Shift+Enter** | agent sessions | Insert a newline (**Enter** sends the message). |
| **Ctrl+Shift+P** / **Cmd+Shift+P** | the workspace | Search [quick prompts](#quick-prompts). |
| **↑ / ↓**, **Enter**, **Esc** | quick prompt search | Choose, insert, back to the terminal. |
| **Cmd+T** | macOS only | New ordinary Shell session in the current project. |
| **Escape** | the New session launcher | Close it. |
| **← / →**, **Home/End**, double-click | the sidebar seam | Resize, jump to a limit, reset. |

Windows has no new-session accelerator on purpose: **Ctrl+T** is a live key inside the
shells and agent CLIs Codeflai hosts, so it goes to the focused terminal instead. Native
Shell, PowerShell, and Command Prompt sessions keep the terminal's normal key handling
throughout.

## Quick prompts

Save the prompts and commands you type over and over, then insert them with one click.
Switch **Show quick prompt bar** on in Settings to use them — it is off by default and the
choice sticks across restarts. Switching it back off hides the bar and its search shortcut
but keeps everything you saved.

**The bar** under the terminal shows only prompts you have **starred**. Click one to insert
it at the terminal's cursor, then press **Enter** when you are ready to send — inserting
never sends for you. Buttons preview the content, extra starred prompts hide behind **+N**
when space runs out, and the bar always stays on one line.

**Adding one:** the **+** button opens a content editor — no name needed. New prompts start
unstarred; use the star toggle in the editor or in the management list to put one in the bar.
Saving returns you to the bar without inserting it. If you close the editor or switch
sessions mid-edit, the draft is still there when you press **+** again.

**Finding one:** click **Quick prompts** or press **Ctrl+Shift+P** / **Cmd+Shift+P** in the
workspace. Search covers starred *and* unstarred prompts; **↑/↓** choose, **Enter** inserts,
**Esc** returns to the terminal. The management button opens starring, editing, and deletion
in a panel below the terminal, keeping the terminal visible above it.

**Reordering:** drag starred buttons left or right in the bar, or drag the handles in
the management list to arrange all prompts. You can also focus a handle and press **Up/Down**.
Clear the management search before sorting. The order is shared by the bar and the lists,
survives restarts, and dragging never inserts a prompt. Use management to reorder prompts
that are hidden behind **+N** or when a session is stopped.

Prompts are shared by every project and session on this computer and survive restarts. You
can save up to 100, each up to 16,000 characters.

A few limits worth knowing: a stopped session still lets you manage prompts, but you have to
restore it before inserting one. Agent sessions take multi-line prompts; shell sessions need
bracketed-paste support for those, and without it Codeflai asks you for a single-line prompt
instead — so a saved newline can never run a command by itself. (Without bracketed paste,
indentation tabs also become spaces.)

## Session titles

A session starts with a placeholder like "New Claude session" and renames itself **once**,
from the first text you submit in its terminal. Claude and Codex sessions try an
AI-generated title first, through a separate non-interactive call with a 15-second timeout.
Every other kind — the native shells and the five opt-in agents — and any AI attempt that
fails or times out fall back to a tidied-up version of your own words, and finally to plain
truncation. None of this ever delays your typing.

## The project options menu

The ⋯ button on a project row opens it. Nothing in here changes which session is active or
folds the row.

- **New session** — the launcher described [above](#starting-a-session).
- **Open project in VS Code** — opens the project's **original folder**, never a session's
  worktree. Codeflai finds VS Code via the `code` command and the standard install locations
  on Windows, or the standard application locations on macOS; with none found the item is
  disabled with an install hint.
- **Open project folder** — the same directory in Explorer or Finder. No dependencies.
- **Open Git repository** — appears when the project sits in a Git repository whose remote
  has a web address. Codeflai reads `origin` (or the first remote when there is no `origin`),
  turns ssh/scp forms like `git@github.com:owner/repo.git` into their https page, and opens
  it in your default browser. The icon follows the host: the GitHub mark, the GitLab mark
  (self-hosted instances included), or a plain Git mark. Repositories with no remote, or a
  remote that is a local directory, get no entry. Remotes are re-read at every launch, so
  adding one shows up next time you start Codeflai.
- **Remove from list** — forgets the project after a confirmation. Its running sessions stop
  and all of its session records go with it, but **nothing on disk is touched**: the project
  directory, its worktrees, and their branches stay exactly as they are. Add the folder
  again later and you start with an empty session list.

## Keeping the window on top

The pin button in the title bar keeps Codeflai above every other window — which is what you
want while an agent works and you watch it from another app. Click it again to release; the
pressed state and the filled pin show that it is on top. The choice comes back the next time
you launch. If your window manager refuses the request, the button reflects that instead of
pretending it worked.

## Settings

The gear at the bottom-left of the sidebar opens Settings.

- **Launch at startup** — registers Codeflai as a login item. The switch shows the value read
  back from the system *after* writing it, so a change the OS refuses is never displayed as
  if it took effect.
- **Session kinds** — two switches per kind: whether it appears in the New session menu at
  all, and whether it also offers a **(new worktree)** entry. See
  [Starting a session](#starting-a-session).
- **Show quick prompt bar** — see [Quick prompts](#quick-prompts).
- **Theme** — dark or light.
- **Language** — English or 简体中文. It defaults to English rather than following your OS
  language. It covers the interface only: tool-availability hints, session errors, and
  session titles that were already generated stay in the language they were produced in.
- **Version** — the installed version, plus **Check for updates** on demand. See
  [Updates](#updates).
- **About Codeflai** — links to the project repository, the changelog, and the downloads page.

## Updates

Codeflai checks for a new release once in the background at startup, and **stays quiet unless
there is one** — a failed check, no network, an up-to-date install, all pass without
interrupting you. When a newer version exists, a dialog appears. You can also start the same
flow any time from **Check for updates** in Settings.

**On Windows**, **Update now** downloads that release's installer inside the app, with a
progress bar and a **Cancel** button. While bytes are moving, **Cancel** is the only way
out — clicking the backdrop or pressing Escape does nothing, so a stray click cannot throw
away a download that is nearly finished. The check and the download both go through the same
network stack a browser uses, so they honour your system proxy: if GitHub is fast in Chrome,
it is fast here.

When the download finishes Codeflai asks again. **Install now** closes the app and runs the
installer — it has to close, because the installer replaces files the running app holds open,
but [your sessions keep running](#sessions-keep-running-after-you-close-the-window).
**Later** just closes the dialog and leaves the installer on disk, so choosing **Update now**
again later finds it already downloaded and goes straight to the install prompt. Only that
one installer is kept; superseded ones and partial files from an interrupted download are
swept away with the next successful download.

Codeflai only quits once the operating system confirms the installer actually started. A
blocked, quarantined, or missing installer leaves the app open with an explanation instead of
closing it and leaving you with nothing.

**On macOS**, the dialog opens the Releases page so you can download the archive that matches
your Mac; there is no in-app update. macOS never downloads or runs a Windows installer.

## Sessions keep running after you close the window

Codeflai's terminals do not live in the window. They live in a background process that the app
starts when needed and then leaves running, so **closing Codeflai, a UI crash, and installing
an update all leave every session — and every agent working inside one — exactly where it
was.** Reopen Codeflai and it reattaches, repaints each terminal from the output it kept (the
most recent 256 KB per session), and nudges full-screen agent interfaces into redrawing.

This is what makes updating non-disruptive: **Install now** replaces the application while
that process goes on holding your sessions, and the freshly installed build picks them up.
Occasionally a release changes how the two talk to each other; then the old one has to retire
and its sessions are restarted with each agent's own resume flag instead of being adopted.

What actually ends a session: it exiting on its own (quitting the agent, `exit` in a shell),
you deleting it, removing its project from the list, or restarting the machine. Quitting
Codeflai is not on that list. The background process shuts itself down once it has held no
sessions and had no window connected for a minute. On Windows it shows up in Task Manager as
`codeflai-pty-host.exe`.

## What Codeflai remembers

Your projects, your sessions and their titles, quick prompts, and workspace preferences —
which projects were folded, which session was active, the sidebar width, theme, language,
session kinds. Saved on every change, so an unexpected exit does not lose them.

**Not stored, ever:** API keys, CLI credentials, or terminal scrollback.

The state lives in Codeflai's own application-data folder:

| | |
| --- | --- |
| Windows | `%APPDATA%\Codeflai` |
| macOS | `~/Library/Application Support/Codeflai` |

When you reopen the app, sessions that were running are picked back up where they are; ones
that had stopped on their own are **not** restarted behind your back — click one to restart
it. Restarting an agent session asks its CLI to continue the previous conversation, however
that vendor spells it (`claude --continue`, `codex resume --last`, `gemini --resume latest`,
`copilot --continue`, `agent --resume`, `qwen --continue`). It is best-effort, and Comate has
no resume of its own, so it starts fresh. Shell sessions always start fresh. Deleted projects
and sessions are ignored on restore, and a session whose directory has gone shows
**Path missing**.

## Troubleshooting

**A session kind is greyed out.** Its CLI is not where Codeflai looks. Hover the entry for the
exact executable name — remember Cursor's is `agent` and Comate's is `comatecli`. On Windows
it must be on `PATH`; on macOS it must be findable from a login shell (`command -v claude`),
because an app opened from Finder does not inherit Terminal's `PATH`.

**A kind is missing from the menu entirely.** It is switched off under **Session kinds** in
Settings — and the five opt-in agent CLIs are off by default, inside the collapsed **More
agent CLIs** group.

**"Worktree has N changed files."** That is the delete guard: commit or discard the changes
in that worktree, then delete the session again. Nothing was removed.

**A worktree session says "Ordinary session".** The project is not a Git repository, or it
has no commits yet. The session is running fine — just in the project directory.

**A restored agent session starts a fresh conversation.** Resume is best-effort and depends
on the CLI. Comate has none at all.

**macOS says the app is damaged or blocked.** Run the two commands in
[Install → macOS](#macos) before the first launch, and if Gatekeeper still objects use
**System Settings → Privacy & Security → Open Anyway**.

**A session vanished after a restart.** Deleting a session, or removing its project from the
list, removes the record — but never anything on disk. Any work an agent did in a worktree is
still on that worktree's branch.

## License

Codeflai is licensed under the [MIT License](LICENSE). You may use, copy, modify, and
distribute it for any purpose, including commercial and closed-source use. Copies or
substantial portions of the software must retain the copyright notice and license text; you
do not have to disclose source code.

Third-party dependencies remain subject to their own licenses.

Codeflai is built with Electron, React, TypeScript, xterm.js, and node-pty. If you want to
build it from source, clone the repository and read `CLAUDE.md` and the scripts in
`package.json`.
