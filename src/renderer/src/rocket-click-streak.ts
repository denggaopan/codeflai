const CLICK_WINDOW_MS = 60_000
const GRAND_ROCKET_CLICKS = 100

/** Retain only the current rolling minute; a completed streak is consumed once. */
export function recordRocketClick(previous: readonly number[], now: number): { clicks: number[]; grand: boolean } {
  const clicks = previous.filter((timestamp) => now - timestamp <= CLICK_WINDOW_MS)
  clicks.push(now)
  const grand = clicks.length >= GRAND_ROCKET_CLICKS
  return { clicks: grand ? [] : clicks, grand }
}
