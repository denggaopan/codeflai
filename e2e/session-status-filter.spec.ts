import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

import { createRepo } from './create-repo'

const applyStatusFilter = async (page: Page, status: string): Promise<void> => {
  const trigger = page.getByRole('button', { name: 'Filter sessions', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Filter sessions', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Session status', exact: true }).selectOption(status)
  await dialog.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
}

for (const kind of ['claude', 'codex'] as const) {
  test(`${kind} stays running while background agents work, including after reload`, async ({}, testInfo) => {
    const profile = mkdtempSync(join(tmpdir(), `codeflai-background-${kind}-`))
    const executablePath = process.env.CODEFLAI_TEST_EXECUTABLE
    const app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
      cwd: resolve('.'),
      env: {
        ...process.env,
        CODEFLAI_E2E: '1',
        CODEFLAI_E2E_PROJECT: createRepo(),
        CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
        CODEFLAI_PTY_HOST_IDLE_MS: '250'
      }
    })
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.getByRole('button', { name: 'Add Project', exact: true }).click()
      await page.getByRole('button', { name: 'Choose project directory' }).click()
      await page.getByRole('button', { name: /^Project options for / }).click()
      await page.getByRole('menuitem', { name: 'New session', exact: true }).click()
      await page.getByRole('button', { name: kind === 'claude' ? 'Claude' : 'Codex', exact: true }).click()
      const header = page.locator('.terminal-header-status:visible')
      await expect(header).toHaveText('Done')
      const send = async (suffix: string) => page.evaluate(async ({ kind, suffix }) => {
        const session = (await window.codeflai.getSnapshot()).state.sessions.find((candidate) => candidate.kind === kind)!
        window.codeflai.writeTerminal(session.id, `CODEFLAI_TEST_${kind.toUpperCase()}_BACKGROUND_${suffix}\r`)
      }, { kind, suffix })

      await applyStatusFilter(page, 'done')
      await send('START')
      await expect(header).toHaveText('Running')
      await expect(page.locator('.session-row')).toHaveCount(0)
      // No further fixture output: exceeding the quiet window must not mark background work Done.
      await page.waitForTimeout(4000)
      await expect(header).toHaveText('Running')
      await applyStatusFilter(page, 'running')
      await expect(page.locator('.session-row')).toHaveCount(1)
      await page.reload()
      await expect(header).toHaveText('Running')
      await page.waitForTimeout(4000)
      await expect(header).toHaveText('Running')
      await applyStatusFilter(page, 'running')
      await expect(page.locator('.session-row')).toHaveCount(1)
      await send('ONE_LEFT')
      await page.waitForTimeout(4000)
      await expect(header).toHaveText('Running')
      await expect(page.locator('.session-row')).toHaveCount(1)
      await page.screenshot({ path: testInfo.outputPath(`${kind}-background-running.png`) })
      await send('DONE')
      await expect(header).toHaveText('Done')
      await expect(page.locator('.session-row')).toHaveCount(0)
      await applyStatusFilter(page, 'done')
      await expect(page.locator('.session-row')).toHaveCount(1)
      expect(errors).toEqual([])
    } finally {
      try {
        if (!page.isClosed()) await page.evaluate(async () => {
          for (const project of (await window.codeflai.getSnapshot()).state.projects) await window.codeflai.removeProject(project.id)
        })
      } finally {
        const pid = await app.evaluate(() => process.pid)
        await app.evaluate(({ app }) => { setImmediate(() => app.exit(0)) })
        await expect.poll(() => {
          try { process.kill(pid, 0); return true } catch { return false }
        }).toBe(false)
      }
    }
  })
}

test('filters live sessions by status and search while retaining the active terminal', async ({}, testInfo) => {
  const profile = mkdtempSync(join(tmpdir(), 'codeflai-status-filter-'))
  const executablePath = process.env.CODEFLAI_TEST_EXECUTABLE
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
    cwd: resolve('.'),
    env: {
      ...process.env,
      CODEFLAI_E2E: '1',
      CODEFLAI_E2E_PROJECT: createRepo(),
      CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
      CODEFLAI_PTY_HOST_IDLE_MS: '250'
    }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version)
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.unmaximize()
      window.setSize(1180, 760)
    })
    await page.getByRole('button', { name: 'Add Project', exact: true }).click()
    await page.getByRole('button', { name: 'Choose project directory' }).click()
    const create = async (name: string) => {
      await page.getByRole('button', { name: /^Project options for / }).click()
      await page.getByRole('menuitem', { name: 'New session', exact: true }).click()
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page.locator('.terminal-instance-host .xterm:visible')).toHaveCount(1)
      await expect(page.locator('.xterm-helper-textarea:visible')).toBeFocused()
    }
    await create('Command Prompt')
    await create('Claude')
    const filterButton = page.getByRole('button', { name: 'Filter sessions', exact: true })
    const filterDialog = page.getByRole('dialog', { name: 'Filter sessions', exact: true })
    const filter = filterDialog.getByRole('combobox', { name: 'Session status', exact: true })
    const search = page.getByRole('searchbox', { name: 'Search sessions' })
    const sidebar = page.locator('.project-sidebar')
    await expect(sidebar.locator('.session-row')).toHaveCount(2)
    await expect(sidebar.locator('[data-status="done"]')).toHaveCount(1)
    const activeTitle = await page.locator('.terminal-header-title:visible').innerText()
    await applyStatusFilter(page, 'running')
    await expect(sidebar.locator('.session-row')).toHaveCount(1)
    await expect(sidebar.locator('[data-kind="cmd"]')).toHaveCount(1)
    await expect(page.locator('.terminal-header-title:visible')).toHaveText(activeTitle)
    await expect(page.locator('.terminal-instance-host .xterm:visible')).toHaveCount(1)

    // Every dismissal path abandons the draft without changing the applied results.
    for (const dismissal of ['close', 'escape', 'trigger-escape', 'outside'] as const) {
      await filterButton.click()
      await expect(filterDialog).toBeVisible()
      await expect(filter).toHaveValue('running')
      await filter.selectOption('done')
      await expect(sidebar.locator('[data-kind="cmd"]')).toHaveCount(1)
      await expect(sidebar.locator('[data-kind="claude"]')).toHaveCount(0)
      if (dismissal === 'close') {
        await filterDialog.getByRole('button', { name: 'Close filters', exact: true }).click()
      } else if (dismissal === 'escape') {
        await page.keyboard.press('Escape')
      } else if (dismissal === 'trigger-escape') {
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(filterButton).toBeFocused()
        await page.keyboard.press('Escape')
      } else {
        await search.click()
      }
      await expect(filterDialog).toBeHidden()
      await expect(filterButton).toHaveAttribute('title', 'Session status: Running')
      await expect(sidebar.locator('[data-kind="cmd"]')).toHaveCount(1)
      await expect(sidebar.locator('[data-kind="claude"]')).toHaveCount(0)
      if (dismissal !== 'outside') await expect(filterButton).toBeFocused()
    }

    await filterButton.click()
    await expect(filter).toHaveValue('running')
    await filter.selectOption('done')
    await filterDialog.getByRole('button', { name: 'Reset filters', exact: true }).click()
    await expect(filter).toHaveValue('all')
    await expect(sidebar.locator('.session-row')).toHaveCount(1)
    await expect(filterButton).toHaveAttribute('title', 'Session status: Running')
    await filterDialog.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await expect(filterDialog).toBeHidden()
    await expect(filterButton).toBeFocused()
    await expect(sidebar.locator('.session-row')).toHaveCount(2)

    await applyStatusFilter(page, 'done')
    await expect(sidebar.locator('.session-row')).toHaveCount(1)
    await expect(sidebar.locator('[data-kind="claude"]')).toHaveCount(1)
    await search.fill('no-such-session')
    await expect(sidebar.getByRole('status')).toHaveText('No matching sessions')
    await sidebar.getByRole('button', { name: 'Clear filters' }).click()
    await expect(filterButton).toHaveAttribute('title', 'Session status: All statuses')
    await expect(search).toBeFocused()
    await expect(sidebar.locator('.session-row')).toHaveCount(2)

    await applyStatusFilter(page, 'stopped')
    await page.evaluate(async () => {
      const shell = (await window.codeflai.getSnapshot()).state.sessions.find((session) => session.kind === 'cmd')!
      window.codeflai.writeTerminal(shell.id, 'exit\r')
    })
    await expect(sidebar.locator('.session-row')).toHaveCount(1)
    await expect(sidebar.locator('[data-status="stopped"]')).toHaveCount(1)
    await sidebar.locator('.session-row-content').click()
    await expect(sidebar.locator('.session-row')).toHaveCount(0)
    await expect(page.locator('.terminal-header-status:visible')).toHaveText('Running')

    await applyStatusFilter(page, 'all')
    await page.locator('.project-row-label').click()
    await expect(sidebar.locator('.session-row')).toHaveCount(0)
    await applyStatusFilter(page, 'running')
    await expect(sidebar.locator('.session-row')).toHaveCount(1)
    await applyStatusFilter(page, 'all')
    await expect(sidebar.locator('.session-row')).toHaveCount(0)
    await page.locator('.project-row-label').click()

    const resizer = page.getByRole('separator', { name: 'Resize sidebar' })
    await resizer.focus()
    await page.keyboard.press('Home')
    await expect(sidebar).toHaveCSS('width', '200px')
    await filterButton.focus()
    await page.keyboard.press('Enter')
    await expect(filterDialog).toBeVisible()
    const fits = await filterDialog.evaluate((dialog) => {
      const popup = dialog.getBoundingClientRect()
      const sidebar = document.querySelector('.project-sidebar')!.getBoundingClientRect()
      return popup.left >= sidebar.left && popup.right <= sidebar.right &&
        popup.top >= sidebar.top && popup.bottom <= sidebar.bottom
    })
    expect(fits).toBe(true)
    await expect(filter).toHaveValue('all')
    await filter.focus()
    await page.keyboard.press('ArrowDown')
    await expect(filter).toHaveValue('running')
    await expect(sidebar.locator('.session-row')).toHaveCount(2)
    await filterDialog.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await expect(filterDialog).toBeHidden()
    await expect(filterButton).toBeFocused()
    await expect(sidebar.locator('.session-row')).toHaveCount(1)
    await expect(page.locator('.session-status-filter')).toHaveAttribute('data-active', 'true')
    await filterButton.click()
    await expect(filterDialog).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('status-filter-narrow.png') })
    await page.keyboard.press('Escape')
    await expect(filterDialog).toBeHidden()
    await expect(filterButton).toBeFocused()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await page.getByRole('button', { name: '简体中文', exact: true }).click()
    await page.keyboard.press('Escape')
    const chineseFilterButton = page.getByRole('button', { name: '筛选会话', exact: true })
    await expect(chineseFilterButton).toHaveAttribute('title', '会话状态: 运行中')
    await chineseFilterButton.click()
    const chineseDialog = page.getByRole('dialog', { name: '筛选会话', exact: true })
    await expect(chineseDialog).toBeVisible()
    await expect(chineseDialog.getByRole('combobox', { name: '会话状态' })).toHaveValue('running')
    for (const name of ['应用筛选', '重置筛选', '关闭筛选']) {
      await expect(chineseDialog.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await page.screenshot({ path: testInfo.outputPath('status-filter-light-zh.png') })
    await page.keyboard.press('Escape')
    await expect(chineseDialog).toBeHidden()
    await expect(chineseFilterButton).toBeFocused()
    expect(errors).toEqual([])
  } finally {
    try {
      if (!page.isClosed()) await page.evaluate(async () => {
        for (const project of (await window.codeflai.getSnapshot()).state.projects) await window.codeflai.removeProject(project.id)
      })
    } finally {
      const pid = await app.evaluate(() => process.pid)
      await app.evaluate(({ app }) => { setImmediate(() => app.exit(0)) })
      await expect.poll(() => {
        try { process.kill(pid, 0); return true } catch { return false }
      }).toBe(false)
    }
  }
})
