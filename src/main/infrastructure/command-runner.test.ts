import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { COMMAND_MAX_BUFFER_BYTES, CommandError, commandRunner } from './command-runner'

describe('commandRunner', () => {
  it('preserves UTF-8 stdout and stderr from a successful child', async () => {
    const result = await commandRunner.run(process.execPath, ['-e', "process.stdout.write('out \\u00e9\\n'); process.stderr.write('err \\u6f22\\n')"])

    expect(result).toEqual({ stdout: 'out \u00e9\n', stderr: 'err \u6f22\n', exitCode: 0 })
  })

  it('reports nonzero child output in a CommandError', async () => {
    const file = process.execPath
    const args = ['-e', "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"]

    await expect(commandRunner.run(file, args)).rejects.toMatchObject({
      file,
      args,
      result: { stdout: 'out', stderr: 'err', exitCode: 7 }
    } satisfies Partial<CommandError>)
  })

  it('passes metacharacters as one literal argument without a shell', async () => {
    const literal = 'hello world & echo injected; $(nope)'
    const result = await commandRunner.run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal])

    expect(result.stdout).toBe(literal)
  })

  it('overrides a child environment variable without dropping inherited variables', async () => {
    const result = await commandRunner.run(process.execPath, ['-e', "process.stdout.write(JSON.stringify({ prompt: process.env.GIT_TERMINAL_PROMPT, inherited: !!(process.env.PATH || process.env.Path) }))"], undefined, {
      env: { GIT_TERMINAL_PROMPT: '0' }
    })
    expect(JSON.parse(result.stdout)).toEqual({ prompt: '0', inherited: true })
  })

  it('retains spawn diagnostics for a missing executable', async () => {
    const file = `codeflai-missing-${process.pid}.exe`

    await expect(commandRunner.run(file, [])).rejects.toMatchObject({
      file,
      code: expect.any(String),
      result: { stdout: '', stderr: '', exitCode: -1 },
      cause: expect.any(Error)
    } satisfies Partial<CommandError>)
  })

  it('limits command output and retains overflow diagnostics', async () => {
    await expect(commandRunner.run(process.execPath, ['-e', `process.stdout.write('x'.repeat(${COMMAND_MAX_BUFFER_BYTES + 1}))`])).rejects.toMatchObject({
      result: { stdout: expect.any(String), stderr: expect.any(String), exitCode: -1 },
      cause: expect.any(Error)
    } satisfies Partial<CommandError>)
  })

  it('terminates a command that exceeds its requested timeout', async () => {
    await expect(
      commandRunner.run(process.execPath, ['-e', 'setTimeout(() => undefined, 500)'], undefined, { timeoutMs: 20 })
    ).rejects.toMatchObject({
      signal: 'SIGTERM',
      result: { stdout: '', stderr: '', exitCode: -1 }
    } satisfies Partial<CommandError>)
  })
})

describe('commandRunner: idle timeout', () => {
  it('terminates a command that stops producing output', async () => {
    await expect(
      commandRunner.run(process.execPath, ['-e', "process.stderr.write('start\\n'); setTimeout(() => undefined, 5000)"], undefined, { idleTimeoutMs: 100 })
    ).rejects.toMatchObject({
      reason: 'idle-timeout',
      result: { stdout: '', stderr: 'start\n', exitCode: -1 }
    } satisfies Partial<CommandError>)
  })

  it('keeps a slow command alive while it still writes output', async () => {
    const result = await commandRunner.run(
      process.execPath,
      ['-e', "let n = 0; const t = setInterval(() => { process.stderr.write('tick\\n'); if (++n === 80) clearInterval(t) }, 25)"],
      undefined,
      { idleTimeoutMs: 1500 }
    )

    // Eighty ticks span ~2s, well past the idle window, while each 25ms gap keeps a 60x margin.
    // The margin has to be this large because the full suite saturates the CPU running test
    // files in parallel, and a starved setInterval is what a tighter version trips over.
    expect(result.stderr.trimEnd().split('\n')).toHaveLength(80)
    expect(result.exitCode).toBe(0)
  }, 30_000)
})

describe('commandRunner: cancellation', () => {
  it('rejects with a cancelled reason when the caller aborts', async () => {
    const controller = new AbortController()
    const pending = commandRunner.run(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], undefined, { signal: controller.signal })
    setTimeout(() => controller.abort(), 50)

    await expect(pending).rejects.toMatchObject({ reason: 'cancelled' } satisfies Partial<CommandError>)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    await expect(
      commandRunner.run(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], undefined, { signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ reason: 'cancelled' } satisfies Partial<CommandError>)
  })
})

// Windows-only: POSIX kill() still targets the single process, which is acceptable because
// git propagates SIGTERM there. On Windows nothing propagates, so the tree kill is the whole
// point -- an orphaned git-remote-https keeps the connection and the partial clone alive.
describe.skipIf(process.platform !== 'win32')('commandRunner: cancellation kills the process tree', () => {
  it('stops a grandchild that the parent left running', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codeflai-killtree-'))
    try {
      const marker = join(directory, 'alive.log')
      const grandchild = join(directory, 'grandchild.cjs')
      const parent = join(directory, 'parent.cjs')
      await writeFile(grandchild, `const fs = require('node:fs'); setInterval(() => fs.appendFileSync(${JSON.stringify(marker)}, 'x'), 20)`)
      // detached escapes libuv's job object, whose KILL_ON_JOB_CLOSE would otherwise take the
      // grandchild down for free. git spawns git-remote-https with a plain CreateProcess and
      // gets no such cleanup, so only a detached grandchild reproduces the leak being guarded.
      await writeFile(parent, `require('node:child_process').spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: 'ignore', detached: true }); setInterval(() => undefined, 1000)`)

      const controller = new AbortController()
      const pending = commandRunner.run(process.execPath, [parent], undefined, { signal: controller.signal })
      await new Promise((done) => setTimeout(done, 300))
      controller.abort()
      await expect(pending).rejects.toMatchObject({ reason: 'cancelled' } satisfies Partial<CommandError>)

      await new Promise((done) => setTimeout(done, 300))
      const afterKill = (await readFile(marker, 'utf8')).length
      expect(afterKill).toBeGreaterThan(0)
      await new Promise((done) => setTimeout(done, 400))
      expect((await readFile(marker, 'utf8')).length).toBe(afterKill)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('commandRunner: streamed output', () => {
  it('hands the caller each chunk as it arrives, without disturbing the collected result', async () => {
    const chunks: string[] = []

    const result = await commandRunner.run(
      process.execPath,
      ['-e', "process.stderr.write('first|'); setTimeout(() => process.stderr.write('second|'), 40)"],
      undefined,
      { onOutput: (chunk) => chunks.push(chunk) }
    )

    // Arrival in separate chunks is the point; the boundaries themselves are the OS's business.
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks.join('')).toBe('first|second|')
    expect(result.stderr).toBe('first|second|')
  })

  it('keeps feeding the idle timer while streaming, so a live command is not killed', async () => {
    const chunks: string[] = []

    const result = await commandRunner.run(
      process.execPath,
      ['-e', "let n = 0; const t = setInterval(() => { process.stderr.write('.'); if (++n === 40) clearInterval(t) }, 25)"],
      undefined,
      { idleTimeoutMs: 1500, onOutput: (chunk) => chunks.push(chunk) }
    )

    expect(chunks.join('')).toBe('.'.repeat(40))
    expect(result.exitCode).toBe(0)
  }, 30_000)
})
