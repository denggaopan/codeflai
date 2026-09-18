import { execFile, spawn } from 'node:child_process'

export type CommandResult = { stdout: string; stderr: string; exitCode: number }

/**
 * Why a command was terminated by this runner rather than by the child itself. Callers branch
 * on it to tell "the user pressed Cancel" apart from "the transport went silent".
 */
export type CommandFailureReason = 'cancelled' | 'idle-timeout'

export type CommandOptions = {
  timeoutMs?: number
  /**
   * Terminates the child when it produces no output for this long. Only meaningful for commands
   * that report progress continuously -- a silent-by-design command would always trip it.
   */
  idleTimeoutMs?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}
export const COMMAND_MAX_BUFFER_BYTES = 16 * 1024 * 1024

export class CommandError extends Error {
  readonly file: string
  readonly args: readonly string[]
  readonly result: CommandResult
  readonly code?: string | number
  readonly signal?: string
  readonly reason?: CommandFailureReason

  constructor(
    message: string,
    file: string,
    args: readonly string[],
    result: CommandResult,
    error: { code?: string | number; signal?: string | null; reason?: CommandFailureReason }
  ) {
    super(message, { cause: error })
    this.name = 'CommandError'
    this.file = file
    this.args = args
    this.result = result
    this.code = error.code
    this.signal = error.signal ?? undefined
    this.reason = error.reason
  }
}

export interface CommandRunner {
  run(file: string, args: readonly string[], cwd?: string, options?: CommandOptions): Promise<CommandResult>
}

const exitCodeFor = (error: { code?: number | string }): number =>
  typeof error.code === 'number' ? error.code : -1

/**
 * Windows terminates only the named process, so killing `git` leaves its `git-remote-https`
 * child holding the connection and the partially cloned directory. taskkill /T ends the tree.
 */
const killTree = (pid: number | undefined, fallback: () => void): void => {
  if (pid === undefined || process.platform !== 'win32') {
    fallback()
    return
  }
  try {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', fallback)
  } catch {
    fallback()
  }
}

const terminationMessage = (file: string, reason: CommandFailureReason, idleTimeoutMs?: number): string =>
  reason === 'cancelled'
    ? `Command cancelled: ${file}`
    : `Command produced no output for ${idleTimeoutMs}ms: ${file}`

export const commandRunner: CommandRunner = {
  run(file, args, cwd, options) {
    return new Promise((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(new CommandError(terminationMessage(file, 'cancelled'), file, args, { stdout: '', stderr: '', exitCode: -1 }, { reason: 'cancelled' }))
        return
      }

      let reason: CommandFailureReason | undefined
      let idleTimer: NodeJS.Timeout | undefined

      const cleanup = (): void => {
        clearTimeout(idleTimer)
        options?.signal?.removeEventListener('abort', onAbort)
      }

      const child = execFile(
        file,
        [...args],
        {
          cwd,
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: COMMAND_MAX_BUFFER_BYTES,
          ...(options?.env ? { env: { ...process.env, ...options.env } } : {}),
          ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs })
        },
        (error, stdout, stderr) => {
          cleanup()
          // A process we killed has no meaningful exit status: Windows reports whatever
          // taskkill left behind, POSIX reports the signal. Normalize both to -1.
          const result = { stdout, stderr, exitCode: reason ? -1 : error ? exitCodeFor(error) : 0 }
          if (reason) {
            reject(new CommandError(terminationMessage(file, reason, options?.idleTimeoutMs), file, args, result, {
              code: error?.code,
              signal: error?.signal,
              reason
            }))
            return
          }
          if (error) {
            reject(new CommandError(`Command failed: ${file}: ${error.message}`, file, args, result, error))
            return
          }
          resolve(result)
        }
      )

      const terminate = (why: CommandFailureReason): void => {
        reason ??= why
        cleanup()
        killTree(child.pid, () => child.kill())
      }

      function onAbort(): void {
        terminate('cancelled')
      }

      const resetIdleTimer = (): void => {
        if (options?.idleTimeoutMs === undefined) return
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => terminate('idle-timeout'), options.idleTimeoutMs)
      }

      options?.signal?.addEventListener('abort', onAbort, { once: true })
      child.stdout?.on('data', resetIdleTimer)
      child.stderr?.on('data', resetIdleTimer)
      // Start the clock at spawn: a transport that blocks before its first byte is the
      // exact failure this guards against.
      resetIdleTimer()
    })
  }
}
