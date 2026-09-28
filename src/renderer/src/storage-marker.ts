export const STORAGE_MARKER_KEY = 'codeflai.storageMarker'

export type StorageMarkerCheck = {
  /** The marker `state.json` should hold from now on; undefined keeps whatever it has. */
  marker: string | undefined
  /** localStorage came back empty although it was populated before. */
  lost: boolean
}

/**
 * Every presentation preference (quick prompts, theme, locale, …) lives only in localStorage.
 * When Chromium cannot open its Local Storage database — seen right after an upgrade, while the
 * previous version was still letting go of it — it silently hands the page an empty store that
 * lives in memory: every preference reads back as its default and nothing written survives the
 * session. An empty store is indistinguishable from a fresh install from inside the page, so a
 * twin of this marker lives in the main process's `state.json`: finding it there but not here
 * means the preferences are missing, not unset.
 *
 * On a loss the marker in `state.json` is deliberately kept. If the store was only unavailable,
 * the next launch finds the original marker again; if it really was wiped, the fresh marker
 * written here is on disk next time and gets adopted, so the warning appears exactly once.
 */
export const checkStorageMarker = (
  expected: string | undefined,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
  newMarker: () => string = () => crypto.randomUUID()
): StorageMarkerCheck => {
  let stored: string | null
  try {
    stored = storage.getItem(STORAGE_MARKER_KEY)
  } catch {
    return { marker: undefined, lost: expected !== undefined }
  }
  if (stored !== null) return { marker: stored, lost: false }
  const fresh = newMarker()
  try {
    storage.setItem(STORAGE_MARKER_KEY, fresh)
  } catch {
    // Unwritable storage: the next launch runs this same check again.
    return { marker: undefined, lost: expected !== undefined }
  }
  return expected === undefined ? { marker: fresh, lost: false } : { marker: undefined, lost: true }
}
