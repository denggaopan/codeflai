import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

import { LARK_REPLY, idleReply, startedReply } from '../src/main/lark/lark-replies'
import { createRepo } from './create-repo'

/**
 * The Lark trigger on its own Electron instance. The network client is swapped for
 * FileLarkClient by the composition root (CODEFLAI_E2E=1 + CODEFLAI_E2E_LARK_DIR): the test
 * plays Lark by appending events to inbox.jsonl and reads the bot's replies from outbox.jsonl.
 * Everything else — pairing, the whitelist, the worktree session, argv, the Done-edge report —
 * is production code.
 */
test('pairs an owner in Settings, starts a worktree session from a message and reports back', async () => {
  test.setTimeout(180_000)
  const userDataDir = mkdtempSync(join(tmpdir(), 'codeflai-lark-e2e-'))
  const larkDir = join(userDataDir, 'lark-e2e-io')
  mkdirSync(larkDir, { recursive: true })
  const argvLog = join(userDataDir, 'terminal-argv.json')
  const inbox = join(larkDir, 'inbox.jsonl')
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve('.'),
    env: {
      ...process.env,
      CODEFLAI_E2E: '1',
      CODEFLAI_E2E_PROJECT: createRepo(),
      CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
      CODEFLAI_E2E_ARGV_LOG: argvLog,
      CODEFLAI_E2E_LARK_DIR: larkDir,
      CODEFLAI_E2E_HOST_PID_LOG: join(userDataDir, 'host.pid'),
      CODEFLAI_PTY_HOST_IDLE_MS: '250'
    }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  let counter = 0
  const send = (openId: string, text: string, extra: { parentId?: string; ageMs?: number } = {}): string => {
    const messageId = `om_e2e_${++counter}`
    const event = {
      messageId,
      chatId: 'oc_e2e',
      ...(extra.parentId ? { parentId: extra.parentId } : {}),
      messageType: 'text',
      content: JSON.stringify({ text: `@_user_1 ${text}` }),
      createTimeMs: Date.now() - (extra.ageMs ?? 0),
      senderType: 'user',
      senderOpenId: openId,
      mentionsBot: true
    }
    appendFileSync(inbox, `${JSON.stringify(event)}\n`, 'utf8')
    return messageId
  }
  const outbox = (): Array<{ messageId: string; text: string }> => {
    const path = join(larkDir, 'outbox.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { messageId: string; text: string })
  }
  const replyTo = (messageId: string): string[] => outbox().filter((entry) => entry.messageId === messageId).map((entry) => entry.text)
  const sessions = () => page.evaluate(async () => (await window.codeflai.getSnapshot()).state.sessions)

  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.unmaximize()
      window.setSize(1180, 900)
    })
    await page.getByRole('button', { name: 'Add Project', exact: true }).click()
    await page.getByRole('button', { name: 'Choose project directory' }).click()
    await expect(page.locator('.project-row')).toHaveCount(1)
    const project = await page.evaluate(async () => (await window.codeflai.getSnapshot()).state.projects[0])

    // Configure the bot and bind the owner with the code Settings shows.
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Lark', exact: true }).click()
    await dialog.getByRole('switch', { name: 'Enable Lark bot' }).click()
    await dialog.getByLabel('App ID').fill('cli_e2e')
    await dialog.getByLabel('App Secret').fill('e2e-secret')
    await dialog.getByRole('button', { name: 'Save Lark settings' }).click()
    await expect(dialog.getByLabel('App Secret')).toHaveValue('')
    await expect(dialog.getByLabel('App Secret')).toHaveAttribute('placeholder', /Set/)
    await expect(dialog.getByText('Connection: connected')).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByRole('button', { name: 'Add teammate' })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Bind me' }).click()
    const code = (await dialog.locator('.settings-lark-code').textContent())!.trim()
    expect(code).toMatch(/^\d{6}$/)
    await expect(dialog.getByText(`@Codeflai 绑定 ${code}`)).toBeVisible()
    const bindId = send('ou_owner', `绑定 ${code}`)
    await expect.poll(() => replyTo(bindId), { timeout: 15_000 }).toEqual([LARK_REPLY.bound])
    await expect(dialog.getByText('E2E ou_owner')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Add teammate' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Remove/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // A message from someone who is not bound is refused and starts nothing.
    const deniedId = send('ou_stranger', `${project.name} 修一下`)
    await expect.poll(() => replyTo(deniedId), { timeout: 15_000 }).toEqual([LARK_REPLY.denied])
    expect(await sessions()).toHaveLength(0)

    // An event older than the stale threshold is not executed.
    const staleId = send('ou_owner', `${project.name} 修一下`, { ageMs: 6 * 60_000 })
    await expect.poll(() => replyTo(staleId), { timeout: 15_000 }).toEqual([LARK_REPLY.stale])
    expect(await sessions()).toHaveLength(0)

    // The owner's instruction quoting another message starts a worktree Claude session.
    writeFileSync(
      join(larkDir, 'fetched.json'),
      JSON.stringify({ om_quoted: { messageType: 'text', content: JSON.stringify({ text: 'the login page crashes' }), senderOpenId: 'ou_other' } }),
      'utf8'
    )
    const runId = send('ou_owner', `${project.name} 看看这个问题`, { parentId: 'om_quoted' })
    await expect.poll(async () => (await sessions()).length, { timeout: 30_000 }).toBe(1)
    const session = (await sessions())[0]
    expect(session).toMatchObject({ kind: 'claude', mode: 'worktree', status: 'running' })
    const branch = (session as { branchName: string }).branchName
    await expect
      .poll(() => replyTo(runId), { timeout: 15_000 })
      .toEqual([startedReply({ agent: 'claude', projectName: project.name, branch, ownerName: 'E2E ou_owner' })])
    await expect.poll(() => existsSync(argvLog), { timeout: 20_000 }).toBe(true)
    const argv = JSON.parse(readFileSync(argvLog, 'utf8')) as string[]
    expect(argv[0]).toBe('--dangerously-skip-permissions')
    expect(argv[argv.length - 1]).toMatch(/^Read the task file at .+ and carry it out\.$/)

    // The "agent" changes a file and goes quiet: the Done edge reports it to the chat.
    await page.locator('.session-row').first().click()
    await page.locator('.terminal-pane:visible .terminal-instance-host').click()
    await page.keyboard.type('CODEFLAI_TEST_WRITE_FILE')
    await page.keyboard.press('Enter')
    await expect
      .poll(() => outbox().some((entry) => entry.messageId === runId && entry.text.startsWith('本轮结束，改了：') && entry.text.includes('lark-e2e-output.txt')), {
        timeout: 30_000
      })
      .toBe(true)
    const report = outbox().find((entry) => entry.messageId === runId && entry.text.includes('lark-e2e-output.txt'))!
    const [reportPrefix] = idleReply('claude', 'X').split('X')
    expect(report.text.startsWith(reportPrefix)).toBe(true)
    expect(report.text.slice(reportPrefix.length)).toMatch(/^\S+ lark-e2e-output\.txt$/)
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
