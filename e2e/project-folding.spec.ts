import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

import type { AppState } from '../src/shared/contracts'

test('toggles all projects and filtered results while preserving workspace folds and the active terminal', async ({}, testInfo) => {
  const fixture = mkdtempSync(join(tmpdir(), 'codeflai-folding-'))
  const profile = join(fixture, 'profile')
  mkdirSync(profile)
  const state: AppState = {
    version: 1,
    projects: ['first', 'second', 'empty'].map((id) => ({
      id, name: id, path: join(fixture, id), createdAt: '2026-09-08T00:00:00.000Z'
    })),
    sessions: ['first', 'second'].map((projectId) => ({
      id: `session-${projectId}`, projectId, kind: 'claude', title: `Session ${projectId}`,
      titleState: 'complete', mode: 'ordinary', launchPath: join(fixture, projectId),
      createdAt: '2026-09-08T00:00:00.000Z', status: 'running'
    }))
  }
  for (const project of state.projects) mkdirSync(project.path)
  writeFileSync(join(profile, 'state.json'), JSON.stringify(state))
  const executablePath = process.env.CODEFLAI_TEST_EXECUTABLE
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
    cwd: resolve('.'),
    env: {
      ...process.env, CODEFLAI_E2E: '1',
      CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
      CODEFLAI_PTY_HOST_IDLE_MS: '250'
    }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const row = (id: string) => page.locator(`[aria-controls="project-sessions-${id}"]`)
  const applyStatus = async (status: string) => {
    await page.getByRole('button', { name: 'Filter sessions', exact: true }).click()
    await page.getByRole('combobox', { name: 'Session status', exact: true }).selectOption(status)
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  }
  try {
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version)
    await expect(page.locator('.session-row')).toHaveCount(2)
    await page.locator('.session-row-content', { hasText: 'Session first' }).click()
    const terminal = page.getByTestId('terminal-host-session-first')
    await expect(terminal).toBeVisible()
    await expect(page.locator('.terminal-header-status:visible')).toHaveText('Done')
    await row('second').click()
    await page.getByRole('button', { name: 'Collapse all projects', exact: true }).click()
    for (const id of ['first', 'second', 'empty']) await expect(row(id)).toHaveAttribute('aria-expanded', 'false')
    await expect(terminal).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Expand all projects', exact: true })).toBeVisible()
    for (const id of ['first', 'second', 'empty']) await expect(row(id)).toHaveAttribute('aria-expanded', 'false')
    await expect(terminal).toBeVisible()
    await page.getByRole('button', { name: 'Expand all projects', exact: true }).click()
    await row('second').click()
    const search = page.getByRole('searchbox', { name: 'Search sessions' })
    const openSearch = async () => {
      const trigger = page.getByRole('button', { name: 'Search sessions', exact: true })
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
      return search
    }
    const searchTrigger = page.getByRole('button', { name: 'Search sessions', exact: true })
    await expect(search).toBeHidden()
    expect(await page.locator('.add-project-icon').evaluate(async (icon) => {
      const image = new Image()
      image.src = getComputedStyle(icon).maskImage.slice(5, -2)
      await image.decode()
      return image.naturalWidth > 0
    })).toBe(true)
    const addRect = await page.getByRole('button', { name: 'Add Project', exact: true }).boundingBox()
    const searchRect = await searchTrigger.boundingBox()
    expect(addRect!.x + addRect!.width).toBeLessThanOrEqual(searchRect!.x)
    await expect(page.locator('.project-sidebar-footer').getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.locator('.title-bar').getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('sidebar-toolbar-dark.png') })
    await (await openSearch()).fill('first')
    await expect(search).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(search).toBeHidden()
    await expect(searchTrigger).toBeFocused()
    await expect(searchTrigger).toHaveAttribute('data-active', 'true')
    await expect(await openSearch()).toHaveValue('first')
    await page.keyboard.press('Enter')
    await expect(search).toBeHidden()
    await applyStatus('done')
    await expect(page.locator('.session-row')).toHaveCount(1)
    const toggle = page.locator('.project-fold-toggle')
    const filterRect = await page.getByRole('button', { name: 'Filter sessions', exact: true }).boundingBox()
    const toggleRect = await toggle.boundingBox()
    expect(searchRect!.x + searchRect!.width).toBeLessThanOrEqual(filterRect!.x)
    expect(toggleRect!.x).toBeGreaterThanOrEqual(filterRect!.x + filterRect!.width)
    await toggle.focus()
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAccessibleName('Expand results')
    await expect(page.locator('.session-row')).toHaveCount(0)
    await expect(row('second')).toHaveAttribute('aria-expanded', 'false')
    await expect(row('empty')).toHaveAttribute('aria-expanded', 'true')
    await expect(terminal).toBeVisible()
    await expect(page.getByText('No matching sessions', { exact: true })).toBeHidden()
    await page.keyboard.press('Enter')
    await expect(page.locator('.session-row')).toHaveCount(1)
    await row('first').click()
    await expect(toggle).toHaveAccessibleName('Expand results')
    await (await openSearch()).fill('second')
    await expect(page.locator('.session-row')).toHaveCount(1)
    await (await openSearch()).fill('no-match')
    await expect(toggle).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await expect(row('first')).toHaveAttribute('aria-expanded', 'true')
    await expect(row('second')).toHaveAttribute('aria-expanded', 'false')
    await applyStatus('done')
    await toggle.click()
    await expect(page.locator('.session-row')).toHaveCount(0)
    await toggle.click()
    await expect(page.locator('.session-row')).toHaveCount(2)
    await applyStatus('all')
    await page.getByRole('separator', { name: 'Resize sidebar' }).focus()
    await page.keyboard.press('Home')
    await expect(page.locator('.project-sidebar')).toHaveCSS('width', '200px')
    expect(await toggle.evaluate((button) => {
      const control = button.getBoundingClientRect()
      const sidebar = button.closest('.project-sidebar')!.getBoundingClientRect()
      const input = document.querySelector('.session-search-toggle')!.getBoundingClientRect()
      return control.right <= sidebar.right && input.width > 0 && input.right <= control.left
    })).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('project-folding-dark.png') })
    await openSearch()
    const searchDialog = page.getByRole('dialog', { name: 'Search sessions', exact: true })
    expect(await searchDialog.evaluate((dialog) => {
      const popup = dialog.getBoundingClientRect()
      const sidebar = document.querySelector('.project-sidebar')!.getBoundingClientRect()
      const input = dialog.querySelector('input')!.getBoundingClientRect()
      return popup.left >= sidebar.left && popup.right <= sidebar.right && input.left >= popup.left && input.right <= popup.right
    })).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('sidebar-search-narrow.png') })
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    await page.getByRole('button', { name: 'Close search', exact: true }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await page.getByRole('button', { name: '简体中文', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '全部折叠', exact: true }).click()
    await expect(page.getByRole('button', { name: '全部展开', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('project-folding-light-zh.png') })
    await page.getByRole('button', { name: '搜索会话', exact: true }).click()
    await expect(page.getByRole('searchbox', { name: '搜索会话', exact: true })).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('sidebar-search-light-zh.png') })
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
