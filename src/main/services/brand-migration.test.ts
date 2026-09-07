// @vitest-environment node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { completeLegacyHostMigration, isLegacyUiRunning, prepareBrandMigration } from './brand-migration'

let root: string
let legacyUserDataPath: string
let userDataPath: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codeflai-migration-'))
  legacyUserDataPath = join(root, 'CodeFly')
  userDataPath = join(root, 'Codeflai')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const prepare = (extra: Partial<Parameters<typeof prepareBrandMigration>[0]> = {}) =>
  prepareBrandMigration({ userDataPath, legacyUserDataPath, isLegacyAppRunning: () => false, ...extra })

const seed = () => {
  mkdirSync(join(legacyUserDataPath, 'Local Storage', 'leveldb'), { recursive: true })
  writeFileSync(join(legacyUserDataPath, 'state.json'), '{"version":1,"projects":[],"sessions":[]}')
  writeFileSync(join(legacyUserDataPath, 'state.json.bak'), 'backup bytes')
  writeFileSync(join(legacyUserDataPath, 'state.json.corrupt'), 'recovery evidence')
  writeFileSync(join(legacyUserDataPath, 'Local Storage', 'leveldb', '000003.log'), 'saved preferences')
  mkdirSync(join(legacyUserDataPath, 'pty-host'))
  mkdirSync(join(legacyUserDataPath, 'updates'))
}

describe('profile migration', () => {
  it('copies state, backups and Chromium local storage while retaining the complete source', () => {
    seed()
    const result = prepare()
    expect(result.legacyUserDataPath).toBe(legacyUserDataPath)
    for (const file of ['state.json', 'state.json.bak', 'state.json.corrupt', 'Local Storage/leveldb/000003.log']) {
      expect(readFileSync(join(userDataPath, file))).toEqual(readFileSync(join(legacyUserDataPath, file)))
    }
    expect(existsSync(join(userDataPath, 'pty-host'))).toBe(false)
    expect(existsSync(join(userDataPath, 'updates'))).toBe(false)
    expect(existsSync(join(legacyUserDataPath, 'pty-host'))).toBe(true)
  })

  it('is idempotent and remembers the old host directory after migration', () => {
    seed()
    prepare()
    writeFileSync(join(userDataPath, 'state.json'), 'new state')
    expect(prepare().legacyUserDataPath).toBe(legacyUserDataPath)
    expect(readFileSync(join(userDataPath, 'state.json'), 'utf8')).toBe('new state')
  })

  it('does not overwrite an existing new profile or attach it to legacy sessions', () => {
    seed()
    mkdirSync(userDataPath)
    writeFileSync(join(userDataPath, 'state.json'), 'already in use')
    expect(prepare().legacyUserDataPath).toBeUndefined()
    expect(readFileSync(join(userDataPath, 'state.json'), 'utf8')).toBe('already in use')
  })

  it('migrates into an empty destination and supports preference-only old profiles', () => {
    mkdirSync(join(legacyUserDataPath, 'Local Storage'), { recursive: true })
    writeFileSync(join(legacyUserDataPath, 'Local Storage', 'settings'), 'theme')
    mkdirSync(userDataPath)
    prepare()
    expect(readFileSync(join(userDataPath, 'Local Storage', 'settings'), 'utf8')).toBe('theme')
  })

  it('leaves no partial destination when a copy fails and can retry later', () => {
    seed()
    expect(() => prepare({ copy: (source, target) => { cpSync(source, target, { recursive: true }); throw new Error('disk full') } }))
      .toThrow('disk full')
    expect(existsSync(userDataPath)).toBe(false)
    expect(readdirSync(root)).toEqual(['CodeFly'])
    expect(prepare().legacyUserDataPath).toBe(legacyUserDataPath)
  })

  it('refuses to copy a live old profile and preserves both directories', () => {
    seed()
    expect(() => prepare({ isLegacyAppRunning: () => true })).toThrow('Close CodeFly')
    expect(existsSync(userDataPath)).toBe(false)
    expect(existsSync(join(legacyUserDataPath, 'state.json'))).toBe(true)
  })

  it('also refuses a concurrently reopened old app after a successful migration', () => {
    seed()
    prepare()
    expect(() => prepare({ isLegacyAppRunning: () => true })).toThrow('Close CodeFly')
  })

  it('does nothing on a fresh install and never calls the process checker', () => {
    expect(prepare({ isLegacyAppRunning: () => { throw new Error('unexpected check') } }).legacyUserDataPath).toBeUndefined()
    expect(existsSync(userDataPath)).toBe(false)
  })

  it('permanently stops discovering stale legacy hosts after switching to the new endpoint', () => {
    seed()
    prepare()
    completeLegacyHostMigration(userDataPath)
    expect(prepare().legacyUserDataPath).toBeUndefined()
    expect(readFileSync(join(userDataPath, 'state.json'))).toEqual(readFileSync(join(legacyUserDataPath, 'state.json')))
  })

  it('uses the recorded source when another supported legacy directory is selected on a later launch', () => {
    seed()
    prepare()
    const other = join(root, 'legacy-dev')
    const result = prepare({ legacyUserDataPath: other, allowedLegacyPaths: [legacyUserDataPath, other] })
    expect(result.legacyUserDataPath).toBe(legacyUserDataPath)
  })

  it('retains the exact legacy host spelling and development suffix across runtime-mode changes', () => {
    seed()
    const hostPath = `${legacyUserDataPath}::dev`
    prepare({ legacyHostUserDataPath: hostPath })
    expect(prepare().legacyHostUserDataPath).toBe(hostPath)
  })

  it('copies through a storage junction so new preferences never modify the backup', () => {
    mkdirSync(legacyUserDataPath)
    const storage = join(root, 'original-storage')
    mkdirSync(storage)
    writeFileSync(join(storage, 'preferences'), 'old')
    symlinkSync(storage, join(legacyUserDataPath, 'Local Storage'), process.platform === 'win32' ? 'junction' : 'dir')
    prepare()
    writeFileSync(join(userDataPath, 'Local Storage', 'preferences'), 'new')
    expect(readFileSync(join(storage, 'preferences'), 'utf8')).toBe('old')
  })
})

describe('legacy UI process detection', () => {
  it('ignores a surviving macOS PTY host but detects the old UI', () => {
    const executable = '/Applications/CodeFly.app/Contents/MacOS/CodeFly'
    const host = `${executable} ${executable} /Applications/CodeFly.app/Contents/Resources/app.asar/out/main/pty-host.mjs`
    expect(isLegacyUiRunning('darwin', () => host)).toBe(false)
    expect(isLegacyUiRunning('darwin', () => `${host}\n${executable} ${executable}`)).toBe(true)
  })

  it('handles spaces in a macOS installation path', () => {
    const executable = '/Users/Dev Name/My Apps/CodeFly.app/Contents/MacOS/CodeFly'
    expect(isLegacyUiRunning('darwin', () => `${executable} ${executable}`)).toBe(true)
    expect(isLegacyUiRunning('darwin', () => `${executable} ${executable} /Users/Dev Name/My Apps/CodeFly.app/Contents/Resources/app.asar/out/main/pty-host.mjs`)).toBe(false)
  })

  it('recognizes only the Windows UI image, keeping the detached host alive', () => {
    expect(isLegacyUiRunning('win32', () => '"codefly-pty-host.exe","1234","Console","1","10 K"')).toBe(false)
    expect(isLegacyUiRunning('win32', () => '"CodeFly.exe","1234","Console","1","10 K"')).toBe(true)
  })
})
