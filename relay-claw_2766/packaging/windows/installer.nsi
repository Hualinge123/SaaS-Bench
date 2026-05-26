Unicode True
RequestExecutionLevel user
ManifestDPIAware true
SetCompress off

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "x64.nsh"

; --------------- Visual assets ---------------
; Place these files under packaging\windows\assets\:
;   app.ico              — 256x256 multi-res icon
!define ASSETS_DIR "${__FILEDIR__}\assets"

!define MUI_ICON   "${ASSETS_DIR}\app.ico"
!define MUI_UNICON "${ASSETS_DIR}\app.ico"

; Font size setting (use Segoe UI for clearer Win11/DPI rendering)
SetFont "Segoe UI" 9

; --------------- Abort warning ---------------
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "确定要取消安装 ${APP_NAME} 吗？"

!ifndef APP_VERSION
!define APP_VERSION "0.0.0"
!endif

!ifndef PAYLOAD_7Z
!error "PAYLOAD_7Z define is required"
!endif

!ifndef SEVENZIP_EXE
!error "SEVENZIP_EXE define is required"
!endif

!ifndef OUTPUT_EXE
!define OUTPUT_EXE "OfficeClaw-windows-x64-setup.exe"
!endif

!define APP_NAME "OfficeClaw"
!define COMPANY_KEY "OfficeClaw"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
!define INSTALL_KEY "Software\${COMPANY_KEY}\${APP_NAME}"
!define AUTOSTART_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define AUTOSTART_VALUE "${APP_NAME}"
!define TOAST_APP_USER_MODEL_ID "OfficeClaw"
!define ACTIVATION_PROTOCOL "officeclaw"
!define DOTNET462_RELEASE 394802
!define STARTMENU_DIR "$SMPROGRAMS\${APP_NAME}"
!define DEFAULT_INSTALL_DIR "$LOCALAPPDATA\Programs\${APP_NAME}"
!define INSTALLER_MUTEX_NAME "Local\${COMPANY_KEY}.${APP_NAME}.InstallerSession"

Name "${APP_NAME}"
OutFile "${OUTPUT_EXE}"
InstallDir "${DEFAULT_INSTALL_DIR}"
InstallDirRegKey HKCU "${INSTALL_KEY}" "InstallDir"
BrandingText "${APP_NAME} Desktop Installer"
ShowInstDetails show
ShowUninstDetails show

Var SelectedInstallDir
Var ExistingInstallDir
Var InstallerMutexHandle

; --------------- License page (custom nsDialogs) ---------------
Page custom LicensePageCreate LicensePageLeave

; --------------- Welcome page (custom nsDialogs, no left bitmap) ---------------
Page custom WelcomePageCreate

; --------------- Directory page (custom nsDialogs) ---------------
Page custom DirectoryPageCreate DirectoryPageLeave

; --------------- Options page ---------------
Page custom OptionsPageCreate OptionsPageLeave

; --------------- Install page ---------------
!insertmacro MUI_PAGE_INSTFILES

; --------------- Finish page (custom nsDialogs, no left bitmap) ---------------
Page custom FinishPageCreate FinishPageLeave

; --------------- Uninstaller pages ---------------
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; --------------- Language ---------------
!insertmacro MUI_LANGUAGE "SimpChinese"

Var LicenseDialog
Var AgreeRadio
Var DisagreeRadio
Var NextButton
Var WelcomeDialog
Var DirectoryDialog
Var DirectoryInput
Var DirectoryBrowseButton
Var OptionsDialog
Var StartMenuShortcutCheckbox
Var DesktopShortcutCheckbox
Var AutoStartCheckbox
Var FinishDialog
Var FinishLaunchCheckbox
Var CreateStartMenuShortcut
Var CreateDesktopShortcut
Var EnableAutoStart
Var DetectedRunningProcesses
Var IsExistingInstall

; Check if OfficeClaw-related processes are running
; Returns "1" in $R0 if running, "0" otherwise
Function CheckOfficeClawRunning
  StrCpy $R0 "0"

  ; Check OfficeClaw.exe
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq OfficeClaw.exe" 2>nul | find /I "OfficeClaw.exe"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check jiuwenclaw.exe (sidecar agent)
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq jiuwenclaw.exe" 2>nul | find /I "jiuwenclaw.exe"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check redis-server.exe
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq redis-server.exe" 2>nul | find /I "redis-server.exe"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check node.exe processes that belong to OfficeClaw (from installed dir)
  nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$instDir = (Get-ItemProperty -Path \"HKCU:\Software\OfficeClaw\OfficeClaw\" -Name InstallDir -ErrorAction SilentlyContinue).InstallDir; if ($$instDir) { Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$instDir, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1 }"'
  Pop $0
  Pop $1
  ${If} $1 != ""
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check python.exe processes that belong to OfficeClaw (from installed dir tools\python or vendor\.venv)
  nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$instDir = (Get-ItemProperty -Path \"HKCU:\Software\OfficeClaw\OfficeClaw\" -Name InstallDir -ErrorAction SilentlyContinue).InstallDir; if ($$instDir) { Get-Process -Name python,pythonw -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$instDir, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1 }"'
  Pop $0
  Pop $1
  ${If} $1 != ""
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check processes whose command line contains 'jiuwenclaw' (case-insensitive)
  nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$found = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.CommandLine -and $$_.CommandLine -match \"jiuwenclaw\" } | Select-Object -First 1; if ($$found) { \"found\" }"'
  Pop $0
  Pop $1
  ${If} $1 == "found"
    StrCpy $R0 "1"
    Return
  ${EndIf}
FunctionEnd

Function LicensePageCreate
  !insertmacro MUI_HEADER_TEXT "许可协议" "继续安装前请阅读下列重要信息。$\r$\n请仔细阅读下列许可协议，您在继续安装前必须同意这些协议条款。"

  nsDialogs::Create 1018
  Pop $LicenseDialog
  ${If} $LicenseDialog == error
    Abort
  ${EndIf}

  GetDlgItem $NextButton $HWNDPARENT 1
  EnableWindow $NextButton 0

  ${NSD_CreateLabel} 0 10u 100% 12u "${APP_NAME}软件许可协议"
  Pop $0

  ${NSD_CreateLabel} 10u 25u 46u 10u "1.了解和同意"
  Pop $0

  ${NSD_CreateLink} 56u 25u 100% 10u "华为云隐私政策声明"
  Pop $1
  ${NSD_OnClick} $1 "OnPrivacyLinkClick"

  ${NSD_CreateLabel} 10u 40u 46u 10u "2.了解和同意"
  Pop $0

  ${NSD_CreateLink} 56u 40u 100% 10u "AgentArts服务声明"
  Pop $1
  ${NSD_OnClick} $1 "OnServiceLinkClick"

  ${NSD_CreateLabel} 10u 55u 46u 10u "3.了解和同意"
  Pop $0

  ${NSD_CreateLink} 56u 55u 100% 10u "华为云公测试用服务协议"
  Pop $1
  ${NSD_OnClick} $1 "OnTestServiceLinkClick"

  ${NSD_CreateRadioButton} 0 100u 100% 12u "我同意此协议(&A)"
  Pop $AgreeRadio
  ${NSD_Setfocus} $AgreeRadio

  ${NSD_OnClick} $AgreeRadio OnAgreementChanged

  ${NSD_CreateRadioButton} 0 115u 100% 12u "我不同意此协议(&D)"
  Pop $DisagreeRadio
  ${NSD_OnClick} $DisagreeRadio OnAgreementChanged

  nsDialogs::Show
FunctionEnd

Function OnPrivacyLinkClick
  Pop $0
  ExecShell "open" "https://www.huaweicloud.com/declaration/sa_prp.html"
FunctionEnd

Function OnServiceLinkClick
  Pop $0
  ExecShell "open" "https://www.huaweicloud.com/declaration/agentarts.html"
FunctionEnd

Function OnTestServiceLinkClick
  Pop $0
  ExecShell "open" "https://www.huaweicloud.com/declaration/fsa_test.html"
FunctionEnd

Function OnAgreementChanged
  Call UpdateNextButtonState
FunctionEnd

Function UpdateNextButtonState
  ${NSD_GetState} $AgreeRadio $0
  ${If} $0 == 1
    EnableWindow $NextButton 1
  ${Else}
    EnableWindow $NextButton 0
  ${EndIf}
FunctionEnd

Function LicensePageLeave
FunctionEnd

Function WelcomePageCreate
  !insertmacro MUI_HEADER_TEXT "欢迎安装 ${APP_NAME}" "本向导将引导您完成 ${APP_NAME} v${APP_VERSION} 的安装"
  nsDialogs::Create 1018
  Pop $WelcomeDialog
  ${If} $WelcomeDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 80% "欢迎使用 ${APP_NAME} v${APP_VERSION} 安装向导。$\r$\n$\r$\n${APP_NAME} 是一套开箱即用的本地 AI 运行环境，安装完成后即可使用。$\r$\n$\r$\n本安装包包含以下组件：$\r$\n  - Node.js 运行时$\r$\n  - Python 运行时$\r$\n  - Redis 数据库$\r$\n  - Web 管理界面$\r$\n  - MCP Server$\r$\n$\r$\n点击「下一步」继续。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function OptionsPageCreate
  !insertmacro MUI_HEADER_TEXT "安装选项" "请选择快捷方式和启动方式"
  nsDialogs::Create 1018
  Pop $OptionsDialog
  ${If} $OptionsDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "请选择 ${APP_NAME} 的安装附加选项。您后续也可以通过重新运行安装包修改这些设置。"
  Pop $0

  ${NSD_CreateCheckbox} 0 32u 100% 12u "创建开始菜单快捷方式"
  Pop $StartMenuShortcutCheckbox
  ${If} $CreateStartMenuShortcut == "1"
    ${NSD_Check} $StartMenuShortcutCheckbox
  ${EndIf}

  ${NSD_CreateCheckbox} 0 50u 100% 12u "创建桌面快捷方式"
  Pop $DesktopShortcutCheckbox
  ${If} $CreateDesktopShortcut == "1"
    ${NSD_Check} $DesktopShortcutCheckbox
  ${EndIf}

  ${NSD_CreateCheckbox} 0 68u 100% 12u "开机自动启动 ${APP_NAME}"
  Pop $AutoStartCheckbox
  ${If} $EnableAutoStart == "1"
    ${NSD_Check} $AutoStartCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function OptionsPageLeave
  ${NSD_GetState} $StartMenuShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CreateStartMenuShortcut "1"
  ${Else}
    StrCpy $CreateStartMenuShortcut "0"
  ${EndIf}

  ${NSD_GetState} $DesktopShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CreateDesktopShortcut "1"
  ${Else}
    StrCpy $CreateDesktopShortcut "0"
  ${EndIf}

  ${NSD_GetState} $AutoStartCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $EnableAutoStart "1"
  ${Else}
    StrCpy $EnableAutoStart "0"
  ${EndIf}
FunctionEnd

Function FinishPageCreate
  !insertmacro MUI_HEADER_TEXT "安装完成" "${APP_NAME} 已成功安装"
  nsDialogs::Create 1018
  Pop $FinishDialog
  ${If} $FinishDialog == error
    Abort
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:完成"

  ${NSD_CreateLabel} 0 0 100% 60% "${APP_NAME} 已成功安装到您的计算机。$\r$\n$\r$\n点击「完成」退出安装向导。"
  Pop $0

  ${NSD_CreateCheckbox} 0 65% 100% 12u "立即启动 ${APP_NAME}"
  Pop $FinishLaunchCheckbox
  ${NSD_Check} $FinishLaunchCheckbox

  nsDialogs::Show
FunctionEnd

Function FinishPageLeave
  ${NSD_GetState} $FinishLaunchCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    Exec "$INSTDIR\OfficeClaw.exe"
  ${EndIf}
FunctionEnd

Function AcquireInstallerSessionMutex
  ; Keep a process-lifetime mutex so parallel installer/uninstaller instances
  ; cannot race on the same install dir, payload archive, or uninstall registry.
  System::Call 'kernel32::CreateMutexW(p0, i0, w "${INSTALLER_MUTEX_NAME}") p.r0 ?e'
  StrCpy $InstallerMutexHandle $0
  Pop $1
  ${If} $1 == 183
    MessageBox MB_OK|MB_ICONEXCLAMATION "检测到另一个 ${APP_NAME} 安装或卸载正在进行。$\r$\n$\r$\n请先完成当前安装向导后再试。"
    Abort
  ${EndIf}
FunctionEnd

Function un.AcquireInstallerSessionMutex
  ; Keep a process-lifetime mutex so parallel installer/uninstaller instances
  ; cannot race on the same install dir, payload archive, or uninstall registry.
  System::Call 'kernel32::CreateMutexW(p0, i0, w "${INSTALLER_MUTEX_NAME}") p.r0 ?e'
  StrCpy $InstallerMutexHandle $0
  Pop $1
  ${If} $1 == 183
    MessageBox MB_OK|MB_ICONEXCLAMATION "检测到另一个 ${APP_NAME} 安装或卸载正在进行。$\r$\n$\r$\n请先完成当前安装向导后再试。"
    Abort
  ${EndIf}
FunctionEnd

Function .onInit
  SetShellVarContext current
  Call AcquireInstallerSessionMutex
  Call ResolveExistingInstallDir
  Call ResolveInstallOptionDefaults
  ${If} $ExistingInstallDir != ""
    StrCpy $INSTDIR $ExistingInstallDir
    StrCpy $SelectedInstallDir $ExistingInstallDir
    StrCpy $IsExistingInstall "1"
  ${Else}
    StrCpy $SelectedInstallDir $INSTDIR
    StrCpy $IsExistingInstall "0"
  ${EndIf}

  ; Check if OfficeClaw is running
  Call CheckOfficeClawRunning
  ${If} $R0 == "1"
    MessageBox MB_ICONQUESTION|MB_YESNO "检测到 OfficeClaw 正在运行。$\r$\n$\r$\n继续安装需要关闭正在运行的 OfficeClaw 及相关进程。$\r$\n$\r$\n是否关闭进程并继续安装？$\r$\n$\r$\n选择「是」将关闭所有相关进程后继续安装。$\r$\n选择「否」将退出安装程序。" IDYES proceed_install
    Abort
  proceed_install:
    StrCpy $DetectedRunningProcesses "1"
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext current
  Call un.AcquireInstallerSessionMutex

  ; Check if OfficeClaw is running before uninstall
  Call un.CheckOfficeClawRunning
  ${If} $R0 == "1"
    MessageBox MB_ICONQUESTION|MB_YESNO "检测到 OfficeClaw 正在运行。$\r$\n$\r$\n卸载需要关闭正在运行的 OfficeClaw 及相关进程。$\r$\n$\r$\n是否关闭进程并继续卸载？$\r$\n$\r$\n选择「是」将关闭所有相关进程后继续卸载。$\r$\n选择「否」将退出卸载程序。" IDYES proceed_uninstall
    Abort
  proceed_uninstall:
  ${EndIf}
FunctionEnd

Function ResolveExistingInstallDir
  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallDir"
  ${If} $0 == ""
    StrCpy $ExistingInstallDir ""
    Return
  ${EndIf}

  IfFileExists "$0\uninstall.exe" existing_install +2
  IfFileExists "$0\OfficeClaw.exe" existing_install 0
    StrCpy $ExistingInstallDir ""
    Return

existing_install:
  StrCpy $ExistingInstallDir $0
FunctionEnd

Function ResolveInstallOptionDefaults
  StrCpy $CreateStartMenuShortcut "1"
  StrCpy $CreateDesktopShortcut "1"
  StrCpy $EnableAutoStart "0"

  ${If} $ExistingInstallDir == ""
    Return
  ${EndIf}

  IfFileExists "${STARTMENU_DIR}\${APP_NAME}.lnk" +2 0
    StrCpy $CreateStartMenuShortcut "0"

  IfFileExists "$DESKTOP\${APP_NAME}.lnk" +2 0
    StrCpy $CreateDesktopShortcut "0"

  ReadRegStr $0 HKCU "${AUTOSTART_KEY}" "${AUTOSTART_VALUE}"
  ${If} $0 != ""
    StrCpy $EnableAutoStart "1"
  ${EndIf}
FunctionEnd

Function DirectoryPageCreate
  ${If} $ExistingInstallDir != ""
    StrCpy $INSTDIR $ExistingInstallDir
    StrCpy $SelectedInstallDir $ExistingInstallDir
  ${ElseIf} $SelectedInstallDir == ""
    StrCpy $SelectedInstallDir "${DEFAULT_INSTALL_DIR}"
    StrCpy $INSTDIR $SelectedInstallDir
  ${Else}
    Call NormalizeSelectedInstallDir
    StrCpy $INSTDIR $SelectedInstallDir
  ${EndIf}

  ${If} $IsExistingInstall == "1"
    !insertmacro MUI_HEADER_TEXT "安装目录" "本次安装将更新现有安装"
  ${Else}
    !insertmacro MUI_HEADER_TEXT "选择安装目录" "选择 ${APP_NAME} 的安装位置"
  ${EndIf}
  
  nsDialogs::Create 1018
  Pop $DirectoryDialog
  ${If} $DirectoryDialog == error
    Abort
  ${EndIf}
  
  ${If} $IsExistingInstall == "1"
    ; 已安装场景：显示警告和只读目录
    ${NSD_CreateLabel} 0 0 100% 30u "检测到已安装的 ${APP_NAME}，本次安装将更新现有目录：$\r$\n$\r$\n安装目录不可修改，如需更换位置请先卸载当前版本。"
    Pop $0
    SetCtlColors $0 0x0000FF transparent
    
    ${NSD_CreateLabel} 0 35u 50u 12u "安装目录："
    Pop $0
    
    ${NSD_CreateText} 55u 35u 245u 12u "$ExistingInstallDir"
    Pop $DirectoryInput
    EnableWindow $DirectoryInput 0
    SetCtlColors $DirectoryInput 0x808080 0xF0F0F0
  ${Else}
    ; 新装场景：可编辑的目录选择
    ${NSD_CreateLabel} 0 0 100% 24u "请选择安装路径。若选择父目录，安装器会自动在其下创建 ${APP_NAME} 子目录。$\r$\n$\r$\n建议使用默认目录，安装路径过长可能导致部分功能异常。"
    Pop $0
    
    ${NSD_CreateLabel} 0 35u 50u 12u "安装目录："
    Pop $0
    
    ${NSD_CreateText} 55u 35u 205u 12u "$SelectedInstallDir"
    Pop $DirectoryInput
    
    ${NSD_CreateButton} 265u 35u 35u 12u "浏览..."
    Pop $DirectoryBrowseButton
    ${NSD_OnClick} $DirectoryBrowseButton OnDirectoryBrowseClicked
  ${EndIf}
  
  nsDialogs::Show
FunctionEnd

Function OnDirectoryBrowseClicked
  ${If} $DirectoryInput == 0
    Return
  ${EndIf}

  ${NSD_GetText} $DirectoryInput $0
  nsDialogs::SelectFolderDialog "选择安装目录" $0
  Pop $0
  ${If} $0 == error
    Return
  ${EndIf}
  StrCpy $SelectedInstallDir $0
  Call NormalizeSelectedInstallDir
  StrCpy $INSTDIR $SelectedInstallDir
  ${NSD_SetText} $DirectoryInput $SelectedInstallDir
FunctionEnd

Function IsPathWithinProtectedRoot
  ; Expects selected path in $0 and protected root in $1.
  ; Returns "1" in $R0 when selected path equals or is nested under that root.
  StrCpy $R0 "0"

  StrLen $2 $1
  ${If} $2 <= 0
    Return
  ${EndIf}

  StrCpy $3 $0 $2
  System::Call 'kernel32::lstrcmpiW(w r3, w r1) i.r4'
  ${If} $4 != 0
    Return
  ${EndIf}

  StrLen $4 $0
  ${If} $4 == $2
    StrCpy $R0 "1"
    Return
  ${EndIf}

  StrCpy $5 $0 1 $2
  ${If} $5 == "\"
  ${OrIf} $5 == "/"
    StrCpy $R0 "1"
  ${EndIf}
FunctionEnd

Function CheckDirectoryRequiresAdmin
  ; Check if the selected directory requires admin privileges by attempting to create it
  ; Returns "1" in $R0 if admin required, "0" otherwise
  StrCpy $R0 "0"

  ; Fast path: block the real machine-wide Program Files roots and C:\Windows only.
  StrCpy $0 $SelectedInstallDir
  ${If} $0 != ""
    ReadEnvStr $1 "ProgramFiles"
    Call IsPathWithinProtectedRoot
    ${If} $R0 == "1"
      StrCpy $R0 "1"
      Return
    ${EndIf}

    ReadEnvStr $1 "ProgramFiles(x86)"
    Call IsPathWithinProtectedRoot
    ${If} $R0 == "1"
      StrCpy $R0 "1"
      Return
    ${EndIf}

    ; Keep this intentionally scoped to C:\Windows; other drives are checked by write probe below.
    StrCpy $1 $0 10
    ${If} $1 == "C:\Windows"
    ${OrIf} $1 == "c:\windows"
    ${OrIf} $1 == "C:/Windows"
    ${OrIf} $1 == "c:/windows"
      StrCpy $R0 "1"
      Return
    ${EndIf}
  ${EndIf}

  ; Actually test write permission by attempting to create the directory
  ; This catches any directory with restrictive NTFS permissions
  ClearErrors
  CreateDirectory "$SelectedInstallDir"
  ${If} ${Errors}
    ; Failed to create directory - likely permission issue
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Try to create a test file
  ClearErrors
  FileOpen $1 "$SelectedInstallDir\.write-test-$$" w
  ${If} ${Errors}
    ; Failed to create file - no write permission
    RMDir "$SelectedInstallDir"
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Cleanup test file and directory
  FileClose $1
  Delete "$SelectedInstallDir\.write-test-$$"
  RMDir "$SelectedInstallDir"
FunctionEnd

Function NormalizeSelectedInstallDir
  ${If} $ExistingInstallDir != ""
    Return
  ${EndIf}

  StrCpy $0 $SelectedInstallDir

trim_trailing_separator:
  StrLen $1 $0
  ${If} $1 <= 3
    Goto check_suffix
  ${EndIf}

  IntOp $2 $1 - 1
  StrCpy $3 $0 1 $2
  ${If} $3 == "\"
  ${OrIf} $3 == "/"
    StrCpy $0 $0 $2
    Goto trim_trailing_separator
  ${EndIf}

check_suffix:
  ${If} $0 == ""
    StrCpy $SelectedInstallDir "${DEFAULT_INSTALL_DIR}"
    Return
  ${EndIf}

  StrLen $1 "${APP_NAME}"
  StrLen $2 $0
  ${If} $2 >= $1
    IntOp $3 $2 - $1
    StrCpy $4 $0 "" $3
    ${If} $4 == "${APP_NAME}"
      ${If} $3 == 0
        StrCpy $SelectedInstallDir $0
        Return
      ${EndIf}

      IntOp $5 $3 - 1
      StrCpy $6 $0 1 $5
      ${If} $6 == "\"
      ${OrIf} $6 == "/"
        StrCpy $SelectedInstallDir $0
        Return
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; Check if $0 already ends with a backslash (drive roots like D:\)
  StrLen $7 $0
  IntOp $8 $7 - 1
  StrCpy $9 $0 1 $8
  ${If} $9 == "\"
  ${OrIf} $9 == "/"
    StrCpy $SelectedInstallDir "$0${APP_NAME}"
  ${Else}
    StrCpy $SelectedInstallDir "$0\${APP_NAME}"
  ${EndIf}
FunctionEnd

Function DirectoryPageLeave
  ${If} $IsExistingInstall == "1"
    ; 已安装场景，保持原目录
    StrCpy $INSTDIR $ExistingInstallDir
    StrCpy $SelectedInstallDir $ExistingInstallDir
    Return
  ${EndIf}

  ; 新装场景，获取用户输入
  ${NSD_GetText} $DirectoryInput $SelectedInstallDir
  Call NormalizeSelectedInstallDir

  StrLen $0 $SelectedInstallDir
  ${If} $0 > 200
    MessageBox MB_ICONEXCLAMATION|MB_OK "安装路径过长（$0 字符），请选择较短的路径。"
    Abort
  ${EndIf}

  ${If} $SelectedInstallDir == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择安装目录。"
    Abort
  ${EndIf}

  ; Check if selected directory requires admin privileges
  Call CheckDirectoryRequiresAdmin
  ${If} $R0 == "1"
    MessageBox MB_ICONEXCLAMATION|MB_OK "所选目录需要管理员权限，无法安装。$\r$\n$\r$\n请选择以下位置之一：$\r$\n  · $LOCALAPPDATA\Programs\${APP_NAME}（推荐）$\r$\n  · $PROFILE\${APP_NAME}$\r$\n  · 其他用户目录"
    Abort
  ${EndIf}

  StrCpy $INSTDIR $SelectedInstallDir
  ${NSD_SetText} $DirectoryInput $SelectedInstallDir
FunctionEnd

; Stop OfficeClaw services by delegating to stop-windows.ps1 when available.
; Falls back to direct process termination if the script is not found.
; IMPORTANT: Uses registry InstallDir (old install path) to locate the stop script,
; ensuring processes from previous installation are stopped even when reinstalling to a different directory.
!macro _ForceKillInstalledProcesses
  ; First, try to use stop-windows.ps1 from the installed directory
  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallDir"
  ${If} $0 != ""
    IfFileExists "$0\scripts\stop-windows.ps1" use_stop_script 0
  ${EndIf}

  ; Fallback: direct process termination when stop-windows.ps1 is not available
  Goto fallback_kill

use_stop_script:
  DetailPrint "正在通过 stop-windows.ps1 停止服务..."
  ; Execute stop-windows.ps1 with 60 second timeout
  nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { Set-Location \"$0\"; & \"$0\scripts\stop-windows.ps1\" }"'
  Pop $1
  ${If} $1 == "timeout"
    DetailPrint "stop-windows.ps1 执行超时，使用备用方式终止进程..."
    Goto fallback_kill
  ${ElseIf} $1 != 0
    DetailPrint "stop-windows.ps1 执行失败 (错误码: $1)，使用备用方式终止进程..."
    Goto fallback_kill
  ${EndIf}

  ; Verify processes are stopped, force-kill any remaining
  nsExec::ExecToLog 'cmd /c tasklist /FI "IMAGENAME eq OfficeClaw.exe" | find /I "OfficeClaw.exe" >nul && taskkill /F /IM OfficeClaw.exe >nul 2>&1'
  Pop $0
  nsExec::ExecToLog 'cmd /c tasklist /FI "IMAGENAME eq redis-server.exe" | find /I "redis-server.exe" >nul && taskkill /F /IM redis-server.exe >nul 2>&1'
  Pop $0
  nsExec::ExecToLog 'cmd /c tasklist /FI "IMAGENAME eq jiuwenclaw.exe" | find /I "jiuwenclaw.exe" >nul && taskkill /F /IM jiuwenclaw.exe >nul 2>&1'
  Pop $0

  ; Kill remaining node/python processes from the install directory
  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallDir"
  ${If} $0 != ""
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$instDir = \"$0\"; Get-Process -Name node,python,pythonw -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$instDir, [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue"'
    Pop $1
    ; Also kill processes with jiuwenclaw in command line
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.CommandLine -and $$_.CommandLine -match \"jiuwenclaw\" -and $$_.Name -notmatch \"setup\" } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
    Pop $1
  ${EndIf}

  Sleep 3000
  Goto done_kill

fallback_kill:
  ; 1. Kill desktop launcher by name
  nsExec::ExecToLog 'cmd /c tasklist /FI "IMAGENAME eq OfficeClaw.exe" | find /I "OfficeClaw.exe" >nul && taskkill /F /IM OfficeClaw.exe >nul 2>&1'
  Pop $0

  ; 2. Kill jiuwenclaw.exe (sidecar agent) by name
  nsExec::ExecToLog 'cmd /c tasklist /FI "IMAGENAME eq jiuwenclaw.exe" | find /I "jiuwenclaw.exe" >nul && taskkill /F /IM jiuwenclaw.exe >nul 2>&1'
  Pop $0

  ; 3. Redis: try graceful shutdown via redis-cli first (preserves data), then force-kill if needed
  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallDir"
  ${If} $0 != ""
    ; Try redis-cli shutdown save (graceful, preserves data)
    nsExec::ExecToLog 'cmd /c if exist "$0\tools\redis\redis-cli.exe" ( "$0\tools\redis\redis-cli.exe" -p 6399 shutdown save 2>nul ) else if exist "$0\vendor\redis\redis-cli.exe" ( "$0\vendor\redis\redis-cli.exe" -p 6399 shutdown save 2>nul )'
    Pop $1
    ; Check if Redis still running, force-kill if needed
    nsExec::ExecToLog 'cmd /c tasklist /FI "IMAGENAME eq redis-server.exe" | find /I "redis-server.exe" >nul && taskkill /F /IM redis-server.exe >nul 2>&1'
    Pop $1
  ${Else}
    ; No registry path, just force-kill by name
    nsExec::ExecToLog 'cmd /c tasklist /FI "IMAGENAME eq redis-server.exe" | find /I "redis-server.exe" >nul && taskkill /F /IM redis-server.exe >nul 2>&1'
    Pop $0
  ${EndIf}

  ; 4. Kill processes whose command line contains 'jiuwenclaw' and path-based matches
  ;    Do 3 rounds with 3s interval each for robustness
  nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.CommandLine -and $$_.CommandLine -match \"jiuwenclaw\" -and $$_.Name -notmatch \"setup\" } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Pop $0
  Sleep 3000

  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallDir"
  ${If} $0 != ""
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$instDir = \"$0\"; Get-Process -Name node,python,pythonw -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$instDir, [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue"'
    Pop $1
  ${EndIf}
  Sleep 3000

  ; Final round: kill any remaining processes from install directory
  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallDir"
  ${If} $0 != ""
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$instDir = \"$0\"; Get-Process -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$instDir, [System.StringComparison]::OrdinalIgnoreCase) -and $$_.ProcessName -notmatch \"setup\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
    Pop $1
  ${EndIf}

done_kill:
!macroend

Function CloseRunningServices
  !insertmacro _ForceKillInstalledProcesses
FunctionEnd

Function un.CloseRunningServices
  !insertmacro _ForceKillInstalledProcesses
FunctionEnd

; Uninstall version of CheckOfficeClawRunning
Function un.CheckOfficeClawRunning
  StrCpy $R0 "0"

  ; Check OfficeClaw.exe
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq OfficeClaw.exe" 2>nul | find /I "OfficeClaw.exe"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check jiuwenclaw.exe (sidecar agent)
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq jiuwenclaw.exe" 2>nul | find /I "jiuwenclaw.exe"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check redis-server.exe
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq redis-server.exe" 2>nul | find /I "redis-server.exe"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check node.exe processes that belong to OfficeClaw (from installed dir)
  nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$instDir = (Get-ItemProperty -Path \"HKCU:\Software\OfficeClaw\OfficeClaw\" -Name InstallDir -ErrorAction SilentlyContinue).InstallDir; if ($$instDir) { Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$instDir, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1 }"'
  Pop $0
  Pop $1
  ${If} $1 != ""
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check python.exe processes that belong to OfficeClaw (from installed dir)
  nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$instDir = (Get-ItemProperty -Path \"HKCU:\Software\OfficeClaw\OfficeClaw\" -Name InstallDir -ErrorAction SilentlyContinue).InstallDir; if ($$instDir) { Get-Process -Name python,pythonw -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$instDir, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1 }"'
  Pop $0
  Pop $1
  ${If} $1 != ""
    StrCpy $R0 "1"
    Return
  ${EndIf}

  ; Check processes whose command line contains 'jiuwenclaw' (case-insensitive)
  nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$found = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.CommandLine -and $$_.CommandLine -match \"jiuwenclaw\" } | Select-Object -First 1; if ($$found) { \"found\" }"'
  Pop $0
  Pop $1
  ${If} $1 == "found"
    StrCpy $R0 "1"
    Return
  ${EndIf}
FunctionEnd

; Delete all managed dirs/files in $INSTDIR, preserving user-data (.office-claw, data, logs, .env, cat-config.json).
; Uses cmd /c rd /s /q for speed — handles tens of thousands of files near-instantly.
!macro _CleanupManagedPayload
  nsExec::ExecToLog 'cmd /c if exist "$INSTDIR\packages" rd /s /q "$INSTDIR\packages"'
  Pop $0
  nsExec::ExecToLog 'cmd /c if exist "$INSTDIR\tools" rd /s /q "$INSTDIR\tools"'
  Pop $0
  nsExec::ExecToLog 'cmd /c if exist "$INSTDIR\vendor" rd /s /q "$INSTDIR\vendor"'
  Pop $0
  nsExec::ExecToLog 'cmd /c if exist "$INSTDIR\scripts" rd /s /q "$INSTDIR\scripts"'
  Pop $0
  nsExec::ExecToLog 'cmd /c if exist "$INSTDIR\docs" rd /s /q "$INSTDIR\docs"'
  Pop $0
  nsExec::ExecToLog 'cmd /c if exist "$INSTDIR\installer-seed" rd /s /q "$INSTDIR\installer-seed"'
  Pop $0
  Delete "$INSTDIR\.office-claw-release.json"
  Delete "$INSTDIR\.env.example"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\pnpm-lock.yaml"
  Delete "$INSTDIR\pnpm-workspace.yaml"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\SETUP.md"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\AGENTS.md"
  Delete "$INSTDIR\CLA.md"
  Delete "$INSTDIR\CLAUDE.md"
  Delete "$INSTDIR\GEMINI.md"
  Delete "$INSTDIR\SECURITY.md"
  Delete "$INSTDIR\CONTRIBUTING.md"
  Delete "$INSTDIR\MAINTAINERS.md"
  Delete "$INSTDIR\TRADEMARKS.md"
  Delete "$INSTDIR\biome.json"
  Delete "$INSTDIR\tsconfig.base.json"
  Delete "$INSTDIR\.npmrc"
  Delete "$INSTDIR\office-claw-template.json"
  Delete "$INSTDIR\pnpm-workspace.yaml"
  Delete "$INSTDIR\OfficeClaw.exe"
  Delete "$INSTDIR\OfficeClaw.exe.config"
  Delete "$INSTDIR\Microsoft.Web.WebView2.Core.dll"
  Delete "$INSTDIR\Microsoft.Web.WebView2.WinForms.dll"
  Delete "$INSTDIR\WebView2Loader.dll"
!macroend

Function CleanupManagedPayload
  !insertmacro _CleanupManagedPayload
FunctionEnd

Function un.CleanupManagedPayload
  !insertmacro _CleanupManagedPayload
FunctionEnd

Function EnsureX64Windows
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "${APP_NAME} 当前安装包仅支持 64 位 Windows。$\r$\n$\r$\n请在 64 位 Windows 10 或更高版本系统上安装。"
    SetErrorLevel 1
    Abort
  ${EndIf}
FunctionEnd

Function WriteShellShortcuts
  InitPluginsDir
  File /oname=$PLUGINSDIR\set-toast-shortcut-aumid.ps1 "${__FILEDIR__}\set-toast-shortcut-aumid.ps1"

  ${If} $CreateStartMenuShortcut == "1"
    CreateDirectory "${STARTMENU_DIR}"
    CreateShortCut "${STARTMENU_DIR}\${APP_NAME}.lnk" "$INSTDIR\OfficeClaw.exe" "" "$INSTDIR\assets\app.ico"
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\set-toast-shortcut-aumid.ps1" -AppUserModelId "${TOAST_APP_USER_MODEL_ID}" -ShortcutPath "${STARTMENU_DIR}\${APP_NAME}.lnk"'
    Pop $0
    ${If} $0 != 0
      DetailPrint "警告: 开始菜单快捷方式 Toast 身份写入失败 (错误码: $0)"
    ${EndIf}
    CreateShortCut "${STARTMENU_DIR}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\uninstall.exe"
  ${Else}
    Delete "${STARTMENU_DIR}\${APP_NAME}.lnk"
    Delete "${STARTMENU_DIR}\Uninstall ${APP_NAME}.lnk"
    RMDir "${STARTMENU_DIR}"
  ${EndIf}

  ${If} $CreateDesktopShortcut == "1"
    CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\OfficeClaw.exe" "" "$INSTDIR\assets\app.ico"
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\set-toast-shortcut-aumid.ps1" -AppUserModelId "${TOAST_APP_USER_MODEL_ID}" -ShortcutPath "$DESKTOP\${APP_NAME}.lnk"'
    Pop $0
    ${If} $0 != 0
      DetailPrint "警告: 桌面快捷方式 Toast 身份写入失败 (错误码: $0)"
    ${EndIf}
  ${Else}
    Delete "$DESKTOP\${APP_NAME}.lnk"
  ${EndIf}
FunctionEnd

Function WriteAutoStartRegistry
  ${If} $EnableAutoStart == "1"
    WriteRegStr HKCU "${AUTOSTART_KEY}" "${AUTOSTART_VALUE}" '"$INSTDIR\OfficeClaw.exe"'
  ${Else}
    DeleteRegValue HKCU "${AUTOSTART_KEY}" "${AUTOSTART_VALUE}"
  ${EndIf}
FunctionEnd

Function WriteActivationProtocolRegistry
  WriteRegStr HKCU "Software\Classes\${ACTIVATION_PROTOCOL}" "" "URL:${APP_NAME} Protocol"
  WriteRegStr HKCU "Software\Classes\${ACTIVATION_PROTOCOL}" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\${ACTIVATION_PROTOCOL}\shell\open\command" "" '"$INSTDIR\OfficeClaw.exe" "%1"'
FunctionEnd

Function WriteUninstallRegistry
  WriteRegStr HKCU "${INSTALL_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Huawei Cloud"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\assets\app.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
FunctionEnd

Function DetectDotNet462Runtime
  ; Returns "1" in $R0 when .NET Framework 4.6.2 or later is installed.
  StrCpy $R0 "0"

  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" "Release"
  IfErrors 0 check_dotnet_release

  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\NET Framework Setup\NDP\v4\Full" "Release"
  IfErrors dotnet_detect_done 0

check_dotnet_release:
  IntCmpU $0 ${DOTNET462_RELEASE} dotnet_found dotnet_detect_done dotnet_found

dotnet_found:
  StrCpy $R0 "1"

dotnet_detect_done:
FunctionEnd

Function DetectWebView2Runtime
  ; Returns "1" in $R0 when WebView2 Runtime is already usable.
  StrCpy $R0 "0"
  IfFileExists "$PROGRAMFILES\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe" webview2_found_file 0
  IfFileExists "$LOCALAPPDATA\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe" webview2_found_file 0

  nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$guid = \"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}\"; $$regRoots = @(\"HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\", \"HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\", \"HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\", \"HKCU:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\"); foreach ($$root in $$regRoots) { $$item = Get-ItemProperty -Path (Join-Path $$root $$guid) -ErrorAction SilentlyContinue; if ($$item.pv -and $$item.location) { $$path = Join-Path (Join-Path $$item.location $$item.pv) \"msedgewebview2.exe\"; if (Test-Path $$path) { exit 0 } } }; exit 1"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $R0 "1"
    DetailPrint "WebView2 检测: 注册表路径指向的运行时文件存在"
  ${Else}
    DetailPrint "WebView2 检测: 常见路径和注册表路径均未发现运行时文件 (exit code: $0)"
  ${EndIf}
  Goto webview2_detect_done

webview2_found_file:
  StrCpy $R0 "1"
  DetailPrint "WebView2 检测: 常见安装路径中已发现运行时文件"

webview2_detect_done:
FunctionEnd

Function DetectVcRedistX64Runtime
  ; Returns "1" in $R0 when VC++ 2015-2022 x64 Runtime is registered and key DLLs exist.
  StrCpy $R0 "0"
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" vc_detect_sysnative vc_detect_system32

vc_detect_sysnative:
  nsExec::ExecToStack '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$paths = @(\"HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64\", \"HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64\", \"HKCU:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64\", \"HKCU:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64\"); $$dlls = @(\"vcruntime140.dll\", \"vcruntime140_1.dll\", \"msvcp140.dll\", \"msvcp140_1.dll\", \"msvcp140_2.dll\", \"concrt140.dll\", \"vcomp140.dll\"); $$dllRoot = Join-Path $$env:WINDIR \"System32\"; $$hasDlls = $$true; foreach ($$dll in $$dlls) { if (-not (Test-Path (Join-Path $$dllRoot $$dll))) { $$hasDlls = $$false; break } }; if (-not $$hasDlls) { exit 1 }; foreach ($$path in $$paths) { $$item = Get-ItemProperty -Path $$path -ErrorAction SilentlyContinue; if ($$item.Installed -eq 1) { exit 0 } }; exit 1"'
  Goto vc_detect_result

vc_detect_system32:
  nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$paths = @(\"HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64\", \"HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64\", \"HKCU:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64\", \"HKCU:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64\"); $$dlls = @(\"vcruntime140.dll\", \"vcruntime140_1.dll\", \"msvcp140.dll\", \"msvcp140_1.dll\", \"msvcp140_2.dll\", \"concrt140.dll\", \"vcomp140.dll\"); $$dllRoot = Join-Path $$env:WINDIR \"System32\"; $$hasDlls = $$true; foreach ($$dll in $$dlls) { if (-not (Test-Path (Join-Path $$dllRoot $$dll))) { $$hasDlls = $$false; break } }; if (-not $$hasDlls) { exit 1 }; foreach ($$path in $$paths) { $$item = Get-ItemProperty -Path $$path -ErrorAction SilentlyContinue; if ($$item.Installed -eq 1) { exit 0 } }; exit 1"'

vc_detect_result:
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $R0 "1"
  ${EndIf}
FunctionEnd

Section "Install"
  DetailPrint "正在准备安装环境..."
  StrCpy $INSTDIR $SelectedInstallDir
  Call EnsureX64Windows

  DetailPrint "正在检查 .NET Framework 运行时..."
  Call DetectDotNet462Runtime
  ${If} $R0 != "1"
    MessageBox MB_OK|MB_ICONSTOP "当前系统缺少 .NET Framework 4.6.2 或更高版本，无法运行 ${APP_NAME} 桌面启动器。$\r$\n$\r$\n请先安装 Microsoft .NET Framework 4.8 后重新运行安装包。"
    Abort
  ${EndIf}

  ; If processes were detected in .onInit, close them now
  ${If} $DetectedRunningProcesses == "1"
    DetailPrint "正在关闭正在运行的 OfficeClaw 进程..."
    Call CloseRunningServices
  ${EndIf}

  CreateDirectory "$INSTDIR"
  Call CleanupManagedPayload
  DetailPrint "安装环境就绪..."

  ; Extract 7za.exe first (independent of payload)
  DetailPrint "正在准备解压工具..."
  CreateDirectory "$INSTDIR\tools"
  SetOutPath "$INSTDIR\tools"
  File "${SEVENZIP_EXE}"

  ; Extract payload.7z and unpack via 7za.exe
  DetailPrint "正在释放安装包..."
  SetOutPath "$INSTDIR"
  File "${PAYLOAD_7Z}"

  DetailPrint "正在解压安装文件，请耐心等待..."
  nsExec::ExecToLog '"$INSTDIR\tools\7za.exe" x "$INSTDIR\payload.7z" -o"$INSTDIR" -aoa -mmt=on'
  Pop $0
  ${If} $0 != 0
    DetailPrint "警告: 7za 解压返回错误码 $0"
  ${Else}
    DetailPrint "安装文件解压完成"
  ${EndIf}

  Delete "$INSTDIR\payload.7z"

  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\logs"
  CreateDirectory "$INSTDIR\.office-claw"

  ; Create .env from .env.example if .env doesn't exist
  IfFileExists "$INSTDIR\.env" env_already_exists 0
    IfFileExists "$INSTDIR\.env.example" copy_env_example 0
      DetailPrint "错误: .env.example 文件未找到，无法创建 .env"
      Goto env_done
    copy_env_example:
      ; Try cmd copy first (more reliable with logging)
      nsExec::ExecToStack 'cmd /c copy /Y "$INSTDIR\.env.example" "$INSTDIR\.env" >nul 2>&1'
      Pop $0
      Pop $1
      IfFileExists "$INSTDIR\.env" env_copy_success 0
        ; Fallback 1: NSIS CopyFiles without /SILENT to see errors
        ClearErrors
        CopyFiles "$INSTDIR\.env.example" "$INSTDIR\.env"
        IfErrors 0 env_copy_success
          ; Fallback 2: PowerShell Copy-Item
          nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Copy-Item -Path \"$INSTDIR\.env.example\" -Destination \"$INSTDIR\.env\" -Force" 2>$$null'
          Pop $1
          Pop $2
          IfFileExists "$INSTDIR\.env" env_copy_success 0
            DetailPrint "错误: .env 文件创建失败"
            Goto env_done
    env_copy_success:
      DetailPrint ".env 配置文件写入成功"
      Goto env_done
  env_already_exists:
    DetailPrint ".env 配置文件已存在，跳过写入"
  env_done:

  IfFileExists "$INSTDIR\office-claw-config.json" config_already_exists 0
    IfFileExists "$INSTDIR\installer-seed\office-claw-config.json" config_source_exists config_source_missing
    config_source_exists:
      CopyFiles /SILENT "$INSTDIR\installer-seed\office-claw-config.json" "$INSTDIR\office-claw-config.json"
      IfFileExists "$INSTDIR\office-claw-config.json" config_copy_success config_copy_failed
    config_copy_success:
      DetailPrint "office-claw-config.json 写入成功"
      Goto config_done
    config_copy_failed:
      DetailPrint "警告: office-claw-config.json 复制失败"
      Goto config_done
    config_source_missing:
      DetailPrint "提示: installer-seed/office-claw-config.json 不存在，跳过"
      Goto config_done
  config_already_exists:
    DetailPrint "office-claw-config.json 已存在，跳过写入"
  config_done:

  ; 检查并按需修复安装 WebView2 运行时
  DetailPrint "正在检查 WebView2 运行时..."
  Call DetectWebView2Runtime
  ${If} $R0 == "1"
    DetailPrint "WebView2 运行时已就绪，跳过安装"
    Goto webview2_done
  ${EndIf}

  DetailPrint "未检测到可用 WebView2 运行时，执行修复安装..."
  ; 使用管理员权限安装 WebView2
  IfFileExists "$INSTDIR\tools\webview2\MicrosoftEdgeWebview2Setup.exe" webview2_install webview2_missing

webview2_install:
  ExecWait '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$p = Start-Process -FilePath \"$INSTDIR\tools\webview2\MicrosoftEdgeWebview2Setup.exe\" -ArgumentList \"/silent /install\" -Verb RunAs -Wait -PassThru; exit $$p.ExitCode"' $0
  ${If} $0 == 0
    DetailPrint "WebView2 运行时安装成功"
    DetailPrint "正在复检 WebView2 运行时..."
    Call DetectWebView2Runtime
    ${If} $R0 == "1"
      DetailPrint "WebView2 运行时复检通过"
    ${Else}
      DetailPrint "警告: WebView2 运行时安装后复检失败，桌面启动器可能无法使用"
    ${EndIf}
  ${Else}
    DetailPrint "警告: WebView2 安装未完成 (exit code: $0)，桌面启动器可能无法使用"
  ${EndIf}
  Goto webview2_done

webview2_missing:
  DetailPrint "警告: WebView2 安装程序未找到，跳过安装"
  Goto webview2_done

webview2_done:

  ; 检查并安装 VC++ 运行时库 (2015-2022 x64)
  DetailPrint "正在检查 VC++ 运行时库..."
  Call DetectVcRedistX64Runtime
  ${If} $R0 == "1"
    DetailPrint "VC++ x64 运行时已就绪，跳过安装"
    Goto vc_done
  ${EndIf}

  ; 未安装，执行静默安装
  DetailPrint "未检测到可用 VC++ x64 运行时，执行修复安装..."
  IfFileExists "$INSTDIR\tools\vc-redist\vc_redist.x64.exe" vc_install vc_missing

vc_install:
  ; 使用管理员权限安装 VC++，/quiet 静默安装, /norestart 不重启
  ExecWait '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$p = Start-Process -FilePath \"$INSTDIR\tools\vc-redist\vc_redist.x64.exe\" -ArgumentList \"/quiet /norestart\" -Verb RunAs -Wait -PassThru; exit $$p.ExitCode"' $2
  ${If} $2 == 0
    DetailPrint "VC++ 运行时库安装成功"
    DetailPrint "正在复检 VC++ x64 运行时..."
    Call DetectVcRedistX64Runtime
    ${If} $R0 == "1"
      DetailPrint "VC++ x64 运行时复检通过"
    ${Else}
      DetailPrint "警告: VC++ x64 运行时安装后复检失败"
    ${EndIf}
  ${ElseIf} $2 == 3010
    DetailPrint "VC++ 运行时库安装成功，系统提示需要重启后完全生效"
    SetRebootFlag true
    DetailPrint "正在复检 VC++ x64 运行时..."
    Call DetectVcRedistX64Runtime
    ${If} $R0 == "1"
      DetailPrint "VC++ x64 运行时复检通过"
    ${Else}
      DetailPrint "VC++ x64 运行时复检未通过，系统重启后可能完成生效"
    ${EndIf}
  ${Else}
    DetailPrint "警告: VC++ 运行时库安装失败 (错误码: $2)"
  ${EndIf}
  Goto vc_done

vc_missing:
  DetailPrint "警告: VC++ 安装程序未找到，跳过安装"
  Goto vc_done

vc_done:

  ; Run post-install configuration only for fresh installs.
  ; On overwrite installs, preserve an existing runtime catalog so user-created agents survive.
  IfFileExists "$INSTDIR\.office-claw\office-claw-catalog.json" init_config_skip 0
  DetailPrint "正在初始化配置..."
  nsExec::ExecToLog '"$INSTDIR\tools\node\node.exe" "$INSTDIR\scripts\install-auth-config.mjs" modelarts-preset apply --project-dir "$INSTDIR"'
  Pop $0
  Goto init_config_done
init_config_skip:
  DetailPrint "检测到现有运行时 catalog，跳过初始化配置以保留用户自定义 agent..."
init_config_done:

  WriteUninstaller "$INSTDIR\uninstall.exe"
  Call WriteShellShortcuts
  Call WriteAutoStartRegistry
  Call WriteActivationProtocolRegistry
  Call WriteUninstallRegistry
SectionEnd

Var RemoveUserData

Section "Uninstall"
  DetailPrint "正在停止 OfficeClaw 及相关进程..."
  Call un.CloseRunningServices

  Delete "${STARTMENU_DIR}\${APP_NAME}.lnk"
  Delete "${STARTMENU_DIR}\Uninstall ${APP_NAME}.lnk"
  RMDir "${STARTMENU_DIR}"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegKey HKCU "Software\Classes\${ACTIVATION_PROTOCOL}"
  DeleteRegValue HKCU "${AUTOSTART_KEY}" "${AUTOSTART_VALUE}"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${INSTALL_KEY}"
  DeleteRegKey /ifempty HKCU "Software\${COMPANY_KEY}"

  ; Skip firewall rule cleanup: user-level installs do not create the rule.

  ; Ask user whether to remove user data
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除所有用户数据？$\r$\n$\r$\n选择「是」将删除：$\r$\n  · 整个安装目录（含配置、数据库、日志、上传文件、工作区）$\r$\n  · 全局配置目录（$PROFILE\.office-claw）$\r$\n$\r$\n选择「否」将仅删除程序文件，保留：$\r$\n  · 用户配置（.env、office-claw-config.json）$\r$\n  · 运行时数据（.office-claw、data、logs、workspace）$\r$\n  · 全局配置目录（$PROFILE\.office-claw）" IDYES +3
    StrCpy $RemoveUserData "0"
    Goto +2
    StrCpy $RemoveUserData "1"

  ; Remove entire install dir via cmd rd for speed
  Delete "$INSTDIR\uninstall.exe"
  ${If} $RemoveUserData == "1"
    ; Remove install dir (includes .office-claw, data, logs, SQLite files)
    nsExec::ExecToLog 'cmd /c rd /s /q "$INSTDIR"'
    Pop $0
    ; Remove global user profiles (~/.office-claw) — provider keys, model profiles, project roots
    nsExec::ExecToLog 'cmd /c rd /s /q "$PROFILE\.office-claw"'
    Pop $0
  ${Else}
    Call un.CleanupManagedPayload
    RMDir "$INSTDIR"
  ${EndIf}
SectionEnd
