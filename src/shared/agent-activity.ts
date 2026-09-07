import type { SessionKind } from './contracts'

const MAX_CONTROL_CHARS = 128
const MAX_LINE_CHARS = 2_048

/** CLI activity signals, kept separately from PTY silence and the bounded replay tail. */
export class AgentActivityTracker {
  private parser: 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' | 'string' | 'string-escape' = 'text'
  private control = ''
  private line = ''
  private lineDirty = false
  private needsCompleteLine = false
  private progress: boolean | undefined
  private hostRunning: boolean | undefined
  private safeOffset = 0
  private backgroundCount = 0
  private known = false
  private pathAgents = false
  private resumedAgent: string | undefined
  private readonly agents = new Set<string>()

  constructor(private readonly kind: SessionKind) {}

  get running(): boolean | undefined {
    return this.hostRunning ?? (this.known ? this.progress === true || this.backgroundCount > 0 || this.agents.size > 0 : undefined)
  }

  get atControlBoundary(): boolean {
    return this.parser === 'text'
  }

  get lastControlBoundary(): number {
    return this.safeOffset
  }

  /** A private OSC string is ignored visually by existing terminal clients. */
  replaySignal(): string {
    return this.running === undefined ? '' : `\u001b]777;codeflai-activity;${this.running ? 1 : 0}\u0007`
  }

  writeReplay(data: string): void {
    const snapshot = /^\u001b\]777;codeflai-activity;([01])\u0007/.exec(data)
    this.write(snapshot ? data.slice(snapshot[0].length) : data)
    // The snapshot describes the end of the retained stream, even when that stream
    // ends inside an OSC/CSI or no longer contains the original background starts.
    if (snapshot) this.hostRunning = snapshot[1] === '1'
  }

  write(data: string): void {
    if (this.kind !== 'claude' && this.kind !== 'codex') return
    this.safeOffset = this.atControlBoundary ? 0 : -1
    let offset = 0
    for (const character of data) {
      if (this.atControlBoundary) this.safeOffset = offset
      offset += character.length
      if (this.parser === 'osc' || this.parser === 'osc-escape') {
        if (character === '\u0007' || character === '\u009c' || (this.parser === 'osc-escape' && character === '\\')) {
          this.readProgress()
          this.control = ''
          this.parser = 'text'
        } else if (character === '\u001b') {
          this.parser = 'osc-escape'
        } else {
          if (this.control.length <= MAX_CONTROL_CHARS) this.control += character
          this.parser = 'osc'
        }
        continue
      }
      if (this.parser === 'string' || this.parser === 'string-escape') {
        if (character === '\u009c' || (this.parser === 'string-escape' && character === '\\')) this.parser = 'text'
        else this.parser = character === '\u001b' ? 'string-escape' : 'string'
        continue
      }
      if (this.parser === 'escape') {
        if (character === ']') this.parser = 'osc'
        else if (character === '[') this.parser = 'csi'
        else if ('PX^_'.includes(character)) this.parser = 'string'
        else this.parser = 'text'
        this.control = ''
        continue
      }
      if (this.parser === 'csi') {
        if (character >= '@' && character <= '~') {
          // SGR changes style within a row; cursor movement and erasure end that row.
          if (character !== 'm') this.finishLine()
          this.parser = 'text'
        }
        continue
      }
      if (character === '\u001b') { this.readLine(); this.parser = 'escape' }
      else if (character === '\u009d') { this.readLine(); this.parser = 'osc'; this.control = '' }
      else if (character === '\u009b') { this.readLine(); this.parser = 'csi' }
      else if (character === '\r' || character === '\n') this.finishLine()
      else if (character === '\b') { this.line = this.line.slice(0, -1); this.lineDirty = true }
      else if (character >= ' ' && this.line.length <= MAX_LINE_CHARS) { this.line += character; this.lineDirty = true }
    }
    // TUIs often finish a repaint without a newline. The recognized rows are idempotent.
    if (this.parser === 'text') { this.safeOffset = offset; this.readLine() }
  }

  private readProgress(): void {
    const snapshot = /^777;codeflai-activity;([01])$/.exec(this.control)
    if (snapshot) {
      this.hostRunning = snapshot[1] === '1'
      return
    }
    // Claude's progress includes pending background agents. Other CLIs' progress
    // can describe only the foreground turn, so it must not clear their subagents.
    if (this.kind !== 'claude') return
    const match = /^9;4;([0-4])(?:;\d{0,3})?$/.exec(this.control)
    if (!match) return
    this.known = true
    this.progress = match[1] === '1' || match[1] === '3'
    if (!this.progress) {
      this.backgroundCount = 0
      this.agents.clear()
      this.needsCompleteLine = false
    }
  }

  private finishLine(): void {
    this.readLine(true)
    this.line = ''
    this.lineDirty = false
    this.needsCompleteLine = false
  }

  private readLine(complete = false): void {
    if (!this.lineDirty && !(complete && this.needsCompleteLine)) return
    this.lineDirty = false
    this.needsCompleteLine = false
    if (this.line.length > MAX_LINE_CHARS) return
    if (this.kind === 'claude') this.readClaudeLine()
    else this.readCodexLine(complete)
  }

  private readClaudeLine(): void {
    // Claude 2.1's turn-duration renderer replaces "Worked for ..." with this
    // aggregate while background agents/workflows are still pending, including results.
    const line = this.line.replace(/^[\s\u273b\u273d\u2736\u2722\u2723\u2726\u23fa\u2022*]+/, '')
    const waiting = /^Waiting for (?:(\d+) background agents?)?(?: and )?(?:(\d+) dynamic workflows?)? to finish\s*$/.exec(line)
    if (waiting && (waiting[1] || waiting[2])) {
      this.known = true
      this.backgroundCount = Number(waiting[1] ?? 0) + Number(waiting[2] ?? 0)
    } else if (/^(?:All background agents stopped|No background agents running)\s*$/.test(line) ||
      /^(?:Baked|Brewed|Churned|Cogitated|Cooked|Crunched|Saut\u00e9ed|Worked) for \d[^\r\n]*[smh](?:\s|$)/.test(line)) {
      this.known = true
      this.backgroundCount = 0
      this.agents.clear()
    }
  }

  private readCodexLine(complete: boolean): void {
    // OpenAI's multi_agents.rs renders these structured activity rows with a path.
    const activity = /^\s*\u2022 (Started|Completed|Interrupted) `([^`\r\n]+)`\s*$/.exec(this.line)
    if (activity) {
      this.known = true
      if (!this.pathAgents) { this.agents.clear(); this.pathAgents = true }
      if (activity[1] === 'Started') this.agents.add(activity[2]!)
      else this.agents.delete(activity[2]!)
      return
    }
    if (this.pathAgents) return
    if (!complete) { this.needsCompleteLine = true; return }
    // Older spawn_agent/wait/close_agent render agent nicknames (or UUIDs).
    const lifecycle = /^\s*\u2022 (Spawned|Resumed|Closed) ([^\s[(:]+)(?:\s|$)/.exec(this.line)
    if (lifecycle) {
      this.known = true
      this.resumedAgent = lifecycle[1] === 'Resumed' ? lifecycle[2] : undefined
      if (lifecycle[1] === 'Closed') this.agents.delete(lifecycle[2]!)
      else this.agents.add(lifecycle[2]!)
      return
    }
    if (/^\s*\u2022 /.test(this.line)) this.resumedAgent = undefined
    const resumedStatus = /^\s+\u2514 (Pending init|Running|Completed|Error|Interrupted|Shutdown|Not found)(?:\s|$)/.exec(this.line)
    if (resumedStatus && this.resumedAgent) {
      if (resumedStatus[1] !== 'Pending init' && resumedStatus[1] !== 'Running') this.agents.delete(this.resumedAgent)
      this.resumedAgent = undefined
      return
    }
    const status = /^\s+(?:\u2514\s+)?([^\s[:]+)(?: \[[^\]]+\])?: (Pending init|Running|Completed|Error|Interrupted|Shutdown|Not found)(?:\s|$)/.exec(this.line)
    if (!status || !this.agents.has(status[1]!)) return
    if (status[2] !== 'Pending init' && status[2] !== 'Running') this.agents.delete(status[1]!)
  }
}
