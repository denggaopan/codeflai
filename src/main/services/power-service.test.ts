import { describe, expect, it } from 'vitest'

import type { CommandOptions, CommandResult, CommandRunner } from '../infrastructure/command-runner'
import { PowerService, SHUTDOWN_TIMEOUT_MS } from './power-service'

type RecordedCommand = { file: string; args: readonly string[]; cwd?: string; options?: CommandOptions }

class FakeCommandRunner implements CommandRunner {
  readonly commands: RecordedCommand[] = []
  failure: Error | undefined

  async run(file: string, args: readonly string[], cwd?: string, options?: CommandOptions): Promise<CommandResult> {
    this.commands.push({ file, args, cwd, options })
    if (this.failure) throw this.failure
    return { stdout: '', stderr: '', exitCode: 0 }
  }
}

describe('PowerService', () => {
  it('forces a Windows shutdown with no warning period', async () => {
    const runner = new FakeCommandRunner()

    expect(await new PowerService(runner, 'win32').shutdown()).toEqual({ status: 'launched' })

    expect(runner.commands).toEqual([
      { file: 'shutdown', args: ['/s', '/f', '/t', '0'], cwd: undefined, options: { timeoutMs: SHUTDOWN_TIMEOUT_MS } }
    ])
  })

  it('shuts macOS down through System Events', async () => {
    const runner = new FakeCommandRunner()

    expect(await new PowerService(runner, 'darwin').shutdown()).toEqual({ status: 'launched' })

    expect(runner.commands[0]?.file).toBe('osascript')
    expect(runner.commands[0]?.args).toEqual(['-e', 'tell application "System Events" to shut down'])
  })

  it('reports a refused shutdown instead of rejecting', async () => {
    const runner = new FakeCommandRunner()
    runner.failure = new Error('Access is denied.')

    expect(await new PowerService(runner, 'win32').shutdown()).toEqual({ status: 'error', message: 'Access is denied.' })
  })

  it('describes a non-Error failure rather than losing it', async () => {
    const runner = new FakeCommandRunner()
    runner.failure = 'blocked by policy' as unknown as Error

    expect(await new PowerService(runner, 'win32').shutdown()).toEqual({ status: 'error', message: 'blocked by policy' })
  })
})
