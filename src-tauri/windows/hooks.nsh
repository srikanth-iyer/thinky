; Lean Outliner's additions to Tauri's installer (tauri.conf.json: bundle > windows > nsis >
; installerHooks). The shortcut key's helper (`lean-outliner.exe --hotkey`, src-tauri/src/hotkey.rs)
; runs in the background. Before the program's files are replaced or removed it's asked to quit, as
; the app asks it before an update: WM_CLOSE to its hidden window (class LeanOutlinerHotkey), then
; a wait for its process to end. Otherwise Windows would count it as Lean Outliner being open.

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

!macro NSIS_HOOK_PREINSTALL
  !insertmacro LO_STOP_HOTKEY_HELPER
!macroend

; Uninstalling (not the uninstall an update may run): the helper no longer starts with Windows,
; and the older Start-menu shortcut with the key (the portable copy's, or one from before the
; helper) goes too.
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LO_STOP_HOTKEY_HELPER
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Lean Outliner shortcut key"
    Delete "$APPDATA\Microsoft\Windows\Start Menu\Programs\Lean Outliner capture.lnk"
  ${EndIf}
!macroend
