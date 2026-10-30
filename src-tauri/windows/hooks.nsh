; thinky's additions to Tauri's installer (tauri.conf.json: bundle > windows > nsis >
; installerHooks). The shortcut key's helper (`lean-outliner.exe --hotkey`, src-tauri/src/hotkey.rs)
; runs in the background. Before the program's files are replaced or removed it's asked to quit, as
; the app asks it before an update: WM_CLOSE to its hidden window (class LeanOutlinerHotkey), then
; a wait for its process to end. Otherwise Windows would count it as the app being open.
;
; The rename (Oct 29, 2026: "Lean Outliner" became "thinky"). Tauri's installer keys its folder
; ($LOCALAPPDATA\<name>), its Apps & features entry and its shortcuts on the product name, so the
; first thinky installer would put a second app beside the old one. LO_MIGRATE removes the old one
; first, the way an update does (its own uninstaller, run in place and waited for, with /UPDATE so
; it keeps the Run value and the data), then puts his shortcuts back under the new name. The app's
; data folders are named after the identifier (com.srikanth.leanoutliner), which hasn't changed, so
; his notes folder, look, settings and shortcut key stay. CI checks it with the real Build 31
; installer (build.yml, "Rename check").

!define LO_OLD_NAME "Lean Outliner"
!define LO_OLD_UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lean Outliner"
!define LO_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define LO_RUN_VALUE "Lean Outliner shortcut key" ; hotkey.rs RUN_VALUE (kept: hidden, and older builds remove it by name)
!define LO_LINKS "Software\Classes\leanoutliner"
!define LO_TASKBAR "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

Var LO_OldDir    ; the old app's folder, once it has been removed ("" otherwise)
Var LO_OldStart  ; 1: it had a Start-menu shortcut
Var LO_OldDesk   ; 1: it had a desktop shortcut

!macro LO_STOP_HOTKEY_HELPER
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $3 0
  ${Do}
    ; HWND_MESSAGE (-3): message-only windows
    System::Call 'user32::FindWindowExW(p -3, p 0, w "LeanOutlinerHotkey", p 0) p .r0'
    ${If} $0 == 0
      ${Break}
    ${EndIf}
    System::Call 'user32::GetWindowThreadProcessId(p r0, *i .r1) i'
    System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i r1) p .r2' ; SYNCHRONIZE
    System::Call 'user32::PostMessageW(p r0, i 0x10, p 0, p 0) i' ; WM_CLOSE
    ${If} $2 != 0
      System::Call 'kernel32::WaitForSingleObject(p r2, i 3000) i'
      System::Call 'kernel32::CloseHandle(p r2) i'
    ${Else}
      Sleep 300
    ${EndIf}
    IntOp $3 $3 + 1
  ${LoopUntil} $3 >= 5
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; A shortcut's target, pushed ("" when it can't be read). Changes $0-$3 (as Tauri's IsShortcutTarget).
!macro LO_LNK_TARGET shortcut
  StrCpy $3 ""
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
  ${If} $0 P<> 0
    ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}", .r1)'
    ${If} $1 P<> 0
      ${IPersistFile::Load} $1 '("${shortcut}", ${STGM_READ})i.r2'
      ${If} $2 = 0
        ${IShellLink::GetPath} $0 '(.r3, ${MAX_PATH}, 0, ${SLGP_RAWPATH})'
      ${EndIf}
      ${IUnknown::Release} $1 ""
    ${EndIf}
    ${IUnknown::Release} $0 ""
  ${EndIf}
  Push $3
!macroend

; An old "Lean Outliner" shortcut whose program is gone (it pointed into the old folder): deleted.
; One pointing at a program that's still there (a portable copy) is left alone.
!macro LO_DROP_DEAD_LNK shortcut
  ${If} ${FileExists} "${shortcut}"
    !insertmacro LO_LNK_TARGET "${shortcut}"
    Pop $0
    ${If} $0 == ""
    ${OrIfNot} ${FileExists} $0
      !insertmacro UnpinShortcut "${shortcut}" ; (a Start pin to it would go dead)
      Delete "${shortcut}"
    ${EndIf}
  ${EndIf}
!macroend

; The old "Lean Outliner" under ROOT (HKCU: how it was always installed; HKLM just in case), if it's
; there and nothing was found yet: wait until it isn't open (the one-click update closes it just as
; this starts; by hand, he's asked to close it), note his shortcuts, run its uninstaller as an update
; and clear what that leaves (its uninstall.exe, the empty folder, the old shortcuts).
!macro LO_MIGRATE_FROM ROOT
  ${If} $LO_OldDir == ""
    ReadRegStr $R8 ${ROOT} "${LO_OLD_UNINST}" "UninstallString"
    ${If} $R8 != ""
      ; "C:\…\Lean Outliner\uninstall.exe" (quoted) → its folder
      StrCpy $R9 $R8 1
      ${If} $R9 == '"'
        StrCpy $R8 $R8 "" 1
        ${StrLoc} $R9 $R8 '"' ">"
        ${If} $R9 != ""
          StrCpy $R8 $R8 $R9
        ${EndIf}
      ${EndIf}
      ${GetParent} $R8 $R7
      ${If} ${FileExists} "$R7\uninstall.exe"
        ; open? (a running program can't be opened for writing)
        StrCpy $R6 0
        ${Do}
          ${IfNot} ${FileExists} "$R7\${MAINBINARYNAME}.exe"
            ${Break}
          ${EndIf}
          ClearErrors
          FileOpen $R5 "$R7\${MAINBINARYNAME}.exe" a
          ${IfNot} ${Errors}
            FileClose $R5
            ${Break}
          ${EndIf}
          ${If} ${Silent}
          ${OrIf} $PassiveMode = 1
            ; (after 15 s its own uninstaller closes it)
            IntOp $R6 $R6 + 1
            ${If} $R6 > 30
              ${Break}
            ${EndIf}
            Sleep 500
          ${Else}
            ${If} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "${LO_OLD_NAME} is open. Close it (your notes are already saved), then press Retry.$\n$\nIt becomes ${PRODUCTNAME}: the same app, with your notes, looks and settings." IDCANCEL`
              Abort
            ${EndIf}
          ${EndIf}
        ${Loop}
        StrCpy $LO_OldStart 0
        StrCpy $LO_OldDesk 0
        ${If} ${FileExists} "$SMPROGRAMS\${LO_OLD_NAME}.lnk"
          StrCpy $LO_OldStart 1
        ${EndIf}
        ${If} ${FileExists} "$DESKTOP\${LO_OLD_NAME}.lnk"
          StrCpy $LO_OldDesk 1
        ${EndIf}
        DetailPrint "Removing ${LO_OLD_NAME} (it becomes ${PRODUCTNAME})"
        ClearErrors
        ExecWait '"$R7\uninstall.exe" /S /UPDATE _?=$R7' $R6
        ${If} ${Errors}
          StrCpy $R6 2
        ${EndIf}
        ${If} $R6 = 0
        ${AndIfNot} ${FileExists} "$R7\${MAINBINARYNAME}.exe"
          ; run in place, so it couldn't remove itself or its folder
          Delete "$R7\uninstall.exe"
          RMDir "$R7"
          StrCpy $LO_OldDir $R7
          ; its Start-menu and desktop shortcuts (an update keeps them); a taskbar pin is moved in POSTINSTALL
          Push $0
          Push $1
          Push $2
          Push $3
          !insertmacro LO_DROP_DEAD_LNK "$SMPROGRAMS\${LO_OLD_NAME}.lnk"
          !insertmacro LO_DROP_DEAD_LNK "$DESKTOP\${LO_OLD_NAME}.lnk"
          Pop $3
          Pop $2
          Pop $1
          Pop $0
          ; where it was installed (Tauri's own note of it)
          DeleteRegKey ${ROOT} "${MANUKEY}\${LO_OLD_NAME}"
          DeleteRegKey /ifempty ${ROOT} "${MANUKEY}"
        ${Else}
          DetailPrint "${LO_OLD_NAME} couldn't be removed (code $R6): it stays beside ${PRODUCTNAME}."
          ; said out loud (a passive update hides DetailPrint), so two apps never appear without a word
          MessageBox MB_OK|MB_ICONEXCLAMATION "${PRODUCTNAME} is installed, but the old ${LO_OLD_NAME} couldn't be removed by itself.$\n$\nYour notes and settings are fine. Please uninstall ${LO_OLD_NAME} from Windows Settings > Apps." /SD IDOK
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro LO_MIGRATE
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $LO_OldDir ""
  !insertmacro LO_MIGRATE_FROM HKCU
  !insertmacro LO_MIGRATE_FROM HKLM
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro LO_STOP_HOTKEY_HELPER
  !insertmacro LO_MIGRATE
!macroend

; After the files are in: his shortcuts under the new name (an update makes none itself), a taskbar
; pin pointed at the new program; leanoutliner:// links and the shortcut key's Run entry pointed at
; this copy (the app does both when it starts, too: win.rs, hotkey.rs; done here so they work
; before that, even after a restart).
!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $R9
  ${If} $LO_OldDir != ""
    ${If} $LO_OldStart = 1
    ${AndIfNot} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}
    ${If} $LO_OldDesk = 1
    ${AndIfNot} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
    ; a taskbar pin to the old program (now gone): pointed at this one (it keeps its old name as
    ; its tooltip; unpinning and pinning again names it thinky)
    ${If} ${FileExists} "${LO_TASKBAR}\${LO_OLD_NAME}.lnk"
      !insertmacro LO_LNK_TARGET "${LO_TASKBAR}\${LO_OLD_NAME}.lnk"
      Pop $0
      ${If} $0 == "$LO_OldDir\${MAINBINARYNAME}.exe"
      ${OrIfNot} ${FileExists} $0
        !insertmacro SetShortcutTarget "${LO_TASKBAR}\${LO_OLD_NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  WriteRegStr HKCU "${LO_LINKS}" "" "URL:${PRODUCTNAME}"
  WriteRegStr HKCU "${LO_LINKS}" "URL Protocol" ""
  WriteRegStr HKCU "${LO_LINKS}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ReadRegStr $R9 HKCU "${LO_RUN_KEY}" "${LO_RUN_VALUE}"
  ${If} $R9 != ""
    WriteRegStr HKCU "${LO_RUN_KEY}" "${LO_RUN_VALUE}" '"$INSTDIR\${MAINBINARYNAME}.exe" --hotkey'
  ${EndIf}
  Pop $R9
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; Uninstalling (not the uninstall an update may run): the helper no longer starts with Windows,
; the older Start-menu shortcut with the key (the portable copy's, or one from before the helper)
; goes too, leanoutliner:// links stop pointing here, and Edge and Chrome forget the browser extension's
; receiver (native_host.rs).
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LO_STOP_HOTKEY_HELPER
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "${LO_RUN_KEY}" "${LO_RUN_VALUE}"
    Delete "$APPDATA\Microsoft\Windows\Start Menu\Programs\Lean Outliner capture.lnk"
    Push $R9
    ReadRegStr $R9 HKCU "${LO_LINKS}\shell\open\command" ""
    ${If} $R9 == '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
      DeleteRegKey HKCU "${LO_LINKS}"
    ${EndIf}
    Pop $R9
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.srikanth.leanoutliner"
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.srikanth.leanoutliner"
  ${EndIf}
!macroend
