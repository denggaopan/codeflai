export type LarkProjectRef = { id: string; name: string }

export type LarkCommand =
  | { type: 'bind'; code: string }
  | {
      type: 'run'
      agent: 'claude' | 'codex'
      projectId: string
      projectName: string
      skill?: string
      instruction: string
    }
  | { type: 'error'; reason: 'noProject' | 'ambiguousProject' | 'ambiguousAgent' | 'empty' }

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(raw: string): string {
  return raw.replace(/@_user_\d+/g, ' ').replace(/\s+/g, ' ').trim()
}

function postBody(content: JsonObject): JsonObject | undefined {
  if (Array.isArray(content.content)) return content
  for (const value of Object.values(content)) {
    if (isObject(value) && Array.isArray(value.content)) return value
  }
  return undefined
}

export function extractMessageText(
  messageType: string,
  contentJson: string
): { text: string; imageKeys: string[] } | undefined {
  let content: unknown
  try {
    content = JSON.parse(contentJson)
  } catch {
    return undefined
  }
  if (!isObject(content)) return undefined

  if (messageType === 'text') {
    if (typeof content.text !== 'string') return undefined
    return { text: normalizeText(content.text), imageKeys: [] }
  }

  if (messageType === 'image') {
    if (typeof content.image_key !== 'string') return undefined
    return { text: '', imageKeys: [content.image_key] }
  }

  if (messageType === 'post') {
    const body = postBody(content)
    if (!body) return undefined
    const paragraphs: string[] = []
    const imageKeys: string[] = []
    if (typeof body.title === 'string' && body.title.trim() !== '') paragraphs.push(body.title)
    for (const row of body.content as unknown[]) {
      if (!Array.isArray(row)) continue
      let line = ''
      for (const element of row) {
        if (!isObject(element)) continue
        if ((element.tag === 'text' || element.tag === 'a') && typeof element.text === 'string') {
          line += element.text
        } else if (element.tag === 'img' && typeof element.image_key === 'string') {
          imageKeys.push(element.image_key)
        }
      }
      paragraphs.push(line)
    }
    return { text: normalizeText(paragraphs.join(' ')), imageKeys }
  }

  return undefined
}

const WORD_CHAR = /[A-Za-z0-9_-]/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Word characters are ASCII only ([A-Za-z0-9_-], plus "." when followed by one of those);
// everything else (CJK, whitespace, punctuation, text edges) is a boundary. A boundary is
// only required on a side where the token's own edge character is a word character.
function containsToken(text: string, token: string): boolean {
  const first = token[0] ?? ''
  const last = token[token.length - 1] ?? ''
  const before = WORD_CHAR.test(first) ? '(?<![A-Za-z0-9_.-])' : ''
  const after = WORD_CHAR.test(last) ? '(?![A-Za-z0-9_-])(?!\\.[A-Za-z0-9_-])' : ''
  return new RegExp(`${before}${escapeRegExp(token)}${after}`, 'i').test(text)
}

// Same alphabet as initialPromptSchema in shared/pty-protocol.ts.
const SKILL_TOKEN = /^[/$]([A-Za-z0-9:_-]{1,64})$/

/**
 * Claude Code's own slash commands. Hoisted into argv they would act on the CLI itself (log out,
 * wipe the conversation, change the model) instead of running a skill, so they stay in the prompt.
 */
export const CLAUDE_BUILTIN_DENYLIST: readonly string[] = [
  'login',
  'logout',
  'exit',
  'quit',
  'clear',
  'compact',
  'resume',
  'config',
  'permissions',
  'model',
  'upgrade',
  'doctor',
  'init'
]

// Only a token that opens the instruction is a skill: one in mid-sentence ("看 /settings 页面")
// is usually a path or a word the sender is talking about, not a command.
function leadingSkill(stripped: string): string | undefined {
  const name = SKILL_TOKEN.exec(stripped.split(' ')[0] ?? '')?.[1]
  if (name === undefined || CLAUDE_BUILTIN_DENYLIST.includes(name.toLowerCase())) return undefined
  return name
}

export function parseLarkCommand(text: string, projects: readonly LarkProjectRef[]): LarkCommand {
  const stripped = normalizeText(text)
  if (stripped === '') return { type: 'error', reason: 'empty' }

  const bind = /^绑定\s*(\d{6})$/.exec(stripped)
  if (bind?.[1]) return { type: 'bind', code: bind[1] }

  const mentionsClaude = containsToken(stripped, 'claude')
  const mentionsCodex = containsToken(stripped, 'codex')
  if (mentionsClaude && mentionsCodex) return { type: 'error', reason: 'ambiguousAgent' }
  const agent = mentionsCodex ? 'codex' : 'claude'

  const matched = new Map<string, LarkProjectRef>()
  for (const project of projects) {
    if (project.name !== '' && containsToken(stripped, project.name)) {
      matched.set(project.id, project)
    }
  }
  if (matched.size === 0) return { type: 'error', reason: 'noProject' }
  if (matched.size > 1) return { type: 'error', reason: 'ambiguousProject' }
  const project = [...matched.values()][0]!

  const skill = leadingSkill(stripped)
  return {
    type: 'run',
    agent,
    projectId: project.id,
    projectName: project.name,
    ...(skill ? { skill } : {}),
    instruction: stripped
  }
}
