import { describe, expect, it } from 'vitest'

import { STORAGE_MARKER_KEY, checkStorageMarker, isStoragePopulated } from './storage-marker'

const memoryStorage = (entries: Record<string, string> = {}) => {
  const values = new Map(Object.entries(entries))
  return {
    values,
    get length() { return values.size },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) }
  }
}

describe('isStoragePopulated', () => {
  it('reports whether any key exists and treats an unreadable store as empty', () => {
    expect(isStoragePopulated(memoryStorage())).toBe(false)
    expect(isStoragePopulated(memoryStorage({ 'codeflai.theme': 'dark' }))).toBe(true)
    expect(isStoragePopulated({ get length(): number { throw new Error('denied') } })).toBe(false)
  })
})

describe('checkStorageMarker', () => {
  it('seeds both sides on a first launch without warning', () => {
    const storage = memoryStorage()
    expect(checkStorageMarker(undefined, false, storage, () => 'fresh')).toEqual({ marker: 'fresh', lost: false })
    expect(storage.values.get(STORAGE_MARKER_KEY)).toBe('fresh')
  })

  it('accepts a store that still holds the marker state.json expects', () => {
    expect(checkStorageMarker('m1', true, memoryStorage({ [STORAGE_MARKER_KEY]: 'm1' }))).toEqual({ marker: 'm1', lost: false })
  })

  it('warns when state.json has a marker but localStorage came back empty, and keeps the old marker', () => {
    const storage = memoryStorage()
    expect(checkStorageMarker('m1', false, storage, () => 'fresh')).toEqual({ marker: undefined, lost: true })
    // Written anyway: if the store really was wiped, the next launch adopts this value instead of warning again.
    expect(storage.values.get(STORAGE_MARKER_KEY)).toBe('fresh')
  })

  it('adopts a fresh marker silently when the store already holds other preferences', () => {
    // The marker in state.json was seeded by a launch whose store could not persist; the
    // preferences themselves were never lost.
    const storage = memoryStorage({ 'codeflai.quickPrompts': '[]' })
    expect(checkStorageMarker('m1', true, storage, () => 'fresh')).toEqual({ marker: 'fresh', lost: false })
    expect(storage.values.get(STORAGE_MARKER_KEY)).toBe('fresh')
  })

  it('adopts a different marker instead of warning', () => {
    // A wiped store seen once already, or a state.json restored from its backup.
    expect(checkStorageMarker('m1', true, memoryStorage({ [STORAGE_MARKER_KEY]: 'm2' }))).toEqual({ marker: 'm2', lost: false })
  })

  it('treats unreadable or unwritable storage as lost only when preferences existed before', () => {
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => undefined }
    expect(checkStorageMarker('m1', false, throwing)).toEqual({ marker: undefined, lost: true })
    expect(checkStorageMarker(undefined, false, throwing)).toEqual({ marker: undefined, lost: false })
    const readOnly = { getItem: () => null, setItem: () => { throw new Error('full') } }
    expect(checkStorageMarker('m1', false, readOnly)).toEqual({ marker: undefined, lost: true })
    expect(checkStorageMarker(undefined, false, readOnly)).toEqual({ marker: undefined, lost: false })
  })
})
