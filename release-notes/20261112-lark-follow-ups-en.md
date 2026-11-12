# Codeflai Release Notes — 0.36.0 / 2026-11-12

## Overview

Work you hand out from a Lark (Feishu) chat can now go on in the chat. The agent posts its question, its result or what it is stuck on back to the group, and when you reply it carries on.

## What's New

### Answer the agent from the chat

- **Why it matters:** When the agent finished a round, the chat only got "Claude stopped, may be waiting for you, check Codeflai". You could not see what it was asking, and a reply in the chat started a brand-new session, so the only way to answer was to go back to your computer and type in the terminal.
- **What it is:** Reply to any message of the session's conversation (your instruction, or any of the bot's replies) and @Codeflai. Your reply is typed into that running session as one line, "[Lark 回复 · your name] your text", and the bot answers "已转给 Claude" (passed on to Claude). Images in your reply go to the agent as well. If the agent is busy, the line waits its turn, just like typing at the keyboard.
- **When to use it:**
  - The agent asks "JSON or CSV?" and you answer "CSV" from your phone.
  - You see the result and want one more change: say it in the same conversation instead of starting over.
- **Where to find it:** In Lark, choose Reply on one of the bot's messages, type @ and pick the bot, then write your answer and send it.

### The agent tells you where it stands

- **Why it matters:** Codeflai used to guess from three seconds of silence whether the agent was done, asking something or stuck, and the guess was often wrong.
- **What it is:** At the end of each round the agent now states where it stands, and Codeflai posts it to the chat as is:
  - When it needs your decision: "Claude 在问你：…" (Claude is asking you), one concrete question at a time.
  - When it is done: "Claude 完成了：…" (Claude finished), with the changed files.
  - When it is stuck: "Claude 卡住了：…" (Claude is stuck), saying where.
- **When to use it:** Hand out the work, get on with something else, and the chat tells you exactly what the agent needs from you.
- **Where to find it:** Nothing to set up. It works for every new session started from Lark.

## Improvements

- **No window needed:** these three reports reach the chat even while no Codeflai window is open. Previously, the "round finished" reply was sent only while a Codeflai window was open.
- **Replies follow the conversation:** once you have answered, the bot's next replies go under your answer, so questions and answers form one thread. Previously, every reply went under the original instruction.
- **Clearer reminder:** when there is no report, the reminder now says the agent may be waiting and that you can reply and @ the bot to go on. Previously it could only send you to Codeflai.

## Tips & Guidelines

- **@Codeflai in your reply.** Without the `im:message.group_msg` permission, Lark only delivers messages that mention the bot.
- **Only people on the whitelist can answer**, as for instructions, and replies sent while Codeflai was closed are not carried out either.
- **A stopped session is not woken by a reply.** Sessions started from Lark do not stop on their own, so a stopped one was ended by someone in Codeflai. The bot says the session has stopped. To go on, restore it in Codeflai, or @Codeflai with a new instruction.
- **Your reply is only ever text to the agent.** Even something like `/logout` reaches it as words, never as one of its own commands.
- Upgrading to this version does **not** restart running sessions. Sessions started on an earlier version can be answered from the chat too, but only new sessions report where they stand.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
