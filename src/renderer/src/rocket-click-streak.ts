const CLICK_WINDOW_MS = 60_000
const GRAND_ROCKET_CLICKS = 32

export interface RocketClickStreak {
  clicks: number[]
  grand: boolean
}

/** Count a rolling minute until grand rockets are unlocked for this window's lifetime. */
export function recordRocketClick(previous: RocketClickStreak, now: number): RocketClickStreak {
  if (previous.grand) return previous
  const clicks = previous.clicks.filter((timestamp) => now - timestamp <= CLICK_WINDOW_MS)
  clicks.push(now)
  const grand = clicks.length >= GRAND_ROCKET_CLICKS
  return { clicks: grand ? [] : clicks, grand }
}
