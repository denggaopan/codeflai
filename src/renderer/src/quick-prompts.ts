import { z } from 'zod'

export const QUICK_PROMPTS_STORAGE_KEY = 'codefly.quickPrompts'
export const MAX_QUICK_PROMPTS = 100
export const MAX_QUICK_PROMPT_CONTENT = 16_000

export const quickPromptSchema = z.object({
  id: z.string().min(1),
  // Older saved prompts have a title and no star; retain their content without pinning it.
  starred: z.boolean().default(false),
  content: z.string().max(MAX_QUICK_PROMPT_CONTENT)
    .transform((content) => content.replace(/\r\n?/g, '\n'))
    .refine((content) => content.trim().length > 0 && !/[\x00-\x08\x0b-\x1f\x7f-\x9f]/u.test(content))
})

export type QuickPrompt = z.infer<typeof quickPromptSchema>

export type QuickPromptPlacement = 'before' | 'after'

export const moveQuickPrompt = (
  prompts: QuickPrompt[], sourceId: string, targetId: string, placement: QuickPromptPlacement
): QuickPrompt[] => {
  const sourceIndex = prompts.findIndex((prompt) => prompt.id === sourceId)
  const targetIndex = prompts.findIndex((prompt) => prompt.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return prompts
  const destination = targetIndex + (placement === 'after' ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0)
  if (sourceIndex === destination) return prompts
  const next = [...prompts]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(destination, 0, moved)
  return next
}

export const quickPromptPreview = (content: string): string => {
  const text = content.trim().replace(/\s+/g, ' ')
  const characters = Array.from(text)
  return characters.length > 80 ? `${characters.slice(0, 80).join('')}...` : text
}

export const quickPromptsSchema = z.array(quickPromptSchema).max(MAX_QUICK_PROMPTS)
  .refine((prompts) => new Set(prompts.map((prompt) => prompt.id)).size === prompts.length)

export const readStoredQuickPrompts = (): QuickPrompt[] => {
  try {
    const stored = window.localStorage.getItem(QUICK_PROMPTS_STORAGE_KEY)
    const legacy = stored === null ? window.localStorage.getItem('codefly.quickPhrases') : null
    const parsed = quickPromptsSchema.safeParse(JSON.parse(stored ?? legacy ?? '[]'))
    if (!parsed.success) return []
    if (legacy !== null) {
      try {
        window.localStorage.setItem(QUICK_PROMPTS_STORAGE_KEY, JSON.stringify(parsed.data))
      } catch {
        // Reading existing prompts still works if the renamed key cannot be persisted.
      }
    }
    return parsed.data
  } catch {
    return []
  }
}
