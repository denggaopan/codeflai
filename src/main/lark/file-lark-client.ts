import { appendFile, copyFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { LarkConnectionState, LarkClient, LarkFetchedMessage, LarkIncomingMessage } from './lark-client'

/**
 * A `LarkClient` backed by files in one directory, used only by the E2E composition (the
 * composition root picks it; this class reads no environment variable itself). A test appends
 * one JSON `LarkIncomingMessage` per line to `inbox.jsonl`, lists quotable messages in
 * `fetched.json` (a map of message id to `LarkFetchedMessage`), and reads the bot's replies
 * from `outbox.jsonl` (each line carries the reply's own `id`).
 */
export class FileLarkClient implements LarkClient {
  private timer?: NodeJS.Timeout
  private consumed = 0
  private reading = false
  private replies = 0

  constructor(
    private readonly directory: string,
    private readonly imageFixturePath: string
  ) {}

  connect(
    _credentials: { domain: 'feishu' | 'lark'; appId: string; appSecret: string },
    onMessage: (message: LarkIncomingMessage) => void,
    onState: (state: LarkConnectionState, error?: string) => void
  ): void {
    this.disconnect()
    onState('connecting')
    void mkdir(this.directory, { recursive: true }).then(() => onState('connected'))
    this.timer = setInterval(() => void this.poll(onMessage), 200)
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async poll(onMessage: (message: LarkIncomingMessage) => void): Promise<void> {
    if (this.reading) return
    this.reading = true
    try {
      const text = await readFile(join(this.directory, 'inbox.jsonl'), 'utf8').catch(() => '')
      // Only complete lines: the last one may still be being written.
      const lines = text.split('\n').slice(0, -1).filter((line) => line.trim() !== '')
      for (const line of lines.slice(this.consumed)) {
        this.consumed += 1
        try {
          onMessage(JSON.parse(line) as LarkIncomingMessage)
        } catch {
          // A malformed line is a test bug; skipping it keeps the poller alive.
        }
      }
    } finally {
      this.reading = false
    }
  }

  async getMessage(messageId: string): Promise<LarkFetchedMessage | undefined> {
    try {
      const map = JSON.parse(await readFile(join(this.directory, 'fetched.json'), 'utf8')) as Record<string, LarkFetchedMessage>
      return map[messageId]
    } catch {
      return undefined
    }
  }

  async listMessages(chatId: string, sinceMs: number, untilMs: number): Promise<LarkIncomingMessage[]> {
    const text = await readFile(join(this.directory, 'inbox.jsonl'), 'utf8').catch(() => '')
    const found: LarkIncomingMessage[] = []
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try {
        const message = JSON.parse(line) as LarkIncomingMessage
        if (message.chatId === chatId && message.createTimeMs >= sinceMs && message.createTimeMs <= untilMs) found.push(message)
      } catch {
        // A malformed line is a test bug; skip it.
      }
    }
    return found
  }

  async downloadImage(_messageId: string, _imageKey: string, targetPath: string): Promise<void> {
    await copyFile(this.imageFixturePath, targetPath)
  }

  async userName(openId: string): Promise<string | undefined> {
    return `E2E ${openId}`
  }

  // Each reply gets an id of its own, written beside it, so a test can answer one the way a
  // person replies to the bot in Lark.
  async reply(messageId: string, text: string): Promise<string | undefined> {
    this.replies += 1
    const id = `om_bot_${process.pid}_${this.replies}`
    await appendFile(join(this.directory, 'outbox.jsonl'), `${JSON.stringify({ messageId, text, id })}\n`, 'utf8')
    return id
  }
}
