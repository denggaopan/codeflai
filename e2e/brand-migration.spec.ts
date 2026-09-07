import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const projectRoot = resolve(import.meta.dirname, '..')
const legacyExecutable = process.env.CODEFLAI_TEST_LEGACY_EXECUTABLE
const newExecutable = process.env.CODEFLAI_TEST_EXECUTABLE
const running = (pid: number): boolean => {
  try { process.kill(pid, 0); return true } catch { return false }
}

test('imports a closed Chromium profile and retains new preferences on the next launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codeflai-profile-e2e-'))
  const legacy = join(root, 'CodeFly')
  const current = join(root, 'Codeflai')
  let app: ElectronApplication | undefined
  const launch = (profile: string, migrate: boolean) => electron.launch({
    ...(newExecutable ? { executablePath: newExecutable } : {}),
    args: [...(newExecutable ? [] : ['.']), `--user-data-dir=${profile}`], cwd: projectRoot,
    env: { ...process.env, CODEFLAI_E2E: '1', CODEFLAI_PTY_HOST_IDLE_MS: '250', ...(migrate ? { CODEFLAI_E2E_LEGACY_USER_DATA: legacy } : {}) }
  })
  try {
    app = await launch(legacy, false)
    const page = await app.firstWindow()
    await expect(page.locator('.title-bar-app-name')).toHaveText('Codeflai')
    await page.evaluate(() => {
      localStorage.clear()
      localStorage.setItem('codefly.theme', 'light')
      localStorage.setItem('codefly.locale', 'zh-CN')
      localStorage.setItem('codefly.quickPrompts', '[{"id":"saved","starred":true,"content":"Keep my prompt"}]')
      localStorage.setItem('codefly.showQuickPrompts', 'true')
    })
    await app.close()
    app = await launch(current, true)
    const migrated = await app.firstWindow()
    await expect(migrated.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await migrated.evaluate(() => localStorage.getItem('codeflai.locale'))).toBe('zh-CN')
    expect(await migrated.evaluate(() => JSON.parse(localStorage.getItem('codeflai.quickPrompts')!)))
      .toEqual([{ id: 'saved', starred: true, content: 'Keep my prompt' }])
    expect(existsSync(join(current, 'brand-migration.json'))).toBe(true)
    expect(existsSync(join(legacy, 'Local Storage'))).toBe(true)
    await migrated.evaluate(() => localStorage.setItem('codeflai.theme', 'dark'))
    await app.close()
    app = await launch(current, true)
    await expect((await app.firstWindow()).locator('html')).toHaveAttribute('data-theme', 'dark')
  } finally {
    await app?.close().catch(() => undefined)
  }
})

test('reattaches running terminals from the released CodeFly executable', async () => {
  test.skip(process.platform !== 'win32', 'The released-executable fixture uses the Windows agent shim.')
  test.skip(!legacyExecutable, 'Set CODEFLAI_TEST_LEGACY_EXECUTABLE to a released CodeFly executable.')
  const root = mkdtempSync(join(tmpdir(), 'codeflai-legacy-host-e2e-'))
  const legacy = join(root, 'CodeFly')
  const current = join(root, 'Codeflai')
  const projectPath = join(root, 'project')
  const oldPidLog = join(root, 'old-host.pid')
  const newPidLog = join(root, 'new-host.pid')
  mkdirSync(projectPath)
  let app: ElectronApplication | undefined
  let oldHostPid: number | undefined
  try {
    app = await electron.launch({
      executablePath: legacyExecutable,
      args: [`--user-data-dir=${legacy}`], cwd: projectRoot,
      env: {
        ...process.env, CODEFLY_E2E: '1', CODEFLY_E2E_PROJECT: projectPath,
        CODEFLY_E2E_AGENT_CMD: join(projectRoot, 'e2e/fixtures/fake-agent.cmd'),
        CODEFLY_E2E_HOST_PID_LOG: oldPidLog, CODEFLY_PTY_HOST_IDLE_MS: '250'
      }
    })
    const oldPage = await app.firstWindow()
    await expect(oldPage.locator('.title-bar-app-name')).toHaveText('CodeFly')
    const sessionId = await oldPage.evaluate(async () => {
      const api = (window as unknown as { codefly: typeof window.codeflai }).codefly
      await api.getSnapshot()
      const project = await api.addProject()
      const session = await api.createSession(project!.id, 'claude', false)
      await api.saveWorkspace({ activeProjectId: project!.id, activeSessionId: session.id, collapsedProjectIds: [] })
      api.writeTerminal(session.id, 'BEFORE_RENAME\r')
      return session.id
    })
    await expect.poll(() => existsSync(oldPidLog)).toBe(true)
    oldHostPid = Number(readFileSync(oldPidLog, 'utf8').trim())
    await expect.poll(() => oldPage.evaluate(async (id) => {
      const api = (window as unknown as { codefly: typeof window.codeflai }).codefly
      return (await api.replayTerminal(id)).data
    }, sessionId)).toContain('BEFORE_RENAME')
    const oldUiPid = await app.evaluate(() => process.pid)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect.poll(() => running(oldUiPid)).toBe(false)
    expect(running(oldHostPid)).toBe(true)

    app = await electron.launch({
      ...(newExecutable ? { executablePath: newExecutable } : {}),
      args: [...(newExecutable ? [] : ['.']), `--user-data-dir=${current}`], cwd: projectRoot,
      env: {
        ...process.env, CODEFLAI_E2E: '1', CODEFLAI_E2E_LEGACY_USER_DATA: legacy,
        CODEFLAI_E2E_LEGACY_PACKAGED: '1', CODEFLAI_E2E_HOST_PID_LOG: newPidLog,
        CODEFLAI_E2E_AGENT_CMD: join(projectRoot, 'e2e/fixtures/fake-agent.cmd'), CODEFLAI_PTY_HOST_IDLE_MS: '250'
      }
    })
    const newPage = await app.firstWindow()
    await expect(newPage.locator('.title-bar-app-name')).toHaveText('Codeflai')
    await expect.poll(() => existsSync(newPidLog)).toBe(true)
    expect(Number(readFileSync(newPidLog, 'utf8').trim())).toBe(oldHostPid)
    await expect.poll(() => newPage.evaluate(async (id) => (await window.codeflai.replayTerminal(id)).data, sessionId))
      .toContain('BEFORE_RENAME')
    await newPage.evaluate((id) => window.codeflai.writeTerminal(id, 'AFTER_RENAME\r'), sessionId)
    await expect.poll(() => newPage.evaluate(async (id) => (await window.codeflai.replayTerminal(id)).data, sessionId))
      .toContain('AFTER_RENAME')
    await newPage.evaluate(async () => {
      const snapshot = await window.codeflai.getSnapshot()
      for (const project of snapshot.state.projects) await window.codeflai.removeProject(project.id)
    })
    await app.close()
    await expect.poll(() => running(oldHostPid!)).toBe(false)
    app = await electron.launch({
      ...(newExecutable ? { executablePath: newExecutable } : {}),
      args: [...(newExecutable ? [] : ['.']), `--user-data-dir=${current}`], cwd: projectRoot,
      env: {
        ...process.env, CODEFLAI_E2E: '1', CODEFLAI_E2E_LEGACY_USER_DATA: legacy,
        CODEFLAI_E2E_LEGACY_PACKAGED: '1', CODEFLAI_E2E_HOST_PID_LOG: newPidLog, CODEFLAI_PTY_HOST_IDLE_MS: '250'
      }
    })
    await (await app.firstWindow()).evaluate(() => window.codeflai.getSnapshot())
    expect(Number(readFileSync(newPidLog, 'utf8').trim())).not.toBe(oldHostPid)
    expect(JSON.parse(readFileSync(join(current, 'brand-migration.json'), 'utf8')).hostDiscoveryComplete).toBe(true)
  } finally {
    if (app?.process().exitCode === null) {
      const page = await app.firstWindow()
      await page.evaluate(async () => {
        const api = window.codeflai ?? (window as unknown as { codefly: typeof window.codeflai }).codefly
        const snapshot = await api.getSnapshot()
        for (const project of snapshot.state.projects) await api.removeProject(project.id)
      }).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
    // This PID belongs exclusively to the isolated profile created by this test.
    if (oldHostPid && running(oldHostPid)) process.kill(oldHostPid)
  }
})
