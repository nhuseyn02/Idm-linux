# JDM for Windows

JDM is a video/audio download manager. On Windows it is two pieces:

- a browser extension (Brave / Chrome / Edge) that finds media and shows
  download options, and
- a background helper (`idm-helper.exe`) that does the actual downloading with
  bundled `aria2c`, `yt-dlp` and `ffmpeg`.

The helper listens only on `127.0.0.1:6811` and is reachable only from this PC.

## Build the installer yourself (one click, no GitHub)

You do **not** need GitHub. On any Windows machine:

1. Double-click **`build-exe.bat`** (or run it from a terminal).
2. Wait. It installs everything it needs by itself:
   - Python 3 (winget, or the official installer as fallback),
   - `psutil` + PyInstaller (pip),
   - `aria2c`, `ffmpeg`/`ffprobe`, `yt-dlp`, `deno` into `bin\`,
   - Inno Setup 6 (winget/choco, or the official installer as fallback).
3. When it finishes you get **`dist\idm-setup-1.0.0.exe`** plus
   `dist\SHA256SUMS.txt`.

That single `dist\idm-setup-1.0.0.exe` is the finished product: it bundles the
frozen helper, all tools, and the extension folder, and installs itself with no
Python and no admin rights.

Notes:
- The builder downloads tools with `--allow-unpinned` until you fill the real
  sha256 values in `build\tools.json`; fill them for a trusted release.
- To pass a version: `build-exe.bat 1.2.0`.

## Install (4 steps)

1. Run `idm-setup-<ver>.exe`. It installs per-user to
   `%LOCALAPPDATA%\IDM` and does **not** require administrator rights.
2. When Windows SmartScreen appears: click **More info**, then **Run anyway**
   (see the note below).
3. In the last wizard page, follow the shown steps: open
   `brave://extensions` (or `chrome://extensions`, `edge://extensions`),
   enable **Developer mode**, click **Load unpacked**, and select
   `%LOCALAPPDATA%\IDM\extension`.
4. Click the JDM icon in the browser. If the indicator is green, the helper is
   running and you are ready to download.

Installed layout:

```
%LOCALAPPDATA%\IDM\
  helper\idm-helper.exe      (frozen helper, runs hidden)
  bin\aria2c.exe ffmpeg.exe ffprobe.exe yt-dlp.exe deno.exe
  extension\                 (load this folder as an unpacked extension)
  config\                    (settings; created on first run)
```

Downloads are written to `%USERPROFILE%\Downloads` by default. To change the
folder, set the `JDM_DIR` environment variable (or `IDM_DIR`).

## SmartScreen note

The installer is **unsigned**, so Windows SmartScreen may warn you. To continue:
**More info -> Run anyway**. This is expected for unsigned software.

A free option for removing the warning is [SignPath Foundation]
(https://signpath.org/) which provides code-signing certificates to open-source
projects. Once the project is accepted, wire the signing step into
`.github/workflows/windows-build.yml` (sign `idm-helper.exe` after PyInstaller
and `idm-setup-<ver>.exe` after Inno Setup).

## Uninstall

Settings -> Apps -> **JDM Helper** -> Uninstall, or use
`Uninstall JDM Helper` in the Start menu. The uninstaller stops the running
helper, removes the files under `%LOCALAPPDATA%\IDM`, and removes the
`HKCU\...\Run\IDM Helper` autostart entry.

## Diagnostics

If something does not work, run the doctor:

```
"%LOCALAPPDATA%\IDM\helper\idm-helper.exe" --doctor
```

It checks Python, `aria2c`, `ffmpeg`, `ffprobe`, `yt-dlp`, `deno`/`node`, the
download and config folders, whether port 6811 is free, and whether local song
timing is available. Version: `idm-helper.exe --version`.

## Not supported on Windows

- **Song lyric timing (MMS/CTC).** The local alignment model is Linux-only. On
  Windows the extension skips it and uses the Gemini audio path instead.
- **Firefox.** Only Chromium-based browsers (Brave, Chrome, Edge) are supported.
- **MPV integration.** The `mpv_substyle.lua` script is shipped under
  `%LOCALAPPDATA%\IDM\mpv` for manual MPV use, but JDM does not configure MPV.

## Troubleshooting

- **Red indicator / helper not running:** re-run the installer, or start
  `%LOCALAPPDATA%\IDM\helper\idm-helper.exe`. Verify autostart in
  `Task Manager -> Startup` ("IDM Helper").
- **"aria2c/ffmpeg yoxdur" warning:** the `bin\` folder is missing files. Re-run
  the installer (CI downloads and verifies them).
- **YouTube qualities missing:** make sure `deno.exe` (or `node`) is present in
  `bin\` and that `yt-dlp.exe` is current.
- **No console windows should ever flash.** If one does, please report it.
