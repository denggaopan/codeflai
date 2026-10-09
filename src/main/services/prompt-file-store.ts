import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Where an automatic issue session's prompt lives between the renderer rendering it and the
 * agent reading it. A file rather than argv because the npm-shim launch path goes through
 * `cmd.exe`, where a multi-line prompt with quotes and percent signs cannot survive; the
 * argv only ever carries the fixed sentence that names this file.
 */
export interface PromptFileStore {
  /** Writes the prompt and resolves with the absolute path the agent will be told to read. */
  write(sessionId: string, text: string): Promise<string>
  /** Best effort and never rejects: a prompt file outliving its session is clutter, not a fault. */
  remove(sessionId: string): Promise<void>
}

// Session ids are randomUUID() output. Anything else must not become a file name: the path
// is later pasted into a command line, and a crafted id could point outside the directory.
const SAFE_SESSION_ID = /^[A-Za-z0-9-]+$/u

export class DirectoryPromptFileStore implements PromptFileStore {
  constructor(private readonly directory: string) {}

  async write(sessionId: string, text: string): Promise<string> {
    const path = this.pathFor(sessionId)
    await mkdir(this.directory, { recursive: true })
    await writeFile(path, text, 'utf8')
    return path
  }

  async remove(sessionId: string): Promise<void> {
    if (!SAFE_SESSION_ID.test(sessionId)) return
    const path = this.pathFor(sessionId)
    try {
      await rm(path, { force: true })
    } catch (error) {
      console.error(`PromptFileStore: could not remove ${path}.`, error)
    }
  }

  private pathFor(sessionId: string): string {
    if (!SAFE_SESSION_ID.test(sessionId)) throw new Error(`Refusing to name a prompt file after session id "${sessionId}".`)
    return join(this.directory, `${sessionId}.md`)
  }
}

/** The coordinator's default when no store was injected (tests): an initial prompt cannot be honoured. */
export const unavailablePromptFileStore: PromptFileStore = {
  write: async () => {
    throw new Error('Prompt files are not configured.')
  },
  remove: async () => undefined
}
