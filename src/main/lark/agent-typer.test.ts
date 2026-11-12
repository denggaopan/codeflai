import { describe, expect, it } from 'vitest'

import { AGENT_SUBMIT_DELAY_MS, createAgentTyper } from './agent-typer'

describe('createAgentTyper', () => {
  it('types the line, waits, then presses Enter as a separate write', async () => {
    const events: string[] = []
    const type = createAgentTyper(
      (sessionId, data) => events.push(`write ${sessionId} ${JSON.stringify(data)}`),
      async (ms) => {
        events.push(`wait ${ms}`)
      }
    )
    await type('s1', '[Lark 回复 · a] CSV')
    expect(events).toEqual(['write s1 "[Lark 回复 · a] CSV"', `wait ${AGENT_SUBMIT_DELAY_MS}`, 'write s1 "\\r"'])
  })

  it('rejects, without pressing Enter, when the write fails', async () => {
    const writes: string[] = []
    const type = createAgentTyper(
      (_sessionId, data) => {
        writes.push(data)
        throw new Error('no such session')
      },
      async () => undefined
    )
    await expect(type('s1', 'x')).rejects.toThrow('no such session')
    expect(writes).toEqual(['x'])
  })
})
