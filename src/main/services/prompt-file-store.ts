import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Where an automatic issue session's prompt lives between the renderer rendering it and the
 * agent reading it. A file rather than argv because the npm-shim launch path goes through
 * `cmd.exe`, where a multi-line prompt with quotes and percent signs cannot survive; the
 * argv only ever carries the fixed sentence that names this file.
 *
 * The result file is the way back: the prompt names it (`{{resultFile}}`), the agent writes
 * its outcome there (shared/issue-automation.ts, `parseIssueOutcome`), and the main process
 * reads it while the session runs. Both files share the session's lifetime.
 */
/**
 * Stands in a task prompt (Lark) for the report file's path, which only exists once the session
 * id is minted; the coordinator fills it in before writing the prompt file.
 */
export const REPORT_FILE_PLACEHOLDER = '{{reportFile}}'

export interface PromptFileStore {
  /** Writes the prompt and resolves with the absolute path the agent will be told to read. */
  write(sessionId: string, text: string): Promise<string>
  /** The absolute path the agent is told to write its outcome to. Throws for an unsafe id. */
  resultPath(sessionId: string): string
  /** The result file's text, or undefined while the agent has not written one. Never rejects. */
  readResult(sessionId: string): Promise<string | undefined>
  /**
   * The absolute path a task session's agent writes its round report to (see lark-report.ts).
   * Separate from the issue result file: the two mean different things. Throws for an unsafe id.
   */
  reportPath(sessionId: string): string
  /** The report file's text, or undefined while there is none. Never rejects. */
  readReport(sessionId: string): Promise<string | undefined>
  /** Deletes a report once it has been passed on, so the next one is new. Never rejects. */
  removeReport(sessionId: string): Promise<void>
  /** Best effort and never rejects: a prompt file outliving its session is clutter, not a fault. */
  remove(sessionId: string): Promise<void>
}

// Session ids are randomUUID() output. Anything else must not become a file name: the path
// is later pasted into a command line, and a crafted id could point outside the directory.
const SAFE_SESSION_ID = /^[A-Za-z0-9-]+$/u

// Agents write the result with whatever they have. Windows PowerShell 5.1's `>` produces
// UTF-16LE with a BOM; everything else in practice is UTF-8 (with or without one). The BOM is
// left in place for UTF-8: parseIssueOutcome strips it.
const decodeResult = (bytes: Buffer): string => {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  return bytes.toString('utf8')
}

export class DirectoryPromptFileStore implements PromptFileStore {
  constructor(private readonly directory: string) {}

  async write(sessionId: string, text: string): Promise<string> {
    const path = this.pathFor(sessionId, '.md')
    await mkdir(this.directory, { recursive: true })
    await writeFile(path, text, 'utf8')
    return path
  }

  resultPath(sessionId: string): string {
    return this.pathFor(sessionId, '.result.json')
  }

  async readResult(sessionId: string): Promise<string | undefined> {
    if (!SAFE_SESSION_ID.test(sessionId)) return undefined
    return this.readAgentFile(this.resultPath(sessionId))
  }

  reportPath(sessionId: string): string {
    return this.pathFor(sessionId, '.report.json')
  }

  async readReport(sessionId: string): Promise<string | undefined> {
    if (!SAFE_SESSION_ID.test(sessionId)) return undefined
    return this.readAgentFile(this.reportPath(sessionId))
  }

  async removeReport(sessionId: string): Promise<void> {
    if (!SAFE_SESSION_ID.test(sessionId)) return
    await this.removeQuietly(this.reportPath(sessionId))
  }

  async remove(sessionId: string): Promise<void> {
    if (!SAFE_SESSION_ID.test(sessionId)) return
    for (const path of [this.pathFor(sessionId, '.md'), this.resultPath(sessionId), this.reportPath(sessionId)]) {
      await this.removeQuietly(path)
    }
  }

  private async readAgentFile(path: string): Promise<string | undefined> {
    try {
      return decodeResult(await readFile(path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`PromptFileStore: could not read ${path}.`, error)
      }
      return undefined
    }
  }

  private async removeQuietly(path: string): Promise<void> {
    try {
      await rm(path, { force: true })
    } catch (error) {
      console.error(`PromptFileStore: could not remove ${path}.`, error)
    }
  }

  private pathFor(sessionId: string, extension: '.md' | '.result.json' | '.report.json'): string {
    if (!SAFE_SESSION_ID.test(sessionId)) throw new Error(`Refusing to name a prompt file after session id "${sessionId}".`)
    return join(this.directory, `${sessionId}${extension}`)
  }
}

/** The coordinator's default when no store was injected (tests): an initial prompt cannot be honoured. */
export const unavailablePromptFileStore: PromptFileStore = {
  write: async () => {
    throw new Error('Prompt files are not configured.')
  },
  resultPath: () => {
    throw new Error('Prompt files are not configured.')
  },
  readResult: async () => undefined,
  reportPath: () => {
    throw new Error('Prompt files are not configured.')
  },
  readReport: async () => undefined,
  removeReport: async () => undefined,
  remove: async () => undefined
}
