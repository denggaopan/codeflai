const CLICK_WINDOW_MS = 60_000
const MAX_CLICK_GAP_MS = 3000
const BURST_ROCKET_CLICKS = 32
const TRIPLE_ROCKET_CLICKS = 48

export interface RocketClickStreak {
  clicks: number[]
  rocketCount: 1 | 2 | 3
}

/** Unlock two/three rockets within a rolling minute; a gap over three seconds resets both. */
export function recordRocketClick(previous: RocketClickStreak, now: number): RocketClickStreak {
  const lastClick = previous.clicks.at(-1)
  if (lastClick === undefined || now - lastClick > MAX_CLICK_GAP_MS) {
    return { clicks: [now], rocketCount: 1 }
  }
  if (previous.rocketCount === 3) return { clicks: [now], rocketCount: 3 }
  const clicks = previous.clicks.filter((timestamp) => now - timestamp <= CLICK_WINDOW_MS)
  clicks.push(now)
  const rocketCount = clicks.length >= TRIPLE_ROCKET_CLICKS ? 3
    : clicks.length >= BURST_ROCKET_CLICKS ? 2 : previous.rocketCount
  return { clicks: rocketCount === 3 ? [now] : clicks, rocketCount }
}
