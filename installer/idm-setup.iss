; ---------------------------------------------------------------------------
;  JDM (Jonathan Download Manager) — Windows installer (Inno Setup 6)
;  Per-user install, no admin required.
;
;  Build:  iscc installer\idm-setup.iss /DAppVer=1.0.0
;  Output: dist\idm-setup-1.0.0.exe
;
;  NO EMOJI in any string in this file (per project rule).
; ---------------------------------------------------------------------------

#ifndef AppVer
  #define AppVer "1.0.0"
#endif
#define AppName "JDM"
#define AppPublisher "JDM"
#define AppExe "idm-helper.exe"

[Setup]
AppId={{8E2B7C41-5C3A-4E7B-9F21-2D6A0B7C9E14}
AppName={#AppName}
AppVersion={#AppVer}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\IDM
DisableDirPage=no
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=idm-setup-{#AppVer}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName} Helper
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
; No admin, no reboot.
RestartIfNeededByRun=no

[Languages]
Name: "az"; MessagesFile: "compiler:Default.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Files]
; Frozen helper: single self-contained exe (PyInstaller onefile).
Source: "..\dist\idm-helper.exe"; DestDir: "{app}\helper"; Flags: ignoreversion
; External tools (aria2c/ffmpeg/ffprobe/yt-dlp/deno) placed in bin\ by build-exe.bat.
Source: "..\bin\*"; DestDir: "{app}\bin"; Flags: recursesubdirs createallsubdirs ignoreversion skipifsourcedoesntexist
; Extension folder as-is (stable "Load unpacked" path)
Source: "..\extension\*"; DestDir: "{app}\extension"; Flags: recursesubdirs createallsubdirs ignoreversion
; Bundled MPV lua + fonts (manual MPV use)
Source: "..\helper\mpv_substyle.lua"; DestDir: "{app}\mpv"; Flags: ignoreversion
Source: "..\helper\fonts\*.ttf"; DestDir: "{app}\mpv\fonts"; Flags: ignoreversion skipifsourcedoesntexist

[Registry]
; Autostart for the current user only.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "IDM Helper"; ValueData: """{app}\helper\{#AppExe}"" --hidden"; Flags: uninsdeletevalue

[Run]
; Start the helper once after install (no reboot needed).
Filename: "{app}\helper\{#AppExe}"; Parameters: "--hidden"; Flags: nowait postinstall skipifsilent runhidden

[UninstallRun]
; Stop the running helper before removing files.
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#AppExe}"; Flags: runhidden skipifdoesntexist; RunOnceId: "StopHelper"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\helper"
Type: filesandordirs; Name: "{app}\bin"
Type: filesandordirs; Name: "{app}\extension"
Type: filesandordirs; Name: "{app}\mpv"
Type: filesandordirs; Name: "{app}\config"
; {app} itself ({localappdata}\IDM) is removed by uninstall if empty; force it.
Type: dirifempty; Name: "{app}"

[Code]
var
  FinalPage: TOutputMsgWizardPage;
  OpenFolderCheck: TNewCheckBox;
  ErrorCode: Integer;

function FinalText(): String;
begin
  { {app} may only be expanded after the install folder is chosen. }
  Result :=
    '1) Open brave://extensions  (or chrome://extensions, edge://extensions)' + #13#10 +
    '2) Enable "Developer mode"' + #13#10 +
    '3) Click "Load unpacked"' + #13#10 +
    '4) Select this folder:' + #13#10 +
    '   ' + ExpandConstant('{app}\extension') + #13#10 + #13#10 +
    'Azerbaycan dili:' + #13#10 +
    '1) brave://extensions unvanini acin' + #13#10 +
    '2) "Developer mode" rejimini aktiv edin' + #13#10 +
    '3) "Load unpacked" duymesine basin' + #13#10 +
    '4) Bu qovluqu secin: ' + ExpandConstant('{app}\extension');
end;

procedure InitializeWizard();
begin
  { Final page: AZ + EN instructions, no emoji. Text is filled in later. }
  FinalPage := CreateOutputMsgPage(wpSelectTasks,
    'Son addim / Final step',
    'Genisdirmeni brauzere yukleyin / Load the extension in your browser',
    '');

  OpenFolderCheck := TNewCheckBox.Create(WizardForm);
  OpenFolderCheck.Parent := FinalPage.Surface;
  OpenFolderCheck.Left := 0;
  OpenFolderCheck.Top := FinalPage.Surface.Height - 40;
  OpenFolderCheck.Width := FinalPage.Surface.Width;
  OpenFolderCheck.Height := 20;
  OpenFolderCheck.Caption := 'Extensiya qovlugunu ac / Open extension folder';
  OpenFolderCheck.Checked := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = FinalPage.ID then
    FinalPage.MsgLabel.Caption := FinalText();
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and OpenFolderCheck.Checked then
  begin
    { Best effort: open the extension folder in Explorer. }
    ShellExec('open', 'explorer.exe', ExpandConstant('{app}\extension'), '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;
