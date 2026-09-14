import type { HostPlatform, ShutdownResult } from '../../shared/contracts'
import { commandRunner, type CommandRunner } from '../infrastructure/command-runner'

/**
 * How long the shutdown command gets before it is given up on. The machine normally starts
 * going down long before this: `shutdown /t 0` returns as soon as Windows has accepted the
 * request, and the AppleScript equivalent returns once System Events has it. A command still
 * running after this has not been accepted, and the user needs to be told rather than left
 * watching a dialog that already dismissed itself.
 */
export const SHUTDOWN_TIMEOUT_MS = 15_000

/**
 * The forced-shutdown command per platform.
 *
 * Windows: `/s` shuts down, `/f` forces running applications closed (which is what makes it
 * a *forced* shutdown — without it a single application refusing to close aborts the whole
 * thing), `/t 0` skips the OS's own one-minute warning, since Codeflai has already run its
 * own ten-second countdown by the time this is called.
 *
 * macOS has no unprivileged equivalent — `shutdown -h now` needs root — so the request goes
 * through System Events, the same path the Apple menu's "Shut Down…" uses. Applications may
 * still put up their own save prompts there; that is as forceful as it gets without asking
 * the user for an administrator password.
 */
const SHUTDOWN_COMMANDS: Readonly<Record<HostPlatform, { file: string; args: readonly string[] }>> = {
  win32: { file: 'shutdown', args: ['/s', '/f', '/t', '0'] },
  darwin: { file: 'osascript', args: ['-e', 'tell application "System Events" to shut down'] }
}

/**
 * Shuts the host machine down on behalf of the renderer's auto-shutdown watcher.
 *
 * Like AppInfoService and UpdaterService this **never rejects**: a refusal (no permission, a
 * group policy that blocks the command) is folded into an `error` result carrying a message
 * the renderer can show, because the caller is a background timer whose only other option
 * would be an unhandled rejection nobody reads.
 *
 * The renderer can only ask for *this* command: nothing about it crosses IPC, exactly like
 * the updater resolving its own installer URL. There is no argument to smuggle a different
 * command through.
 */
export class PowerService {
  constructor(
    private readonly runner: CommandRunner = commandRunner,
    private readonly platform: HostPlatform = process.platform === 'darwin' ? 'darwin' : 'win32'
  ) {}

  async shutdown(): Promise<ShutdownResult> {
    const command = SHUTDOWN_COMMANDS[this.platform]
    try {
      await this.runner.run(command.file, command.args, undefined, { timeoutMs: SHUTDOWN_TIMEOUT_MS })
      return { status: 'launched' }
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  }
}
