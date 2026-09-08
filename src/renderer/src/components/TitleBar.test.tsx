// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '../store/use-app-store'
import TitleBar from './TitleBar'

/** Stand-in for the Animation the real Web Animations API hands back. */
class FakeAnimation {
  cancelled = false
  private readonly listeners = new Map<string, Set<() => void>>()

  addEventListener(type: string, callback: () => void): void {
    const bucket = this.listeners.get(type) ?? new Set()
    bucket.add(callback)
    this.listeners.set(type, bucket)
  }

  removeEventListener(type: string, callback: () => void): void {
    this.listeners.get(type)?.delete(callback)
  }

  cancel(): void {
    this.cancelled = true
  }

  emit(type: string): void {
    for (const callback of [...(this.listeners.get(type) ?? [])]) callback()
  }
}

interface RecordedFlight {
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  animation: FakeAnimation
}

const flights: RecordedFlight[] = []
const originalAnimate = Element.prototype.animate

// jsdom implements neither animate() nor matchMedia(); both are the guards RocketFlight
// checks before it starts a flight, so the suite has to supply them.
function installAnimateStub(): void {
  Element.prototype.animate = function stubAnimate(
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions
  ) {
    const animation = new FakeAnimation()
    flights.push({
      keyframes: (keyframes ?? []) as Keyframe[],
      options: (options ?? {}) as KeyframeAnimationOptions,
      animation
    })
    return animation as unknown as Animation
  } as typeof Element.prototype.animate
}

const rockets = (): NodeListOf<Element> => document.querySelectorAll('.rocket-flight')

const clickBrand = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'Codeflai — launch a rocket' }))
}

const readTransform = (keyframe: Keyframe): { x: number; y: number; headingDeg: number } => {
  const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) rotate\((-?[\d.]+)deg\)/.exec(
    String(keyframe.transform)
  )
  if (!match) throw new Error(`unexpected transform: ${String(keyframe.transform)}`)
  return { x: Number(match[1]), y: Number(match[2]), headingDeg: Number(match[3]) }
}

describe('TitleBar', () => {
  beforeEach(() => {
    flights.length = 0
    useAppStore.getState().reset()
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }) as unknown as typeof window.matchMedia
    installAnimateStub()
  })

  afterEach(() => {
    Element.prototype.animate = originalAnimate
    vi.restoreAllMocks()
  })

  it('keeps a draggable strip next to the no-drag action buttons', () => {
    render(<TitleBar />)
    expect(document.querySelector('.title-bar-drag-area')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Keep window on top' })).not.toBeNull()
  })

  it('offers the pin unpressed, to the right of Settings', () => {
    render(<TitleBar />)

    const pin = screen.getByRole('button', { name: 'Keep window on top' })
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    expect(pin.previousElementSibling).toBe(screen.getByRole('button', { name: 'Settings' }))
  })

  it('shows the pressed pin and the undo label while the window is pinned', () => {
    useAppStore.setState({ windowPinned: true })
    render(<TitleBar />)

    const pin = screen.getByRole('button', { name: 'Stop keeping window on top' })
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    expect(pin.querySelector('svg')).toHaveAttribute('fill', 'currentColor')
  })

  it('launches a rocket when the brand is clicked', async () => {
    render(<TitleBar />)
    expect(rockets()).toHaveLength(0)

    await clickBrand()

    expect(rockets()).toHaveLength(1)
    expect(flights).toHaveLength(1)
  })

  it('drops nose-first, then flies rightwards on the heading it turned to', async () => {
    render(<TitleBar />)
    await clickBrand()

    const frames = flights[0].keyframes.map(readTransform)
    expect(frames[0]).toMatchObject({ x: 0, y: 0, headingDeg: 180 })
    expect(frames[1].y).toBeGreaterThan(0)
    expect(frames[1].y).toBeLessThanOrEqual(500)
    // Turned once, then held that heading all the way off-screen.
    expect(frames[2].headingDeg).not.toBe(180)
    expect(frames[4].headingDeg).toBe(frames[2].headingDeg)
    expect(frames[4].x).toBeGreaterThan(frames[3].x)
  })

  it('spends three of its seconds cruising slowly before the dash out', async () => {
    render(<TitleBar />)
    await clickBrand()

    const { keyframes, options } = flights[0]
    const total = Number(options.duration)
    const cruiseFraction = Number(keyframes[3].offset) - Number(keyframes[2].offset)
    expect(cruiseFraction * total).toBeCloseTo(3000, 0)

    const frames = keyframes.map(readTransform)
    const cruiseSpeed = Math.hypot(frames[3].x - frames[2].x, frames[3].y - frames[2].y) / 3000
    const exitSpeed =
      Math.hypot(frames[4].x - frames[3].x, frames[4].y - frames[3].y) / ((1 - Number(keyframes[3].offset)) * total)
    expect(exitSpeed).toBeGreaterThan(cruiseSpeed * 10)
  })

  it('can have several rockets in the air at once', async () => {
    render(<TitleBar />)
    await clickBrand()
    await clickBrand()
    await clickBrand()

    expect(rockets()).toHaveLength(3)
  })

  it('unlocks two independently directed rockets while clicks remain consecutive', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    let seed = 42
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    })
    render(<TitleBar />)
    const brand = screen.getByRole('button', { name: 'Codeflai — launch a rocket' })
    for (let index = 0; index < 31; index++) fireEvent.click(brand)
    expect(document.querySelectorAll('.rocket-flight-burst')).toHaveLength(0)
    fireEvent.click(brand)
    expect(rockets()).toHaveLength(33)
    const burst = document.querySelector('.rocket-flight-burst')
    expect(burst).not.toBeNull()
    expect(document.querySelectorAll('.rocket-flight-burst')).toHaveLength(2)
    for (const rocket of document.querySelectorAll('.rocket-flight-burst')) {
      expect(rocket.querySelector('svg')).toHaveAttribute('width', '32')
      expect(rocket.querySelector('svg')).toHaveAttribute('height', '44')
    }
    expect(rockets()[31].getAttribute('style')).not.toBe(rockets()[32].getAttribute('style'))
    expect(flights[31].keyframes).not.toEqual(flights[32].keyframes)
    expect(readTransform(flights[31].keyframes[2]).headingDeg).not.toBe(readTransform(flights[32].keyframes[2]).headingDeg)
    expect(Number(flights[31].options.duration)).toBeLessThanOrEqual(2500)
    expect(flights[31].keyframes.length).toBeGreaterThan(20)
    expect(burst!.querySelector('.rocket-flight-exhaust')).not.toBeNull()
    now.mockReturnValue(4000)
    fireEvent.click(brand)
    expect(document.querySelectorAll('.rocket-flight-burst')).toHaveLength(4)
    expect(flights[33].keyframes.length).toBeGreaterThan(20)
    expect(flights[34].keyframes.length).toBeGreaterThan(20)
    act(() => flights[31].animation.emit('finish'))
    expect(document.querySelectorAll('.rocket-flight-burst')).toHaveLength(3)
    act(() => flights[32].animation.emit('finish'))
    expect(document.querySelectorAll('.rocket-flight-burst')).toHaveLength(2)
    act(() => {
      flights[33].animation.emit('finish')
      flights[34].animation.emit('finish')
    })
    expect(document.querySelectorAll('.rocket-flight-burst')).toHaveLength(0)
    now.mockReturnValue(7001)
    fireEvent.click(brand)
    expect(document.querySelectorAll('.rocket-flight-burst')).toHaveLength(0)
    expect(flights[35].keyframes).toHaveLength(5)
  })

  it('launches three independent rockets from click 48 and resets all tiers after a pause', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    render(<TitleBar />)
    const brand = screen.getByRole('button', { name: 'Codeflai — launch a rocket' })
    for (let index = 0; index < 47; index++) fireEvent.click(brand)
    expect(flights).toHaveLength(63)
    fireEvent.click(brand)
    expect(flights).toHaveLength(66)
    const triple = [...rockets()].slice(-3)
    expect(new Set(triple.map((rocket) => rocket.getAttribute('style'))).size).toBe(3)
    expect(triple.every((rocket) => rocket.classList.contains('rocket-flight-burst'))).toBe(true)
    fireEvent.click(brand)
    expect(flights).toHaveLength(69)
    now.mockReturnValue(4001)
    fireEvent.click(brand)
    expect(flights).toHaveLength(70)
    expect(flights[69].keyframes).toHaveLength(5)
  })

  it('expires old logo clicks before deciding whether to launch a burst rocket', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    render(<TitleBar />)
    const brand = screen.getByRole('button', { name: 'Codeflai — launch a rocket' })
    for (let index = 0; index < 31; index++) fireEvent.click(brand)
    now.mockReturnValue(60_001)
    fireEvent.click(brand)
    expect(document.querySelectorAll('.rocket-flight-burst')).toHaveLength(0)
    expect(flights[31].keyframes).toHaveLength(5)
  })

  it('cleans the rocket up once its flight finishes', async () => {
    render(<TitleBar />)
    await clickBrand()

    await act(async () => {
      flights[0].animation.emit('finish')
    })

    expect(rockets()).toHaveLength(0)
  })

  it('does not leave a stranded rocket when animations are unavailable', async () => {
    Element.prototype.animate = undefined as unknown as typeof Element.prototype.animate
    render(<TitleBar />)

    await clickBrand()

    expect(rockets()).toHaveLength(0)
    expect(flights).toHaveLength(0)
  })

  it('skips the flight for viewers who asked for reduced motion', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })) as unknown as typeof window.matchMedia

    render(<TitleBar />)
    await clickBrand()

    expect(flights).toHaveLength(0)
    expect(rockets()).toHaveLength(0)
  })
})
