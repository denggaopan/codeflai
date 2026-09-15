import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

import type { AppState } from '../src/shared/contracts'

/**
 * The row popovers are absolutely positioned inside `.project-groups`, the sidebar's only
 * scroll region, so one on a bottom row is clipped by it unless it flips above its row. Only
 * a real browser can prove that: the unit tests drive useScrollportPopoverLayout with mocked
 * rects, which says nothing about whether the CSS that acts on `data-placement` is correct.
 *
 * The project count has to be large enough to actually overflow the scrollport — with a short
 * list the last row has room beneath it and "below" is the right answer, so a smaller fixture
 * passes this spec without ever exercising the flip.
 */
test('opens the session launcher inside the project scrollport on both end rows', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'codeflai-launcher-'))
  const profile = join(fixture, 'profile')
  mkdirSync(profile)
  const ids = Array.from({ length: 40 }, (_, index) => `project-${index}`)
  const state: AppState = {
    version: 1,
    projects: ids.map((id) => ({ id, name: id, path: join(fixture, id), createdAt: '2026-09-08T00:00:00.000Z' })),
    sessions: []
  }
  for (const project of state.projects) mkdirSync(project.path)
  writeFileSync(join(profile, 'state.json'), JSON.stringify(state))
  const executablePath = process.env.CODEFLAI_TEST_EXECUTABLE
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
    cwd: resolve('.'),
    env: { ...process.env, CODEFLAI_E2E: '1', CODEFLAI_PTY_HOST_IDLE_MS: '250' }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const launcher = page.locator('.session-launcher')
  const openLauncher = async (name: string) => {
    await page.getByRole('button', { name: `Project options for ${name}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'New session', exact: true }).click()
  }
  // Every entry has to be reachable, not just the popover frame: the reported bug left the
  // frame's top edge on screen with its lower items behind the sidebar footer.
  const expectInsideScrollport = async () => {
    const port = (await page.locator('.project-groups').boundingBox())!
    for (const target of [launcher, ...['PowerShell', 'Command Prompt', 'Claude'].map((label) =>
      launcher.getByRole('button', { name: label, exact: true })
    )]) {
      const box = (await target.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(port.y - 1)
      expect(box.y + box.height).toBeLessThanOrEqual(port.y + port.height + 1)
    }
  }

  try {
    await openLauncher(ids[0])
    await expect(launcher).toHaveAttribute('data-placement', 'below')
    await expectInsideScrollport()
    await page.keyboard.press('Escape')

    const overflows = await page.locator('.project-groups').evaluate((element) => {
      element.scrollTo(0, element.scrollHeight)
      return element.scrollHeight > element.clientHeight
    })
    expect(overflows).toBe(true)

    await openLauncher(ids[ids.length - 1])
    await expect(launcher).toHaveAttribute('data-placement', 'above')
    await expectInsideScrollport()
  } finally {
    await app.close()
  }
  expect(errors).toEqual([])
})
