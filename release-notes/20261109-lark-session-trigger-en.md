# Codeflai Release Notes — 0.35.0 / 2026-11-09

## Overview

You can now @Codeflai in a Lark (Feishu) group chat to have a Claude or Codex session start on your computer and work on the problem. Its progress is posted back to the chat.

## What's New

### Hand work to an agent from a Lark chat

- **Why it matters:** When a teammate reported a bug in the group with a screenshot, you had to carry the text and the image into Codeflai yourself and start a session. If you were away from your computer, the bug had to wait.
- **What it is:** Codeflai joins your group as a bot. Reply to (quote) the bug report and @Codeflai with the project name and what you want, for example "@Codeflai 用 claude 在 codeflai 项目修复这个 bug". A new session starts on your computer, and the quoted text and images are handed to the agent as reference material.
- **When to use it:**
  - A teammate reports a problem in the group, and you pass it straight to an agent.
  - You are away from your desk and want to give your home or office computer a task from your phone.
- **Where to find it:** Settings → **Lark**. Enter the app's App ID and App Secret, switch the bot on and save. Click **Bind me** to get a six-digit code. In Lark, type @ and pick the bot yourself, then send "绑定" followed by the code. Once the bot replies "已绑定", you are set up.

**What the bot replies, always under the message that asked:**

- When the session starts: which project, agent and branch it uses.
- Each time the agent finishes a round: the files it changed. If nothing changed, it tells you the agent may be waiting for you.
- When the session ends: that it ended, plus the final changes.
- When something is wrong: project not found, both claude and codex named, nothing asked for, the agent not installed on your computer, or the sender not on the whitelist. The reply says which.

**More ways to use it:**

- **Choose the agent:** write `claude` or `codex` in the message. Without either, Claude is used.
- **Run a skill:** start the instruction with a skill such as `/fast-do`, and the agent runs it, for example "@Codeflai /fast-do 修复 codeflai 的登录 bug".
- **Invite teammates:** once you are bound, click **Add teammate** and give the code to a teammate, who sends it the same way. Sessions a teammate starts carry their name in the title.

## Tips & Guidelines

- **Every task runs in its own worktree and branch**, so the project folder you are working in is never touched. A project that is not a Git repository, or has no commit yet, is refused.
- **Codeflai does not commit, push or open a pull request for you.** Ask for it in the message if you want the agent to do it.
- **Only people on the whitelist can hand out work.** People are identified by their Lark account, never by a name written in a message, and the whitelist can only be changed in Settings on your computer, not from the chat. Sessions started this way run with the agent's approvals turned off, which means a whitelisted person can run commands on your computer. Add only people you would trust with your terminal.
- **The Lark app needs these permissions:** `im:message.group_at_msg:readonly`, `im:message:readonly`, `im:message:send_as_bot`, `im:resource`, `contact:contact.base:readonly` and `contact:user.base:readonly`. Both contact permissions are needed, or the whitelist shows an ID instead of a name. Under Events & callbacks, choose the persistent connection and subscribe to `im.message.receive_v1`. Publish a new version of the app after every change to permissions or events. Settings shows the full list.
- **`im:message.group_msg` is optional.** It needs an admin's approval, and the main features work without it: quoted messages and their screenshots are still read. It is used only to look back through the chat for messages sent while Codeflai was offline. Without it, Lark itself delivers missed messages again later. In a test, a message sent 65 minutes earlier arrived about 10 minutes after Codeflai reconnected. Those messages are answered "please resend" and are not carried out.
- **Instructions sent while Codeflai was closed are never carried out.** They are answered "这条消息发出时 Codeflai 未运行，没有执行，请重新发送" (Codeflai was not running when this was sent; please resend).
- **One bot, one computer.** Do not enter the same App ID on two computers, or both will answer. A teammate's instruction also runs on your computer.
- **The "round finished" reply depends on the Codeflai window.** No such reply is sent while no Codeflai window is open, though the session itself keeps running.
- **Upgrading to this version restarts running sessions once**, and they pick their conversations back up automatically (Claude continues, Codex resumes). This comes from a change to the background session process and happens only for this upgrade.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
