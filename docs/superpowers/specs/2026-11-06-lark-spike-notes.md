# Lark spike findings (2026-11-06)

Throwaway script against a real self-built app on **Lark international** (`open.larksuite.com`, SDK `Domain.Lark`), `@larksuiteoapi/node-sdk@1.76.0`, one test group. Plan: `docs/superpowers/plans/2026-11-06-lark-session-trigger.md`, Task 1.

## Setup facts

- Long connection works on Lark international (the SDK's startup log line says "only available in self-build & Feishu app", which is generic wording; the connection did come up and receive events).
- The long-connection subscription can only be saved while a client is connected.
- Bot ability, scopes and event subscriptions take effect only after **publishing a new version**. Before that, `GET /open-apis/bot/v3/info` returns `{"code":11205,"msg":"app do not have bot"}` and the bot cannot be added to a group.
- Bot's own open_id: `GET /open-apis/bot/v3/info` → `bot.open_id`. Fetch it after connect; it is what `mentions[].id.open_id` is compared against.

## `im.message.receive_v1` payload (observed)

- `message.create_time`: **milliseconds** since epoch, as a string.
- `message.mentions[]`: `{ key: '@_user_1', id: { open_id, union_id, user_id }, name }`. The bot's mention carries the bot's open_id. `content.text` contains the placeholder `@_user_1`.
- `message.parent_id`: present when the user replied to (quoted) a message.
- `message.chat_type`: `group`.
- `sender`: `{ sender_type: 'user', sender_id: { open_id, union_id, user_id }, tenant_key, is_agent: false }`.

## Probes

| Probe | Result |
|---|---|
| Delivery while connected | Immediate (0 s delay) |
| Get quoted message (`im.v1.message.get` on `parent_id`) | Works. Shape: `data.items[0] = { msg_type, body.content, sender: { id, id_type: 'open_id', sender_type } }`. Tested with "read all group messages" granted; the minimum scope was not isolated (user already accepted the broad one). |
| Download image from a quoted `image` message (`im.v1.messageResource.get`, `type: 'image'`, `writeFile`) | Works |
| Reply (`im.v1.message.reply`, `msg_type: 'text'`) | Works |
| Sender name (`contact.v3.user.get`, `user_id_type: 'open_id'`) | **Fails** with `99991672` unless one of `contact:contact.base:readonly`, `contact:contact:access_as_app`, `contact:contact:readonly`, `contact:contact:readonly_as_app` is granted. The plan's `contact:user.base:readonly` was wrong; use **`contact:contact.base:readonly`**. |

## Offline redelivery

Client stopped, one @-bot message sent at 02:48:46Z, client restarted at 02:53:16Z (ws ready). The event arrived at **02:54:02Z — 316 s after it was sent and ~46 s after reconnect**. So Lark does redeliver missed events, but on its own retry schedule rather than immediately on reconnect. How long it keeps retrying (hours? a fixed number of attempts?) was **not** measured.

Consequences for the design:

- The 5-minute stale rule is necessary and sufficient for redelivered events: a message redelivered after Codeflai was offline arrives late and is answered with the stale reply. (316 s > 300 s here; a much shorter outage could redeliver a message under 5 minutes old, which would then run — acceptable, since by then Codeflai is running and the message is fresh.)
- Because the retry window is unknown, an outage longer than Lark's retry schedule would drop messages silently. Task 11 therefore implements the history-based catch-up regardless (decision, not contingent on further measurement); `markProcessed` deduplicates any overlap with redelivery.
