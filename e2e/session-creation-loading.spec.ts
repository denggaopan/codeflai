import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

import { createRepo } from './create-repo'

for (const worktree of [false, true]) {
  test(`shows loading throughout ${worktree ? 'worktree' : 'ordinary'} creation and recovers after failure`, async ({}, testInfo) => {
    const profile = mkdtempSync(join(tmpdir(), 'codeflai-creation-loading-'))
    const executablePath = process.env.CODEFLAI_TEST_EXECUTABLE
    const app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
      cwd: resolve('.'),
      env: {
        ...process.env, CODEFLAI_E2E: '1', CODEFLAI_E2E_PROJECT: createRepo(),
        CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'), CODEFLAI_PTY_HOST_IDLE_MS: '250'
      }
    })
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      expect(await app.evaluate(({ app }) => app.getVersion())).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version)
      await expect(page.locator('html')).toHaveAttribute('data-platform', 'win32', { timeout: 20_000 })
      await page.getByRole('button', { name: 'Add Project', exact: true }).click()
      await page.getByRole('button', { name: 'Choose project directory' }).click()

      // Hold IPC at the boundary so loading is deterministic; success still uses the real handler.
      await app.evaluate(({ ipcMain }) => {
        const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
        const original = handlers.get('session:create')!
        const gate = { calls: 0, fail: true, release: () => {} }
        Object.assign(globalThis, { creationGate: gate })
        ipcMain.removeHandler('session:create')
        ipcMain.handle('session:create', async (...args) => {
          gate.calls++
          await new Promise<void>((resolve) => { gate.release = resolve })
          if (gate.fail) throw new Error('Session creation failed for test')
          return original(...args)
        })
      })
      const openLauncher = async () => {
        await page.getByRole('button', { name: /^Project options for / }).click()
        await page.getByRole('menuitem', { name: 'New session', exact: true }).click()
      }
      const entry = page.getByRole('button', { name: worktree ? 'Claude (new worktree)' : 'Claude', exact: true })
      const status = page.locator('.session-creation-status')
      await openLauncher()
      await entry.click()
      await expect(status).toHaveText(/Creating session\.\.\./)
      await expect(entry).toHaveAttribute('aria-busy', 'true')
      await expect(entry).toBeDisabled()
      await expect(status.locator('.session-creation-spinner')).toHaveCSS('animation-name', 'session-creation-spin')
      await page.screenshot({ path: testInfo.outputPath('creating-dark.png') })
      await page.keyboard.press('Escape')
      await expect(page.locator('.session-launcher')).toBeHidden()
      await expect(status).toBeVisible()
      await openLauncher()
      await expect(entry).toBeDisabled()
      await expect(entry).toHaveAttribute('aria-busy', 'true')
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { creationGate: { calls: number } }).creationGate.calls)).toBe(1)

      await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
      await page.screenshot({ path: testInfo.outputPath('creating-light.png') })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(status.locator('.session-creation-spinner')).toHaveCSS('animation-name', 'none')
      await app.evaluate(() => (globalThis as typeof globalThis & { creationGate: { release: () => void } }).creationGate.release())
      await expect(status).toBeHidden()
      await expect(page.getByRole('alert')).toContainText('Session creation failed for test')
      await expect(entry).toBeEnabled()

      await app.evaluate(() => { (globalThis as typeof globalThis & { creationGate: { fail: boolean } }).creationGate.fail = false })
      await entry.click()
      await expect(status).toBeVisible()
      await expect(page.getByRole('alert')).toBeHidden()
      await app.evaluate(() => (globalThis as typeof globalThis & { creationGate: { release: () => void } }).creationGate.release())
      await expect(status).toBeHidden()
      await expect(page.locator('.session-launcher')).toBeHidden()
      await expect(page.locator('.session-row')).toHaveCount(1)
      await expect(page.locator('.terminal-header-status:visible')).toHaveText(/Running|Done/)
      expect(await page.evaluate(async () => (await window.codeflai.getSnapshot()).state.sessions[0].mode)).toBe(worktree ? 'worktree' : 'ordinary')
      expect(errors).toEqual([])
    } finally {
      await page.evaluate(async () => {
        const snapshot = await window.codeflai.getSnapshot()
        for (const project of snapshot.state.projects) await window.codeflai.removeProject(project.id)
      }).catch(() => undefined)
      const pid = app.process().pid
      await app.evaluate(({ app }) => { setImmediate(() => app.exit(0)) }).catch(() => undefined)
      if (pid) await expect.poll(() => {
        try { process.kill(pid, 0); return true } catch { return false }
      }).toBe(false)
    }
  })
}
