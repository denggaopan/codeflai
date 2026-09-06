import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'
import type { Terminal } from '@xterm/xterm'

import { createRepo } from './create-repo'

test('persists quick prompts and inserts into the real terminal without sending', async ({}, testInfo) => {
  const repoPath = createRepo()
  const userDataDir = mkdtempSync(join(tmpdir(), 'codefly-prompts-e2e-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve('.'),
    env: {
      ...process.env,
      CODEFLY_E2E: '1',
      CODEFLY_E2E_PROJECT: repoPath,
      CODEFLY_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
      CODEFLY_E2E_HOST_PID_LOG: join(userDataDir, 'host.pid'),
      CODEFLY_PTY_HOST_IDLE_MS: '250'
    }
  })
  const page = await app.firstWindow()
  const rendererErrors: string[] = []
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  try {
    await page.getByRole('button', { name: 'Add Project', exact: true }).click()
    await page.getByRole('button', { name: 'Choose project directory' }).click()
    await page.getByRole('button', { name: /^Project options for / }).click()
    await page.getByRole('menuitem', { name: 'New session' }).click()
    await page.getByRole('button', { name: 'Command Prompt', exact: true }).click()
    await expect(page.locator('.terminal-instance-host .xterm')).toBeVisible()

    await expect(page.locator('.quick-prompts-bar')).toHaveCount(0)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const promptBarSwitch = page.getByRole('switch', { name: 'Show quick prompt bar' })
    await expect(promptBarSwitch).toHaveAttribute('aria-checked', 'false')
    await promptBarSwitch.click()
    await page.getByRole('button', { name: 'Close settings' }).click()

    await page.getByRole('button', { name: 'Add prompt' }).click()
    await expect(page.getByRole('textbox', { name: /Name/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Star in quick bar' })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill('echo CODEFLY_PROMPT_E2E')
    await page.getByRole('button', { name: 'Save prompt' }).click()
    await expect(page.locator('button.quick-prompts-chip')).toHaveCount(0)
    await page.getByRole('button', { name: 'Manage prompts' }).click()
    await page.getByRole('button', { name: 'Star prompt echo CODEFLY_PROMPT_E2E' }).click()
    await expect(page.getByRole('button', { name: 'Insert echo CODEFLY_PROMPT_E2E' })).toBeVisible()
    await page.getByRole('button', { name: 'Close quick prompts' }).click()

    await page.reload()
    await expect(page.locator('.terminal-instance-host .xterm')).toBeVisible()
    await expect(page.locator('.quick-prompts-bar')).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(promptBarSwitch).toHaveAttribute('aria-checked', 'true')
    await promptBarSwitch.click()
    await page.getByRole('button', { name: 'Close settings' }).click()
    await expect(page.locator('.quick-prompts-bar')).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.terminal-instance-host .xterm')).toBeVisible()
    await expect(page.locator('.quick-prompts-bar')).toHaveCount(0)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(promptBarSwitch).toHaveAttribute('aria-checked', 'false')
    await promptBarSwitch.click()
    await page.getByRole('button', { name: 'Close settings' }).click()
    const input: string[] = []
    // ConPTY requests focus notifications; they are independent of the saved prompt.
    const typedInput = () => input.join('').replace(/\x1b\[[IO]/g, '')
    await page.exposeFunction('recordPromptInput', (data: string) => input.push(data))
    await page.locator('.terminal-instance-host').evaluate((host) => {
      const terminal = (host as HTMLElement & { codeflyTerminal: Terminal }).codeflyTerminal
      terminal.onData((data) => {
        void (window as unknown as { recordPromptInput(data: string): Promise<void> }).recordPromptInput(data)
      })
    })
    await page.getByRole('button', { name: 'Insert echo CODEFLY_PROMPT_E2E' }).click()
    await expect.poll(typedInput).toBe('echo CODEFLY_PROMPT_E2E')
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
    expect(await page.evaluate(async () => (await window.codefly.getSnapshot()).state.sessions[0].titleState)).toBe('pending')
    await page.keyboard.press('Enter')
    await expect.poll(typedInput).toBe('echo CODEFLY_PROMPT_E2E\r')
    await expect.poll(() => page.evaluate(async () => (await window.codefly.getSnapshot()).state.sessions[0].titleState)).toBe('complete')

    await page.keyboard.press('Control+Shift+P')
    const search = page.getByRole('combobox', { name: 'Search prompts' })
    await expect(search).toBeFocused()
    await search.fill('PROMPT_E2E')
    await page.keyboard.press('Enter')
    await expect.poll(typedInput).toBe('echo CODEFLY_PROMPT_E2E\recho CODEFLY_PROMPT_E2E')
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(typedInput).toBe('echo CODEFLY_PROMPT_E2E\recho CODEFLY_PROMPT_E2E\r')

    await page.getByRole('button', { name: 'Add prompt' }).click()
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Review the current changes.\nRun the relevant tests and explain the results.')
    await page.getByRole('button', { name: 'Save prompt' }).click()
    await expect(page.locator('button.quick-prompts-chip')).toHaveCount(1)
    await page.getByRole('button', { name: 'Quick prompts', exact: true }).click()
    await page.getByRole('option', { name: /^Insert Review the current changes/ }).click()
    await expect(page.getByRole('alert')).toContainText('cannot insert multiple lines')
    expect(typedInput()).toBe('echo CODEFLY_PROMPT_E2E\recho CODEFLY_PROMPT_E2E\r')

    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.unmaximize()
      window.setSize(1180, 760)
    })
    await page.getByRole('button', { name: 'Manage prompts' }).click()
    const panel = page.locator('.quick-prompts-panel')
    await expect.poll(async () => {
      const terminal = (await page.locator('.terminal-instance-host').boundingBox())!
      const drawer = (await panel.boundingBox())!
      return terminal.height >= 150 && terminal.y + terminal.height <= drawer.y + 1
    }).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('quick-prompts-manage.png') })
    await page.getByRole('button', { name: 'Close quick prompts' }).click()
    await page.screenshot({ path: testInfo.outputPath('quick-prompts-dark.png') })
    await page.evaluate(() => {
      localStorage.setItem('codefly.locale', 'zh-CN')
      localStorage.setItem('codefly.theme', 'light')
    })
    await page.reload()
    await page.locator('.quick-prompts-trigger').click()
    await expect(page.locator('.quick-prompts-trigger')).toHaveText('\u5feb\u6377\u63d0\u793a\u8bcd')
    await expect(page.locator('.quick-prompts-item')).toHaveCount(2)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
    await expect(panel).toBeVisible()
    await expect.poll(async () => {
      const bounds = (await panel.boundingBox())!
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      return bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height
    }).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('quick-prompts-light-compact.png') })

    await page.evaluate(() => {
      localStorage.setItem('codefly.quickPrompts', JSON.stringify([
        ...Array.from({ length: 30 }, (_, index) => ({
          id: `starred-${index}`, content: `Review task ${index + 1}: check the diff and run relevant tests.`, starred: true
        })),
        { id: 'unstarred', content: 'Keep this unstarred prompt available in search.', starred: false }
      ]))
    })
    await page.reload()
    const assertCompactBar = async () => {
      await expect.poll(() => page.locator('.quick-prompts-bar').evaluate((bar) => {
        const chips = bar.querySelector('.quick-prompts-chips')!
        const bounds = chips.getBoundingClientRect()
        return getComputedStyle(chips).overflowX === 'hidden' && bar.getBoundingClientRect().height <= 46 &&
          chips.scrollWidth <= chips.clientWidth && Array.from(chips.querySelectorAll('button')).every((button) => {
            const rect = button.getBoundingClientRect()
            return rect.x >= bounds.x && rect.right <= bounds.right && rect.bottom <= bounds.bottom
          })
      })).toBe(true)
    }
    for (const [width, height, sidebar] of [[1180, 760, 300], [900, 600, 300], [900, 600, 540]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height])
      await page.locator('.app-body').evaluate((body, sidebarWidth) => (body as HTMLElement).style.setProperty('--sidebar-width', `${sidebarWidth}px`), sidebar)
      await expect(page.locator('button.quick-prompts-more')).toBeVisible()
      await expect.poll(() => page.locator('button.quick-prompts-chip').count()).toBeGreaterThan(0)
      await assertCompactBar()
      await page.screenshot({ path: testInfo.outputPath(`quick-prompts-overflow-${width}-${sidebar}.png`) })
    }
    await page.locator('button.quick-prompts-more').click()
    await expect(page.getByRole('option')).toHaveCount(30)
    await expect(page.getByRole('option', { name: /Keep this unstarred/ })).toHaveCount(0)
    await page.getByRole('option', { name: /Review task 30:/ }).click()
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
    await expect(panel).toHaveCount(0)
    await assertCompactBar()
    await page.locator('.quick-prompts-trigger').click()
    await expect(page.getByRole('option')).toHaveCount(31)
    await expect(page.getByRole('option', { name: /Keep this unstarred/ })).toBeVisible()

    await page.evaluate(() => {
      localStorage.removeItem('codefly.quickPrompts')
      localStorage.removeItem('codefly.showQuickPrompts')
      localStorage.setItem('codefly.quickPhrases', JSON.stringify([{ id: 'legacy', title: 'Old label', content: 'Keep the saved content' }]))
      localStorage.setItem('codefly.showQuickPhrases', 'true')
      localStorage.setItem('codefly.locale', 'en')
    })
    await page.reload()
    await expect(page.locator('.quick-prompts-bar')).toBeVisible()
    await expect(page.locator('button.quick-prompts-chip')).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('codefly.quickPrompts')!))).toEqual([
      { id: 'legacy', content: 'Keep the saved content', starred: false }
    ])
    expect(await page.evaluate(() => localStorage.getItem('codefly.showQuickPrompts'))).toBe('true')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(promptBarSwitch).toHaveAttribute('aria-checked', 'true')
    await promptBarSwitch.click()
    await page.getByRole('button', { name: 'Close settings' }).click()
    await page.reload()
    await expect(page.locator('.terminal-instance-host .xterm')).toBeVisible()
    await expect(page.locator('.quick-prompts-bar')).toHaveCount(0)
    expect(rendererErrors).toEqual([])
  } finally {
    try {
      if (!page.isClosed()) {
        await page.evaluate(async () => {
          for (const project of (await window.codefly.getSnapshot()).state.projects) await window.codefly.removeProject(project.id)
        })
      }
    } finally {
      const uiPid = await app.evaluate(() => process.pid)
      await app.evaluate(({ app }) => { setImmediate(() => app.exit(0)) })
      await expect.poll(() => {
        try { process.kill(uiPid, 0); return true } catch { return false }
      }).toBe(false)
    }
  }
})
