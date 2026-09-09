import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

import type { AppState } from '../src/shared/contracts'

const terminalText = (host: Locator): Promise<string> => host.evaluate((element) => {
  const buffer = (element as HTMLElement & {
    codeflaiTerminal?: { buffer: { active: { length: number; getLine(index: number): { translateToString(trim: boolean): string } | undefined } } }
  }).codeflaiTerminal?.buffer.active
  return buffer ? Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true)).join('\n') : ''
})

test('organizes sessions and reconnects distinct same-directory PTYs after UI restart', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const fixture = mkdtempSync(join(tmpdir(), 'codeflai-organization-'))
  const profile = join(fixture, 'profile')
  const projectPath = join(fixture, 'project')
  const hostLog = join(fixture, 'host-pid')
  mkdirSync(profile)
  mkdirSync(projectPath)
  const state: AppState = {
    version: 1,
    projects: [{ id: 'project', name: 'Organization demo', path: projectPath, createdAt: '2026-09-09T00:00:00.000Z' }],
    sessions: ['alpha', 'beta'].map((id) => ({
      id, projectId: 'project', kind: 'claude', title: `${id} task`, titleState: 'complete',
      mode: 'ordinary', launchPath: projectPath, createdAt: '2026-09-09T00:00:00.000Z', status: 'running'
    }))
  }
  writeFileSync(join(profile, 'state.json'), JSON.stringify(state))
  let app: ElectronApplication | undefined
  let page: Page
  const errors: string[] = []
  const launch = async (): Promise<void> => {
    const executablePath = process.env.CODEFLAI_TEST_EXECUTABLE
    app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`], cwd: resolve('.'),
      env: { ...process.env, CODEFLAI_E2E: '1', CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
        CODEFLAI_PTY_HOST_IDLE_MS: '250', CODEFLAI_E2E_HOST_PID_LOG: hostLog }
    })
    page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.locator('html')).toHaveAttribute('data-platform', 'win32', { timeout: 20_000 })
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.unmaximize(); window.setSize(1180, 760); window.show(); window.focus()
    })
  }
  const closeUi = async (): Promise<void> => {
    const pid = await app!.evaluate(() => process.pid)
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await expect.poll(() => { try { process.kill(pid, 0); return true } catch { return false } }).toBe(false)
    app = undefined
  }
  const scope = async (value: string): Promise<void> => {
    await page.getByRole('button', { name: 'Filter sessions', exact: true }).click()
    await page.getByRole('combobox', { name: 'Session visibility', exact: true }).selectOption(value)
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
  }
  const row = (title: string): Locator => page.locator('.session-row').filter({ has: page.locator('.session-title', { hasText: title }) })

  try {
    await launch()
    await expect(page.locator('.session-row')).toHaveCount(2)
    await row('alpha task').locator('.session-row-content').click()
    const alpha = () => page.getByTestId('terminal-host-alpha')
    const beta = () => page.getByTestId('terminal-host-beta')
    await expect(alpha().locator('textarea')).toBeFocused()
    await page.keyboard.type('MARKER_ALPHA')
    await page.keyboard.press('Enter')
    await expect.poll(() => terminalText(alpha())).toContain('MARKER_ALPHA')
    await page.evaluate(() => window.codeflai.writeTerminal('beta', 'MARKER_BETA\r'))
    await expect(row('beta task')).toHaveAttribute('data-unread', 'true')
    await expect(row('beta task').locator('.session-title')).toHaveCSS('font-weight', '600')
    await expect(row('beta task').locator('.session-row-content')).toHaveAccessibleDescription('Unread output')
    await expect(row('beta task').getByRole('img')).toHaveCount(1)
    await expect(row('beta task').getByRole('button')).toHaveCount(2)

    const alphaOptions = page.getByRole('button', { name: 'Session options for alpha task', exact: true })
    await alphaOptions.click()
    await page.keyboard.press('End')
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    const deleteDialog = page.getByRole('alertdialog', { name: 'Delete session', exact: true })
    await expect(deleteDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(deleteDialog).toHaveCount(0)
    await expect(alphaOptions).toBeFocused()
    await expect(row('alpha task')).toBeVisible()

    await page.getByRole('button', { name: 'Session options for alpha task', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    await page.getByRole('textbox', { name: 'Session name', exact: true }).fill('Renamed alpha')
    await page.getByRole('textbox', { name: 'Session name', exact: true }).press('Enter')
    await expect(row('Renamed alpha')).toBeVisible()
    await page.getByRole('button', { name: 'Session options for Renamed alpha', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'Session options for Renamed alpha', exact: true })
    await expect(menu).toBeVisible()
    const menuBounds = (await menu.boundingBox())!
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(menuBounds.x).toBeGreaterThanOrEqual(0)
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(viewport.height)
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(viewport.width)
    await page.screenshot({ path: testInfo.outputPath('session-options.png') })
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
    await expect(row('Renamed alpha')).toHaveCount(0)
    const archived = await page.evaluate(async () => (await window.codeflai.getSnapshot()).state.sessions.find((session) => session.id === 'alpha'))
    expect(archived).toMatchObject({ archived: true, status: 'running', title: 'Renamed alpha', titleManuallySet: true })
    await expect(alpha()).toBeHidden()

    await scope('archived')
    await expect(row('Renamed alpha')).toBeVisible()
    await expect(row('beta task')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('archived-session.png') })
    const hostIdentity = readFileSync(hostLog, 'utf8')
    await closeUi()
    await launch()
    await expect(row('Renamed alpha')).toHaveCount(0)
    await expect(row('beta task')).toHaveAttribute('data-unread', 'true')
    expect(readFileSync(hostLog, 'utf8')).toBe(hostIdentity)

    await scope('archived')
    await page.getByRole('button', { name: 'Session options for Renamed alpha', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Unarchive', exact: true }).click()
    await expect(row('Renamed alpha')).toHaveCount(0)
    await scope('active')
    await row('Renamed alpha').locator('.session-row-content').click()
    await expect.poll(() => terminalText(alpha())).toContain('MARKER_ALPHA')
    expect(await terminalText(alpha())).not.toContain('MARKER_BETA')
    await row('beta task').locator('.session-row-content').click()
    await expect(row('beta task')).not.toHaveAttribute('data-unread', 'true')
    await expect(row('beta task').locator('.session-title')).not.toHaveCSS('font-weight', '600')
    await expect(row('beta task').locator('.session-row-content')).toHaveAccessibleDescription('')
    await expect.poll(() => terminalText(beta())).toContain('MARKER_BETA')
    expect(await terminalText(beta())).not.toContain('MARKER_ALPHA')
    await expect(beta().locator('textarea')).toBeFocused()
    await page.keyboard.type('BETA_AFTER_RECONNECT')
    await page.keyboard.press('Enter')
    await expect.poll(() => terminalText(beta())).toContain('BETA_AFTER_RECONNECT')
    expect(await terminalText(alpha())).not.toContain('BETA_AFTER_RECONNECT')
    await page.screenshot({ path: testInfo.outputPath('organized-sessions.png') })
    expect(errors).toEqual([])
  } finally {
    if (app) {
      try {
        await page!.evaluate(async () => {
          for (const project of (await window.codeflai.getSnapshot()).state.projects) await window.codeflai.removeProject(project.id)
        })
      } finally {
        await closeUi()
      }
    }
  }
})
