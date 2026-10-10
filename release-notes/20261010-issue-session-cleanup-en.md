# Codeflai Release Notes — 0.32.0 / 2026-10-10

## Overview

Automatic issue sessions now report back to Codeflai: a round that finds no issue to work on cleans itself up, and a session that claims an issue is titled with the issue number and a condensed title.

## What's New

- **Why it matters:** A project with **Auto-resolve issues** switched on but nothing to do left behind a stopped session and an empty worktree every half hour — dozens of rows a day, each one to delete by hand.
- **What it is:** When the agent lists the issues and finds none that qualifies, it tells Codeflai so, and Codeflai deletes the round on the spot: the session row, its worktree and its launch files, exactly as if you had clicked Delete. If the agent left uncommitted changes behind, the round is kept as stopped instead, so nothing of yours is thrown away.
- **When to use it:** Leave a project switched on overnight or across a weekend; in the morning the sidebar holds only the rounds that actually did something.
- **Where to find it:** Nothing to set up — it applies whenever **Auto-resolve issues** is on.

- **Why it matters:** A round takes half an hour or more from claiming an issue to waiting out the test deployment, and all that time its title was just "Auto issue MM-DD HH:mm"; finding out which issue it was on meant opening the terminal and scrolling.
- **What it is:** As soon as the agent claims an issue, the session is renamed to "issue#<number> <condensed title>", for example "issue#42 Crash on login". The agent condenses the title to 40 characters at most, in the issue's own language, so it matches the issue list.
- **When to use it:** With several projects resolving issues at once, one glance at the sidebar tells you what each is working on, and a finished round can be found again by its number.
- **Where to find it:** Nothing to set up — the rename happens on claim; you can still rename the session yourself afterwards.

## Tips & Guidelines

- **The prompt template has a new placeholder, `{{resultFile}}`.** The default template is already updated: steps 1 and 2 tell the agent to write its result to that file. If you have edited the template, click **Reset to default** once, or copy the two sentences that mention `{{resultFile}}` from the default into yours; without them the session is neither cleaned up nor renamed, and everything else behaves as before.
- **A round that could not list the issues is kept.** When gh is not logged in or the repository is out of reach, the agent explains why in its terminal and exits, and that session stays so you can see what went wrong.
- **A cleaned-up round raises no "session exited" notification** and leaves no unread marker; a session that claimed an issue notifies as usual when it ends.
- **Automatic sessions already running when you update are not affected**, but they were started with the old template, so they will neither rename nor clean up; the next round follows the new rules.

## Feedback & Support

If something goes wrong after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
