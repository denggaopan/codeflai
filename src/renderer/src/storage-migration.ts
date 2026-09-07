/** Read legacy keys once per preference without replacing any value saved by Codeflai. */
export const readMigratedStorage = (key: string, aliases: readonly string[] = []): string | null => {
  const current = window.localStorage.getItem(key)
  if (current !== null) return current
  const legacyKeys = [key.replace(/^codeflai\./, 'codefly.'), ...aliases]
  for (const legacyKey of legacyKeys) {
    const value = window.localStorage.getItem(legacyKey)
    if (value === null) continue
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // The old value remains usable even when the profile is read-only or full.
    }
    return value
  }
  return null
}
