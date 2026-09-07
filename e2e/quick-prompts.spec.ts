import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test, type Locator } from '@playwright/test'
import type { Terminal } from '@xterm/xterm'

import { createRepo } from './create-repo'

test('drags quick prompts without terminal input and retains the order after reload', async ({}, testInfo) => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'codeflai-prompts-sort-e2e-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve('.'),
    env: {
      ...process.env,
      CODEFLAI_E2E: '1',
      CODEFLAI_E2E_PROJECT: createRepo(),
      CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
      CODEFLAI_E2E_HOST_PID_LOG: join(userDataDir, 'host.pid'),
      CODEFLAI_PTY_HOST_IDLE_MS: '250'
    }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const order = () => page.evaluate(() => JSON.parse(localStorage.getItem('codeflai.quickPrompts')!).map((prompt: { id: string }) => prompt.id))
  const row = (name: string) => page.locator('.quick-prompts-item').filter({ has: page.getByRole('button', { name: `Edit ${name}`, exact: true }) })
  const handle = (name: string) => page.getByRole('button', { name: `Reorder ${name}`, exact: true })
  const dragToEdge = async (source: Locator, target: Locator, horizontal: boolean, before: boolean) => {
    const box = (await target.boundingBox())!
    await source.dragTo(target, { targetPosition: {
      x: horizontal ? (before ? 3 : box.width - 3) : box.width / 2,
      y: horizontal ? box.height / 2 : (before ? 3 : box.height - 3)
    } })
  }
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.unmaximize()
      window.setSize(1180, 760)
    })
    await page.getByRole('button', { name: 'Add Project', exact: true }).click()
    await page.getByRole('button', { name: 'Choose project directory' }).click()
    await page.getByRole('button', { name: /^Project options for / }).click()
    await page.getByRole('menuitem', { name: 'New session' }).click()
    await page.getByRole('button', { name: 'Command Prompt', exact: true }).click()
    await expect(page.locator('.terminal-instance-host .xterm')).toBeVisible()
    await page.evaluate(() => {
      localStorage.setItem('codeflai.showQuickPrompts', 'true')
      localStorage.setItem('codeflai.quickPrompts', JSON.stringify([
        { id: 'a', content: 'Alpha', starred: true },
        { id: 'b', content: 'Beta', starred: false },
        { id: 'c', content: 'Charlie', starred: true },
        { id: 'd', content: 'Delta', starred: true }
      ]))
    })
    await page.reload()
    await expect(page.locator('.terminal-instance-host .xterm')).toBeVisible()
    const input: string[] = []
    await page.exposeFunction('recordSortInput', (data: string) => input.push(data))
    await page.locator('.terminal-instance-host').evaluate((host) => {
      const terminal = (host as HTMLElement & { codeflaiTerminal: Terminal }).codeflaiTerminal
      terminal.onData((data) => {
        void (window as unknown as { recordSortInput(data: string): Promise<void> }).recordSortInput(data)
      })
    })
    const alpha = page.getByRole('button', { name: 'Insert Alpha', exact: true })
    await dragToEdge(alpha, page.getByRole('button', { name: 'Insert Delta', exact: true }), true, false)
    await expect.poll(order).toEqual(['b', 'c', 'd', 'a'])
    await expect(page.locator('button.quick-prompts-chip')).toHaveText(['Charlie', 'Delta', 'Alpha'])

    await page.getByRole('button', { name: 'Manage prompts', exact: true }).click()
    await dragToEdge(handle('Alpha'), row('Beta'), false, true)
    await expect.poll(order).toEqual(['a', 'b', 'c', 'd'])
    await dragToEdge(handle('Alpha'), row('Charlie'), false, false)
    await expect.poll(order).toEqual(['b', 'c', 'a', 'd'])
    await page.getByRole('searchbox', { name: 'Search prompts' }).fill('a')
    await expect(handle('Alpha')).toBeDisabled()
    await page.getByRole('searchbox', { name: 'Search prompts' }).clear()
    await handle('Alpha').focus()
    await page.keyboard.press('ArrowUp')
    await expect.poll(order).toEqual(['b', 'a', 'c', 'd'])
    await expect(handle('Alpha')).toBeFocused()

    await alpha.dragTo(page.locator('.terminal-instance-host'))
    await expect.poll(order).toEqual(['b', 'a', 'c', 'd'])
    const start = (await handle('Delta').boundingBox())!
    const end = (await row('Beta').boundingBox())!
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 - 8, { steps: 3 })
    await page.mouse.move(end.x + end.width / 2, end.y + 3, { steps: 10 })
    await expect(row('Beta')).toHaveAttribute('data-drop-position', 'before')
    await page.screenshot({ path: testInfo.outputPath('quick-prompts-sort-indicator.png') })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.locator('[data-drop-position]')).toHaveCount(0)
    await expect.poll(order).toEqual(['b', 'a', 'c', 'd'])
    expect(input.join('').replace(/\x1b\[[IO]/g, '')).toBe('')

    await page.reload()
    await expect(page.locator('button.quick-prompts-chip')).toHaveText(['Alpha', 'Charlie', 'Delta'])
    await page.getByRole('button', { name: 'Manage prompts', exact: true }).click()
    await expect(page.locator('.quick-prompts-preview')).toHaveText(['Beta', 'Alpha', 'Charlie', 'Delta'])
    await expect.poll(order).toEqual(['b', 'a', 'c', 'd'])
    await page.screenshot({ path: testInfo.outputPath('quick-prompts-sort-saved.png') })
    expect(errors).toEqual([])
  } finally {
    try {
      if (!page.isClosed()) {
        await page.evaluate(async () => {
          for (const project of (await window.codeflai.getSnapshot()).state.projects) await window.codeflai.removeProject(project.id)
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

test('persists quick prompts and inserts into the real terminal without sending', async ({}, testInfo) => {
  const repoPath = createRepo()
  const userDataDir = mkdtempSync(join(tmpdir(), 'codeflai-prompts-e2e-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve('.'),
    env: {
      ...process.env,
      CODEFLAI_E2E: '1',
      CODEFLAI_E2E_PROJECT: repoPath,
      CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
      CODEFLAI_E2E_HOST_PID_LOG: join(userDataDir, 'host.pid'),
      CODEFLAI_PTY_HOST_IDLE_MS: '250'
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
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill('echo CODEFLAI_PROMPT_E2E')
    await page.getByRole('button', { name: 'Save prompt' }).click()
    await expect(page.locator('button.quick-prompts-chip')).toHaveCount(0)
    await page.getByRole('button', { name: 'Manage prompts' }).click()
    await page.getByRole('button', { name: 'Star prompt echo CODEFLAI_PROMPT_E2E' }).click()
    await expect(page.getByRole('button', { name: 'Insert echo CODEFLAI_PROMPT_E2E' })).toBeVisible()
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
      const terminal = (host as HTMLElement & { codeflaiTerminal: Terminal }).codeflaiTerminal
      terminal.onData((data) => {
        void (window as unknown as { recordPromptInput(data: string): Promise<void> }).recordPromptInput(data)
      })
    })
    await page.getByRole('button', { name: 'Insert echo CODEFLAI_PROMPT_E2E' }).click()
    await expect.poll(typedInput).toBe('echo CODEFLAI_PROMPT_E2E')
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
    expect(await page.evaluate(async () => (await window.codeflai.getSnapshot()).state.sessions[0].titleState)).toBe('pending')
    await page.keyboard.press('Enter')
    await expect.poll(typedInput).toBe('echo CODEFLAI_PROMPT_E2E\r')
    await expect.poll(() => page.evaluate(async () => (await window.codeflai.getSnapshot()).state.sessions[0].titleState)).toBe('complete')

    await page.keyboard.press('Control+Shift+P')
    const search = page.getByRole('combobox', { name: 'Search prompts' })
    await expect(search).toBeFocused()
    await search.fill('PROMPT_E2E')
    await page.keyboard.press('Enter')
    await expect.poll(typedInput).toBe('echo CODEFLAI_PROMPT_E2E\recho CODEFLAI_PROMPT_E2E')
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(typedInput).toBe('echo CODEFLAI_PROMPT_E2E\recho CODEFLAI_PROMPT_E2E\r')

    await page.getByRole('button', { name: 'Add prompt' }).click()
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Review the current changes.\nRun the relevant tests and explain the results.')
    await page.getByRole('button', { name: 'Save prompt' }).click()
    await expect(page.locator('button.quick-prompts-chip')).toHaveCount(1)
    await page.getByRole('button', { name: 'Quick prompts', exact: true }).click()
    await page.getByRole('option', { name: /^Insert Review the current changes/ }).click()
    await expect(page.getByRole('alert')).toContainText('cannot insert multiple lines')
    expect(typedInput()).toBe('echo CODEFLAI_PROMPT_E2E\recho CODEFLAI_PROMPT_E2E\r')

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
      localStorage.setItem('codeflai.locale', 'zh-CN')
      localStorage.setItem('codeflai.theme', 'light')
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
      localStorage.setItem('codeflai.quickPrompts', JSON.stringify([
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
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(30)
    await expect(page.getByRole('option', { name: /Keep this unstarred/ })).toHaveCount(0)
    await page.getByRole('option', { name: /Review task 30:/ }).click()
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
    await expect(panel).toHaveCount(0)
    await assertCompactBar()
    await page.locator('.quick-prompts-trigger').click()
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(31)
    await expect(page.getByRole('option', { name: /Keep this unstarred/ })).toBeVisible()

    await page.evaluate(() => {
      localStorage.removeItem('codeflai.quickPrompts')
      localStorage.removeItem('codeflai.showQuickPrompts')
      localStorage.setItem('codeflai.quickPhrases', JSON.stringify([{ id: 'legacy', title: 'Old label', content: 'Keep the saved content' }]))
      localStorage.setItem('codeflai.showQuickPhrases', 'true')
      localStorage.setItem('codeflai.locale', 'en')
    })
    await page.reload()
    await expect(page.locator('.quick-prompts-bar')).toBeVisible()
    await expect(page.locator('button.quick-prompts-chip')).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('codeflai.quickPrompts')!))).toEqual([
      { id: 'legacy', content: 'Keep the saved content', starred: false }
    ])
    expect(await page.evaluate(() => localStorage.getItem('codeflai.showQuickPrompts'))).toBe('true')
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
          for (const project of (await window.codeflai.getSnapshot()).state.projects) await window.codeflai.removeProject(project.id)
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
