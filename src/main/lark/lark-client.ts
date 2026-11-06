import * as Lark from '@larksuiteoapi/node-sdk'
import type { LarkDomain } from '../../shared/contracts'
import { LarkBotIdentity } from './lark-bot-identity'

export const LARK_BOT_INFO_TIMEOUT_MS = 10_000

/** Resolves with the bot id, or undefined when the lookup fails or takes longer than `timeoutMs`. */
export async function awaitBotId(lookup: Promise<string | undefined>, timeoutMs = LARK_BOT_INFO_TIMEOUT_MS): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })
  try {
    return await Promise.race([lookup.catch(() => undefined), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export type LarkIncomingMessage = {
  messageId: string
  chatId: string
  parentId?: string
  messageType: string
  content: string
  createTimeMs: number
  senderType: string
  senderOpenId?: string
  mentionsBot: boolean
}

export type LarkFetchedMessage = { messageType: string; content: string; senderOpenId?: string }

export type LarkConnectionState = 'connecting' | 'connected' | 'error'

export interface LarkClient {
  connect(
    credentials: { domain: LarkDomain; appId: string; appSecret: string },
    onMessage: (message: LarkIncomingMessage) => void,
    onState: (state: LarkConnectionState, error?: string) => void
  ): void
  disconnect(): void
  getMessage(messageId: string): Promise<LarkFetchedMessage | undefined>
  /** Messages of one chat created in `[sinceMs, untilMs]`, oldest first. Rejects when the API call fails. */
  listMessages(chatId: string, sinceMs: number, untilMs: number): Promise<LarkIncomingMessage[]>
  downloadImage(messageId: string, imageKey: string, targetPath: string): Promise<void>
  userName(openId: string): Promise<string | undefined>
  reply(messageId: string, text: string): Promise<void>
}

// Minimal view of the `im.message.receive_v1` event, as observed against the real service.
export type LarkReceiveEvent = {
  sender?: { sender_type?: string; sender_id?: { open_id?: string } }
  message: {
    message_id: string
    chat_id: string
    parent_id?: string
    message_type: string
    content: string
    create_time: string
    mentions?: Array<{ id?: { open_id?: string } }>
  }
}

export function toIncomingMessage(event: LarkReceiveEvent, botOpenId: string | undefined): LarkIncomingMessage {
  const { message, sender } = event
  const mentionsBot =
    botOpenId !== undefined && (message.mentions ?? []).some((mention) => mention.id?.open_id === botOpenId)
  return {
    messageId: message.message_id,
    chatId: message.chat_id,
    ...(message.parent_id ? { parentId: message.parent_id } : {}),
    messageType: message.message_type,
    content: message.content,
    createTimeMs: Number(message.create_time),
    senderType: sender?.sender_type ?? '',
    ...(sender?.sender_id?.open_id ? { senderOpenId: sender.sender_id.open_id } : {}),
    mentionsBot
  }
}

// Minimal view of an item from the IM "list messages" API, as observed against the real service.
export type LarkListedItem = {
  message_id?: string
  chat_id?: string
  parent_id?: string
  msg_type?: string
  create_time?: string
  body?: { content?: string }
  sender?: { id?: string; id_type?: string; sender_type?: string }
  mentions?: Array<{ id?: string; id_type?: string }>
}

/** Undefined for an item without the fields every message must have. */
export function toListedMessage(item: LarkListedItem, botOpenId: string | undefined): LarkIncomingMessage | undefined {
  if (!item.message_id || !item.chat_id || !item.msg_type || item.body?.content === undefined) return undefined
  const mentionsBot =
    botOpenId !== undefined &&
    (item.mentions ?? []).some((mention) => mention.id === botOpenId && (mention.id_type === undefined || mention.id_type === 'open_id'))
  const senderOpenId = item.sender?.id_type === 'open_id' && item.sender.id ? item.sender.id : undefined
  return {
    messageId: item.message_id,
    chatId: item.chat_id,
    ...(item.parent_id ? { parentId: item.parent_id } : {}),
    messageType: item.msg_type,
    content: item.body.content,
    createTimeMs: Number(item.create_time),
    senderType: item.sender?.sender_type ?? '',
    ...(senderOpenId === undefined ? {} : { senderOpenId }),
    mentionsBot
  }
}

// The SDK's default logger prints at info level, which includes connection details. Only warnings
// and errors reach the console, and only their first argument's text, never request configs.
const quietLogger = {
  error: (...args: unknown[]) => console.error('[lark-sdk]', ...args.map(describeLogArg)),
  warn: (...args: unknown[]) => console.warn('[lark-sdk]', ...args.map(describeLogArg)),
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined
}

function describeLogArg(arg: unknown): string {
  if (arg instanceof Error) return arg.message
  if (typeof arg === 'string') return arg
  return '[object]'
}

function safeErrorMessage(error: unknown, secret: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  const text = secret ? raw.split(secret).join('***') : raw
  return text.slice(0, 200)
}

export class SdkLarkClient implements LarkClient {
  private api?: Lark.Client
  private ws?: Lark.WSClient
  private identity?: LarkBotIdentity
  // Bumped on every connect/disconnect so callbacks from a closed client are ignored.
  private generation = 0

  connect(
    credentials: { domain: LarkDomain; appId: string; appSecret: string },
    onMessage: (message: LarkIncomingMessage) => void,
    onState: (state: LarkConnectionState, error?: string) => void
  ): void {
    this.disconnect()
    const generation = ++this.generation
    const current = () => generation === this.generation
    const domain = credentials.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu
    const base = {
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      domain,
      loggerLevel: Lark.LoggerLevel.warn,
      logger: quietLogger
    }
    const api = new Lark.Client(base)
    this.api = api

    // `connected` is reported only once the bot id is known (see LarkBotIdentity), so the
    // catch-up that runs on it can already tell which listed messages mention the bot.
    const identity = new LarkBotIdentity({
      fetchBotId: () =>
        awaitBotId(
          api
            .request({ method: 'GET', url: '/open-apis/bot/v3/info' })
            .then((info: { bot?: { open_id?: string } }) => info?.bot?.open_id)
        ),
      onState: (state, error) => {
        if (current()) onState(state, error)
      }
    })
    this.identity = identity

    onState('connecting')
    const ws = new Lark.WSClient({
      ...base,
      onReady: () => {
        if (current()) identity.linkUp()
      },
      onReconnected: () => {
        if (current()) identity.linkUp()
      },
      onReconnecting: () => {
        if (!current()) return
        identity.linkDown()
        onState('connecting')
      },
      onError: (error: Error) => {
        if (current()) onState('error', safeErrorMessage(error, credentials.appSecret))
      }
    })
    this.ws = ws
    void ws
      .start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          'im.message.receive_v1': (data: LarkReceiveEvent) => {
            if (!current()) return
            // Return at once: the 3-second ack window must never depend on the consumer, nor on
            // the bot id lookup an unknown id triggers.
            identity.receive((botOpenId) => {
              if (current()) onMessage(toIncomingMessage(data, botOpenId))
            })
          }
        })
      })
      .catch((error: unknown) => {
        if (current()) onState('error', safeErrorMessage(error, credentials.appSecret))
      })
  }

  disconnect(): void {
    this.generation += 1
    const ws = this.ws
    this.ws = undefined
    this.api = undefined
    this.identity = undefined
    try {
      ws?.close({ force: true })
    } catch {
      // Closing an already-dead socket is not an error worth surfacing.
    }
  }

  async getMessage(messageId: string): Promise<LarkFetchedMessage | undefined> {
    const api = this.api
    if (!api) return undefined
    try {
      const response = await api.im.v1.message.get({ path: { message_id: messageId } })
      const item = response?.data?.items?.[0]
      if (!item?.msg_type || item.body?.content === undefined) return undefined
      return {
        messageType: item.msg_type,
        content: item.body.content,
        ...(item.sender?.id ? { senderOpenId: item.sender.id } : {})
      }
    } catch {
      return undefined
    }
  }

  async listMessages(chatId: string, sinceMs: number, untilMs: number): Promise<LarkIncomingMessage[]> {
    const api = this.requireApi()
    const botOpenId = this.identity?.id
    if (botOpenId === undefined) throw new Error('The bot id is not known yet.')
    const found: LarkIncomingMessage[] = []
    let pageToken: string | undefined
    for (let page = 0; page < 100; page += 1) {
      const response = await api.im.v1.message.list({
        params: {
          container_id_type: 'chat',
          container_id: chatId,
          start_time: String(Math.floor(sinceMs / 1000)),
          end_time: String(Math.floor(untilMs / 1000)),
          sort_type: 'ByCreateTimeAsc',
          page_size: 50,
          ...(pageToken === undefined ? {} : { page_token: pageToken })
        }
      })
      for (const item of response?.data?.items ?? []) {
        const mapped = toListedMessage(item, botOpenId)
        if (mapped !== undefined) found.push(mapped)
      }
      if (!response?.data?.has_more || !response.data.page_token) break
      pageToken = response.data.page_token
    }
    return found
  }

  async downloadImage(messageId: string, imageKey: string, targetPath: string): Promise<void> {
    const api = this.requireApi()
    const response = await api.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: 'image' }
    })
    await response.writeFile(targetPath)
  }

  async userName(openId: string): Promise<string | undefined> {
    const api = this.api
    if (!api) return undefined
    try {
      const response = await api.contact.v3.user.get({
        path: { user_id: openId },
        params: { user_id_type: 'open_id' }
      })
      return response?.data?.user?.name || undefined
    } catch {
      return undefined
    }
  }

  async reply(messageId: string, text: string): Promise<void> {
    const api = this.requireApi()
    await api.im.v1.message.reply({
      path: { message_id: messageId },
      data: { msg_type: 'text', content: JSON.stringify({ text }) }
    })
  }

  private requireApi(): Lark.Client {
    if (!this.api) throw new Error('Lark client is not connected')
    return this.api
  }
}
