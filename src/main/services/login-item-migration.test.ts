import { describe, expect, it } from 'vitest'
import { migrateWindowsLoginItem, type LoginItemMigrationApi } from './login-item-migration'

const currentPath = 'C:\\Program Files\\Codeflai\\Codeflai.exe'
const legacyPath = 'C:\\Program Files\\CodeFly\\CodeFly.exe'

const harness = (options: { legacyEnabled?: boolean; currentEnabled?: boolean; ignoreWrite?: boolean } = {}) => {
  const items: Electron.LaunchItems[] = [
    { name: 'CodeFly', path: legacyPath, args: [], scope: 'user', enabled: options.legacyEnabled ?? true },
    ...(options.currentEnabled === undefined ? [] : [
      { name: 'com.codeflai.desktop', path: currentPath, args: [], scope: 'user' as const, enabled: options.currentEnabled }
    ])
  ]
  const writes: Electron.Settings[] = []
  const api: LoginItemMigrationApi = {
    getLoginItemSettings: ({ path } = {}) => {
      // Electron 44 parses options.path as a Windows command line before matching
      // Run entries; an unquoted path stops at its first space.
      const program = path?.match(/^(?:"([^"]+)"|(\S+))/)?.slice(1).find(Boolean)
      const launchItems = items.filter((item) => item.path.toLowerCase() === program?.toLowerCase())
      return { openAtLogin: launchItems.some((item) => item.enabled), launchItems }
    },
    setLoginItemSettings: (settings) => {
      writes.push(settings)
      if (options.ignoreWrite && settings.openAtLogin) return
      const index = items.findIndex((item) => item.name === settings.name)
      if (index >= 0) items.splice(index, 1)
      if (settings.openAtLogin) {
        items.push({ name: settings.name!, path: settings.path!, args: [], scope: 'user', enabled: true })
      }
    }
  }
  const run = (overrides: Partial<Parameters<typeof migrateWindowsLoginItem>[0]> = {}) => migrateWindowsLoginItem({
    platform: 'win32',
    isPackaged: true,
    executablePath: currentPath,
    loginItems: api,
    readLegacyRunCommands: () => [{ name: 'CodeFly', command: `"${legacyPath}"` }],
    ...overrides
  })
  return { run, items, writes, api }
}

describe('migrateWindowsLoginItem', () => {
  it.each(['electron.app.CodeFly', 'com.codefly.desktop'])('discovers the legacy AppUserModelID startup entry %s', (name) => {
    const { run, items, writes } = harness()
    items[0]!.name = name
    expect(run({ readLegacyRunCommands: () => [{ name, command: `"${legacyPath}"` }] })).toBe(true)
    expect(writes.map((item) => [item.name, item.openAtLogin])).toEqual([['com.codeflai.desktop', true], [name, false]])
  })

  it('rejects an unrelated registry name even if its executable is named CodeFly', () => {
    const { run, items, writes } = harness()
    items[0]!.name = 'Unrelated'
    expect(run({ readLegacyRunCommands: () => [{ name: 'Unrelated', command: `"${legacyPath}"` }] })).toBe(false)
    expect(writes).toEqual([])
  })

  it('combines enabled legacy aliases and removes all of them after enabling the new item once', () => {
    const { run, items, writes } = harness({ legacyEnabled: false })
    items.push({ name: 'electron.app.CodeFly', path: legacyPath, args: [], scope: 'user', enabled: true })
    expect(run({ readLegacyRunCommands: () => [
      { name: 'CodeFly', command: `"${legacyPath}"` },
      { name: 'electron.app.CodeFly', command: `"${legacyPath}"` }
    ] })).toBe(true)
    expect(writes.map((item) => [item.name, item.openAtLogin])).toEqual([
      ['com.codeflai.desktop', true], ['CodeFly', false], ['electron.app.CodeFly', false]
    ])
  })

  it('reports an old-entry removal ignored by Windows so cleanup can be retried', () => {
    const { run, api } = harness({ currentEnabled: true })
    api.setLoginItemSettings = () => {}
    expect(run).toThrow(/could not remove/i)
  })

  it('migrates old and new Program Files paths before removing the legacy startup item', () => {
    const { run, items, writes } = harness()
    expect(run()).toBe(true)
    expect(items).toEqual([{ name: 'com.codeflai.desktop', path: currentPath, args: [], scope: 'user', enabled: true }])
    expect(writes.map((item) => [item.name, item.openAtLogin])).toEqual([['com.codeflai.desktop', true], ['CodeFly', false]])
    expect(writes.map((item) => item.path)).toEqual([currentPath, legacyPath])
  })

  it('removes a Windows-disabled old item without enabling startup', () => {
    const { run, items, writes } = harness({ legacyEnabled: false })
    expect(run()).toBe(true)
    expect(items).toEqual([])
    expect(writes.map((item) => [item.name, item.openAtLogin])).toEqual([['CodeFly', false]])
  })

  it.each([true, false])('preserves an existing new startup setting under Program Files (%s)', (currentEnabled) => {
    const { run, items, writes } = harness({ currentEnabled })
    run()
    expect(items).toEqual([{ name: 'com.codeflai.desktop', path: currentPath, args: [], scope: 'user', enabled: currentEnabled }])
    expect(writes.map((item) => item.name)).toEqual(['CodeFly'])
  })

  it('retains the old item and reports a new startup write that did not stick', () => {
    const { run, items } = harness({ ignoreWrite: true })
    expect(run).toThrow(/could not enable/i)
    expect(items.map((item) => item.name)).toEqual(['CodeFly'])
  })

  it('can retry after cleanup fails without rewriting the new preference', () => {
    const { run, api, writes } = harness()
    const original = api.setLoginItemSettings
    let fail = true
    api.setLoginItemSettings = (settings) => {
      if (settings.name === 'CodeFly' && fail) throw new Error('access denied')
      original(settings)
    }
    expect(run).toThrow('access denied')
    fail = false
    expect(run()).toBe(true)
    expect(writes.filter((item) => item.name === 'com.codeflai.desktop')).toHaveLength(1)
    expect(run()).toBe(false)
  })

  it.each([
    { isPackaged: false },
    { platform: 'darwin' as const },
    { customProfile: true }
  ])('does not inspect or alter startup in isolated contexts: %j', (context) => {
    const { run, writes } = harness()
    expect(run({ ...context, readLegacyRunCommands: () => { throw new Error('must not read registry') } })).toBe(false)
    expect(writes).toEqual([])
  })

  it.each([undefined, '', '"C:\\Apps\\Other.exe"', 'CodeFly.exe'])('ignores absent or unrelated legacy commands (%s)', (command) => {
    const { run, writes } = harness()
    expect(run({ readLegacyRunCommands: () => [{ name: 'CodeFly', command }] })).toBe(false)
    expect(writes).toEqual([])
  })

  it('does not remove machine startup entries that cannot be changed by Electron', () => {
    const { run, items, writes } = harness()
    items[0]!.scope = 'machine'
    expect(run()).toBe(false)
    expect(writes).toEqual([])
  })
})
