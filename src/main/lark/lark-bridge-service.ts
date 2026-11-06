import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { AppState, LarkConnection, LarkStatus, SessionKind, SessionRecord } from '../../shared/contracts'
import type { CommandRunner } from '../infrastructure/command-runner'
import type { CreateSessionOptions } from '../services/session-coordinator'
import { extractMessageText, parseLarkCommand, type LarkCommand } from './lark-command'
import type { LarkClient, LarkIncomingMessage } from './lark-client'
import {
  buildLarkTaskPrompt,
  formatChangeList,
  larkSessionTitle,
  parseChangedFiles,
  type ChangedFile,
  type LarkQuote
} from './lark-prompt'
import { WorktreeRequiredError } from '../services/session-coordinator'
import { agentMissingReply, exitReply, idleReply, LARK_REPLY, startedReply, type LarkAgent } from './lark-replies'
import type { LarkStore } from './lark-store'

export const LARK_STALE_MESSAGE_MS = 5 * 60_000

const UNKNOWN_NAME = '群成员'
// Lark image keys are opaque tokens; one that is not is never passed to the API or into a path.
const SAFE_IMAGE_KEY = /^[A-Za-z0-9_-]+$/u

export interface LarkSessionSource {
  snapshot(): Promise<AppState>
  create(projectId: string, kind: SessionKind, options: CreateSessionOptions): Promise<SessionRecord>
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
  // Last status seen per session; undefined until the first state arrives (the baseline).
  private statuses?: Map<string, SessionRecord['status']>

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
    this.unsubscribe ??= this.deps.sessions.onStateChanged((state) => this.handleState(state))
    await this.connect()
  }

  async applyConfig(): Promise<void> {
    this.deps.client.disconnect()
    await this.connect()
  }

  status(): Promise<LarkStatus> {
    return this.deps.store.status(this.connection, this.error)
  }

  /** The renderer's Done edge for a session; queued behind inbound work and never throws. */
  async reportIdle(sessionId: string): Promise<void> {
    this.enqueueTask(() => this.idleTask(sessionId))
  }

  private async idleTask(sessionId: string): Promise<void> {
    if (this.disposed) return
    try {
      const link = await this.deps.store.sessionLink(sessionId)
      if (link === undefined || link.baseCommit === '') return
      const record = (await this.deps.sessions.snapshot()).sessions.find((session) => session.id === sessionId)
      if (record === undefined || record.status !== 'running') return
      const files = await this.changedFiles(record.launchPath, link.baseCommit)
      const text = idleReply(link.agent, formatChangeList(files))
      if (text === link.lastReport) return
      if (await this.send(link.triggerMessageId, text)) {
        await this.deps.store.updateSessionLink(sessionId, { lastReport: text })
      }
    } catch (error) {
      console.error(`Lark idle report failed for ${sessionId}:`, error instanceof Error ? error.name : 'unknown error')
    }
  }

  private async changedFiles(cwd: string, baseCommit: string): Promise<ChangedFile[]> {
    const git = ['-c', 'core.quotepath=false']
    const diff = await this.deps.runner.run('git', [...git, 'diff', '--name-status', baseCommit], cwd)
    const untracked = await this.deps.runner.run('git', [...git, 'ls-files', '--others', '--exclude-standard'], cwd)
    return parseChangedFiles(diff.stdout, untracked.stdout)
  }

  // Runs on the queue so a report never interleaves with a create for the same session.
  private handleState(state: AppState): void {
    this.enqueueTask(() => this.stateTask(state))
  }

  private async stateTask(state: AppState): Promise<void> {
    if (this.disposed) return
    const previous = this.statuses
    const next = new Map(state.sessions.map((session) => [session.id, session.status] as const))
    this.statuses = next
    if (previous === undefined) return // the first state is only a baseline

    for (const session of state.sessions) {
      const before = previous.get(session.id)
      if (!(before === 'running' || before === 'creating')) continue
      if (!(session.status === 'stopped' || session.status === 'error')) continue
      await this.exitTask(session)
    }
    // Only sessions seen in an earlier state can disappear; a state that merely predates a
    // just-linked session must not unlink it.
    for (const id of previous.keys()) {
      if (!next.has(id)) await this.forget(id)
    }
  }

  private async exitTask(session: SessionRecord): Promise<void> {
    try {
      const link = await this.deps.store.sessionLink(session.id)
      if (link === undefined) return
      const files = link.baseCommit === '' ? [] : await this.changedFiles(session.launchPath, link.baseCommit).catch(() => [])
      await this.send(link.triggerMessageId, exitReply(formatChangeList(files)))
    } catch (error) {
      console.error(`Lark exit report failed for ${session.id}:`, error instanceof Error ? error.name : 'unknown error')
    }
  }

  private async forget(sessionId: string): Promise<void> {
    try {
      const link = await this.deps.store.sessionLink(sessionId)
      if (link === undefined) return
      await this.deps.store.removeSessionLink(sessionId)
      await rm(this.deps.store.attachmentDirectory(link.triggerMessageId), { recursive: true, force: true })
    } catch (error) {
      console.error(`Lark could not forget session ${sessionId}:`, error instanceof Error ? error.name : 'unknown error')
    }
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
    await this.send(messageId, text)
  }

  private async send(messageId: string, text: string): Promise<boolean> {
    try {
      await this.deps.client.reply(messageId, text)
      return true
    } catch (error) {
      console.error(`Lark reply failed for ${messageId}:`, error instanceof Error ? error.name : 'unknown error')
      return false
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
    const bind = parseLarkCommand(text, [])
    if (bind.type === 'bind') {
      const code = bind.code
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

    let command: LarkCommand
    try {
      const projects = (await this.deps.sessions.snapshot()).projects.map((project) => ({ id: project.id, name: project.name }))
      command = parseLarkCommand(text, projects)
      if (command.type === 'run' && !(await this.deps.agentAvailable(command.agent))) {
        await this.reply(incoming.messageId, agentMissingReply(command.agent))
        return
      }
    } catch (error) {
      console.error(`Lark could not prepare ${incoming.messageId}:`, error instanceof Error ? error.name : 'unknown error')
      await this.reply(incoming.messageId, LARK_REPLY.startFailed)
      return
    }
    if (command.type === 'bind') return // unreachable: handled above
    if (command.type === 'error') {
      await this.reply(incoming.messageId, LARK_REPLY[command.reason])
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
    let attachments: string | undefined
    const discardAttachments = (): Promise<void> =>
      attachments === undefined ? Promise.resolve() : rm(attachments, { recursive: true, force: true }).catch(() => undefined)
    let created: { record: SessionRecord; requesterName: string } | undefined

    try {
      attachments = store.attachmentDirectory(incoming.messageId)
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
          if (!SAFE_IMAGE_KEY.test(source.key)) {
            console.error(`Lark dropped an image with an invalid key for ${incoming.messageId}.`)
            continue
          }
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
          requireWorktree: true,
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
        await discardAttachments()
        if (error instanceof WorktreeRequiredError) {
          await this.reply(incoming.messageId, LARK_REPLY.notGit)
          return
        }
        console.error(`Lark session create failed for ${incoming.messageId}:`, error instanceof Error ? error.message : 'unknown error')
        await this.reply(incoming.messageId, LARK_REPLY.startFailed)
        return
      }
      created = { record, requesterName }
    } catch (error) {
      console.error(`Lark run failed for ${incoming.messageId}:`, error instanceof Error ? error.message : 'unknown error')
      await discardAttachments()
      await this.reply(incoming.messageId, LARK_REPLY.startFailed)
      return
    }

    // The session is running from here on: nothing below may tear it down or claim it failed.
    const { record, requesterName } = created
    let baseCommit = ''
    try {
      baseCommit = (await this.deps.runner.run('git', ['rev-parse', 'HEAD'], record.launchPath)).stdout.trim()
    } catch (error) {
      console.error(`Lark could not read the base commit for ${record.id}:`, error instanceof Error ? error.name : 'unknown error')
    }
    try {
      await store.linkSession({
        sessionId: record.id,
        chatId: incoming.chatId,
        triggerMessageId: incoming.messageId,
        baseCommit,
        agent: command.agent
      })
    } catch (error) {
      console.error(`Lark could not link session ${record.id}:`, error instanceof Error ? error.name : 'unknown error')
    }

    let ownerName = UNKNOWN_NAME
    try {
      ownerName = (await store.owner())?.name || UNKNOWN_NAME
    } catch (error) {
      console.error(`Lark could not read the owner for session ${record.id}:`, error instanceof Error ? error.name : 'unknown error')
    }
    await this.reply(
      incoming.messageId,
      startedReply({
        agent: command.agent,
        projectName: command.projectName,
        branch: record.mode === 'worktree' ? record.branchName : '',
        ...(requesterIsOwner ? {} : { requesterName }),
        ownerName
      })
    )
  }
}
