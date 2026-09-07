// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UUID } from 'builder-util-runtime'

const root = path.resolve(import.meta.dirname, '..')
const include = path.join(root, 'build', 'installer.nsh')
const cache = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'nsis-3.0.4.1')
const compiler = cache && existsSync(cache) && readdirSync(cache)
  .map((name) => path.join(cache, name, 'Bin', 'makensis.exe')).find(existsSync)
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const relative = path.relative(tmpdir(), directory)
    if (path.isAbsolute(relative) || relative.startsWith('..') || !relative.startsWith('codeflai-installer-test-')) {
      throw new Error(`Unexpected test directory: ${directory}`)
    }
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps the new identity and derives the legacy compatibility GUID from the former app ID', () => {
  const config = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
  expect(config).toMatch(/^appId: com\.codeflai\.desktop$/m)
  expect(config).toMatch(/^  include: build\/installer\.nsh$/m)
  expect(config).not.toMatch(/^\s+guid:/m)
  const legacyGuid = UUID.v5('com.codefly.desktop', UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'))
  expect(readFileSync(include, 'utf8')).toContain(legacyGuid)
})

const nsisString = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"')

function runHarness({ current = false, leaveLegacyKey = false, leaveCurrentInstallKey = false, nested = false, missingLegacy = false, mismatchedLegacyDirectory = false, mode = 'CurrentUser' } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'codeflai-installer-test-'))
  temporaryDirectories.push(directory)
  const testKey = `Software\\CodeflaiInstallerMigrationTests\\${path.basename(directory)}`
  const currentDirectory = path.join(directory, 'new')
  const legacyDirectory = path.join(nested ? currentDirectory : directory, 'old')
  mkdirSync(currentDirectory)
  mkdirSync(legacyDirectory)
  const log = path.join(directory, 'uninstall.log')
  const passed = path.join(directory, 'passed.txt')
  const compile = (name, source) => {
    const file = path.join(directory, `${name}.nsi`)
    writeFileSync(file, source)
    const compiled = spawnSync(compiler, ['/V2', file], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0)
  }
  const fakeUninstaller = (name, folder, uninstallKey, installKey, keepKey, keepInstallKey = false) => {
    const file = path.join(folder, `Uninstall ${name}.exe`)
    compile(name, `
Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${nsisString(file)}"
!include FileFunc.nsh
Section
  SetRegView 64
  FileOpen $0 "${nsisString(log)}" a
  \${GetParameters} $1
  FileWrite $0 '${name}|$1$\\r$\\n'
  FileClose $0
  ${keepKey ? '' : `DeleteRegKey HKCU "${uninstallKey}"`}
  ${keepInstallKey ? '' : `DeleteRegKey HKCU "${installKey}"`}
SectionEnd
`)
    return file
  }
  const oldUninstaller = fakeUninstaller('CodeFly', legacyDirectory, `${testKey}\\OldUninstall`, `${testKey}\\OldInstall`, leaveLegacyKey)
  const newUninstaller = current && fakeUninstaller('Codeflai', currentDirectory, `${testKey}\\NewUninstall`, `${testKey}\\NewInstall`, false, leaveCurrentInstallKey)
  const installer = path.join(directory, 'harness.exe')
  compile('harness', `
Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${nsisString(installer)}"
!include LogicLib.nsh
!include FileFunc.nsh
!define INSTALL_REGISTRY_KEY "${testKey}\\NewInstall"
!define UNINSTALL_REGISTRY_KEY "${testKey}\\NewUninstall"
!define CODEFLAI_LEGACY_INSTALL_KEY "${testKey}\\OldInstall"
!define CODEFLAI_LEGACY_UNINSTALL_KEY "${testKey}\\OldUninstall"
!define isUpdated '0 = 1'
!define isDeleteAppData '0 = 1'
!define isForCurrentUser '0 = 1'
!define isForAllUsers '0 = 1'
!define StdUtils.GetParentPath '!insertmacro harnessGetParent'
!macro harnessGetParent OUT FILE
  \${GetParent} "\${FILE}" \${OUT}
!macroend
!macro setInstallModePerAllUsers
  StrCpy $installMode all
!macroend
Var installMode
Var appExe
Var hasPerMachineInstallation
Var hasPerUserInstallation
!include "${nsisString(include)}"
!include "${nsisString(path.join(root, 'node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh'))}"
LangString uninstallFailed 1033 "Uninstall failed"
LangString appCannotBeClosed 1033 "Uninstall still failed"
Section
  SetRegView 64
  SetShellVarContext current
  InitPluginsDir
  StrCpy $installMode "${mode}"
  StrCpy $INSTDIR "${nsisString(currentDirectory)}"
  WriteRegStr HKCU "${testKey}\\OldUninstall" UninstallString '\"${nsisString(missingLegacy ? `${oldUninstaller}.missing` : oldUninstaller)}\"'
  WriteRegStr HKCU "${testKey}\\OldInstall" InstallLocation "${nsisString(mismatchedLegacyDirectory ? currentDirectory : legacyDirectory)}"
  ${current ? `WriteRegStr HKCU "${testKey}\\NewUninstall" UninstallString '\"${nsisString(newUninstaller)}\"'
  WriteRegStr HKCU "${testKey}\\NewInstall" InstallLocation "${nsisString(currentDirectory)}"` : ''}
  !insertmacro customInit
  !insertmacro uninstallOldVersion ${mode === 'all' ? 'HKEY_CURRENT_USER' : 'SHELL_CONTEXT'}
  !insertmacro handleUninstallResult ${mode === 'all' ? 'HKEY_CURRENT_USER' : 'SHELL_CONTEXT'}
  FileOpen $0 "${nsisString(passed)}" w
  FileWrite $0 "success"
  FileClose $0
SectionEnd
`)
  let executed
  try {
    executed = spawnSync(installer, ['/S'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  } finally {
    // The only registry writes in this harness are confined to this unique test key.
    execFileSync('reg.exe', ['delete', `HKCU\\${testKey}`, '/f', '/reg:64'], { windowsHide: true, stdio: 'ignore' })
  }
  return { status: executed.status, log: existsSync(log) ? readFileSync(log, 'utf8') : '', passed: existsSync(passed), legacyDirectory }
}

describe.skipIf(process.platform !== 'win32' || !compiler)('isolated NSIS migration behavior', () => {
  it('does not compile legacy registration cleanup into the new uninstaller', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'codeflai-installer-test-'))
    temporaryDirectories.push(directory)
    const script = path.join(directory, 'uninstaller-guard.nsi')
    writeFileSync(script, `
Unicode true
RequestExecutionLevel user
OutFile "${nsisString(path.join(directory, 'guard.exe'))}"
!define BUILD_UNINSTALLER
!include "${nsisString(include)}"
!ifdef UNINSTALL_REGISTRY_KEY_2
  !error "Legacy identity leaked into the new uninstaller"
!endif
Section
SectionEnd
`)
    const compiled = spawnSync(compiler, ['/V2', script], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0)
  })

  it('removes the legacy registration with app data retained', () => {
    const result = runHarness()
    expect(result.status).toBe(0)
    expect(result.passed).toBe(true)
    expect(result.log).toContain('CodeFly|')
    expect(result.log).toContain('/KEEP_APP_DATA')
    expect(result.log).toContain('--updated')
    expect(result.log).toContain('/currentuser')
    expect(result.log).toContain(`_?=${result.legacyDirectory}`)
    expect(result.log).not.toContain('--delete-app-data')
  })

  it('removes both independent old and new installations before copying files', () => {
    const result = runHarness({ current: true })
    expect(result.status).toBe(0)
    expect(result.passed).toBe(true)
    expect(result.log.indexOf('Codeflai|')).toBeLessThan(result.log.indexOf('CodeFly|'))
    expect(result.log).toContain(`_?=${result.legacyDirectory}`)
  })

  it('uses current-user scope when the all-users installer removes a per-user legacy installation', () => {
    const result = runHarness({ mode: 'all' })
    expect(result.status).toBe(0)
    expect(result.log).toContain('/currentuser')
    expect(result.log).not.toContain('/allusers')
  })

  it('aborts when the old uninstaller cannot be launched', () => {
    const result = runHarness({ missingLegacy: true })
    expect(result.status).toBe(2)
    expect(result.passed).toBe(false)
    expect(result.log).toBe('')
  })

  it('aborts when an uninstaller claims success without removing its registration', () => {
    const result = runHarness({ leaveLegacyKey: true })
    expect(result.status).toBe(2)
    expect(result.passed).toBe(false)
  })

  it('does not point the old uninstaller at a stale new installation directory', () => {
    const result = runHarness({ current: true, leaveCurrentInstallKey: true })
    expect(result.status).toBe(2)
    expect(result.passed).toBe(false)
    expect(result.log).not.toContain('CodeFly|')
  })

  it('refuses overlapping old and new directories before executing either uninstaller', () => {
    const result = runHarness({ current: true, nested: true })
    expect(result.status).toBe(2)
    expect(result.passed).toBe(false)
    expect(result.log).toBe('')
  })

  it('refuses a legacy uninstaller outside its recorded installation directory', () => {
    const result = runHarness({ mismatchedLegacyDirectory: true })
    expect(result.status).toBe(2)
    expect(result.passed).toBe(false)
    expect(result.log).toBe('')
  })
})
