# Automatic Issue Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project with no running session start an agent session on its own, with a first prompt that tells the agent to pick one open issue, claim it, fix it with `fast-do`, wait for the test deployment and close the issue.

**Architecture:** Codeflai is only the trigger and the prompt template. A renderer-side watcher (shaped like the auto-shutdown watcher) creates a worktree session through the existing `session:create` IPC with two new optional fields, `initialPrompt` and `title`. The main process writes the prompt to `<userData>/issue-automation/<sessionId>.md` and the pty-host appends one fixed argv sentence naming that file, because the npm-shim launch path goes through `cmd.exe` and a multi-line prompt cannot survive its parsing. Everything that touches the issue tracker or CI happens inside the agent session.

**Tech Stack:** Electron, React 19, TypeScript, zustand, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-issue-automation-design.md`

One deliberate deviation from the spec's wording: both launch adapters take the prompt file as a **third optional parameter** (`resolveLaunchSpec(kind, resume, initialPromptFile?)`) rather than an options object. Behaviour is identical; it avoids rewriting ~30 existing call sites in the two adapter test files.

## Global Constraints

- Agents: only `claude` and `codex` may run an automatic issue session (`ISSUE_AUTOMATION_AGENT_KINDS`).
- Skill invocation prefixes: `/fast-do` for Claude Code, `$fast-do` for Codex.
- Interval candidates, minutes: `[5, 10, 15, 30, 60, 120, 240]`; default 30 minutes; first check one full interval after (re)start.
- localStorage key `codeflai.issueAutomation`, shape `{ agent, intervalMs, template: string | null, projects: string[] }`; never part of `AppState`.
- Placeholders: `{{repoUrl}}`, `{{host}}` (`github` / `gitlab` / `unknown`), `{{projectPath}}`, `{{projectName}}`, `{{fastDo}}`; unknown placeholders stay verbatim.
- Prompt file path blacklist: `% ! " & | < > ^` and control characters (same as `validateShimPath`).
- The argv sentence: `<prefix> Read the task file at <path> and carry it out exactly, without asking questions.` — always the last argv element; never on resume.
- `createSessionRequestSchema.initialPrompt` max 20000 characters; `title` trimmed, 1–200.
- `PTY_PROTOCOL_VERSION` goes from 1 to 2 (release notes must say running sessions restart once on upgrade).
- Every new UI string exists in `en.ts`, `zh-CN.ts` and `zh-TW.ts`; zh-TW is an independent translation and must not contain the simplified-only characters `i18n/index.test.ts` scans for.
- Commits: English, Conventional Commits prefix, end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run tests with the sandbox off (see memory `test-runs-need-sandbox-off`); from a Codeflai/Claude terminal clear `ELECTRON_RUN_AS_NODE` before `npm run test:e2e`.

## Review Focus

Inputs the spec implies but a casual implementation would get wrong. Each has a test pinned to the task that owns the code:

1. **A Windows path or a `$`-prefixed prefix inside the rendered template** must come out verbatim: `String.replace` with a *string* replacement interprets `$&`/`$1`. → Task 1 test "renders backslashes and dollar signs verbatim".
2. **A prompt file path with spaces** (a user name like `Dev Name`) must reach the shim path quoted and the direct path unquoted. → Task 3 tests on both adapters.
3. **A stored preference whose `projects` is not an array of strings, or whose agent is a kind this build cannot automate** must fall back without taking the whole preference down. → Task 1 test "reads a damaged preference leniently".
4. **A second trigger while a launch is still in flight** (double click on "Resolve one issue now", or a tick landing during a slow worktree creation) must not create two sessions. → Task 8 test "ignores a trigger while the project's launch is in flight".
5. **The watcher tick before the snapshot has arrived** must launch nothing. → Task 8 test "launches nothing while the snapshot is still empty".

---

### Task 1: Shared pure functions for issue automation

**Files:**
- Create: `src/shared/issue-automation.ts`
- Test: `src/shared/issue-automation.test.ts`

**Interfaces:**
- Consumes: `ProjectRecord`, `RepoHost`, `RepoRemote`, `SessionKind` types from `src/shared/contracts.ts`.
- Produces (used by Tasks 3, 8, 9, 10, 11):
  - `ISSUE_AUTOMATION_AGENT_KINDS: readonly ['claude', 'codex']`, `type IssueAutomationAgent`, `isIssueAutomationAgent(value: unknown): value is IssueAutomationAgent`
  - `ISSUE_AUTOMATION_INTERVAL_MINUTES`, `ISSUE_AUTOMATION_INTERVAL_OPTIONS: readonly number[]`, `DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS`, `isIssueAutomationInterval(value: unknown): value is number`, `formatIssueAutomationInterval(ms: number): string`
  - `type IssueAutomationTemplateValues = { repoUrl; host; projectPath; projectName; fastDo }`, `issueAutomationHostLabel(host: RepoHost): string`, `issueAutomationTemplateValues(project: Pick<ProjectRecord, 'name' | 'path'>, repoRemote: RepoRemote, agent: IssueAutomationAgent): IssueAutomationTemplateValues`, `renderIssueAutomationTemplate(template: string, values: IssueAutomationTemplateValues): string`
  - `validatePromptFilePath(path: string): void`, `issueAutomationPromptArgument(kind: SessionKind, promptFilePath: string): string`
  - `formatIssueAutomationTime(date: Date): string` (`MM-DD HH:mm`, local time)
  - `type IssueAutomationPreference = { agent: IssueAutomationAgent; intervalMs: number; template: string | null; projects: string[] }`, `DEFAULT_ISSUE_AUTOMATION`, `parseStoredIssueAutomation(raw: string | null): IssueAutomationPreference`, `pruneIssueAutomationProjects(preference, knownProjectIds: readonly string[]): IssueAutomationPreference`

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/issue-automation.test.ts
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ISSUE_AUTOMATION,
  DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS,
  ISSUE_AUTOMATION_AGENT_KINDS,
  ISSUE_AUTOMATION_INTERVAL_OPTIONS,
  formatIssueAutomationInterval,
  formatIssueAutomationTime,
  isIssueAutomationAgent,
  isIssueAutomationInterval,
  issueAutomationHostLabel,
  issueAutomationPromptArgument,
  issueAutomationTemplateValues,
  parseStoredIssueAutomation,
  pruneIssueAutomationProjects,
  renderIssueAutomationTemplate,
  validatePromptFilePath
} from './issue-automation'

const values = {
  repoUrl: 'https://github.com/me/app',
  host: 'github',
  projectPath: 'C:\\Projects\\App',
  projectName: 'App',
  fastDo: '/fast-do'
}

describe('agents and intervals', () => {
  it('automates only Claude Code and Codex', () => {
    expect(ISSUE_AUTOMATION_AGENT_KINDS).toEqual(['claude', 'codex'])
    expect(isIssueAutomationAgent('claude')).toBe(true)
    expect(isIssueAutomationAgent('codex')).toBe(true)
    expect(isIssueAutomationAgent('gemini')).toBe(false)
    expect(isIssueAutomationAgent(undefined)).toBe(false)
  })

  it('offers the documented intervals with 30 minutes as the default', () => {
    expect(ISSUE_AUTOMATION_INTERVAL_OPTIONS).toEqual([5, 10, 15, 30, 60, 120, 240].map((m) => m * 60_000))
    expect(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS).toBe(30 * 60_000)
    expect(isIssueAutomationInterval(5 * 60_000)).toBe(true)
    expect(isIssueAutomationInterval(0)).toBe(false)
    expect(isIssueAutomationInterval('300000')).toBe(false)
  })

  it('formats intervals as minutes below the hour and hours from there', () => {
    expect(ISSUE_AUTOMATION_INTERVAL_OPTIONS.map(formatIssueAutomationInterval)).toEqual(['5m', '10m', '15m', '30m', '1h', '2h', '4h'])
  })
})

describe('template rendering', () => {
  it('names the host for the agent and calls the generic git host unknown', () => {
    expect(issueAutomationHostLabel('github')).toBe('github')
    expect(issueAutomationHostLabel('gitlab')).toBe('gitlab')
    expect(issueAutomationHostLabel('git')).toBe('unknown')
  })

  it('builds the placeholder values from the project and the chosen agent', () => {
    expect(
      issueAutomationTemplateValues({ name: 'App', path: 'C:\\Projects\\App' }, { host: 'git', webUrl: 'https://git.example/app' }, 'codex')
    ).toEqual({ repoUrl: 'https://git.example/app', host: 'unknown', projectPath: 'C:\\Projects\\App', projectName: 'App', fastDo: '$fast-do' })
  })

  it('replaces every placeholder and leaves unknown ones in place', () => {
    const template = 'Repo {{repoUrl}} on {{host}} at {{projectPath}} ({{projectName}}): use {{fastDo}}. Keep {{mystery}}.'
    expect(renderIssueAutomationTemplate(template, values)).toBe(
      'Repo https://github.com/me/app on github at C:\\Projects\\App (App): use /fast-do. Keep {{mystery}}.'
    )
  })

  // Review Focus 1: a string replacement would read `$&` and `$1`, and `$fast-do` starts with one.
  it('renders backslashes and dollar signs verbatim', () => {
    const rendered = renderIssueAutomationTemplate('{{projectPath}} {{fastDo}} {{projectName}}', {
      ...values,
      projectPath: 'C:\\Users\\dev\\$work',
      fastDo: '$fast-do',
      projectName: '$&name'
    })
    expect(rendered).toBe('C:\\Users\\dev\\$work $fast-do $&name')
  })
})

describe('prompt argument', () => {
  it('prefixes the skill invocation for the agent and names the file', () => {
    expect(issueAutomationPromptArgument('claude', 'C:\\Users\\Dev Name\\AppData\\Roaming\\Codeflai\\issue-automation\\s1.md')).toBe(
      '/fast-do Read the task file at C:\\Users\\Dev Name\\AppData\\Roaming\\Codeflai\\issue-automation\\s1.md and carry it out exactly, without asking questions.'
    )
    expect(issueAutomationPromptArgument('codex', '/Users/dev/Library/Application Support/Codeflai/issue-automation/s1.md')).toMatch(/^\$fast-do Read the task file at /)
  })

  it('refuses kinds that cannot run an automatic issue session', () => {
    expect(() => issueAutomationPromptArgument('powershell', 'C:\\p.md')).toThrow('powershell cannot run an automatic issue session.')
    expect(() => issueAutomationPromptArgument('gemini', 'C:\\p.md')).toThrow('gemini cannot run an automatic issue session.')
  })

  it.each(['%', '!', '"', '&', '|', '<', '>', '^', '\u0007', '\u007F'])('rejects a path containing %j', (character) => {
    expect(() => validatePromptFilePath(`C:\\Users\\dev${character}x\\p.md`)).toThrow('cmd.exe would reinterpret')
  })

  it('accepts the standard Windows and macOS profile paths and rejects an empty one', () => {
    expect(() => validatePromptFilePath('C:\\Users\\Dev Name\\AppData\\Roaming\\Codeflai\\issue-automation\\s1.md')).not.toThrow()
    expect(() => validatePromptFilePath('/Users/dev/Library/Application Support/Codeflai/issue-automation/s1.md')).not.toThrow()
    expect(() => validatePromptFilePath('')).toThrow()
  })
})

describe('session title time', () => {
  it('formats local month, day, hour and minute with zero padding', () => {
    expect(formatIssueAutomationTime(new Date(2026, 9, 9, 14, 5))).toBe('10-09 14:05')
    expect(formatIssueAutomationTime(new Date(2026, 0, 1, 0, 0))).toBe('01-01 00:00')
  })
})

describe('stored preference', () => {
  it('defaults to Claude, half an hour, the locale template and no projects', () => {
    expect(DEFAULT_ISSUE_AUTOMATION).toEqual({ agent: 'claude', intervalMs: 30 * 60_000, template: null, projects: [] })
    expect(parseStoredIssueAutomation(null)).toEqual(DEFAULT_ISSUE_AUTOMATION)
  })

  it('reads a complete preference back', () => {
    expect(parseStoredIssueAutomation(JSON.stringify({ agent: 'codex', intervalMs: 3_600_000, template: 'Do {{fastDo}}', projects: ['a', 'b'] }))).toEqual({
      agent: 'codex',
      intervalMs: 3_600_000,
      template: 'Do {{fastDo}}',
      projects: ['a', 'b']
    })
  })

  // Review Focus 3.
  it('reads a damaged preference leniently, field by field', () => {
    expect(parseStoredIssueAutomation(JSON.stringify({ agent: 'gemini', intervalMs: 42, template: 7, projects: 'a' }))).toEqual(DEFAULT_ISSUE_AUTOMATION)
    expect(parseStoredIssueAutomation(JSON.stringify({ projects: ['a', 3, '', 'b'] })).projects).toEqual(['a', 'b'])
    expect(parseStoredIssueAutomation('not json')).toEqual(DEFAULT_ISSUE_AUTOMATION)
    expect(parseStoredIssueAutomation('[]')).toEqual(DEFAULT_ISSUE_AUTOMATION)
  })

  it('prunes project ids that no longer exist and keeps the same object otherwise', () => {
    const preference = { ...DEFAULT_ISSUE_AUTOMATION, projects: ['a', 'ghost', 'b'] }
    expect(pruneIssueAutomationProjects(preference, ['b', 'a'])).toEqual({ ...preference, projects: ['a', 'b'] })
    const intact = { ...DEFAULT_ISSUE_AUTOMATION, projects: ['a'] }
    expect(pruneIssueAutomationProjects(intact, ['a', 'c'])).toBe(intact)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/issue-automation.test.ts`
Expected: FAIL — cannot resolve `./issue-automation`.

- [ ] **Step 3: Write the module**

```ts
// src/shared/issue-automation.ts
import type { ProjectRecord, RepoHost, RepoRemote, SessionKind } from './contracts'

/**
 * Automatic issue resolution: everything pure that the renderer (watcher, Settings, project
 * menu), the main process and the pty-host share. Codeflai itself never reads an issue or a
 * CI result — it renders one prompt from this template, writes it to a file, and starts an
 * agent session whose first argv sentence names that file. See
 * docs/superpowers/specs/2026-10-09-issue-automation-design.md.
 */

/** The agents whose CLIs take a positional prompt and know the user's `fast-do` skill. */
export const ISSUE_AUTOMATION_AGENT_KINDS = ['claude', 'codex'] as const

export type IssueAutomationAgent = (typeof ISSUE_AUTOMATION_AGENT_KINDS)[number]

export const isIssueAutomationAgent = (value: unknown): value is IssueAutomationAgent =>
  (ISSUE_AUTOMATION_AGENT_KINDS as readonly unknown[]).includes(value)

// How each agent invokes a skill by name. Goes into argv, not only into the prompt file, so
// the skill is loaded by the very first message instead of relying on the model to think of it.
const SKILL_INVOCATION: Readonly<Record<IssueAutomationAgent, string>> = {
  claude: '/fast-do',
  codex: '$fast-do'
}

/** Selectable check frequencies, in minutes, in the order the dropdown lists them. */
export const ISSUE_AUTOMATION_INTERVAL_MINUTES = [5, 10, 15, 30, 60, 120, 240] as const

export const ISSUE_AUTOMATION_INTERVAL_OPTIONS: readonly number[] = ISSUE_AUTOMATION_INTERVAL_MINUTES.map(
  (minutes) => minutes * 60_000
)

// Every interval on an idle project costs one agent start that lists issues and exits. Half
// an hour keeps a finished round from waiting long without spinning all day.
export const DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS = 30 * 60_000

export const isIssueAutomationInterval = (value: unknown): value is number =>
  typeof value === 'number' && ISSUE_AUTOMATION_INTERVAL_OPTIONS.includes(value)

/** "5m" … "30m", then "1h" … "4h". Untranslated unit letters, like the auto-shutdown dropdown. */
export const formatIssueAutomationInterval = (intervalMs: number): string => {
  const minutes = Math.round(intervalMs / 60_000)
  return minutes % 60 === 0 && minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`
}

export type IssueAutomationTemplateValues = {
  repoUrl: string
  host: string
  projectPath: string
  projectName: string
  fastDo: string
}

/** What the agent is told the hosting platform is; the generic `git` host is simply unknown. */
export const issueAutomationHostLabel = (host: RepoHost): string => (host === 'git' ? 'unknown' : host)

export const issueAutomationTemplateValues = (
  project: Pick<ProjectRecord, 'name' | 'path'>,
  repoRemote: RepoRemote,
  agent: IssueAutomationAgent
): IssueAutomationTemplateValues => ({
  repoUrl: repoRemote.webUrl,
  host: issueAutomationHostLabel(repoRemote.host),
  projectPath: project.path,
  projectName: project.name,
  fastDo: SKILL_INVOCATION[agent]
})

/**
 * Replaces `{{name}}` placeholders. A function replacer, deliberately: a string replacement
 * would read `$&` and `$1` inside a Windows path or the `$fast-do` prefix. Unknown
 * placeholders are left in place so the agent sees them for what they are.
 */
export const renderIssueAutomationTemplate = (template: string, values: IssueAutomationTemplateValues): string =>
  template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name as keyof IssueAutomationTemplateValues] : match
  )

// The same characters launch-spec.ts refuses in a shim path: the prompt file path is pasted
// into a `cmd.exe /s /c` command line on the npm-shim launch path, and nothing survives cmd's
// two parsing passes reliably, so an unsafe path is refused rather than escaped.
const UNSAFE_PROMPT_PATH = /[%!"&|<>^\u0000-\u001F\u007F]/u

export const validatePromptFilePath = (path: string): void => {
  if (path.length === 0 || UNSAFE_PROMPT_PATH.test(path)) {
    throw new Error('The prompt file path contains characters cmd.exe would reinterpret.')
  }
}

/**
 * The one argv element an automatic issue session starts with. Fixed ASCII plus a validated
 * path, so it can be double-quoted inside the cmd-hosted shim command without escaping.
 */
export const issueAutomationPromptArgument = (kind: SessionKind, promptFilePath: string): string => {
  if (!isIssueAutomationAgent(kind)) throw new Error(`${kind} cannot run an automatic issue session.`)
  validatePromptFilePath(promptFilePath)
  return `${SKILL_INVOCATION[kind]} Read the task file at ${promptFilePath} and carry it out exactly, without asking questions.`
}

/** `MM-DD HH:mm` in local time, for the session title. */
export const formatIssueAutomationTime = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export type IssueAutomationPreference = {
  agent: IssueAutomationAgent
  intervalMs: number
  /** The user's template, or null for the default of the current interface language. */
  template: string | null
  /** Ids of the projects switched on. */
  projects: string[]
}

export const DEFAULT_ISSUE_AUTOMATION: Readonly<IssueAutomationPreference> = {
  agent: 'claude',
  intervalMs: DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS,
  template: null,
  projects: []
}

/**
 * Reads the stored preference leniently, field by field, like the other renderer-owned
 * preferences: an agent this build cannot automate, an interval the dropdown does not offer,
 * or a projects list that is not a list each fall back on their own rather than discarding
 * the rest. An unreadable value means "nothing switched on" — the safe direction for a
 * feature that starts bypass-mode agents.
 */
export const parseStoredIssueAutomation = (raw: string | null): IssueAutomationPreference => {
  if (raw === null) return { ...DEFAULT_ISSUE_AUTOMATION, projects: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...DEFAULT_ISSUE_AUTOMATION, projects: [] }
    const { agent, intervalMs, template, projects } = parsed as {
      agent?: unknown
      intervalMs?: unknown
      template?: unknown
      projects?: unknown
    }
    return {
      agent: isIssueAutomationAgent(agent) ? agent : DEFAULT_ISSUE_AUTOMATION.agent,
      intervalMs: isIssueAutomationInterval(intervalMs) ? intervalMs : DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS,
      template: typeof template === 'string' && template.length > 0 ? template : null,
      projects: Array.isArray(projects)
        ? projects.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
    }
  } catch {
    return { ...DEFAULT_ISSUE_AUTOMATION, projects: [] }
  }
}

/** Drops ids of projects that are no longer in the snapshot. Returns the same object when nothing changes. */
export const pruneIssueAutomationProjects = (
  preference: IssueAutomationPreference,
  knownProjectIds: readonly string[]
): IssueAutomationPreference => {
  const projects = preference.projects.filter((id) => knownProjectIds.includes(id))
  return projects.length === preference.projects.length ? preference : { ...preference, projects }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/issue-automation.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/issue-automation.ts src/shared/issue-automation.test.ts
git commit -m "feat: add the shared issue-automation primitives" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Contracts and the pty-host protocol

**Files:**
- Modify: `src/shared/contracts.ts` (the `createSessionRequestSchema` block, ~line 125)
- Modify: `src/shared/pty-protocol.ts` (`PTY_PROTOCOL_VERSION` line 23; the `spawn` message ~line 66)
- Test: `src/shared/contracts.test.ts`

**Interfaces:**
- Produces: `createSessionRequestSchema` with optional `initialPrompt` (string, 1–20000) and `title` (trimmed string, 1–200); the `spawn` message with optional `initialPromptFile` (string, 1–1024); `PTY_PROTOCOL_VERSION === 2`.

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/contracts.test.ts`, inside the existing `describe` that holds the `createSessionRequestSchema` tests (after the "treats an omitted worktree flag" test):

```ts
  it('accepts the automatic-issue fields only within their bounds', () => {
    const parsed = createSessionRequestSchema.parse({ projectId: 'p1', kind: 'claude', worktree: true, initialPrompt: 'Do it', title: '  Auto issue 10-09 14:30 ' })
    expect(parsed.initialPrompt).toBe('Do it')
    expect(parsed.title).toBe('Auto issue 10-09 14:30')
    expect(createSessionRequestSchema.parse({ projectId: 'p1', kind: 'claude' })).not.toHaveProperty('initialPrompt')
    expect(createSessionRequestSchema.safeParse({ projectId: 'p1', kind: 'claude', initialPrompt: '' }).success).toBe(false)
    expect(createSessionRequestSchema.safeParse({ projectId: 'p1', kind: 'claude', initialPrompt: 'x'.repeat(20_001) }).success).toBe(false)
    expect(createSessionRequestSchema.safeParse({ projectId: 'p1', kind: 'claude', title: '   ' }).success).toBe(false)
    expect(createSessionRequestSchema.safeParse({ projectId: 'p1', kind: 'claude', title: 't'.repeat(201) }).success).toBe(false)
  })
```

And a new file-level `describe` at the end of `src/shared/contracts.test.ts`:

```ts
import { PTY_PROTOCOL_VERSION, ptyRequestSchema } from './pty-protocol'

describe('pty-protocol spawn', () => {
  const spawn = { type: 'spawn', id: 1, sessionId: 's1', kind: 'claude', launchPath: 'C:\\x', resume: false, cols: 80, rows: 24 }

  it('speaks version 2 so a host without the prompt-file field is retired rather than confused', () => {
    expect(PTY_PROTOCOL_VERSION).toBe(2)
  })

  it('carries an optional prompt file path within bounds', () => {
    expect(ptyRequestSchema.parse({ ...spawn, initialPromptFile: 'C:\\p\\s1.md' })).toMatchObject({ initialPromptFile: 'C:\\p\\s1.md' })
    expect(ptyRequestSchema.safeParse(spawn).success).toBe(true)
    expect(ptyRequestSchema.safeParse({ ...spawn, initialPromptFile: '' }).success).toBe(false)
    expect(ptyRequestSchema.safeParse({ ...spawn, initialPromptFile: 'x'.repeat(1025) }).success).toBe(false)
  })
})
```

(Put the import with the other imports at the top of the file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/contracts.test.ts`
Expected: FAIL — `initialPrompt` is an unrecognized key on a strict object; version is 1.

- [ ] **Step 3: Change the schemas**

In `src/shared/contracts.ts` replace the `createSessionRequestSchema` definition with:

```ts
export const createSessionRequestSchema = z.strictObject({
  projectId: z.string().min(1),
  kind: sessionKindSchema,
  worktree: z.boolean().default(false),
  // Automatic issue sessions only (shared/issue-automation.ts): the rendered prompt, which
  // the main process writes to a file for the agent to read on its first turn, and the
  // title the renderer already translated. Both absent for every session the launcher
  // creates, so nothing else in the create path changes.
  initialPrompt: z.string().min(1).max(20_000).optional(),
  title: z.string().trim().min(1).max(200).optional()
})
```

In `src/shared/pty-protocol.ts`:
- Change `export const PTY_PROTOCOL_VERSION = 1` to `export const PTY_PROTOCOL_VERSION = 2` and add above it, inside the existing doc comment: `Version 2 added the optional initialPromptFile on spawn.`
- In the `spawn` message object add, after `resume: z.boolean(),`:

```ts
    // An automatic issue session's prompt file, already written by the main process. The host
    // only ever appends the fixed sentence that names it (see shared/issue-automation.ts).
    initialPromptFile: z.string().min(1).max(1024).optional(),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/contracts.test.ts src/main/services/pty-host-launcher.test.ts src/pty-host/server.test.ts`
Expected: PASS. (The launcher tests derive their version expectations from the constant.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts.ts src/shared/contracts.test.ts src/shared/pty-protocol.ts
git commit -m "feat: carry an initial prompt through session creation and the pty-host spawn" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Both launch adapters append the prompt sentence

**Files:**
- Modify: `src/pty-host/launch-spec.ts` (`resolveLaunchSpec`, ~line 112)
- Modify: `src/main/services/terminal-service.ts` (`TerminalStartOptions` line 17; `start` ~line 151; `resolveLaunchSpec` ~line 234)
- Test: `src/pty-host/launch-spec.test.ts`, `src/main/services/terminal-service.test.ts`

**Interfaces:**
- Consumes: `issueAutomationPromptArgument`, `isIssueAutomationAgent` from Task 1.
- Produces: `LaunchSpecResolver.resolveLaunchSpec(kind: SessionKind, resume: boolean, initialPromptFile?: string)`; `TerminalStartOptions = { resume?: boolean; initialPromptFile?: string }`; `TerminalService.start(session, { initialPromptFile })` spawns with the sentence last.

- [ ] **Step 1: Write the failing tests for the pty-host adapter**

Append to `src/pty-host/launch-spec.test.ts` (new `describe` at the end):

```ts
describe('LaunchSpecResolver initial prompt', () => {
  const promptFile = 'C:\\Users\\Dev Name\\AppData\\Roaming\\Codeflai\\issue-automation\\s1.md'
  const sentence = (prefix: string): string => `${prefix} Read the task file at ${promptFile} and carry it out exactly, without asking questions.`

  it('appends the sentence as the last argv element on a direct executable', async () => {
    const resolver = resolverWith({ locator: locatorWith({ claude: 'C:\\Agents With Spaces\\claude.exe' }) })

    await expect(resolver.resolveLaunchSpec('claude', false, promptFile)).resolves.toEqual({
      file: 'C:\\Agents With Spaces\\claude.exe',
      args: ['--dangerously-skip-permissions', sentence('/fast-do')],
      env: {}
    })
  })

  // Review Focus 2: the path has a space, so the sentence travels double-quoted inside the
  // `/s` outer pair, after the bypass flags.
  it('double-quotes the sentence inside a cmd-hosted shim command', async () => {
    const shim = 'C:\\Users\\Dev Name\\AppData\\Roaming\\npm\\codex.cmd'
    const resolver = resolverWith({
      locator: locatorWith({ codex: shim }),
      environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      candidateExists: vi.fn(async () => false)
    })

    await expect(resolver.resolveLaunchSpec('codex', false, promptFile)).resolves.toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: `/d /s /c ""${shim}" --dangerously-bypass-approvals-and-sandbox --no-daemon "${sentence('$fast-do')}""`,
      env: {}
    })
  })

  it('passes the sentence as its own array element on macOS', async () => {
    const macPrompt = '/Users/dev/Library/Application Support/Codeflai/issue-automation/s1.md'
    const resolver = resolverWith({ locator: locatorWith({ claude: '/opt/homebrew/bin/claude' }), platform: 'darwin' })

    await expect(resolver.resolveLaunchSpec('claude', false, macPrompt)).resolves.toEqual({
      file: '/opt/homebrew/bin/claude',
      args: ['--dangerously-skip-permissions', `/fast-do Read the task file at ${macPrompt} and carry it out exactly, without asking questions.`],
      env: {}
    })
  })

  it('refuses a prompt together with resume, on a shell, on a non-automation agent, and with an unsafe path', async () => {
    const resolver = resolverWith({ locator: locatorWith({ claude: 'C:\\a\\claude.exe', gemini: 'C:\\a\\gemini.exe' }) })

    await expect(resolver.resolveLaunchSpec('claude', true, promptFile)).rejects.toThrow('cannot be combined with resume')
    await expect(resolver.resolveLaunchSpec('powershell', false, promptFile)).rejects.toThrow('powershell cannot run an automatic issue session.')
    await expect(resolver.resolveLaunchSpec('gemini', false, promptFile)).rejects.toThrow('gemini cannot run an automatic issue session.')
    await expect(resolver.resolveLaunchSpec('claude', false, 'C:\\odd&path\\s1.md')).rejects.toThrow('cmd.exe would reinterpret')
  })
})
```

- [ ] **Step 2: Write the failing tests for the in-process adapter**

Append to `src/main/services/terminal-service.test.ts` (new `describe` at the end):

```ts
describe('TerminalService initial prompt', () => {
  const promptFile = 'C:\\Users\\Dev Name\\AppData\\Roaming\\Codeflai\\issue-automation\\s1.md'
  const sentence = `/fast-do Read the task file at ${promptFile} and carry it out exactly, without asking questions.`

  it('spawns a fresh claude session with the sentence as the last argument', async () => {
    const factory = new FakePtyFactory(new FakePty())
    const service = serviceWith(factory, { locator: locatorWith({ claude: 'C:\\Agents With Spaces\\claude.exe' }) })

    await service.start(session('auto-1', 'claude'), { initialPromptFile: promptFile })

    expect(factory.spawn).toHaveBeenCalledWith('C:\\Agents With Spaces\\claude.exe', ['--dangerously-skip-permissions', sentence], expect.any(Object))
  })

  it('double-quotes the sentence inside a hosted .cmd shim command', async () => {
    const shim = 'C:\\Users\\Dev Name\\AppData\\Roaming\\npm\\claude.cmd'
    const comspec = 'C:\\Windows\\System32\\cmd.exe'
    const factory = new FakePtyFactory(new FakePty())
    const service = serviceWith(factory, { locator: locatorWith({ claude: shim }), environment: { ComSpec: comspec } })

    await service.start(session('auto-2', 'claude'), { initialPromptFile: promptFile })

    expect(factory.spawn).toHaveBeenCalledWith(comspec, `/d /s /c ""${shim}" --dangerously-skip-permissions "${sentence}""`, expect.any(Object))
  })

  it('never spawns when the prompt is combined with resume or an unsafe path', async () => {
    const factory = new FakePtyFactory(new FakePty())
    const service = serviceWith(factory, { locator: locatorWith({ claude: 'C:\\a\\claude.exe' }) })

    await expect(service.start(session('auto-3', 'claude'), { resume: true, initialPromptFile: promptFile })).rejects.toThrow('cannot be combined with resume')
    await expect(service.start(session('auto-4', 'claude'), { initialPromptFile: 'C:\\odd|path\\s1.md' })).rejects.toThrow('cmd.exe would reinterpret')
    expect(factory.spawn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run src/pty-host/launch-spec.test.ts src/main/services/terminal-service.test.ts`
Expected: FAIL — the third argument is ignored, so the args lack the sentence and nothing rejects.

- [ ] **Step 4: Change the pty-host adapter**

In `src/pty-host/launch-spec.ts`:
- Add to the imports: `import { isIssueAutomationAgent, issueAutomationPromptArgument } from '../shared/issue-automation'`
- Replace the `resolveLaunchSpec` method with:

```ts
  /**
   * `initialPromptFile` is the automatic-issue prompt the main process already wrote; it adds
   * one fixed argv sentence naming that file (shared/issue-automation.ts) and nothing else.
   * Only a fresh Claude/Codex session can take one: a resumed session continues its own
   * conversation, and a shell has nobody to read the file.
   */
  async resolveLaunchSpec(kind: SessionKind, resume: boolean, initialPromptFile?: string): Promise<LaunchSpec> {
    if (initialPromptFile !== undefined) {
      if (resume) throw new Error('An initial prompt cannot be combined with resume.')
      if (!isIssueAutomationAgent(kind)) throw new Error(`${kind} cannot run an automatic issue session.`)
    }
    if (kind === 'shell') {
      if (this.platform !== 'darwin') throw new Error('Shell is not supported on Windows.')
      const executable = await this.locator.resolveShell()
      if (!executable) throw new Error('Shell is not available.')
      return { file: executable, args: ['-l'] }
    }
    if (kind === 'powershell') {
      if (this.platform === 'darwin') throw new Error('PowerShell is not supported on macOS.')
      const executable = await this.locator.resolvePowerShell()
      if (!executable) throw new Error('PowerShell is not available.')
      return { file: executable, args: [] }
    }
    if (kind === 'cmd') {
      if (this.platform === 'darwin') throw new Error('Command Prompt is not supported on macOS.')
      return { file: this.environment.ComSpec ?? this.environment.COMSPEC ?? 'cmd.exe', args: [] }
    }

    // Every remaining kind is an agent, so the registry decides the executable, the argv and
    // any bypass that has to travel as environment instead of a flag. The prompt sentence is
    // always last: a positional prompt after every flag is what both CLIs document.
    const resolved = await this.locator.resolveAgent(kind)
    if (!resolved) throw new Error(`${kind} is not available.`)
    const launchArgs = agentLaunchArgs(kind, resume, this.platform)
    const logicalArgs = initialPromptFile === undefined
      ? launchArgs
      : [...launchArgs, issueAutomationPromptArgument(kind, initialPromptFile)]
    const env = agentLaunchEnv(kind)
    const spec = this.platform === 'win32'
      ? await windowsAgentSpec(resolved, logicalArgs, this.environment, this.candidateExists)
      : { file: resolved, args: logicalArgs }
    return { ...spec, env }
  }
```

- In `hostedShimSpec`, the sentence contains spaces, so it has to be quoted when it is the prompt. Replace the `command` line with:

```ts
  // Flags never contain spaces; the one argument that can (the initial-prompt sentence) is
  // wrapped in its own quotes inside the `/s` outer pair. Its characters are restricted at
  // the source (validatePromptFilePath), so no escaping is needed or attempted.
  const command = `""${shim}" ${logicalArgs.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}"`
```

- [ ] **Step 5: Change the in-process adapter the same way**

In `src/main/services/terminal-service.ts`:
- Add to the imports: `import { isIssueAutomationAgent, issueAutomationPromptArgument } from '../../shared/issue-automation'`
- Replace `TerminalStartOptions` with:

```ts
export type TerminalStartOptions = {
  /** Relaunch an agent CLI so it reattaches its previous conversation instead of starting a new one. */
  resume?: boolean
  /** An automatic issue session's prompt file; one fixed argv sentence names it. Never with resume. */
  initialPromptFile?: string
}
```

- In `start`, change the resolve line to `const launch = await this.resolveLaunchSpec(session.kind, options.resume === true, options.initialPromptFile)`.
- Apply exactly the same edit to the private `resolveLaunchSpec` as in Step 4 (signature `(kind: SessionKind, resume: boolean, initialPromptFile?: string)`, the two guards at the top, and the `logicalArgs` computation). Its `hostedShimSpec` lives in this file too (search for `const command = \`""${shim}"`): apply the same quoting change. CLAUDE.md says the two adapters must stay equivalent — the two test files assert the same argv.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/pty-host/launch-spec.test.ts src/main/services/terminal-service.test.ts`
Expected: PASS, including every pre-existing test (no existing argv changes because no existing arg contains a space).

- [ ] **Step 7: Commit**

```bash
git add src/pty-host/launch-spec.ts src/pty-host/launch-spec.test.ts src/main/services/terminal-service.ts src/main/services/terminal-service.test.ts
git commit -m "feat: append the automatic-issue prompt sentence in both launch adapters" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Forward the prompt file through the host and the client

**Files:**
- Modify: `src/pty-host/pty-registry.ts` (`spawn`, ~line 129)
- Modify: `src/pty-host/server.ts` (`case 'spawn'`, ~line 329)
- Modify: `src/main/services/pty-host-client.ts` (`TerminalStartOptions` ~line 41; `start` ~line 222)
- Test: `src/pty-host/pty-registry.test.ts`, `src/pty-host/server.test.ts`, `src/main/services/pty-host-client.test.ts`

**Interfaces:**
- Produces: `PtyRegistry.spawn(sessionId, kind, launchPath, resume, cols, rows, initialPromptFile?)`; `PtyHostClient.start(session, { initialPromptFile })` sends `initialPromptFile` in the spawn message only when set.

- [ ] **Step 1: Write the failing tests**

In `src/pty-host/pty-registry.test.ts`, inside the first `describe` that spawns sessions (next to the test asserting `resolveLaunchSpec` was called with `('comate', true)`, ~line 149), add:

```ts
  it('hands the prompt file to the launch resolver along with the kind and resume intent', async () => {
    const harness = buildHarness()

    await harness.registry.spawn('s1', 'claude', 'C:\\Projects\\App', false, 80, 24, 'C:\\prompts\\s1.md')

    expect(harness.resolveLaunchSpec).toHaveBeenCalledWith('claude', false, 'C:\\prompts\\s1.md')
  })
```

In `src/pty-host/server.test.ts`, next to the existing spawn-forwarding test (the one that sends `type: 'spawn'` with `resume: true` and asserts `harness.registry.spawn` was called), add:

```ts
  it('forwards the spawn prompt file to the registry', async () => {
    const harness = buildHarness()
    const socket = await attach(harness)

    await request(socket, {
      type: 'spawn', id: 1, sessionId: 's1', kind: 'claude', launchPath: 'C:\\Projects',
      resume: false, cols: 80, rows: 24, initialPromptFile: 'C:\\prompts\\s1.md'
    })

    expect(harness.registry.spawn).toHaveBeenCalledWith('s1', 'claude', 'C:\\Projects', false, 80, 24, 'C:\\prompts\\s1.md')
  })
```

(`buildHarness`, `attach` and `request` are the file's existing helpers, used the same way by "forwards spawn, write, resize, kill and replay to the registry".)

In `src/main/services/pty-host-client.test.ts`, after "passes the resume intent to the host", add:

```ts
  it('names the prompt file in the spawn message only when one was given', async () => {
    const { client, socket } = await connectedHarness()
    socket.acknowledgeAll()

    await client.start(session('one'), { initialPromptFile: 'C:\\prompts\\one.md' })
    await client.start(session('two'))

    expect(socket.requests[0]).toMatchObject({ type: 'spawn', sessionId: 'one', resume: false, initialPromptFile: 'C:\\prompts\\one.md' })
    expect(socket.requests[1]).not.toHaveProperty('initialPromptFile')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pty-host/pty-registry.test.ts src/pty-host/server.test.ts src/main/services/pty-host-client.test.ts`
Expected: FAIL — the seventh argument / the field is missing.

- [ ] **Step 3: Forward it**

`src/pty-host/pty-registry.ts` — change the `spawn` signature and the resolve call:

```ts
  async spawn(
    sessionId: string,
    kind: SessionKind,
    launchPath: string,
    resume: boolean,
    cols: number,
    rows: number,
    initialPromptFile?: string
  ): Promise<void> {
```
and `const launch = await this.resolver.resolveLaunchSpec(kind, resume, initialPromptFile)`.

`src/pty-host/server.ts` — in `case 'spawn'` add `request.initialPromptFile` as the seventh argument:

```ts
        await registry.spawn(
          request.sessionId,
          request.kind,
          request.launchPath,
          request.resume,
          request.cols,
          request.rows,
          request.initialPromptFile
        )
```

`src/main/services/pty-host-client.ts` — extend the duplicated options type:

```ts
export type TerminalStartOptions = {
  /** Relaunch an agent CLI so it reattaches its previous conversation instead of starting a new one. */
  resume?: boolean
  /** An automatic issue session's prompt file; the host appends the one sentence that names it. */
  initialPromptFile?: string
}
```
and in `start`, build the message as:

```ts
      await this.acknowledged({
        type: 'spawn',
        sessionId: session.id,
        kind: session.kind,
        launchPath: session.launchPath,
        resume: options.resume === true,
        cols: this.cols,
        rows: this.rows,
        // Omitted rather than sent as undefined so a wire log and the exact-shape tests read
        // the same message for an ordinary session as before.
        ...(options.initialPromptFile !== undefined ? { initialPromptFile: options.initialPromptFile } : {})
      })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pty-host src/main/services/pty-host-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pty-host/pty-registry.ts src/pty-host/pty-registry.test.ts src/pty-host/server.ts src/pty-host/server.test.ts src/main/services/pty-host-client.ts src/main/services/pty-host-client.test.ts
git commit -m "feat: forward the initial prompt file through the pty-host spawn" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The prompt file store

**Files:**
- Create: `src/main/services/prompt-file-store.ts`
- Test: `src/main/services/prompt-file-store.test.ts`

**Interfaces:**
- Produces: `interface PromptFileStore { write(sessionId: string, text: string): Promise<string>; remove(sessionId: string): Promise<void> }`; `class DirectoryPromptFileStore implements PromptFileStore` (constructor takes the directory); `unavailablePromptFileStore: PromptFileStore` whose `write` rejects.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/services/prompt-file-store.test.ts
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DirectoryPromptFileStore, unavailablePromptFileStore } from './prompt-file-store'

const created: string[] = []

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'codeflai-prompt-store-'))
  created.push(directory)
  return directory
}

afterEach(async () => {
  for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('DirectoryPromptFileStore', () => {
  it('writes the prompt under <directory>/<sessionId>.md, creating the directory on demand', async () => {
    const root = await temporaryDirectory()
    const store = new DirectoryPromptFileStore(join(root, 'issue-automation'))

    const path = await store.write('3f2a1b4c-0000-4000-8000-000000000001', 'Do the thing\n')

    expect(path).toBe(join(root, 'issue-automation', '3f2a1b4c-0000-4000-8000-000000000001.md'))
    expect(await readFile(path, 'utf8')).toBe('Do the thing\n')
  })

  it('removes a written file, and tolerates a missing one', async () => {
    const root = await temporaryDirectory()
    const store = new DirectoryPromptFileStore(root)
    const path = await store.write('session-a', 'x')

    await store.remove('session-a')
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(store.remove('session-a')).resolves.toBeUndefined()
  })

  it('refuses a session id that is not a plain identifier', async () => {
    const store = new DirectoryPromptFileStore(await temporaryDirectory())

    await expect(store.write('..\\escape', 'x')).rejects.toThrow('Refusing to name a prompt file')
    await expect(store.remove('..\\escape')).resolves.toBeUndefined()
  })
})

describe('unavailablePromptFileStore', () => {
  it('rejects writes and ignores removals', async () => {
    await expect(unavailablePromptFileStore.write('s', 'x')).rejects.toThrow('Prompt files are not configured.')
    await expect(unavailablePromptFileStore.remove('s')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/services/prompt-file-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

```ts
// src/main/services/prompt-file-store.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/services/prompt-file-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/prompt-file-store.ts src/main/services/prompt-file-store.test.ts
git commit -m "feat: add the prompt file store for automatic issue sessions" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Coordinator, IPC, preload and composition root

**Files:**
- Modify: `src/main/services/session-coordinator.ts` (`CreateSessionOptions` ~line 70; `SessionTerminal.start` ~line 87; constructor ~line 125; `create` ~line 141; `delete` ~line 318; `removeProject` ~line 355)
- Modify: `src/main/ipc/register-ipc.ts` (`IPC.sessionCreate` handler ~line 227)
- Modify: `src/preload/index.ts` (`createSession` in the type ~line 45 and the implementation ~line 103)
- Modify: `src/main/index.ts` (`DeferredTerminal.start` ~line 392; coordinator construction ~line 570)
- Test: `src/main/services/session-coordinator.test.ts`

**Interfaces:**
- Consumes: `PromptFileStore`, `unavailablePromptFileStore`, `DirectoryPromptFileStore` from Task 5; `TerminalStartOptions` from Task 3.
- Produces: `CreateSessionOptions = { worktree?: boolean; initialPrompt?: string; title?: string }`; `new SessionCoordinator(store, projectService, worktreeService, terminal, titleService, clock?, createId?, promptFiles?)`; preload `createSession(projectId, kind, worktree, extras?: { initialPrompt?: string; title?: string })`.

- [ ] **Step 1: Write the failing coordinator tests**

In `src/main/services/session-coordinator.test.ts`:
- Add a fake next to `fakeTitleService`:

```ts
const fakePromptFiles = () => ({
  write: vi.fn(async (sessionId: string, _text: string) => `C:\\Profile\\issue-automation\\${sessionId}.md`),
  remove: vi.fn(async (_sessionId: string): Promise<void> => undefined)
})

type FakePromptFiles = ReturnType<typeof fakePromptFiles>
```
- Add `promptFiles: FakePromptFiles` to the `Harness` type, build it in `buildHarness` (`const promptFiles = fakePromptFiles()`), pass it as the eighth constructor argument after `options.createId ?? (() => 'session-1')`, and return it.
- Widen the fake's `start` signature: `readonly start = vi.fn(async (_session: SessionRecord, _options?: { resume?: boolean; initialPromptFile?: string }) => undefined)`.
- Add a new `describe` after `SessionCoordinator.create`:

```ts
describe('SessionCoordinator.create with an initial prompt', () => {
  it('writes the prompt file, starts the PTY with it, and stores the given title as final', async () => {
    const { store, terminalService, promptFiles, coordinator } = buildHarness()

    const record = await coordinator.create('project-1', 'claude', { worktree: true, initialPrompt: 'Pick an issue', title: 'Auto issue 10-09 14:30' })

    expect(promptFiles.write).toHaveBeenCalledWith('session-1', 'Pick an issue')
    expect(terminalService.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }), { initialPromptFile: 'C:\\Profile\\issue-automation\\session-1.md' })
    expect(record).toMatchObject({ title: 'Auto issue 10-09 14:30', titleState: 'complete', titleManuallySet: true, status: 'running' })
    // The file is written after the creating record exists and before the PTY starts.
    expect(store.update.mock.invocationCallOrder[0]).toBeLessThan(promptFiles.write.mock.invocationCallOrder[0]!)
    expect(promptFiles.write.mock.invocationCallOrder[0]).toBeLessThan(terminalService.start.mock.invocationCallOrder[0]!)
  })

  it('starts an ordinary session without any options object and leaves its title pending', async () => {
    const { terminalService, promptFiles, coordinator } = buildHarness()

    const record = await coordinator.create('project-1', 'claude')

    expect(promptFiles.write).not.toHaveBeenCalled()
    expect(terminalService.start).toHaveBeenCalledTimes(1)
    expect(terminalService.start.mock.calls[0]).toHaveLength(1)
    expect(record).toMatchObject({ title: 'New Claude session', titleState: 'pending' })
    expect(record).not.toHaveProperty('titleManuallySet')
  })

  it('removes the prompt file, the record and the worktree when the PTY fails to start', async () => {
    const { store, worktreeService, terminalService, promptFiles, coordinator } = buildHarness()
    worktreeService.create.mockResolvedValue(worktreeLocation)
    terminalService.start.mockRejectedValue(new Error('agent CLI not found'))

    await expect(coordinator.create('project-1', 'claude', { worktree: true, initialPrompt: 'x' })).rejects.toThrow('agent CLI not found')

    expect(promptFiles.remove).toHaveBeenCalledWith('session-1')
    expect((await store.load()).sessions).toHaveLength(0)
    expect(worktreeService.rollback).toHaveBeenCalledWith(worktreeLocation)
  })

  it('removes the record and rolls back when the prompt file itself cannot be written', async () => {
    const { store, worktreeService, terminalService, promptFiles, coordinator } = buildHarness()
    worktreeService.create.mockResolvedValue(worktreeLocation)
    promptFiles.write.mockRejectedValue(new Error('disk full'))

    await expect(coordinator.create('project-1', 'claude', { worktree: true, initialPrompt: 'x' })).rejects.toThrow('disk full')

    expect(terminalService.start).not.toHaveBeenCalled()
    expect(promptFiles.remove).toHaveBeenCalledWith('session-1')
    expect((await store.load()).sessions).toHaveLength(0)
    expect(worktreeService.rollback).toHaveBeenCalledWith(worktreeLocation)
  })

  it('keeps a later typed first input from retitling a session created with a title', async () => {
    const { titleService, coordinator } = buildHarness()
    titleService.generate.mockResolvedValue('Generated title')
    await coordinator.create('project-1', 'claude', { initialPrompt: 'x', title: 'Auto issue 10-09 14:30' })

    await coordinator.submitFirstInput('session-1', 'hello')

    expect(titleService.generate).not.toHaveBeenCalled()
    expect((await coordinator.snapshot()).sessions[0]?.title).toBe('Auto issue 10-09 14:30')
  })
})

describe('SessionCoordinator prompt file lifecycle', () => {
  it('removes the prompt file when the session is deleted', async () => {
    const { promptFiles, coordinator } = buildHarness({ initial: { version: 1, projects: [project], sessions: [runningSession({ status: 'stopped' })] } })

    await expect(coordinator.delete('session-1')).resolves.toEqual({ status: 'deleted' })

    expect(promptFiles.remove).toHaveBeenCalledWith('session-1')
  })

  it('removes every prompt file of a project that is removed from the list', async () => {
    const { promptFiles, coordinator } = buildHarness({
      initial: { version: 1, projects: [project], sessions: [runningSession({ id: 'a', status: 'stopped' }), runningSession({ id: 'b', status: 'stopped' })] }
    })

    await coordinator.removeProject('project-1')

    expect(promptFiles.remove.mock.calls.map(([id]) => id)).toEqual(['a', 'b'])
  })

  it('never passes a prompt when restoring or reconciling', async () => {
    const { terminalService, coordinator } = buildHarness({ initial: { version: 1, projects: [project], sessions: [runningSession({ status: 'stopped' })] } })

    await coordinator.restore('session-1')

    expect(terminalService.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }), { resume: true })
  })
})
```

(`runningSession`, `project`, `worktreeLocation` already exist in the file. If `submitFirstInput` on a session whose `titleState` is already `complete` returns before calling `generate`, the "keeps a later typed first input" test passes for that reason — that is the intended guard.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/services/session-coordinator.test.ts`
Expected: FAIL — `promptFiles` undefined on the harness; `start` called without the options; title not stored.

- [ ] **Step 3: Change the coordinator**

In `src/main/services/session-coordinator.ts`:
- Import: `import { unavailablePromptFileStore, type PromptFileStore } from './prompt-file-store'` and `import type { TerminalStartOptions } from './terminal-service'`.
- Replace `CreateSessionOptions`:

```ts
/**
 * Per-creation options. `worktree: false` (the default) launches straight in the project
 * directory without asking WorktreeService for anything. `initialPrompt` and `title` are set
 * only by the renderer's issue-automation watcher: the prompt is written to a file the agent
 * is told to read on its first turn, and the title is stored as final because that prompt
 * never passes through the PTY, so the first-input tracker would never see one to title from.
 */
export type CreateSessionOptions = {
  worktree?: boolean
  initialPrompt?: string
  title?: string
}
```
- In `SessionTerminal`, change `start(session: SessionRecord, options?: { resume?: boolean }): Promise<void>` to `start(session: SessionRecord, options?: TerminalStartOptions): Promise<void>`.
- Constructor: add the last parameter `private readonly promptFiles: PromptFileStore = unavailablePromptFileStore` after `createId`.
- In `create`, replace the record construction and the start block:

```ts
      const record: SessionRecord = {
        id: this.createId(),
        projectId,
        kind,
        title: options.title ?? initialTitles[kind],
        titleState: options.title === undefined ? 'pending' : 'complete',
        ...(options.title === undefined ? {} : { titleManuallySet: true }),
        createdAt: this.clock().toISOString(),
        status: 'creating',
        launchPath: location.launchPath,
        ...buildLocationFields(location)
      } as SessionRecord

      await this.appendSession(record)

      try {
        if (options.initialPrompt === undefined) {
          await this.terminalService.start(record)
        } else {
          const initialPromptFile = await this.promptFiles.write(record.id, options.initialPrompt)
          await this.terminalService.start(record, { initialPromptFile })
        }
      } catch (error) {
        if (options.initialPrompt !== undefined) await this.promptFiles.remove(record.id)
        await this.removeSession(record.id)
        if (location.mode === 'worktree') {
          await this.worktreeService.rollback(location)
        }
        throw error
      }
```
- In `delete`, right after `await this.removeSession(sessionId)` (inside the `removed || missing` branch), add `await this.promptFiles.remove(sessionId)`.
- In `removeProject`, after `this.emit(next)`, add:

```ts
      // Best effort, after the records are gone: a prompt file nobody can reach is clutter.
      for (const session of sessions) await this.promptFiles.remove(session.id)
```

- [ ] **Step 4: Wire the IPC handler, the preload bridge and the composition root**

`src/main/ipc/register-ipc.ts`, the `IPC.sessionCreate` handler:

```ts
      async (_event, payload): Promise<SessionRecord> => {
        const { projectId, kind, worktree, initialPrompt, title } = createSessionRequestSchema.parse(payload)
        return coordinator.create(projectId, kind, { worktree, initialPrompt, title })
      }
```

`src/preload/index.ts`:
- Type: `createSession(projectId: string, kind: SessionKind, worktree: boolean, extras?: { initialPrompt?: string; title?: string }): Promise<SessionRecord>` with the comment `// extras: the issue-automation watcher's rendered prompt and translated title; absent for the launcher.`
- Implementation: `createSession: (projectId, kind, worktree, extras) => ipcRenderer.invoke(IPC.sessionCreate, { projectId, kind, worktree, ...(extras ?? {}) }),`

`src/main/index.ts`:
- Import `DirectoryPromptFileStore` from `./services/prompt-file-store` and change the TerminalService import to `import { TerminalService, type TerminalEventMap, type TerminalStartOptions } from './services/terminal-service'`.
- `DeferredTerminal.start`: `async start(session: SessionRecord, options?: TerminalStartOptions): Promise<void>`.
- Where the coordinator is built (`const coordinator = new SessionCoordinator(store, projectService, worktreeService, terminal, titleService)`), replace with:

```ts
    // Prompt files for automatic issue sessions live beside state.json, never in a project.
    const promptFiles = new DirectoryPromptFileStore(join(app.getPath('userData'), 'issue-automation'))
    const coordinator = new SessionCoordinator(store, projectService, worktreeService, terminal, titleService, undefined, undefined, promptFiles)
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run src/main/services/session-coordinator.test.ts && npm run typecheck`
Expected: PASS and a clean typecheck (the renderer's `createSession` callers still pass three arguments).

- [ ] **Step 6: Commit**

```bash
git add src/main/services/session-coordinator.ts src/main/services/session-coordinator.test.ts src/main/ipc/register-ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat: create sessions with a prompt file and a final title for issue automation" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Dictionaries and the per-project running predicate

**Files:**
- Modify: `src/renderer/src/i18n/en.ts`, `src/renderer/src/i18n/zh-CN.ts`, `src/renderer/src/i18n/zh-TW.ts`
- Modify: `src/renderer/src/auto-shutdown.ts` (after `hasRunningSessions`, ~line 262)
- Test: `src/renderer/src/auto-shutdown.test.ts`, `src/renderer/src/i18n/index.test.ts` (existing tests must stay green)

**Interfaces:**
- Produces: `hasRunningSessionsIn(projectId: string, sessions: readonly SessionRecord[], idleAgentSessionIds?: Readonly<Record<string, true>>): boolean`; the translation keys listed in Step 3 (all three locales).

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/auto-shutdown.test.ts` (import `hasRunningSessionsIn` next to `hasRunningSessions`; reuse the file's existing session fixtures or build two minimal `SessionRecord`s as below):

```ts
describe('hasRunningSessionsIn', () => {
  const session = (id: string, projectId: string, kind: SessionRecord['kind'], status: SessionRecord['status']): SessionRecord => ({
    id, projectId, kind, status, title: id, titleState: 'complete', createdAt: '2026-10-09T00:00:00.000Z', mode: 'ordinary', launchPath: 'C:\\x'
  } as SessionRecord)

  it('looks only at the named project and uses the sidebar meaning of running', () => {
    const sessions = [
      session('a', 'p1', 'claude', 'running'),
      session('b', 'p2', 'powershell', 'running')
    ]
    expect(hasRunningSessionsIn('p1', sessions, {})).toBe(true)
    // An agent at Done does not count, exactly as it does not hold off auto shutdown.
    expect(hasRunningSessionsIn('p1', sessions, { a: true })).toBe(false)
    // Another project's live shell is irrelevant to p1, but p2 itself is running.
    expect(hasRunningSessionsIn('p2', sessions, { a: true })).toBe(true)
    expect(hasRunningSessionsIn('p3', sessions)).toBe(false)
    expect(hasRunningSessionsIn('p1', [session('c', 'p1', 'claude', 'creating')], { c: true })).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/auto-shutdown.test.ts`
Expected: FAIL — `hasRunningSessionsIn` is not exported.

- [ ] **Step 3: Add the predicate and the dictionary entries**

`src/renderer/src/auto-shutdown.ts`, after `hasRunningSessions`:

```ts
/**
 * `hasRunningSessions` restricted to one project, for the issue-automation watcher: it shares
 * the predicate rather than re-deriving it, so the sidebar, auto shutdown and that watcher can
 * never disagree about what "running" means.
 */
export const hasRunningSessionsIn = (
  projectId: string,
  sessions: readonly SessionRecord[],
  idleAgentSessionIds: Readonly<Record<string, true>> = {}
): boolean => hasRunningSessions(sessions.filter((session) => session.projectId === projectId), idleAgentSessionIds)
```

`src/renderer/src/i18n/en.ts` — add after `'sidebar.unreadCount'`:

```ts
  'sidebar.autoResolveIssues': 'Auto-resolve issues',
  'sidebar.autoResolveOn': 'Auto-resolve issues is on for this project',
  'sidebar.resolveIssueNow': 'Resolve one issue now',
  'sidebar.autoResolveNeedsRemote': 'This project has no Git remote, so there is no issue tracker to read.',
  'sidebar.autoResolveAgentOff': '{kind} is switched off in Settings › Session kinds.',
```

after `'notice.sessionsKeptDirty'`:

```ts
  'notice.issueAutomationFailed': 'Could not start an automatic issue session for "{project}": {reason}',
  'notice.issueAutomationSwitchedOff':
    'Could not start an automatic issue session for "{project}": {reason}. Auto-resolve issues has been switched off for it.',
```

after `'settings.rocketHourlyHint'`:

```ts
  'settings.sectionIssueAutomation': 'Issue automation',
  'settings.issueAutomationHint':
    'While a project with Auto-resolve issues switched on has no running session, Codeflai starts an agent session in a new worktree with the prompt below. Switch it on per project from the ⋯ menu.',
  'settings.issueAutomationAgent': 'Agent',
  'settings.issueAutomationInterval': 'Check every',
  'settings.issueAutomationTemplate': 'Prompt template',
  'settings.issueAutomationPlaceholders': 'Placeholders: {{repoUrl}}, {{host}}, {{projectPath}}, {{projectName}}, {{fastDo}}',
  'settings.issueAutomationReset': 'Reset to default',
```

and a new group after the `notification.*` keys:

```ts
  // Automatic issue resolution. The template is read by an agent, not a person: it must be
  // sentences the agent can follow, and the two lines about not publishing and the
  // needs-human label are what keep a failed round from repeating forever.
  'issueAutomation.sessionTitle': 'Auto issue {time}',
  'issueAutomation.defaultTemplate': `You are in a Codeflai automatic issue session. Repository: {{repoUrl}} (host: {{host}}). Local checkout: {{projectPath}}. Never ask the user anything; work through these steps in order:

1. List the open issues. Use gh on GitHub, glab on GitLab, and whatever CLI or API is available elsewhere. Skip issues that are assigned to someone, or carry the label codeflai:in-progress or codeflai:needs-human. Take the oldest one that remains. If nothing qualifies, or the issues cannot be listed, say why and exit.
2. Add the label codeflai:in-progress to the issue and comment that Codeflai has started on it.
3. Resolve the issue with {{fastDo}} in one go: commit, merge, and push to the default branch. Do not package and do not publish a release.
4. After the push, wait for the test deployment it triggered. On GitHub, find the run for that commit with gh run list --commit <sha> and wait for it with gh run watch <id> --exit-status; use the equivalent elsewhere.
5. If the deployment succeeded, close the issue with a comment linking the commit and remove the codeflai:in-progress label. If it failed, or nothing has finished after 30 minutes, leave the issue open, comment what happened, and replace the label with codeflai:needs-human.
6. Exit the session.`,
```

`src/renderer/src/i18n/zh-CN.ts` — the same keys at the same anchors:

```ts
  'sidebar.autoResolveIssues': '自动处理 issue',
  'sidebar.autoResolveOn': '该项目已开启自动处理 issue',
  'sidebar.resolveIssueNow': '立即处理一条 issue',
  'sidebar.autoResolveNeedsRemote': '该项目没有 Git 远程，没有可读取的 issue 跟踪器。',
  'sidebar.autoResolveAgentOff': '{kind} 已在设置 › 会话类型中关闭。',

  'notice.issueAutomationFailed': '无法为“{project}”启动自动 issue 会话：{reason}',
  'notice.issueAutomationSwitchedOff': '无法为“{project}”启动自动 issue 会话：{reason}。已为它关闭自动处理 issue。',

  'settings.sectionIssueAutomation': 'Issue 自动处理',
  'settings.issueAutomationHint':
    '已开启自动处理 issue 的项目没有运行中的会话时，Codeflai 会在新的 worktree 里用下面的提示词启动一个 agent 会话。请在项目的 ⋯ 菜单里逐个项目开启。',
  'settings.issueAutomationAgent': 'Agent',
  'settings.issueAutomationInterval': '检查频率',
  'settings.issueAutomationTemplate': '提示词模板',
  'settings.issueAutomationPlaceholders': '占位符：{{repoUrl}}、{{host}}、{{projectPath}}、{{projectName}}、{{fastDo}}',
  'settings.issueAutomationReset': '恢复默认',

  'issueAutomation.sessionTitle': '自动 issue {time}',
  'issueAutomation.defaultTemplate': `你在 Codeflai 的自动 issue 处理会话里。仓库：{{repoUrl}}（平台：{{host}}）。本地目录：{{projectPath}}。全程不要向用户提问，按顺序完成下面的步骤：

1. 列出 open 状态的 issue。GitHub 用 gh，GitLab 用 glab，其他平台用可用的 CLI 或 API。跳过已被 assign 的，以及带有 codeflai:in-progress 或 codeflai:needs-human 标签的，取剩下里创建最早的一条。没有合适的 issue，或者列不出来，就说明原因并退出。
2. 给这条 issue 打上 codeflai:in-progress 标签，并评论 Codeflai 已开始处理。
3. 用 {{fastDo}} 一口气解决它：提交、合并、推送到默认分支。不要打包，不要发布 release。
4. 推送之后等待这次推送触发的 test 部署。GitHub 上用 gh run list --commit <sha> 找到对应的 run，再用 gh run watch <id> --exit-status 等它结束；其他平台用对应的命令。
5. 部署成功：关闭 issue，评论里附上提交链接，并移除 codeflai:in-progress 标签。部署失败，或 30 分钟内没有结果：不要关闭 issue，评论说明情况，把标签换成 codeflai:needs-human。
6. 退出会话。`,
```

`src/renderer/src/i18n/zh-TW.ts` — an independent Traditional translation (none of the simplified-only characters the scan test lists):

```ts
  'sidebar.autoResolveIssues': '自動處理 issue',
  'sidebar.autoResolveOn': '這個專案已開啟自動處理 issue',
  'sidebar.resolveIssueNow': '立即處理一則 issue',
  'sidebar.autoResolveNeedsRemote': '這個專案沒有 Git 遠端，沒有可讀取的 issue 追蹤器。',
  'sidebar.autoResolveAgentOff': '{kind} 已在「設定 › 工作階段種類」中關閉。',

  'notice.issueAutomationFailed': '無法為「{project}」啟動自動 issue 工作階段：{reason}',
  'notice.issueAutomationSwitchedOff': '無法為「{project}」啟動自動 issue 工作階段：{reason}。已為它關閉自動處理 issue。',

  'settings.sectionIssueAutomation': 'Issue 自動處理',
  'settings.issueAutomationHint':
    '已開啟自動處理 issue 的專案沒有進行中的工作階段時，Codeflai 會在新的 worktree 裡用下面的提示文字啟動一個 agent 工作階段。請在專案的 ⋯ 功能表中逐一開啟。',
  'settings.issueAutomationAgent': 'Agent',
  'settings.issueAutomationInterval': '檢查頻率',
  'settings.issueAutomationTemplate': '提示文字範本',
  'settings.issueAutomationPlaceholders': '佔位符：{{repoUrl}}、{{host}}、{{projectPath}}、{{projectName}}、{{fastDo}}',
  'settings.issueAutomationReset': '還原預設',

  'issueAutomation.sessionTitle': '自動 issue {time}',
  'issueAutomation.defaultTemplate': `你正在 Codeflai 的自動 issue 處理工作階段中。儲存庫：{{repoUrl}}（平台：{{host}}）。本機目錄：{{projectPath}}。全程不要向使用者提問，依序完成下列步驟：

1. 列出 open 狀態的 issue。GitHub 用 gh，GitLab 用 glab，其他平台用可用的 CLI 或 API。略過已被指派的，以及帶有 codeflai:in-progress 或 codeflai:needs-human 標籤的，取剩下當中建立最早的一則。沒有合適的 issue，或者列不出來，就說明原因並結束。
2. 為這則 issue 加上 codeflai:in-progress 標籤，並留言 Codeflai 已開始處理。
3. 用 {{fastDo}} 一口氣解決它：提交、合併、推送到預設分支。不要打包，不要發布 release。
4. 推送之後等待這次推送觸發的 test 部署。GitHub 上用 gh run list --commit <sha> 找到對應的 run，再用 gh run watch <id> --exit-status 等它結束；其他平台用對應的指令。
5. 部署成功：關閉 issue，留言附上提交連結，並移除 codeflai:in-progress 標籤。部署失敗，或 30 分鐘內沒有結果：不要關閉 issue，留言說明情況，把標籤換成 codeflai:needs-human。
6. 結束工作階段。`,
```

(Check: the zh-TW scan list includes 条, 个, 选, 词, 类, 执, 内, 库 — the strings above use 則, 個, 功能表, 文字, 種類, 進行, 內, 儲存庫 instead. If the scan test still names a character, replace that word; do not touch the scan list.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/auto-shutdown.test.ts src/renderer/src/i18n/index.test.ts && npm run typecheck`
Expected: PASS — the placeholder test accepts `{{repoUrl}}` because every locale carries the same placeholders; the zh-TW scan reports no offenders; typecheck confirms all three dictionaries carry every new key.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/auto-shutdown.ts src/renderer/src/auto-shutdown.test.ts src/renderer/src/i18n/en.ts src/renderer/src/i18n/zh-CN.ts src/renderer/src/i18n/zh-TW.ts
git commit -m "feat: add issue-automation copy and a per-project running predicate" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The store: preference, watcher and actions

**Files:**
- Modify: `src/renderer/src/store/use-app-store.ts` (imports; `AppStore` type ~line 60–160; storage keys ~line 193; read/persist helpers ~line 300–340; module-level timers ~line 420; the `create((set, get) => …)` body: watcher functions near `restartAutoShutdownWatcher` ~line 615, initial state ~line 650, `initialize` ~line 690, snapshot `.then` ~line 830, dispose ~line 960, `reset` ~line 975, actions ~line 1100)
- Test: `src/renderer/src/store/use-app-store.test.ts`

**Interfaces:**
- Consumes: Task 1 primitives; `hasRunningSessionsIn` (Task 7); translation keys (Task 7); preload `createSession(projectId, kind, true, { initialPrompt, title })` (Task 6).
- Produces on `AppStore`: `issueAutomation: IssueAutomationPreference`; `setIssueAutomationAgent(agent: IssueAutomationAgent)`; `setIssueAutomationInterval(intervalMs: number)`; `setIssueAutomationTemplate(template: string | null)`; `setProjectIssueAutomation(projectId: string, enabled: boolean)`; `resolveIssueNow(projectId: string): Promise<void>`; export `ISSUE_AUTOMATION_STORAGE_KEY = 'codeflai.issueAutomation'`.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/store/use-app-store.test.ts`:
- Import `ISSUE_AUTOMATION_STORAGE_KEY` from `./use-app-store` and `DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS` from `../../../shared/issue-automation`.
- Add a `describe` at the end of the file:

```ts
// Issue automation is renderer-owned like auto shutdown: the store keeps the preference and
// runs the watcher; the only things crossing IPC are ordinary session:create calls.
describe('useAppStore issue automation', () => {
  const githubProject: ProjectRecord = {
    id: 'project-1',
    name: 'App',
    path: 'C:\\work\\demo-project',
    repoRoot: 'C:\\work\\demo-project',
    repoRemote: { host: 'github', webUrl: 'https://github.com/me/app' },
    createdAt: '2026-08-20T00:00:00.000Z'
  }
  const otherProject: ProjectRecord = { ...githubProject, id: 'project-2', name: 'Other', path: 'C:\\work\\other' }

  const withProjects = (projects: ProjectRecord[], sessions: SessionRecord[] = []): void => {
    useAppStore.setState({ appState: { version: 1, projects, sessions } })
  }

  it('starts with nothing switched on and launches nothing on its own', async () => {
    withProjects([githubProject])
    expect(useAppStore.getState().issueAutomation).toEqual({ agent: 'claude', intervalMs: DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS, template: null, projects: [] })

    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000)

    expect(api.createSession).not.toHaveBeenCalled()
  })

  it('waits a full interval, then starts one worktree session with the rendered prompt and a title', async () => {
    withProjects([githubProject])
    useAppStore.getState().setProjectIssueAutomation('project-1', true)
    expect(JSON.parse(window.localStorage.getItem(ISSUE_AUTOMATION_STORAGE_KEY)!)).toMatchObject({ projects: ['project-1'] })

    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS - 1)
    expect(api.createSession).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(api.createSession).toHaveBeenCalledTimes(1)
    const [projectId, kind, worktree, extras] = api.createSession.mock.calls[0] as unknown as [string, string, boolean, { initialPrompt: string; title: string }]
    expect([projectId, kind, worktree]).toEqual(['project-1', 'claude', true])
    expect(extras.initialPrompt).toContain('Repository: https://github.com/me/app (host: github)')
    expect(extras.initialPrompt).toContain('Local checkout: C:\\work\\demo-project')
    expect(extras.initialPrompt).toContain('/fast-do')
    expect(extras.initialPrompt).not.toContain('{{')
    expect(extras.title).toMatch(/^Auto issue \d\d-\d\d \d\d:\d\d$/)
    // An automatic launch must not pull the user away from what they are looking at.
    expect(useAppStore.getState().activeSessionId).toBeNull()
    expect(useAppStore.getState().appState.sessions.map((session) => session.id)).toContain(claudeSession.id)
  })

  it('skips a project with a running session and launches once its agent is Done', async () => {
    withProjects([githubProject], [claudeSession])
    useAppStore.getState().setProjectIssueAutomation('project-1', true)

    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS)
    expect(api.createSession).not.toHaveBeenCalled()

    useAppStore.setState({ idleAgentSessionIds: { [claudeSession.id]: true } })
    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS)

    expect(api.createSession).toHaveBeenCalledTimes(1)
  })

  it('uses the Codex prefix and the user template when configured', async () => {
    withProjects([githubProject])
    useAppStore.getState().setIssueAutomationAgent('codex')
    useAppStore.getState().setIssueAutomationTemplate('Fix one issue of {{projectName}} with {{fastDo}} on {{host}}.')
    useAppStore.getState().setProjectIssueAutomation('project-1', true)

    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS)

    expect(api.createSession).toHaveBeenCalledWith('project-1', 'codex', true, expect.objectContaining({ initialPrompt: 'Fix one issue of App with $fast-do on github.' }))
  })

  it('skips silently when the chosen agent is switched off or unavailable', async () => {
    withProjects([githubProject])
    useAppStore.getState().setProjectIssueAutomation('project-1', true)
    useAppStore.getState().setSessionKindPreference('claude', { enabled: false })

    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS)
    expect(api.createSession).not.toHaveBeenCalled()
    expect(useAppStore.getState().notice).toBeNull()
    expect(useAppStore.getState().issueAutomation.projects).toEqual(['project-1'])

    useAppStore.getState().setSessionKindPreference('claude', { enabled: true })
    useAppStore.setState({ capabilities: { ...useAppStore.getState().capabilities, claude: { available: false, detail: 'claude not found' } } })
    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS)
    expect(api.createSession).not.toHaveBeenCalled()
  })

  it('switches the project off and reports when a timed launch fails', async () => {
    withProjects([githubProject])
    api.createSession.mockRejectedValueOnce(new Error('worktree creation failed'))
    useAppStore.getState().setProjectIssueAutomation('project-1', true)

    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS)

    expect(useAppStore.getState().issueAutomation.projects).toEqual([])
    expect(useAppStore.getState().notice).toEqual({
      message: 'Could not start an automatic issue session for "App": worktree creation failed. Auto-resolve issues has been switched off for it.',
      tone: 'error'
    })
    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS)
    expect(api.createSession).toHaveBeenCalledTimes(1)
  })

  it('resolveIssueNow launches at once, makes the session active, and leaves the switch alone on failure', async () => {
    withProjects([githubProject])

    await useAppStore.getState().resolveIssueNow('project-1')
    expect(api.createSession).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().activeSessionId).toBe(claudeSession.id)
    expect(useAppStore.getState().activeProjectId).toBe('project-1')

    useAppStore.getState().setProjectIssueAutomation('project-1', true)
    api.createSession.mockRejectedValueOnce(new Error('nope'))
    await useAppStore.getState().resolveIssueNow('project-1')
    expect(useAppStore.getState().issueAutomation.projects).toEqual(['project-1'])
    expect(useAppStore.getState().notice).toEqual({ message: 'Could not start an automatic issue session for "App": nope', tone: 'error' })
  })

  // Review Focus 4.
  it('ignores a trigger while the project\'s launch is in flight', async () => {
    withProjects([githubProject])
    let release!: (value: SessionRecord) => void
    api.createSession.mockImplementationOnce(() => new Promise<SessionRecord>((resolve) => { release = resolve }))

    const first = useAppStore.getState().resolveIssueNow('project-1')
    await useAppStore.getState().resolveIssueNow('project-1')
    expect(api.createSession).toHaveBeenCalledTimes(1)

    release(claudeSession)
    await first
    await useAppStore.getState().resolveIssueNow('project-1')
    expect(api.createSession).toHaveBeenCalledTimes(2)
  })

  it('restarts the cadence for an interval change but not when a second project is toggled', async () => {
    withProjects([githubProject, otherProject])
    useAppStore.getState().setProjectIssueAutomation('project-1', true)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    useAppStore.getState().setProjectIssueAutomation('project-2', true)

    await vi.advanceTimersByTimeAsync(20 * 60_000)
    // Both launch on the first project's clock, 30 minutes after it was switched on.
    expect(api.createSession.mock.calls.map((call) => call[0])).toEqual(['project-1', 'project-2'])
    // The fake create answered with a running Claude session for project-1; mark it Done so
    // project-1 is eligible again on the next tick and the cadence is what this test measures.
    useAppStore.setState({ idleAgentSessionIds: { [claudeSession.id]: true } })

    useAppStore.getState().setIssueAutomationInterval(60 * 60_000)
    await vi.advanceTimersByTimeAsync(59 * 60_000)
    expect(api.createSession).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.createSession).toHaveBeenCalledTimes(4)
  })

  it('stops the timer when the last project is switched off', async () => {
    withProjects([githubProject])
    useAppStore.getState().setProjectIssueAutomation('project-1', true)
    useAppStore.getState().setProjectIssueAutomation('project-1', false)

    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS * 2)

    expect(api.createSession).not.toHaveBeenCalled()
    expect(JSON.parse(window.localStorage.getItem(ISSUE_AUTOMATION_STORAGE_KEY)!)).toMatchObject({ projects: [] })
  })

  it('rejects an interval or agent the dropdowns do not offer', () => {
    useAppStore.getState().setIssueAutomationInterval(42)
    useAppStore.getState().setIssueAutomationAgent('gemini' as never)
    expect(useAppStore.getState().issueAutomation).toMatchObject({ agent: 'claude', intervalMs: DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS })
  })

  it('treats an empty template, or one identical to the default, as "use the default"', () => {
    useAppStore.getState().setIssueAutomationTemplate('Custom')
    expect(useAppStore.getState().issueAutomation.template).toBe('Custom')
    useAppStore.getState().setIssueAutomationTemplate('   ')
    expect(useAppStore.getState().issueAutomation.template).toBeNull()
    useAppStore.getState().setIssueAutomationTemplate(`${en['issueAutomation.defaultTemplate']}\n`)
    expect(useAppStore.getState().issueAutomation.template).toBeNull()
    useAppStore.getState().setIssueAutomationTemplate('Custom')
    useAppStore.getState().setIssueAutomationTemplate(null)
    expect(useAppStore.getState().issueAutomation.template).toBeNull()
  })

  it('reads the stored preference on startup and prunes projects the snapshot no longer has', async () => {
    dispose()
    useAppStore.getState().reset()
    window.localStorage.setItem(ISSUE_AUTOMATION_STORAGE_KEY, JSON.stringify({ agent: 'codex', intervalMs: 3_600_000, template: null, projects: ['project-1', 'ghost'] }))
    api = createFakeApi()
    api.getSnapshot.mockResolvedValue({ platform: 'win32', state: { version: 1, projects: [githubProject], sessions: [] }, capabilities: defaultCapabilities() })
    window.codeflai = api
    dispose = useAppStore.getState().initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(useAppStore.getState().issueAutomation).toEqual({ agent: 'codex', intervalMs: 3_600_000, template: null, projects: ['project-1'] })
    expect(JSON.parse(window.localStorage.getItem(ISSUE_AUTOMATION_STORAGE_KEY)!)).toMatchObject({ projects: ['project-1'] })
  })

  // Review Focus 5.
  it('launches nothing while the snapshot is still empty', async () => {
    dispose()
    useAppStore.getState().reset()
    window.localStorage.setItem(ISSUE_AUTOMATION_STORAGE_KEY, JSON.stringify({ agent: 'claude', intervalMs: 300_000, template: null, projects: ['project-1'] }))
    api = createFakeApi()
    api.getSnapshot.mockImplementation(() => new Promise(() => undefined))
    window.codeflai = api
    dispose = useAppStore.getState().initialize()

    await vi.advanceTimersByTimeAsync(300_000 * 3)

    expect(api.createSession).not.toHaveBeenCalled()
  })

  it('stops the watcher when the store is torn down', async () => {
    withProjects([githubProject])
    useAppStore.getState().setProjectIssueAutomation('project-1', true)
    dispose()
    await vi.advanceTimersByTimeAsync(DEFAULT_ISSUE_AUTOMATION_INTERVAL_MS * 2)
    expect(api.createSession).not.toHaveBeenCalled()
    dispose = useAppStore.getState().initialize()
  })
})
```

Add `import { en } from '../i18n/en'` with the other imports. The `api.createSession` fake already resolves `claudeSession` (projectId `project-1`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts -t "issue automation"`
Expected: FAIL — `issueAutomation` undefined, actions missing.

- [ ] **Step 3: Add the preference and watcher to the store**

In `src/renderer/src/store/use-app-store.ts`:

Imports:
```ts
import {
  DEFAULT_ISSUE_AUTOMATION,
  formatIssueAutomationTime,
  isIssueAutomationAgent,
  isIssueAutomationInterval,
  issueAutomationTemplateValues,
  parseStoredIssueAutomation,
  pruneIssueAutomationProjects,
  renderIssueAutomationTemplate,
  type IssueAutomationAgent,
  type IssueAutomationPreference
} from '../../../shared/issue-automation'
```
and add `hasRunningSessionsIn` to the existing import from `'../auto-shutdown'`.

`AppStore` type — after `rocket: RocketPreference`:
```ts
  /** Automatic issue resolution: the agent, the cadence, the template and which projects are on. */
  issueAutomation: IssueAutomationPreference
```
and after `setRocketHourlyEnabled`:
```ts
  setIssueAutomationAgent: (agent: IssueAutomationAgent) => void
  setIssueAutomationInterval: (intervalMs: number) => void
  /** null, an empty string, or the locale's own default all mean "follow the default". */
  setIssueAutomationTemplate: (template: string | null) => void
  setProjectIssueAutomation: (projectId: string, enabled: boolean) => void
  /** One round right now, ignoring the timer and the "no running session" rule; switches to the new session. */
  resolveIssueNow: (projectId: string) => Promise<void>
```

Storage key, next to `ROCKET_STORAGE_KEY`:
```ts
export const ISSUE_AUTOMATION_STORAGE_KEY = 'codeflai.issueAutomation'
```

Helpers, after `persistRocket`:
```ts
const readStoredIssueAutomation = (): IssueAutomationPreference => {
  try {
    return parseStoredIssueAutomation(readMigratedStorage(ISSUE_AUTOMATION_STORAGE_KEY))
  } catch {
    return { ...DEFAULT_ISSUE_AUTOMATION, projects: [] }
  }
}

const persistIssueAutomation = (preference: IssueAutomationPreference): void => {
  try {
    window.localStorage.setItem(ISSUE_AUTOMATION_STORAGE_KEY, JSON.stringify(preference))
  } catch {
    // localStorage unavailable: the preference just won't survive a restart.
  }
}
```

Module-level timer, after `clearAutoShutdownTimers`:
```ts
// The issue-automation watcher's timer: one for the whole feature, module-level like the
// auto-shutdown timer because it is bookkeeping, not renderable state.
let issueAutomationTimer: ReturnType<typeof setInterval> | undefined

const clearIssueAutomationTimer = (): void => {
  if (issueAutomationTimer !== undefined) clearInterval(issueAutomationTimer)
  issueAutomationTimer = undefined
}
```

Inside `create((set, get) => { … })`, after `restartAutoShutdownWatcher`:
```ts
  // Projects whose automatic launch is still in flight: a second tick or a double click on
  // "Resolve one issue now" must not start two sessions.
  const launchingProjects = new Set<string>()

  /**
   * One round for one project: render the template, create a worktree session whose first
   * prompt is that text. `timer` launches never change the active session (an agent
   * starting on its own must not pull the user away); `manual` ones switch to it, because
   * the user just asked to watch. A failed timer launch switches the project off, the way a
   * failed shutdown switches auto shutdown off — the same error every interval helps nobody.
   */
  const launchIssueAutomation = async (projectId: string, trigger: 'timer' | 'manual'): Promise<void> => {
    if (launchingProjects.has(projectId)) return
    const { appState, issueAutomation, locale, sessionKindPreferences, capabilities } = get()
    const project = appState.projects.find((candidate) => candidate.id === projectId)
    if (!project?.repoRemote) return
    const kind = issueAutomation.agent
    if (!sessionKindPreferences[kind].enabled || !capabilities[kind].available) return

    const template = issueAutomation.template ?? translate(locale, 'issueAutomation.defaultTemplate')
    const initialPrompt = renderIssueAutomationTemplate(template, issueAutomationTemplateValues(project, project.repoRemote, kind))
    const title = translate(locale, 'issueAutomation.sessionTitle', { time: formatIssueAutomationTime(new Date()) })

    launchingProjects.add(projectId)
    try {
      const session = await window.codeflai.createSession(projectId, kind, true, { initialPrompt, title })
      set((state) => ({
        appState: upsertSession(state.appState, session),
        ...(trigger === 'manual' ? { activeProjectId: session.projectId, activeSessionId: session.id } : {})
      }))
    } catch (error) {
      const reason = errorMessage(error, get().locale)
      if (trigger === 'timer') {
        get().setProjectIssueAutomation(projectId, false)
        set({ notice: { message: translate(get().locale, 'notice.issueAutomationSwitchedOff', { project: project.name, reason }), tone: 'error' } })
      } else {
        set({ notice: { message: translate(get().locale, 'notice.issueAutomationFailed', { project: project.name, reason }), tone: 'error' } })
      }
    } finally {
      launchingProjects.delete(projectId)
    }
  }

  // One tick: every project that is switched on, still exists, and has nothing the sidebar
  // calls Running gets a round. Walks the snapshot so the order is the sidebar's; before the
  // snapshot arrives there are no projects and therefore nothing to launch.
  const runIssueAutomationCheck = (): void => {
    const { issueAutomation, appState, idleAgentSessionIds } = get()
    for (const project of appState.projects) {
      if (!issueAutomation.projects.includes(project.id)) continue
      if (hasRunningSessionsIn(project.id, appState.sessions, idleAgentSessionIds)) continue
      void launchIssueAutomation(project.id, 'timer')
    }
  }

  /**
   * (Re)arms the timer from the preference. Called when the first project is switched on,
   * when the last is switched off, and when the interval changes — never when one project is
   * toggled while others stay on, so their cadence is unaffected. The first check is always a
   * full interval away: switching a project on must not mean "start an agent now".
   */
  const restartIssueAutomationWatcher = (): void => {
    clearIssueAutomationTimer()
    const { projects, intervalMs } = get().issueAutomation
    if (projects.length === 0) return
    issueAutomationTimer = setInterval(runIssueAutomationCheck, intervalMs)
  }
```

Initial state: add `issueAutomation: { ...DEFAULT_ISSUE_AUTOMATION, projects: [] },` after `rocket: { ...DEFAULT_ROCKET },` — in the returned object **and** in `reset`.

In `initialize`, after `restartAutoShutdownWatcher()`:
```ts
      const storedIssueAutomation = readStoredIssueAutomation()
      set({ issueAutomation: storedIssueAutomation })
      // Armed from the stored preference; the first check is a full interval away, by which
      // time the snapshot has long arrived.
      restartIssueAutomationWatcher()
```

In the snapshot `.then((snapshot) => { … })`, after `document.documentElement.dataset.platform = snapshot.platform` (anywhere after `appState` is known):
```ts
          // A project removed while Codeflai was closed must not stay switched on in the
          // preference; prune against the snapshot and write back only when something changed.
          const pruned = pruneIssueAutomationProjects(get().issueAutomation, appState.projects.map((project) => project.id))
          if (pruned !== get().issueAutomation) {
            set({ issueAutomation: pruned })
            persistIssueAutomation(pruned)
            if (pruned.projects.length === 0) restartIssueAutomationWatcher()
          }
```

In the dispose function returned by `initialize` (next to `clearAutoShutdownTimers()`), add `clearIssueAutomationTimer()`; in `reset`, add `clearIssueAutomationTimer()` next to the other clears.

Actions, after `setRocketHourlyEnabled`:
```ts
    setIssueAutomationAgent: (agent) => {
      if (!isIssueAutomationAgent(agent)) return
      const next = { ...get().issueAutomation, agent }
      set({ issueAutomation: next })
      persistIssueAutomation(next)
    },

    setIssueAutomationInterval: (intervalMs) => {
      // Same guard as auto shutdown: a value no dropdown offers would make the watcher a busy loop.
      if (!isIssueAutomationInterval(intervalMs)) return
      const next = { ...get().issueAutomation, intervalMs }
      set({ issueAutomation: next })
      persistIssueAutomation(next)
      restartIssueAutomationWatcher()
    },

    setIssueAutomationTemplate: (template) => {
      const trimmed = template?.trim() ?? ''
      const isDefault = trimmed === '' || trimmed === translate(get().locale, 'issueAutomation.defaultTemplate').trim()
      const next = { ...get().issueAutomation, template: isDefault ? null : template }
      set({ issueAutomation: next })
      persistIssueAutomation(next)
    },

    setProjectIssueAutomation: (projectId, enabled) => {
      const current = get().issueAutomation
      const projects = enabled
        ? [...new Set([...current.projects, projectId])]
        : current.projects.filter((id) => id !== projectId)
      const next = pruneIssueAutomationProjects({ ...current, projects }, get().appState.projects.map((project) => project.id))
      set({ issueAutomation: next })
      persistIssueAutomation(next)
      // Only the empty/non-empty transitions touch the timer; see restartIssueAutomationWatcher.
      if ((current.projects.length === 0) !== (next.projects.length === 0)) restartIssueAutomationWatcher()
    },

    resolveIssueNow: (projectId) => launchIssueAutomation(projectId, 'manual'),
```

Note on `setProjectIssueAutomation`: pruning against the snapshot means enabling an id the snapshot does not have is a no-op — correct, the menu only offers real projects, and tests seed the snapshot first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/store/use-app-store.test.ts && npm run typecheck`
Expected: PASS for the new block and every existing test (auto shutdown, notifications, reset).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/use-app-store.ts src/renderer/src/store/use-app-store.test.ts
git commit -m "feat: run the issue-automation watcher from the app store" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The Settings section

**Files:**
- Modify: `src/renderer/src/settings-sections.ts`
- Modify: `src/renderer/src/components/SettingsDialog.tsx` (selectors ~line 90; a new `<section>` between the `sessionKinds` and `updates` sections ~line 535)
- Modify: `src/renderer/src/styles.css` (after `.settings-dialog-label`, ~line 2612)
- Test: `src/renderer/src/settings-sections.test.ts`, `src/renderer/src/components/SettingsDialog.test.tsx`

**Interfaces:**
- Consumes: store fields and actions from Task 8; `ISSUE_AUTOMATION_AGENT_KINDS`, `ISSUE_AUTOMATION_INTERVAL_OPTIONS`, `formatIssueAutomationInterval`, `isIssueAutomationAgent` (Task 1); `sessionKindLabelKey` from `../session-kind-options`.
- Produces: `SettingsSectionId` gains `'issueAutomation'`; the section's controls have accessible names `Agent`, `Check every`, `Prompt template`, `Reset to default`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/settings-sections.test.ts` — change the first expectation to:
```ts
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual(['general', 'sessionKinds', 'issueAutomation', 'updates', 'about'])
```
and extend the `offsets` fixture with `{ id: 'issueAutomation', top: 600 }` between `sessionKinds` and `updates`; the "follows the scroll position" test then expects `resolveActiveSection(viewport(400), offsets)` to be `'sessionKinds'` and add `expect(resolveActiveSection(viewport(600), offsets)).toBe('issueAutomation')`.

`src/renderer/src/components/SettingsDialog.test.tsx`:
- In "anchors a menu entry to every section", the expected nav list becomes `['General', 'Session kinds', 'Issue automation', 'Updates', 'About Codeflai']`.
- Add:

```ts
  it('offers the issue-automation controls with their defaults', () => {
    renderDialog()

    const agent = screen.getByRole('combobox', { name: 'Agent' })
    expect(within(agent).getAllByRole('option').map((option) => option.textContent)).toEqual(['Claude', 'Codex'])
    expect(agent).toHaveValue('claude')
    const interval = screen.getByRole('combobox', { name: 'Check every' })
    expect(within(interval).getAllByRole('option').map((option) => option.textContent)).toEqual(['5m', '10m', '15m', '30m', '1h', '2h', '4h'])
    expect(interval).toHaveValue(String(30 * 60_000))
    const template = screen.getByRole('textbox', { name: 'Prompt template' }) as HTMLTextAreaElement
    expect(template.value).toContain('You are in a Codeflai automatic issue session.')
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled()
    expect(screen.getByText('Placeholders: {{repoUrl}}, {{host}}, {{projectPath}}, {{projectName}}, {{fastDo}}')).toBeInTheDocument()
  })

  it('stores the agent, the interval and an edited template, and resets the template', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'codex')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Check every' }), String(60 * 60_000))
    const template = screen.getByRole('textbox', { name: 'Prompt template' })
    await user.clear(template)
    await user.type(template, 'Custom {{{{fastDo}}}}')
    await user.tab()

    expect(useAppStore.getState().issueAutomation).toMatchObject({ agent: 'codex', intervalMs: 60 * 60_000, template: 'Custom {{fastDo}}' })
    const reset = screen.getByRole('button', { name: 'Reset to default' })
    expect(reset).toBeEnabled()

    await user.click(reset)

    expect(useAppStore.getState().issueAutomation.template).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Prompt template' }) as HTMLTextAreaElement).value).toContain('You are in a Codeflai automatic issue session.')
    expect(reset).toBeDisabled()
  })
```

(`user.type` treats `{{` as an escaped brace, hence `{{{{fastDo}}}}` to type `{{fastDo}}`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/settings-sections.test.ts src/renderer/src/components/SettingsDialog.test.tsx`
Expected: FAIL — section missing, controls missing.

- [ ] **Step 3: Add the section**

`src/renderer/src/settings-sections.ts`:
```ts
export type SettingsSectionId = 'general' | 'sessionKinds' | 'issueAutomation' | 'updates' | 'about'

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = [
  { id: 'general', labelKey: 'settings.sectionGeneral' },
  { id: 'sessionKinds', labelKey: 'settings.sessionKinds' },
  { id: 'issueAutomation', labelKey: 'settings.sectionIssueAutomation' },
  { id: 'updates', labelKey: 'settings.sectionUpdates' },
  { id: 'about', labelKey: 'settings.about' }
]
```

`src/renderer/src/components/SettingsDialog.tsx`:
- Imports: `import { ISSUE_AUTOMATION_AGENT_KINDS, ISSUE_AUTOMATION_INTERVAL_OPTIONS, formatIssueAutomationInterval, isIssueAutomationAgent } from '../../../shared/issue-automation'` and change the `session-kind-options` import to `import { sessionKindLabelKey, sessionKindOptions, type SessionKindOption } from '../session-kind-options'`.
- Selectors, after `setSessionKindPreference`:
```ts
  const issueAutomation = useAppStore((state) => state.issueAutomation)
  const setIssueAutomationAgent = useAppStore((state) => state.setIssueAutomationAgent)
  const setIssueAutomationInterval = useAppStore((state) => state.setIssueAutomationInterval)
  const setIssueAutomationTemplate = useAppStore((state) => state.setIssueAutomationTemplate)
```
- State, next to `moreKindsExpanded`: `const [templateEpoch, setTemplateEpoch] = useState(0)` with the comment `// Bumped on reset so the uncontrolled textarea remounts with the default text.`
- The section, placed between the `sessionKinds` and `updates` sections:

```tsx
            <section className="settings-section" ref={registerSection('issueAutomation')} aria-labelledby="settings-section-issue-automation">
              <h3 className="settings-section-title" id="settings-section-issue-automation">
                {t('settings.sectionIssueAutomation')}
              </h3>
              <p className="settings-dialog-hint">{t('settings.issueAutomationHint')}</p>

              <div className="settings-dialog-section">
                <span className="settings-dialog-label" id="settings-issue-agent-label">
                  {t('settings.issueAutomationAgent')}
                </span>
                {/* Only the two agents whose CLIs take a positional prompt; enabling one is the
                    Session kinds section's job, and the project menu says when it is off. */}
                <select
                  className="settings-select"
                  aria-labelledby="settings-issue-agent-label"
                  value={issueAutomation.agent}
                  onChange={(event) => {
                    if (isIssueAutomationAgent(event.target.value)) setIssueAutomationAgent(event.target.value)
                  }}
                >
                  {ISSUE_AUTOMATION_AGENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(sessionKindLabelKey(kind))}
                    </option>
                  ))}
                </select>
              </div>

              <div className="settings-dialog-section">
                <span className="settings-dialog-label" id="settings-issue-interval-label">
                  {t('settings.issueAutomationInterval')}
                </span>
                <select
                  className="settings-select"
                  aria-labelledby="settings-issue-interval-label"
                  value={String(issueAutomation.intervalMs)}
                  onChange={(event) => setIssueAutomationInterval(Number(event.target.value))}
                >
                  {ISSUE_AUTOMATION_INTERVAL_OPTIONS.map((intervalMs) => (
                    <option key={intervalMs} value={intervalMs}>
                      {formatIssueAutomationInterval(intervalMs)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="settings-dialog-section settings-dialog-section-stacked">
                <label className="settings-dialog-label" htmlFor="settings-issue-template">
                  {t('settings.issueAutomationTemplate')}
                </label>
                {/* Uncontrolled and committed on blur: every keystroke rewriting localStorage
                    would be waste, and the agent reads the file, not the keystrokes. */}
                <textarea
                  key={templateEpoch}
                  id="settings-issue-template"
                  className="settings-textarea"
                  rows={12}
                  spellCheck={false}
                  defaultValue={issueAutomation.template ?? t('issueAutomation.defaultTemplate')}
                  onBlur={(event) => setIssueAutomationTemplate(event.currentTarget.value)}
                />
                <p className="settings-dialog-hint">{t('settings.issueAutomationPlaceholders')}</p>
                <button
                  type="button"
                  className="settings-update-button"
                  disabled={issueAutomation.template === null}
                  onClick={() => {
                    setIssueAutomationTemplate(null)
                    setTemplateEpoch((epoch) => epoch + 1)
                  }}
                >
                  {t('settings.issueAutomationReset')}
                </button>
              </div>
            </section>
```

`src/renderer/src/styles.css`, after the `.settings-dialog-label` rule:
```css
/* A control too wide to share a row with its label (the issue-automation template). */
.settings-dialog-section-stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.settings-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  font-family: 'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace;
  font-size: 0.78rem;
  line-height: 1.45;
  resize: vertical;
}

.settings-textarea:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/settings-sections.test.ts src/renderer/src/components/SettingsDialog.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/settings-sections.ts src/renderer/src/settings-sections.test.ts src/renderer/src/components/SettingsDialog.tsx src/renderer/src/components/SettingsDialog.test.tsx src/renderer/src/styles.css
git commit -m "feat: add the Issue automation section to Settings" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The project menu entries and the row glyph

**Files:**
- Modify: `src/renderer/src/components/ProjectSidebar.tsx` (glyphs ~line 24; selectors ~line 54; menu focus selectors at lines ~181 and ~390; the row name ~line 571; the menu after the `Open Git repository` entry ~line 714)
- Modify: `src/renderer/src/styles.css` (after `.project-unread-count`, ~line 1455; after `.project-options-menu-item:disabled`, ~line 1250)
- Modify: `e2e/codeflai.spec.ts` (the exact-menu assertion ~line 496)
- Test: `src/renderer/src/components/ProjectSidebar.test.tsx`

**Interfaces:**
- Consumes: store `issueAutomation`, `setProjectIssueAutomation`, `resolveIssueNow`, `sessionKindPreferences`, `capabilities`; `sessionKindLabelKey`.
- Produces: a `menuitemcheckbox` "Auto-resolve issues" with `aria-checked`; a `menuitem` "Resolve one issue now"; `.project-automation-glyph` (`role="img"`, accessible name "Auto-resolve issues is on for this project") in `.project-name` while on.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/ProjectSidebar.test.tsx`:
- Add a helper next to `openProjectOptions`:
```ts
// Menu entries in document order, whichever menuitem role they carry (the auto-resolve switch
// is a menuitemcheckbox, which neither getAllByRole('menuitem') nor Playwright's equivalent lists).
const menuEntries = (menu: HTMLElement): string[] =>
  Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')).map((item) => item.textContent?.trim() ?? '')
```
- Replace the two exact-list assertions (`within(menu).getAllByRole('menuitem').map(…)`) with `menuEntries(menu)` and insert `'Auto-resolve issues', 'Resolve one issue now'` before `'Delete all sessions'` in both expected lists (the remote-less one and the GitHub one).
- Add a `describe`:

```ts
describe('issue automation in the project menu', () => {
  const github: ProjectRecord = { ...project1, repoRemote: { host: 'github', webUrl: 'https://github.com/me/app' } }

  it('switches a project on and off and shows the row glyph while it is on', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [github], sessions: [] })
    render(<ProjectSidebar />)
    expect(screen.queryByRole('img', { name: 'Auto-resolve issues is on for this project' })).not.toBeInTheDocument()

    let menu = await openProjectOptions(user)
    const toggle = within(menu).getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)

    expect(useAppStore.getState().issueAutomation.projects).toEqual([github.id])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Auto-resolve issues is on for this project' })).toBeInTheDocument()

    menu = await openProjectOptions(user)
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' }))
    expect(useAppStore.getState().issueAutomation.projects).toEqual([])
    expect(screen.queryByRole('img', { name: 'Auto-resolve issues is on for this project' })).not.toBeInTheDocument()
  })

  it('runs one round from the menu', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [github], sessions: [] })
    api.createSession = vi.fn(async () => runningWorktreeSession)
    render(<ProjectSidebar />)

    await user.click(within(await openProjectOptions(user)).getByRole('menuitem', { name: 'Resolve one issue now' }))

    expect(api.createSession).toHaveBeenCalledWith(github.id, 'claude', true, expect.objectContaining({ title: expect.stringMatching(/^Auto issue /) }))
  })

  it('disables both entries without a remote, and only the manual one when the agent is off', async () => {
    const user = userEvent.setup()
    seedStore({ version: 1, projects: [project1], sessions: [] })
    render(<ProjectSidebar />)

    let menu = await openProjectOptions(user)
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })).toBeDisabled()
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })).toHaveAttribute('title', 'This project has no Git remote, so there is no issue tracker to read.')
    expect(within(menu).getByRole('menuitem', { name: 'Resolve one issue now' })).toBeDisabled()
    // Clicking the trigger again closes the menu (see "swaps the options glyph").
    await user.click(screen.getByRole('button', { name: projectOptionsName(project1.name) }))

    seedStore({ version: 1, projects: [github], sessions: [] })
    useAppStore.getState().setSessionKindPreference('claude', { enabled: false })
    menu = await openProjectOptions(user)
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })).toBeEnabled()
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })).toHaveAttribute('title', 'Claude is switched off in Settings › Session kinds.')
    expect(within(menu).getByRole('menuitem', { name: 'Resolve one issue now' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: projectOptionsName(project1.name) }))

    useAppStore.getState().setSessionKindPreference('claude', { enabled: true })
    seedStore({ version: 1, projects: [github], sessions: [] }, { ...defaultCapabilities(), claude: { available: false, detail: 'claude: not found on PATH' } })
    menu = await openProjectOptions(user)
    expect(within(menu).getByRole('menuitem', { name: 'Resolve one issue now' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Resolve one issue now' })).toHaveAttribute('title', 'claude: not found on PATH')
  })
})
```

(`runningWorktreeSession`, `project1`, `projectOptionsName`, `seedStore` and `defaultCapabilities` already exist in the file. `api` is the `FakeApi` the file's `beforeEach` installs on `window.codeflai`; its `createSession` is a plain method property, so reassigning it to a `vi.fn` is type-correct.)

In `e2e/codeflai.spec.ts`, change the exact-menu assertion to:
```ts
  // Nine entries: the fixture repository carries a GitHub-shaped `origin`, so the repository
  // action is offered (with the GitHub mark) between the copy-path action and the two
  // issue-automation entries, which sit above the two destructive entries at the bottom.
  // `[role^="menuitem"]` because the auto-resolve switch is a menuitemcheckbox.
  await expect(optionsMenu.locator('[role^="menuitem"]')).toHaveText([
    'New session',
    'Open project in VS Code',
    'Open project folder',
    'Copy project path',
    'Open Git repository',
    'Auto-resolve issues',
    'Resolve one issue now',
    'Delete all sessions',
    'Remove from list'
  ])
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/ProjectSidebar.test.tsx`
Expected: FAIL — entries missing.

- [ ] **Step 3: Add the entries and the glyph**

`src/renderer/src/components/ProjectSidebar.tsx`:
- Import `sessionKindLabelKey` from `'../session-kind-options'`.
- Glyphs, after `CopyPathGlyph`:

```tsx
function AutoResolveGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" className="icon icon-auto-resolve"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12a8 8 0 0 1 13.6-5.7L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.6 5.7L4 16M4 20v-4h4" />
    </svg>
  )
}

function ResolveNowGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" className="icon icon-resolve-now">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  )
}

function CheckGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" className="icon icon-check project-options-menu-check"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l4 4L19 7" />
    </svg>
  )
}
```
- Selectors, after `closeLauncher`:
```tsx
  const issueAutomation = useAppStore((state) => state.issueAutomation)
  const setProjectIssueAutomation = useAppStore((state) => state.setProjectIssueAutomation)
  const resolveIssueNow = useAppStore((state) => state.resolveIssueNow)
```
- Keyboard focus selectors: change both `'[role="menuitem"]:not(:disabled)'` occurrences (initial focus ~line 181 and `handleProjectOptionsMenuKeyDown` ~line 390) to `'[role^="menuitem"]:not(:disabled)'` with the comment `// ^= : the auto-resolve switch is a menuitemcheckbox and must stay in the arrow-key order.`
- Inside the project render loop, right after the existing `const sessionCount = appState.sessions.filter(…)` line (~line 529), add:

```tsx
            const automationOn = issueAutomation.projects.includes(project.id)
            const automationAgent = issueAutomation.agent
            // Why the manual entry is disabled, or null when the agent can run. The switch stays
            // usable either way so a project already on can still be switched off.
            const agentProblem: string | null = !sessionKindPreferences[automationAgent].enabled
              ? t('sidebar.autoResolveAgentOff', { kind: t(sessionKindLabelKey(automationAgent)) })
              : !capabilities[automationAgent].available
                ? capabilities[automationAgent].detail
                : null
            const remoteProblem: string | null = project.repoRemote ? null : t('sidebar.autoResolveNeedsRemote')
```
- In `.project-name`, after the unread count:
```tsx
                    {automationOn && (
                      <span className="project-automation-glyph" role="img" aria-label={t('sidebar.autoResolveOn')} title={t('sidebar.autoResolveOn')}>
                        <AutoResolveGlyph />
                      </span>
                    )}
```
- In the menu, after the `{project.repoRemote && (… Open Git repository …)}` block and before the `Delete all sessions` button:

```tsx
                    <button
                      type="button"
                      className="project-options-menu-item"
                      role="menuitemcheckbox"
                      aria-checked={automationOn}
                      disabled={remoteProblem !== null}
                      title={remoteProblem ?? agentProblem ?? undefined}
                      tabIndex={-1}
                      onPointerDown={(event) => {
                        if (remoteProblem !== null) event.preventDefault()
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        closeProjectOptions(true)
                        setProjectIssueAutomation(project.id, !automationOn)
                      }}
                    >
                      <AutoResolveGlyph />
                      {t('sidebar.autoResolveIssues')}
                      {automationOn && <CheckGlyph />}
                    </button>
                    <button
                      type="button"
                      className="project-options-menu-item"
                      role="menuitem"
                      disabled={remoteProblem !== null || agentProblem !== null}
                      title={remoteProblem ?? agentProblem ?? undefined}
                      tabIndex={-1}
                      onPointerDown={(event) => {
                        if (remoteProblem !== null || agentProblem !== null) event.preventDefault()
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        closeProjectOptions(true)
                        void resolveIssueNow(project.id)
                      }}
                    >
                      <ResolveNowGlyph />
                      {t('sidebar.resolveIssueNow')}
                    </button>
```

`src/renderer/src/styles.css`:
```css
/* After .project-unread-count */
.project-automation-glyph {
  display: inline-flex;
  vertical-align: middle;
  margin-left: 6px;
  color: var(--color-accent);
}

.project-automation-glyph .icon {
  width: 12px;
  height: 12px;
}

/* After .project-options-menu-item:disabled */
.project-options-menu-check {
  margin-left: auto;
  color: var(--color-accent);
}
```

- [ ] **Step 4: Run the unit tests and the type check**

Run: `npx vitest run src/renderer/src/components/ProjectSidebar.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ProjectSidebar.tsx src/renderer/src/components/ProjectSidebar.test.tsx src/renderer/src/styles.css e2e/codeflai.spec.ts
git commit -m "feat: offer Auto-resolve issues and Resolve one issue now in the project menu" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end coverage of the launch chain

**Files:**
- Create: `e2e/issue-automation.spec.ts`

**Interfaces:**
- Consumes: `createRepo` (`e2e/create-repo.ts`); `renderIssueAutomationTemplate`, `issueAutomationTemplateValues` from `../src/shared/issue-automation`; `en` from `../src/renderer/src/i18n/en`; the fake agent (`e2e/fixtures/fake-agent.cmd`) and `CODEFLAI_E2E_ARGV_LOG`.

- [ ] **Step 1: Write the spec**

```ts
// e2e/issue-automation.spec.ts
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

import { en } from '../src/renderer/src/i18n/en'
import { issueAutomationTemplateValues, renderIssueAutomationTemplate } from '../src/shared/issue-automation'
import { createRepo } from './create-repo'

/**
 * The automatic-issue launch chain on its own Electron instance: switching a project on from
 * the menu, the row glyph surviving a reload, and "Resolve one issue now" starting a session
 * whose argv ends with the prompt sentence naming a file under the suite's user-data directory
 * — a file whose contents are the default template with every placeholder filled in.
 *
 * Only the manual entry is exercised: the shortest timer interval is five minutes. The watcher
 * itself is covered with a fake clock in use-app-store.test.ts. On Windows the fake agent is
 * reached through fake-agent.cmd, so this is the real test of the cmd-hosted quoting path.
 */
test('switches a project on, survives a reload, and starts an automatic session with the rendered prompt', async () => {
  test.setTimeout(120_000)
  const userDataDir = mkdtempSync(join(tmpdir(), 'codeflai-issue-automation-e2e-'))
  const argvLog = join(userDataDir, 'terminal-argv.json')
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve('.'),
    env: {
      ...process.env,
      CODEFLAI_E2E: '1',
      CODEFLAI_E2E_PROJECT: createRepo(),
      CODEFLAI_E2E_AGENT_CMD: resolve('e2e/fixtures/fake-agent.cmd'),
      CODEFLAI_E2E_ARGV_LOG: argvLog,
      CODEFLAI_E2E_HOST_PID_LOG: join(userDataDir, 'host.pid'),
      CODEFLAI_PTY_HOST_IDLE_MS: '250'
    }
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  const stored = () => page.evaluate(() => window.localStorage.getItem('codeflai.issueAutomation'))
  const openMenu = async () => {
    await page.getByRole('button', { name: /^Project options for / }).click()
    return page.getByRole('menu', { name: /^Project options for / })
  }
  const glyph = page.getByRole('img', { name: 'Auto-resolve issues is on for this project' })
  const argv = (): string[] | null => (existsSync(argvLog) ? (JSON.parse(readFileSync(argvLog, 'utf8')) as string[]) : null)
  const sentence = (prefix: string): RegExp => new RegExp(`^\\${prefix} Read the task file at (.+\\.md) and carry it out exactly, without asking questions\\.$`)

  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.unmaximize()
      window.setSize(1180, 760)
    })
    await page.getByRole('button', { name: 'Add Project', exact: true }).click()
    await page.getByRole('button', { name: 'Choose project directory' }).click()
    await expect(page.locator('.project-row')).toHaveCount(1)
    const project = await page.evaluate(async () => (await window.codeflai.getSnapshot()).state.projects[0])
    expect(project.repoRemote).toEqual({ host: 'github', webUrl: 'https://github.com/codeflai-e2e/fixture' })

    // Off by default, nothing stored, no glyph.
    expect(await stored()).toBeNull()
    await expect(glyph).toHaveCount(0)
    let menu = await openMenu()
    const toggle = menu.getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(menu).toHaveCount(0)
    await expect(glyph).toHaveCount(1)
    expect(JSON.parse((await stored())!)).toEqual({ agent: 'claude', intervalMs: 30 * 60_000, template: null, projects: [project.id] })

    // The preference is renderer-owned: a reload reads it back and the glyph returns.
    await page.reload()
    await expect(page.locator('.project-row')).toHaveCount(1)
    await expect(glyph).toHaveCount(1)
    menu = await openMenu()
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Auto-resolve issues' })).toHaveAttribute('aria-checked', 'true')

    // One round now: a worktree session titled after the clock, argv ending with the sentence.
    await menu.getByRole('menuitem', { name: 'Resolve one issue now' }).click()
    const row = page.locator('.session-row', { has: page.locator('.session-kind-icon[data-kind="claude"]') })
    await expect(row).toHaveCount(1)
    await expect(row.locator('.session-title')).toHaveText(/^Auto issue \d\d-\d\d \d\d:\d\d$/)
    await expect.poll(argv, { timeout: 20_000 }).not.toBeNull()
    const claudeArgv = argv()!
    expect(claudeArgv).toHaveLength(2)
    expect(claudeArgv[0]).toBe('--dangerously-skip-permissions')
    const promptFile = sentence('/fast-do').exec(claudeArgv[1])?.[1]
    expect(promptFile).toBeDefined()
    expect(promptFile!.startsWith(join(userDataDir, 'issue-automation'))).toBe(true)
    const expectedPrompt = renderIssueAutomationTemplate(
      en['issueAutomation.defaultTemplate'],
      issueAutomationTemplateValues(project, project.repoRemote!, 'claude')
    )
    expect(readFileSync(promptFile!, 'utf8')).toBe(expectedPrompt)
    expect(expectedPrompt).not.toContain('{{')

    // Switching the agent in Settings changes the prefix in argv and the file alike.
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('combobox', { name: 'Agent' }).selectOption('codex')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    menu = await openMenu()
    await menu.getByRole('menuitem', { name: 'Resolve one issue now' }).click()
    await expect.poll(() => argv()?.[0], { timeout: 20_000 }).toBe('--dangerously-bypass-approvals-and-sandbox')
    const codexArgv = argv()!
    expect(codexArgv.slice(0, 2)).toEqual(['--dangerously-bypass-approvals-and-sandbox', '--no-daemon'])
    const codexPromptFile = sentence('$fast-do').exec(codexArgv[2])?.[1]
    expect(codexPromptFile).toBeDefined()
    expect(readFileSync(codexPromptFile!, 'utf8')).toContain('Resolve the issue with $fast-do in one go')

    expect(errors).toEqual([])
  } finally {
    // Removing the project ends every PTY so the resident host can exit within the E2E idle
    // deadline; otherwise Playwright waits on the keepalive process forever.
    await page.evaluate(async () => {
      const snapshot = await window.codeflai.getSnapshot()
      for (const project of snapshot.state.projects) await window.codeflai.removeProject(project.id)
    }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
```

- [ ] **Step 2: Build and run the spec**

Run (from a plain terminal, or with `ELECTRON_RUN_AS_NODE` cleared): `npm run build && npx playwright test e2e/issue-automation.spec.ts`
Expected: PASS. If the sentence regex fails on the `$fast-do` prefix, the `\\$` escape is the first thing to check; if the second argv never changes, the fake agent is still the first session's process — the log is rewritten on every launch, so wait for the Codex argv with `expect.poll` as written.

- [ ] **Step 3: Run the whole e2e suite once**

Run: `npm run test:e2e`
Expected: PASS, including the updated nine-entry menu assertion in `e2e/codeflai.spec.ts` and the keepalive test (the protocol bump changes nothing within one build).

- [ ] **Step 4: Commit**

```bash
git add e2e/issue-automation.spec.ts
git commit -m "test: cover the automatic-issue launch chain end to end" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Documentation

**Files:**
- Modify: `README.md` (new section before `## Shutting the computer down when nothing is running`, ~line 493; the `## The project options menu` list ~line 465; the `## Settings` list ~line 581; `## What Codeflai remembers` ~line 661)
- Modify: `README.zh-CN.md` (the mirrored sections: `## 项目操作菜单` ~line 249, `## 设置` ~line 263, `## Codeflai 记住了什么` ~line 295, plus a new `## 自动处理 issue` section before `## 窗口置顶`'s neighbour `## 自动关机` equivalent — place it right after `## 项目操作菜单`)
- Modify: `CLAUDE.md` (one bullet in the 渲染进程 list, after the auto-shutdown bullets)

- [ ] **Step 1: README.md**

Add to the `## The project options menu` list, after the **Open Git repository** entry:

```markdown
- **Auto-resolve issues** — a switch, per project: while it is on and the project has no
  running session, Codeflai starts an agent session that works through one open issue. See
  [Resolving issues automatically](#resolving-issues-automatically). Disabled for a project
  with no remote; the row shows a small loop glyph while it is on.
- **Resolve one issue now** — runs one round immediately, without waiting for the timer and
  whether or not something else is running, and switches to the new session. Disabled while
  the chosen agent is switched off in Settings or its CLI is missing.
```

Add a new section before `## Shutting the computer down when nothing is running`:

```markdown
## Resolving issues automatically

Switch **Auto-resolve issues** on in a project's ⋯ menu. From then on, every time the check
runs (every 30 minutes by default) and that project has no running session — the same
meaning of *running* the sidebar uses, so an agent sitting at **Done** does not count —
Codeflai starts a Claude Code (or Codex) session in a fresh worktree whose first prompt tells
the agent to:

1. list the open issues with whatever CLI fits the host (`gh` on GitHub, `glab` on GitLab,
   anything available elsewhere), skipping assigned ones and ones labelled
   `codeflai:in-progress` or `codeflai:needs-human`, and take the oldest;
2. label it `codeflai:in-progress` and comment that it has started;
3. resolve it with your `fast-do` skill — commit, merge, push — **without** packaging or
   publishing a release;
4. wait for the test deployment that push triggered (`gh run watch` on GitHub);
5. close the issue if the deployment succeeded, or leave it open, comment, and relabel it
   `codeflai:needs-human` if it failed or nothing finished within 30 minutes;
6. exit.

Codeflai itself never reads an issue or a CI result. It renders the prompt from the template
in **Settings › Issue automation**, writes it to a file beside its own state, and starts the
agent with one line naming that file. The template is yours to edit — name the right
workflow for a repository with several, change the labels, let it publish if you really
want that — and **Reset to default** brings the built-in one back. Placeholders:
`{{repoUrl}}`, `{{host}}` (`github`, `gitlab` or `unknown`), `{{projectPath}}`,
`{{projectName}}`, and `{{fastDo}}` (`/fast-do` or `$fast-do`, by agent).

Rounds are serial per project: the agent stays running while it waits for CI, which keeps
the project busy until it exits. A project that has no eligible issue still costs one short
agent start per check, which is why the default interval is half an hour. Switching a
project off never stops a round already running — stop that session from its row. If a
launch fails (no worktree, no CLI), the project is switched off and a notice says why, so the
same error does not come back every interval. Codeflai has to be open for any of this to
happen: the check runs inside the window.

The session is titled `Auto issue MM-DD HH:mm`; what happened is in its terminal, and the
usual Done-edge notification tells you when a round ends.
```

Add to `## Settings`, after the **Session kinds** entry:

```markdown
- **Issue automation** — which agent runs automatic issue sessions, how often projects are
  checked, and the prompt template. See
  [Resolving issues automatically](#resolving-issues-automatically).
```

In `## What Codeflai remembers`, extend the first sentence's list with `, the issue-automation agent, interval, template and switches`.

- [ ] **Step 2: README.zh-CN.md**

Under `## 项目操作菜单`, after the **Open Git repository** entry, add:

```markdown
- **Auto-resolve issues（自动处理 issue）** —— 项目级开关：开着且该项目没有运行中的会话时，Codeflai 会自动起一个 agent 会话去处理一条 open issue。见[自动处理 issue](#自动处理-issue)。没有远程的项目这一项禁用；开着时项目行名字旁有一个小循环图标。
- **Resolve one issue now（立即处理一条 issue）** —— 立刻跑一轮，不等定时器、也不管有没有别的会话在跑，并切换到新会话。所选 agent 在设置里被关掉或 CLI 缺失时禁用。
```

Add a new section right after `## 项目操作菜单`:

```markdown
## 自动处理 issue

在项目的 ⋯ 菜单里打开 **Auto-resolve issues**。此后每次检查（默认每 30 分钟）时，只要该项目没有运行中的会话——「运行中」和侧栏的含义一样，停在 **Done** 的 agent 不算——Codeflai 就会在一个新的 worktree 里起一个 Claude Code（或 Codex）会话，它的第一句提示词让 agent：

1. 用适合该平台的 CLI 列出 open issue（GitHub 用 `gh`，GitLab 用 `glab`，其他平台用可用的工具），跳过已 assign 的和带 `codeflai:in-progress` 或 `codeflai:needs-human` 标签的，取最早的一条；
2. 打上 `codeflai:in-progress` 标签并评论已开始处理；
3. 用你的 `fast-do` 技能解决它——提交、合并、推送——**不打包、不发布**；
4. 等待这次推送触发的 test 部署（GitHub 上是 `gh run watch`）；
5. 部署成功就关闭 issue；失败或 30 分钟没结果就留着 issue、评论说明、把标签换成 `codeflai:needs-human`；
6. 退出。

Codeflai 自己从不读 issue、也不看 CI 结果。它只是用 **设置 › Issue 自动处理** 里的模板渲染出提示词，写到自己状态目录旁边的一个文件里，再用一句话让 agent 去读那个文件。模板可以改——多个 workflow 的仓库点名正确的那个、换标签、真想发布就允许发布——**Reset to default** 恢复内置版本。占位符：`{{repoUrl}}`、`{{host}}`（`github`、`gitlab` 或 `unknown`）、`{{projectPath}}`、`{{projectName}}`、`{{fastDo}}`（按 agent 是 `/fast-do` 或 `$fast-do`）。

每个项目一次只跑一轮：agent 等 CI 期间一直在运行，项目就一直是忙的，直到它退出。没有合适 issue 的项目每次检查仍会起一次很短的 agent，这也是默认间隔定为半小时的原因。关掉开关不会停止正在跑的那一轮——去那一行点 Stop。启动失败（建不出 worktree、找不到 CLI）会自动关掉该项目的开关并弹出提示，同一个错误不会每个间隔都回来。这一切都需要 Codeflai 开着：检查跑在窗口里。

会话标题是 `Auto issue MM-DD HH:mm`，发生了什么都在它的终端里，一轮结束时照常收到 Done 通知。
```

Under `## 设置`, after the **Session kinds（会话类型）** entry, add:

```markdown
- **Issue automation（Issue 自动处理）** —— 自动 issue 会话用哪个 agent、多久检查一次项目、以及提示词模板。见[自动处理 issue](#自动处理-issue)。
```

Under `## Codeflai 记住了什么`, extend the first sentence's list with `、Issue 自动处理的 agent、间隔、模板和各项目的开关`.

- [ ] **Step 3: CLAUDE.md**

Add one bullet to the 渲染进程 section, after the 自动关机 bullets:

```markdown
- **自动处理 issue**（`shared/issue-automation.ts` 纯函数 + store 的 watcher + 项目菜单两项 + Settings 分区）：Codeflai 只做触发器和模板，agent 在会话里用 gh/glab 自己选 issue、认领、`/fast-do`、`gh run watch`、关闭。几条非显然的约束：① watcher 住在 renderer，因为「没有 running 会话」是 Done 语义（`hasRunningSessionsIn` 复用 `isAgentDone`），主进程只知道 `status`；② **prompt 走文件不走 argv**：本机 `claude` 解析到 npm 的 `claude.cmd`，经 `cmd.exe /d /s /c` 托管，多行带引号的 prompt 过不了 cmd 的两轮解析，所以 coordinator 把渲染好的模板写到 `<userData>/issue-automation/<sessionId>.md`，host 只追加一句固定话 `/fast-do Read the task file at <path> …`（`issueAutomationPromptArgument`，路径过和 `validateShimPath` 同一张黑名单；托管 shim 路径上含空格的参数会被双引号包起来）；③ 这句话只在 `create` 时追加，`restore`/`reconcile` 永远不带（续接走 `--continue`）；④ spawn 消息多了可选的 `initialPromptFile`，`PTY_PROTOCOL_VERSION` 从 1 升到 2，升级时旧 host 退役一次、会话经 resume 拉起，release notes 要写；⑤ 带 `title` 创建的会话 `titleState: 'complete'` + `titleManuallySet`，因为 prompt 不经 PTY，FirstInputTracker 永远看不到首行；⑥ 两份启动适配（`launch-spec.ts` 与 `TerminalService`）同步改，e2e `issue-automation.spec.ts` 在 Windows 上真的走 `fake-agent.cmd` 的 cmd 托管路径；⑦ 定时启动失败就关掉该项目的开关并弹 notice（与自动关机同理），手动「Resolve one issue now」只报错不动开关；⑧ 偏好 `codeflai.issueAutomation` 在 localStorage，`projects` 读写时都按快照里的项目 id 过滤。真机验证（发版前必做）：真实 Claude、真实仓库、一条一次性 issue，从认领到关闭走一遍，结论记在这里。
```

- [ ] **Step 4: Check the docs render and commit**

Run: `npm run typecheck && npx vitest run src/renderer/src/i18n` (no code changed; this is the smoke that the tree is still green).

```bash
git add README.md README.zh-CN.md CLAUDE.md
git commit -m "docs: describe automatic issue resolution" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Release reminder (not a task step):** when the version is bumped and release notes are written (see memory `release-flow`), the notes must say that the pty-host protocol changed, so upgrading restarts running sessions once (they resume with each agent's own continue flag).

---

## Before claiming done

- `npm run typecheck`, `npm test` (expect the usual 0–1 load-flake, see memory `full-suite-load-flakes`; rerun a lone failure in isolation), `npm run test:e2e`.
- The spike the spec asked for, by hand, before relying on the default template: start `claude --dangerously-skip-permissions "/fast-do Read the task file at <some file> and carry it out exactly, without asking questions."` in a scratch repository and confirm the slash command in the positional prompt is honoured; then one real round against a disposable issue. Record the outcome in the CLAUDE.md bullet (Task 12).
