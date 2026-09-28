export const STORAGE_MARKER_KEY = 'codeflai.storageMarker'

export type StorageMarkerCheck = {
  /** The marker `state.json` should hold from now on; undefined keeps whatever it has. */
  marker: string | undefined
  /** localStorage came back empty although it was populated before. */
  lost: boolean
}

/**
 * Whether localStorage holds anything at all. Must be sampled before the startup path writes
 * its own keys (theme, locale, pin are re-applied — and re-saved — on every launch), or an
 * empty store looks populated by the time the snapshot arrives.
 */
export const isStoragePopulated = (storage: Pick<Storage, 'length'> = window.localStorage): boolean => {
  try {
    return storage.length > 0
  } catch {
    return false
  }
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
 * A marker missing from a store that holds other preferences is a different story: the marker
 * itself was seeded from a session whose store could not persist (the very first launch of a
 * build with this check, hit by that same upgrade race). Those preferences are right here, so
 * the fresh marker is adopted silently instead of warning about a loss that did not happen.
 *
 * On a loss the marker in `state.json` is deliberately kept. If the store was only unavailable,
 * the next launch finds the original marker again; if it really was wiped, the fresh marker
 * written here is on disk next time and gets adopted, so the warning appears exactly once.
 */
export const checkStorageMarker = (
  expected: string | undefined,
  populated: boolean,
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
  if (expected === undefined || populated) return { marker: fresh, lost: false }
  return { marker: undefined, lost: true }
}
