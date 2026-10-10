import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

import { en } from '../src/renderer/src/i18n/en'
import { issueAutomationTemplateValues, renderIssueAutomationTemplate } from '../src/shared/issue-automation'
import { createRepo } from './create-repo'

/**
 * The automatic-issue launch chain on its own Electron instance: switching a project on from
 * the menu, the row glyph surviving a reload, and "Resolve one issue now" starting a session
 * whose argv ends with the prompt sentence naming a file under the suite's user-data directory
 * — a file whose contents are the default template with every placeholder filled in.
 *
 * Only the manual entry is exercised: the shortest timer interval is five minutes. The watcher
 * itself is covered with a fake clock in use-app-store.test.ts. On Windows the fake agent is
 * reached through fake-agent.cmd, so this is the real test of the cmd-hosted quoting path.
 *
 * The way back is exercised too: typing CODEFLAI_TEST_ISSUE_CLAIM / _NONE makes the fake
 * agent write the result file the template names, and the main process's poller has to rename
 * the row after the claimed issue, or delete the row (worktree, prompt and result file with it).
 */
test('switches a project on, survives a reload, and starts an automatic session with the rendered prompt', async () => {
  test.setTimeout(120_000)
  const userDataDir = mkdtempSync(join(tmpdir(), 'codeflai-issue-automation-e2e-'))
  const argvLog = join(userDataDir, 'terminal-argv.json')
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve('.'),
    env: {
      ...process.env,
      CODEFLAI_E2E: '1',
      CODEFLAI_E2E_PROJECT: createRepo(),
      CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
      CODEFLAI_E2E_ARGV_LOG: argvLog,
      CODEFLAI_E2E_HOST_PID_LOG: join(userDataDir, 'host.pid'),
      CODEFLAI_PTY_HOST_IDLE_MS: '250'
    }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  const stored = () => page.evaluate(() => window.localStorage.getItem('codeflai.issueAutomation'))
  const openMenu = async () => {
    await page.getByRole('button', { name: /^Project options for / }).click()
    return page.getByRole('menu', { name: /^Project options for / })
  }
  const glyph = page.getByRole('img', { name: 'Auto-resolve issues is on for this project' })
  const argv = (): string[] | null => (existsSync(argvLog) ? (JSON.parse(readFileSync(argvLog, 'utf8')) as string[]) : null)
  const sentence = (prefix: string): RegExp => new RegExp(`^\\${prefix} Read the task file at (.+\\.md) and carry it out exactly, without asking questions\\.$`)

  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.unmaximize()
      window.setSize(1180, 760)
    })
    await page.getByRole('button', { name: 'Add Project', exact: true }).click()
    await page.getByRole('button', { name: 'Choose project directory' }).click()
    await expect(page.locator('.project-row')).toHaveCount(1)
    const project = await page.evaluate(async () => (await window.codeflai.getSnapshot()).state.projects[0])
    expect(project.repoRemote).toEqual({ host: 'github', webUrl: 'https://github.com/codeflai-e2e/fixture' })

    // Off by default, nothing stored, no glyph.
    expect(await stored()).toBeNull()
    await expect(glyph).toHaveCount(0)
    let menu = await openMenu()
    const toggle = menu.getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(menu).toHaveCount(0)
    await expect(glyph).toHaveCount(1)
    expect(JSON.parse((await stored())!)).toEqual({ agent: 'claude', intervalMs: 30 * 60_000, template: null, projects: [project.id] })

    // The preference is renderer-owned: a reload reads it back and the glyph returns.
    await page.reload()
    await expect(page.locator('.project-row')).toHaveCount(1)
    await expect(glyph).toHaveCount(1)
    menu = await openMenu()
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })).toHaveAttribute('aria-checked', 'true')

    // One round now: a worktree session titled after the clock, argv ending with the sentence.
    await menu.getByRole('menuitem', { name: 'Resolve one issue now' }).click()
    const row = page.locator('.session-row', { has: page.locator('.session-kind-icon[data-kind="claude"]') })
    await expect(row).toHaveCount(1)
    await expect(row.locator('.session-title')).toHaveText(/^Auto issue \d\d-\d\d \d\d:\d\d$/)
    await expect.poll(argv, { timeout: 20_000 }).not.toBeNull()
    const claudeArgv = argv()!
    expect(claudeArgv).toHaveLength(2)
    expect(claudeArgv[0]).toBe('--dangerously-skip-permissions')
    const promptFile = sentence('/fast-do').exec(claudeArgv[1])?.[1]
    expect(promptFile).toBeDefined()
    expect(promptFile!.startsWith(join(userDataDir, 'issue-automation'))).toBe(true)
    const resultFile = promptFile!.replace(/\.md$/, '.result.json')
    const expectedPrompt = renderIssueAutomationTemplate(
      renderIssueAutomationTemplate(en['issueAutomation.defaultTemplate'], issueAutomationTemplateValues(project, project.repoRemote!, 'claude')),
      { resultFile }
    )
    expect(readFileSync(promptFile!, 'utf8')).toBe(expectedPrompt)
    expect(expectedPrompt).not.toContain('{{')
    expect(expectedPrompt).toContain(resultFile)
    expect(existsSync(resultFile)).toBe(false)

    // The agent reports the issue it claimed: the row is renamed after it while it keeps running.
    await page.locator('.terminal-pane:visible .terminal-instance-host').click()
    await page.keyboard.type('CODEFLAI_TEST_ISSUE_CLAIM')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(resultFile), { timeout: 10_000 }).toBe(true)
    await expect(row.locator('.session-title')).toHaveText('issue#42 Fix login crash', { timeout: 15_000 })
    const claimed = await page.evaluate(async () => (await window.codeflai.getSnapshot()).state.sessions.find((session) => session.kind === 'claude'))
    expect(claimed).toMatchObject({ status: 'running', automation: 'issue', issue: { number: 42, title: 'Fix login crash' } })

    // Switching the agent in Settings changes the prefix in argv and the file alike.
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('combobox', { name: 'Agent' }).selectOption('codex')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    menu = await openMenu()
    await menu.getByRole('menuitem', { name: 'Resolve one issue now' }).click()
    await expect.poll(() => argv()?.[0], { timeout: 20_000 }).toBe('--dangerously-bypass-approvals-and-sandbox')
    const codexArgv = argv()!
    expect(codexArgv.slice(0, 2)).toEqual(['--dangerously-bypass-approvals-and-sandbox', '--no-daemon'])
    const codexPromptFile = sentence('$fast-do').exec(codexArgv[2])?.[1]
    expect(codexPromptFile).toBeDefined()
    expect(readFileSync(codexPromptFile!, 'utf8')).toContain('Resolve the issue with $fast-do in one go')

    // This agent finds nothing to do: the row, its worktree and both files disappear on their
    // own, and the Claude row that claimed an issue is untouched.
    const codexRow = page.locator('.session-row', { has: page.locator('.session-kind-icon[data-kind="codex"]') })
    await expect(codexRow).toHaveCount(1)
    const codexSession = await page.evaluate(async () => (await window.codeflai.getSnapshot()).state.sessions.find((session) => session.kind === 'codex'))
    expect(codexSession).toMatchObject({ mode: 'worktree', automation: 'issue' })
    await page.locator('.terminal-pane:visible .terminal-instance-host').click()
    await page.keyboard.type('CODEFLAI_TEST_ISSUE_NONE')
    await page.keyboard.press('Enter')
    await expect(codexRow).toHaveCount(0, { timeout: 15_000 })
    await expect(row).toHaveCount(1)
    await expect(row.locator('.session-title')).toHaveText('issue#42 Fix login crash')
    await expect.poll(() => existsSync(codexPromptFile!)).toBe(false)
    expect(existsSync(codexPromptFile!.replace(/\.md$/, '.result.json'))).toBe(false)
    expect(existsSync((codexSession as { worktreePath: string }).worktreePath)).toBe(false)

    expect(errors).toEqual([])
  } finally {
    // Removing the project ends every PTY so the resident host can exit within the E2E idle
    // deadline; otherwise Playwright waits on the keepalive process forever.
    await page.evaluate(async () => {
      const snapshot = await window.codeflai.getSnapshot()
      for (const project of snapshot.state.projects) await window.codeflai.removeProject(project.id)
    }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
