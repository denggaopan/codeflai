import type { Terminal } from '@xterm/xterm'

import { isAgentKind } from '../../../shared/agent-kinds'
import type { SessionKind } from '../../../shared/contracts'
import { AGENT_NEWLINE_SEQUENCE } from './terminal-key-bindings'

type PromptTerminal = Pick<Terminal, 'paste' | 'input' | 'focus'> & {
  modes: Pick<Terminal['modes'], 'bracketedPasteMode'>
}

export function insertQuickPrompt(terminal: PromptTerminal, kind: SessionKind, content: string): boolean {
  const text = content.replace(/\r\n?/g, '\n')
  const bracketed = terminal.modes.bracketedPasteMode
  if (text.includes('\n') && !bracketed && !isAgentKind(kind)) return false

  if (bracketed) {
    terminal.paste(text)
  } else {
    // Raw newlines can submit a prompt. Reuse the agent's Shift+Enter encoding instead;
    // tabs become spaces so shells cannot interpret a saved indentation as completion.
    text.replace(/\t/g, '    ').split('\n').forEach((line, index) => {
      if (index > 0) terminal.input(AGENT_NEWLINE_SEQUENCE, true)
      if (line) terminal.paste(line)
    })
  }
  terminal.focus()
  return true
}
