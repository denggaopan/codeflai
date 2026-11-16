# Codeflai Release Notes — 0.37.0 / 2026-11-16

## Overview

When you add a teammate in Lark (Feishu), you can now choose the one project they may use. From then on they send the bot their instruction without naming a project.

## What's New

### Choose a project when adding a teammate

- **Why it matters:** Every teammate could start sessions in any project on your computer, and every instruction had to name the project correctly. Leave it out and the bot answered that it could not find the project.
- **What it is:** Pick a project before adding the teammate, and they can start sessions only in that project:
  - Their instruction needs no project name, only what to do.
  - If their message mentions another project's name, it is treated as part of the task, and the session still starts in their project.
  - If they reply to a session of another project, the bot answers "没有权限" (no permission) and nothing is passed on.
- **When to use it:**
  - A teammate who works on one project writes "@Codeflai fix the error on the login page" and the work starts.
  - You want an outside collaborator to help with one project without letting them start sessions in the others.
- **Where to find it:** Settings → Lark → Members. Pick a project in the dropdown next to "Add teammate", click "Add teammate", and give them the pairing code. Leave the dropdown on "All projects" for the previous behaviour, with no limit.

## Improvements

- **See everyone's scope at a glance:** the member list shows "Only <project>" next to a limited teammate, and "Project removed" if that project has since been removed from Codeflai. Previously, the list showed only names and the date they were added.
- **The pairing code says what it grants:** a teammate's code shows "Only <project>" or "All projects" beside it, so you can check before handing it over.

## Tips & Guidelines

- **The limit decides where sessions start, not what the agent can reach.** The session still runs under your account without asking for confirmation, so a teammate can ask the agent to read or change other files on this computer. Add only people you trust.
- **To change or remove a teammate's limit:** choose the project you want (or "All projects"), generate a new pairing code and have them send it. The latest code they used decides. Send pairing codes in a private chat.
- **If the chosen project is removed from Codeflai**, that teammate's instructions are refused with a note to ask you to add them again. They are never carried out in another project.
- **You, the owner, are never limited** and still name the project in your message. Teammates added before this version are not affected: they can use every project, as before.
- **After you have limited a teammate, going back to an older version** means entering the Lark settings again, because the older version cannot read the new member details.
- Upgrading to this version does **not** restart running sessions.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
