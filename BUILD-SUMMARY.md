# JDM Windows port — build summary

Work area: `/home/x/Müvəqqəti/jdm-windows/`
Source tree (untouched): `/home/x/İndirilenler/idm-linux-v3/`

## Files added (all new; nothing in the Linux tree was modified)

Production:
- `helper/helper.py`                 — copied + Windows shim (see PATCHES.md section B)
- `helper/song_align.py`             — copied unchanged (not bundled)
- `helper/fonts/BabelStoneFlags.ttf` — copied unchanged
- `helper/mpv_substyle.lua`          — copied unchanged
- `extension/` (20 files)            — copied; ONE file changed: `extension/background.js`
- `bin/README.txt`                   — placeholder for CI-downloaded tools

Build:
- `build/requirements.txt`
- `build/tools.json`
- `build/download_tools.py`
- `build/idm-helper.spec`

Installer / CI / docs:
- `installer/idm-setup.iss`
- `.github/workflows/windows-build.yml`
- `README-WINDOWS.md`
- `PATCHES.md`
- `PLAN.md`

## Extension diff (only file changed)

`extension/background.js` — 2 hunks, song-align gate only (full text in PATCHES.md).
No other extension file differs from the Linux tree (verified with `cmp`).

## Local checks performed here (Linux only)

- `helper/helper.py`: `py_compile` OK; module imports OK; Linux paths unchanged.
- `_aes128_cbc_decrypt_py`: verified against NIST SP800-38A AES-128-CBC vector.
- `--doctor` runs and prints a report.
- All extension `*.js`: `node --check` OK.
- `build/download_tools.py`: parses; `build/tools.json`: valid JSON.
- Workflow YAML: basic structure present (v* tag, windows-latest).

## NOT VERIFIED (could not be tested from this Linux environment)

1. PyInstaller onedir build on Windows (spec correctness, `--noconsole`, datas).
2. Inno Setup compilation (`iscc`) and wizard code (`Code` section).
3. `download_tools.py` against the real URLs (real sha256 values are `REPLACE_ME`).
4. Helper on Windows: `%LOCALAPPDATA%` paths, `explorer /select,`, `os.startfile`.
5. `_kill_tree` via `taskkill /F /T` on real child processes.
6. No-window behaviour of `Popen` wrapper (no console flashes).
7. `/songalign` returning unsupported on Windows + extension gate end-to-end.
8. Font enumeration from `C:\Windows\Fonts`.
9. Registry Run key, autostart, and full uninstall cleanliness.
10. aria2c/ffmpeg/yt-dlp/deno actually running from the frozen helper's PATH.
11. The AES-128-CBC fallback inside a real Windows HLS decrypt (only the crypto
    primitive was verified, not the surrounding network path).
12. GitHub Actions workflow on windows-latest.
13. The extension in a real Chromium browser on Windows.

## Manual checklist to run on a real Windows machine

Do these on a clean Windows VM **without admin rights**:

1. Run `idm-setup-<ver>.exe`; confirm it installs to `%LOCALAPPDATA%\IDM` and
   never asks for elevation.
2. Confirm the final wizard page shows the AZ + EN steps and the
   "Open extension folder" checkbox; tick it and confirm Explorer opens
   `...\IDM\extension`.
3. Load the extension: `brave://extensions` (or chrome/edge) -> Developer mode ->
   Load unpacked -> `%LOCALAPPDATA%\IDM\extension`.
4. Click the JDM icon: indicator is green and the popup connects to
   `127.0.0.1:6811` (no "helper not running" warning).
5. Start a real download; verify it completes and lands in `%USERPROFILE%\Downloads`.
6. Pause / resume / cancel a download; each behaves correctly.
7. Open a YouTube video; verify 4K/HDR/60fps formats appear in the quality list.
8. Watch for console windows: none should flash during any download or during
   YouTube probing.
9. Reboot; confirm the helper autostarts (Task Manager -> Startup shows
   "IDM Helper", indicator is green without launching it manually).
10. Uninstall via Settings -> Apps; confirm:
    - the helper process is stopped,
    - `%LOCALAPPDATA%\IDM` is gone,
    - `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` has no "IDM Helper".
11. Inspect the UI text for emoji boxes (tofu). There should be none in the
    installer; report any found in the extension UI.
12. Run `"%LOCALAPPDATA%\IDM\helper\idm-helper.exe" --doctor` and confirm the
    report (aria2c/ffmpeg/ffprobe/yt-dlp/deno all `[OK]`, port free).
