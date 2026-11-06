import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { AppState, DeleteSessionResult, LarkConnection, LarkStatus, SessionKind, SessionRecord } from '../../shared/contracts'
import type { CommandRunner } from '../infrastructure/command-runner'
import type { CreateSessionOptions } from '../services/session-coordinator'
import { extractMessageText, parseLarkCommand, type LarkCommand } from './lark-command'
import type { LarkClient, LarkIncomingMessage } from './lark-client'
import { buildLarkTaskPrompt, larkSessionTitle, type LarkQuote } from './lark-prompt'
import { agentMissingReply, LARK_REPLY, startedReply, type LarkAgent } from './lark-replies'
import type { LarkStore } from './lark-store'

export const LARK_STALE_MESSAGE_MS = 5 * 60_000

const UNKNOWN_NAME = '群成员'

export interface LarkSessionSource {
  snapshot(): Promise<AppState>
  create(projectId: string, kind: SessionKind, options: CreateSessionOptions): Promise<SessionRecord>
  delete(sessionId: string): Promise<DeleteSessionResult>
  onStateChanged(listener: (state: AppState) => void): () => void
}

export type AgentAvailability = (agent: LarkAgent) => Promise<boolean>

type RunCommand = Extract<LarkCommand, { type: 'run' }>

/**
 * Turns a chat message into a fully-permissioned agent session on this computer, so every step
 * fails closed: a message is acted on only after it is fresh, unseen, and sent by a bound member.
 * Messages are handled one at a time in arrival order, and nothing escapes the queue as a
 * rejection.
 */
export class LarkBridgeService {
  private queue: Promise<void> = Promise.resolve()
  private connection: LarkConnection = 'off'
  private error?: string
  private disposed = false
  private unsubscribe?: () => void

  constructor(
    private readonly deps: {
      store: LarkStore
      client: LarkClient
      sessions: LarkSessionSource
      runner: CommandRunner
      agentAvailable: AgentAvailability
      clock?: () => Date
      onStatus?: (status: LarkStatus) => void
    }
  ) {}

  async start(): Promise<void> {
    this.unsubscribe ??= this.deps.sessions.onStateChanged(() => undefined)
    await this.connect()
  }

  async applyConfig(): Promise<void> {
    this.deps.client.disconnect()
    await this.connect()
  }

  status(): Promise<LarkStatus> {
    return this.deps.store.status(this.connection, this.error)
  }

  // Task 8 reports idle sessions back to the chat.
  async reportIdle(_sessionId: string): Promise<void> {
    return undefined
  }

  /** Resolves once everything queued so far has been handled. */
  async whenIdle(): Promise<void> {
    await this.queue
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.deps.client.disconnect()
  }

  private async connect(): Promise<void> {
    const credentials = await this.deps.store.credentials()
    if (credentials === undefined) {
      await this.setConnection('off')
      return
    }
    this.deps.client.connect(
      credentials,
      (incoming) => this.enqueue(incoming),
      (state, error) => {
        this.enqueueTask(() => this.setConnection(state, error))
      }
    )
  }

  private async setConnection(connection: LarkConnection, error?: string): Promise<void> {
    this.connection = connection
    this.error = error
    this.deps.onStatus?.(await this.deps.store.status(connection, error))
  }

  // Never throws and returns at once: the SDK's ack window must not depend on our work.
  private enqueue(incoming: LarkIncomingMessage): void {
    this.enqueueTask(() => this.handle(incoming))
  }

  private enqueueTask(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      console.error('Lark bridge task failed:', error instanceof Error ? error.name : 'unknown error')
    })
  }

  private async reply(messageId: string, text: string): Promise<void> {
    try {
      await this.deps.client.reply(messageId, text)
    } catch (error) {
      console.error(`Lark reply failed for ${messageId}:`, error instanceof Error ? error.name : 'unknown error')
    }
  }

  private async handle(incoming: LarkIncomingMessage): Promise<void> {
    if (this.disposed) return
    if (!incoming.mentionsBot || incoming.senderType !== 'user' || !incoming.senderOpenId) return
    const openId = incoming.senderOpenId
    const { store, client } = this.deps

    if (!(await store.markProcessed(incoming.messageId))) return

    const now = (this.deps.clock?.() ?? new Date()).getTime()
    if (!(Number.isFinite(incoming.createTimeMs) && now - incoming.createTimeMs <= LARK_STALE_MESSAGE_MS)) {
      await this.reply(incoming.messageId, LARK_REPLY.stale)
      return
    }

    const own = extractMessageText(incoming.messageType, incoming.content)
    const text = own?.text ?? ''

    // Binding comes before the whitelist: it is how a member gets onto it.
    if (parseLarkCommand(text, []).type === 'bind') {
      const code = /\d{6}/u.exec(text)?.[0] ?? ''
      const name = (await client.userName(openId)) ?? ''
      const outcome = await store.redeemPairing(code, openId, name)
      await this.reply(incoming.messageId, outcome === 'added' ? LARK_REPLY.bound : LARK_REPLY.bindInvalid)
      return
    }

    if ((await store.owner()) === undefined) {
      await this.reply(incoming.messageId, LARK_REPLY.unbound)
      return
    }
    const member = await store.memberFor(openId)
    if (member === undefined) {
      await this.reply(incoming.messageId, LARK_REPLY.denied)
      return
    }

    const projects = (await this.deps.sessions.snapshot()).projects.map((project) => ({ id: project.id, name: project.name }))
    const command = parseLarkCommand(text, projects)
    if (command.type === 'bind') return // unreachable: handled above
    if (command.type === 'error') {
      await this.reply(incoming.messageId, LARK_REPLY[command.reason])
      return
    }

    if (!(await this.deps.agentAvailable(command.agent))) {
      await this.reply(incoming.messageId, agentMissingReply(command.agent))
      return
    }

    await this.run(incoming, command, member.role === 'owner', member.name, own?.imageKeys ?? [])
  }

  private async run(
    incoming: LarkIncomingMessage,
    command: RunCommand,
    requesterIsOwner: boolean,
    storedName: string,
    ownImageKeys: string[]
  ): Promise<void> {
    const { store, client, sessions } = this.deps
    const openId = incoming.senderOpenId ?? ''
    const attachments = store.attachmentDirectory(incoming.messageId)
    const discardAttachments = (): Promise<void> => rm(attachments, { recursive: true, force: true }).catch(() => undefined)

    try {
      const requesterName = (await client.userName(openId)) ?? (storedName !== '' ? storedName : UNKNOWN_NAME)

      let quoteText: string | undefined
      let quoteSender = UNKNOWN_NAME
      let quoteImageKeys: string[] = []
      if (incoming.parentId) {
        const parent = await client.getMessage(incoming.parentId)
        const extracted = parent === undefined ? undefined : extractMessageText(parent.messageType, parent.content)
        if (parent !== undefined && extracted !== undefined) {
          quoteText = extracted.text
          quoteImageKeys = extracted.imageKeys
          if (parent.senderOpenId) quoteSender = (await client.userName(parent.senderOpenId)) ?? UNKNOWN_NAME
        }
      }

      // Own images first, then the quote's; a failed download only drops that image.
      const sources = [
        ...ownImageKeys.map((key) => ({ messageId: incoming.messageId, key, own: true })),
        ...quoteImageKeys.map((key) => ({ messageId: incoming.parentId ?? incoming.messageId, key, own: false }))
      ]
      const ownPaths: string[] = []
      const quotePaths: string[] = []
      if (sources.length > 0) {
        await mkdir(attachments, { recursive: true })
        for (const [index, source] of sources.entries()) {
          const target = join(attachments, `${index}.png`)
          try {
            await client.downloadImage(source.messageId, source.key, target)
            ;(source.own ? ownPaths : quotePaths).push(target)
          } catch (error) {
            console.error(`Lark image download failed for ${incoming.messageId}:`, error instanceof Error ? error.name : 'unknown error')
          }
        }
      }

      const quote: LarkQuote | undefined =
        quoteText === undefined || (quoteText === '' && quotePaths.length === 0)
          ? undefined
          : { senderName: quoteSender, text: quoteText, imagePaths: quotePaths }

      const titleInput = {
        ...(requesterIsOwner ? {} : { requesterName }),
        instruction: command.instruction,
        ...(quoteText === undefined ? {} : { quoteText })
      }
      let record: SessionRecord
      try {
        record = await sessions.create(command.projectId, command.agent, {
          worktree: true,
          title: larkSessionTitle(titleInput),
          taskPrompt: {
            text: buildLarkTaskPrompt({
              requesterName,
              instruction: command.instruction,
              ...(quote === undefined ? {} : { quote }),
              imagePaths: ownPaths
            }),
            ...(command.skill === undefined ? {} : { skill: command.skill })
          }
        })
      } catch (error) {
        console.error(`Lark session create failed for ${incoming.messageId}:`, error instanceof Error ? error.message : 'unknown error')
        await discardAttachments()
        await this.reply(incoming.messageId, LARK_REPLY.startFailed)
        return
      }

      if (record.mode !== 'worktree') {
        await discardAttachments()
        try {
          await sessions.delete(record.id)
        } catch (error) {
          console.error(`Lark could not delete the ordinary session ${record.id}:`, error instanceof Error ? error.message : 'unknown error')
        }
        await this.reply(incoming.messageId, LARK_REPLY.notGit)
        return
      }

      let baseCommit = ''
      try {
        baseCommit = (await this.deps.runner.run('git', ['rev-parse', 'HEAD'], record.launchPath)).stdout.trim()
      } catch (error) {
        console.error(`Lark could not read the base commit for ${record.id}:`, error instanceof Error ? error.name : 'unknown error')
      }
      await store.linkSession({
        sessionId: record.id,
        chatId: incoming.chatId,
        triggerMessageId: incoming.messageId,
        baseCommit,
        agent: command.agent
      })

      const owner = await store.owner()
      await this.reply(
        incoming.messageId,
        startedReply({
          agent: command.agent,
          projectName: command.projectName,
          branch: record.branchName,
          ...(requesterIsOwner ? {} : { requesterName }),
          ownerName: owner?.name || UNKNOWN_NAME
        })
      )
    } catch (error) {
      console.error(`Lark run failed for ${incoming.messageId}:`, error instanceof Error ? error.message : 'unknown error')
      await discardAttachments()
      await this.reply(incoming.messageId, LARK_REPLY.startFailed)
    }
  }
}
