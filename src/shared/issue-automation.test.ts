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

  // A string replacement would read `$&` and `$1`, and `$fast-do` starts with one.
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
