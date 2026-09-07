!ifndef BUILD_UNINSTALLER
  # UUID.v5('com.codefly.desktop', electron-builder's NSIS namespace).
  # Installer-only: the stock uninstaller would otherwise delete this legacy key.
  !define /ifndef CODEFLAI_LEGACY_INSTALL_KEY "Software\1c7b3a78-7cf9-5389-a7dd-8124c7c272df"
  !define /ifndef CODEFLAI_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\1c7b3a78-7cf9-5389-a7dd-8124c7c272df"
  !define UNINSTALL_REGISTRY_KEY_2 "${CODEFLAI_LEGACY_UNINSTALL_KEY}"

  !macro codeflaiAbortMigration
    MessageBox MB_OK|MB_ICONSTOP "Codeflai could not safely remove the previous installation. Repair or uninstall the existing CodeFly/Codeflai installation, keeping app data, and then retry." /SD IDOK
    SetErrorLevel 2
    Quit
  !macroend

  !macro codeflaiValidateLegacy ROOT
    ReadRegStr $R6 ${ROOT} "${CODEFLAI_LEGACY_UNINSTALL_KEY}" UninstallString
    ${if} $R6 != ""
      ${if} ${isDeleteAppData}
        !insertmacro codeflaiAbortMigration
      ${endif}
      Push $R6
      Call GetInQuotes
      Pop $R7
      ${if} $R7 == ""
      ${orIfNot} ${FileExists} "$R7"
        !insertmacro codeflaiAbortMigration
      ${endif}
      Push $R7
      Call GetFileParent
      Pop $R7
      GetFullPathName $R7 "$R7"
      ReadRegStr $R8 ${ROOT} "${CODEFLAI_LEGACY_INSTALL_KEY}" InstallLocation
      ${if} $R8 != ""
        GetFullPathName $R8 "$R8"
        ${if} $R8 != $R7
          !insertmacro codeflaiAbortMigration
        ${endif}
      ${endif}
      ReadRegStr $R8 ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${if} $R8 != ""
        ReadRegStr $R9 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" UninstallString
        # The fallback uses the new InstallLocation when it exists. A broken new
        # registration must never redirect the old uninstaller into the new app.
        ${if} $R9 == ""
          !insertmacro codeflaiAbortMigration
        ${endif}
        GetFullPathName $R8 "$R8"
        StrCpy $R7 "$R7\"
        StrCpy $R8 "$R8\"
        StrLen $R9 $R7
        StrCpy $R6 $R8 $R9
        ${if} $R6 == $R7
          !insertmacro codeflaiAbortMigration
        ${endif}
        StrLen $R9 $R8
        StrCpy $R6 $R7 $R9
        ${if} $R6 == $R8
          !insertmacro codeflaiAbortMigration
        ${endif}
      ${endif}
    ${endif}
    ClearErrors
  !macroend

  !macro customInit
    !insertmacro codeflaiValidateLegacy HKCU
    !insertmacro codeflaiValidateLegacy HKLM
    # Retain the old machine-wide install mode (and silent-install elevation).
    ReadRegStr $R6 HKLM "${CODEFLAI_LEGACY_UNINSTALL_KEY}" UninstallString
    ${if} $R6 != ""
    ${andIfNot} ${isForCurrentUser}
      StrCpy $hasPerMachineInstallation "1"
      ReadRegStr $R6 HKCU "${CODEFLAI_LEGACY_UNINSTALL_KEY}" UninstallString
      ${if} $R6 == ""
      ${andIf} $hasPerUserInstallation != "1"
        !insertmacro setInstallModePerAllUsers
      ${endif}
    ${endif}
    ClearErrors
  !macroend

  !macro codeflaiCheckUninstallResult
    ${if} ${Errors}
    ${orIf} $R0 != 0
      !insertmacro codeflaiAbortMigration
    ${endif}
  !macroend

  !macro codeflaiFinishLegacyUninstall ROOT
    !insertmacro codeflaiCheckUninstallResult
    !insertmacro readReg $R6 "${ROOT}" "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${if} $R6 != ""
      !insertmacro codeflaiAbortMigration
    ${endif}
    !insertmacro readReg $R6 "${ROOT}" "${CODEFLAI_LEGACY_UNINSTALL_KEY}" UninstallString
    ${if} $R6 != ""
      !insertmacro codeflaiValidateLegacy ${ROOT}
      # If both generations existed, the first stock call removed Codeflai.
      # With that registration gone, the second stock call selects CodeFly and
      # passes /KEEP_APP_DATA --updated plus the correct installation scope.
      Push "${ROOT}"
      Call uninstallOldVersion
      !insertmacro codeflaiCheckUninstallResult
      !insertmacro readReg $R6 "${ROOT}" "${CODEFLAI_LEGACY_UNINSTALL_KEY}" UninstallString
      ${if} $R6 != ""
        !insertmacro codeflaiAbortMigration
      ${endif}
    ${endif}
    ClearErrors
  !macroend

  !macro customUnInstallCheck
    !insertmacro codeflaiFinishLegacyUninstall SHELL_CONTEXT
  !macroend

  !macro customUnInstallCheckCurrentUser
    !insertmacro codeflaiFinishLegacyUninstall HKEY_CURRENT_USER
  !macroend
!endif
