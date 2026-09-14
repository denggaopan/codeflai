import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

/**
 * The auto-shutdown control on its own Electron instance, because the preference persists in
 * the user-data directory and the countdown it can start is a modal dialog that powers the
 * machine off by itself — neither belongs anywhere near the window the rest of the suite
 * shares. The instance is left with the feature switched off for the same reason.
 *
 * What is asserted here is the part that is fast and deterministic: the switch, the frequency
 * dropdown it reveals, and what both write to localStorage. The countdown itself is driven by
 * a timer whose shortest selectable interval is a full minute, so the ten-second countdown,
 * its cancellation, and the shutdown request are covered by the store's unit tests instead
 * (see use-app-store.test.ts) — where the clock can be advanced instantly.
 *
 * PowerService is replaced in E2E with a recorder that cannot power anything off (see
 * buildE2EPowerService in src/main/index.ts), so nothing in this suite can ever reach the
 * real `shutdown` command.
 */
test('switches auto shutdown on, changes how often it checks, and switches it off again', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'codeflai-auto-shutdown-e2e-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve('.'),
    env: {
      ...process.env,
      CODEFLAI_E2E: '1',
      CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
      CODEFLAI_E2E_HOST_PID_LOG: join(userDataDir, 'host.pid'),
      CODEFLAI_E2E_SHUTDOWN_LOG: join(userDataDir, 'shutdown.log'),
      CODEFLAI_PTY_HOST_IDLE_MS: '250'
    }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  const switchOff = page.getByRole('button', { name: /^Auto shutdown: off\./ })
  const switchOn = page.getByRole('button', { name: /^Auto shutdown: on\./ })
  const frequency = page.getByRole('combobox', { name: 'How often to check for running sessions' })
  const stored = () => page.evaluate(() => window.localStorage.getItem('codeflai.autoShutdown'))

  try {
    // Off by default, and the frequency has nothing to configure until it is on.
    await expect(switchOff).toHaveAttribute('aria-pressed', 'false')
    await expect(frequency).toHaveCount(0)
    expect(await stored()).toBeNull()

    await switchOff.click()
    await expect(switchOn).toHaveAttribute('aria-pressed', 'true')
    await expect(switchOn).toHaveAccessibleName(/Checks every 5m whether any session is running/)
    await expect(frequency).toHaveValue('300000')
    expect(JSON.parse((await stored())!)).toEqual({ enabled: true, intervalMs: 300_000 })

    // Every frequency the product documents, in order, from the shortest to the hour.
    await expect(frequency.locator('option')).toHaveText(['1m', '2m', '3m', '4m', '5m', '10m', '15m', '30m', '1h'])

    await frequency.selectOption('60000')
    await expect(switchOn).toHaveAccessibleName(/Checks every 1m whether any session is running/)
    expect(JSON.parse((await stored())!)).toEqual({ enabled: true, intervalMs: 60_000 })

    await switchOn.click()
    await expect(switchOff).toHaveAttribute('aria-pressed', 'false')
    await expect(frequency).toHaveCount(0)
    // The frequency is remembered even while the feature is off, so switching it back on does
    // not silently fall back to five minutes.
    expect(JSON.parse((await stored())!)).toEqual({ enabled: false, intervalMs: 60_000 })

    expect(errors).toEqual([])
  } finally {
    await app.close().catch(() => undefined)
  }
})
