import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const MIGRATION_MARKER = 'brand-migration.json'

export type BrandMigrationOptions = {
  userDataPath: string
  legacyUserDataPath: string
  legacyHostUserDataPath?: string
  isLegacyAppRunning: () => boolean
  copy?: (source: string, target: string) => void
  allowedLegacyPaths?: readonly string[]
}

export type BrandMigrationResult = { legacyUserDataPath?: string; legacyHostUserDataPath?: string }

const checkLegacyClosed = (check: () => boolean): void => {
  if (check()) throw new Error('Close CodeFly before opening Codeflai. Your saved data and running terminals will be kept.')
}

/** Runs before Chromium opens its Local Storage database. The source remains a rollback copy. */
export const prepareBrandMigration = ({
  userDataPath, legacyUserDataPath, isLegacyAppRunning,
  legacyHostUserDataPath = legacyUserDataPath,
  copy = (source, target) => cpSync(source, target, { recursive: true, errorOnExist: true, force: false, dereference: true }),
  allowedLegacyPaths = [legacyUserDataPath]
}: BrandMigrationOptions): BrandMigrationResult => {
  if (resolve(userDataPath) === resolve(legacyUserDataPath)) return {}
  const markerPath = join(userDataPath, MIGRATION_MARKER)
  if (existsSync(markerPath)) {
    const marker: unknown = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (!marker || typeof marker !== 'object' || !('source' in marker) || typeof marker.source !== 'string' || !allowedLegacyPaths.includes(marker.source)) {
      throw new Error(`The Codeflai migration record at ${markerPath} is invalid. Restore it from your backup before retrying.`)
    }
    const hostPath = 'hostUserDataPath' in marker ? marker.hostUserDataPath : marker.source
    if (hostPath !== marker.source && hostPath !== `${marker.source}::dev`) {
      throw new Error(`The Codeflai terminal migration record at ${markerPath} is invalid.`)
    }
    if ('hostDiscoveryComplete' in marker && marker.hostDiscoveryComplete === true) return {}
    checkLegacyClosed(isLegacyAppRunning)
    return { legacyUserDataPath: marker.source, legacyHostUserDataPath: hostPath }
  }
  // Any existing destination content belongs to Codeflai; never merge two divergent profiles.
  if (existsSync(userDataPath) && readdirSync(userDataPath).length > 0) return {}
  if (!existsSync(legacyUserDataPath)) return {}
  const entries = readdirSync(legacyUserDataPath).filter((entry) =>
    entry === 'Local Storage' || entry === 'Preferences' || entry === 'state.json' || entry.startsWith('state.json.')
  )
  if (entries.length === 0) return {}
  checkLegacyClosed(isLegacyAppRunning)
  mkdirSync(dirname(userDataPath), { recursive: true })
  const staging = mkdtempSync(join(dirname(userDataPath), '.codeflai-migration-'))
  try {
    for (const entry of entries) copy(join(legacyUserDataPath, entry), join(staging, entry))
    writeFileSync(join(staging, MIGRATION_MARKER), JSON.stringify({
      version: 1, source: legacyUserDataPath, hostUserDataPath: legacyHostUserDataPath
    }), { flag: 'wx' })
    // rmdir refuses non-empty directories, including a profile created by a concurrent launch.
    if (existsSync(userDataPath)) rmdirSync(userDataPath)
    renameSync(staging, userDataPath)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return { legacyUserDataPath, legacyHostUserDataPath }
}

/** Commit discovery retirement before spawning a new host, so an old backup can never take over again. */
export const completeLegacyHostMigration = (userDataPath: string): void => {
  const markerPath = join(userDataPath, MIGRATION_MARKER)
  const marker: unknown = JSON.parse(readFileSync(markerPath, 'utf8'))
  if (!marker || typeof marker !== 'object' || !('source' in marker) || typeof marker.source !== 'string') {
    throw new Error('Cannot complete terminal migration: the profile migration record is invalid.')
  }
  const staging = mkdtempSync(join(userDataPath, '.codeflai-migration-'))
  try {
    const stagedMarker = join(staging, MIGRATION_MARKER)
    writeFileSync(stagedMarker, JSON.stringify({ ...marker, hostDiscoveryComplete: true }))
    renameSync(stagedMarker, markerPath)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Only tests for the legacy UI executable; codefly-pty-host.exe must stay alive. */
export const isLegacyUiRunning = (
  platform: NodeJS.Platform,
  readProcesses: (command: string, args: string[]) => string = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
): boolean => {
  if (platform === 'win32') {
    const output = readProcesses('tasklist.exe', ['/FI', 'IMAGENAME eq CodeFly.exe', '/FO', 'CSV', '/NH'])
    return /^"CodeFly\.exe",/im.test(output)
  }
  const output = readProcesses('/bin/ps', ['-ww', '-axo', 'comm=,args='])
  // macOS runs the detached host with the same executable as the UI, distinguished by its script argument.
  return output.split(/\r?\n/).some((command) =>
    /\/CodeFly\.app\/Contents\/MacOS\/CodeFly(?:\s|$)/.test(command) && !/\/pty-host\.mjs(?:\s|$)/.test(command)
  )
}
