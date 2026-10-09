# Codeflai Release Notes — 0.31.0 / 2026-10-09

## Overview

Projects can now work through their own issues: switch on **Auto-resolve issues** in a project's menu and, while the project is idle, Codeflai starts an agent session that picks one open issue, fixes it, waits for the test deployment to pass, and closes the issue.

## What's New

- **Why it matters:** Working a backlog by hand means opening a session per issue, pasting the issue in, watching CI, and closing it afterwards — and none of that happens while the machine sits idle.
- **What it is:** With **Auto-resolve issues** switched on in a project's ⋯ menu, Codeflai checks every so often (every 30 minutes by default) whether that project has a running session. When it does not, it starts a Claude Code (or Codex) session in a fresh worktree whose first prompt tells the agent to: list the open issues and take the oldest, claim it with the `codeflai:in-progress` label, resolve it with fast-do in one go and push, wait for the test deployment that push triggered, close the issue if the deployment succeeded — or relabel it `codeflai:needs-human` if it failed or nothing finished within 30 minutes — and exit. An agent sitting at **Done** in the sidebar does not count as running, the same rule auto shutdown uses.
- **When to use it:** File the issues you want handled before you leave and switch the project on, then read the session list and the issue states in the morning. Or try it right away with **Resolve one issue now**, which runs one round without waiting for the timer.
- **Where to find it:** ⋯ on the project row → **Auto-resolve issues** to switch it on or off (a small loop glyph appears next to the project name while it is on); ⋯ → **Resolve one issue now** for one round immediately; **Settings → Issue automation** for the agent (Claude Code / Codex), the check frequency (5 minutes to 4 hours), and the prompt template.

## Tips & Guidelines

- **The prompt template is yours to edit.** The default tells the agent to use gh on GitHub, glab on GitLab, and whatever tool is available elsewhere; for a repository with several workflows, name the one to wait for. `{{repoUrl}}`, `{{host}}`, `{{projectPath}}`, `{{projectName}}` and `{{fastDo}}` are filled in at launch; **Reset to default** brings the built-in template back.
- **No packaging and no release by default.** The template explicitly asks the agent only to commit, merge and push; edit it if you really want releases.
- **Codeflai itself never reads an issue or a deployment result.** Claiming, closing and giving up all happen inside the agent session, and everything that happened is in that session's terminal. The session is titled "Auto issue MM-DD HH:mm", and the usual Done notification tells you when a round ends.
- **A project with no eligible issue still starts one short agent per check**, which is why the default interval is 30 minutes; lengthen it in Settings if you prefer.
- **Switching a project off never stops a round already running** — stop that session from its row. If a launch fails (no worktree, no CLI), the project is switched off and a notice says why, so the same error does not come back every interval.
- **Both entries are greyed out for a project without a remote.** When the chosen agent is switched off in Settings or not installed, **Resolve one issue now** is greyed out while the switch can still be turned off.
- **Codeflai has to be open.** The check runs inside the window; quitting Codeflai stops new rounds from starting.
- **Upgrading to this version restarts running sessions once**, and they pick their conversations back up automatically (Claude continues, Codex resumes). This comes from a change to the background session process and happens only for this upgrade.

## Feedback & Support

If something goes wrong after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
