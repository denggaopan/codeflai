import type { CloneProgress } from '../../shared/contracts'

/**
 * Reads the newest complete progress refresh out of a chunk of `git clone --progress` stderr.
 *
 * Git separates refreshes of one phase with \r and finished lines with \n, so a chunk holds
 * anywhere from half a refresh to dozens of them. Only the last one matters -- the earlier
 * ones were already overwritten on a terminal and would only be rendered and discarded here.
 *
 * Returns undefined when the chunk contains no complete line, which leaves the display on
 * whatever it was showing. Percentages are absent on phase announcements and summary lines;
 * callers keep the previous value rather than dropping the bar back to zero.
 */
export function parseCloneProgress(chunk: string): CloneProgress | undefined {
  const segments = chunk.split(/[\r\n]/u)
  // A chunk not ending on a separator ends mid-refresh, so its tail is a torn line.
  if (!/[\r\n]$/u.test(chunk)) segments.pop()

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const line = segments[index]!.trim()
    if (!line) continue
    // Only a percent sign marks a percentage. Counts like "(delta 1545)" must not match.
    const percent = /(\d{1,3})%/u.exec(line)
    return percent ? { line, percent: Number(percent[1]) } : { line }
  }
  return undefined
}
