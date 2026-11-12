import { randomInt } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { z } from 'zod'

import {
  larkDomainSchema,
  larkMemberSchema,
  type LarkConnection,
  type LarkDomain,
  type LarkMember,
  type LarkSaveConfigRequest,
  type LarkStatus
} from '../../shared/contracts'

type WriteFileAtomic = (filePath: string, contents: string, options: { encoding: 'utf8' }) => Promise<void>

const writeFileAtomic = createRequire(import.meta.url)('write-file-atomic') as WriteFileAtomic

export const LARK_PAIRING_TTL_MS = 10 * 60_000
export const LARK_PROCESSED_LIMIT = 500
export const LARK_KNOWN_CHATS_LIMIT = 50
/** Wrong guesses a pending pairing code survives; the fifth clears it. */
export const LARK_PAIRING_MAX_FAILURES = 5
/** Message ids remembered per session conversation (bot replies and follow-ups), newest kept. */
export const LARK_LINK_MESSAGE_LIMIT = 50

// Lark message ids look like `om_x100b61e7abb0fca4ffa63c824cbbe7c`. The id becomes a directory
// name, so anything that could climb out of the attachments folder is refused.
const SAFE_MESSAGE_ID = /^[A-Za-z0-9_-]+$/u

/** Base64 in and out, so the ciphertext can sit in a JSON file. Backed by Electron `safeStorage` in production. */
export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

export type LarkSessionLink = {
  sessionId: string
  chatId: string
  triggerMessageId: string
  baseCommit: string
  agent: 'claude' | 'codex'
  lastReport?: string
  /**
   * Later messages of the session's conversation: the bot's replies and the follow-ups it
   * passed on. A reply to any of them (or to the trigger) is a follow-up for this session.
   */
  messageIds?: string[]
  /** Where the next report goes: the latest follow-up, else the trigger message. */
  replyTo?: string
  /** A structured report was sent for the current round, so the idle edge has nothing to add. */
  reported?: boolean
}

export type LarkSessionLinkPatch = Partial<Pick<LarkSessionLink, 'lastReport' | 'replyTo' | 'reported'>>

const pairingSchema = z.strictObject({
  code: z.string(),
  role: z.enum(['owner', 'member']),
  expiresAt: z.string().datetime(),
  failures: z.number().int().min(0).default(0)
})

const configSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  domain: larkDomainSchema,
  appId: z.string(),
  secret: z.string().optional(),
  members: z.array(larkMemberSchema),
  pairing: pairingSchema.optional(),
  lastOnlineAt: z.string().datetime().optional(),
  knownChats: z.array(z.string()).optional()
})
type LarkConfig = z.infer<typeof configSchema>

const processedSchema = z.object({ version: z.literal(1), ids: z.array(z.string()) })

const sessionLinkSchema = z.strictObject({
  sessionId: z.string().min(1),
  chatId: z.string(),
  triggerMessageId: z.string(),
  baseCommit: z.string(),
  agent: z.enum(['claude', 'codex']),
  lastReport: z.string().optional(),
  messageIds: z.array(z.string()).optional(),
  replyTo: z.string().optional(),
  reported: z.boolean().optional()
})
const sessionsSchema = z.object({ version: z.literal(1), links: z.array(z.unknown()) })

// 'strict' is for the read half of a read-modify-write: only a missing file counts as empty.
type ReadMode = 'lenient' | 'strict'

const emptyConfig = (): LarkConfig => ({ version: 1, enabled: false, domain: 'feishu', appId: '', members: [] })

export type ReadText = (path: string) => Promise<string>

const readText: ReadText = (path) => readFile(path, 'utf8')

/**
 * Everything the Lark trigger keeps on disk: settings, the encrypted App Secret, the sender
 * whitelist, a pending pairing code, processed message ids and session links. Three files, each
 * parsed on its own, so a corrupt one costs only itself.
 *
 * A missing file is empty, and so is a corrupt one (logged). Any other read failure (no access,
 * a locked file) is empty for plain reads, but rejects a mutation without writing: rewriting a
 * file it could not read would replace the whitelist or the processed ids with nothing. The
 * whitelist is changed only through the methods here, which are only reachable from local
 * Settings IPC.
 */
export class LarkStore {
  // Every write is read-modify-write on one file; one chain keeps concurrent ones from overwriting each other.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly directory: string,
    private readonly cipher: SecretCipher,
    private readonly clock: () => Date = () => new Date(),
    private readonly random: (max: number) => number = (max) => randomInt(max),
    private readonly read: ReadText = readText
  ) {}

  attachmentDirectory(triggerMessageId: string): string {
    if (!SAFE_MESSAGE_ID.test(triggerMessageId)) throw new Error('Unsafe Lark message id.')
    return join(this.directory, 'attachments', triggerMessageId)
  }

  /** Inside the trigger's directory, so forgetting the session removes a follow-up's images too. */
  followUpDirectory(triggerMessageId: string, messageId: string): string {
    if (!SAFE_MESSAGE_ID.test(messageId)) throw new Error('Unsafe Lark message id.')
    return join(this.attachmentDirectory(triggerMessageId), 'follow-ups', messageId)
  }

  async status(connection: LarkConnection, error?: string): Promise<LarkStatus> {
    const config = await this.settledConfig()
    const pending = config.pairing
    const pairing = pending === undefined ? undefined : { code: pending.code, role: pending.role, expiresAt: pending.expiresAt }
    return {
      enabled: config.enabled,
      domain: config.domain,
      appId: config.appId,
      secretSet: config.secret !== undefined && config.secret !== '',
      connection,
      ...(error === undefined ? {} : { error }),
      members: config.members,
      ...(pairing === undefined || Date.parse(pairing.expiresAt) < this.clock().getTime() ? {} : { pairing })
    }
  }

  saveConfig(request: LarkSaveConfigRequest): Promise<void> {
    return this.mutateConfig((config) => {
      let secret = config.secret
      if (request.appSecret !== undefined) {
        if (!this.cipher.isAvailable()) throw new Error('Secure storage is not available on this system.')
        secret = this.cipher.encrypt(request.appSecret)
      }
      return {
        ...config,
        enabled: request.enabled,
        domain: request.domain,
        appId: request.appId,
        ...(secret === undefined ? {} : { secret })
      }
    })
  }

  async credentials(): Promise<{ domain: LarkDomain; appId: string; appSecret: string } | undefined> {
    const config = await this.settledConfig()
    if (!config.enabled || config.appId === '' || config.secret === undefined || config.secret === '') return undefined
    try {
      return { domain: config.domain, appId: config.appId, appSecret: this.cipher.decrypt(config.secret) }
    } catch (error) {
      console.error('LarkStore: could not decrypt the stored App Secret.')
      return undefined
    }
  }

  startPairing(role: 'owner' | 'member'): Promise<void> {
    return this.mutateConfig((config) => {
      if (role === 'member' && !config.members.some((member) => member.role === 'owner')) throw new Error('Bind an owner first.')
      const code = String(this.random(1_000_000)).padStart(6, '0')
      const expiresAt = new Date(this.clock().getTime() + LARK_PAIRING_TTL_MS).toISOString()
      return { ...config, pairing: { code, role, expiresAt, failures: 0 } }
    })
  }

  async redeemPairing(code: string, openId: string, name: string): Promise<'added' | 'invalid'> {
    let outcome: 'added' | 'invalid' = 'invalid'
    await this.mutateConfig((config) => {
      const pairing = config.pairing
      if (pairing === undefined || Date.parse(pairing.expiresAt) < this.clock().getTime()) return config
      if (pairing.code !== code) {
        const failures = pairing.failures + 1
        if (failures >= LARK_PAIRING_MAX_FAILURES) {
          const { pairing: _spent, ...rest } = config
          return rest
        }
        return { ...config, pairing: { ...pairing, failures } }
      }
      outcome = 'added'
      const { pairing: _used, ...withoutPairing } = config
      // The owner redeeming a member code consumes it but must never be demoted.
      if (pairing.role === 'member' && config.members.some((member) => member.openId === openId && member.role === 'owner')) return withoutPairing
      const entry: LarkMember = { openId, name, role: pairing.role, addedAt: this.clock().toISOString() }
      const previous = config.members.find((member) => member.openId === openId)
      const others = config.members.filter(
        (member) => member.openId !== openId && !(pairing.role === 'owner' && member.role === 'owner')
      )
      const kept = previous === undefined ? entry : { ...entry, addedAt: previous.addedAt }
      return { ...withoutPairing, members: [...others, kept] }
    })
    return outcome
  }

  /**
   * Drops the pending code when `text` carries its six digits (spaces ignored). Called for every
   * message the bot sees that does not redeem the code: once a code has been posted anywhere
   * else (a group message without the mention, a stale or malformed bind), anyone who read it
   * could redeem it, so it is spent. Resolves true when a code was dropped.
   */
  async invalidatePairingIfContains(text: string): Promise<boolean> {
    let dropped = false
    const compact = text.replace(/\s+/gu, '')
    await this.mutateConfig((config) => {
      const pairing = config.pairing
      if (pairing === undefined || !(text.includes(pairing.code) || compact.includes(pairing.code))) return config
      dropped = true
      const { pairing: _leaked, ...rest } = config
      return rest
    })
    return dropped
  }

  removeMember(openId: string): Promise<void> {
    return this.mutateConfig((config) => {
      const removesOwner = config.members.some((member) => member.openId === openId && member.role === 'owner')
      const { pairing: _pairing, ...rest } = config
      return {
        ...(removesOwner ? rest : config),
        members: config.members.filter((member) => member.openId !== openId)
      }
    })
  }

  async memberFor(openId: string): Promise<LarkMember | undefined> {
    return (await this.settledConfig()).members.find((member) => member.openId === openId)
  }

  async owner(): Promise<LarkMember | undefined> {
    return (await this.settledConfig()).members.find((member) => member.role === 'owner')
  }

  async markProcessed(messageId: string): Promise<boolean> {
    let fresh = false
    await this.serialize(async () => {
      const path = join(this.directory, 'processed.json')
      const ids = await this.readJson(path, processedSchema, (file) => file.ids, [], 'strict')
      if (ids.includes(messageId)) return
      fresh = true
      await this.writeJson(path, { version: 1, ids: [...ids, messageId].slice(-LARK_PROCESSED_LIMIT) })
    })
    return fresh
  }

  async lastOnlineAt(): Promise<Date | undefined> {
    const stored = (await this.settledConfig()).lastOnlineAt
    return stored === undefined ? undefined : new Date(stored)
  }

  setLastOnlineAt(date: Date): Promise<void> {
    return this.mutateConfig((config) => ({ ...config, lastOnlineAt: date.toISOString() }))
  }

  async knownChats(): Promise<string[]> {
    return (await this.settledConfig()).knownChats ?? []
  }

  /** Remembers a chat that has produced a processed message, most recent last, bounded. */
  addKnownChat(chatId: string): Promise<void> {
    return this.mutateConfig((config) => ({
      ...config,
      knownChats: [...(config.knownChats ?? []).filter((id) => id !== chatId), chatId].slice(-LARK_KNOWN_CHATS_LIMIT)
    }))
  }

  linkSession(link: LarkSessionLink): Promise<void> {
    return this.mutateLinks((links) => [...links.filter((entry) => entry.sessionId !== link.sessionId), link])
  }

  async sessionLink(sessionId: string): Promise<LarkSessionLink | undefined> {
    await this.queue.catch(() => undefined)
    return (await this.readLinks()).find((link) => link.sessionId === sessionId)
  }

  async sessionLinks(): Promise<LarkSessionLink[]> {
    await this.queue.catch(() => undefined)
    return this.readLinks()
  }

  /**
   * The session whose conversation contains one of `messageIds` (the trigger, a bot reply or a
   * follow-up), most recently linked first. Undefined ids are skipped.
   */
  async sessionLinkForMessage(messageIds: ReadonlyArray<string | undefined>): Promise<LarkSessionLink | undefined> {
    const wanted = new Set(messageIds.filter((id): id is string => id !== undefined && id !== ''))
    if (wanted.size === 0) return undefined
    const links = await this.sessionLinks()
    return [...links].reverse().find((link) => wanted.has(link.triggerMessageId) || (link.messageIds ?? []).some((id) => wanted.has(id)))
  }

  /** `undefined` in the patch clears that field. */
  updateSessionLink(sessionId: string, patch: LarkSessionLinkPatch): Promise<void> {
    return this.mutateLinks((links) =>
      links.map((link) => {
        if (link.sessionId !== sessionId) return link
        const next: LarkSessionLink = { ...link, ...patch }
        for (const key of Object.keys(patch) as Array<keyof LarkSessionLinkPatch>) {
          if (patch[key] === undefined) delete next[key]
        }
        return next
      })
    )
  }

  /** Remembers a message of the session's conversation, so a reply to it is recognised. */
  addSessionMessage(sessionId: string, messageId: string): Promise<void> {
    return this.mutateLinks((links) =>
      links.map((link) =>
        link.sessionId === sessionId
          ? { ...link, messageIds: [...(link.messageIds ?? []).filter((id) => id !== messageId), messageId].slice(-LARK_LINK_MESSAGE_LIMIT) }
          : link
      )
    )
  }

  removeSessionLink(sessionId: string): Promise<void> {
    return this.mutateLinks((links) => links.filter((link) => link.sessionId !== sessionId))
  }

  // Runs `task` after everything queued before it. The returned promise carries the task's own
  // failure, but the chain itself always recovers so one throw does not wedge later writes.
  private serialize(task: () => Promise<void>): Promise<void> {
    const next = this.queue.catch(() => undefined).then(task)
    this.queue = next
    return next
  }

  // `change` returning the very object it was given means "nothing to do": no write.
  private mutateConfig(change: (config: LarkConfig) => LarkConfig): Promise<void> {
    return this.serialize(async () => {
      const current = await this.readConfig('strict')
      const next = change(current)
      if (next === current) return
      await this.writeJson(join(this.directory, 'config.json'), next)
    })
  }

  private mutateLinks(change: (links: LarkSessionLink[]) => LarkSessionLink[]): Promise<void> {
    return this.serialize(async () => {
      await this.writeJson(join(this.directory, 'sessions.json'), { version: 1, links: change(await this.readLinks('strict')) })
    })
  }

  // Public reads wait for queued writes so they never see a half-applied state; the writers
  // themselves run inside the queue and must use readConfig directly.
  private async settledConfig(): Promise<LarkConfig> {
    await this.queue.catch(() => undefined)
    return this.readConfig()
  }

  private readConfig(mode: ReadMode = 'lenient'): Promise<LarkConfig> {
    return this.readJson(join(this.directory, 'config.json'), configSchema, (file) => file, emptyConfig(), mode)
  }

  private async readLinks(mode: ReadMode = 'lenient'): Promise<LarkSessionLink[]> {
    return this.readJson(
      join(this.directory, 'sessions.json'),
      sessionsSchema,
      (file) =>
        file.links.flatMap((entry) => {
          const parsed = sessionLinkSchema.safeParse(entry)
          return parsed.success ? [parsed.data] : []
        }),
      [],
      mode
    )
  }

  private async readJson<File, Result>(
    path: string,
    schema: z.ZodType<File>,
    pick: (file: File) => Result,
    empty: Result,
    mode: ReadMode = 'lenient'
  ): Promise<Result> {
    let text: string
    try {
      text = await this.read(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty
      console.error(`LarkStore: could not read ${path}.`, (error as Error).name)
      if (mode === 'strict') throw new Error(`Could not read ${path}; not overwriting it.`)
      return empty
    }
    try {
      return pick(schema.parse(JSON.parse(text)))
    } catch (error) {
      // Not the error itself: a JSON parse message can quote a snippet of the file, which may be ciphertext.
      console.error(`LarkStore: ignoring unreadable ${path} (${(error as Error).name}).`)
      return empty
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' })
  }
}
