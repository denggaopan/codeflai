import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const projectRoot = resolve(import.meta.dirname, '..')
const executablePath = process.env.CODEFLAI_TEST_EXECUTABLE
const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version as string

async function launch(): Promise<ElectronApplication> {
  const profile = mkdtempSync(join(tmpdir(), 'codeflai-rocket-e2e-'))
  return electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
    cwd: projectRoot,
    env: { ...process.env, CODEFLAI_E2E: '1', CODEFLAI_PTY_HOST_IDLE_MS: '250' }
  })
}

test('a hundred logo clicks launch a double-size rocket that skip-glides slowly out of the window', async ({}, testInfo) => {
  const app = await launch()
  try {
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version)
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.unmaximize()
      window.setSize(1180, 760)
    })
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const brand = page.locator('.title-bar-brand')
    await expect(brand).toBeVisible()
    await brand.evaluate((button) => {
      for (let index = 0; index < 99; index++) (button as HTMLButtonElement).click()
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(99)
    await expect(page.locator('.rocket-flight-grand')).toHaveCount(0)
    await brand.click()
    const rocket = page.locator('.rocket-flight-grand')
    const body = rocket.locator('.rocket-flight-body')
    await expect(rocket).toHaveCount(1)
    await expect(body).toHaveCSS('width', '64px')
    await expect(body).toHaveCSS('height', '88px')
    await expect(rocket).toHaveCSS('pointer-events', 'none')

    const samples = await body.evaluate((node) => {
      const animation = node.getAnimations()[0]
      animation.pause()
      const duration = Number(animation.effect!.getTiming().duration)
      const keyframes = (animation.effect as KeyframeEffect).getKeyframes()
      const glideStart = keyframes[2].computedOffset * duration
      const points = [0, 0.2, 0.4, 0.6, 0.8, 1].map((fraction) => {
        animation.currentTime = glideStart + (duration - glideStart) * fraction
        const rect = node.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, left: rect.left }
      })
      animation.currentTime = glideStart + (duration - glideStart) * 0.3
      return { duration, points, viewportWidth: window.innerWidth }
    })
    expect(samples.duration).toBeGreaterThan(12_000)
    for (let index = 1; index < samples.points.length; index++) {
      expect(samples.points[index].x).toBeGreaterThan(samples.points[index - 1].x)
    }
    expect(samples.points[1].y).toBeLessThan(samples.points[0].y)
    expect(samples.points[2].y).toBeGreaterThan(samples.points[1].y)
    expect(samples.points[3].y).toBeLessThan(samples.points[2].y)
    expect(samples.points[4].y).toBeGreaterThan(samples.points[3].y)
    expect(samples.points[5].left).toBeGreaterThan(samples.viewportWidth)

    await page.locator('.rocket-flight:not(.rocket-flight-grand) .rocket-flight-body').evaluateAll((nodes) => {
      for (const node of nodes) node.getAnimations()[0]?.finish()
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('grand-rocket.png') })
    await page.locator('.title-bar-action').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await body.evaluate((node) => {
      const animation = node.getAnimations()[0]
      animation.currentTime = 0
      animation.play()
    })
    await expect(rocket).toHaveCount(0, { timeout: samples.duration + 5000 })
    await brand.click()
    await expect(page.locator('.rocket-flight')).toHaveCount(1)
    await expect(page.locator('.rocket-flight-grand')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('reduced motion skips both ordinary and grand rockets', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('.title-bar-brand').evaluate((button) => {
      for (let index = 0; index < 100; index++) (button as HTMLButtonElement).click()
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
