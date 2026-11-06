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

const NAME_CHAR = '[\\p{L}\\p{N}_.-]'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsToken(text: string, token: string): boolean {
  const pattern = new RegExp(`(?<!${NAME_CHAR})${escapeRegExp(token)}(?!${NAME_CHAR})`, 'iu')
  return pattern.test(text)
}

// Same alphabet as initialPromptSchema in shared/pty-protocol.ts.
const SKILL_PATTERN = /(?:^|\s)[/$]([A-Za-z0-9:_-]{1,64})(?=\s|$)/

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

  const skill = SKILL_PATTERN.exec(stripped)?.[1]
  return {
    type: 'run',
    agent,
    projectId: project.id,
    projectName: project.name,
    ...(skill ? { skill } : {}),
    instruction: stripped
  }
}
