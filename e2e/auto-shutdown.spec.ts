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
 * dropdown and time range it reveals, and what all three write to localStorage. The countdown
 * itself is driven by a timer whose shortest selectable interval is a full minute, so the
 * ten-second countdown, its cancellation, whether the clock is inside the configured window,
 * and the shutdown request are covered by the store's unit tests instead (see
 * use-app-store.test.ts) — where both clocks can be moved instantly.
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
  const restriction = page.getByRole('checkbox', { name: 'Only shut down within a time range' })
  const windowStart = page.getByLabel('Earliest time of day a shutdown may happen')
  const windowEnd = page.getByLabel('Time of day a shutdown may no longer happen')
  const stored = () => page.evaluate(() => window.localStorage.getItem('codeflai.autoShutdown'))

  try {
    // Off by default, and the frequency has nothing to configure until it is on.
    await expect(switchOff).toHaveAttribute('aria-pressed', 'false')
    await expect(frequency).toHaveCount(0)
    await expect(restriction).toHaveCount(0)
    expect(await stored()).toBeNull()

    await switchOff.click()
    await expect(switchOn).toHaveAttribute('aria-pressed', 'true')
    await expect(switchOn).toHaveAccessibleName(/Checks every 5m whether any session is running/)
    await expect(frequency).toHaveValue('300000')
    expect(JSON.parse((await stored())!)).toEqual({
      enabled: true,
      intervalMs: 300_000,
      timeRangeEnabled: false,
      timeRange: { start: '20:00', end: '08:00' }
    })

    // The window comes with the switch, showing the night it would apply, and is editable
    // before the restriction beside it is ticked — set the hours, then arm them.
    await expect(restriction).not.toBeChecked()
    await expect(windowStart).toHaveValue('20:00')
    await expect(windowEnd).toHaveValue('08:00')
    await expect(windowStart).toBeEnabled()
    await expect(switchOn).toHaveAccessibleName(/shuts this computer down when none is\.$/)

    // Both ends are picked from a list of every half hour, never typed.
    await expect(windowStart.locator('option')).toHaveCount(48)
    await windowStart.selectOption('22:30')
    expect(JSON.parse((await stored())!)).toMatchObject({
      timeRangeEnabled: false,
      timeRange: { start: '22:30', end: '08:00' }
    })

    await restriction.check()
    await expect(switchOn).toHaveAccessibleName(/Only between 22:30 and 08:00\.$/)

    await windowEnd.selectOption('06:00')
    await expect(switchOn).toHaveAccessibleName(/Only between 22:30 and 06:00\.$/)
    expect(JSON.parse((await stored())!)).toMatchObject({
      timeRangeEnabled: true,
      timeRange: { start: '22:30', end: '06:00' }
    })

    // Unticking keeps the hours: an accidental click must not lose them.
    await restriction.uncheck()
    expect(JSON.parse((await stored())!)).toMatchObject({
      timeRangeEnabled: false,
      timeRange: { start: '22:30', end: '06:00' }
    })
    await expect(windowStart).toHaveValue('22:30')

    // Every frequency the product documents, in order, from the shortest to the hour.
    await expect(frequency.locator('option')).toHaveText(['1m', '2m', '3m', '4m', '5m', '10m', '15m', '30m', '1h'])

    await frequency.selectOption('60000')
    await expect(switchOn).toHaveAccessibleName(/Checks every 1m whether any session is running/)
    expect(JSON.parse((await stored())!)).toMatchObject({ enabled: true, intervalMs: 60_000 })

    await switchOn.click()
    await expect(switchOff).toHaveAttribute('aria-pressed', 'false')
    await expect(frequency).toHaveCount(0)
    await expect(restriction).toHaveCount(0)
    // The frequency and the window are remembered even while the feature is off, so switching
    // it back on does not silently fall back to five minutes at any hour.
    expect(JSON.parse((await stored())!)).toEqual({
      enabled: false,
      intervalMs: 60_000,
      timeRangeEnabled: false,
      timeRange: { start: '22:30', end: '06:00' }
    })

    expect(errors).toEqual([])
  } finally {
    await app.close().catch(() => undefined)
  }
})
