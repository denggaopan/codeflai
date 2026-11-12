import { z } from 'zod'

/** Longest question, summary or reason passed on to the chat; longer text is cut with an ellipsis. */
export const LARK_REPORT_TEXT_LIMIT = 1000

/**
 * What a Lark session's agent writes to its report file at the end of a round. The status is
 * stated by the agent instead of guessed from silence: a question waits for the requester, done
 * is a result to look at, blocked is a dead end the agent cannot get past alone.
 */
export type LarkReport =
  | { status: 'question'; question: string }
  | { status: 'done'; summary: string }
  | { status: 'blocked'; reason: string }

const text = z.string().trim().min(1)

// Not strict: an agent adding a field of its own must not cost the requester the report.
const reportSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('question'), question: text }),
  z.object({ status: z.literal('done'), summary: text }),
  z.object({ status: z.literal('blocked'), reason: text })
])

const clip = (value: string): string => {
  const chars = Array.from(value)
  return chars.length <= LARK_REPORT_TEXT_LIMIT ? value : `${chars.slice(0, LARK_REPORT_TEXT_LIMIT).join('')}…`
}

/** Undefined for anything that is not one complete report (including a half-written file). */
export function parseLarkReport(raw: string): LarkReport | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw.replace(/^﻿/u, ''))
  } catch {
    return undefined
  }
  const parsed = reportSchema.safeParse(value)
  if (!parsed.success) return undefined
  const report = parsed.data
  switch (report.status) {
    case 'question':
      return { status: 'question', question: clip(report.question) }
    case 'done':
      return { status: 'done', summary: clip(report.summary) }
    case 'blocked':
      return { status: 'blocked', reason: clip(report.reason) }
  }
}
