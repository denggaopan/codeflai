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

test('consecutive logo clicks launch independent random glides and reset after a three-second gap', async ({}, testInfo) => {
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
    await page.evaluate(() => {
      performance.now = () => 1000
      let seed = 42
      Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 0x100000000
      }
    })
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
    expect(new Set(samples.points.map((point) => Math.round(point.y))).size).toBeGreaterThan(3)
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
    const tracks = await bodies.evaluateAll((nodes) => nodes.map((node) => {
      const frames = (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes().slice(2)
      return frames.map((frame) => String(frame.transform))
    }))
    expect(tracks[0]).not.toEqual(tracks[1])
    expect(tracks[0][0].split('rotate(')[1]).not.toBe(tracks[1][0].split('rotate(')[1])

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
    await page.evaluate(() => { performance.now = () => 4000 })
    await brand.click()
    await brand.click()
    await brand.click()
    await expect(rocket).toHaveCount(6)
    await expect(page.locator('.rocket-flight:not(.rocket-flight-burst)')).toHaveCount(0)
    await expect(rocket).toHaveCount(0, { timeout: 5000 })
    await page.evaluate(() => { performance.now = () => 7001 })
    await brand.click()
    await expect(rocket).toHaveCount(0)
    await expect(page.locator('.rocket-flight:not(.rocket-flight-burst)')).toHaveCount(1)
    await brand.evaluate((button) => {
      for (let index = 0; index < 31; index++) (button as HTMLButtonElement).click()
    })
    await expect(rocket).toHaveCount(2)
    await page.reload()
    await brand.click()
    await expect(page.locator('.rocket-flight-burst')).toHaveCount(0)
    await expect(page.locator('.rocket-flight:not(.rocket-flight-burst)')).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('the 48th click launches three independent rockets and a real three-second pause resets them', async ({}, testInfo) => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const brand = page.locator('.title-bar-brand')
    await brand.evaluate((button) => {
      for (let index = 0; index < 47; index++) (button as HTMLButtonElement).click()
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(63)
    await page.locator('.rocket-flight-body').evaluateAll((nodes) => {
      nodes.forEach((node) => node.getAnimations()[0]?.finish())
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(0)
    const lastClick = await brand.evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      return performance.now()
    })
    const rockets = page.locator('.rocket-flight-burst')
    await expect(rockets).toHaveCount(3)
    const tracks = await rockets.locator('.rocket-flight-body').evaluateAll((nodes) => nodes.map((node) => {
      const animation = node.getAnimations()[0]
      animation.pause()
      const frames = (animation.effect as KeyframeEffect).getKeyframes()
      const duration = Number(animation.effect!.getTiming().duration)
      animation.currentTime = duration * 0.55
      return frames.map((frame) => frame.transform)
    }))
    expect(new Set(tracks.map((frames) => JSON.stringify(frames))).size).toBe(3)
    await page.screenshot({ path: testInfo.outputPath('triple-rockets.png') })
    await page.waitForFunction((last) => performance.now() - last > 3100, lastClick)
    await page.locator('.rocket-flight-body').evaluateAll((nodes) => {
      nodes.forEach((node) => node.getAnimations()[0]?.finish())
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(0)
    await brand.click()
    await expect(page.locator('.rocket-flight-burst')).toHaveCount(0)
    await expect(page.locator('.rocket-flight')).toHaveCount(1)
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
      for (let index = 0; index < 55; index++) (button as HTMLButtonElement).click()
    })
    await expect(page.locator('.rocket-flight')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
