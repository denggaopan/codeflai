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
 * placeholders are left in place so the agent sees them for what they are — and so the
 * template can be rendered in two passes: the renderer fills the project values before the
 * session exists, the main process fills `{{resultFile}}` once it has the session id.
 */
export const renderIssueAutomationTemplate = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : match
  )

/**
 * What the agent writes to `{{resultFile}}` once it knows whether there is anything to do:
 * `{"issue": null}` when no open issue qualifies, `{"issue": 42, "title": "…"}` once one is
 * claimed, with the title already condensed by the agent. Codeflai deletes the session on the
 * first and renames it on the second; a file it cannot read is no signal at all.
 */
export type IssueOutcome = { issue: null } | { issue: number; title: string }

export const parseIssueOutcome = (text: string): IssueOutcome | undefined => {
  let parsed: unknown
  try {
    // A UTF-8 BOM survives decoding as U+FEFF, and JSON.parse rejects it.
    parsed = JSON.parse(text.replace(/^﻿/, '').trim())
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const { issue, title } = parsed as { issue?: unknown; title?: unknown }
  if (issue === null) return { issue: null }
  if (typeof issue !== 'number' || !Number.isInteger(issue) || issue <= 0) return undefined
  if (typeof title !== 'string') return undefined
  const trimmed = title.trim()
  return trimmed.length === 0 ? undefined : { issue, title: trimmed }
}

export const ISSUE_SESSION_TITLE_MAX_LENGTH = 80

/** The sidebar title of a session that claimed an issue: `issue#42 <condensed title>`. */
export const issueSessionTitle = (issue: number, title: string): string =>
  `issue#${issue} ${title.replace(/\s+/g, ' ').trim()}`.slice(0, ISSUE_SESSION_TITLE_MAX_LENGTH)

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
