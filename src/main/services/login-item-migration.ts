import { execFileSync } from 'node:child_process'
import { win32 } from 'node:path'

export type LoginItemMigrationApi = {
  getLoginItemSettings(options?: { path?: string; args?: string[] }): {
    openAtLogin: boolean
    launchItems: Electron.LaunchItems[]
  }
  setLoginItemSettings(settings: Electron.Settings): void
}

export type LoginItemMigrationOptions = {
  platform: NodeJS.Platform
  isPackaged: boolean
  executablePath: string
  customProfile?: boolean
  loginItems: LoginItemMigrationApi
  readLegacyRunCommands?: () => Array<{ name: string; command: string | undefined }>
}

const LEGACY_NAMES = ['CodeFly', 'electron.app.CodeFly', 'com.codefly.desktop']
const CURRENT_NAME = 'com.codeflai.desktop'

function readLegacyRunCommands(): Array<{ name: string; command: string | undefined }> {
  // Electron can inspect a known executable's startup entries, but cannot discover
  // the old installation path. Read only its exact, per-user legacy value.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Run')",
    "$items = @(); if ($null -ne $key) { foreach ($name in @('CodeFly', 'electron.app.CodeFly', 'com.codefly.desktop')) { $command = $key.GetValue($name, $null); if ($null -ne $command) { $items += @{ name = $name; command = [string]$command } } } }",
    'ConvertTo-Json -InputObject $items -Compress'
  ].join('\n')
  const result = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 5000
  })
  return JSON.parse(result)
}

export function migrateWindowsLoginItem(options: LoginItemMigrationOptions): boolean {
  if (options.platform !== 'win32' || !options.isPackaged || options.customProfile) return false

  const { loginItems, executablePath } = options
  // Electron's launchItems lookup parses this path as a command line.
  const findItem = (path: string, name: string) => loginItems.getLoginItemSettings({ path: `"${path}"`, args: [] }).launchItems
    .find((item) => item.scope === 'user' && item.name.toLowerCase() === name.toLowerCase()
      && win32.normalize(item.path).toLowerCase() === win32.normalize(path).toLowerCase())
  const legacyItems = (options.readLegacyRunCommands ?? readLegacyRunCommands)().flatMap(({ name, command }) => {
    const legacyPath = command?.match(/^(?:"([^"]+)"|(\S+))(?:\s|$)/)?.slice(1).find(Boolean)
    if (!LEGACY_NAMES.some((value) => value.toLowerCase() === name.toLowerCase()) || !legacyPath
      || !win32.isAbsolute(legacyPath) || win32.basename(legacyPath).toLowerCase() !== 'codefly.exe') return []
    const item = findItem(legacyPath, name)
    return item ? [item] : []
  })
  if (legacyItems.length === 0) return false

  // An existing new entry (including one disabled in Task Manager) takes priority.
  // Keeping the old entry until read-back succeeds makes interrupted migration retryable.
  if (!findItem(executablePath, CURRENT_NAME) && legacyItems.some((item) => item.enabled)) {
    loginItems.setLoginItemSettings({ name: CURRENT_NAME, path: executablePath, args: [], openAtLogin: true })
    if (!findItem(executablePath, CURRENT_NAME)?.enabled) {
      throw new Error('Could not enable Codeflai at login; the CodeFly startup entry was retained. Retry on the next launch.')
    }
  }

  for (const legacy of legacyItems) {
    loginItems.setLoginItemSettings({ name: legacy.name, path: legacy.path, args: legacy.args, openAtLogin: false })
    if (findItem(legacy.path, legacy.name)) {
      throw new Error('Could not remove the CodeFly startup entry. Retry on the next launch.')
    }
  }
  return true
}
