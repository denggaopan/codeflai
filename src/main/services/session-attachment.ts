import type { TerminalReplay } from '../../shared/pty-protocol'
import type { SessionTerminal } from './session-coordinator'
import type { PtyHostConnectResult } from './pty-host-client'

export type TerminalImplementation = SessionTerminal & {
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  isRunning(sessionId: string): boolean
  replay?(sessionId: string): Promise<TerminalReplay>
}

type SessionAttachmentOptions = {
  terminal: { bind(target: TerminalImplementation): void }
  coordinator: { reconcile(liveSessionIds: ReadonlySet<string>, options: { autoResume: boolean }): Promise<unknown> }
  client: TerminalImplementation & { connect(): Promise<PtyHostConnectResult> }
  fallback: TerminalImplementation
  onHostAttached?: (pid: number) => void
}

export const attachSessions = async ({ terminal, coordinator, client, fallback, onHostAttached }: SessionAttachmentOptions): Promise<void> => {
  const attachment = await client.connect()
  if (attachment.status === 'incompatible') {
    // A live host may own every saved session. Neither automatic nor manual fallback is safe.
    throw new Error(`${attachment.message}\nCodeflai has kept your sessions unchanged. Close the old application and retry; if the terminal host remains unresponsive, restart the computer after saving your work.`)
  }
  let liveSessionIds: ReadonlySet<string> = new Set()
  if (attachment.status === 'connected') {
    terminal.bind(client)
    onHostAttached?.(attachment.hostPid)
    liveSessionIds = new Set(attachment.sessions.map((session) => session.sessionId))
  } else {
    console.error(`Codeflai: running without a pty-host: ${attachment.message} Sessions will not outlive this window.`)
    terminal.bind(fallback)
  }
  await coordinator.reconcile(liveSessionIds, { autoResume: true })
}
