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

test('the 32nd and later logo clicks drop two original-size rockets that rapidly skip-glide out of the window', async ({}, testInfo) => {
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
      for (let index = 0; index < 31; index++) (button as HTMLButtonElement).click()
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(31)
    await expect(page.locator('.rocket-flight-burst')).toHaveCount(0)
    await brand.click()
    const rocket = page.locator('.rocket-flight-burst')
    const bodies = rocket.locator('.rocket-flight-body')
    const body = bodies.first()
    await expect(rocket).toHaveCount(2)
    await bodies.evaluateAll((nodes) => nodes.forEach((node) => node.getAnimations()[0].pause()))
    for (let index = 0; index < 2; index++) {
      await expect(bodies.nth(index)).toHaveCSS('width', '32px')
      await expect(bodies.nth(index)).toHaveCSS('height', '44px')
      await expect(rocket.nth(index)).toHaveCSS('pointer-events', 'none')
      await expect(rocket.nth(index).locator('.rocket-flight-exhaust')).toBeVisible()
    }

    const samples = await body.evaluate((node) => {
      const animation = node.getAnimations()[0]
      animation.pause()
      const duration = Number(animation.effect!.getTiming().duration)
      const keyframes = (animation.effect as KeyframeEffect).getKeyframes()
      const glideStart = keyframes[2].computedOffset * duration
      const points = [0, 0.2, 0.4, 0.6, 0.8, 1].map((fraction) => {
        animation.currentTime = glideStart + (duration - glideStart) * fraction
        const rect = node.getBoundingClientRect()
        const exhaust = node.querySelector('.rocket-flight-exhaust')!.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, left: rect.left, exhaustLeft: exhaust.left }
      })
      animation.currentTime = glideStart + (duration - glideStart) * 0.3
      return { duration, points, viewportWidth: window.innerWidth }
    })
    expect(samples.duration).toBeGreaterThan(1000)
    expect(samples.duration).toBeLessThanOrEqual(2500)
    for (let index = 1; index < samples.points.length; index++) {
      expect(samples.points[index].x).toBeGreaterThan(samples.points[index - 1].x)
    }
    expect(samples.points[1].y).toBeLessThan(samples.points[0].y)
    expect(samples.points[2].y).toBeGreaterThan(samples.points[1].y)
    expect(samples.points[3].y).toBeLessThan(samples.points[2].y)
    expect(samples.points[4].y).toBeGreaterThan(samples.points[3].y)
    expect(samples.points[5].left).toBeGreaterThan(samples.viewportWidth)
    expect(samples.points[5].exhaustLeft).toBeGreaterThan(samples.viewportWidth)

    const centers = await bodies.evaluateAll((nodes) => nodes.map((node) => {
      const animation = node.getAnimations()[0]
      const duration = Number(animation.effect!.getTiming().duration)
      const glideStart = (animation.effect as KeyframeEffect).getKeyframes()[2].computedOffset * duration
      animation.currentTime = glideStart + (duration - glideStart) * 0.3
      const rect = node.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }))
    expect(Math.hypot(centers[0].x - centers[1].x, centers[0].y - centers[1].y)).toBeGreaterThan(44)

    await page.locator('.rocket-flight:not(.rocket-flight-burst) .rocket-flight-body').evaluateAll((nodes) => {
      for (const node of nodes) node.getAnimations()[0]?.finish()
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('paired-rockets.png') })
    await page.locator('.title-bar-action').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await bodies.evaluateAll((nodes) => nodes.forEach((node) => {
      const animation = node.getAnimations()[0]
      animation.currentTime = 0
      animation.play()
    }))
    await expect(rocket).toHaveCount(0, { timeout: samples.duration + 5000 })
    await brand.click()
    await brand.click()
    await brand.click()
    await expect(rocket).toHaveCount(6)
    await expect(page.locator('.rocket-flight:not(.rocket-flight-burst)')).toHaveCount(0)
    await expect(rocket).toHaveCount(0, { timeout: 5000 })
    await page.reload()
    await brand.click()
    await expect(page.locator('.rocket-flight-burst')).toHaveCount(0)
    await expect(page.locator('.rocket-flight:not(.rocket-flight-burst)')).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('reduced motion skips both ordinary and burst rockets', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('.title-bar-brand').evaluate((button) => {
      for (let index = 0; index < 40; index++) (button as HTMLButtonElement).click()
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
