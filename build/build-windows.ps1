# ===========================================================================
#  JDM Windows builder (PowerShell).
#  Called by ..\build-exe.bat. Produces dist\idm-setup-<AppVer>.exe
#
#  Steps:
#    1. Ensure Python 3 (winget -> fallback: official installer).
#    2. pip install requirements + pyinstaller.
#    3. Download + verify tools into bin\ (aria2c/ffmpeg/ffprobe/yt-dlp/deno).
#    4. PyInstaller ONEFILE build -> dist\idm-helper.exe
#    5. Ensure Inno Setup 6 (winget/choco -> fallback: official installer).
#    6. ISCC -> dist\idm-setup-<AppVer>.exe
#    7. Write dist\SHA256SUMS.txt
# ===========================================================================
param(
  [string]$AppVer = "1.0.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Info($m) { Write-Host "[*] $m" -ForegroundColor Cyan }
function Good($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[X] $m" -ForegroundColor Red; exit 1 }

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Find-Exe($names) {
  foreach ($n in $names) {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
  }
  return $null
}

# ---------------------------------------------------------------------------
# 1. Python
# ---------------------------------------------------------------------------
Info "Checking Python..."
$py = Find-Exe @("python","python3","py")
if (-not $py) {
  Info "Python not found. Installing via winget..."
  $winget = Find-Exe @("winget")
  if ($winget) {
    winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    $py = Find-Exe @("python","python3","py")
  }
}
if (-not $py) {
  Warn "winget path failed or winget absent. Downloading the official Python installer..."
  $tmp = Join-Path $env:TEMP "py-setup.exe"
  Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe" -OutFile $tmp
  Start-Process -FilePath $tmp -ArgumentList "/quiet","InstallAllUsers=0","PrependPath=1","Include_pip=1" -Wait
  Refresh-Path
  $py = Find-Exe @("python","python3","py")
}
if (-not $py) { Die "Python could not be installed automatically. Install Python 3.12 manually and re-run." }
Good "Python: $py"

# ---------------------------------------------------------------------------
# 2. pip packages
# ---------------------------------------------------------------------------
Info "Installing Python build requirements..."
& $py -m pip install --upgrade pip
& $py -m pip install -r "build\requirements.txt"
& $py -m pip install pyinstaller
if ($LASTEXITCODE -ne 0) { Die "pip install failed." }
Good "pip packages installed."

# ---------------------------------------------------------------------------
# 3. Tools (aria2c/ffmpeg/yt-dlp/deno)
# ---------------------------------------------------------------------------
Info "Downloading tools into bin\ ..."
$pinned = $true
try {
  $spec = Get-Content "build\tools.json" -Raw | ConvertFrom-Json
  foreach ($k in $spec.tools.PSObject.Properties.Name) {
    if ($spec.tools.$k.sha256 -eq "REPLACE_ME") { $pinned = $false }
  }
} catch { $pinned = $false }

if ($pinned) {
  & $py "build\download_tools.py"
} else {
  Warn "tools.json has REPLACE_ME hashes. Downloading WITHOUT verification (dev mode)."
  Warn "For a trusted release, fill the real sha256 values in build\tools.json."
  & $py "build\download_tools.py" --allow-unpinned
}
if ($LASTEXITCODE -ne 0) { Die "tool download failed." }
Good "Tools ready in bin\."

# ---------------------------------------------------------------------------
# 4. PyInstaller onefile
# ---------------------------------------------------------------------------
Info "Building idm-helper.exe (onefile)..."
if (Test-Path "dist\idm-helper.exe") { Remove-Item "dist\idm-helper.exe" -Force }
& $py -m PyInstaller "build\idm-helper.spec" --noconfirm --clean
if ($LASTEXITCODE -ne 0 -or -not (Test-Path "dist\idm-helper.exe")) { Die "PyInstaller build failed." }
Good "Built dist\idm-helper.exe"

Info "Helper self-check (--version)..."
try { & "dist\idm-helper.exe" --version } catch { Warn "helper --version did not return (ignored)." }

# ---------------------------------------------------------------------------
# 5. Inno Setup
# ---------------------------------------------------------------------------
Info "Checking Inno Setup..."
$iscc = Find-Exe @("iscc")
if (-not $iscc) {
  foreach ($p in @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
    if (Test-Path $p) { $iscc = $p; break }
  }
}
if (-not $iscc) {
  Info "Inno Setup not found. Installing via winget/choco..."
  $winget = Find-Exe @("winget")
  $choco  = Find-Exe @("choco")
  if ($winget) {
    winget install -e --id JRSoftware.InnoSetup --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
  } elseif ($choco) {
    choco install innosetup -y --no-progress
    Refresh-Path
  } else {
    Warn "Neither winget nor choco found. Downloading the Inno Setup installer..."
    $tmp = Join-Path $env:TEMP "innosetup.exe"
    Invoke-WebRequest -Uri "https://jrsoftware.org/download.php/is.exe" -OutFile $tmp
    Start-Process -FilePath $tmp -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART" -Wait
  }
  foreach ($p in @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
    if (Test-Path $p) { $iscc = $p; break }
  }
}
if (-not $iscc) { Die "Inno Setup could not be installed automatically. Install it manually and re-run." }
Good "ISCC: $iscc"

# ---------------------------------------------------------------------------
# 6. Build the single installer exe
# ---------------------------------------------------------------------------
Info "Building installer..."
if (-not (Test-Path "dist")) { New-Item -ItemType Directory "dist" | Out-Null }
& $iscc "installer\idm-setup.iss" "/DAppVer=$AppVer"
if ($LASTEXITCODE -ne 0) { Die "Inno Setup build failed." }
$out = "dist\idm-setup-$AppVer.exe"
if (-not (Test-Path $out)) { Die "Installer not produced: $out" }
Good "Installer: $out"

# ---------------------------------------------------------------------------
# 7. Checksum
# ---------------------------------------------------------------------------
$hash = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path $out -Leaf)" | Out-File -Encoding ascii "dist\SHA256SUMS.txt"
Good "SHA256: $hash"
Write-Host ""
Good "All done. Double-click $out to install."
