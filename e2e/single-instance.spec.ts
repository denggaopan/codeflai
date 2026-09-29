import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

const projectRoot = resolve(import.meta.dirname, '..')
const packagedExecutable = process.env.CODEFLAI_TEST_EXECUTABLE
const executable = packagedExecutable ?? (createRequire(import.meta.url)('electron') as string)
const launchArgs = (userDataDir: string): string[] =>
  [...(packagedExecutable ? [] : ['.']), `--user-data-dir=${userDataDir}`]

/**
 * A second Codeflai launched against a profile that is already open — the shortcut clicked
 * after launch-at-login had already opened it, or a double launch — must quit in favour of the
 * running one and hand the user its window. Without that, the second process runs against the
 * same profile: Chromium cannot lock the Local Storage database the first one holds, silently
 * gives the renderer an empty in-memory store, and every preference reads as its default (the
 * quick prompt bar "switched itself off"), while two SessionStores write one state.json.
 *
 * Its own instance, because the whole point is a second process on the shared user-data dir.
 */
test('a second launch quits in favour of the running instance and brings its window back', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'codeflai-single-instance-e2e-'))
  const env = {
    ...process.env,
    CODEFLAI_E2E: '1',
    CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
    CODEFLAI_PTY_HOST_IDLE_MS: '250'
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
    args: launchArgs(userDataDir),
    cwd: projectRoot,
    env
  })
  let second: ChildProcess | undefined
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.title-bar-app-name')).toHaveText('Codeflai')

    // Minimized first, so the hand-over has something observable to do besides focus (which a
    // busy desktop may refuse to a background process).
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized()))
      .toBe(true)

    second = spawn(executable, launchArgs(userDataDir), { cwd: projectRoot, env, stdio: 'ignore' })
    const exitCode = await new Promise<number | null | 'still running'>((resolveExit) => {
      const timer = setTimeout(() => resolveExit('still running'), 20_000)
      second!.once('exit', (code) => {
        clearTimeout(timer)
        resolveExit(code)
      })
    })
    expect(exitCode).toBe(0)

    await expect.poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.isMinimized())),
      { timeout: 10_000 }
    ).toEqual([false])
    // The original symptom's signature: the resident pty-host logging two attached clients. A
    // packaged build stages the host's runtime into the profile before starting it, so the log
    // can appear well after the window did — wait for the first client before reading it.
    const hostLog = (): string => {
      try {
        return readFileSync(join(userDataDir, 'pty-host.log'), 'utf8')
      } catch {
        return ''
      }
    }
    await expect.poll(hostLog, { timeout: 30_000 }).toContain('Client attached (1 connected)')
    expect(hostLog()).not.toContain('2 connected')
  } finally {
    if (second && second.exitCode === null) second.kill()
    await app.close().catch(() => undefined)
  }
})
