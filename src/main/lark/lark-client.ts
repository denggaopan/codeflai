import * as Lark from '@larksuiteoapi/node-sdk'
import type { LarkDomain } from '../../shared/contracts'

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
  private botOpenId?: string
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
    this.botOpenId = undefined

    const fetchBotId = (): void => {
      void api
        .request({ method: 'GET', url: '/open-apis/bot/v3/info' })
        .then((info: { bot?: { open_id?: string } }) => {
          if (current() && info?.bot?.open_id) this.botOpenId = info.bot.open_id
        })
        .catch(() => undefined)
    }

    onState('connecting')
    const ws = new Lark.WSClient({
      ...base,
      onReady: () => {
        if (!current()) return
        fetchBotId()
        onState('connected')
      },
      onReconnected: () => {
        if (!current()) return
        fetchBotId()
        onState('connected')
      },
      onReconnecting: () => {
        if (current()) onState('connecting')
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
            // Return at once: the 3-second ack window must never depend on the consumer.
            onMessage(toIncomingMessage(data, this.botOpenId))
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
    this.botOpenId = undefined
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
