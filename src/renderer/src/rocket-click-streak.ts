const CLICK_WINDOW_MS = 60_000
const BURST_ROCKET_CLICKS = 32

export interface RocketClickStreak {
  clicks: number[]
  burst: boolean
}

/** Count a rolling minute until burst rockets are unlocked for this window's lifetime. */
export function recordRocketClick(previous: RocketClickStreak, now: number): RocketClickStreak {
  if (previous.burst) return previous
  const clicks = previous.clicks.filter((timestamp) => now - timestamp <= CLICK_WINDOW_MS)
  clicks.push(now)
  const burst = clicks.length >= BURST_ROCKET_CLICKS
  return { clicks: burst ? [] : clicks, burst }
}
