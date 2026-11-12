import { describe, expect, it } from 'vitest'

import { LARK_REPORT_TEXT_LIMIT, parseLarkReport } from './lark-report'

describe('parseLarkReport', () => {
  it('reads the three statuses', () => {
    expect(parseLarkReport('{"status":"question","question":"JSON 还是 CSV？"}')).toEqual({ status: 'question', question: 'JSON 还是 CSV？' })
    expect(parseLarkReport('{"status":"done","summary":"已开 PR #57"}')).toEqual({ status: 'done', summary: '已开 PR #57' })
    expect(parseLarkReport('{"status":"blocked","reason":"gh 未登录"}')).toEqual({ status: 'blocked', reason: 'gh 未登录' })
  })

  it('strips a UTF-8 BOM, trims the text and tolerates extra fields', () => {
    expect(parseLarkReport('﻿{"status":"done","summary":"  好了  ","pr":57}')).toEqual({ status: 'done', summary: '好了' })
  })

  it('refuses anything that is not one complete report', () => {
    for (const raw of [
      '',
      '{"status":"quest',
      'null',
      '[]',
      '{"status":"question"}',
      '{"status":"question","question":"   "}',
      '{"status":"done","question":"x"}',
      '{"status":"waiting","summary":"x"}',
      '{"status":"done","summary":42}'
    ]) {
      expect(parseLarkReport(raw), raw).toBeUndefined()
    }
  })

  it('cuts overlong text', () => {
    const report = parseLarkReport(JSON.stringify({ status: 'question', question: '问'.repeat(LARK_REPORT_TEXT_LIMIT + 1) }))
    expect(report).toEqual({ status: 'question', question: `${'问'.repeat(LARK_REPORT_TEXT_LIMIT)}…` })
  })
})
