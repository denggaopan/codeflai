import type { LarkConnectionState } from './lark-client'

/** The shortest gap between two bot-id lookups started by incoming messages. */
export const LARK_BOT_REFETCH_MS = 30_000

export const LARK_BOT_MISSING_ERROR =
  "Lark did not return this app's bot. Enable the Bot capability, publish a new version of the app, then send the bot a message."

/**
 * The bot's own open_id for one connection, and the connection state that depends on it.
 *
 * Without the id no message can be recognised as addressed to the bot, so the link is reported
 * `connected` only once the id is known, and `error` (asking for a published app version) while
 * it is not. The id is looked up when the link comes up, and again when a message arrives while
 * it is still unknown (at most once per {@link LARK_BOT_REFETCH_MS}). That second lookup is what
 * lets the README's setup order work: the first lookup runs before the app version is published
 * and fails (11205 "app do not have bot"); the first message after publishing brings the bot to
 * life instead of leaving it deaf until the next reconnect.
 *
 * Messages pass through one queue in arrival order. A message that arrives while the id is
 * unknown waits for the lookup and is then delivered with the answer, as is every message queued
 * behind it. A state change caused by a lookup is queued behind the messages that waited for it:
 * `connected` starts the bridge's offline catch-up, which would otherwise answer those very
 * messages as stale before they were handled live.
 *
 * `receive` returns at once, so the SDK's ack window never depends on a lookup.
 */
export class LarkBotIdentity {
  private botOpenId?: string
  private inFlight?: Promise<void>
  private lastLookupAt?: number
  private chain: Promise<void> = Promise.resolve()
  // Bumped when the link drops or comes back, so a late answer cannot report a dead link as up.
  private attempt = 0

  constructor(
    private readonly deps: {
      /** Resolves with the id, or undefined when it could not be read (never rejects, bounded in time). */
      fetchBotId: () => Promise<string | undefined>
      onState: (state: LarkConnectionState, error?: string) => void
      now?: () => number
    }
  ) {}

  get id(): string | undefined {
    return this.botOpenId
  }

  /** The link is up (ready or reconnected): look the id up and report the outcome. */
  linkUp(): void {
    this.attempt += 1
    void this.lookUp()
  }

  /** The link is reconnecting: an answer still on its way no longer describes it. */
  linkDown(): void {
    this.attempt += 1
  }

  /** Delivers `deliver(botOpenId)` in arrival order, after a lookup when the id is unknown. */
  receive(deliver: (botOpenId: string | undefined) => void): void {
    this.chain = this.chain
      .then(async () => {
        if (this.botOpenId === undefined) {
          if (this.inFlight !== undefined) await this.inFlight
          else if (this.lastLookupAt === undefined || this.now() - this.lastLookupAt >= LARK_BOT_REFETCH_MS) await this.lookUp()
        }
        deliver(this.botOpenId)
      })
      .catch(() => undefined)
  }

  /** Resolves once everything queued so far has been delivered or reported. */
  async whenIdle(): Promise<void> {
    let seen: Promise<void> | undefined
    while (seen !== this.chain || this.inFlight !== undefined) {
      seen = this.chain
      await this.inFlight
      await this.chain
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private lookUp(): Promise<void> {
    const attempt = this.attempt
    this.lastLookupAt = this.now()
    const lookup = this.deps
      .fetchBotId()
      .catch(() => undefined)
      .then((botOpenId) => {
        if (this.inFlight === lookup) this.inFlight = undefined
        if (botOpenId) this.botOpenId = botOpenId
        this.chain = this.chain
          .then(() => {
            if (attempt !== this.attempt) return
            if (this.botOpenId === undefined) this.deps.onState('error', LARK_BOT_MISSING_ERROR)
            else this.deps.onState('connected')
          })
          .catch(() => undefined)
      })
    this.inFlight = lookup
    return lookup
  }
}
