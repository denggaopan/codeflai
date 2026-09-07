import { describe, expect, it } from 'vitest'

import { AgentActivityTracker } from './agent-activity'

const osc = (state: number, end = '\u0007'): string => `\u001b]9;4;${state};${end}`

describe('AgentActivityTracker', () => {
  it.each(['\u0007', '\u001b\\', '\u009c'])('reads OSC progress split at every boundary (%j)', (end) => {
    const data = `${osc(3, end)}unrelated output${osc(0, end)}`
    for (let split = 0; split <= data.length; split += 1) {
      const tracker = new AgentActivityTracker('claude')
      tracker.write(data.slice(0, split))
      tracker.write(data.slice(split))
      expect(tracker.running).toBe(false)
    }
    const tracker = new AgentActivityTracker('claude')
    for (const character of osc(3, end)) tracker.write(character)
    expect(tracker.running).toBe(true)
  })

  it.each([0, 2, 4])('clears active progress for clear, error, or paused state %i', (state) => {
    const tracker = new AgentActivityTracker('claude')
    tracker.write(osc(3))
    expect(tracker.running).toBe(true)
    tracker.write(osc(state))
    expect(tracker.running).toBe(false)
  })

  it('keeps the latest progress across unrelated output and ignores malformed control strings', () => {
    const tracker = new AgentActivityTracker('claude')
    tracker.write(osc(1))
    tracker.write('\u001b]0;9;4;0;\u0007\u001b[32mDone\u001b[0m\n\u001b]9;4;33;\u0007')
    expect(tracker.running).toBe(true)
    expect(tracker.replaySignal()).toBe('\u001b]777;codeflai-activity;1\u0007')
  })

  it('tracks Claude aggregate background work on terminals without OSC progress support', () => {
    const tracker = new AgentActivityTracker('claude')
    tracker.write('\u273b Waiting for \u001b[1m2\u001b[0m background agents to finish\r\n')
    expect(tracker.running).toBe(true)
    tracker.write('\u273b Waiting for 1 background agent to finish\r\n')
    expect(tracker.running).toBe(true)
    tracker.write('\u273b Worked for 1m 2s\r\n')
    expect(tracker.running).toBe(false)
  })

  it('clears Claude background activity when all agents stop', () => {
    const tracker = new AgentActivityTracker('claude')
    tracker.write('Waiting for 2 background agents and 1 dynamic workflow to finish\n')
    tracker.write('\u23fa All background agents stopped\n')
    expect(tracker.running).toBe(false)
  })

  it('tracks distinct Codex subagents and does not count redraws or interactions as new work', () => {
    const tracker = new AgentActivityTracker('codex')
    tracker.write('\u2022 Started `/root/one`\n\u2022 Started `/root/two`\n')
    tracker.write('\u2022 Started `/root/one`\n\u2022 Interacted with `/root/one`\n')
    tracker.write('\u2022 Completed `/root/one`\n')
    expect(tracker.running).toBe(true)
    tracker.write('\u2022 Interrupted `/root/two`\n')
    expect(tracker.running).toBe(false)
    tracker.write('\u2022 Interacted with `/root/one`\n')
    expect(tracker.running).toBe(false)
    tracker.write('\u2022 Started `/root/one`\n')
    expect(tracker.running).toBe(true)
  })

  it.each(['Completed - result', 'Error - tool timeout', 'Interrupted', 'Shutdown', 'Not found'])('handles legacy Codex agent terminal status %s', (status) => {
    const tracker = new AgentActivityTracker('codex')
    tracker.write('\u2022 Spawned Robie [worker]\n\u2022 Spawned Bob [worker]\n')
    tracker.write(`\u2022 Finished waiting\n  \u2514 Robie [worker]: ${status}\n    Bob [worker]: Running\n`)
    expect(tracker.running).toBe(true)
    tracker.write('\u2022 Closed Bob [worker]\n')
    expect(tracker.running).toBe(false)
  })

  it('handles chunked text, split ANSI styles and cursor-based row boundaries', () => {
    const tracker = new AgentActivityTracker('codex')
    for (const part of ['\u001b[2K\u2022 St', 'arted \u001b[3', '6m`/root/one`\u001b[0m', '\u001b[2;1H', '\u2022 Com', 'pleted `/root/one`\n']) tracker.write(part)
    expect(tracker.running).toBe(false)
  })

  it('does not retain a truncated nickname from a chunk boundary', () => {
    const tracker = new AgentActivityTracker('codex')
    tracker.write('\u2022 Spawned Rob')
    expect(tracker.running).toBeUndefined()
    tracker.write('ie [worker]\n\u2022 Closed Robie [worker]\n')
    expect(tracker.running).toBe(false)
  })

  it('prefers path activity when the CLI renders both spawn and path notifications', () => {
    const tracker = new AgentActivityTracker('codex')
    tracker.write('\u2022 Spawned Robie [worker]\n\u2022 Started `/root/one`\n')
    tracker.write('\u2022 Completed `/root/one`\n')
    expect(tracker.running).toBe(false)
  })

  it.each(['Completed', 'Interrupted', 'Error - tool timeout'])('handles a resumed legacy agent reporting %s in its detail row', (status) => {
    const tracker = new AgentActivityTracker('codex')
    tracker.write(`\u2022 Resumed Robie [explorer]\n  \u2514 ${status}\n`)
    expect(tracker.running).toBe(false)
  })

  it('does not turn quoted prose, OSC titles, or shell output into agent activity', () => {
    const tracker = new AgentActivityTracker('codex')
    tracker.write('I Started `/root/one` in an example.\n\u001b]0;\u2022 Started `/root/one`\u0007')
    expect(tracker.running).toBeUndefined()
    expect(tracker.replaySignal()).toBe('')
    const shell = new AgentActivityTracker('powershell')
    shell.write(`${osc(3)}\u2022 Started \`/root/one\`\n`)
    expect(shell.running).toBeUndefined()
  })

  it('recovers after an oversized malformed escape or line without retaining unbounded text', () => {
    const tracker = new AgentActivityTracker('claude')
    tracker.write(`\u001b]${'x'.repeat(10_000)}\u0007${'x'.repeat(10_000)}\n`)
    tracker.write(osc(3))
    expect(tracker.running).toBe(true)
  })

  it('does not re-read a previous visible start when a later control clears progress', () => {
    const tracker = new AgentActivityTracker('claude')
    tracker.write('Waiting for 2 background agents to finish')
    tracker.write(osc(0))
    tracker.write('\r\n')
    expect(tracker.running).toBe(false)
  })

  it.each([
    ['claude', 'Waiting for 2 background agents to finish']
  ] as const)('preserves text/control ordering independently of chunk boundaries for %s', (kind, line) => {
    const data = line + osc(0)
    for (let split = 0; split <= data.length; split += 1) {
      const tracker = new AgentActivityTracker(kind)
      tracker.write(data.slice(0, split))
      tracker.write(data.slice(split))
      expect(tracker.running).toBe(false)
    }
  })

  it('does not treat foreground terminal progress as proof that Codex subagents finished', () => {
    const tracker = new AgentActivityTracker('codex')
    tracker.write('\u2022 Started `/root/one`')
    tracker.write(osc(0))
    expect(tracker.running).toBe(true)
    tracker.write('\r\n\u2022 Completed `/root/one`\r\n')
    expect(tracker.running).toBe(false)
  })

  it.each(['\u001b', '\u001b[', '\u001b]', '\u001bP'])('recognizes a completed activity row before an unfinished control %j', (control) => {
    const tracker = new AgentActivityTracker('codex')
    tracker.write('\u2022 Started `/root/old`\n\u2022 Completed `/root/old`\n')
    const line = '\u2022 Started `/root/new`'
    tracker.write(line + control)
    expect(tracker.running).toBe(true)
    expect(tracker.lastControlBoundary).toBe(line.length)
    expect(tracker.atControlBoundary).toBe(false)
  })

  it('restores the host snapshot after history even when the replay ends inside a control string', () => {
    const original = new AgentActivityTracker('codex')
    original.write(osc(0))
    original.write('\u2022 Started `/root/one`')
    original.write('\u001b]')
    const tracker = new AgentActivityTracker('codex')
    tracker.writeReplay(`${original.replaySignal()}${osc(0)}\u2022 Started \`/root/one\`\u001b]`)
    expect(tracker.running).toBe(true)
    expect(tracker.atControlBoundary).toBe(false)
    tracker.write('0;title\u0007\r\n\u2022 Completed `/root/one`\r\n\u001b]777;codeflai-activity;0\u0007')
    expect(tracker.running).toBe(false)
  })
})
