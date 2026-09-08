import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const projectRoot = resolve(import.meta.dirname, '..')
const executablePath = process.env.CODEFLAI_TEST_EXECUTABLE
const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version as string

test('deletes history durably, preserves folders and current projects, and allows adding the folder again', async ({}, testInfo) => {
  const profile = mkdtempSync(join(tmpdir(), 'codeflai-history-profile-'))
  const folder = mkdtempSync(join(tmpdir(), 'codeflai-history-project-'))
  const marker = join(folder, 'keep.txt')
  writeFileSync(marker, 'project contents remain')
  const current = { id: 'current', name: 'Current project', path: projectRoot, createdAt: '2026-09-08T00:00:00.000Z' }
  const recent = { ...current, id: 'recent', name: 'Historical project', path: folder }
  const missing = { ...current, id: 'missing', name: 'Missing project', path: join(folder, 'no-longer-exists') }
  writeFileSync(join(profile, 'state.json'), JSON.stringify({ version: 1, projects: [current], recentProjects: [recent, missing], sessions: [] }))

  const launch = () => electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
    cwd: projectRoot,
    env: { ...process.env, CODEFLAI_E2E: '1', CODEFLAI_E2E_PROJECT: folder, CODEFLAI_PTY_HOST_IDLE_MS: '250' }
  })
  let app: ElectronApplication | undefined
  const errors: string[] = []
  try {
    app = await launch()
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version)
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.unmaximize()
      window.setSize(900, 600)
    })
    let page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: 'Add Project', exact: true }).click()
    await page.getByRole('button', { name: 'Recent projects', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Add Project' })
    const remove = dialog.getByRole('button', { name: 'Remove Historical project from history' })
    await expect(remove).toBeInViewport()
    await testInfo.attach('history-delete-buttons', { body: await page.screenshot(), contentType: 'image/png' })
    await remove.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(recent.name, { exact: true })).toHaveCount(0)
    await expect(dialog.getByText(missing.name, { exact: true })).toBeVisible()
    expect(readFileSync(marker, 'utf8')).toBe('project contents remain')
    const snapshot = await page.evaluate(() => window.codeflai.getSnapshot())
    expect(snapshot.state.projects).toHaveLength(1)
    expect(snapshot.state.projects[0]!.id).toBe(current.id)
    expect(snapshot.state.recentProjects).toEqual([missing])
    expect(snapshot.state.sessions).toEqual([])

    await app.close()
    app = await launch()
    page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: 'Add Project', exact: true }).click()
    await page.getByRole('button', { name: 'Recent projects', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Add Project' })
    await expect(dialog.getByText(recent.name, { exact: true })).toHaveCount(0)
    const removeMissing = dialog.getByRole('button', { name: 'Remove Missing project from history' })
    expect(existsSync(missing.path)).toBe(false)
    await removeMissing.focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByText('No recent projects outside your project list.')).toBeVisible()
    await expect(dialog).toBeVisible()
    expect(JSON.parse(readFileSync(join(profile, 'state.json'), 'utf8')).recentProjects).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Add Project', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Add Project', exact: true }).click()
    await page.getByRole('button', { name: 'Choose project directory' }).click()
    await expect(dialog).toHaveCount(0)
    const restored = await page.evaluate(() => window.codeflai.getSnapshot())
    expect(restored.state.projects).toHaveLength(2)
    expect(restored.state.projects.some((project) => project.path === folder)).toBe(true)
    expect(restored.state.recentProjects).toEqual([])
    expect(readFileSync(marker, 'utf8')).toBe('project contents remain')
    expect(errors).toEqual([])
  } finally {
    await app?.close()
  }
})
