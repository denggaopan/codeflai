import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

/**
 * The notifications switch on its own Electron instance, because the preference persists in the
 * user-data directory and this spec restarts the app to prove it survives.
 *
 * Only the control surface is asserted. A system notification is OS chrome that Playwright
 * cannot see, and the suite replaces the notification factory with one reporting no support
 * (see buildE2ENotificationService in src/main/index.ts) precisely so a Playwright-driven
 * window — which is unattended most of the time — cannot spray real toasts across the machine
 * running the tests. The four suppression rules and the badge are covered by the store's unit
 * tests, where the clock and the focus state can both be controlled. This mirrors how
 * e2e/auto-shutdown.spec.ts splits its coverage.
 */
test('switches notifications off and keeps them off across a restart', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'codeflai-notifications-e2e-'))
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: resolve('.'),
      env: {
        ...process.env,
        CODEFLAI_E2E: '1',
        CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
        CODEFLAI_PTY_HOST_IDLE_MS: '250'
      }
    })

  const errors: string[] = []
  // Re-attached after every relaunch below: `page` is reassigned to a new window, and a
  // pageerror listener bound to the first instance does not carry over to it — without this,
  // the final assertion could only ever see errors from before the restart, which is exactly
  // the path this spec exists to cover.
  const openWindow = async (instance: Awaited<ReturnType<typeof launch>>) => {
    const win = await instance.firstWindow()
    win.on('pageerror', (error) => errors.push(error.message))
    return win
  }

  let app = await launch()
  let page = await openWindow(app)

  const openSettings = async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    return page.getByRole('switch', { name: 'Notify when a session finishes' })
  }
  const stored = () => page.evaluate(() => window.localStorage.getItem('codeflai.notifications'))

  try {
    // On by default, and nothing written until the user touches it.
    let toggle = await openSettings()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(await stored()).toBeNull()

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(await stored()).toBe('false')

    // `.catch()` matches e2e/auto-shutdown.spec.ts: close() waits on every process in
    // Electron's Windows job object, including the pty-host, and must never fail the test.
    await app.close().catch(() => undefined)

    app = await launch()
    page = await openWindow(app)
    toggle = await openSettings()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(await stored()).toBe('true')

    expect(errors).toEqual([])
  } finally {
    await app.close().catch(() => undefined)
  }
})
