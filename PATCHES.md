# PATCHES — exact diffs vs the Linux tree (for approval)

Source (unchanged): `/home/x/İndirilenler/idm-linux-v3/`

## A. extension/background.js  (song-align gate only)

Exactly two hunks. No other extension file is modified.

### Hunk 1 (after `const HELPER = ...`)

```diff
 const HELPER = "http://127.0.0.1:6811";
+// Helper imkanları (platforma xüsusiyyətləri). Windows-da mahnı vaxtlandırma (MMS/CTC) dəstəklənmir.
+let _helperCaps = { t: 0, songAlign: true };
+async function helperCaps() {
+  if (Date.now() - _helperCaps.t < 60000) return _helperCaps;
+  try {
+    const h = await fetch(HELPER + "/health", { signal: AbortSignal.timeout(8000) }).then(r => r.json());
+    _helperCaps = { t: Date.now(), songAlign: h.songAlign !== false };
+  } catch { _helperCaps = { t: Date.now(), songAlign: true }; }
+  return _helperCaps;
+}
 const DEFAULTS = { enabled: true, intercept: true, overlay: true, subs: true, feedMode: true, vstreams: 0, astreams: 0,
```

### Hunk 2 (in `aiSubtitleDownload`, Azerbaijani-song branch)

```diff
             if (!localCues) {
-              localCues = await alignAzSong({ url: msg.pageUrl || tab?.url || "", song, lyrics: song.lyrics, mediaTitle, id });
+              // Windows-da yerli MMS/CTC yoxdur: bu addımı atlayırıq (Gemini audio yolu onsuz da var).
+              const caps = await helperCaps();
+              localCues = caps.songAlign
+                ? await alignAzSong({ url: msg.pageUrl || tab?.url || "", song, lyrics: song.lyrics, mediaTitle, id })
+                : [];
               if (localCues.length >= 3) {
```

There is no separate visible "song align" button in the current UI; the local
MMS/CTC timing is auto-invoked inside AI subtitle generation. This gate is the
minimal way to disable it on Windows while keeping the existing Gemini-audio
fallback. If you prefer a real button instead, say so and I will add one.

## B. helper/helper.py  (Windows port — guarded by `if IS_WIN`)

Linux behaviour is unchanged; every Windows branch is additive.

1. Top shim: `IS_WIN`, `APP_DIR`, Windows-aware `_extra_path()`, global
   `subprocess.Popen` no-window wrapper, `_kill_tree()`.
2. Paths: `DL_DIR` = `%USERPROFILE%\Downloads`, `CONF` = `%LOCALAPPDATA%\IDM\config`.
3. `open_path()`: Windows uses `explorer /select,` and `os.startfile`.
4. All `os.killpg(...)` calls routed through `_kill_tree`.
5. `migrate_legacy_config()`: no-op on Windows.
6. Font discovery: enumerate `C:\Windows\Fonts`; skip `fc-list/fc-cache/fc-match`.
7. `_deploy_mpv_lua()`: no-op on Windows (MPV not integrated).
8. `_aes128_cbc_decrypt()`: openssl on Linux, pure-Python AES-128-CBC on Windows
   (verified against the NIST SP800-38A vector).
9. `/health` + `/ping`: add `"platform"` and `"songAlign"` (false on Windows).
10. `/songalign`: raises "unsupported on Windows" (the extension gate above skips it).
11. `--doctor` and `--version` CLI for `idm-helper.exe`.

## C. Everything else

Installer, CI, README, spec, tools downloader are new files (no diffs).
