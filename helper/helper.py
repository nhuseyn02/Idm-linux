#!/usr/bin/env python3
"""JDM helper: aria2 (birbaşa fayllar) + yt-dlp (HLS/DASH/YouTube).
Yalnız 127.0.0.1:6811 üzərində dinləyir, yalnız brauzer eklentisinə cavab verir."""
import base64, collections, hashlib, html as html_module, unicodedata, concurrent.futures, glob, json, random, os, re, secrets, shutil, signal, subprocess, sys, tempfile, threading, time
import urllib.error, urllib.parse, urllib.request
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

IS_WIN = os.name == "nt"

# Windows-da hər ffmpeg/aria2c/yt-dlp alt prosesi üçün konsol pəncərəsi açılmasın.
# Popen/run çağırışlarına toxunmadan qlobal olaraq CREATE_NO_WINDOW bayrağını birləşdiririk.
if IS_WIN:
    _CNW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    _orig_popen_init = subprocess.Popen.__init__
    def _popen_init(self, *args, **kw):
        kw["creationflags"] = kw.get("creationflags", 0) | _CNW
        return _orig_popen_init(self, *args, **kw)
    subprocess.Popen.__init__ = _popen_init
APP_DIR = Path(os.environ.get("IDM_APP_DIR") or (Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "IDM")) if IS_WIN else None

def _extra_path():
    h = Path.home()
    if IS_WIN:
        d = [str(Path(sys.executable).resolve().parent)]
        try: d.append(str(Path(sys._MEIPASS)))          # PyInstaller onedir (frozen exe)
        except Exception: pass
        if APP_DIR is not None:
            d += [str(APP_DIR / "bin"), str(APP_DIR / "helper")]
        la = os.environ.get("LOCALAPPDATA", "")
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pfx = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        if la: d.append(str(Path(la) / "Programs" / "yt-dlp"))
        d += [pf + r"\aria2", pfx + r"\aria2", pf + r"\ffmpeg\bin"]
        return d
    d = [h / ".local" / "bin", "/usr/local/bin", "/usr/bin", "/snap/bin", h / ".deno" / "bin", h / ".bun" / "bin",
         h / ".volta" / "bin", "/home/linuxbrew/.linuxbrew/bin"]
    # systemd --user servisində shell PATH-i yoxdur: nvm ilə qurulmuş node-u da axtar
    d += sorted(glob.glob(str(h / ".nvm" / "versions" / "node" / "*" / "bin")), reverse=True)
    return [str(x) for x in d]

os.environ["PATH"] = os.pathsep.join([os.environ.get("PATH", "")] + _extra_path())

def _no_window_kwargs():
    """Windows-da köməkçi proseslər (ffmpeg/aria2c/yt-dlp) üçün konsol pəncərəsi açmasın."""
    if not IS_WIN: return {}
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)}

def _kill_tree(proc, sig=signal.SIGTERM):
    """Bütün proses ağacını dayandırır. Windows: taskkill /T; Linux: killpg (əvvəlki davranış)."""
    if proc is None: return
    try:
        if IS_WIN:
            if proc.poll() is None:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **_no_window_kwargs())
        else:
            os.killpg(os.getpgid(proc.pid), sig)
    except Exception:
        try: proc.terminate()
        except Exception: pass

PORT = 6811
ARIA_PORT = 6810
ARIA_URL = f"http://127.0.0.1:{ARIA_PORT}/jsonrpc"
if IS_WIN:
    _def_dl = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Downloads"
    DL_DIR = Path(os.environ.get("JDM_DIR") or os.environ.get("IDM_DIR") or _def_dl)
    CONF = APP_DIR / "config"
else:
    DL_DIR = Path(os.environ.get("JDM_DIR") or os.environ.get("IDM_DIR") or Path.home() / "Downloads")
    CONF = Path.home() / ".config" / "jdm"
SUB_EXT = (".vtt", ".srt", ".ttml", ".json3", ".srv1", ".srv2", ".srv3", ".ass", ".lrc")

def migrate_legacy_config():
    """Köhnə IDM konfiqini JDM-ə köçür (silmeden, yalnız çatışmayanları)."""
    if IS_WIN:
        return   # köhnə Linux konfiqləri Windows-da yoxdur
    try:
        CONF.mkdir(parents=True, exist_ok=True)
        for old in (Path.home() / ".config" / "idm-linux",
                    Path.home() / ".config" / "idm-linux-v3"):
            if not old.exists(): continue
            for src in old.iterdir():
                if not src.is_file(): continue
                dst = CONF / src.name
                if dst.exists(): continue
                try: shutil.copy2(src, dst)
                except Exception: pass
        old_timed = Path.home() / ".config" / "idm-linux-v3" / "timed"
        new_timed = CONF / "timed"
        if old_timed.is_dir() and not new_timed.exists():
            try: shutil.copytree(old_timed, new_timed)
            except Exception: pass
        old_mpv = Path.home() / ".config" / "mpv" / "idm-substyle"
        new_mpv = Path.home() / ".config" / "mpv" / "jdm-substyle"
        if old_mpv.exists() and not new_mpv.exists():
            try: shutil.copy2(old_mpv, new_mpv)
            except Exception: pass
        # Köhnə Lua skripti yeni ilə eyni vaxtda işləməsin (silinmir, .disabled edilir).
        old_lua = Path.home() / ".config" / "mpv" / "scripts" / "idm_substyle.lua"
        if old_lua.exists():
            try: old_lua.rename(old_lua.with_name("idm_substyle.lua.disabled"))
            except Exception: pass
    except Exception:
        pass

migrate_legacy_config()

def check_url(u):
    if not re.match(r"(?i)^(https?|ftp)://", u or ""):
        raise RuntimeError("Dəstəklənməyən link")

def _safe_open(req, timeout=20, allow_local=False):
    """Alt yazı/sözlər üçün urlopen: redirect-lərin hər addımında check_url."""
    target = req.full_url if isinstance(req, urllib.request.Request) else str(req)
    check_url(target)
    class _R(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, rq, fp, code, msg, headers, newurl):
            check_url(newurl)
            return super().redirect_request(rq, fp, code, msg, headers, newurl)
    return urllib.request.build_opener(_R).open(req, timeout=timeout)

def load_secret():
    CONF.mkdir(parents=True, exist_ok=True)
    f = CONF / "aria2.secret"
    try:
        s = f.read_text().strip()
        if s: return s
    except OSError: pass
    s = secrets.token_hex(16)
    fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh: fh.write(s)
    return s

SECRET = load_secret()

def _call(method, params):
    data = json.dumps({"jsonrpc": "2.0", "id": "i", "method": method, "params": params}).encode()
    req = urllib.request.Request(ARIA_URL, data, {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            j = json.loads(r.read())
    except urllib.error.HTTPError as e:
        j = json.loads(e.read() or b"{}")
    if "error" in j:
        raise RuntimeError(j["error"].get("message", "aria2 xətası"))
    return j["result"]

def rpc(method, *params):
    return _call("aria2." + method, [f"token:{SECRET}", *params])

_aria_lock = threading.Lock()

def aria_up():
    try:
        rpc("getVersion")
        return True
    except Exception:
        return False

def ensure_aria():
    with _aria_lock:
        if aria_up(): return
        if not shutil.which("aria2c"):
            raise RuntimeError("aria2c quraşdırılmayıb (sudo apt install aria2)")
        try:
            _call("aria2.shutdown", [])
            for _ in range(30):
                time.sleep(0.1)
                try: _call("aria2.getVersion", [])
                except Exception: break
        except Exception: pass
        CONF.mkdir(parents=True, exist_ok=True)
        DL_DIR.mkdir(parents=True, exist_ok=True)
        sess = CONF / "aria2.session"
        sess.touch()
        subprocess.Popen([
            "aria2c", "--enable-rpc", f"--rpc-listen-port={ARIA_PORT}", "--rpc-listen-all=false",
            f"--rpc-secret={SECRET}", "--continue=false", "--max-concurrent-downloads=5", "-x16", "-s16", "-k1M", "--disk-cache=64M",
            "--file-allocation=none", "--auto-file-renaming=false", "--allow-overwrite=false", f"--dir={DL_DIR}",
            f"--input-file={sess}", f"--save-session={sess}", "--save-session-interval=5",
            "--console-log-level=warn", "--summary-interval=0",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(60):
            time.sleep(0.1)
            if aria_up(): return
        raise RuntimeError("aria2c başlamadı")

META = {}
KEYS = ["gid", "status", "totalLength", "completedLength", "downloadSpeed", "files", "errorMessage"]

def safe_name(n):
    n = re.sub(r"[\x00-\x1f/\\]", "_", n or "").strip().strip(".")
    # Fayl sistemi limiti 255 BAYT-dır, simvol deyil: kiril/ərəb hərfi 2-4 bayt tutur.
    # yt-dlp hədəf adına " [keyfiyyət] (N).mp4.ytdl" əlavə edir — ona görə 200 baytda dayanırıq.
    b = n.encode("utf-8", "ignore")
    return b[:200].decode("utf-8", "ignore").rstrip() if len(b) > 200 else n

def aria_items():
    if not shutil.which("aria2c"): return []
    try:
        lists = [rpc("tellActive", KEYS), rpc("tellWaiting", 0, 200, KEYS), list(reversed(rpc("tellStopped", 0, 200, KEYS)))]
    except Exception: return []
    out = []
    for lst in lists:
        for d in lst:
            if d["status"] == "removed": continue
            total, comp, speed = int(d["totalLength"]), int(d["completedLength"]), int(d["downloadSpeed"])
            f = (d.get("files") or [{}])[0]
            path = f.get("path") or ""
            name = os.path.basename(path)
            if not name:
                uris = f.get("uris") or []
                src = (uris[0]["uri"] if uris else META.get(d["gid"], {}).get("url", ""))
                name = urllib.parse.unquote(os.path.basename(urllib.parse.urlparse(src).path)) or "fayl"
            st = d["status"]
            prog = 100.0 if st == "complete" else (comp / total * 100 if total else 0.0)
            out.append({
                "id": d["gid"], "source": "aria2", "name": name, "status": st,
                "progress": round(prog, 1), "speed": speed, "size": total, "done": comp,
                "eta": ((total - comp) / speed) if (speed and total) else None,
                "error": d.get("errorMessage", "") if st == "error" else "", "phase": "", "path": path,
            })
    return out

def aria_add(b):
    check_url(b.get("url"))
    ensure_aria()
    for g, m in list(META.items()):  # eyni link artıq yüklənirsə təkrar əlavə etmə
        if m["url"] == b["url"]:
            try:
                if rpc("tellStatus", g, ["status"])["status"] in ("active", "waiting", "paused"): return g
            except Exception: META.pop(g, None)
    opts = {"dir": str(DL_DIR), "split": "16", "max-connection-per-server": "16",
            "min-split-size": "1M", "continue": "false", "auto-file-renaming": "false",
            "allow-overwrite": "false", "max-tries": "8", "retry-wait": "1"}   # ad konflikti: mövcud fayl silinmir
    n = clampint(b.get("streams"))
    if n: opts["split"] = opts["max-connection-per-server"] = str(n)
    if b.get("referer"): opts["referer"] = b["referer"]
    if b.get("userAgent"): opts["user-agent"] = b["userAgent"]
    hdr = []
    if b.get("cookie"): hdr.append("Cookie: " + str(b["cookie"]))
    drop = {"cookie", "host", "content-length", "content-type", "range", "referer", "user-agent", "connection", "accept-encoding"}
    for k, v in (b.get("headers") or {}).items():
        if not k or str(k).lower() in drop or v is None: continue
        hdr.append(f"{k}: {v}")
    if hdr: opts["header"] = hdr
    tgt = str(b.get("target") or "").strip()
    if tgt:
        if not os.path.isabs(tgt): tgt = os.path.join(str(DL_DIR), os.path.basename(tgt))
        opts["dir"] = os.path.dirname(tgt) or str(DL_DIR)
        opts["out"] = os.path.basename(tgt)
    else:
        fn = safe_name(b.get("filename")) or safe_name(nameFrom(b.get("url") or "")) or "download"
        opts["out"] = os.path.basename(unique_path(os.path.join(str(DL_DIR), fn)))
    gid = rpc("addUri", [b["url"]], opts)
    META[gid] = {"url": b["url"], "opts": opts}
    return gid

def aria_path(gid):
    try:
        st = rpc("tellStatus", gid, ["files"])
        return (st["files"][0]["path"]) if st.get("files") else ""
    except Exception: return ""

def aria_action(gid, a):
    if a == "pause": rpc("forcePause", gid)
    elif a == "resume": rpc("unpause", gid)
    elif a in ("remove", "delete"):
        path = aria_path(gid)
        st = rpc("tellStatus", gid, ["status"])["status"]
        if st in ("active", "waiting", "paused"): rpc("forceRemove", gid)
        try: rpc("removeDownloadResult", gid)
        except Exception: pass
        # remove: yalnız siyahıdan çıxar, fayla toxunma. delete: bütün faylı/qalıqları sil.
        if path and a == "delete":
            for p in (path, path + ".aria2", path + ".part"):
                try: os.remove(p)
                except OSError: pass
        META.pop(gid, None)
    elif a == "retry":
        m = META.get(gid)
        if not m: raise RuntimeError("Yenidən cəhd üçün məlumat yoxdur")
        try: rpc("removeDownloadResult", gid)
        except Exception: pass
        META[rpc("addUri", [m["url"]], m["opts"])] = m
    elif a in ("open", "folder"): open_path(aria_path(gid), a == "folder")
    else: raise RuntimeError("naməlum əmr")

def open_path(path, folder):
    if not path or not os.path.exists(path): raise RuntimeError("Fayl tapılmadı")
    path = os.path.abspath(path)
    if IS_WIN:
        try:
            if folder:
                subprocess.Popen(["explorer", "/select," + path], **_no_window_kwargs())
            else:
                os.startfile(path)   # noqa: S606 (Windows-only)
        except Exception as e:
            raise RuntimeError("Fayl açılmadı: " + str(e))
        return
    if not folder:
        subprocess.Popen(["xdg-open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return
    # Fayl menecerini açıb FAYLIN ÖZÜNÜ seç: FileManager1 (Nautilus/Dolphin/Nemo…) → fallback qovluq.
    uri = "file://" + urllib.parse.quote(path)
    for cmd in (
        ["gdbus", "call", "--session", "--dest", "org.freedesktop.FileManager1",
         "--object-path", "/org/freedesktop/FileManager1", "--method",
         "org.freedesktop.FileManager1.ShowItems", "['%s']" % uri, ""],
        ["dbus-send", "--session", "--dest=org.freedesktop.FileManager1", "--type=method_call",
         "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems",
         "array:string:" + uri, "string:"],
    ):
        if not shutil.which(cmd[0]): continue
        try:
            if subprocess.run(cmd, capture_output=True, timeout=8).returncode == 0: return
        except Exception:
            pass
    subprocess.Popen(["xdg-open", os.path.dirname(path)],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

JOBS = {}
JLOCK = threading.Lock()
SEM = threading.Semaphore(3)
_n = 0
FMT_RE = re.compile(r"Downloading (\d+) format\(s\): (\S+)")
DEST_RE = re.compile(r'(?:Destination: |into )"?(.+?)"?\s*$')
INTERMEDIATE_RE = re.compile(r"\.f[\w-]*\d[\w-]*\.[A-Za-z0-9]{2,5}$")   # yt-dlp-nin ara format faylı: ad.f137.mp4 (YEKUN fayl deyil)
EXISTS_RE = re.compile(r"^\[download\]\s+(.+?)\s+has already been downloaded")
AUDIO_EXT = {"m4a", "mp3", "aac", "opus", "ogg", "oga", "wav", "weba", "flac"}

def num(x):
    try: return float(x)
    except (TypeError, ValueError): return None

def clean(name):
    name = re.sub(r"\.part$", "", name)
    return re.sub(r"\.f[\w-]+(?=\.[^.]+$)", "", name)

def write_cookies(cs):
    fd, p = tempfile.mkstemp(prefix="idm-ck-", suffix=".txt")
    with os.fdopen(fd, "w") as f:
        f.write("# Netscape HTTP Cookie File\n")
        for c in cs:
            d = c.get("domain") or ""
            if not d or any(ch in (c.get("name", "") + c.get("value", "")) for ch in "\t\n\r"): continue
            f.write("\t".join([("#HttpOnly_" if c.get("httpOnly") else "") + d,
                               "TRUE" if d.startswith(".") else "FALSE", c.get("path") or "/",
                               "TRUE" if c.get("secure") else "FALSE",
                               str(int(c.get("expirationDate") or 0)), c["name"], c["value"]]) + "\n")
    return p

def rm(p):
    if p:
        try: os.remove(p)
        except OSError: pass

YT_HOST_RE = re.compile(r"(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$", re.I)

def is_youtube(url):
    try: return bool(YT_HOST_RE.search(urllib.parse.urlparse(url or "").hostname or ""))
    except ValueError: return False

def is_yt_hls(url):
    """YouTube page URL-i və ya birbaşa manifest.googlevideo.com HLS manifesti."""
    try:
        p = urllib.parse.urlparse(url or "")
        h = (p.hostname or "").lower()
        return is_youtube(url) or (bool(re.search(r"(?:^|\.)googlevideo\.com$", h)) and ("/manifest/" in p.path or "hls" in p.path.lower()))
    except ValueError:
        return False

JS_MIN = {"deno": (2, 0, 0), "node": (20, 0, 0), "bun": (1, 0, 31)}  # yt-dlp-nin tələb etdiyi minimum versiyalar

def _ver(cmd):
    try: out = subprocess.run(cmd, capture_output=True, text=True, timeout=5, stdin=subprocess.DEVNULL).stdout
    except Exception: return None
    m = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", out)
    return tuple(int(x or 0) for x in m.groups()) if m else None

def js_runtime():
    for name in ("deno", "node", "bun"):
        path = shutil.which(name)
        v = _ver([path, "--version"]) if path else None
        if v and v >= JS_MIN[name]: return name, path
    return None

_CAPS = {"t": 0.0, "v": None}
_CAPS_LOCK = threading.Lock()

def ytdlp_caps(force=False):
    """yt-dlp versiyası, --js-runtimes dəstəyi və tapılmış JS runtime (60 san keşlənir)."""
    with _CAPS_LOCK:
        if not force and _CAPS["v"] and time.time() - _CAPS["t"] < 60: return _CAPS["v"]
        yt = shutil.which("yt-dlp")
        c = {"installed": bool(yt), "version": "", "age_days": None, "js_flag": False, "remote_flag": False,
             "runtime": "", "runtime_path": ""}
        if yt:
            try:
                c["version"] = subprocess.run([yt, "--version"], capture_output=True, text=True, timeout=10,
                                              stdin=subprocess.DEVNULL).stdout.strip()
                hp = subprocess.run([yt, "--help"], capture_output=True, text=True, timeout=10,
                                    stdin=subprocess.DEVNULL).stdout
                c["js_flag"], c["remote_flag"] = "--js-runtimes" in hp, "--remote-components" in hp
                m = re.match(r"(\d{4})\.(\d{2})\.(\d{2})", c["version"])
                if m: c["age_days"] = (date.today() - date(*map(int, m.groups()))).days
            except Exception: pass
        rt = js_runtime()
        if rt: c["runtime"], c["runtime_path"] = rt
        _CAPS["t"], _CAPS["v"] = time.time(), c
        return c

def yt_args(url):
    """Yalnız YouTube üçün: yt-dlp-yə JS runtime-ı göstər (2025.11-dən sonra imza/n-challenge üçün məcburidir)."""
    if not is_youtube(url): return []
    c, a = ytdlp_caps(), []
    if c["js_flag"] and c["runtime"]: a += ["--js-runtimes", f"{c['runtime']}:{c['runtime_path']}"]
    if c["remote_flag"] and os.environ.get("IDM_YT_REMOTE_COMPONENTS") == "1": a += ["--remote-components", "ejs:github"]
    return a

def yt_health():
    """YouTube-un işləməsinə mane ola biləcək real quraşdırma problemləri (istifadəçiyə göstərilir)."""
    c, w = ytdlp_caps(), []
    if not c["installed"]: return ["yt-dlp quraşdırılmayıb (pipx install \"yt-dlp[default]\")"]
    if c["age_days"] is not None and c["age_days"] > 120:
        w.append(f"yt-dlp köhnədir ({c['version']}, {c['age_days']} gün). YouTube tez-tez dəyişir: pipx upgrade yt-dlp  (və ya yt-dlp -U)")
    if c["js_flag"] and not c["runtime"]:
        w.append("YouTube üçün JavaScript runtime tapılmadı (deno ≥2 və ya node ≥20). Onsuz yt-dlp YouTube-da yalnız şəkil/360p qaytarır: "
                 "sudo apt install nodejs  və ya  curl -fsSL https://deno.land/install.sh | sh  (sonra helper-i restart edin)")
    return w

# YouTube üçün çoxlu yoxlama strategiyası. Brauzer cookie-ləri ilə yt-dlp yalnız cookie dəstəkləyən (PO token/SABR tələb edən)
# klientlərə düşə və yalnız 360p qaytara bilər; digər strategiyalar cookie-siz / başqa klientlərlə tam siyahı verə bilər.
YT_STRATS = {
    "A": (True,  "", "cookie-lə"),
    "B": (False, "", "cookie-siz"),
    "C": (False, "youtube:player_client=tv,android_vr,web_safari", "tv/android_vr"),
    "D": (False, "youtube:player_client=ios,mweb", "ios/mweb (HLS)"),
}

def strat_args(b, strat):
    """(b-nin strategiyaya uyğun variantı, --extractor-args siyahısı, cookie istifadə olunur?)"""
    cookies, ea, _ = YT_STRATS.get(strat or "A", YT_STRATS["A"])
    return (b if cookies else {**b, "userAgent": "", "referer": ""}), (["--extractor-args", ea] if ea else []), cookies

IMPERSONATE = os.environ.get("IDM_IMPERSONATE", "")   # məs. chrome (yt-dlp[curl-cffi] lazımdır); boş = sönük

def common_args(b, cookiefile):
    c = []
    if IMPERSONATE and not is_youtube(b.get("url")) and not str(b.get("url") or "").startswith("http://127.0.0.1"): c += ["--impersonate", IMPERSONATE]
    if b.get("userAgent"): c += ["--user-agent", b["userAgent"]]
    ref = b.get("referer")
    if ref:
        c += ["--referer", ref]
        p = urllib.parse.urlparse(ref)
        if p.scheme in ("http", "https") and p.netloc:
            c += ["--add-header", f"Origin:{p.scheme}://{p.netloc}"]
    if cookiefile: c += ["--cookies", cookiefile]
    elif str(b.get("cookiesFromBrowser") or "").strip():
        c += ["--cookies-from-browser", str(b["cookiesFromBrowser"]).strip()]
    drop = {"cookie", "host", "content-length", "range", "referer", "user-agent", "connection", "accept-encoding"}
    for k, v in (b.get("headers") or {}).items():
        if not k or str(k).lower() in drop or v is None: continue
        c += ["--add-header", f"{k}: {v}"]
    return c

# ---- Seçilmiş ÇOXLU səs trekləri: yt-dlp tək trek endirir, ffmpeg ilə hamısını birləşdiririk ----
def _has_audio_path(path):
    """Faylda audio stream var? (ffprobe; alınmasa True — yükləmə pozulmasın)."""
    if not path or not os.path.exists(path): return False
    fp = shutil.which("ffprobe")
    if not fp: return True
    try:
        r = subprocess.run([fp, "-v", "error", "-select_streams", "a", "-show_entries",
                            "stream=codec_type", "-of", "csv=p=0", path],
                           capture_output=True, text=True, errors="replace", timeout=30,
                           stdin=subprocess.DEVNULL)
        return "audio" in (r.stdout or "")
    except Exception:
        return True

def strip_audio_streams(path):
    """Fayldan bütün audio treklərini silir (video/subtitrlər qalır). Uğursuzsa eyni yol."""
    ff = shutil.which("ffmpeg")
    if not ff or not path or not os.path.exists(path): return path
    out = os.path.splitext(path)[0] + ".noaud" + os.path.splitext(path)[1]
    try:
        rc = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                             "-i", path, "-map", "0:v:0?", "-map", "0:s?", "-c", "copy", out],
                            capture_output=True, timeout=1800).returncode
    except Exception:
        rc = 1
    if rc == 0 and os.path.exists(out) and os.path.getsize(out) > 1024:
        rm(path); os.replace(out, path)
        return path
    rm(out)
    return path


def audio_tracks(b):
    """Seçilmiş səs trekləri: [{id, url, lang, size, est}]. `audioTracks` üstünlük verilir,
    sonra köhnə `audios`/`audioUrls` cütü. Yalnız etibarlı id/URL saxlanılır."""
    out = []
    tr = b.get("audioTracks")
    if isinstance(tr, list):
        for t in tr:
            if not isinstance(t, dict): continue
            idv = str(t.get("id") or "").strip()
            url = str(t.get("url") or "").strip()
            lang = str(t.get("lang") or "").strip()
            if url and not re.match(r"(?i)^https?://", url): url = ""
            if idv and not re.fullmatch(r"[\w.\-]+", idv): idv = ""
            if idv or url: out.append({"id": idv, "url": url, "lang": lang,
                                       "size": int(num(t.get("size")) or 0), "est": bool(t.get("est"))})
    if out: return out
    ids = [str(x).strip() for x in (b.get("audios") or []) if str(x).strip()]
    urls = [str(x).strip() for x in (b.get("audioUrls") or []) if str(x).strip()]
    for i in range(max(len(ids), len(urls))):
        idv = ids[i] if i < len(ids) else ""
        url = urls[i] if i < len(urls) else ""
        if not re.fullmatch(r"[\w.\-]+", idv or ""): idv = ""
        if url and not re.match(r"(?i)^https?://", url): url = ""
        if idv or url: out.append({"id": idv, "url": url, "lang": "", "size": 0, "est": False})
    return out

def dl_audio_track(b, url, fmt, outbase, timeout=3600, progress=None):
    """Tək səs treki endirir (id və ya audio playlist URL-i). Fayl yolu və ya "".
    `progress(done,total,speed,eta)` verilərsə, yt-dlp-nin canlı tərəqqisi ötürülür."""
    yt = shutil.which("yt-dlp")
    if not yt or not url: return ""
    ck = write_cookies(b.get("cookies")) if b.get("cookies") else None
    base = os.path.dirname(outbase) or str(DL_DIR)
    stem = os.path.basename(outbase)
    try:
        c = [yt, "--no-playlist", "--no-mtime", "--no-warnings", "--color", "never",
             "--retries", "5", "--fragment-retries", "5", "--socket-timeout", "20",
             *dl_args(0, True, url, False),
             *yt_args(url), *common_args(b, ck)]
        if fmt and re.fullmatch(r"[\w.\-*+/\[\]<=>,() ]+", fmt): c += ["-f", fmt]
        c += ["-o", outbase + ".%(ext)s", url]
        if progress:
            c += ["--newline", "--progress", "--progress-template",
                  "download:DLA|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s"]
            pr = subprocess.Popen(c, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                  errors="replace", bufsize=1, stdin=subprocess.DEVNULL, start_new_session=True)
            try:
                for line in pr.stdout:
                    if not line.startswith("DLA|"): continue
                    f = line.rstrip("\n").split("|", 6)
                    if len(f) < 7: continue
                    try:
                        done = num(f[2]) or 0; total = num(f[3]) or num(f[4]) or 0
                        spd = num(f[5]) or 0; eta = num(f[6])
                        progress(done, total, spd, eta)
                    except Exception: pass
            finally:
                pr.wait()
        else:
            subprocess.run(c, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL)
        cands = [os.path.join(base, f) for f in os.listdir(base)
                 if f.startswith(stem + ".") and not f.endswith((".part", ".ytdl", ".aria2"))]
        for p in sorted(cands, key=lambda x: os.path.getsize(x) if os.path.exists(x) else 0, reverse=True):
            if _has_audio_path(p): return p
        for p in cands:
            rm(p)
        return ""
    except Exception:
        return ""
    finally:
        rm(ck)


# ---- ASS subtitr: seqment kəsməsində STİL/RƏNG/BAYRAQ qorunur (mətn VTT-yə çevrilmir) ----
def _ass_cs(t):
    """ASS vaxtı 'H:MM:SS.cc' -> santisaniyə (int). Oxunmasa None."""
    try:
        p = str(t).strip().split(":")
        if len(p) == 3: h, m, s = p
        elif len(p) == 2: h, m, s = "0", p[0], p[1]
        else: return None
        return int(round((int(h) * 3600 + int(m) * 60 + float(s)) * 100))
    except Exception:
        return None

def _ass_ts(cs):
    cs = max(0, int(round(cs)))
    h, rem = divmod(cs, 360000); m, rem = divmod(rem, 6000); s, c = divmod(rem, 100)
    return "%d:%02d:%02d.%02d" % (h, m, s, c)

def ass_shift_text(text, segments, media_start=0.0):
    """ASS mətnini seqmentlərə görə kəsir, vaxtları yenidən qurur; [Script Info]/[V4+ Styles]
    (yəni rəng, şrift, bayraq vektorları) OLDUĞU KİMİ qalır. Uyğun sətir yoxdursa ""."""
    text = str(text or "").replace("\r", "").replace("\ufeff", "")
    if not text.strip(): return ""
    lines = text.split("\n")
    pre, in_events, fmt, fmt_line, dial = [], False, None, "", []
    for ln in lines:
        st = ln.strip()
        if st.startswith("[") and st.endswith("]"):
            in_events = st.lower() == "[events]"
            if not in_events: pre.append(ln)
            continue
        if in_events:
            low = st.lower()
            if low.startswith("format:"):
                fmt_line = ln
                fmt = [x.strip().lower() for x in st.split(":", 1)[1].split(",")]
            elif low.startswith("dialogue:") or low.startswith("comment:"):
                dial.append(ln)
            continue
        pre.append(ln)
    if not dial: return ""
    fields = fmt or ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
    try:
        si, ei, ti = fields.index("start"), fields.index("end"), fields.index("text")
    except ValueError:
        return ""
    out, off = [], 0
    for a, e in segments:
        acs, ecs = int(round(a * 100)), int(round(e * 100))
        dur = max(20, ecs - acs)
        for ln in dial:
            kind, rest = ln.split(":", 1)
            parts = rest.split(",", len(fields) - 1)
            if len(parts) < len(fields): continue
            s0, s1 = _ass_cs(parts[si]), _ass_cs(parts[ei])
            if s0 is None or s1 is None: continue
            if media_start:
                s0 -= int(round(float(media_start) * 100)); s1 -= int(round(float(media_start) * 100))
            if s1 <= acs or s0 >= ecs: continue
            ns0 = max(s0, acs) - acs + off
            ns1 = min(s1, ecs) - acs + off
            if ns1 - ns0 < 15: continue
            parts[si], parts[ei] = _ass_ts(ns0), _ass_ts(ns1)
            out.append(kind.strip() + ": " + ",".join(parts))
        off += dur
    if not out: return ""
    head = pre[:]
    head.append("[Events]")
    head.append(fmt_line if fmt_line else
                "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")
    return "\n".join(head + out) + "\n"


# ---- ASS-i videonun real ölçüsünə uyğunlaşdırma ----
# AI ikili ASS-i həmişə 1920x1080 (16:9) üçün qurur. Video fərqli aspektdədirsə (məs. 1918x802),
# libass/mpv "vs-filter aspect compat" səbəbindən mətni şaquli sıxır ("əzilmiş" görünüş).
# PlayRes-i videonun ölçüsünə keçirib koordinatları mərkəzə görə vahid miqyaslayırıq.
def _ass_fmt(v):
    v = round(float(v), 2)
    if abs(v - round(v)) < 1e-9: return str(int(round(v)))
    return ("%.2f" % v).rstrip("0").rstrip(".")

def _ass_fit_block(b, W, H, s):
    def pos(m):
        try: x, y = float(m.group(1)), float(m.group(2))
        except Exception: return m.group(0)
        return "\\pos(%s,%s)" % (_ass_fmt(W / 2.0 + (x - 960.0) * s), _ass_fmt(H + (y - 1080.0) * s))
    b = re.sub(r"\\pos\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)", pos, b)
    def clip(m):
        try: co = [float(x) for x in re.split(r"[, ]+", m.group(1).strip()) if x]
        except Exception: return m.group(0)
        if len(co) == 4:
            x1, y1, x2, y2 = co
            nx = [W / 2.0 + (x1 - 960.0) * s, H + (y1 - 1080.0) * s,
                  W / 2.0 + (x2 - 960.0) * s, H + (y2 - 1080.0) * s]
            return "\\clip(%s)" % ",".join(_ass_fmt(v) for v in nx)
        return m.group(0)
    b = re.sub(r"\\clip\(\s*([-\d.,\s]+)\s*\)", clip, b)
    def bs(m):
        try: v = float(m.group(2))
        except Exception: return m.group(0)
        return m.group(1) + _ass_fmt(v * s)
    b = re.sub(r"(\\bord|\\shad)(\d*\.?\d+)", bs, b)
    return b

def _ass_fit_drawing(chunk, s):
    return re.sub(r"[-+]?\d*\.?\d+", lambda m: _ass_fmt(float(m.group(0)) * s), chunk)

def _ass_fit_text(t, W, H, s):
    out, i, drawing = [], 0, False
    while i < len(t):
        j = t.find("{", i)
        if j < 0:
            out.append(_ass_fit_drawing(t[i:], s) if drawing else t[i:]); break
        if j > i:
            out.append(_ass_fit_drawing(t[i:j], s) if drawing else t[i:j])
        k = t.find("}", j)
        if k < 0:
            out.append(t[j:]); break
        nb = _ass_fit_block(t[j + 1:k], W, H, s)
        for m in re.finditer(r"\\p(\d+)", nb):
            drawing = int(m.group(1)) > 0
        out.append("{" + nb + "}")
        i = k + 1
    return "".join(out)

def ass_fit_video(text, W, H):
    r"""ASS PlayRes 1920x1080 → real video ölçüsü; \pos/\clip/şrift/vektor miqyaslanır."""
    try: W, H = int(W), int(H)
    except Exception: return text
    if not text or W <= 0 or H <= 0: return text
    s = H / 1080.0
    lines = text.split("\n")
    # PlayRes
    lines = [re.sub(r"(?m)^(PlayResX:)\s*\d+", r"\1 %d" % W, l) if l.startswith("PlayResX:") else l for l in lines]
    lines = [re.sub(r"(?m)^(PlayResY:)\s*\d+", r"\1 %d" % H, l) if l.startswith("PlayResY:") else l for l in lines]
    out, section, ev_fmt, ev_text_i, style_fmt = [], "", None, 9, None
    for ln in lines:
        st = ln.strip()
        if st.startswith("[") and st.endswith("]"):
            section = st.lower()
            out.append(ln); continue
        if section == "[v4+ styles]":
            if st.lower().startswith("format:"):
                style_fmt = [x.strip().lower() for x in st.split(":", 1)[1].split(",")]
                out.append(ln); continue
            if st.lower().startswith("style:") and style_fmt:
                head, rest = ln.split(":", 1)
                parts = rest.split(",")
                for f in ("fontsize", "outline", "shadow"):
                    if f in style_fmt:
                        i = style_fmt.index(f)
                        if i < len(parts):
                            try: parts[i] = _ass_fmt(float(parts[i].strip()) * s)
                            except Exception: pass
                out.append(head + ":" + ",".join(parts)); continue
        if section == "[events]":
            if st.lower().startswith("format:"):
                ev_fmt = [x.strip().lower() for x in st.split(":", 1)[1].split(",")]
                ev_text_i = ev_fmt.index("text") if "text" in ev_fmt else 9
                out.append(ln); continue
            if st.lower().startswith("dialogue:") or st.lower().startswith("comment:"):
                kind, rest = ln.split(":", 1)
                parts = rest.split(",", ev_text_i)
                if len(parts) > ev_text_i:
                    parts[ev_text_i] = _ass_fit_text(parts[ev_text_i], W, H, s)
                    out.append(kind + ":" + ",".join(parts)); continue
                out.append(ln); continue
        out.append(ln)
    return "\n".join(out)


def fsize_exact(f): return bool(num(f.get("filesize")))   # dəqiq yalnız yt-dlp "filesize"; filesize_approx / bitrate×müddət / seqment nümunəsi təxminidir (UI-da "~")


def quality_class(w, h):
    """Standart keyfiyyət sinfi: 1920x800 kimi cinematic videonu 1080p kimi göstərir."""
    w, h = int(w or 0), int(h or 0)
    m = max(w, h)
    if m >= 3800: return 2160
    if m >= 2500: return 1440
    if m >= 1900: return 1080
    if m >= 1200: return 720
    if m >= 840: return 480
    if m >= 620: return 360
    if m >= 400: return 240
    return h or w

def _probe_hls_segment(f, fp):
    """HLS seqmenti .jpg uzantılı olsa da MPEG-TS ola bilər (playmix). ffprobe URL-i rədd edir;
    ilk seqmenti yükləyib stdin ilə ffprobe edirik və real width/height/FPS/codec tapırıq."""
    try:
        d0, segs = _hls_pl(f)
        if not segs: return {}
        hd = _fmt_headers(f, {"Range": "bytes=0-4000000"})
        hd.setdefault("User-Agent", FH_UA)
        for seg, _dur, _br in segs[:3]:
            try:
                with urllib.request.urlopen(urllib.request.Request(seg, headers=hd), timeout=12) as r:
                    data = r.read(4_000_000)
                if not data: continue
                p = subprocess.run([fp, "-v", "error", "-show_entries",
                                    "stream=codec_type,codec_name,width,height,avg_frame_rate", "-of", "json", "-"],
                                   input=data, capture_output=True, timeout=20)
                doc = json.loads((p.stdout or b"{}").decode("utf-8", "replace")) or {}
                streams = doc.get("streams") or []
                v = next((x for x in streams if x.get("codec_type") == "video" and int(x.get("height") or 0) > 0), None)
                if v:
                    a, _, b = str(v.get("avg_frame_rate") or "0/1").partition("/")
                    fps = round(float(a) / float(b or 1), 2) if float(b or 1) else 0
                    return {"h": int(v.get("height") or 0), "w": int(v.get("width") or 0), "fps": fps,
                            "vc": str(v.get("codec_name") or ""), "ac": "", "kind": "video", "dur": 0, "size": 0}
                a = next((x for x in streams if x.get("codec_type") == "audio"), None)
                if a:
                    return {"h": 0, "w": 0, "fps": 0, "vc": "", "ac": str(a.get("codec_name") or ""), "kind": "audio", "dur": 0, "size": 0}
            except Exception:
                continue
    except Exception:
        pass
    return {}

_VPROBE = {}
def probe_video(f):
    """Hündürlüksüz axının real xassələri (ffprobe): {h, w, fps, vc}; alınmasa {} (heç nə uydurulmur)."""
    u = f.get("url"); fp = shutil.which("ffprobe")
    if not u or not fp: return {}
    if u in _VPROBE: return _VPROBE[u]
    res = {}
    try:
        check_url(u)
        cmd = [fp, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name,avg_frame_rate:format=duration,size", "-of", "json",
               "-analyzeduration", "3000000", "-probesize", "3000000"]
        hd = "".join(f"{k}: {v}\r\n" for k, v in _fmt_headers(f).items())
        if hd and re.match(r"(?i)^https?://", u): cmd += ["-headers", hd]
        p = subprocess.run(cmd + [u], capture_output=True, text=True, timeout=20, stdin=subprocess.DEVNULL)
        doc = json.loads(p.stdout or "{}") or {}
        st = (doc.get("streams") or [{}])[0]
        fm = doc.get("format") or {}
        h, w = int(st.get("height") or 0), int(st.get("width") or 0)
        fdur_v = round(num(fm.get("duration")), 2) if num(fm.get("duration")) else 0
        fsize_v = int(num(fm.get("size")) or 0)
        if h > 0:
            a, _, b = str(st.get("avg_frame_rate") or "0/1").partition("/")
            fps = round(float(a) / float(b or 1), 2) if float(b or 1) else 0
            res = {"h": h, "w": w, "fps": fps, "vc": str(st.get("codec_name") or ""), "dur": fdur_v, "size": fsize_v}
        elif fdur_v or fsize_v:   # yalnız audio / video axını olmayan konteyner: ölçü və müddət yenə dəqiqdir
            res = {"h": 0, "w": 0, "fps": 0, "vc": "", "dur": fdur_v, "size": fsize_v}
    except Exception: res = {}
    if not res.get("h") and _hls_like(f):
        # .jpg seqmentli HLS-də ffprobe URL-i rədd edir; ilk seqmentin özünü yoxla.
        seg = _probe_hls_segment(f, fp)
        if seg: res = seg
    if len(_VPROBE) > 300: _VPROBE.clear()
    _VPROBE[u] = res
    return res

def media_meta(b):
    """Universal FPS/meta: istənilən http(s) video/fayl/HLS URL-i üçün ffprobe.
    Yükləməyə toxunmur; yalnız keyfiyyət etiketi üçün real FPS verir."""
    u = str(b.get("url") or "")
    check_url(u)
    hd = {}
    if b.get("referer"): hd["Referer"] = str(b["referer"])
    if b.get("userAgent"): hd["User-Agent"] = str(b["userAgent"])
    f = {"url": u, "http_headers": hd, "protocol": "https"}
    if b.get("cookie"): f["cookies"] = str(b["cookie"])
    pv = probe_video(f)
    return {"ok": True, "fps": float(pv.get("fps") or 0), "height": int(pv.get("h") or 0),
            "width": int(pv.get("w") or 0), "vcodec": str(pv.get("vc") or ""),
            "duration": float(pv.get("dur") or 0), "size": int(pv.get("size") or 0)}

# ---- Context actions: URL duration / Save As / GIF / lossless cut (standart yükləmə axınına toxunmur)
def _ctx_headers(b):
    h = {}
    if b.get("referer"): h["Referer"] = str(b["referer"])
    if b.get("userAgent"): h["User-Agent"] = str(b["userAgent"])
    if b.get("cookie"): h["Cookie"] = str(b["cookie"])
    return h

def ctx_duration(b):
    u = str(b.get("url") or "")
    check_url(u)
    fp = shutil.which("ffprobe")
    if fp:
        try:
            cmd = [fp, "-v", "error", "-show_entries", "format=duration", "-of", "json"]
            hd = "".join(f"{k}: {v}\r\n" for k, v in _ctx_headers(b).items())
            if hd and re.match(r"(?i)^https?://", u): cmd += ["-headers", hd]
            p = subprocess.run(cmd + [u], capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL)
            d = num((json.loads(p.stdout or "{}").get("format") or {}).get("duration"))
            if d and d > 0: return d
        except Exception: pass
    yt = shutil.which("yt-dlp")
    if yt:
        try:
            cmd = [yt, "-J", "--no-playlist", "--color", "never", "--no-warnings"]
            if b.get("format"): cmd += ["-f", str(b["format"])]
            for k, v in _ctx_headers(b).items():
                if k == "Referer": cmd += ["--referer", v]
                elif k == "Cookie": cmd += ["--add-header", "Cookie:" + v]
                elif k == "User-Agent": cmd += ["--user-agent", v]
            p = subprocess.run(cmd + [u], capture_output=True, text=True, timeout=35, stdin=subprocess.DEVNULL)
            if p.returncode == 0:
                j = json.loads(p.stdout or "{}")
                d = num(j.get("duration"))
                if d and d > 0: return d
        except Exception: pass
    return 0

def _gui_env():
    """systemd user servisində GUI dialoqları üçün görünən sessiya mühitini tamamlayır."""
    env = os.environ.copy()
    uid = os.getuid()
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{uid}")
    rt = Path(env["XDG_RUNTIME_DIR"])
    if not env.get("WAYLAND_DISPLAY") and rt.is_dir():
        for pth in sorted(rt.glob("wayland-*")):
            env["WAYLAND_DISPLAY"] = pth.name
            break
    if not env.get("DISPLAY") and Path("/tmp/.X11-unix/X0").exists():
        env["DISPLAY"] = ":0"
    if not env.get("XAUTHORITY") and rt.is_dir():
        xs = sorted(rt.glob("xauth_*"))
        if xs: env["XAUTHORITY"] = str(xs[0])
    if env.get("WAYLAND_DISPLAY"): env.setdefault("QT_QPA_PLATFORM", "wayland")
    return env

def _portal_request(iface_name, method, make_args, timeout=180):
    """XDG Desktop Portal sorğusu: native pəncərə göstərir, DISPLAY tələb etmir.
    Qaytarır: ("ok"|"cancel"|"fail"|"timeout", results|None).
    """
    try:
        import dbus
        import dbus.mainloop.glib
        from gi.repository import GLib
        dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
        bus = dbus.SessionBus()
    except Exception as e:
        return "fail", str(e)
    token = "idm" + secrets.token_hex(8)
    try:
        sender = bus.get_unique_name().lstrip(":").replace(".", "_")
        predicted = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"
    except Exception:
        return "fail", "D-Bus session yoxdur"
    state = {"response": None, "results": None}
    loop = GLib.MainLoop()
    def on_response(response, results):
        try: state["response"] = int(response)
        except Exception: state["response"] = -1
        state["results"] = results
        loop.quit()
    try:
        bus.add_signal_receiver(on_response, signal_name="Response",
                                dbus_interface="org.freedesktop.portal.Request", path=predicted)
    except Exception:
        pass
    def on_timeout():
        if state["response"] is None:
            state["response"] = -2
            loop.quit()
        return False
    tid = GLib.timeout_add_seconds(timeout, on_timeout)
    try:
        obj = bus.get_object("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop")
        iface = dbus.Interface(obj, iface_name)
        req = getattr(iface, method)(*make_args(token))
        req = str(req)
        if req != predicted:
            try:
                bus.add_signal_receiver(on_response, signal_name="Response",
                                        dbus_interface="org.freedesktop.portal.Request", path=req)
            except Exception: pass
        loop.run()
    except Exception as e:
        try: GLib.source_remove(tid)
        except Exception: pass
        return "fail", str(e)
    try: GLib.source_remove(tid)
    except Exception: pass
    if state["response"] == 0: return "ok", state["results"]
    if state["response"] == 1: return "cancel", state["results"]
    if state["response"] == -2: return "timeout", None
    return "fail", state["results"]

def _portal_pick_dir():
    try:
        import dbus
    except Exception as e:
        return "fail", str(e)
    def make(token):
        opts = dbus.Dictionary({
            "handle_token": dbus.String(token, variant_level=1),
            "multiple": dbus.Boolean(False, variant_level=1),
            "directory": dbus.Boolean(True, variant_level=1),
            "modal": dbus.Boolean(True, variant_level=1),
            "accept_label": dbus.String("Seç", variant_level=1),
        }, signature="sv")
        return ("", "JDM — qovluq seçin", opts)
    status, results = _portal_request("org.freedesktop.portal.FileChooser", "OpenFile", make, 240)
    if status != "ok": return status, ""
    try:
        uris = results.get("uris") or []
        for u in uris:
            q = urllib.parse.urlparse(str(u))
            if q.scheme == "file": return "ok", urllib.parse.unquote(q.path)
    except Exception: pass
    return "cancel", ""

def _portal_share(url):
    try:
        import dbus
    except Exception as e:
        return "fail", str(e)
    def make(token):
        opts = dbus.Dictionary({
            "handle_token": dbus.String(token, variant_level=1),
            "ask": dbus.Boolean(True, variant_level=1),
            "modal": dbus.Boolean(True, variant_level=1),
        }, signature="sv")
        return ("", str(url), opts)
    status, _ = _portal_request("org.freedesktop.portal.OpenURI", "OpenURI", make, 120)
    return status, ""

def _open_uri(uri):
    env = _gui_env()
    for c in (["xdg-open", str(uri)], ["gio", "open", str(uri)]):
        if not shutil.which(c[0]): continue
        try:
            p = subprocess.Popen(c, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 stdin=subprocess.DEVNULL, start_new_session=True)
            if p.poll() is None or p.returncode == 0: return True
        except Exception: pass
    return False

def _share_menu(url):
    """Portal olmadıqda system dialog (kdialog) ilə paylaşma hədəfləri."""
    if not shutil.which("kdialog"):
        return "fail"
    q = urllib.parse.quote(str(url), safe="")
    tg = "https://t.me/share/url?url=" + q
    wa = "https://wa.me/?text=" + q
    mail = "mailto:?subject=" + q + "&body=" + q
    menu = [["tg", "Telegram"], ["wa", "WhatsApp"], ["mail", "E-poçt"], ["browser", "Brauzerdə aç"]]
    args = ["kdialog", "--title", "JDM — Paylaş", "--menu", "Linki paylaş: " + str(url)[:100]]
    for k, v in menu: args += [k, v]
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=120, env=_gui_env(), stdin=subprocess.DEVNULL)
    except Exception:
        return "fail"
    if p.returncode != 0: return "cancel"
    choice = (p.stdout or "").strip().splitlines()
    if not choice: return "cancel"
    dest = {"tg": tg, "wa": wa, "mail": mail, "browser": str(url)}.get(choice[0], "")
    if not dest: return "cancel"
    return "ok" if _open_uri(dest) else "fail"

def ctx_pick_dir():
    # 1) XDG Desktop Portal: native fayl meneceri, systemd servisində DISPLAY olmadan da işləyir.
    status, path = _portal_pick_dir()
    if status == "ok" and path: return path
    if status == "cancel": return ""
    # 2) GUI mühiti tamamlanmış kdialog/zenity/yad fallback.
    env = _gui_env()
    cmds = [
        ["zenity", "--file-selection", "--directory", "--title=JDM — qovluq seçin"],
        ["kdialog", "--getexistingdirectory", str(Path.home())],
        ["yad", "--file-selection", "--directory", "--title=JDM — qovluq seçin"],
    ]
    for c in cmds:
        if not shutil.which(c[0]): continue
        try:
            p = subprocess.run(c, capture_output=True, text=True, timeout=120, env=env, stdin=subprocess.DEVNULL)
            if p.returncode == 0 and p.stdout.strip(): return p.stdout.strip().splitlines()[0]
        except Exception: pass
    return ""

def ctx_download(b):
    """Mənbəni müvəqqəti qovluğa endirir; (path, tempdir)."""
    yt = shutil.which("yt-dlp")
    if not yt: raise RuntimeError("yt-dlp quraşdırılmayıb")
    tmp = tempfile.mkdtemp(prefix="idm-ctx-", dir=str(DL_DIR))
    out = os.path.join(tmp, "src.%(ext)s")
    cmd = [yt, "--no-playlist", "--no-mtime", "--no-warnings", "--newline", "--color", "never",
           "-P", tmp, "-o", out, "--force-overwrites"]
    if b.get("format"): cmd += ["-f", str(b["format"])]
    for k, v in _ctx_headers(b).items():
        if k == "Referer": cmd += ["--referer", v]
        elif k == "Cookie": cmd += ["--add-header", "Cookie:" + v]
        elif k == "User-Agent": cmd += ["--user-agent", v]
    try:
        p = subprocess.run(cmd + [str(b.get("url") or "")], capture_output=True, text=True, timeout=1200, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        shutil.rmtree(tmp, ignore_errors=True); raise RuntimeError("Medianı endirmək çox uzun çəkdi")
    if p.returncode != 0:
        err = (p.stderr or "").strip().splitlines()
        # Birbaşa kiçik fayl / subtitr: yt-dlp dəstəkləmirsə, səhifə başlıqları ilə xam endir.
        raw = str(b.get("url") or "")
        if not b.get("format") and not re.search(r"\.(?:m3u8|mpd)(?:[?#]|$)", raw, re.I):
            try:
                ext = (os.path.splitext(urllib.parse.urlparse(raw).path)[1] or ".bin").lstrip(".")
                dst = os.path.join(tmp, "src." + ext)
                with urllib.request.urlopen(urllib.request.Request(raw, headers=_ctx_headers(b)), timeout=120) as r, open(dst, "wb") as f:
                    shutil.copyfileobj(r, f, 1024 * 1024)
                if os.path.getsize(dst) > 0: return dst, tmp
            except Exception: pass
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError((err[-1] if err else "yt-dlp endirə bilmədi")[:180])
    files = [f for f in glob.glob(os.path.join(glob.escape(tmp), "src.*"))
             if not f.endswith((".part", ".ytdl", ".aria2")) and os.path.isfile(f)]
    if not files:
        shutil.rmtree(tmp, ignore_errors=True); raise RuntimeError("Endirilmiş media faylı tapılmadı")
    return max(files, key=lambda f: os.path.getsize(f)), tmp

def ctx_target(dirpath, name, ext, cut=False):
    stem = os.path.basename(safe_name(name or "media")) or "media"
    for e in MEDIA_EXTS:
        if stem.lower().endswith("." + e):
            stem = stem[:-(len(e) + 1)]; break
    if cut: stem += " (cut)"
    if ext: stem += "." + ext
    return unique_path(os.path.join(dirpath, stem))

def ctx_save(b, save_as=False, start=None, end=None, gif=False):
    """save_as=True -> universal qovluq seçimi; start/end -> lossless cut; gif=True -> GIF."""
    outdir = ctx_pick_dir() if save_as else str(DL_DIR)
    if save_as and not outdir: raise RuntimeError("Qovluq seçilmədi")
    src, tmp = ctx_download(b)
    try:
        ext = os.path.splitext(src)[1].lstrip(".").lower() or "mp4"
        name = b.get("name") or "media"
        if gif:
            dst = ctx_target(outdir, name, "gif")
            filt = "fps=10,scale=min(480\\,iw):-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5"
            cmd = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-i", src, "-an", "-vf", filt, "-loop", "0", dst]
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=1200, stdin=subprocess.DEVNULL)
            if p.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) <= 0:
                rm(dst); raise RuntimeError("GIF yaradılmadı: " + ((p.stderr or "").strip().splitlines()[-1:] or [""])[0][:120])
            return dst
        if start is not None and end is not None:
            start, end = float(start), float(end)
            dur = ctx_duration(b)
            if not (end > start) or start < 0: raise RuntimeError("Kəsmə intervalı yanlışdır")
            if dur and end > dur + 0.01: raise RuntimeError(f"Son nöqtə medianın müddətindən ({dur:.1f} san) böyükdür")
            dst = ctx_target(outdir, name, ext, cut=True)
            cmd = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-ss", f"{start:.3f}", "-i", src,
                   "-t", f"{max(0.001, end - start):.3f}", "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy",
                   "-avoid_negative_ts", "make_zero", dst]
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=1200, stdin=subprocess.DEVNULL)
            if p.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) <= 0:
                rm(dst); raise RuntimeError("Kəsmə alınmadı: " + ((p.stderr or "").strip().splitlines()[-1:] or [""])[0][:120])
            return dst
        dst = ctx_target(outdir, name, ext)
        shutil.move(src, dst)
        return dst
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

# ---- Context job panel (Save As / GIF / Cut with progress) ----
CTXJOBS = {}
_CN = [0]

def ctx_choose_save(default_path):
    """Universal save dialog: filename input + overwrite confirmation."""
    d = os.path.dirname(default_path) or str(DL_DIR)
    n = os.path.basename(default_path) or "media"
    if not os.path.isdir(d): d = str(DL_DIR)
    default_path = os.path.join(d, n)
    cmds = [
        ["kdialog", "--getsavefilename", default_path, "Media (*.mp4 *.mkv *.webm *.m4a *.mp3 *.gif)"],
        ["zenity", "--file-selection", "--save", "--confirm-overwrite", "--filename=" + default_path],
        ["yad", "--file-selection", "--save", "--confirm-overwrite", "--filename=" + default_path],
    ]
    for c in cmds:
        if not shutil.which(c[0]): continue
        try:
            r = subprocess.run(c, capture_output=True, text=True, timeout=120, env=_gui_env(), stdin=subprocess.DEVNULL)
            if r.returncode == 0 and r.stdout.strip(): return r.stdout.strip().splitlines()[0]
        except Exception: pass
    return ""

def _ctx_stream_ext(u, fallback="mkv"):
    ext = os.path.splitext(urllib.parse.urlparse(str(u or "")).path)[1].lstrip(".").lower()
    if ext in ("m3u8", "mpd"): return "mp4"
    if ext in ("ts", "m2ts", "mts"): return "mkv"
    if ext in ("mp4", "m4v", "mov", "webm", "mkv", "m4a", "mp3", "ogg", "oga", "opus", "flac", "wav", "aac", "weba"):
        return ext
    return fallback

def ctx_streams(b):
    """Kəsmə üçün birbaşa axın URL-lərini qaytarır; media faylını endirmir.
    Page URL -> yt-dlp -J ilə seçilmiş formatın birbaşa URL-ləri.
    Birbaşa media/HLS/DASH -> URL-in özü.
    """
    u = str(b.get("url") or "")
    fmt = str(b.get("format") or "")
    if not re.match(r"(?i)^https?://", u): raise RuntimeError("Media URL-i yoxdur")
    direct = bool(b.get("direct"))
    path_ext = os.path.splitext(urllib.parse.urlparse(u).path)[1].lstrip(".").lower()
    if not fmt and (direct or path_ext in ("mp4", "m4v", "mov", "webm", "mkv", "ts", "m2ts", "mts", "m3u8", "mpd", "m4a", "mp3", "ogg", "oga", "opus", "wav", "aac", "flac", "weba")):
        ext = _ctx_stream_ext(u)
        return [{"url": u, "v": True, "a": True}], ext
    yt = shutil.which("yt-dlp")
    if not yt: raise RuntimeError("yt-dlp quraşdırılmayıb")
    strat = b.get("strat") if (is_youtube(u) and b.get("strat") in YT_STRATS) else ""
    cb, ea, use_ck = strat_args(b, strat or "A")
    if not use_ck: cb = {**cb, "cookie": ""}
    cmd = [yt, "-J", "--no-playlist", "--no-warnings", "--socket-timeout", "25", "--color", "never",
           *yt_args(u), *ea]
    if fmt: cmd += ["-f", fmt]
    for k, v in _ctx_headers(cb).items():
        if k == "Referer": cmd += ["--referer", v]
        elif k == "Cookie": cmd += ["--add-header", "Cookie:" + v]
        elif k == "User-Agent": cmd += ["--user-agent", v]
    try:
        p = subprocess.run(cmd + [u], capture_output=True, text=True, timeout=55, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        raise RuntimeError("Axın məlumatı alınmadı (timeout)")
    if p.returncode != 0:
        tail = " | ".join((p.stderr or "").strip().splitlines()[-4:])
        raise RuntimeError("Axın URL-i alınmadı: " + (tail[:260] or ("kod " + str(p.returncode))))
    try: j = json.loads(p.stdout or "{}")
    except Exception: raise RuntimeError("yt-dlp JSON cavabı oxunmadı")
    rfs = j.get("requested_formats") or []
    ff = rfs if rfs else [j]
    streams = []
    for f in ff:
        u2 = str(f.get("url") or "")
        if not u2: continue
        vc, ac = str(f.get("vcodec") or "none").lower(), str(f.get("acodec") or "none").lower()
        streams.append({"url": u2, "v": vc not in ("", "none"), "a": ac not in ("", "none")})
    if not streams: raise RuntimeError("Birbaşa media axını tapılmadı")
    ext = str(j.get("ext") or "").lstrip(".").lower() or _ctx_stream_ext(streams[0]["url"])
    if ext in ("m3u8", "mpd", "ts", "m2ts", "mts"): ext = "mkv"
    return streams, ext

def _ctx_has_streams(src):
    fp = shutil.which("ffprobe")
    if not fp: return True
    try:
        p = subprocess.run([fp, "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", src],
                           capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL)
        return bool((p.stdout or "").strip())
    except Exception:
        return False

def _ctx_local_duration(src):
    fp = shutil.which("ffprobe")
    if not fp: return 0.0
    try:
        p = subprocess.run([fp, "-v", "error", "-show_entries", "format=duration", "-of", "json", src],
                           capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL)
        return float((json.loads(p.stdout or "{}").get("format") or {}).get("duration") or 0)
    except Exception:
        return 0.0

class CtxJob:
    def __init__(s, b, kind, target=""):
        _CN[0] += 1
        s.id = f"c{_CN[0]}"; s.source = "ctx"; s.kind = kind; s.b = dict(b); s.temp = ""
        s.strat = b.get("strat") if (is_youtube(str(b.get("url") or "")) and b.get("strat") in YT_STRATS) else ""
        s.cb, s.ea, use_ck = strat_args(s.b, s.strat or "A")
        if not use_ck: s.cb = {**s.cb, "cookie": ""}
        s.name = os.path.basename(target) if target else "media"
        s.target = target
        s.status, s.progress, s.speed, s.size, s.done, s.eta, s.error, s.phase = "waiting", 0.0, 0, 0, 0, None, "", "Gözləyir: 0%"
        s.path = ""; s.mode = kind; s.proc = None; s.removed = False
        s.start, s.end = num(b.get("start")), num(b.get("end"))
        s.lock = threading.Lock()
        CTXJOBS[s.id] = s
        threading.Thread(target=s.run, daemon=True).start()

    def _sig(s, sig):
        try:
            if s.proc and s.proc.poll() is None: _kill_tree(s.proc, sig)
        except Exception: pass

    def _base(s, out, fmt=None):
        yt = shutil.which("yt-dlp")
        if not yt: raise RuntimeError("yt-dlp quraşdırılmayıb")
        c = [yt, "--no-playlist", "--no-mtime", "--force-overwrites", "--newline", "--no-warnings",
             "--socket-timeout", "25", "--color", "never", *yt_args(str(s.b.get("url") or "")), *s.ea,
             "--progress-template", "PROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s",
             "-o", out]
        if fmt: c += ["-f", str(fmt)]
        for k, v in _ctx_headers(s.cb).items():
            if k == "Referer": c += ["--referer", v]
            elif k == "Cookie": c += ["--add-header", "Cookie:" + v]
            elif k == "User-Agent": c += ["--user-agent", v]
        return c + [str(s.b.get("url") or "")]

    def _run_ytdlp(s, out, fmt=None):
        s.proc = subprocess.Popen(s._base(out, fmt), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, errors="replace", bufsize=1, start_new_session=True)
        tail = []
        for line in s.proc.stdout:
            if s.removed: break
            if line.startswith("PROG|"):
                f = line.strip().split("|")
                if len(f) >= 6:
                    try:
                        down, tot, spd, eta = num(f[2]), num(f[3]), num(f[4]), num(f[5])
                        s.done, s.speed, s.eta = int(down or 0), spd or 0, eta
                        if tot:
                            s.size = int(tot); s.progress = max(s.progress, min(getattr(s, "dl_max", 82.0), down / tot * getattr(s, "dl_max", 82.0)))
                            s.phase = ("Yüklənir" if s.kind == "saveas" else "Mənbə endirilir") + f": {s.progress:.0f}%"
                        else:
                            s.progress = max(s.progress, 1.0)
                            s.phase = "Yüklənir: 0%" if s.kind == "saveas" else "Mənbə endirilir: 0%"
                    except Exception: pass
            elif line.strip():
                tail.append(line.strip()); tail = tail[-8:]
        rc = s.proc.wait()
        return rc, " | ".join(tail)

    def _raw(s, out):
        """Birbaşa HTTP media/subtitle: yt-dlp generic uğursuz olsa da işləyir."""
        raw = str(s.b.get("url") or "")
        if not re.match(r"(?i)^https?://", raw) or re.search(r"\.(?:m3u8|mpd)(?:[?#]|$)", raw, re.I):
            raise RuntimeError("Birbaşa HTTP media deyil")
        req = urllib.request.Request(raw, headers=_ctx_headers(s.cb))
        with urllib.request.urlopen(req, timeout=60) as r:
            ct = (r.headers.get("Content-Type") or "").lower()
            if "text/html" in ct or "mpegurl" in ct or "dash+xml" in ct:
                raise RuntimeError("URL media faylı deyil (HTML/manifest)")
            ext = os.path.splitext(urllib.parse.urlparse(raw).path)[1].lstrip(".").lower()
            if not ext:
                ext = {"video/mp4": "mp4", "video/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3",
                       "audio/ogg": "ogg", "text/vtt": "vtt", "application/octet-stream": "bin"}.get(ct.split(";")[0].strip(), "bin")
            final = out.replace("%(ext)s", ext)
            tmpdst = final if "%(ext)s" in out else final + ".idmpart"
            total = int(r.headers.get("Content-Length") or 0); got = 0
            with open(tmpdst, "wb") as f:
                while True:
                    if s.removed:
                        rm(tmpdst); raise RuntimeError("Ləğv edildi")
                    chunk = r.read(1024 * 256)
                    if not chunk: break
                    f.write(chunk); got += len(chunk); s.done = got; s.size = max(s.size, total)
                    if total:
                        s.progress = max(s.progress, min(getattr(s, "dl_max", 82.0), got / total * getattr(s, "dl_max", 82.0)))
                        s.phase = ("Yüklənir" if s.kind == "saveas" else "Mənbə endirilir") + f": {s.progress:.0f}%"
                    else:
                        s.progress = max(s.progress, 1.0)
                        s.phase = ("Yüklənir" if s.kind == "saveas" else "Mənbə endirilir") + ": 0%"
            if got <= 0:
                rm(tmpdst); raise RuntimeError("Boş cavab")
            with open(tmpdst, "rb") as f:
                head = f.read(128).lstrip().lower()
                if head.startswith(b"<!doctype") or head.startswith(b"<html") or head.startswith(b"#extm3u") or head.startswith(b"<?xml"):
                    rm(tmpdst); raise RuntimeError("URL media faylı deyil (HTML/manifest)")
            if tmpdst != final: os.replace(tmpdst, final)
            return final

    def _download(s, out):
        s.dl_max = 95.0 if s.kind == "saveas" else 60.0
        s.phase = ("Yüklənir" if s.kind == "saveas" else "Mənbə endirilir") + ": 0%"
        raw = str(s.b.get("url") or "")
        fmt = str(s.b.get("format") or "")
        manifest = bool(re.search(r"\.(?:m3u8|mpd)(?:[?#]|$)", raw, re.I))
        errs = []
        # Birbaşa media URL-də yt-dlp generic extractor-a güvənmədən əvvəl xam HTTP sınayırıq.
        if not fmt and not manifest:
            try:
                dst = s._raw(out)
                if dst and os.path.exists(dst) and os.path.getsize(dst) > 0:
                    s.progress = getattr(s, "dl_max", 82.0)
                    return
            except Exception as e: errs.append("raw: " + str(e))
        if fmt:
            rc, tail = s._run_ytdlp(out, fmt)
            if rc == 0: s.progress = getattr(s, "dl_max", 82.0); return
            errs.append("format: " + (tail or ("kod " + str(rc))))
        rc, tail = s._run_ytdlp(out, None)
        if rc == 0: s.progress = getattr(s, "dl_max", 82.0); return
        errs.append("best: " + (tail or ("kod " + str(rc))))
        if not manifest:
            try:
                dst = s._raw(out)
                if dst and os.path.exists(dst) and os.path.getsize(dst) > 0:
                    s.progress = getattr(s, "dl_max", 82.0); return
            except Exception as e: errs.append("raw2: " + str(e))
        msg = " | ".join(x for x in errs if x)[-420:]
        raise RuntimeError("Media endirilə bilmədi: " + (msg or "bilinməyən xəta"))

    def _ff_input(self, url):
        a = []
        ua = str(self.b.get("userAgent") or "")
        ref = str(self.b.get("referer") or "")
        hdr = []
        for k, v in _ctx_headers(self.b).items():
            if not v: continue
            if k == "User-Agent":
                if not ua: ua = str(v)
            elif k == "Referer":
                if not ref: ref = str(v)
            elif k == "Cookie":
                hdr.append("Cookie: " + str(v))
            else:
                hdr.append(f"{k}: {v}")
        if hdr: a += ["-headers", "\r\n".join(hdr)]
        if ua: a += ["-user_agent", ua]
        if ref: a += ["-referer", ref]
        return a + ["-i", url]

    def _run_ffmpeg(s, cmd, total, base, label):
        s.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                  errors="replace", bufsize=1, start_new_session=True)
        tail = []
        cur = 0.0
        for line in s.proc.stdout:
            if s.removed: break
            ln = line.strip()
            if not ln: continue
            if ln.startswith("out_time_us="):
                try: cur = max(cur, num(ln.split("=", 1)[1]) / 1_000_000.0)
                except Exception: pass
            elif ln.startswith("out_time_ms="):
                try: cur = max(cur, num(ln.split("=", 1)[1]) / 1_000_000.0)
                except Exception: pass
            elif ln.startswith("out_time="):
                try:
                    h, m, sec = ln.split("=", 1)[1].split(":")
                    cur = max(cur, int(h) * 3600 + int(m) * 60 + float(sec))
                except Exception: pass
            elif ln.startswith("progress="):
                pass
            elif ln.startswith("speed=") or ln.startswith("frame=") or ln.startswith("fps=") or ln.startswith("bitrate=") or ln.startswith("total_size=") or ln.startswith("dup_frames=") or ln.startswith("drop_frames="):
                pass
            else:
                tail.append(ln); tail = tail[-8:]
            if total and total > 0 and cur > 0:
                pct = base + (99.0 - base) * min(1.0, cur / total)
                s.progress = max(s.progress, min(99.0, pct))
                s.phase = f"{label}: {pct:.0f}%"
        rc = s.proc.wait()
        return rc, " | ".join(tail)

    def _cut_target(s, ext):
        name = safe_name(s.b.get("name") or "media") or "media"
        if s.target:
            te = os.path.splitext(s.target)[1].lstrip(".").lower()
            if not te:
                s.target += "." + ext
            elif te not in (ext, "mkv"):
                s.target = os.path.splitext(s.target)[0] + ".mkv"
        else:
            s.target = ctx_target(str(DL_DIR), name, ext, cut=True)
        s.name = os.path.basename(s.target)

    def _cut_stream(s):
        if not (s.end > s.start) or s.start < 0: raise RuntimeError("Kəsmə intervalı yanlışdır")
        dur = ctx_duration(s.b)
        if dur and s.end > dur + 0.01:
            raise RuntimeError(f"Son nöqtə media müddətindən ({dur:.1f} san) böyükdür")
        s.phase, s.progress, s.status = "Axın hazırlanır: 0%", max(s.progress, 0.5), "active"
        try:
            streams, ext = ctx_streams(s.b)
        except Exception as e:
            s.error = str(e)
            # Bəzi qorunan səhifələrdə birbaşa axın URL-i alınmır: son vasitə kimi endirib lossless kəs.
            return s._cut_download()
        s._cut_target(ext)
        s.phase, s.progress = "Kəsilir: 0%", max(s.progress, 1.0)
        cmd = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-progress", "pipe:1", "-nostats"]
        for st in streams:
            cmd += ["-ss", f"{s.start:.3f}"] + s._ff_input(st["url"])
        maps = []
        for i, st in enumerate(streams):
            if st.get("v"): maps += ["-map", f"{i}:v:0?"]
            if st.get("a"): maps += ["-map", f"{i}:a:0?"]
        if not maps: maps = ["-map", "0"]
        cmd += maps + ["-t", f"{max(0.001, s.end - s.start):.3f}", "-c", "copy", "-map_metadata", "0",
                       "-avoid_negative_ts", "make_zero", s.target]
        rc, err = s._run_ffmpeg(cmd, s.end - s.start, 0.0, "Kəsilir")
        if rc != 0 or not os.path.exists(s.target) or os.path.getsize(s.target) <= 0 or not _ctx_has_streams(s.target):
            rm(s.target)
            if not s.target.lower().endswith(".mkv"):
                alt = os.path.splitext(s.target)[0] + ".mkv"
                s.name = os.path.basename(alt)
                cmd[-1] = alt
                rc2, err2 = s._run_ffmpeg(cmd, s.end - s.start, 0.0, "Kəsilir")
                if rc2 == 0 and os.path.exists(alt) and os.path.getsize(alt) > 0 and _ctx_has_streams(alt):
                    s.target = alt; rc, err = 0, ""
                else:
                    rm(alt); rc, err = rc2, err2
        if rc != 0 or not os.path.exists(s.target) or os.path.getsize(s.target) <= 0 or not _ctx_has_streams(s.target):
            rm(s.target)
            # Direct stream copy bəzi qorunan URL-lərdə mümkün olmursa, lossless fallback.
            return s._cut_download()
        s.path = s.target; s.progress = 99.0; s.phase = "Kəsilir: 99%"

    def _cut_download(s):
        s.error = ""
        s.phase, s.progress = "Mənbə endirilir: 0%", max(s.progress, 1.0)
        s.temp = tempfile.mkdtemp(prefix="idm-ctx-", dir=str(DL_DIR))
        src_t = os.path.join(s.temp, "src.%(ext)s")
        s._download(src_t)
        files = [f for f in glob.glob(os.path.join(glob.escape(s.temp), "src.*"))
                 if not f.endswith((".part", ".ytdl", ".aria2")) and os.path.isfile(f)]
        if not files: raise RuntimeError("Endirilmiş media faylı tapılmadı")
        src = max(files, key=lambda f: os.path.getsize(f))
        ext = os.path.splitext(src)[1].lstrip(".").lower() or "mkv"
        s._cut_target(ext)
        s.phase, s.progress = "Kəsilir: 60%", max(s.progress, 60.0)
        dur = s.end - s.start
        def cut_to(dst):
            cmd = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-progress", "pipe:1", "-nostats",
                   "-ss", f"{s.start:.3f}", "-i", src, "-t", f"{max(0.001, dur):.3f}",
                   "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-map_metadata", "0",
                   "-avoid_negative_ts", "make_zero", dst]
            return s._run_ffmpeg(cmd, dur, 60.0, "Kəsilir")
        rc, err = cut_to(s.target)
        if rc != 0 or not os.path.exists(s.target) or os.path.getsize(s.target) <= 0 or not _ctx_has_streams(s.target):
            rm(s.target)
            if not s.target.lower().endswith(".mkv"):
                alt = os.path.splitext(s.target)[0] + ".mkv"
                s.name = os.path.basename(alt)
                rc2, err2 = cut_to(alt)
                if rc2 == 0 and os.path.exists(alt) and os.path.getsize(alt) > 0 and _ctx_has_streams(alt):
                    s.target = alt; rc, err = 0, ""
                else:
                    rm(alt); rc, err = rc2, err2
        if rc != 0 or not os.path.exists(s.target) or os.path.getsize(s.target) <= 0 or not _ctx_has_streams(s.target):
            rm(s.target); raise RuntimeError("Kəsmə alınmadı: " + (err or "ffmpeg xətası"))
        s.path = s.target; s.progress = 99.0; s.phase = "Kəsilir: 99%"

    def run(s):
        try:
            s.status, s.phase, s.progress = "active", "Hazırlanır: 0%", 0.5
            name = safe_name(s.b.get("name") or "media") or "media"
            if s.kind == "cut":
                s._cut_stream()
                s.progress = 100.0
                s.status, s.phase, s.eta, s.speed = "complete", "Tamamlandı", None, 0
                try: s.size = s.done = os.path.getsize(s.path)
                except OSError: pass
                return
            if s.kind == "saveas":
                if not s.target: raise RuntimeError("Saxlama yolu seçilmədi")
                outdir = os.path.dirname(s.target) or str(DL_DIR)
                os.makedirs(outdir, exist_ok=True)
                # yt-dlp-in seçdiyi real konteyner uzantısı qorunur; istifadəçi adı (stem) qalır.
                # Bu, .webm seçilib .mp4 formatı yüklənəndə 0 baytlıq fayl yaranmasının qarşısını alır.
                s.temp = tempfile.mkdtemp(prefix=".idm-save-", dir=outdir)
                src_t = os.path.join(s.temp, "src.%(ext)s")
                s._download(src_t)
                files = [f for f in glob.glob(os.path.join(glob.escape(s.temp), "src.*"))
                         if not f.endswith((".part", ".ytdl", ".aria2")) and os.path.isfile(f)]
                if not files: raise RuntimeError("Endirilmiş fayl tapılmadı")
                src = max(files, key=lambda f: os.path.getsize(f))
                if os.path.getsize(src) <= 0: raise RuntimeError("Yüklənən fayl boşdur")
                ext = os.path.splitext(src)[1].lstrip(".").lower() or "bin"
                known = set(MEDIA_EXTS) | {"vtt", "srt", "ass", "ssa", "gif", "avi", "flv", "wmv", "mpeg", "mpg", "ogv", "3gp", "m2ts", "mts", "asf", "wma"}
                target_ext = os.path.splitext(s.target)[1].lstrip(".").lower()
                stem = os.path.splitext(s.target)[0] if target_ext in known else s.target
                final = unique_path(stem + "." + ext)
                shutil.move(src, final)
                s.target = final; s.name = os.path.basename(final); s.path = final; s.progress = 100.0
            else:
                s.temp = tempfile.mkdtemp(prefix="idm-ctx-", dir=str(DL_DIR))
                src_t = os.path.join(s.temp, "src.%(ext)s")
                s._download(src_t)
                files = [f for f in glob.glob(os.path.join(glob.escape(s.temp), "src.*"))
                         if not f.endswith((".part", ".ytdl", ".aria2")) and os.path.isfile(f)]
                if not files: raise RuntimeError("Endirilmiş media faylı tapılmadı")
                src = max(files, key=lambda f: os.path.getsize(f))
                ext = os.path.splitext(src)[1].lstrip(".").lower() or "mp4"
                if ext in ("bin", "tmp", "part", "download"):
                    try:
                        fp = shutil.which("ffprobe")
                        if fp:
                            pr = subprocess.run([fp, "-v", "error", "-show_entries", "format=format_name", "-of", "json", src],
                                                capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL)
                            fn = str((json.loads(pr.stdout or "{}").get("format") or {}).get("format_name") or "").lower()
                            if "webm" in fn or "matroska" in fn: ext = "webm" if "webm" in fn else "mkv"
                            elif "mp4" in fn or "mov" in fn: ext = "mp4"
                            elif "mpegts" in fn: ext = "ts"
                            elif "mp3" in fn: ext = "mp3"
                            elif "ogg" in fn: ext = "ogg"
                    except Exception: pass
                    if ext in ("bin", "tmp", "part", "download"): ext = "mkv"
                if s.kind == "gif":
                    if not s.target: s.target = ctx_target(str(DL_DIR), name, "gif")
                    s.name = os.path.basename(s.target)
                    os.makedirs(os.path.dirname(s.target), exist_ok=True)
                    s.phase, s.progress = "GIF-ə çevrilir: 60%", max(s.progress, 60.0)
                    gdur = _ctx_local_duration(src)
                    filters = [
                        "fps=12,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
                        "fps=10,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
                    ]
                    last = ""
                    ok = False
                    for flt in filters:
                        cmd = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-progress", "pipe:1", "-nostats",
                               "-i", src, "-an", "-vf", flt, "-loop", "0", s.target]
                        rc, err = s._run_ffmpeg(cmd, gdur, 60.0, "GIF-ə çevrilir")
                        last = err
                        if rc == 0 and os.path.exists(s.target) and os.path.getsize(s.target) > 0:
                            ok = True; break
                        rm(s.target)
                    if not ok: raise RuntimeError("GIF yaradılmadı: " + (last or "ffmpeg xətası"))
                    s.path = s.target; s.progress = 99.0; s.phase = "GIF-ə çevrilir: 99%"
                else:
                    # Konteyner uyğunsuzluğu lossless copy-ni pozmasın: webm/ts -> mp4 kimi hallarda .mkv istifadə et.
                    if s.target:
                        te = os.path.splitext(s.target)[1].lstrip(".").lower()
                        if te and te not in (ext, "mkv"):
                            s.target = os.path.splitext(s.target)[0] + ".mkv"
                    else:
                        s.target = ctx_target(str(DL_DIR), name, ext, cut=True)
                    s.name = os.path.basename(s.target)
                    os.makedirs(os.path.dirname(s.target), exist_ok=True)
                    s.phase, s.progress = "Lossless kəsilir", 88.0
                    dur = ctx_duration(s.b)
                    if not (s.end > s.start) or s.start < 0: raise RuntimeError("Kəsmə intervalı yanlışdır")
                    if dur and s.end > dur + 0.01: raise RuntimeError(f"Son nöqtə media müddətindən ({dur:.1f} san) böyükdür")
                    def cut_to(dst):
                        cmd = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-ss", f"{s.start:.3f}", "-i", src,
                               "-t", f"{max(0.001, s.end - s.start):.3f}", "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy",
                               "-avoid_negative_ts", "make_zero", dst]
                        s.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                                  errors="replace", start_new_session=True)
                        er = s.proc.communicate()[0]
                        return s.proc.returncode, ((er or "").strip().splitlines()[-1][:220] if (er or "").strip() else "")
                    rc, err = cut_to(s.target)
                    if (rc != 0 or not os.path.exists(s.target) or os.path.getsize(s.target) <= 0) and not s.target.lower().endswith(".mkv"):
                        rm(s.target)
                        alt = os.path.splitext(s.target)[0] + ".mkv"
                        rc2, err2 = cut_to(alt)
                        if rc2 == 0 and os.path.exists(alt) and os.path.getsize(alt) > 0:
                            s.target = alt; rc, err = 0, ""
                        else:
                            rm(alt); rc, err = rc2, err2
                    if rc != 0 or not os.path.exists(s.target) or os.path.getsize(s.target) <= 0:
                        rm(s.target); raise RuntimeError("Kəsmə alınmadı: " + (err or "ffmpeg xətası"))
                    s.path = s.target; s.progress = 100.0
            s.progress = 100.0
            s.status, s.phase, s.eta, s.speed = "complete", "Tamamlandı", None, 0
            try: s.size = s.done = os.path.getsize(s.path)
            except OSError: pass
        except Exception as e:
            if not s.removed:
                s.status, s.error, s.phase = "error", str(e)[:220], "Xəta"
                try: print(f"CtxJob {s.id} {s.kind} xəta: {s.error}", file=sys.stderr, flush=True)
                except Exception: pass
        finally:
            if s.temp: shutil.rmtree(s.temp, ignore_errors=True); s.temp = ""

    def item(s):
        return {"id": s.id, "source": "ctx", "name": s.name, "status": s.status, "progress": round(s.progress, 1),
                "speed": s.speed, "size": s.size, "done": s.done, "eta": s.eta, "error": s.error,
                "phase": s.phase, "path": s.path, "note": "", "mode": s.mode}

    def action(s, a):
        if a == "pause":
            if s.status == "active": s._sig(signal.SIGSTOP); s.status, s.speed = "paused", 0
        elif a == "resume":
            if s.status == "paused": s._sig(signal.SIGCONT); s.status = "active"
        elif a in ("remove", "delete"):
            s.removed = True
            try: s._sig(signal.SIGCONT); s._sig(signal.SIGTERM)
            except Exception: pass
            def settle():
                for _ in range(20):
                    if not s.proc or s.proc.poll() is not None: break
                    time.sleep(0.2)
                try: s._sig(signal.SIGKILL)
                except Exception: pass
                time.sleep(0.2)
                if s.temp: shutil.rmtree(s.temp, ignore_errors=True)
                if a == "delete" and s.target:
                    for p in [s.target, s.target + ".part", s.target + ".ytdl", s.target + ".idmpart"]:
                        rm(p)
            threading.Thread(target=settle, daemon=True).start()
            CTXJOBS.pop(s.id, None)
        elif a in ("open", "folder"):
            open_path(s.path or s.target, a == "folder")

def _ctx_target_path(raw, default_ext, cut=False):
    """UI-dən gələn adı/qovluğu təhlükəsiz tam yola çevirir; boş qovluq DL_DIR-dir."""
    t = str(raw or "").strip()
    if not t: return ""
    t = os.path.expanduser(t)
    if not os.path.isabs(t): t = os.path.join(str(DL_DIR), t)
    d, n = os.path.split(t)
    if not n: return ""
    if default_ext and not os.path.splitext(n)[1]:
        n += "." + default_ext
    return os.path.join(d, safe_name(n) or n)

def ctx_start_save(b):
    fname = safe_name(b.get("filename") or b.get("name") or "media") or "media"
    ext = os.path.splitext(fname)[1].lstrip(".") or os.path.splitext(str(b.get("name") or ""))[1].lstrip(".") or "mp4"
    target = _ctx_target_path(b.get("target"), ext)
    if not target and b.get("folderPick"):
        d = ctx_pick_dir()
        if not d: raise RuntimeError("Qovluq seçilmədi")
        target = _ctx_target_path(os.path.join(d, fname), ext)
    if not target:
        target = ctx_choose_save(ctx_target(str(DL_DIR), fname, ext))
    if not target: raise RuntimeError("Saxlama ləğv edildi")
    if not os.path.splitext(target)[1]: target += "." + ext
    return CtxJob({**b, "name": os.path.basename(target)}, "saveas", target)

def ctx_start_gif(b):
    name = safe_name(b.get("name") or "media") or "media"
    target = _ctx_target_path(b.get("target"), "gif")
    if not target:
        if b.get("saveAs"):
            target = ctx_choose_save(ctx_target(str(DL_DIR), name, "gif"))
            if not target: raise RuntimeError("Saxlama ləğv edildi")
        else:
            target = ctx_target(str(DL_DIR), name, "gif")
    if not target.lower().endswith(".gif"): target += ".gif"
    return CtxJob({**b, "name": os.path.basename(target)}, "gif", target)

def ctx_start_cut(b):
    start, end = num(b.get("start")), num(b.get("end"))
    if end <= start or start < 0: raise RuntimeError("Kəsmə intervalı yanlışdır")
    name = safe_name(b.get("filename") or b.get("name") or "media") or "media"
    # Default Yüklə: hədəf uzantısı birbaşa axından sonra real konteynerə görə seçilir.
    # Fərqli Saxla: istifadəçinin seçdiyi ad saxlanır; uyğunsuzluq olsa .mkv-yə keçid edilir.
    target = _ctx_target_path(b.get("target"), "")
    if not target and b.get("folderPick"):
        d = ctx_pick_dir()
        if not d: raise RuntimeError("Qovluq seçilmədi")
        target = _ctx_target_path(os.path.join(d, name), "")
    return CtxJob({**b, "name": os.path.basename(target) if target else name + " (cut)", "start": start, "end": end}, "cut", target)

# ---- Google/Picasa üçün brauzer-request chunk upload job-u (yalnız bu xüsusi axın növü) ----
UPLOADJOBS = {}
_UPN = [0]

# "Ancaq səs": ayrıca səs axını olmayan mənbələrdə video endirilir, səs ffmpeg ilə çıxarılır.
_AFMT_EXT = {"best": "m4a", "m4a": "m4a", "mp3": "mp3", "flac": "flac", "opus": "opus", "vorbis": "ogg", "wav": "wav"}
_AFMT_ARGS = {"best": ["-c:a", "copy"], "m4a": ["-c:a", "copy"], "mp3": ["-c:a", "libmp3lame", "-q:a", "0"],
              "flac": ["-c:a", "flac"], "opus": ["-c:a", "libopus"], "vorbis": ["-c:a", "libvorbis"], "wav": ["-c:a", "pcm_s16le"]}

def extract_audio(src, af="best"):
    """Videonun içindəki səsi ayırır. Uğursuz olarsa xəta qaytarır (video silinmir)."""
    if not shutil.which("ffmpeg"): raise RuntimeError("ffmpeg quraşdırılmayıb")
    ext = _AFMT_EXT.get(af, "m4a")
    out = unique_path(os.path.splitext(src)[0] + "." + ext)
    tries = [_AFMT_ARGS.get(af, _AFMT_ARGS["best"])] + ([["-c:a", "aac"]] if af in ("best", "m4a") else [])
    err = ""
    for args in tries:
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", *args, out],
                           capture_output=True, text=True, timeout=1800)
        err = (r.stderr or "").strip()[:200]
        if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0: return out
        rm(out)
    raise RuntimeError("Səs çıxarıla bilmədi: " + (err or "ffmpeg"))

def strip_audio(src):
    """Videodan səsi silir ("Yalnız video"). Uğursuz olarsa xəta qaytarır (orijinal qalır)."""
    if not shutil.which("ffmpeg"): raise RuntimeError("ffmpeg quraşdırılmayıb")
    root, ext = os.path.splitext(src)
    tmp = root + ".idm-v" + ext
    rm(tmp)
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-map", "0:v", "-c", "copy", tmp],
                       capture_output=True, text=True, timeout=1800)
    if r.returncode != 0 or not os.path.exists(tmp) or os.path.getsize(tmp) <= 0:
        rm(tmp); raise RuntimeError("Səs silinə bilmədi: " + ((r.stderr or "").strip()[:200] or "ffmpeg"))
    os.replace(tmp, src)
    return src

class UploadJob:
    def __init__(s, b):
        _UPN[0] += 1
        s.id = f"u{_UPN[0]}"; s.source = "upload"; s.b = dict(b or {})
        nm = safe_name(s.b.get("filename") or "video.mp4") or "video.mp4"
        ext = os.path.splitext(nm)[1].lstrip(".").lower() or "mp4"
        s.target = ctx_target(str(DL_DIR), nm, ext)
        s.temp = s.target + ".idmupload"
        s.name = os.path.basename(s.target); s.path = ""
        s.total = int(num(s.b.get("total")) or 0); s.done = 0
        s.audio_only = bool(s.b.get("audioOnly")); s.strip_audio = bool(s.b.get("stripAudio")); s.audio_fmt = str(s.b.get("audioFormat") or "best")
        s.status, s.progress, s.speed, s.eta = "active", 0.0, 0, None
        s.phase, s.error = (f"Yüklənir: 0%" if s.total else "Yüklənir"), ""
        s.t0, s.last_t, s.last_b = time.time(), time.time(), 0
        s.lock = threading.Lock(); s.removed = False
        os.makedirs(os.path.dirname(s.temp), exist_ok=True)
        with open(s.temp, "wb"): pass
        UPLOADJOBS[s.id] = s

    def chunk(s, offset, data):
        data = bytes(data or b"")
        if not data or s.removed: return
        with s.lock:
            with open(s.temp, "r+b") as f:
                f.seek(max(0, int(offset))); f.write(data)
            s.done = max(s.done, int(offset) + len(data))
            now = time.time()
            if now - s.last_t >= 0.5:
                s.speed = max(0, int((s.done - s.last_b) / max(0.01, now - s.last_t)))
                s.last_t, s.last_b = now, s.done
            if s.total > 0:
                s.progress = min(99.0, s.done / s.total * 100.0)
                s.phase = f"Yüklənir: {s.progress:.0f}%"
                if s.speed: s.eta = max(0, (s.total - s.done) / s.speed)

    def finish(s):
        with s.lock:
            if s.removed: raise RuntimeError("Ləğv edildi")
            size = os.path.getsize(s.temp) if os.path.exists(s.temp) else 0
            if s.total > 0 and size < s.total:
                raise RuntimeError(f"Yükləmə natamam ({size}/{s.total} bayt)")
            if size <= 0: raise RuntimeError("Boş fayl")
            os.replace(s.temp, s.target)
            s.path = s.target; s.done = s.size = size
            s.progress = 100.0; s.status = "complete"; s.phase = "Tamamlandı"; s.eta = None; s.speed = 0
        if s.audio_only:   # "Ancaq səs": endirilən videodan səsi çıxar, videonu saxlamırıq
            out = extract_audio(s.target, s.audio_fmt)
            rm(s.target)
            s.path, s.name, s.size = out, os.path.basename(out), os.path.getsize(out)
        elif s.strip_audio:   # "Yalnız video": səsi sil
            s.path, s.name, s.size = strip_audio(s.target), s.name, os.path.getsize(s.target)

    def abort(s):
        s.removed = True
        try: rm(s.temp)
        except Exception: pass
        UPLOADJOBS.pop(s.id, None)

    def item(s):
        return {"id": s.id, "source": "upload", "name": s.name, "status": s.status,
                "progress": round(s.progress, 1), "speed": s.speed, "size": s.total or s.done,
                "done": s.done, "eta": s.eta, "error": s.error, "phase": s.phase,
                "path": s.path, "note": "", "mode": "a" if s.audio_only else "v" if s.strip_audio else "file"}

    def action(s, a):
        if a in ("delete", "remove", "cancel"):
            if a == "delete" and s.path: rm(s.path)
            s.abort()
        elif a in ("open", "folder"):
            open_path(s.path or s.target, a == "folder")

def upload_start(b):
    j = UploadJob(b)
    return {"ok": True, "id": j.id, "name": j.name}

def upload_chunk(jid, offset, data):
    j = UPLOADJOBS.get(str(jid or ""))
    if not j: raise RuntimeError("Upload job tapılmadı")
    j.chunk(offset, data)
    return {"ok": True, "done": j.done, "progress": round(j.progress, 1)}

def upload_end(b):
    j = UPLOADJOBS.get(str(b.get("id") or ""))
    if not j: raise RuntimeError("Upload job tapılmadı")
    j.finish()
    return {"ok": True, "id": j.id, "path": j.path, "name": j.name}

def upload_abort(b):
    j = UPLOADJOBS.get(str(b.get("id") or ""))
    if j: j.abort()
    return {"ok": True}

def _hls_exact(f):
    if _HLS_FULL.get(str((f or {}).get("url") or "")): return True
    d0, segs = _hls_pl(f)
    return bool(segs) and all(x[2] for x in segs)

# ---- Fast Manifest Parsing Engine (YouTube HLS index/master): yalnız metadata oxuyur, yükləməyə toxunmur.
_HLSM = {}
_HLSM_LOCK = threading.Lock()
_HLSM_PEND = set()

def _hls_attr(t):
    out = {}
    for m in re.finditer(r'([A-Z0-9-]+)=("[^"]*"|[^,]*)', t or ""):
        out[m.group(1)] = m.group(2).strip('"')
    return out

def _hls_name_height(name):
    """RESOLUTION olmayan variantlarda NAME/VIDEO-NAME içindəki 1080p / 720p ipucu."""
    m = re.search(r"(?<!\d)(\d{3,4})\s*[pP](?![a-zA-Z])", str(name or ""))
    return int(m.group(1)) if m else 0

def parse_hls_master(text, base=""):
    """Master/media HLS mətnini parse edir: variant, real ölçü, FPS, HDR, bandwidth.
    RESOLUTION=WxH əsasdır; yoxdursa NAME/VIDEO-NAME-dəki 1080p kimi ipucu istifadə olunur.
    Media playlist-də STREAM-INF yoxdursa height=0 fallback qaytarılır."""
    text = text or ""
    variants = []
    lines = [x.strip() for x in text.splitlines()]
    for i, ln in enumerate(lines):
        if not re.match(r"^#EXT-X-STREAM-INF\s*:", ln, re.I): continue
        a = _hls_attr(ln.split(":", 1)[1])
        j = i + 1
        while j < len(lines) and (not lines[j] or lines[j].startswith("#")): j += 1
        if j >= len(lines): continue
        u = urllib.parse.urljoin(base, lines[j])
        res = str(a.get("RESOLUTION") or "")
        m = re.match(r"\s*(\d+)\s*[xX]\s*(\d+)\s*", res)
        w, h = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
        if not h:
            h = _hls_name_height(a.get("NAME")) or _hls_name_height(a.get("VIDEO-NAME"))
        try: fps = round(float(a.get("FRAME-RATE") or 0), 2)
        except ValueError: fps = 0
        hdr = (a.get("VIDEO-RANGE") or "").upper() not in ("", "SDR")
        bwave = num(a.get("BANDWIDTH")) or 0
        bwavg = num(a.get("AVERAGE-BANDWIDTH")) or 0
        bw = bwavg or bwave
        variants.append({"url": u, "height": h, "width": w, "fps": fps, "hdr": hdr,
                         "bandwidth": bw, "bandwidth_max": bwave,
                         "codecs": a.get("CODECS", ""), "name": a.get("NAME", "")})
    if not variants:
        variants.append({"url": base, "height": 0, "width": 0, "fps": 0, "hdr": False,
                         "bandwidth": 0, "bandwidth_max": 0, "codecs": "", "name": ""})
    return variants

def fast_hls_meta(url, hdr=None, timeout=3):
    """Qısa timeout ilə master/media manifest metadata-sı; nəticə 120 s keşlənir."""
    u = str(url or "")
    if not re.match(r"(?i)^https?://", u): return {"ok": False, "variants": []}
    now = time.time()
    with _HLSM_LOCK:
        hit = _HLSM.get(u)
        if hit and now - hit[0] < 120: return hit[1]
    h = {"User-Agent": (hdr or {}).get("User-Agent") or FH_UA, "Accept": "*/*"}
    for k, v in (hdr or {}).items():
        if str(k).lower() in ("referer", "origin", "cookie", "user-agent"): h[str(k)] = str(v)
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=timeout) as r:
            text = r.read(3_000_000).decode("utf-8", "replace")
        variants = parse_hls_master(text, u)
        master = bool(re.search(r"(?im)^\s*#EXT-X-STREAM-INF\s*:", text))
        out = {"ok": True, "master": master, "variants": variants[:80], "count": len(variants)}
        with _HLSM_LOCK:
            if len(_HLSM) > 300: _HLSM.clear()
            _HLSM[u] = (now, out)
        return out
    except Exception as e:
        return {"ok": False, "variants": [], "error": str(e)[:120]}

def prefetch_hls_meta(url, hdr=None):
    u = str(url or "")
    if not u: return
    with _HLSM_LOCK:
        if u in _HLSM or u in _HLSM_PEND: return
        _HLSM_PEND.add(u)
    def run():
        try: fast_hls_meta(u, hdr)
        finally:
            with _HLSM_LOCK: _HLSM_PEND.discard(u)
    try: threading.Thread(target=run, daemon=True).start()
    except Exception:
        with _HLSM_LOCK: _HLSM_PEND.discard(u)

def _hls_headers(b):
    h = {"User-Agent": str((b or {}).get("userAgent") or FH_UA)}
    if (b or {}).get("referer"): h["Referer"] = str(b["referer"])
    if (b or {}).get("cookie"): h["Cookie"] = str(b["cookie"])
    for k, v in ((b or {}).get("headers") or {}).items():
        if v is None: continue
        if str(k).lower() in ("referer", "origin", "cookie", "user-agent"): h[str(k)] = str(v)
    return h

def _hls_norm_key(u):
    try:
        p = urllib.parse.urlsplit(str(u or ""))
        q = urllib.parse.parse_qs(p.query)
        itag = (q.get("itag") or q.get("id") or [""])[0]
        return (p.netloc.lower(), p.path, str(itag))
    except Exception:
        return ("", str(u or ""), "")

def _hls_pick_variant(f, variants):
    """Format URL-i ilə master variantını dəqiq uyğunlaşdırır; yalnız yol oxşarlığı ilə yanlış seçim etmir."""
    u = str(f.get("url") or "")
    if not u: return None
    exact = [v for v in variants if str(v.get("url") or "") == u]
    if exact: return exact[0]
    k = _hls_norm_key(u)
    for v in variants:
        if _hls_norm_key(v.get("url")) == k and (k[2] or k[1]): return v
    fid = str(f.get("format_id") or "").split("-")[0]
    if fid:
        for v in variants:
            if str(v.get("itag") or "") == fid or _hls_norm_key(v.get("url"))[2] == fid:
                return v
    # Bəzi YouTube manifestlərində format URL-i master-dən fərqli query daşıyır; itag yoxdursa
    # yalnız mövcud həndəsə üst-üstə düşəndə qəbul edirik (uydurma miqyas yoxdur).
    fh = int(num(f.get("height")) or 0)
    if fh:
        same = [v for v in variants if int(v.get("height") or 0) == fh]
        if len(same) == 1: return same[0]
    return None

def apply_hls_metadata(info, b):
    """Master m3u8-dəki RESOLUTION/BANDWIDTH-i yt-dlp formatlarına bağlayır.
    YouTube manifest.googlevideo HLS və film saytlarının master playlistləri üçün ortaq yoldur."""
    try:
        url = str((b or {}).get("url") or "")
        if not re.search(r"(?i)\.m3u8(?:[?#]|$)", url) and not re.search(r"(?i)/manifest/(?:hls|hls_playlist)/", url):
            return info
        meta = fast_hls_meta(url, _hls_headers(b), timeout=4)
        if not meta.get("ok") or not meta.get("master"):
            return info
        variants = [v for v in (meta.get("variants") or []) if int(v.get("height") or 0) > 0]
        if not variants: return info
        info["_hls_variants"] = variants
        fmts = info.get("formats") or []
        if not fmts and info.get("url"): fmts = [info]
        for f in fmts:
            v = _hls_pick_variant(f, variants)
            if not v: continue
            h = int(v.get("height") or 0)
            if h:
                f["height"] = h
                if int(v.get("width") or 0): f["width"] = int(v["width"])
            if v.get("fps") and not num(f.get("fps")): f["fps"] = v["fps"]
            if v.get("hdr"): f["dynamic_range"] = "HDR"
            if v.get("codecs") and not f.get("vcodec"): f["vcodec"] = str(v["codecs"]).split(",")[0].strip()
            if not num(f.get("tbr")) and num(v.get("bandwidth")):
                f["tbr"] = round(num(v["bandwidth"]) / 1000.0, 3)
            f["_hls_variant"] = {k: v.get(k) for k in ("url", "height", "width", "fps", "hdr", "bandwidth", "codecs", "name")}
        # yt-dlp master-i tək formats kimi qaytarıbsa (height=0): display üçün variant formatlarını əlavə et.
        if not any(num(f.get("height")) for f in fmts):
            for v in variants:
                codecs = str(v.get("codecs") or "").split(",")
                vc = next((x.strip() for x in codecs if re.search(r"(?i)avc|hev|hvc|vp0?9|av01", x)), "")
                ac = next((x.strip() for x in codecs if re.search(r"(?i)mp4a|opus|ac-3|ec-3|vorbis", x)), "none")
                fmts.append({"url": v["url"], "protocol": "m3u8_native", "height": int(v["height"]),
                             "width": int(v.get("width") or 0), "fps": float(v.get("fps") or 0),
                             "vcodec": vc or "avc1", "acodec": ac or "none", "ext": "mp4",
                             "format_id": "", "tbr": round(num(v.get("bandwidth")) / 1000.0, 3),
                             "hls_bandwidth": num(v.get("bandwidth")) or 0,
                             "_hls_variant": {k: v.get(k) for k in ("url", "height", "width", "fps", "hdr", "bandwidth", "codecs", "name")},
                             "dynamic_range": "HDR" if v.get("hdr") else "SDR", "http_headers": {}})
        if fmts and not info.get("formats"):
            info["formats"] = fmts
        return info
    except Exception:
        return info

# YouTube audio itag-ləri: yt-dlp bəzən abr/tbr vermir. Nominal bitrate yalnız audio üçün fallback-dir;
# video itag/60FPS/HDR məntiqinə toxunmur.
YT_AUDIO_ITAG_BPS = {"139": 48, "140": 128, "141": 256, "249": 50, "250": 70, "251": 160,
                     "233": 48, "234": 128, "256": 192, "258": 384, "599": 32, "600": 64}
YT_AUDIO_NOTE_BPS = {"low": 64, "medium": 128, "high": 256}

def audio_nominal_bps(a):
    br = num(a.get("abr")) or num(a.get("tbr"))
    if br: return br
    fid = str(a.get("format_id") or "").split("-")[0]
    if fid in YT_AUDIO_ITAG_BPS: return YT_AUDIO_ITAG_BPS[fid]
    note = str(a.get("format_note") or "").lower()
    for k, v in YT_AUDIO_NOTE_BPS.items():
        if re.search(r"\b" + k + r"\b", note): return v
    return 0

def yt_url_meta(f):
    """YouTube HLS URL-indəki sgoap/sgovp: clen (bayt) və dur (saniyə) — manifest açmadan dəqiq metadata."""
    try:
        u = str((f or {}).get("url") or "")
        # YouTube HLS-də clen/dur query-də deyil, yolun içindədir:
        # .../sgoap/clen%3D1300631%3Bdur%3D213.159%3B.../playlist/index.m3u8
        z = urllib.parse.unquote(u)
        m = re.search(r"(?:^|[/;])clen=(\d+)(?:;|$|[/])", z)
        d = re.search(r"(?:^|[/;])dur=([\d.]+)(?:;|$|[/])", z)
        if m or d:
            return (int(m.group(1)) if m else 0), (float(d.group(1)) if d else 0.0)
    except Exception: pass
    return 0, 0.0

def fsize(f, dur):
    s = num(f.get("filesize")) or num(f.get("filesize_approx"))
    if not s:
        tbr = num(f.get("tbr"))
        if not tbr and f.get("vcodec") in (None, "none"): tbr = num(f.get("abr"))   # yalnız-səs axını: tbr yoxdursa abr (HLS/DASH/digər saytlarda tez-tez belə olur)
        if tbr and dur: s = tbr * 125 * dur
    return int(s or 0)

# Audio həcmi YouTube-dan başqa mənbələrdə: yt-dlp filesize/tbr/müddət vermirsə (HLS: info.duration yoxdur; düz fayl: filesize yoxdur)
_HLSD = {}
def _fmt_headers(f, extra=None):
    hd = {**(f.get("http_headers") or {}), **(extra or {})}
    if f.get("cookies"): hd["Cookie"] = f["cookies"]
    return hd

def _hls_like(f):
    """HLS manifest URL-i: yt-dlp protokolu, .m3u8/.txt uzantısı və ya helper-in yerli /m/<token> anbarı."""
    u = str((f or {}).get("url") or "")
    if not u: return False
    try: p = urllib.parse.urlsplit(u)
    except Exception: return False
    path = (p.path or "").lower()
    proto = str((f or {}).get("protocol") or "").lower()
    return ("m3u8" in proto or path.endswith((".m3u8", ".m3u", ".txt"))
            or (p.hostname in ("127.0.0.1", "localhost") and path.startswith("/m/")))

def _hls_pl(f):
    """HLS media playlist: (müddət cəmi, [(seqment url, müddət, byterange uzunluğu)]); canlı axın / alınmadı = (0, [])."""
    u = f.get("url")
    if not u or not _hls_like(f): return 0, []
    if u in _HLSD: return _HLSD[u]
    res = (0, [])
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=_fmt_headers(f)), timeout=7) as r:
            t = r.read(3_000_000).decode("utf-8", "replace")
        if "#EXT-X-ENDLIST" in t:
            segs, d, br = [], 0.0, 0
            for ln in t.splitlines():
                ln = ln.strip()
                if ln.startswith("#EXTINF:"):
                    m = re.match(r"#EXTINF:([\d.]+)", ln); d = float(m.group(1)) if m else 0.0
                elif ln.startswith("#EXT-X-BYTERANGE:"):
                    m = re.match(r"#EXT-X-BYTERANGE:(\d+)", ln); br = int(m.group(1)) if m else 0
                elif ln and not ln.startswith("#"):
                    segs.append((urllib.parse.urljoin(u, ln), d, br)); d = 0.0; br = 0
            res = (sum(x[1] for x in segs), segs)
    except Exception: pass
    if len(_HLSD) > 500: _HLSD.clear()
    _HLSD[u] = res
    return res

def hls_dur(f): return _hls_pl(f)[0]

_HLSSZ = {}       # seqment URL -> Content-Length (təkrar HEAD sorğularının qarşısını alır)
_HLS_FULL = {}    # manifest URL -> bütün seqmentlərin həcmi məlumdur (dəqiq cəm)

def hls_bandwidth(f):
    """Master #EXT-X-STREAM-INF-dən BANDWIDTH (bits/s), əvvəlcə AVERAGE-BANDWIDTH."""
    v = (f or {}).get("_hls_variant") or {}
    return num(v.get("bandwidth")) or num((f or {}).get("hls_bandwidth")) or 0

def _hls_variant_duration(f):
    v = (f or {}).get("_hls_variant") or {}
    u = str(v.get("url") or "")
    if not u: return 0
    try: return hls_dur({**(f or {}), "url": u, "protocol": "https"})
    except Exception: return 0

def _seg_size(f, u):
    if u in _HLSSZ: return _HLSSZ[u]
    try: n = head_size({**f, "url": u, "protocol": "https"})
    except Exception: n = 0
    if n > 0:
        if len(_HLSSZ) > 6000: _HLSSZ.clear()
        _HLSSZ[u] = n
    return int(n or 0)

def _hls_size_legacy(f, dur):
    """YouTube HLS üçün əvvəlki davranış qorunur (bu tapşırıq onlara toxunmur)."""
    d0, segs = _hls_pl(f)
    if not segs: return 0
    if all(x[2] for x in segs):
        _HLS_FULL[str((f or {}).get("url") or "")] = True
        return sum(x[2] for x in segs)
    idx = sorted({0, len(segs) // 2, len(segs) - 1})
    sz = [(head_size({**f, "url": segs[i][0], "protocol": "https"}), segs[i][1]) for i in idx]
    sz = [(b, t) for b, t in sz if b and t]
    if not sz: return 0
    return int(sum(b for b, _ in sz) / sum(t for _, t in sz) * (dur or d0))

def hls_size(f, dur):
    """Film HLS həcmi:
    1) bütün byterange-lər varsa dəqiq cəm;
    2) master BANDWIDTH varsa BANDWIDTH × müddət / 8;
    3) tam siyahı kiçikdirsə bütün seqmentlərin həcmi;
    4) böyük siyahıda bütün playlist boyunca stratifikasiyalı seqment nümunələrinin
       orta həcmi × seqment sayı (3 ədəd ilk/orta/son nümunəsi əvəzinə).
    Nəticə həqiqi seqment cəmi olmadıqda təxmini sayılır."""
    u = str((f or {}).get("url") or "")
    # YouTube HLS parsing/ölçüsü bu dəyişikliyin xaricindədir.
    if is_youtube(u) or is_yt_hls(u):
        return _hls_size_legacy(f, dur)
    d0, segs = _hls_pl(f)
    # Master #EXT-X-STREAM-INF varsa media playlist açılmadan da həcm BANDWIDTH × müddət / 8 ilə hesablanır.
    bw = hls_bandwidth(f)
    if bw:
        total_d = dur or d0 or num((f or {}).get("duration")) or 0
        if not total_d: total_d = _hls_variant_duration(f)
        if total_d: return int(bw * total_d / 8)
    if not segs: return 0
    if all(x[2] for x in segs):
        _HLS_FULL[u] = True
        return sum(x[2] for x in segs)
    n = len(segs)
    # Kiçik manifestlərdə hamısını yoxla; böyük filmdə 32 stratifikasiyalı seqment kifayətdir.
    if n <= 64:
        idx = list(range(n))
    else:
        need = 32
        idx = sorted({round(i * (n - 1) / (need - 1)) for i in range(need)})
    sz = []
    if idx:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            got = list(ex.map(lambda i: (_seg_size(f, segs[i][0]), segs[i][1]), idx))
        sz = [(b, t) for b, t in got if b > 0]
    if sz:
        # Bütün seqmentlər yoxlanıbsa dəqiq cəm; yoxsa orta seqment həcmi × seqment sayı.
        if len(idx) == n and len(sz) == n:
            _HLS_FULL[u] = True
            return int(sum(b for b, _ in sz))
        return int(sum(b for b, _ in sz) / len(sz) * n)
    return 0

def _hls_audio_hint(f):
    """HLS manifestinin seqment adları audio-only olduğunu göstərirmi (imageaud1 / audio...)."""
    try:
        if not _hls_like(f): return False
        _d, segs = _hls_pl(f)
        if not segs: return False
        return bool(re.search(r"(?:imageaud|/aud(?:io)?(?:[/_.\d]|$)|audio_only|/aac/)", str(segs[0][0]), re.I))
    except Exception:
        return False

def head_size(f):
    """Düz http(s) faylın real ölçüsü: Range 0-0 cavabının Content-Range / Content-Length başlığı; bilinmirsə 0."""
    u = f.get("url")
    if not u or str(f.get("protocol") or "") not in ("http", "https"): return 0
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=_fmt_headers(f, {"Range": "bytes=0-0"})), timeout=7) as r:
            m = re.search(r"/(\d+)\s*$", r.headers.get("Content-Range") or "")
            if m: return int(m.group(1))
            if r.status == 200: return int(r.headers.get("Content-Length") or 0)
    except Exception: pass
    return 0

def short_codec(c):
    c = str(c or "").lower()
    if not c or c == "none": return ""
    for k, v in (("avc", "H.264"), ("h264", "H.264"), ("hev", "H.265"), ("hvc", "H.265"), ("h265", "H.265"),
                 ("vp09", "VP9"), ("vp9", "VP9"), ("vp8", "VP8"), ("av01", "AV1"), ("av1", "AV1"),
                 ("mp4a", "AAC"), ("aac", "AAC"), ("opus", "Opus"), ("ec-3", "E-AC3"), ("ac-3", "AC3"),
                 ("vorbis", "Vorbis"), ("flac", "FLAC"), ("mp3", "MP3")):
        if c.startswith(k): return v
    return c.split(".")[0].upper()

def clampint(v, hi=16):
    """İstifadəçinin daxil etdiyi paralel axın sayı: 1..16 (aria2 -x həddi 16); yoxdursa 0 = standart."""
    try: n = int(v)
    except (TypeError, ValueError): return 0
    return min(max(n, 0), hi)

_AF = {"v": None}
def audio_formats():
    """Yalnız real dəstəklənən çıxış formatları: 'orijinal' həmişə; çevirmə üçün ffmpeg-də həmin kodlayıcı olmalıdır."""
    if _AF["v"]: return _AF["v"]
    out, ff = [["best", "Orijinal (çevirmədən)"]], shutil.which("ffmpeg")
    if ff:
        try: enc = subprocess.run([ff, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=10).stdout
        except Exception: enc = ""
        for fid, e, lab in (("mp3", "libmp3lame", "MP3"), ("flac", "flac", "FLAC"), ("opus", "libopus", "Opus"),
                            ("m4a", "aac", "M4A (AAC)"), ("vorbis", "libvorbis", "OGG (Vorbis)"), ("wav", "pcm_s16le", "WAV")):
            if re.search(rf"\s{e}\s", enc): out.append([fid, lab])
    _AF["v"] = out
    return out

AUTO_V, AUTO_A = 32, 32  # "avto": video 32 (YouTube HLS böyük parçaları üçün; düz axınlara təsir etmir),  audio 32 paralel parça (audio parçaları kiçikdir, 8 sorğu gecikmədən çətinliklə doyur)

# Digər saytlar (Rapidrame, Close və s.): host üzrə adaptiv paralellik. YouTube üçün köhnə AUTO_V/AUTO_A dəyişməyib.
SAFE_V, SAFE_A = 16, 8        # "avto" başlanğıc (əvvəl 16/32 idi - serverləri bloklayırdı)
BACKOFF = float(os.environ.get("IDM_BACKOFF", "4"))   # eksponensial gözləmə bazası (san)
# IDM_ADAPTIVE=1 olarsa köhnə yavaşlatma işə düşür (blokda gözləmə + paralelliyi azaltma). Defolt: SÖNÜK = həmişə tam sürət.
ADAPTIVE = os.environ.get("IDM_ADAPTIVE", "0") == "1"
SLOW_BPS = float(os.environ.get("IDM_YT_SLOW", "1500000"))   # B/s: YouTube parçalı axın bundan aşağı davamlı qalarsa təzə bağlantı (0 = sönük)
SLOW_AFTER, SLOW_WIN = 20.0, 12.0                          # başlanğıcdan sonra gözləmə / davamlı yavaşlıq müddəti (san)
MAX_TRIES = 5          # ardıcıl irəliləyişsiz cəhd həddi
MAX_TOTAL_TRIES = 12   # irəliləyiş olsa belə mütləq hədd
HIT_LIMIT, HIT_WINDOW = 6, 30.0   # 30 san ərzində 6 bloklanma əlaməti -> yavaşlat
# Avto-sürətləndirmə (YouTube xaric, parçalı HLS/DASH, istifadəçi say seçməyibsə): parça sürəti davamlı aşağı qalırsa paralel parça sayı 2x artırılır
# (gecikməsi yüksək serverlərdə kiçik parçalar 8-16 sorğu ilə doymur) və host üzrə yadda qalır. Sürətli saytlar (sürət həddindən yuxarı) toxunulmaz qalır.
NOACC_RE = re.compile(r"(?:^|\.)playmix\.uno$", re.I)
BOOST = os.environ.get("IDM_BOOST", "0") == "1"   # defolt SÖNÜK
BOOST_MAX, BOOST_VBPS, BOOST_MAXN = 64, float(os.environ.get("IDM_BOOST_VBPS", "3000000")), 5   # say tavanı / video "yavaş" həddi (B/s) / bir yükləmədə ən çox artırma
HOSTN = {}   # (host, audio?) -> öyrənilmiş paralel parça sayı
HOSTS, HLOCK = {}, threading.Lock()   # host -> çarpan (1.0 = tam sürət; blokda yarıya düşür, uğurda artır)
BLOCK_RE = re.compile(r"HTTP Error (?:403|429|5\d\d)|Too Many Requests|Connection reset|Remote end closed|timed out|"
                      r"Retrying fragment|Got server HTTP error|\[Errno 2\]|Fragment \d+ not found", re.I)

def host_of(url):
    try: return (urllib.parse.urlparse(url or "").hostname or "").lower()
    except ValueError: return ""

def host_scale(url):
    with HLOCK: return HOSTS.get(host_of(url), 1.0)

def host_penalize(url):
    if not ADAPTIVE: return
    with HLOCK: h = host_of(url); HOSTS[h] = max(0.15, HOSTS.get(h, 1.0) / 2)

def host_reward(url):
    with HLOCK: h = host_of(url); HOSTS[h] = min(1.0, HOSTS.get(h, 1.0) + 0.25)

# Bu CDN-də audio seqmentləri əsasən tək hostdadır (435), amma 2839 hostunda 0..560
# seqmentlərinin GÜZGÜSÜ var. 435 tək başına Cloudflare rate-limitinə (429) düşür:
# -N 8 → qısa 4-5 MB/s burst, sonra 100+ ədəd 429 və donma; -N 1 → ~1 MB/s.
# Həll: audio playlistini 2839/435 arasında paylaşdırıb -N 4 ilə yükləmək →
# ölçmə: 468/808 fraqment 25 saniyədə (~2 MB/s), cəmi 1 ədəd 429.
CDN_SINGLE_AUDIO = re.compile(r"(?:^|\.)cdnimages\d+\.cyou$", re.I)
CDN_AUDIO_PRIMARY = "435"     # bütün seqmentlər
CDN_AUDIO_MIRROR = "2839"     # 0..560 seqmentlərinin güzgüsü
CDN_AUDIO_MIRROR_MAX = 560

def _manifest_text(url):
    """Helper-in yerli /m/<token> manifestinin mətnini qaytarır (yoxdursa "")."""
    try:
        p = urllib.parse.urlsplit(url or "")
        if p.hostname not in ("127.0.0.1", "localhost") or not p.path.startswith("/m/"): return ""
        name = p.path[3:].split("?")[0]
        mans = globals().get("MANIFESTS") or {}
        lk = globals().get("MLOCK")
        if lk:
            with lk: ent = mans.get(name)
        else: ent = mans.get(name)
        return ent[2].decode("utf-8", "replace") if ent else ""
    except Exception: return ""

def audio_single_conn(url, depth=0, seen=None):
    """Yalnız audio: bu CDN-in audio axınıdır (video deyil). dl_args host güzgüsü ilə -N 4 verir.
    Video (audio=False) bu funksiyanı çağırmır, ona görə video sürəti dəyişmir."""
    if depth > 3: return False
    try: h = host_of(url)
    except Exception: h = ""
    if h and CDN_SINGLE_AUDIO.search(h): return True
    t = _manifest_text(url)
    if not t: return False
    seen = set() if seen is None else seen
    # master-də audio qrupu varsa yalnız audio variantlarına bax (video hostlarına toxunma)
    med = [ln for ln in t.splitlines() if ln.startswith("#EXT-X-MEDIA:") and "TYPE=AUDIO" in ln]
    if med:
        uris = []
        for ln in med:
            m = re.search(r'URI="([^"]+)"', ln)
            if m: uris.append(urllib.parse.urljoin(url, m.group(1)))
        return any(audio_single_conn(u, depth + 1, seen) for u in uris) if uris else False
    for m in re.finditer(r"https?://[^\s\"'<>]+", t[:300000]):
        u = m.group(0)
        try: q = urllib.parse.urlsplit(u)
        except ValueError: continue
        if q.hostname and CDN_SINGLE_AUDIO.search(q.hostname): return True
        if q.hostname in ("127.0.0.1", "localhost") and (q.path or "").startswith("/m/"):
            key = q.path[3:].split("?")[0]
            if key in seen: continue
            seen.add(key)
            if audio_single_conn(u, depth + 1, seen): return True
    return False

def _http_text(url, b):
    """Playlist mətnini CDN-dən (Referer/UA/Cookie ilə) oxuyur."""
    try:
        hd = {"User-Agent": str(b.get("userAgent") or "Mozilla/5.0")}
        if b.get("referer"): hd["Referer"] = str(b["referer"])
        ck = b.get("cookie") or ""
        if not ck and b.get("cookies"):
            ck = "; ".join(f"{c['name']}={c['value']}" for c in b["cookies"] if c.get("name") and c.get("value") is not None)
        if ck: hd["Cookie"] = ck
        with urllib.request.urlopen(urllib.request.Request(url, headers=hd), timeout=20) as r:
            return r.read(3_000_000).decode("utf-8", "replace")
    except Exception: return ""

def _store_m3u8(text):
    """Mətni helper-in yerli /m/<token> anbarına qoyub URL-ni qaytarır."""
    try:
        mans = globals().get("MANIFESTS")
        if mans is None: return ""
        name = secrets.token_hex(12) + ".m3u8"
        data = text.encode("utf-8")
        lk = globals().get("MLOCK")
        def add():
            while len(mans) > 800: mans.pop(next(iter(mans)), None)
            mans[name] = (time.time(), "application/vnd.apple.mpegurl", data)
        if lk:
            with lk: add()
        else: add()
        return f"http://127.0.0.1:{PORT}/m/{name}"
    except Exception: return ""

def _rotate_audio(text):
    """imageaud1_N seqmentlərini 2839 (cüt, N<=560) və 435 (qalan) arasında paylaşdırır."""
    out = []
    for ln in text.splitlines():
        m = re.match(r"(https://[^/]*?cdnimages)(\d+)(\.cyou/.*/imageaud1_(\d+)\.jpg)$", ln.strip())
        if m:
            n = int(m.group(4))
            host = CDN_AUDIO_MIRROR if (n <= CDN_AUDIO_MIRROR_MAX and n % 2 == 0) else CDN_AUDIO_PRIMARY
            out.append(f"{m.group(1)}{host}{m.group(3)}")
        else: out.append(ln)
    return "\n".join(out) + "\n"

def audio_rewrite_master(b, url):
    """Yalnız audio prosesi üçün: master-in audio variantlarını yerli, hostları paylaşdırılmış
    playlistlərlə əvəz edib yerli master URL-i qaytarır. Uyğun deyilsə "" (köhnə yol)."""
    try:
        text = _manifest_text(url)
        if not text:
            h = host_of(url)
            if not (h and CDN_SINGLE_AUDIO.search(h)): return ""
            text = _http_text(url, b)
        if not text or not text.lstrip().startswith("#EXTM3U") or "#EXT-X-MEDIA:" not in text: return ""
        out, found = [], False
        for ln in text.splitlines():
            if ln.startswith("#EXT-X-MEDIA:") and "TYPE=AUDIO" in ln:
                m = re.search(r'URI="([^"]+)"', ln)
                if not m: out.append(ln); continue
                au = urllib.parse.urljoin(url, m.group(1))
                at = _manifest_text(au) or _http_text(au, b)
                if not at: out.append(ln); continue
                if "imageaud1_" in at:
                    at = _rotate_audio(at); found = True
                nu = _store_m3u8(at)
                if not nu: out.append(ln); continue
                out.append(ln[:m.start(1)] + nu + ln[m.end(1):])
            elif ln and not ln.startswith("#"):
                v = ln.strip()
                if not re.match(r"^(?:https?://|/)", v): v = urllib.parse.urljoin(url, v)
                out.append(v)
            else: out.append(ln)
        if not found: return ""
        return _store_m3u8("\n".join(out) + "\n")
    except Exception: return ""

def dl_args(n, audio=False, url="", hs=False):
    """Paralel axın sayı: -N parçalı (HLS/DASH) axınlara, aria2c düz http(s) axınlara (yoxdursa tək bağlantı) tətbiq olunur."""
    if not url or is_youtube(url):   # YouTube: çox yüksək paralellik googlevideo-da 403/429
        # doğurur və yükləmə "dayanıb davam edir" kimi görünür. 12/8 + aqressiv retry.
        auto_n = 16 if audio else 16
        extra = ["--socket-timeout", "12", "--retries", "10", "--fragment-retries", "20",
                 "--retry-sleep", "http:exp=1:8", "--retry-sleep", "fragment:exp=1:8"]
        if not n: return ["-N", str(auto_n), *extra]
        c = ["-N", str(n), *extra]
    else:
        # playmix kimi .txt/.jpg seqmentli HLS-lər daxil: yt-dlp-nin native parça yükləyicisi (paralel -N).
        # ffmpeg downloader bu seqment uzantılarını rədd edir (ffmpeg 9: allowed_segment_extensions/extension_picky)
        # və tək bağlantı ilə işlədiyi üçün yavaşlayır, xətalı parçalarda səsdə boşluq yaradır.
        if audio and audio_single_conn(url):
            n = 6   # 2839/435 güzgü paylaşımı + Cloudflare 429 limitinə düşməyən paralellik
        else:
            with HLOCK: learned = HOSTN.get((host_of(url), bool(audio)))
            n = max(1, round((n or learned or (SAFE_A if audio else SAFE_V)) * host_scale(url)))
        c = ["-N", str(n), "--retry-sleep", "fragment:exp=1:30" if ADAPTIVE else "fragment:exp=1:8", "--retry-sleep", "http:exp=1:30" if ADAPTIVE else "http:exp=1:8",
             "--file-access-retries", "8", "--retry-sleep", "file_access:1"]
        # hotstream (beHLS): CDN-də bəzi fraqmentlər 404-dür. Onlara görə bütün filmi
        # yenidən yükləmək əvəzinə həmin 2 saniyəlik parçanı atlayırıq.
        c += ["--skip-unavailable-fragments"] if hs else ["--abort-on-unavailable-fragments"]
    if n > 1 and shutil.which("aria2c"):
        c += ["--downloader", "aria2c", "--downloader", "dash,m3u8:native", "--downloader-args", f"aria2c:-c -x {min(n, 16)} -s {min(n, 16)} -k 1M --file-allocation=none --http-accept-gzip=true --console-log-level=warn --summary-interval=0 --download-result=hide"]
    return c

class NoStreams(RuntimeError):
    """yt-dlp heç bir real video/audio axını qaytarmadı (məs. yalnız storyboard)."""

SUB_PREF = ("vtt", "srt", "ttml", "srv3", "srv2", "srv1", "json3", "ass")

# ---- Dil/rol tanıma: səs trekləri (YouTube dublyajı, HLS/DASH adlı trekləri) və subtitrlər üçün
_LN = {}
for _lc, _lw in {
    "en": "en english eng ingilis ingilisce ingilizce английский", "tr": "tr tur turkish turkce turkcesi turk türkçe türkcə турецкий",
    "az": "az aze azerbaijani azeri azerbaycan azerbaycanca azərbaycanca azərbaycan азербайджанский", "ru": "ru rus russian russkiy rusca ruscə русский русская",
    "ar": "ar ara arabic arapca ərəbcə arabca العربية", "fa": "fa fas per persian farsi فارسی", "es": "es spa spanish espanol español ispanca",
    "fr": "fr fra fre french francais français fransizca", "de": "de deu ger german deutsch almanca", "it": "it ita italian italiano italyanca",
    "pt": "pt por portuguese portugues português portuqalca", "nl": "nl nld dut dutch nederlands", "pl": "pl pol polish polski",
    "uk": "ukr ukrainian українська", "ja": "ja jpn japanese 日本語 japonca", "ko": "ko kor korean 한국어", "zh": "zh zho chi chinese mandarin cantonese 中文 国语 普通话 粤语",
    "hi": "hi hin hindi हिन्दी", "ro": "ro ron rum romanian", "el": "el ell gre greek", "he": "heb hebrew עברית", "sv": "sv swe swedish",
    "cs": "cs ces cze czech", "hu": "hu hun hungarian", "bg": "bg bul bulgarian", "id": "ind indonesian indonesia", "vi": "vi vie vietnamese",
    "th": "th tha thai", "ka": "ka kat geo georgian ქართული", "hy": "hy hye arm armenian հայերեն", "kk": "kk kaz kazakh", "uz": "uz uzb uzbek",
    "bn": "bn ben bengali", "ur": "ur urd urdu", "ms": "ms msa may malay", "fil": "fil tgl filipino tagalog", "da": "da dan danish", "no": "nor norwegian",
    "fi": "fi fin finnish", "sr": "srp serbian", "hr": "hrv croatian", "sk": "slk slo slovak", "ca": "cat catalan", "ta": "tam tamil", "te": "tel telugu",
}.items():
    for _lt in _lw.split(): _LN.setdefault(_lt, _lc)
del _lc, _lw, _lt

def _fold(t): return unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()

def lang_guess(*texts):
    """Mətndən (trek adı, format_note) dil kodu: 'Türkçe Dublaj' -> tr. Tanınmayan -> ''."""
    for t in texts:
        for tok in re.findall(r"[^\W_]+", str(t or "").lower()):
            c = _LN.get(tok) or _LN.get(_fold(tok))
            if c: return c
    return ""

def lang_code(v):
    """yt-dlp 'language' sahəsi: tr / tr-TR / tur -> kod; und və ya adlı mətn -> ''."""
    c = str(v or "").strip().replace("_", "-")
    if not re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*", c) or c.lower() in ("und", "mul", "zxx", "nan"): return ""
    b, rest = c.split("-")[0].lower(), c[len(c.split("-")[0]):]
    return (_LN.get(b, b) if len(b) == 3 else b) + rest

def audio_role(*texts):
    t = " ".join(str(x or "") for x in texts).lower()
    if re.search(r"descript|audiodesc|betimle|описан|visually", t): return "səs təsviri"
    if re.search(r"commentar|yorum|комментар", t): return "şərh"
    if re.search(r"dubbed[-\s]?auto|auto[-\s]?dub|avto[-\s]?dub|otomatik dublaj", t): return "avto dublyaj"
    if re.search(r"dubb|dublaj|dublyaj|dublaz|дубл|озвуч|doblaj|doppiag|synchron|\bdub\b", t): return "dublyaj"
    if re.search(r"original|orijinal|\borig\b|оригинал", t): return "orijinal"
    return ""

def audio_meta(a):
    """(dil kodu, rol, trek adı): language sahəsi -> trek adı -> format_id sırası ilə; heç biri tanınmasa dil boş."""
    note = str(a.get("format_note") or "").strip()
    lang = lang_code(a.get("language")) or lang_guess(a.get("language"), note) or lang_guess(a.get("format_id"))
    return lang, audio_role(note, a.get("language")), note

def audio_container(a):
    """Səs axınının konteyneri: audio-only mp4 -> M4A (video konteyneri adı səs üçün yanıltıcıdır)."""
    ext = str(a.get("ext") or "").lower()
    return "M4A" if ext in ("mp4", "m4a", "m4b") else "WEBM" if ext in ("webm", "weba") else ext.upper()

def audio_type(a):
    """Səs növü: kodek/konteyner, təkrarsız: AAC/M4A, Opus/WEBM, MP3."""
    return "/".join(dict.fromkeys(x for x in (short_codec(a.get("acodec")), audio_container(a)) if x))

def collect_subs(info):
    """Yalnız real mövcud subtitr trekləri: manual + avtomatik (orijinal) + avtomatik tərcümələr.
    Hər birinin həqiqi URL-i olmalıdır; heç bir dil uydurulmur."""
    def usable(lst): return [t for t in (lst or []) if isinstance(t, dict) and (t.get("url") or t.get("data"))]
    def entry(lang, lst, auto, translated=False):
        exts = [str(t.get("ext") or "") for t in lst]
        ext = next((e for e in SUB_PREF if e in exts), exts[0] if exts else "")
        name = str(next((t.get("name") for t in lst if t.get("name")), "") or "").strip()
        label = (name + f" [{lang}]") if name and name.lower() != lang.lower() else lang
        url = next((t.get("url") for t in lst if t.get("ext") == ext and t.get("url")), "")
        suffix = " · avto tərcümə" if translated else (" · avto" if auto else "")
        return {"id": ("a:" if auto else "m:") + lang, "lang": lang, "auto": auto,
                "translated": bool(translated), "ext": ext, "url": url,
                "dlang": lang_code(lang) or lang_guess(name, lang), "label": label + suffix}
    out = []
    manual = info.get("subtitles") or {}
    for lang, lst in manual.items():
        if lang == "live_chat" or not usable(lst): continue
        out.append(entry(lang, usable(lst), False))
    auto = {k: usable(v) for k, v in (info.get("automatic_captions") or {}).items() if k != "live_chat"}
    auto = {k: v for k, v in auto.items() if v}
    # YouTube: "-orig" açarları avtomatik yaradılan orijinal trekdir; qalanları avtomatik tərcümədir.
    orig_keys = {k for k in auto if str(k).endswith("-orig")}
    if auto and not orig_keys:
        vl = str(info.get("language") or "").split("-")[0]
        orig_keys = {k for k in auto if vl and str(k).split("-")[0] == vl and k not in manual}
        if not orig_keys:
            orig_keys = {next(iter(auto))}
    for k, lst in auto.items():
        out.append(entry(k, lst, True, k not in orig_keys))
    return out[:300]

def _site_scope(b, url=""):
    """Yalnız bu saytlar (və onların axın CDN-ləri). Bu CDN-lərin master-ında CODECS yoxdur →
    yt-dlp variantı səsli saya bilmir (səssiz yükləmə). Səhifə URL-i əsasdır: manifest çox vaxt
    lokal snapshot (127.0.0.1/m/...) kimi yoxlanılır."""
    try:
        b = b or {}
        hosts = [host_of(str(b.get("pageUrl") or "")), host_of(str(b.get("referer") or "")),
                 host_of(str(b.get("orig") or "")), host_of(str(url or b.get("url") or ""))]
        for h in hosts:
            if not h: continue
            if (re.search(r"(?:^|\.)dizipal[a-z0-9-]*\.[a-z]{2,}$", h)
                    or re.search(r"(?:^|\.)filmizlech[a-z0-9-]*\.[a-z]{2,}$", h)
                    or re.search(r"(?:^|\.)uk-traffic[a-z0-9-]*\.[a-z]{2,}$", h)
                    or h.endswith("ksdpictures.site")):
                return True
        return False
    except Exception:
        return False

def analyze(info, check=True, enrich=None):
    enrich = check if enrich is None else enrich   # enrich: səs axınının həcm/müddətini playlist/başlıqdan ölç (alive yoxlamasından asılı deyil)
    # Yuxarıdakı scope: master-da CODECS yoxdur → yt-dlp vcodec/acodec = "unknown" verir və
    # "HD" variantını birləşmiş (səsli) sayır; nəticədə səssiz fayl yüklənirdi.
    site_fix = bool(info.get("_idm_site"))
    if info.get("_type") == "playlist":
        info = next((e for e in info.get("entries") or [] if e), None) or {}
    fmts = [f for f in (info.get("formats") or []) if isinstance(f, dict)]
    if not fmts and info.get("url"): fmts = [info]
    dur = num(info.get("duration"))
    # HLS manifest-lərini arxa planda əvvəlcədən parse et: əsas keyfiyyət siyahısını bloklamır.
    for f in fmts[:8]:
        try:
            if "m3u8" in str(f.get("protocol") or "") or str(f.get("url") or "").split("?")[0].lower().endswith((".m3u8", ".txt")):
                prefetch_hls_meta(f.get("url"), {"User-Agent": FH_UA, "Referer": (f.get("http_headers") or {}).get("Referer", ""), "Cookie": f.get("cookies", "")})
        except Exception: pass
    def fdur(f): return (num(f.get("duration")) if f else None) or dur or 0   # format müddəti (yoxsa mənbənin müddəti); bilinmirsə 0
    def adur(f):   # audio/video format müddəti: URL sgoap/sgovp -> format/mənbə -> HLS manifest -> master variantı
        yd = yt_url_meta(f)[1]
        d = yd or fdur(f) or (hls_dur(f) if _hls_like(f) else 0)
        if not d and (f or {}).get("_hls_variant"): d = _hls_variant_duration(f)
        return d
    def asize(f, d):   # audio həcmi: URL clen -> dəqiq/approx metadata -> YouTube itag/bitrate × klip müddəti
        s = yt_url_meta(f)[0] or fsize(f, d)
        if not s and yt_mode:
            bps = audio_nominal_bps(f)
            if bps and d: s = int(bps * 125 * d)
        return int(s or 0)
    video, audio, unk = [], [], []
    skip = {"storyboard": 0, "no_url": 0, "drm": 0}
    for f in fmts:
        note = str(f.get("format_note") or "").lower()
        if f.get("ext") == "mhtml" or str(f.get("protocol") or "").startswith("mhtml") or "storyboard" in note:
            skip["storyboard"] += 1; continue
        if f.get("has_drm"): skip["drm"] += 1; continue
        if not (f.get("url") or f.get("fragments") or f.get("manifest_url")): skip["no_url"] += 1; continue
        vc, ac = f.get("vcodec"), f.get("acodec")
        if vc == "images": continue
        h, w = num(f.get("height")) or 0, num(f.get("width")) or 0
        if vc == "none" or f.get("video_ext") == "none" or f.get("resolution") == "audio only":
            if ac != "none": audio.append(f)
        elif h >= 1:
            if min(w or h, h) < 32: continue  # qara / kiçik ölçülü səhv axınlar
            video.append((int(h), f))
        elif _hls_like(f) and _hls_audio_hint(f):
            audio.append(f)   # playmix imageaud1 HLS: səs manifesti, video keyfiyyəti deyil
        elif f.get("ext") in AUDIO_EXT: audio.append(f)
        else: unk.append(f)  # hündürlüyü bilinməyən axın (RESOLUTION olmayan HLS variantı, tək mp4 və s.)

    ff = bool(shutil.which("ffmpeg"))
    memo, mlock = {}, threading.Lock()
    msize, dead, trust = {}, {}, [False]   # msize: url -> serverin bildirdiyi tam ölçü; dead: url -> rədd HTTP kodu; trust: yoxlama bütün axınları rədd edəndə

    def alive(f):  # axın həqiqətən açılırmı (403/404/410 olanlar çıxarılır)
        u = f.get("url")
        if not check or trust[0] or not u or str(f.get("protocol") or "") not in ("http", "https"): return True
        with mlock:
            if u in memo: return memo[u]
        hd = {**(f.get("http_headers") or {}), "Range": "bytes=0-0"}
        if f.get("cookies"): hd["Cookie"] = f["cookies"]
        tot = 0
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=hd), timeout=7) as r:
                ok = True
                m = re.search(r"/(\d+)\s*$", r.headers.get("Content-Range") or "")   # 206: "bytes 0-0/TAM_ÖLÇÜ"
                if m: tot = int(m.group(1))
                elif r.status == 200: tot = int(r.headers.get("Content-Length") or 0)   # server Range-i saymayıb: bütün fayl
        except urllib.error.HTTPError as e:
            ok = e.code not in (403, 404, 410)
            if not ok:
                with mlock: dead[u] = e.code
        except Exception: ok = True
        with mlock:
            memo[u] = ok
            if ok and tot > 1: msize[u] = tot
        return ok

    def xsize(f):   # (ölçü, dəqiqdirmi): filesize -> server Range ölçüsü -> HLS seqmentləri -> bitrate×müddət
        s0, ex = fsize(f, dur), fsize_exact(f)
        if not ex:
            with mlock: m = msize.get(f.get("url"))
            if m: return m, True
        # YouTube HLS URL-ində clen varsa bu, serverin manifestdəki dəqiq bayt sayıdır;
        # yt-dlp-nin təxmini tbr/filesize_approx dəyərindən üstündür.
        if not ex:
            ysz = yt_url_meta(f)[0]
            if ysz > 0: return ysz, True
        # Yerli /m/<token> və xarici HLS manifestləri: yt-dlp filesize vermirsə seqment müddəti/bitrate-indən
        # real həcm hesablanır. Byterange varsa dəqiq, yoxsa təxmini (~) göstərilir.
        if (not s0 or not ex) and _hls_like(f):
            hd = fdur(f) or hls_dur(f)
            hs = hls_size(f, hd) if hd else 0
            if hs > 0: return hs, _hls_exact(f)
        # Düz http(s) axınında yt-dlp ölçü vermirsə serverin Content-Range/Content-Length-i dəqiq ölçüdür.
        if not s0 and str(f.get("protocol") or "") in ("http", "https") and not _hls_like(f):
            hs = head_size(f)
            if hs > 0: return hs, True
        return s0, ex

    def rank(f):
        sdr = 0 if str(f.get("dynamic_range") or "SDR").upper() != "SDR" else 1
        exact = 1 if fsize_exact(f) else 0   # eyni variantda dəqiq filesize verən formatı üstün tut
        return (sdr, exact, num(f.get("fps")) or 0, num(f.get("tbr")) or 0)

    def audio_rank(vf):
        ve = vf.get("ext")
        def k(a):
            compat = 1 if (ve in ("mp4", "m4v") and a.get("ext") == "m4a") or (ve == "webm" and a.get("ext") in ("webm", "opus", "weba")) else 0
            exact = 1 if fsize_exact(a) else 0   # HLS-də ölçüsüz default trekdənsə dəqiq filesize-lı uyğun trek
            # ksdpictures: manifestdə DEFAULT=YES olan trek "Original"-dir (Türkçe dub deyil) — avto onu seçsin
            orig = 1 if (site_fix and audio_meta(a)[1] == "orijinal") else 0
            return (compat, exact, orig, num(a.get("language_preference")) or 0, num(a.get("abr")) or num(a.get("tbr")) or 0)
        return sorted(audio, key=k, reverse=True)

    def sel(f):
        i = str(f.get("format_id") or "")
        return i if re.fullmatch(r"[\w.\-]+", i) else ""

    def is_hdr(f):   # YouTube bəzən dynamic_range yerinə yalnız format_note-da HDR yazır
        dr = str(f.get("dynamic_range") or "").strip().upper()
        return (bool(dr) and dr != "SDR") or "hdr" in str(f.get("format_note") or "").lower()

    def vfps(f):
        x = num(f.get("fps")) or 0
        return int(round(x)) if x else 0

    def codec_of(f):
        c = short_codec(f.get("vcodec"))
        return c or str(f.get("vcodec") or "").split(".")[0].upper()

    # YouTube: BÜTÜN real variantlar (hündürlük × FPS × HDR/SDR × kodek). Digər saytlarda köhnə bir-per-hündürlük davranışı saxlanılır.
    yt_mode = ("youtube" in str(info.get("extractor_key") or info.get("extractor") or "").lower()
               or "youtube.com" in str(info.get("webpage_url") or info.get("original_url") or "").lower())
    # Universal FPS: yt-dlp fps verməyən real video formatlarını ffprobe ilə tamamla (YouTube-da fps adətən var; check=False)
    if check:
        miss = [f for _, f in video if not num(f.get("fps")) and f.get("url")][:8]
        if miss:
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex_f:
                found = list(ex_f.map(lambda f: float((probe_video(f) or {}).get("fps") or 0), miss))
            for f, fp in zip(miss, found):
                if fp > 0: f["fps"] = fp
    by_q = {}
    if yt_mode:
        for h, f in video:
            by_q.setdefault((int(h), vfps(f), is_hdr(f), codec_of(f)), []).append(f)
    else:
        for h, f in video:
            by_q.setdefault((int(h), 0, False, ""), []).append(f)

    def build(key):
        h, kfps, khdr, kcodec = key
        fs = by_q[key]
        # Bu saytlarda ayrıca səs trekləri varsa, kodeki bilinməyən / audio_ext="none" olan variant
        # səssiz videodur: onu birləşmiş saymaq səssiz fayl verirdi. Digər saytlarda davranış dəyişmir.
        def vo(f):
            ac = f.get("acodec")
            return ac == "none" or (site_fix and audio and
                                    (ac in (None, "unknown") or str(f.get("audio_ext") or "").lower() == "none"))
        comb = sorted([f for f in fs if not vo(f)], key=rank, reverse=True)
        vonly = sorted([f for f in fs if vo(f)], key=rank, reverse=True)
        ws = [num(f.get("width")) or 0 for f in fs]
        short = min(h, max(ws)) if max(ws) else h
        fps = kfps if yt_mode else max((num(f.get("fps")) or 0 for f in fs), default=0)
        res, vid, vf0, est = None, "", None, True
        vsel = ""  # yalnız görüntü (səssiz) seçimi: ayrıca video-only axın mövcuddursa
        for vf in vonly[:3]:
            if alive(vf):
                i = sel(vf); vsel = (i + "/" if i else "") + f"bv[height={h}]"; break
        for f in comb[:3]:
            if alive(f):
                i = sel(f); vf0 = f
                sz, ex = xsize(f)
                res = ((i + "/" if i else "") + f"b[height={h}]", sz); est = not ex; break
        if not res and ff and audio:
            for vf in vonly[:3]:
                if not alive(vf): continue
                af = next((a for a in audio_rank(vf)[:4] if alive(a)), None)
                if not af: continue
                i, j = sel(vf), sel(af)
                vid, vf0 = i, vf
                (sv, ev), (sa, ea) = xsize(vf), xsize(af)
                res = ((f"{i}+{j}/" if i and j else "") + f"bv[height={h}]+ba", sv + sa); est = not (ev and ea); break
        if not res: return None
        if not yt_mode and vf0 and _hls_like(vf0): short = quality_class(max(ws), h) or short
        hdr = khdr if yt_mode else bool(vf0 and is_hdr(vf0))   # digər saytlarda köhnə davranış: seçilmiş axının HDR-i
        codec = kcodec if yt_mode else codec_of(vf0) if vf0 else ""
        fps_txt = f" {int(round(fps))}FPS" if fps else ""   # aşkarlanan FPS həmişə etiketdə (10/24/30/50/60/120...)
        tag = f"{int(short)}p{fps_txt}" + (" HDR" if hdr else "")
        lab = " • ".join(x for x in [short_codec(vf0.get("vcodec")) if vf0 else "", str(vf0.get("ext") or "").upper() if vf0 else ""] if x)
        safe = re.sub(r"[^a-z0-9]+", "-", codec.lower()).strip("-") or "v"
        return {"id": f"v{h}-{fps or 0}-{'hdr' if hdr else 'sdr'}-{safe}", "tag": tag, "label": lab or "video + səs",
                "selector": res[0], "audio": False, "size": res[1], "est": est, "height": h,
                "fps": int(round(fps)) if fps else 0, "hf": fps >= 55, "hdr": bool(hdr), "codec": codec,
                "hdrLabel": str(vf0.get("dynamic_range") or "") if hdr and vf0 else "",
                "url": str(vf0.get("url") or "") if vf0 else "",
                "vid": vid, "vsel": vsel, "dur": adur(vf0) if vf0 else 0}

    qkeys = sorted(by_q, key=lambda k: (-k[0], -k[1], 0 if k[2] else 1, k[3]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        opts = [o for o in ex.map(build, qkeys) if o]
    trusted = False
    if not opts and video and dead:   # yalnız əks halda "Auto"/xəta olacaqdı: işləyən nəticə dəyişmir
        trust[0] = trusted = True
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            opts = [o for o in ex.map(build, qkeys) if o]
    if not opts and unk:  # hündürlük məlum deyil -> bitrate ilə keyfiyyət siyahısı
        us = sorted(unk, key=lambda x: num(x.get("tbr")) or 0, reverse=True)
        def uinfo(f):   # real məlumat: müddət, həcm və ffprobe (en/hündürlük/kodek/fps); HLS-də də real height
            pv = probe_video(f) if (check or _hls_like(f)) else {}
            d = adur(f) or num(pv.get("dur")) or 0
            s = yt_url_meta(f)[0] or fsize(f, d); est = not fsize_exact(f) and not (yt_url_meta(f)[0] > 0)
            if _hls_like(f) and (not s or not fsize_exact(f)):
                hs = hls_size(f, d) if d else 0
                if hs: s, est = hs, not _hls_exact(f)
            elif not s and check: s, est = head_size(f), False
            if not s and num(pv.get("size")): s, est = int(num(pv.get("size"))), True
            return {"d": d, "s": s, "est": est, "pv": pv}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex_u: ui_ = list(ex_u.map(uinfo, us[:6])) + [None] * max(0, len(us) - 6)
        for i, f in enumerate(us):
            if not alive(f): continue
            fid = sel(f)
            tbr = num(f.get("tbr"))
            ux = ui_[i] or {"d": adur(f), "s": fsize(f, adur(f)), "est": not fsize_exact(f), "pv": {}}; pv = ux["pv"]
            uf = num(f.get("fps")) or pv.get("fps", 0) or 0
            ftxt = f" {int(round(uf))}FPS" if uf else ""
            qh = quality_class(pv.get("w"), pv.get("h")) if pv.get("h") else 0
            tag = (f"{int(qh)}p" if qh else (f"{int(tbr)}k" if tbr else ("HLS" if _hls_like(f) else ("Auto" if i == 0 else f"#{i + 1}")))) + ftxt
            need_audio = f.get("acodec") == "none" and ff
            selector = (fid + ("+ba" if need_audio else "")) if fid else "bv*+ba/b"
            vc = f.get("vcodec"); vc = "" if str(vc or "").lower() in ("", "none", "unknown") else vc
            opts.append({"dur": ux["d"] or adur(f), "id": f"u{i}", "tag": tag, "label": " • ".join(x for x in [short_codec(vc) or short_codec(pv.get("vc")), str(f.get("ext") or "").upper()] if x) or "video + səs",
                         "selector": selector, "audio": False, "size": ux["s"], "est": ux["est"], "height": int(qh or 0),
                         "fps": int(round(uf)) if uf else 0, "hf": uf >= 55, "hdr": is_hdr(f), "codec": short_codec(vc),
                         "vid": "", "vsel": fid if (f.get("acodec") == "none" and fid) else ""})
    # Son çarə "Auto" YALNIZ real axın varsa. Əvvəl yalnız storyboard olanda da "Auto" uydurulurdu (YouTube-da əsas səbəb).
    if not opts and (video or audio or unk) and ff:
        opts.append({"dur": dur or 0, "id": "auto", "tag": "Auto", "label": "Auto · ən yaxşı keyfiyyət", "selector": "bv*+ba/b",
                     "audio": False, "size": 0, "height": 0, "vid": "", "vsel": ""})
    if not opts:
        if skip["drm"] and not (video or audio or unk):
            raise RuntimeError("Axın DRM ilə qorunur (Widevine/PlayReady/FairPlay): yüklənə bilməz")
        if not (video or audio or unk):
            raise NoStreams("yt-dlp heç bir real video/audio axını qaytarmadı (yalnız şəkil/storyboard)")
        raise RuntimeError("Həm səs, həm görüntü olan keyfiyyət tapılmadı" + ("" if ff else " (ffmpeg quraşdırılmayıb: sudo apt install ffmpeg)"))
    # Ayrıca səs trekləri (dil, kodek, bitrate) - istifadəçi seçə bilsin
    t_role, t_lang = audio_role(info.get("title")), lang_guess(info.get("title"))
    def role_of(lg, rl):   # trekin öz rolu yoxdursa: başlıqdakı "TR Dublaj"/"Orijinal" (yalnız dil uyğundursa / tək trek olduqda)
        if rl or t_role not in ("dublyaj", "orijinal"): return rl
        if t_role == "dublyaj": return "dublyaj" if (not lg or not t_lang or lg.split("-")[0] == t_lang) else rl
        return "orijinal" if len(audio) == 1 else rl
    groups = {}   # hər dil/rol üçün ən yaxşı trek (YouTube: onlarla dublyaj dili)
    for a in sorted(audio, key=lambda x: (num(x.get("language_preference")) or 0, num(x.get("abr")) or num(x.get("tbr")) or 0), reverse=True):
        if not sel(a): continue
        lg, rl, nt = audio_meta(a)
        parts = [x.strip() for x in nt.split(",") if x.strip()]
        base = parts[0] if parts else ""
        qual = parts[1] if len(parts) > 1 else (base.lower() if base.lower() in ("low", "medium", "high") else "")
        # "Default, low" və "Default, high" ayrı qruplardır; əvvəl hər ikisi "Default" altında birləşirdi.
        groups.setdefault((lg or qual or base, rl, nt or qual or base), []).append(a)
    def best(g):
        for a in g[:3]:
            if alive(a): return a
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex_a: picked = list(ex_a.map(best, list(groups.values())[:120]))
    audios = []
    auto_id = sel(picked[0]) if picked and picked[0] else ""   # "Avto": yt-dlp-nin ba seçimi = sıralamada ilk trek
    for a in picked:
        if not a: continue
        lang, role, note = audio_meta(a)
        role = role_of(lang, role)
        abr, ch = (audio_nominal_bps(a) if yt_mode else (num(a.get("abr")) or num(a.get("tbr")))), a.get("audio_channels")
        ad = adur(a)
        parts = [x.strip() for x in note.split(",") if x.strip()]
        base = parts[0] if parts else ""
        qual = parts[1] if len(parts) > 1 else (base.lower() if base.lower() in ("low", "medium", "high") else "")
        qtag = qual if qual.lower() in ("low", "medium", "high") else ""
        lab = " • ".join(x for x in [lang or base or f"#{len(audios) + 1}", qtag, role, audio_type(a),
                                    f"{int(abr)}k" if abr else "", f"{int(ch)}ch" if ch else ""] if x)
        exact_url = yt_url_meta(a)[0] > 0
        audios.append({"id": sel(a), "label": lab, "lang": lang or base, "name": note, "role": role, "type": audio_type(a), "auto": sel(a) == auto_id,
                       "abr": int(abr or 0), "size": asize(a, ad), "est": (not fsize_exact(a)) and not exact_url, "dur": ad, "url": str(a.get("url") or "")})
    audios.sort(key=lambda x: (0 if x["role"] == "orijinal" else 1, str(x["lang"]).lower()))   # əvvəl orijinal, sonra dil üzrə
    if site_fix:   # "Avto" = manifestin defolt treki (DEFAULT=YES → Original), dub deyil
        _o = next((x for x in audios if x["role"] == "orijinal"), None)
        if _o:
            for x in audios: x["auto"] = (x is _o)
    aq, seenq = [], set()  # mənbədəki BÜTÜN audio axınları (heç biri gizlədilmir/uydurulmur)
    def a_extra(a):   # (ölçü, müddət, təxmini?): URL clen -> HLS seqmentləri -> bitrate -> faylın real ölçüsü
        d = adur(a)
        ys = yt_url_meta(a)[0]
        if ys: return ys, d, False
        if _hls_like(a) and d and not fsize_exact(a):
            hs = hls_size(a, d)
            if hs: return hs, d, not _hls_exact(a)
        s = fsize(a, d)
        if not s and yt_mode:
            s = asize(a, d)
        if s: return s, d, not fsize_exact(a)
        if d:
            s = hls_size(a, d)
            if s: return s, d, not _hls_exact(a)
        return head_size(a), d, False
    # HLS seqmentlərindən ölçü/müddət həmişə hesablanır (yerli /m/<token> daxil); düz fayllarda
    # isə yalnız check/enrich rejimində şəbəkəyə baxılır.
    need = [a for a in audio if (_hls_like(a) or not fsize(a, dur) or not adur(a)) and (enrich or _hls_like(a))][:40]
    if need:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex_s: a_ex = {id(a): r for a, r in zip(need, ex_s.map(a_extra, need))}
    else: a_ex = {}
    def alive_c(f):   # yeni şəbəkə sorğusu göndərmir: artıq yoxlananın nəticəsi (yoxlanmayan = mövcud sayılır)
        with mlock: return memo.get(f.get("url"), True)
    for a in sorted(audio, key=lambda x: (audio_meta(x)[0] or str(x.get("format_note") or ""), -(num(x.get("abr")) or num(x.get("tbr")) or 0))):
        aid = sel(a)
        if not aid or aid in seenq or not alive_c(a): continue
        seenq.add(aid)
        abr, ch = (audio_nominal_bps(a) if yt_mode else (num(a.get("abr")) or num(a.get("tbr")))), a.get("audio_channels")
        lg, rl, nt = audio_meta(a)
        rl = role_of(lg, rl)
        ax = a_ex.get(id(a))
        aq_size = (ax[0] if ax else 0) or asize(a, dur)
        aq_est = (ax[2] if ax else ((not fsize_exact(a)) and not (yt_url_meta(a)[0] > 0))) if (ax or aq_size) else True
        aq_dur = adur(a) or (ax[1] if ax else 0)
        ap = [x.strip() for x in nt.split(",") if x.strip()]
        aq_lang = lg or (ap[1] if len(ap) > 1 else (ap[0] if ap else ""))
        qtag = ""
        if len(ap) > 1 and ap[1].lower() in ("low", "medium", "high"): qtag = ap[1].lower()
        aq.append({"id": aid, "lang": aq_lang, "name": nt, "quality": qtag, "abr": int(abr or 0), "size": aq_size, "est": aq_est, "dur": aq_dur, "role": rl, "type": audio_type(a), "url": str(a.get("url") or ""),
                   "label": " • ".join(x for x in [qtag, rl, audio_type(a),
                                                  f"{int(abr)}k" if abr else "", f"{int(ch)}ch" if ch else ""] if x)})
        if len(aq) >= 300: break
    hs_ = sorted({h for h, _ in video}, reverse=True)
    diag = (f"formatlar={len(fmts)} · video={len(video)}" + (f" ({hs_[-1]}p–{hs_[0]}p)" if hs_ else "") + f" · audio={len(audio)} · hündürlüksüz={len(unk)}"
            f" · atılan: storyboard={skip['storyboard']}, URL-siz={skip['no_url']}, DRM={skip['drm']}"
            + (" · yoxlamada rədd: " + ", ".join(f"HTTP {c}×{n}" for c, n in sorted(collections.Counter(dead.values()).items())) if dead else ""))
    caps = {"ffmpeg": ff, "audioOnly": bool(audio) or (ff and bool(video or unk)), "audioSeparate": bool(audio), "videoOnly": any(o.get("vsel") for o in opts),
            "audioFormats": audio_formats()}
    out = {"title": info.get("title"), "options": opts, "audios": audios, "subs": collect_subs(info), "caps": caps, "diag": diag, "aq": aq, "duration": dur or 0}
    if trusted: out["trusted"] = diag
    return out

TAGS = {}
PROBE_CACHE = {}
PLOCK = threading.Lock()

def _probe_run(yt, b, strat):
    """Bir strategiya ilə yt-dlp -J + analyze. Nəticə: {s, res|None, err, warn}"""
    b2, ea, use_ck = strat_args(b, strat)
    ck = write_cookies(b["cookies"]) if (use_ck and b.get("cookies")) else None
    out = {"s": strat, "res": None, "err": "", "warn": []}
    try:
        p = subprocess.run([yt, "-J", "--no-playlist", "--color", "never", *yt_args(b["url"]), *ea, *common_args(b2, ck), b["url"]],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        out["err"] = "vaxt aşdı"; return out
    finally: rm(ck)
    out["warn"] = [ln.split("WARNING:", 1)[1].strip()[:240] for ln in p.stderr.splitlines()
                   if "WARNING:" in ln and re.search(r"JavaScript|JS runtime|PO Token|n challenge|SABR|signature|DRM", ln, re.I)]
    if p.returncode != 0:
        errs = [ln for ln in p.stderr.splitlines() if "ERROR:" in ln]
        out["err"] = errs[-1].split("ERROR:", 1)[1].strip()[:200] if errs else "yt-dlp məlumat ala bilmədi"; return out
    # YouTube: keyfiyyət siyahısı üçün HLS audio manifest-lərini sinxron gözləmirik;
    # metadata/size lazım olsa sonrakı açılışda keşdən tamamlanır.
    try:
        info = json.loads(p.stdout)
        try: info = apply_hls_metadata(info, b2)
        except Exception: pass
        res = analyze(info, check=False, enrich=False)
    except ValueError: out["err"] = "cavab oxunmadı"; return out
    except RuntimeError as e: out["err"] = str(e)[:200]; return out
    out["res"] = res
    return out

def _maxh(r): return max((o.get("height") or 0 for o in r["options"]), default=0)

def merge_youtube(runs):
    """Strategiya nəticələrini birləşdir: baza = ən yüksək keyfiyyət verən.
    Bütün hündürlük/FPS/HDR/kodek variantları saxlanılır; eyni variant başqa strategiyada varsa baza üstünlük təşkil edir."""
    order = "ABCD"
    oks = [r for r in runs if r["res"]]
    base = max(oks, key=lambda r: (_maxh(r["res"]), sum(1 for o in r["res"]["options"] if o.get("height")), -order.index(r["s"])))
    res = dict(base["res"]); res["strat"] = base["s"]
    def vkey(o):
        return (int(o.get("height") or 0), int(o.get("fps") or 0), bool(o.get("hdr")),
                str(o.get("codec") or o.get("label") or ""))
    byv = {}
    for r in sorted(oks, key=lambda r: (r is not base, order.index(r["s"]))):
        for o in r["res"]["options"]:
            k = vkey(o)
            if k not in byv:
                byv[k] = {**o, "strat": o.get("strat") or r["s"]}
    if byv:
        res["options"] = [byv[k] for k in sorted(byv, key=lambda k: (-k[0], -k[1], 0 if k[2] else 1, k[3]))]
        res["caps"] = {**res["caps"], "videoOnly": any(o.get("vsel") for o in res["options"])}
    return res

def probe_youtube(yt, b):
    # 4 strategiya paralel; biri yavaş olsa da tam keyfiyyət siyahısı üçün hamısı gözlənilir.
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(YT_STRATS)) as ex:
        runs = sorted(ex.map(lambda st: _probe_run(yt, b, st), YT_STRATS), key=lambda r: r["s"])
    if not any(r["res"] for r in runs):
        errs = [f"{r['s']}: {r['err']}" for r in runs if r["err"]]
        raise RuntimeError("YouTube formatları alınmadı. " + " | ".join(errs)[:400] + ". " + (" | ".join(yt_health()) or "yt-dlp-ni yeniləyin: pipx upgrade yt-dlp"))
    res = merge_youtube(runs)
    summ = ", ".join(f"{r['s']} ({YT_STRATS[r['s']][2]})=" + (f"{_maxh(r['res'])}p/{len(r['res']['options'])}" if r["res"] else "xəta") for r in runs)
    res["strats"] = summ
    warns = yt_health()
    maxh, heights = _maxh(res), {_maxh(r["res"]) for r in runs if r["res"]}
    if len(heights) > 1 or maxh <= 480:   # strategiyalar fərqlənir və ya nəticə zəifdir: istifadəçi səbəbi görsün
        warns.append("YouTube yoxlama nəticələri: " + summ)
    if maxh <= 480:
        pw = [w for r in runs for w in r["warn"]][:3]
        warns += pw
        if any("PO Token" in w or "SABR" in w for w in pw):
            warns.append("YouTube yüksək keyfiyyət üçün PO Token tələb edir: pipx inject yt-dlp bgutil-ytdlp-pot-provider (və provayder serveri)")
    if warns: res = {**res, "warnings": warns}
    return res

PLOCKS = {}


# ---- hotstream.club (beHLS): /list və /m3u manifestləri YALNIZ "Accept: */*" ilə verilir.
# Brauzer/yt-dlp "Accept: text/html..." göndərdikdə server 404 qaytarır; ffmpeg isə Accept
# göndərmədiyi üçün variant manifesti 404 olur. Ona görə yalnız bu host üçün manifesti
# helper özü oxuyur və yt-dlp-yə yerli .m3u8 snapshot verilir. Digər hostlara toxunmur.
_HS_HOST = re.compile(r"(?:^|\.)hotstream\.club$", re.I)

def _hs_snap(data):
    name = secrets.token_hex(12) + ".m3u8"
    now = time.time()
    with MLOCK:
        for k in [k for k, v in MANIFESTS.items() if now - v[0] > 86400]: MANIFESTS.pop(k, None)
        while len(MANIFESTS) > 800: MANIFESTS.pop(next(iter(MANIFESTS)), None)
        MANIFESTS[name] = (now, "application/vnd.apple.mpegurl", data)
    return f"http://127.0.0.1:{PORT}/m/{name}"

def _hs_fetch(url, b):
    # Bu host yalnız "Accept: */*" + hotstream Referer ilə manifest verir; saytın öz
    # Referer-i (yfilmizle.com) "Video Not Found!" qaytarır.
    hdr = {"User-Agent": str((b or {}).get("userAgent") or "Mozilla/5.0"), "Accept": "*/*",
           "Referer": "https://hotstream.club/"}
    ref = str((b or {}).get("referer") or "")
    try:
        rh = (urllib.parse.urlsplit(ref).hostname or "").lower()
    except Exception:
        rh = ""
    if ref and _HS_HOST.search(rh): hdr["Referer"] = ref
    req = urllib.request.Request(url, headers=hdr)
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read(8_000_000)

_HS_MARK = re.compile(r"hotstream\.club|seyret\d*\.top|BEpeak HLS Stream System", re.I)

def _hs_snap_flag(url):
    """URL yerli manifest snapshot-ıdırsa və içində bu axının izi varsa True."""
    m = re.match(r"^http://127\.0\.0\.1:\d+/m/([\w.]+)$", str(url or ""))
    if not m: return False
    with MLOCK: ent = MANIFESTS.get(m.group(1))
    if not ent: return False
    try: return bool(_HS_MARK.search(ent[2][:300000].decode("utf-8", "ignore")))
    except Exception: return False

_PV_HOST = re.compile(r"(?:^|\.)pilavyerplay\.top$", re.I)

def _pv_scope(url):
    """Yalnız pilavyerplay.top (jetfilmizle pleyeri) — AES-128 + .txt seqmentlər."""
    try: h = (urllib.parse.urlsplit(str(url or "")).hostname or "").lower()
    except Exception: return False
    return bool(_PV_HOST.search(h))

_PV_MARK = re.compile(r"pilavyer|stream_v\d|stream_a\d|group_aud", re.I)

def _pv_snap_flag(url):
    """Extension-in yerli snapshot-ı bu axına aiddirmi (master/a variant/key)."""
    m = re.match(r"^http://127\.0\.0\.1:\d+/m/([\w.]+)$", str(url or ""))
    if not m: return False
    with MLOCK: ent = MANIFESTS.get(m.group(1))
    if not ent: return False
    try: return bool(_PV_MARK.search(ent[2][:300000].decode("utf-8", "ignore")))
    except Exception: return False

_PV_META = {}

def _pv_first_meta(url, b=None):
    """Media playlist: ilk seqmenti açıb ölçü/height/fps tapır (5 dəq keş)."""
    now = time.time()
    hit = _PV_META.get(url)
    if hit and now - hit[0] < 300: return hit[1]
    b = b or {}
    txt = _pv_get(url, b).decode("utf-8", "replace")
    segs = [x.strip() for x in txt.splitlines() if x.strip() and not x.startswith("#") and x.strip().startswith("http")]
    if not segs: return {}
    kv = None
    m = re.search(r'#EXT-X-KEY:.*?URI="([^"]+)".*?(?:IV=0x([0-9A-Fa-f]+))?', txt)
    if m and "METHOD=AES-128" in txt:
        kurl = urllib.parse.urljoin(url, m.group(1))
        hdr = {"User-Agent": str(b.get("userAgent") or "Mozilla/5.0"), "Accept": "*/*"}
        ref = b.get("referer") or b.get("pageUrl")
        if ref: hdr["Referer"] = str(ref)
        kb = urllib.request.urlopen(urllib.request.Request(kurl, headers=hdr), timeout=20).read(64)
        if len(kb) >= 16: kv = (kb[:16].hex(), m.group(2) or ("%032x" % 0))
    data = urllib.request.urlopen(urllib.request.Request(segs[0], headers={
        "User-Agent": str(b.get("userAgent") or "Mozilla/5.0"), "Accept": "*/*",
        **({"Referer": str(b.get("referer") or b.get("pageUrl"))} if (b.get("referer") or b.get("pageUrl")) else {})}), timeout=40).read()
    tmp = tempfile.mkdtemp(prefix=".idm-pvm-", dir=str(DL_DIR))
    src, dst = os.path.join(tmp, "a.bin"), os.path.join(tmp, "a.ts")
    try:
        open(src, "wb").write(data)
        if kv:
            try:
                dec = _aes128_cbc_decrypt(kv[0], kv[1], data)
                open(dst, "wb").write(dec)
            except Exception:
                subprocess.run(["openssl", "aes-128-cbc", "-d", "-in", src, "-out", dst, "-K", kv[0], "-iv", kv[1]],
                               capture_output=True, timeout=60)
        else:
            os.replace(src, dst)
        q = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height,avg_frame_rate", "-of", "json", dst],
                           capture_output=True, text=True, timeout=30)
        st = (json.loads(q.stdout or "{}").get("streams") or [{}])[0]
        h = int(st.get("height") or 0)
        fr = str(st.get("avg_frame_rate") or "0/1")
        try: fps = round(float(fr.split("/")[0]) / max(1, float(fr.split("/")[1])))
        except Exception: fps = 0
        out = {"height": h, "fps": fps, "seg_size": len(data), "n": len(segs),
               "size": len(data) * len(segs), "dur": sum(float(x) for x in re.findall(r"#EXTINF:([\d.]+)", txt))}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    _PV_META[url] = (now, out)
    return out

def _pv_get(url, b=None, timeout=25):
    """pilavyerplay (jetfilmizle pleyeri): brauzer başlıqları ilə manifest."""
    b = b or {}
    hdr = {"User-Agent": str(b.get("userAgent") or "Mozilla/5.0"), "Accept": "*/*"}
    ref = b.get("referer") or b.get("pageUrl")
    if ref: hdr["Referer"] = str(ref)
    req = urllib.request.Request(url, headers=hdr)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(4_000_000)

def _hs_read(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(8_000_000).decode("utf-8", "replace")

def _hs_playlist(url):
    """Master → variant → [(index, segment_url, duration)] (sıra qorunur)."""
    try: _h = (urllib.parse.urlsplit(url).hostname or "").lower()
    except Exception: _h = ""
    txt = _hs_fetch(url, {}).decode("utf-8", "replace") if _HS_HOST.search(_h) else _hs_read(url)
    if "#EXT-X-STREAM-INF" in txt:
        lines = [x.strip() for x in txt.splitlines()]
        var = ""
        for i, l in enumerate(lines):
            if l.startswith("#EXT-X-STREAM-INF"):
                for n in lines[i + 1:]:
                    if n and not n.startswith("#"): var = n; break
                break
        if var:
            vu = urllib.parse.urljoin(url, var)
            try: _vh = (urllib.parse.urlsplit(vu).hostname or "").lower()
            except Exception: _vh = ""
            txt = _hs_fetch(vu, {}).decode("utf-8", "replace") if _HS_HOST.search(_vh) else _hs_read(vu)
    out, dur = [], None
    for line in txt.splitlines():
        s = line.strip()
        if s.startswith("#EXTINF:"):
            try: dur = float(s[8:].split(",")[0])
            except Exception: dur = None
        elif s and not s.startswith("#"):
            out.append((len(out), urllib.parse.urljoin(url, s), dur or 0.0))
            dur = None
    return out

def _hs_local(url, b=None):
    """Yalnız hotstream.club /list və /m3u üçün: manifesti yerli snapshot-a çevirir.
    Master-dırsa variantları da snapshot edir ki, ffmpeg/yt-dlp Accept başlığına görə 404 almasın."""
    try:
        p = urllib.parse.urlsplit(url)
        host = (p.hostname or "").lower()
    except Exception:
        return url
    if not _HS_HOST.search(host): return url
    if not re.match(r"^/(?:list|m3u)/", p.path or ""): return url
    data = None
    for _ in range(3):
        try:
            d = _hs_fetch(url, b)
            if d.lstrip().startswith(b"#EXTM3U"): data = d; break
        except Exception: pass
        time.sleep(0.8)
    if data is None: return url
    txt = data.decode("utf-8", "replace")
    if not txt.lstrip().startswith("#EXTM3U"): return url
    if "#EXT-X-STREAM-INF" not in txt and "#EXT-X-MEDIA" not in txt:
        return _hs_snap(data)
    out, lines, i = [], txt.splitlines(), 0
    while i < len(lines):
        line = lines[i]; s = line.strip()
        if s.startswith("#EXT-X-STREAM-INF"):
            out.append(line)
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or lines[j].lstrip().startswith("#")):
                j += 1
            if j < len(lines):
                out.extend(lines[i + 1:j])
                out.append(_hs_local(urllib.parse.urljoin(url, lines[j].strip()), b))
                i = j + 1
                continue
        elif s.startswith("#EXT-X-MEDIA") and 'URI="' in line:
            out.append(re.sub(r'URI="([^"]+)"',
                              lambda m: 'URI="%s"' % _hs_local(urllib.parse.urljoin(url, m.group(1)), b), line))
            i += 1
            continue
        out.append(line); i += 1
    return _hs_snap(("\n".join(out) + "\n").encode("utf-8"))

def probe(b):
    yt = shutil.which("yt-dlp")
    if not yt: raise RuntimeError("yt-dlp quraşdırılmayıb (pipx install yt-dlp)")
    check_url(b.get("url"))
    key = b["url"].split("#")[0]
    with PLOCK: lk = PLOCKS.setdefault(key, threading.Lock())
    with lk:  # eyni link üçün paralel yoxlama olmasın (popup + video düyməsi)
        now = time.time()
        with PLOCK:
            hit = PROBE_CACHE.get(b["url"])
            if not b.get("fresh") and hit and now - hit[0] < 300: return hit[1]
        if is_youtube(b["url"]):
            res = probe_youtube(yt, b)
            res = {**res, "subs": enrich_subs(res.get("subs") or [], budget=1.5)}   # yalnız subtitr sətir/ölçü (mexanizm dəyişməyib)
            with PLOCK:
                if len(TAGS) > 500: TAGS.clear()
                for o in res["options"]: TAGS[(b["url"], o["selector"])] = o["tag"]
                if len(PROBE_CACHE) > 50: PROBE_CACHE.clear()
                PROBE_CACHE[b["url"]] = (now, res)
            return res
        ck = write_cookies(b["cookies"]) if b.get("cookies") else None
        hs_url = _hs_local(b.get("url"), b)   # yalnız hotstream.club: Accept başlığı üçün yerli snapshot
        try:
            p = subprocess.run([yt, "-J", "--no-playlist", "--color", "never", *yt_args(hs_url), *common_args(b, ck), fh_wrap(b, "p", hs_url)],
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=40,
                               stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            raise RuntimeError("Keyfiyyətləri yoxlamaq çox uzun çəkdi, yenidən cəhd edin")
        finally: rm(ck)
        if p.returncode != 0:
            errs = [ln for ln in p.stderr.splitlines() if "ERROR:" in ln]
            raise RuntimeError(errs[-1].split("ERROR:", 1)[1].strip() if errs else "yt-dlp məlumat ala bilmədi")
        try: info = json.loads(p.stdout)
        except ValueError: raise RuntimeError("yt-dlp cavabı oxunmadı")
        try: info = apply_hls_metadata(info, b)
        except Exception: pass
        info["_idm_site"] = _site_scope(b)
        yt_site = is_youtube(b["url"])
        yt_fast = yt_site or is_yt_hls(b["url"])
        warns = []
        if True:
            warns = yt_health() if yt_site else []
            warns += [ln.split("WARNING:", 1)[1].strip()[:240] for ln in p.stderr.splitlines()
                      if "WARNING:" in ln and re.search(r"JavaScript|JS runtime|PO Token|n challenge|SABR|signature|DRM", ln, re.I)][:3]
        try: res = analyze(info, check=not yt_fast, enrich=not yt_fast)  # HLS manifest üçün sinxron HLS ölçməsi gözləmirik
        except NoStreams as e:
            raise RuntimeError(str(e) + ((". " + " | ".join(warns)) if warns else ". yt-dlp-ni yeniləyin: pipx upgrade yt-dlp"))
        if (_pv_scope(b.get("url")) or _pv_snap_flag(b.get("url"))) and res.get("options"):
            # pilavyerplay: seqmentlər ayrıca audio ilə gəlir, yt-dlp ölçü vermir -> bitrate×müddət təxmini
            try:
                mt = _pv_get(b["url"], b).decode("utf-8", "replace")
                bw = 0
                for _l in mt.splitlines():
                    if _l.startswith("#EXT-X-STREAM-INF"):
                        m2 = re.search(r"AVERAGE-BANDWIDTH=(\d+)", _l) or re.search(r"BANDWIDTH=(\d+)", _l)
                        if m2: bw = max(bw, int(m2.group(1)))
                dur = max([o.get("dur") or 0 for o in res["options"]] or [0])
                if bw and dur:
                    est = int(bw / 8 * dur)
                    for o in res["options"]:
                        if not o.get("size"): o["size"], o["est"] = est, True
                if "#EXT-X-STREAM-INF" not in mt:
                    pm = _pv_first_meta(b["url"], b)
                    if pm.get("n"):
                        for o in res["options"]:
                            if not o.get("size"): o["size"], o["est"] = pm.get("size", 0), True
                            if pm.get("height"):
                                o["height"] = pm["height"]
                                o["tag"] = f"{pm['height']}p" + (f" {pm['fps']}FPS" if pm.get("fps") else "")
            except Exception: pass
        if len(res["options"]) == 1 and res["options"][0]["id"] == "auto":
            # "Auto" yalnız son çarədir: səbəbi göstər (yt-dlp xəbərdarlıqları + format statistikası)
            warns += ["Keyfiyyət siyahısı qurula bilmədi. " + res["diag"]]
            warns += [ln.strip()[:220] for ln in p.stderr.splitlines() if ln.startswith(("WARNING:", "ERROR:"))][:4]
        if res.get("trusted"):
            warns += ["Axınların mövcudluq yoxlaması rədd olundu (" + res["trusted"].split("yoxlamada rədd: ")[-1] + "); siyahı yt-dlp-nin özünə etibar edilərək göstərilir. Yükləmə uğursuz olarsa: pipx inject yt-dlp curl-cffi"]
        if warns: res = {**res, "warnings": warns}
        res = {**res, "subs": enrich_subs(res.get("subs") or [], budget=1.5)}
        with PLOCK:
            if len(TAGS) > 500: TAGS.clear()
            for o in res["options"]: TAGS[(b["url"], o["selector"])] = o["tag"]
            if len(PROBE_CACHE) > 50: PROBE_CACHE.clear()
            PROBE_CACHE[b["url"]] = (now, res)
        return res

SUBMODES = ("vs", "vas", "s", "as")  # subtitr daxil olan rejimlər
MODES = ("va", "a", "v", "vs", "vas", "s", "as")  # video+səs | yalnız səs | yalnız video | (köhnə vs) | video+səs+sub | yalnız sub | səs+sub
AUDIO_FORMATS = ("best", "mp3", "m4a", "opus", "flac", "vorbis", "wav")

def job_key(b):
    subsig = (b.get("subLang") or "", bool(b.get("subAuto")), bool(b.get("subAll")),
              tuple(x.get("url", "") for x in (b.get("extSubs") or []) if isinstance(x, dict)))
    return (b["url"].split("#")[0], b.get("format") or "", b.get("mode") or ("a" if b.get("audio") else "va"), subsig)

NAME_LOCK = threading.Lock()
NAME_RESERVED = set()
STEM_RESERVED = set()
VIDEO_EXTS = ("mp4", "mkv", "webm", "mov", "m4v", "m4a", "mp3", "opus", "flac", "wav", "ogg", "oga", "aac", "weba", "mka", "ts", "idmv", "idma", "idm-a", "idm-fix")
SUB_EXTS_NAMES = ("vtt", "srt", "ass", "ssa", "ttml", "dfxp", "json3")
MEDIA_EXTS = VIDEO_EXTS + SUB_EXTS_NAMES

def _stem_taken(stem, exts=MEDIA_EXTS):
    if os.path.exists(stem): return True
    for ext in exts:
        if os.path.exists(stem + "." + ext) or os.path.exists(stem + "." + ext + ".part"):
            return True
    return False

def unique_stem(stem, base_dir="", exts=VIDEO_EXTS):
    """Mövcud media faylı ilə toqquşmadan ad seçir: ad, ad (2), ad (3)..."""
    stem = os.path.basename(str(stem or "video").strip()) or "video"
    base = str(base_dir or "")
    with NAME_LOCK:
        cand, i = stem, 1
        while _stem_taken(os.path.join(base, cand) if base else cand, exts) or (os.path.join(base, cand) if base else cand) in NAME_RESERVED:
            i += 1
            cand = f"{stem} ({i})"
            if i > 9999: break
        key = os.path.join(base, cand) if base else cand
        NAME_RESERVED.add(key)
        STEM_RESERVED.add(key)
        return cand

def unique_path(p):
    """Dəqiq uzantı üzrə unikal yol (subtitr, birbaşa fayl, page download)."""
    root, ext = os.path.splitext(p)
    base, stem = os.path.dirname(root), os.path.basename(root)
    video = ext.lstrip(".").lower() in VIDEO_EXTS
    with NAME_LOCK:
        cand, i = root, 1
        while (os.path.exists(cand + ext) or (cand + ext) in NAME_RESERVED
               or (video and cand in STEM_RESERVED)):
            i += 1
            cand = os.path.join(base, f"{stem} ({i})")
            if i > 9999: break
        NAME_RESERVED.add(cand + ext)
        return cand + ext

def fetch_sub(url, headers):
    check_url(url)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
            data = r.read(5_000_001)
    except urllib.error.HTTPError as e: raise RuntimeError(f"HTTP {e.code}")
    except Exception as e: raise RuntimeError(str(getattr(e, "reason", e)))
    if len(data) > 5_000_000: raise RuntimeError("subtitr faylı çox böyükdür")
    return data

def sniff_sub(data):
    """Yüklənən fayl həqiqətən subtitrdirmi (HTML xəta səhifəsi və s. subtitr kimi saxlanmasın)."""
    t = data[:4096].decode("utf-8-sig", "replace").lstrip()
    tl = t[:300].lower()
    if tl.startswith(("<!doctype", "<html")): raise ValueError("subtitr əvəzinə HTML səhifə qaytarıldı")
    if t.startswith("WEBVTT"): return "vtt"
    if "[script info]" in tl: return "ass"
    if re.match(r"(<\?xml[^>]*>\s*)?<tt[\s>]", t): return "ttml"
    if re.search(r"\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->", t): return "srt"
    raise ValueError("subtitr formatı tanınmadı")

# ---------- Alt yazı təhlili: faylın İÇİNƏ baxıb dili və növünü (tam / yalnız xüsusi-forced / SDH) müəyyən edir ----------
import html as _html
_TS = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")
_STOP = {k: set(v.split()) for k, v in {
    "en": "the and you that for with this have not are was but they his her from what all there when your can said will one would about out get just like know",
    "tr": "bir bu ve için ne ben sen çok ama de da mi mı mu mü değil var yok ile gibi daha şey evet hayır ki biz siz onlar şimdi sonra neden nasıl çünkü",
    "az": "bir bu və üçün nə mən sən çox amma də da deyil var yox ilə kimi daha şey bəli xeyr ki biz siz onlar indi sonra niyə necə çünki belə",
    "es": "el la de que y en los se no un por con una su para es las lo como más pero",
    "fr": "le la les de des et est un une pas que qui dans pour je tu il nous vous ce ne sur avec",
    "de": "der die das und ist nicht ein ich du sie wir mit zu den von auf für auch es",
    "it": "il la di che e è un non per con una sono mi ti ci lo le gli",
    "pt": "o a de que e não um uma para com se os as do da em é eu você",
    "nl": "de het een en van ik je dat niet is op te zijn met voor maar ook",
}.items()}
_SCRIPTS = (("ru", r"[\u0400-\u04FF]"), ("ar", r"[\u0600-\u06FF]"), ("he", r"[\u0590-\u05FF]"), ("el", r"[\u0370-\u03FF]"),
            ("ja", r"[\u3040-\u30FF]"), ("ko", r"[\uAC00-\uD7AF]"), ("zh", r"[\u4E00-\u9FFF]"), ("th", r"[\u0E00-\u0E7F]"),
            ("hi", r"[\u0900-\u097F]"), ("ka", r"[\u10A0-\u10FF]"), ("hy", r"[\u0530-\u058F]"))

def detect_lang(text):
    """(dil kodu, etibar 0..1): yazı sistemi + stop-söz statistikası. Yalnız mətnin özünə əsaslanır."""
    letters = re.findall(r"[^\W\d_]", text)
    if len(letters) < 40: return "", 0.0
    total = len(letters)
    for lg, rx in _SCRIPTS:
        share = len(re.findall(rx, text)) / total
        if share > 0.4:
            if lg == "ru":
                if re.search(r"[їєґ]", text): lg = "uk"
                elif not re.search(r"[ыэ]", text) and len(re.findall("ъ", text)) / total > 0.01: lg = "bg"
            elif lg == "ar" and re.search(r"[پچژگ]", text): lg = "fa"
            return lg, min(0.99, 0.6 + share / 2)
    if len(re.findall(r"[\u3040-\u30FF]", text)) > 5: return "ja", 0.9
    toks = re.findall(r"[^\W\d_]+", text.lower())
    if len(toks) < 15: return "", 0.0
    sc = sorted(((sum(1 for t in toks if t in sw) / len(toks), lg) for lg, sw in _STOP.items()), reverse=True)
    (s1, l1), (s2, l2) = sc[0], sc[1]
    if {l1, l2} == {"tr", "az"}:   # tr/az: yalnız "ə" (az əlifbası) fərqləndirir
        l1 = "az" if text.lower().count("ə") / total > 0.002 else "tr"
        return l1, 0.85 if s1 > 0.1 else 0.5
    if s1 < 0.05: return "", 0.0
    return l1, round(min(0.99, 0.35 + (s1 - s2) / max(s1, 1e-6) * 0.65), 2) if s1 >= 0.08 else 0.35

def _tsec(x):
    x = str(x).strip()
    m = re.fullmatch(r"([\d.]+)s", x)
    if m: return float(m.group(1))
    p = x.replace(",", ".").split(":")
    try: return sum(float(v) * k for v, k in zip(reversed(p), (1, 60, 3600)))
    except ValueError: return 0.0

def parse_cues(text):
    """Bütün formatlar üçün [(başlama, bitmə, təmiz mətn)]: vtt/srt, ass/ssa, ttml."""
    cues = []
    if re.match(r"\s*(<\?xml[^>]*>\s*)?<tt[\s>]", text):
        for m in re.finditer(r'<p\b[^>]*\bbegin="([^"]+)"[^>]*\bend="([^"]+)"[^>]*>(.*?)</p>', text, re.S):
            cues.append((_tsec(m.group(1)), _tsec(m.group(2)), re.sub(r"<br\s*/?>", " ", m.group(3))))
    elif "[Script Info]" in text[:400] or "\nDialogue:" in text:
        for ln in text.splitlines():
            if ln.startswith("Dialogue:"):
                f = ln.split(":", 1)[1].split(",", 9)
                if len(f) == 10: cues.append((_tsec(f[1]), _tsec(f[2]), f[9].replace("\\N", " ")))
    else:
        lines, i = text.splitlines(), 0
        while i < len(lines):
            m = _TS.search(lines[i])
            i += 1
            if not m: continue
            g = m.groups()
            buf = []
            while i < len(lines) and lines[i].strip(): buf.append(lines[i]); i += 1
            cues.append((int(g[0] or 0) * 3600 + int(g[1]) * 60 + int(g[2]) + int(g[3].ljust(3, "0")[:3]) / 1000,
                         int(g[4] or 0) * 3600 + int(g[5]) * 60 + int(g[6]) + int(g[7].ljust(3, "0")[:3]) / 1000, " ".join(buf)))
    out = []
    for a, b, t in cues:
        t = _html.unescape(re.sub(r"\{[^}]*\}|<[^>]+>", "", t)).strip()
        if t: out.append((a, b, t))
    return out

def _vtt_map_offset(text):
    """HLS WebVTT X-TIMESTAMP-MAP=MPEGTS:...,LOCAL:... -> saniyə offseti."""
    t = str(text or "")
    m = re.search(r"X-TIMESTAMP-MAP\s*=\s*MPEGTS:(\d+)\s*,\s*LOCAL:([\d:.,]+)", t, re.I)
    if not m:
        m = re.search(r"X-TIMESTAMP-MAP\s*=\s*LOCAL:([\d:.,]+)\s*,\s*MPEGTS:(\d+)", t, re.I)
        if m: return int(m.group(2)) / 90000.0 - _tsec(m.group(1))
        return 0.0
    return int(m.group(1)) / 90000.0 - _tsec(m.group(2))

def media_start_time(path):
    fp = shutil.which("ffprobe")
    if not fp or not path: return 0.0
    try:
        r = subprocess.run([fp, "-v", "error", "-show_entries", "format=start_time",
                            "-of", "default=nw=1:nk=1", path], capture_output=True, text=True,
                           errors="replace", timeout=20, stdin=subprocess.DEVNULL)
        v = num((r.stdout or "").strip())
        return v if v and v > 0.05 else 0.0
    except Exception:
        return 0.0

def parse_cues_media(text, media_start=0.0):
    """VTT/SRT cue-larını media timeline-ına gətirir (X-TIMESTAMP-MAP + start_time)."""
    off = _vtt_map_offset(text) - float(media_start or 0.0)
    return [(max(0.0, a + off), max(0.0, b + off), t) for a, b, t in parse_cues(text)]

_SDH = re.compile(r"^\s*[\[(♪].*[\])♪]\s*$|^\s*♪")

# ---- Alt yazı ayarları: əsas mənbə ~/.config/jdm/subtitle-settings.json ----
SUB_CFG = CONF / "subtitle-settings.json"
_SUB_FONT_CACHE = {"t": 0.0, "list": []}
_SUB_FONT_FALLBACKS = ("DejaVu Sans", "Liberation Sans", "Noto Sans", "Arial")

def _sub_clamp(n, a, c, d):
    try: n = int(round(float(n)))
    except Exception: return d
    return max(a, min(c, n))

def _sub_families():
    now = time.time()
    if now - _SUB_FONT_CACHE["t"] < 60 and _SUB_FONT_CACHE["list"]:
        return list(_SUB_FONT_CACHE["list"])
    fams = set()
    if IS_WIN:
        for root in (Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts",
                     Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Microsoft" / "Windows" / "Fonts"):
            try:
                if not root.is_dir(): continue
                for p in root.iterdir():
                    if p.is_file() and p.suffix.lower() in (".ttf", ".otf", ".ttc", ".fon"):
                        fams.add(p.stem)
            except Exception:
                pass
    else:
        try:
            out = subprocess.run(["fc-list", ":", "family"], capture_output=True, text=True,
                                 errors="replace", timeout=20, stdin=subprocess.DEVNULL).stdout or ""
            for ln in out.splitlines():
                for x in ln.split(","):
                    x = x.strip()
                    if x: fams.add(x)
        except Exception:
            pass
    lst = sorted(fams, key=str.lower)
    _SUB_FONT_CACHE.update(t=now, list=lst)
    return list(lst)

def _bundle_dir():
    """Frozen (PyInstaller) rejimdə paketlənmiş faylların qovluğu; normal işdə skriptin yanı."""
    try:
        base = getattr(sys, "_MEIPASS", None)      # onefile/onedir unpacked dir
        if base: return Path(base)
    except Exception:
        pass
    return Path(__file__).resolve().parent

def _res(name):
    """Paketlənmiş resursun yolu (fonts, mpv_substyle.lua və s.)."""
    return _bundle_dir() / name

def _sub_font_file(name):
    norm = re.sub(r"[^a-z0-9]", "", str(name or "").lower())
    if not norm: return None
    roots = [Path.home() / ".local" / "share" / "fonts", Path.home() / ".config" / "mpv" / "sub-fonts",
             _res("fonts"), Path("/usr/share/fonts"), Path("/usr/local/share/fonts")]
    if IS_WIN:
        roots = [_res("fonts"),
                 Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts",
                 Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Microsoft" / "Windows" / "Fonts"]
    for root in roots:
        try:
            if not root.exists(): continue
            for p in root.rglob("*"):
                if p.is_file() and p.suffix.lower() in (".ttf", ".otf", ".ttc") \
                        and norm in re.sub(r"[^a-z0-9]", "", p.name.lower()):
                    return p
        except Exception:
            pass
    return None

def _sub_font_pick(name, fams):
    low = str(name or "").lower()
    if not low: return None
    for f in fams:
        if f.lower() == low: return f
    for f in fams:
        fl = f.lower()
        if fl.startswith(low + " ") or fl.endswith(" " + low): return f
    return None

def resolve_sub_font(name):
    """Şrifti fc-list ilə yoxlayır; yoxdursa tapıb qeydiyyatdan keçirməyə çalışır, olmasa fallback qaytarır."""
    name = str(name or "").strip()
    if not name or name.lower() in ("default", "avto", "auto"):
        return {"font": "Default", "fontResolved": "", "fontMissing": False, "fontFallback": ""}
    fams = _sub_families()
    hit = _sub_font_pick(name, fams)
    if hit:
        return {"font": name, "fontResolved": hit, "fontMissing": False, "fontFallback": ""}
    p = _sub_font_file(name)
    if p and not IS_WIN:
        try:
            dst = Path.home() / ".local" / "share" / "fonts"
            dst.mkdir(parents=True, exist_ok=True)
            target = dst / p.name
            if not target.exists(): shutil.copy2(p, target)
            subprocess.run(["fc-cache", "-f"], capture_output=True, timeout=40, stdin=subprocess.DEVNULL)
            _SUB_FONT_CACHE.update(t=0.0, list=[])
            fams = _sub_families()
            hit = _sub_font_pick(name, fams)
            if hit:
                return {"font": name, "fontResolved": hit, "fontMissing": False, "fontFallback": ""}
        except Exception:
            pass
    fb = ""
    if not IS_WIN:
        try:
            fb = subprocess.run(["fc-match", "-f", "%{family}", name], capture_output=True, text=True,
                                errors="replace", timeout=15, stdin=subprocess.DEVNULL).stdout.split(",")[0].strip()
        except Exception:
            fb = ""
    if not fb:
        fb = next((f for f in _SUB_FONT_FALLBACKS if f in fams), "DejaVu Sans")
    return {"font": name, "fontResolved": fb, "fontMissing": True, "fontFallback": fb}

def _sub_norm(d, resolve=False):
    d = d if isinstance(d, dict) else {}
    out = {
        "size": _sub_clamp(d.get("size"), 2, 200, 16),
        "bold": bool(d.get("bold")), "italic": bool(d.get("italic")), "underline": bool(d.get("underline")),
        "bg": _sub_clamp(d.get("bg"), 0, 100, 10),
        "font": str(d.get("font") or "Default")[:120],
        "fontResolved": str(d.get("fontResolved") or "")[:120],
        "fontMissing": bool(d.get("fontMissing")),
        "fontFallback": str(d.get("fontFallback") or "")[:120],
        "visualStyle": d.get("visualStyle") if d.get("visualStyle") in ("default", "cinematic", "minimalist", "neon") else "default",
        "aiStyle": d.get("aiStyle") if d.get("aiStyle") in ("default", "academic", "colloquial", "simplified") else "default",
        "seeded": bool(d.get("seeded")),
    }
    if resolve:
        out.update(resolve_sub_font(out["font"]))
    return out

def load_subtitle_settings():
    try:
        if SUB_CFG.exists():
            return _sub_norm(json.loads(SUB_CFG.read_text(encoding="utf-8") or "{}"))
    except Exception:
        pass
    return _sub_norm({})

def _deploy_mpv_lua():
    if IS_WIN:
        return   # Windows-da MPV inteqrasiyası dəstəklənmir (skript paketdə qalır, əl ilə istifadə üçün)
    try:
        scripts = Path.home() / ".config" / "mpv" / "scripts"
        scripts.mkdir(parents=True, exist_ok=True)
        src = _res("jdm_substyle.lua")
        if not src.exists(): src = _res("mpv_substyle.lua")
        if not src.exists(): return
        dst = scripts / "jdm_substyle.lua"
        text = src.read_text(encoding="utf-8")
        old = dst.read_text(encoding="utf-8") if dst.exists() else ""
        if text != old: dst.write_text(text, encoding="utf-8")
    except Exception:
        pass

def save_subtitle_settings(patch, seed=True):
    cur = load_subtitle_settings()
    if isinstance(patch, dict):
        for k in ("size", "bold", "italic", "underline", "bg", "font", "visualStyle", "aiStyle"):
            if k in patch: cur[k] = patch[k]
    cur = _sub_norm(cur, resolve=True)
    if seed: cur["seeded"] = True
    cur["updated"] = int(time.time() * 1000)
    try:
        SUB_CFG.parent.mkdir(parents=True, exist_ok=True)
        tmp = SUB_CFG.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, SUB_CFG)
    except Exception:
        pass
    _deploy_mpv_lua()
    return cur

def sub_appearance(b):
    """Cari alt yazı görünüşü. Helper JSON (seeded) əsas mənbədir; ilk qurulumda
    (hələ seed olunmayıbsa) sorğudakı dəyərlər istifadə olunur."""
    cfg = load_subtitle_settings()
    if cfg.get("seeded"):
        return _sub_norm(cfg)
    src = dict(cfg)
    v = b.get("subAppearance") if isinstance(b, dict) else None
    if isinstance(v, dict):
        for k in ("size", "bold", "italic", "underline", "bg", "font", "fontResolved", "fontMissing", "fontFallback"):
            if k in v: src[k] = v[k]
    res = _sub_norm(src)
    if res.get("font") and res["font"] != "Default" and not res.get("fontResolved"):
        res.update(resolve_sub_font(res["font"]))
    return res

def r_subtitle_settings(b):
    seed_needed = False
    if b and isinstance(b.get("settings"), dict):
        s = save_subtitle_settings(b["settings"])
    elif isinstance(b, dict) and any(k in b for k in ("size", "bold", "italic", "underline", "bg", "font", "visualStyle", "aiStyle")):
        s = save_subtitle_settings(b)
    else:
        if not SUB_CFG.exists():
            s = save_subtitle_settings({}, seed=False)
            seed_needed = True
        else:
            s = load_subtitle_settings()
            seed_needed = not bool(s.get("seeded"))
    return {"ok": True, "settings": s, "fonts": _sub_families(), "seedNeeded": seed_needed}

def _ass_time(sec):
    sec = max(0.0, float(sec or 0)); h = int(sec // 3600); m = int((sec % 3600) // 60); s = sec % 60
    return "%d:%02d:%05.2f" % (h, m, s)

def _ass_box_color(ap):
    """BackColour alfa: 0% fon = tam şəffaf (FF), 100% = tam qara (00)."""
    a = 255 - int(round(int((ap or {}).get("bg") or 0) * 2.55))
    return "&H%02X000000" % max(0, min(255, a))

def _sub_cues_lines(text):
    """SRT/VTT: [(başlama, bitmə, mətn — sətir sonları saxlanılır)]."""
    out = []
    txt = text.replace("\r\n", "\n").replace("\r", "\n")
    for blk in re.split(r"\n{2,}", txt):
        lines = blk.split("\n")
        ti = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if ti is None: continue
        m = re.search(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})", lines[ti])
        if not m: continue
        g = m.groups()
        a = int(g[0] or 0) * 3600 + int(g[1]) * 60 + int(g[2]) + int(g[3].ljust(3, "0")[:3]) / 1000
        b = int(g[4] or 0) * 3600 + int(g[5]) * 60 + int(g[6]) + int(g[7].ljust(3, "0")[:3]) / 1000
        body = "\n".join([_html.unescape(re.sub(r"\{[^}]*\}|<[^>]+>", "", x)).strip()
                          for x in lines[ti + 1:] if x.strip()])
        if body and b > a: out.append((a, b, body))
    return out

def _ass_apply_appearance(text, ap):
    """ASS/SSA Style sətirlərinə ölçü, şrift, qalın/kursiv/altxətt və fon qaralmasını yazır."""
    ratio = max(2, min(200, int((ap or {}).get("size") or 16))) / 16.0
    back = _ass_box_color(ap)
    font = re.sub(r"[,\r\n]", " ", str((ap or {}).get("fontResolved") or (ap or {}).get("font") or "")).strip()
    if font.lower() in ("", "default", "auto", "avto"): font = ""
    play_y = 1080.0
    for ln in text.splitlines():
        mm = re.match(r"\s*PlayResY\s*:\s*(\d+)", ln, re.I)
        if mm:
            try: play_y = max(120.0, float(mm.group(1)))
            except Exception: pass
            break
    out, ok = [], None
    for ln in text.splitlines():
        if ln.startswith("Format:") and ok is None:
            names = [x.strip() for x in ln.split(":", 1)[1].split(",")]
            if names[:3] == ["Name", "Fontname", "Fontsize"] and "BackColour" in names:
                ok = {n: i for i, n in enumerate(names)}
        elif ln.startswith("Style:") and ok:
            parts = ln.split(":", 1)[1].split(",")
            if len(parts) >= len(ok):
                nm = parts[ok.get("Name", 0)].strip().lower()
                def put(k, val):
                    i = ok.get(k)
                    if i is not None and i < len(parts): parts[i] = val
                if "dual" in nm:
                    # İkili ASS: flag/pos layoutu ölçü/şriftlə hesablanıb — onu pozmuruq.
                    put("BackColour", back); put("BorderStyle", "4"); put("Outline", "1"); put("Shadow", "0")
                else:
                    # 48px @ PlayResY=1080 = YouTube-un 1920px genişlikdə default ölçüsü.
                    base = 48.0 * (play_y / 1080.0)
                    put("Fontsize", "%d" % max(1, int(round(base * ratio))))
                    if font: put("Fontname", font)
                    put("BackColour", back)
                    put("Bold", "-1" if ap.get("bold") else "0")
                    put("Italic", "-1" if ap.get("italic") else "0")
                    put("Underline", "-1" if ap.get("underline") else "0")
                    put("BorderStyle", "4")
                    put("Outline", "1")
                    put("Shadow", "0")
                out.append("Style:" + ",".join(parts)); continue
        out.append(ln)
    return "\n".join(out) if ok else text

def style_subtitle_file(path, ap):
    """Alt yazını (srt/vtt/ass) seçilmiş görünüşlə stilləndirilmiş .ass kimi qaytarır.
    Uyğun olmayan/oxunmayan fayl olduğu kimi qalır."""
    if not (path and ap and os.path.exists(path)): return path
    if str(path).lower().endswith(".styled.ass"): return path
    try: text = open(path, encoding="utf-8-sig", errors="replace").read()
    except Exception: return path
    low = text[:600].lower()
    if "[script info]" in low or "\ndialogue:" in text.lower():
        if not re.search(r"(?im)^\s*\[v4\+?\s*styles\]", text): return path
        new = _ass_apply_appearance(text, ap)
        if new == text: return path
        out = os.path.splitext(path)[0] + ".styled.ass"
        try:
            with open(out, "w", encoding="utf-8") as fh: fh.write(new)
            return out
        except Exception:
            return path
    cues = _sub_cues_lines(text)
    if not cues: return path
    size = max(1, int(round(48 * max(2, min(200, int(ap.get("size") or 16))) / 16.0)))
    font = re.sub(r"[,\r\n]", " ", str(ap.get("fontResolved") or ap.get("font") or "")).strip()
    if font.lower() in ("", "default", "auto", "avto"): font = "Arial"
    hdr = [
        "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2",
        "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: JDM,%s,%d,&H00FFFFFF,&H000000FF,&HFF000000,%s,%d,%d,%d,0,100,100,0,0,4,1,0,2,20,20,35,1" % (
            font, size, _ass_box_color(ap), -1 if ap.get("bold") else 0,
            -1 if ap.get("italic") else 0, -1 if ap.get("underline") else 0),
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    ]
    ev = []
    for a, b, t in cues:
        tt = t.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")
        ev.append("Dialogue: 0,%s,%s,JDM,,0,0,0,,%s" % (_ass_time(a), _ass_time(b), tt))
    out = os.path.splitext(path)[0] + ".styled.ass"
    try:
        with open(out, "w", encoding="utf-8") as fh: fh.write("\n".join(hdr + ev) + "\n")
        return out
    except Exception:
        return path


def analyze_sub(data):
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"): text = data.decode("utf-16", "replace")
    else: text = data.decode("utf-8-sig", "replace")
    cues = parse_cues(text)
    n = len(cues)
    meta = {"size": len(data), "seg": "X-TIMESTAMP-MAP" in text[:1200]}   # dəqiq bayt ölçüsü; HLS WebVTT seqmenti
    if not n: return {**meta, "cues": 0}
    first, last = min(c[0] for c in cues), max(c[1] for c in cues)
    span = max(last - first, 1.0)
    sdh = sum(1 for c in cues if _SDH.match(c[2]))
    lang, conf = detect_lang(" ".join(c[2] for c in cues)[:80000])
    return {**meta, "cues": n, "dur": round(span, 1), "mins": round(span / 60, 1), "cpm": round(n / (span / 60), 2),
            "cover": round(sum(max(0.0, c[1] - c[0]) for c in cues) / span, 3), "sdh": round(sdh / n, 3),
            "dlang": lang, "dconf": conf}

FORCED_CPM, FULL_CPM = 2.5, 5.0   # sətir/dəq: seyrək (yalnız xüsusi hissələr) / sıx (bütün dialoq)

def classify_subs(infos):
    """Hər alt yazının növü: eyni dildəki digərləri ilə müqayisə + öz sıxlığı (fayl ölçüsünə yox, MƏZMUNA görə)."""
    mx = {}
    for x in infos:
        if x.get("cues"): mx[x.get("dlang") or ""] = max(mx.get(x.get("dlang") or "", 0), x["cues"])
    for x in infos:
        n = x.get("cues", 0)
        if not n: x["kind"] = ""; continue
        grp = sum(1 for y in infos if y.get("cues") and (y.get("dlang") or "") == (x.get("dlang") or ""))
        top = mx.get(x.get("dlang") or "", n)
        if n < 5: k = "tiny"
        elif x["cpm"] < FORCED_CPM: k = "forced"
        elif x["cpm"] >= FULL_CPM and (grp < 2 or n >= 0.6 * top): k = "sdh" if x["sdh"] >= 0.07 else "full"
        else: k = "partial"
        x["kind"] = k
    return infos

SUBINFO = {}   # url -> təhlil (təkrar açılışda dərhal)

def r_subinfo(b):
    subs = [x for x in (b.get("subs") or []) if isinstance(x, dict) and re.match(r"(?i)^https?://", str(x.get("url") or ""))][:40]
    def one(x):
        u = x["url"]
        if u in SUBINFO: return SUBINFO[u]
        h = {"User-Agent": b.get("userAgent") or "Mozilla/5.0"}
        if x.get("referer"): h["Referer"] = str(x["referer"])
        if x.get("cookie"): h["Cookie"] = str(x["cookie"])
        try:
            data = fetch_sub(u, h)
            fmt = sniff_sub(data)
            info = analyze_sub(data)
            info["fmt"] = fmt
        except Exception as e: info = {"cues": 0, "err": str(e)[:80], "bad": isinstance(e, ValueError)}   # bad: cavab altyazı deyil
        info["url"] = u
        return info
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex: infos = list(ex.map(one, subs))
    classify_subs(infos)   # növ qrupa görə hesablandığı üçün hər sorğuda yenidən
    for i in infos:
        if i.get("cues"):
            if len(SUBINFO) > 300: SUBINFO.clear()
            SUBINFO[i["url"]] = i
    return {"ok": True, "infos": infos}

def enrich_subs(subs, budget=9.0):
    """yt-dlp subtitr trekləri (YouTube daxil): faylı oxuyub real sətir sayı və dəqiq bayt ölçüsü. Vaxt aşımında/xətada sahə əlavə olunmur (uydurulmur);
    tamamlanmayan təhlillər arxa planda davam edib keşə düşür (növbəti açılışda hazır olur)."""
    items = [s for s in subs if re.match(r"(?i)^https?://", str(s.get("url") or ""))][:24]
    if not items: return subs
    box = {}
    th = threading.Thread(target=lambda: box.update(r_subinfo({"subs": [{"url": s["url"]} for s in items]})), daemon=True)
    th.start(); th.join(budget)
    by = {i.get("url"): i for i in (box.get("infos") or [])}
    out = []
    for s in subs:
        i = by.get(s.get("url"))
        if i and not i.get("bad") and i.get("size"):
            e = {**s, "size": i["size"]}
            if i.get("cues"): e["cues"] = i["cues"]
            if i.get("dur"): e["dur"] = i["dur"]
            out.append(e)
        else: out.append(s)
    return out

class Job:
    def __init__(s, b):
        global _n
        with JLOCK:
            _n += 1
            s.id = f"y{_n}"
            JOBS[s.id] = s
        s.b = b
        s.url = b["url"]
        s.key = job_key(b)
        s.name = b.get("title") or s.url
        s.status, s.progress, s.speed, s.eta = "waiting", 0.0, 0, None
        s.size = s.done_bytes = s.fin_bytes = 0
        s.error = s.phase = s.path = s.note = ""
        s.parts, s.done = 1, 0
        s.fin_files, s.seen_files = set(), set()
        s.proc = None
        s.removed = False
        s.dup = 0
        s.out_stem = ""
        s.target = str(b.get("target") or "").strip()
        s.exists = False
        s.exist_path = ""
        s.t0 = time.time()
        # --- rejim / subtitr planı
        s.mode = b.get("mode") or ("a" if b.get("audio") else "va")
        s.ff = bool(shutil.which("ffmpeg"))
        s.ext_subs = [x for x in (b.get("extSubs") or []) if isinstance(x, dict) and re.match(r"(?i)^https?://", str(x.get("url") or ""))]
        s.subap = sub_appearance(b)   # Ayarlar → Alt yazı görünüşü (ölçü/stil/fon)
        s.native_subs = s.mode in SUBMODES and not s.ext_subs and bool(b.get("subLang") or b.get("subAll"))
        s.keep_subs = bool(b.get("keepSubs"))
        s.embed = s.mode in ("vs", "vas") and s.native_subs and s.ff   # yt-dlp --embed-subs ffmpeg tələb edir
        if s.subap and s.native_subs and s.mode in ("vs", "vas", "as") and s.ff:
            s.embed = False   # görünüş ayarları üçün subtitr ayrıca stilləndirilib mux olunur
        s.retried = s.fail = False
        s.subdir = ""
        s.audio_local = None   # audio CDN: hostları paylaşdırılmış yerli master (bir dəfə qurulur)
        s.vn, s.an = clampint(b.get("vStreams")), clampint(b.get("aStreams"))
        s.force_parts = 0
        s.resume, s.throttled, s.hits, s.tries, s.dests = False, False, 0, 0, set()
        s.hit_t, s.total_tries = [], 0
        s.refreshes, s.refreshing, s.pend, s.g, s.slow_t = 0, False, None, {}, 0
        s.boosts, s.fq = 0, {}
        s.safe_audio, s.bad_audio = False, False   # səs faylı yoxlamadan keçməsə: bir dəfə sadə rejimdə (1 bağlantı, aria2c yox) təkrar
        s.split_retry = False   # ayrı video/audio prosesi uğursuz olsa: tək yt-dlp prosesi ilə bir dəfə ehtiyat cəhd
        s.native_retry = False  # ehtiyat cəhddə kiçik 144p axınları üçün aria2c-siz, 1 bağlantı
        # video və audio fərqli sayda: iki ayrı icra (video -N vn, audio -N an), sonra ffmpeg ilə birləşdirmə
        m = re.match(r"^([\w.-]+)\+([\w.-]+)(?:/|$)", b.get("format") or "")
        s.vfmt, s.afmt = m.groups() if m else ("", "")
        # Video və audio ayrı axındırsa (id+id) onlar AYNI ANDA ayrı yt-dlp prosesləri ilə yüklənir, sonra ffmpeg ilə birləşir.
        # (Əvvəl ardıcıl idi: video bitəndə audio tək başına yavaş-yavaş gəlirdi.) Native subtitr birləşdirməsi (vas) yt-dlp-nin
        # özündə qaldığı üçün ardıcıl yol saxlanılır.
        s.site_fix = _site_scope(b)   # yalnız scope-dakı saytlar/CDN-lər
        s.hs = bool(b.get("_hotstream"))   # yalnız hotstream.club (beHLS) axını
        s.pv = bool(b.get("_pv")) or _pv_scope(b.get("url"))   # yalnız pilavyerplay (AES-128)
        # dizipalizm: yt-dlp bu CDN-də səsi birləşdirə bilmir → "Video + Səs + Subtitr"də də ayrı endirib merge edirik
        s.split = bool(m and s.ff and (s.mode == "va" or (s.mode == "vas" and (not s.native_subs or s.site_fix))))
        if s.split: s.embed = False
        # YouTube: səs (və seçilibsə subtitr) videonun özü ilə EYNİ ANDA başlasın, sonra birləşsin.
        # Seqmentdə `url` googlevideo ola bilər — səhifə ünvanına da baxırıq.
        s.yt = is_youtube(s.url) or is_youtube(str(b.get("pageUrl") or ""))
        s.yt_par = bool(s.yt and s.ff and s.mode in ("va", "vas") and audio_tracks(b))
        s._pre_started, s._pre_audio, s._pre_threads, s._pre_subs = False, [], [], None
        if s.yt_par: s.embed = False
        s.procs, s.tr, s.plock, s.fb = [], [], threading.Lock(), False
        if s.mode in ("va", "vas") and s.vn and s.an and s.vn != s.an and not s.split:
            s.note = f"Bu mənbədə video və audio ayrı axın deyil/ffmpeg yoxdur: video sayı ({s.vn}) tətbiq olundu, audio sayı yox"
        elif max(s.vn, s.an) > 1 and not shutil.which("aria2c"):
            s.note = "aria2c yoxdur: düz (parçasız) axınlar tək bağlantı ilə yüklənir; say yalnız parçalı HLS/DASH axınlara tətbiq olunur"
        s.strat = b.get("strat") if (is_youtube(s.url) and b.get("strat") in YT_STRATS) else ""
        s.cb, s.ea, use_ck = strat_args(b, s.strat or "A")   # YouTube: keyfiyyəti tapan strategiya ilə yüklə
        s.cookiefile = write_cookies(b["cookies"]) if (use_ck and b.get("cookies")) else None
        # Vahid progress: video ilə yanaşı ayrıca endirilən səs/subtitrlər də bir faizdə əks olunsun.
        s._extra_units, s._extra_done = 0, 0
        s._extra_total_bytes, s._extra_done_bytes = 0, 0
        s._disp_floor, s._phase, s._audio_i, s._audio_n = 0.0, "video", 0, 0
        s.known_streams = False
        try:
            _at = audio_tracks(b)
            s._extra_units = (0 if s.mode in ("a", "as") else len(_at) * 20) + len(s.ext_subs) * 1
            if s.mode in ("va", "vas") and not s.split:
                s._extra_total_bytes = sum(int(t.get("size") or 0) for t in _at)
        except Exception:
            s._extra_units = 0
            s._extra_total_bytes = 0
        threading.Thread(target=s.run, daemon=True).start()

    # ---------- əmr qurucuları
    def sub_args(s):
        b = s.b
        if b.get("subAll"): return ["--write-subs", "--sub-langs", "all,-live_chat", "--sub-format", "vtt/srt/best"]
        return ["--write-auto-subs" if b.get("subAuto") else "--write-subs",
                "--sub-langs", re.escape(str(b.get("subLang"))), "--sub-format", "vtt/srt/best"]

    def sub_tmp(s):
        if not s.subdir: s.subdir = tempfile.mkdtemp(prefix=".idm-subs-", dir=DL_DIR)
        return s.subdir

    def cmd(s, sub_only=False, fmt=None, n=None, suffix=""):
        b = s.b
        yt = shutil.which("yt-dlp")
        if not yt: raise RuntimeError("yt-dlp quraşdırılmayıb (pipx install yt-dlp)")
        raw_title = (b.get("title") if (b.get("title") and b.get("useTitle")) else "") or b.get("pageTitle") or b.get("title") or "video"
        raw_title = re.sub(r"\s*[|\-–—]\s*(?:YouTube|یوتیوب)\s*$", "", str(raw_title), flags=re.I)
        title = safe_name(raw_title) or "video"
        label = s.quality_label()
        n = n if n is not None else (s.an if s.mode in ("a", "as") else s.vn)
        if s.safe_audio and s.mode in ("a", "as"): n = 1
        is_aud = s.mode in ("a", "as") or suffix == ".idma"
        if not s.out_stem:
            stem = (title or "video") + (f" [{label}]" if label else "")
            s.out_stem = unique_stem(safe_name(stem), str(DL_DIR), VIDEO_EXTS)
        out = s.out_stem + suffix + ".%(ext)s"
        only = sub_only or s.mode == "s"
        dl_n = 1 if s.native_retry else n   # 144p ehtiyat cəhdi: aria2c/çoxbağlantı yerinə native tək axın
        c = [yt, "--newline", "--progress", "--color", "never", "--no-playlist", "--no-mtime", "--continue",
             *dl_args(dl_n, is_aud, s.url, s.hs), "--retries", "10", "--fragment-retries", "10",
             "-P", s.sub_tmp() if only else str(DL_DIR), "-o", out,
             "--progress-template",
             "download:PROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|"
             "%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|"
             "%(progress.fragment_index)s|%(progress.fragment_count)s|%(progress.filename)s"]
        # pilavyerplay: seqmentlər ".txt" uzantılıdır və AES-128 ilə şifrələnib. yt-dlp AES-i
        # ffmpeg-ə həvalə edir, ffmpeg isə ".txt" seqmenti rədd edir (extension_picky). Yalnız bu host.
        if _pv_scope(s.url) or _pv_scope(b.get("pageUrl")) or _pv_scope(b.get("referer")):
            c += ["--downloader-args", "ffmpeg_i:-extension_picky 0"]
        c += yt_args(s.url)
        c += s.ea
        c += common_args(s.cb, s.cookiefile)
        if only:  # yalnız subtitr: video yüklənmir; fayllar müvəqqəti qovluğa düşür, sonra Downloads-a köçürülür
            c += ["--skip-download", "--ignore-no-formats-error", "--force-overwrites", *s.sub_args()]
            if s.ff: c += ["--convert-subs", "srt"]
            return c + [s.url]
        if (s.retried or s.split or s.fb) and not s.resume: c += ["--force-overwrites"]
        if s.mode in ("a", "as"):
            fmt = "ba/w" if s.fb else (b.get("format") or "ba/w")   # ayrıca səs axını yoxdursa ən KİÇİK birləşmiş axın (ba/b bütün filmi yükləyirdi)
            if not s.fb and is_youtube(s.url) and re.fullmatch(r"[\w.\-]+", b.get("format") or ""):
                # YouTube: seçilmiş id video daşıyırsa ([vcodec=none] keçmir) heç vaxt video yüklənməsin: əvvəl həmin səs, sonra ən yaxşı AYRICA səs axını
                fmt = f"{b['format']}[vcodec=none]/ba[vcodec=none]/ba/w"
            if s.ff:
                af = b.get("audioFormat") if b.get("audioFormat") in AUDIO_FORMATS else "best"
                c += ["-f", fmt, "-x", "--audio-format", af] + ([] if s.resume else ["--force-overwrites"])
                q = str(b.get("audioQuality") or "")
                if af != "best" and re.fullmatch(r"\d{2,3}", q): c += ["--audio-quality", q + "K"]
                elif af == "mp3": c += ["--audio-quality", "0"]
            else:
                c += ["-f", "ba" if fmt == "ba/w" else fmt]  # ffmpeg yoxdur: çevirmə olmadan ayrıca səs axını
        else:
            if s.fb: fmt = {"v": "bv/b"}.get(s.mode, "bv*+ba/b")  # seçilmiş axın tapılmadı: ən yaxşı mövcud axın
            c += ["-f", fmt or b.get("format") or "bv*+ba/b", "--merge-output-format", "mkv" if s.embed else "mp4"]
            if s.embed: c += [*s.sub_args(), "--embed-subs"]
        target = s.url
        if is_aud:   # yalnız audio: 2839/435 güzgü paylaşımı; video URL-i və sürəti toxunulmur
            if s.audio_local is None:
                try: s.audio_local = audio_rewrite_master(s.b, s.url) or ""
                except Exception: s.audio_local = ""
            if s.audio_local: target = s.audio_local
        return c + [fh_wrap(s.b, "d", target, getattr(s, "id", ""))]

    def quality_label(s):
        b = s.b
        fmt = b.get("format") or ""
        lab = TAGS.get((s.url, fmt)) or str(b.get("label") or "").split("·")[0]
        if s.mode in ("a", "as"): lab = "Audio"
        elif s.mode == "s": lab = "Subtitr"
        elif s.mode in ("vs", "v"): lab = (lab.strip() + " səssiz").strip()
        if not lab.strip():
            m = re.search(r"height\s*[<=]+\s*(\d+)", fmt)
            lab = f"{m.group(1)}p" if m else ("MP3" if b.get("audio") else "")
        return re.sub(r"[^\w .+()-]", "", lab).strip()[:30]

    def move_target(s):
        """Fərqli Saxla: yükləmə bitəndən sonra faylı seçilmiş ünvana köçür."""
        if not s.target or not s.path or not os.path.exists(s.path): return
        try:
            t = s.target
            if not os.path.isabs(t): t = os.path.join(str(DL_DIR), os.path.basename(t))
            actual = os.path.splitext(s.path)[1]
            base, ext = os.path.splitext(t)
            if actual and ext.lower() != actual.lower(): t = base + actual
            d = os.path.dirname(t)
            if d: os.makedirs(d, exist_ok=True)
            if os.path.abspath(t) != os.path.abspath(s.path):
                shutil.move(s.path, t)
            s.path, s.name = t, os.path.basename(t)
        except Exception:
            pass

    def reset(s):
        keep = s.progress if s.resume else 0.0
        s.status, s.progress, s.speed, s.eta = "active", keep, 0, None
        s.size = s.done_bytes = s.fin_bytes = 0
        s._disp_floor, s._phase, s._audio_i, s._audio_n = (keep if s.resume else 0.0), "video", 0, 0
        s.known_streams = False
        s.error = s.phase = s.path = ""
        s.parts, s.done = 1, 0
        s.fin_files, s.seen_files = set(), set()
        s.exists, s.exist_path = False, ""
        s.fail = False
        s.throttled, s.hits, s.hit_t = False, 0, []
        s.procs, s.tr = [], []
        s.t0 = time.time(); s.slow_t = 0; s.fq = {}

    # ---------- icra
    def exec(s, cmd):
        s.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                  errors="replace", bufsize=1, start_new_session=True)
        for line in s.proc.stdout: s.parse(line.rstrip())
        return s.proc.wait()

    # ---- hotstream (beHLS): öz fraqment yükləyicimiz.
    # Paralel yükləyir; xətalı fraqmenti atlayıb davam edir; sonunda xətalıları TƏKRAR
    # yükləyib ÖZ İNDEKSİNƏ qoyur; yenə alınmasa həmin fraqmentsiz birləşdirir və xəta yazır.
    def run_hs(s):
        import concurrent.futures as cf
        b = s.b
        title = safe_name(b.get("title") or b.get("pageTitle") or "video") or "video"
        lab = s.quality_label()
        stem = (title + (f" [{lab}]" if lab else ""))
        s.out_stem = s.out_stem or unique_stem(safe_name(stem), str(DL_DIR), VIDEO_EXTS)
        out = os.path.join(str(DL_DIR), s.out_stem + ".mp4")
        tmp = tempfile.mkdtemp(prefix=".idm-hs-", dir=str(DL_DIR))
        ua = str(b.get("userAgent") or "Mozilla/5.0")
        hdr = {"User-Agent": ua, "Origin": "https://hotstream.club",
               "Referer": "https://hotstream.club/", "Accept": "*/*"}
        try:
            s.status, s.speed, s.eta, s.phase, s.error = "active", 0, None, "Fraqment siyahısı oxunur", ""
            segs = None
            for _ in range(3):
                try: segs = _hs_playlist(s.url); break
                except Exception: time.sleep(1.5)
            if not segs: raise RuntimeError("Playlist oxunmadı")
            total = len(segs)
            s.parts, s.done = 1, 0
            lock = threading.Lock()
            st = {"n": 0, "bytes": 0, "t0": time.time(), "errs": {}}

            def one(u, path, tries=3):
                last = None
                for k in range(tries):
                    if s.removed: raise RuntimeError("ləğv edildi")
                    try:
                        req = urllib.request.Request(u, headers=hdr)
                        with urllib.request.urlopen(req, timeout=45) as r: data = r.read()
                        if not data or len(data) < 188: raise RuntimeError("boş fraqment")
                        part = path + ".part"
                        with open(part, "wb") as fh: fh.write(data)
                        os.replace(part, path)
                        return len(data)
                    except Exception as e:
                        last = e
                        time.sleep(0.5 + k * 1.5)
                raise RuntimeError(str(last)[:140])

            def work(seg):
                idx, u, _d = seg
                path = os.path.join(tmp, f"{idx:06d}.ts")
                if os.path.exists(path): return idx, None
                try:
                    n = one(u, path)
                except Exception as e:
                    return idx, str(e)
                with lock:
                    st["n"] += 1; st["bytes"] += n
                    avg = st["bytes"] / max(1, st["n"])
                    el = max(0.001, time.time() - st["t0"])
                    s.done_bytes = st["bytes"]
                    s.size = int(avg * total)
                    s.progress = min(99.0, st["n"] / total * 100)
                    s.speed = st["bytes"] / el
                    s.eta = (total - st["n"]) * (el / max(1, st["n"]))
                return idx, None

            s.phase = "Fraqmentlər yüklənir"
            failed = {}
            with cf.ThreadPoolExecutor(max_workers=16) as ex:
                for idx, err in ex.map(work, segs):
                    if err: failed[idx] = err
                    if s.removed: break
            # Sonunda xətalı fraqmentləri təkrar yüklə (2 mərhələ)
            for rnd in range(3):
                if not failed or s.removed: break
                s.phase = f"Xətalı fraqmentlər təkrar yüklənir ({rnd + 1}/3)"
                time.sleep(2 + rnd * 2)
                still = {}
                for idx in sorted(failed):
                    u = next((x[1] for x in segs if x[0] == idx), None)
                    if not u: continue
                    try:
                        n = one(u, os.path.join(tmp, f"{idx:06d}.ts"), tries=3)
                        st["bytes"] += n
                    except Exception as e:
                        still[idx] = str(e)
                failed = still
            have = [i for i, _u, _d in segs if os.path.exists(os.path.join(tmp, f"{i:06d}.ts"))]
            if not have: raise RuntimeError("Heç bir fraqment yüklənmədi")
            s.phase = "Birləşdirilir (ffmpeg)"
            lst = os.path.join(tmp, "list.txt")
            with open(lst, "w", encoding="utf-8") as fh:
                for i in have: fh.write("file '%s'\n" % os.path.join(tmp, f"{i:06d}.ts").replace("'", "'\\''"))
            cmd = ["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-bsf:a", "aac_adtstoasc"]
            if s.mode == "v": cmd += ["-an"]
            cmd += [out]
            rc, log = s.ffmpeg(cmd)
            if rc != 0 or not os.path.exists(out) or os.path.getsize(out) <= 0:
                raise RuntimeError("Birləşdirmə alınmadı: " + (log[0][:160] if log else "ffmpeg"))
            s.path, s.name = out, os.path.basename(out)
            s.size = s.done_bytes = os.path.getsize(out)
            s.progress, s.speed, s.eta = 100.0, 0, None
            s.move_target()
            s.status = "complete"
            if failed:
                miss = ", ".join("#" + str(i) for i in sorted(failed)[:12]) + (" …" if len(failed) > 12 else "")
                s.note = f"{len(failed)} fraqment yüklənmədi və atlandı"
                s.hs_missing = f"Xəta verən fraqment(lər): {miss}"
            return 0
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # ---- pilavyerplay (jetfilmizle): AES-128 HLS + ".txt" seqmentlər.
    # ffmpeg özü həm AES-i açır, həm də uzantı məhdudiyyətini keçir (-extension_picky 0).
    def run_pv(s):
        """pilavyerplay (jetfilmizle): AES-128 HLS. Seqmentlər paralel yüklənir,
        openssl ilə açılır, sıra ilə birləşdirilir (video+səs ayrı, sonra mux)."""
        import concurrent.futures as cf
        b = s.b
        master = s.url
        txt = _pv_get(master, b).decode("utf-8", "replace")
        if not txt.lstrip().startswith("#EXTM3U"): raise RuntimeError("Playlist deyil")
        is_master = "#EXT-X-STREAM-INF" in txt
        def attr(line, key):
            m = re.search(key + r'="([^"]*)"', line)
            return m.group(1) if m else ""
        auds = []
        for line in txt.splitlines():
            line = line.strip()
            if line.startswith("#EXT-X-MEDIA") and "TYPE=AUDIO" in line:
                auds.append({"name": attr(line, "NAME"), "lang": attr(line, "LANGUAGE"),
                             "default": attr(line, "DEFAULT").upper() == "YES", "uri": attr(line, "URI")})
        lns = txt.splitlines()
        variants = []
        if is_master:
            for i2, l in enumerate(lns):
                if l.startswith("#EXT-X-STREAM-INF"):
                    j2 = i2 + 1
                    while j2 < len(lns) and (not lns[j2].strip() or lns[j2].startswith("#")): j2 += 1
                    if j2 < len(lns):
                        m = re.search(r"RESOLUTION=(\d+)x(\d+)", l)
                        bw = re.search(r"AVERAGE-BANDWIDTH=(\d+)", l) or re.search(r"BANDWIDTH=(\d+)", l)
                        variants.append((int(m.group(2)) if m else 0, int(bw.group(1)) if bw else 0, lns[j2].strip()))
            if not variants: raise RuntimeError("Keyfiyyət (variant) tapılmadı")
            vh, vbw, vuri = max(variants, key=lambda x: x[0])
            vurl = urllib.parse.urljoin(master, vuri)
        else:
            vh, vbw = 0, 0
            vurl = master   # media playlist: URL-in özü trektir
        want = ""
        m = re.search(r"group_aud-([\w-]+)", b.get("format") or "")
        if m and not b.get("audioAuto"): want = m.group(1)
        aud = next((a for a in auds if want and a["name"] == want), None) or next((a for a in auds if a["default"]), None) or (auds[0] if auds else None)
        aurl = urllib.parse.urljoin(master, aud["uri"]) if (aud and aud.get("uri")) else ""
        title = safe_name(b.get("title") or b.get("pageTitle") or "video") or "video"
        lab = s.quality_label() or (f"{vh}p" if vh else "")
        s.out_stem = s.out_stem or unique_stem(safe_name(title + (f" [{lab}]" if lab else "")), str(DL_DIR), VIDEO_EXTS)
        fmt_a = str(b.get("audioFormat") or "best").lower()
        ext_a = {"mp3": "mp3", "m4a": "m4a", "opus": "opus", "vorbis": "ogg", "flac": "flac", "wav": "wav"}.get(fmt_a, "m4a")
        out = os.path.join(str(DL_DIR), s.out_stem + ("." + ext_a if s.mode == "a" else ".mp4"))
        tmp = tempfile.mkdtemp(prefix=".idm-pv-", dir=str(DL_DIR))
        ua = str(b.get("userAgent") or "Mozilla/5.0")
        hdr = {"User-Agent": ua, "Accept": "*/*"}
        ref = b.get("referer") or b.get("pageUrl")
        if ref: hdr["Referer"] = str(ref)
        lock = threading.Lock()
        st = {"bytes": 0, "n": 0, "t0": time.time(), "vb": 0, "vn": 0, "ab": 0, "an": 0}
        try:
            s.status, s.phase, s.speed, s.eta, s.error = "active", "Fraqmentlər yüklənir (AES-128)", 0, None, ""
            def parse_pl(url):
                t = _pv_get(url, b).decode("utf-8", "replace")
                segs, key, dur = [], None, 0.0
                for line in t.splitlines():
                    z = line.strip()
                    if z.startswith("#EXT-X-KEY:"):
                        if "METHOD=NONE" in z: key = None
                        else:
                            u = re.search(r'URI="([^"]+)"', z)
                            iv = re.search(r"IV=0x([0-9A-Fa-f]+)", z)
                            key = (u.group(1) if u else "", iv.group(1) if iv else "")
                    elif z.startswith("#EXTINF:"):
                        try: dur = float(z[8:].split(",")[0])
                        except Exception: dur = 0.0
                    elif z and not z.startswith("#"):
                        segs.append({"url": z, "key": key, "i": len(segs), "dur": dur})
                        dur = 0.0
                return segs
            # media playlist (master yoxdur) adətən video+səs birlikdədir -> ayrıca səs treki yoxdur
            muxed = not aurl
            need_a_tr = s.mode in ("va", "vas", "a") and not muxed
            need_v = s.mode in ("va", "v", "vas", "vs") or (s.mode == "a" and muxed)
            vsegs = parse_pl(vurl) if need_v else []
            ase = parse_pl(aurl) if need_a_tr else []
            if not vsegs and not ase: raise RuntimeError("Seqment siyahısı boşdur")
            dur_total = sum((x["dur"] for x in (vsegs or ase)), 0.0)
            est0 = int(dur_total * (vbw or 0) / 8) if (dur_total and vbw) else 0
            if ase and dur_total: est0 += int(dur_total * 128000 / 8)
            if est0 > 0: s.size = est0
            # key/iv: hər trek üçün bir dəfə
            def key_for(seg):
                k = seg.get("key")
                if not k or not k[0]: return None
                kurl = urllib.parse.urljoin(vurl, k[0])
                r = urllib.request.Request(kurl, headers=hdr)
                with urllib.request.urlopen(r, timeout=20) as rr: kb = rr.read(64)
                if len(kb) < 16: raise RuntimeError("AES açarı alınmadı")
                iv = k[1] or ("%032x" % seg["i"])
                return kb[:16].hex(), iv
            def fetch_dec(seg, path_ts, path_enc, kind="v", tries=3):
                last = None
                for k2 in range(tries):
                    if s.removed: raise RuntimeError("ləğv edildi")
                    try:
                        rq = urllib.request.Request(seg["url"], headers=hdr)
                        with urllib.request.urlopen(rq, timeout=45) as rr: data = rr.read()
                        if not data: raise RuntimeError("boş seqment")
                        open(path_enc, "wb").write(data)
                        kv = key_for(seg)
                        if kv:
                            rc = subprocess.run(["openssl", "aes-128-cbc", "-d", "-in", path_enc, "-out", path_ts,
                                                 "-K", kv[0], "-iv", kv[1]], capture_output=True, timeout=60)
                            if rc.returncode != 0 or not os.path.exists(path_ts) or os.path.getsize(path_ts) == 0:
                                raise RuntimeError("AES açılmadı")
                            try: os.remove(path_enc)
                            except OSError: pass
                        else:
                            os.replace(path_enc, path_ts)
                        with lock:
                            st["bytes"] += len(data); st["n"] += 1
                            if kind == "a": st["ab"] += len(data); st["an"] += 1
                            else: st["vb"] += len(data); st["vn"] += 1
                            el = max(0.001, time.time() - st["t0"])
                            av = (st["vb"] / st["vn"]) if st["vn"] else 0
                            aa = (st["ab"] / st["an"]) if st["an"] else 0
                            est = int(av * len(vsegs) + aa * len(ase)) if (av or aa) else 0
                            s.done_bytes = st["bytes"]
                            s.speed = st["bytes"] / el
                            if est > 0: s.size = max(est, st["bytes"])
                            s.progress = min(99.0, st["bytes"] / s.size * 100) if s.size else 0.0
                            if s.progress > 0: s.eta = (100 - s.progress) / s.progress * el
                        return len(data)
                    except Exception as e:
                        last = e; time.sleep(0.6 + k2 * 1.4)
                raise RuntimeError(str(last)[:140])
            jobs = []
            for seg in vsegs:
                jobs.append((seg, os.path.join(tmp, "v%05d.ts" % seg["i"]), os.path.join(tmp, "v%05d.enc" % seg["i"]), "v"))
            for seg in ase:
                jobs.append((seg, os.path.join(tmp, "a%05d.ts" % seg["i"]), os.path.join(tmp, "a%05d.enc" % seg["i"]), "a"))
            failed = []
            with cf.ThreadPoolExecutor(max_workers=12) as ex:
                futs = {ex.submit(fetch_dec, j[0], j[1], j[2], j[3]): j for j in jobs}
                for f in cf.as_completed(futs):
                    if s.removed: break
                    try: f.result()
                    except Exception as e: failed.append((futs[f][0], str(e)))
            if s.removed: return 1
            s.phase = "Birləşdirilir (ffmpeg)"
            def concat(prefix, segs_list, o, an=False):
                # HLS demuxer: seqmentlərin öz PTS-i qorunur. "concat" demuxeri bu tip
                # axınlarda (audio video-dan bir neçə ms əvvəl başlayır) hər sərhəddə
                # boşluq yaradıb səsi sürüşdürürdü.
                lst = os.path.join(tmp, prefix + "-list.m3u8")
                with open(lst, "w", encoding="utf-8") as fh:
                    fh.write("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:12\n#EXT-X-MEDIA-SEQUENCE:0\n")
                    for seg in segs_list:
                        fp = os.path.join(tmp, "%s%05d.ts" % (prefix, seg["i"]))
                        if os.path.exists(fp):
                            fh.write("#EXTINF:%.3f,\n%s\n" % (float(seg.get("dur") or 6.0), os.path.basename(fp)))
                    fh.write("#EXT-X-ENDLIST\n")
                rc = subprocess.run(["ffmpeg", "-y", "-v", "error", "-nostdin", "-i", lst,
                                     "-c", "copy", "-bsf:a", "aac_adtstoasc"] + (["-an"] if an else []) + [o],
                                    capture_output=True, text=True, timeout=1800)
                return rc.returncode, (rc.stderr or "").strip().splitlines()[-1:] or [""]
            apart = os.path.join(tmp, "a.m4a")
            if s.mode == "a" and muxed:
                # video+səs birlikdə olan trek: videonu yığ, səsi ondan çıxar
                vtmp = os.path.join(tmp, "vsrc.mp4")
                rc0, log0 = concat("v", vsegs, vtmp)
                if rc0 != 0: raise RuntimeError("Video birləşmədi: " + (log0[0][:150] if log0 else "ffmpeg"))
                opts0 = {"mp3": ("libmp3lame", ".mp3"), "m4a": ("aac", ".m4a"), "opus": ("libopus", ".opus"),
                         "vorbis": ("libvorbis", ".ogg"), "flac": ("flac", ".flac"), "wav": ("pcm_s16le", ".wav")}
                cod0 = opts0.get(fmt_a, ("aac", ".m4a"))[0]
                br0 = int(num(b.get("audioQuality")) or 0)
                a0 = ["-i", vtmp, "-vn", "-c:a", cod0] + (["-b:a", f"{br0}k"] if br0 and fmt_a not in ("flac", "wav") else []) + [out]
                rr0 = subprocess.run(["ffmpeg", "-y", "-v", "error", "-nostdin", *a0], capture_output=True, text=True, timeout=1800)
                if rr0.returncode != 0 or not os.path.exists(out):
                    raise RuntimeError("Səs çıxarılmadı: " + ((rr0.stderr or "").strip().splitlines()[-1:] or [""])[0][:150])
            elif s.mode == "a":
                rc2, log2 = concat("a", ase, apart)
                if rc2 != 0: raise RuntimeError("Səs birləşmədi: " + (log2[0][:150] if log2 else "ffmpeg"))
                opts = {"mp3": ("libmp3lame", ".mp3"), "m4a": ("aac", ".m4a"), "opus": ("libopus", ".opus"),
                        "vorbis": ("libvorbis", ".ogg"), "flac": ("flac", ".flac"), "wav": ("pcm_s16le", ".wav")}
                if fmt_a in opts:
                    cod = opts[fmt_a][0]
                    br = int(num(b.get("audioQuality")) or 0)
                    a2 = ["-i", apart, "-vn", "-c:a", cod] + (["-b:a", f"{br}k"] if br and fmt_a not in ("flac", "wav") else []) + [out]
                    rr = subprocess.run(["ffmpeg", "-y", "-v", "error", "-nostdin", *a2], capture_output=True, text=True, timeout=1800)
                    if rr.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) <= 0:
                        raise RuntimeError("Səs çevrilmədi: " + ((rr.stderr or "").strip().splitlines()[-1:] or [""])[0][:150])
                else:
                    os.replace(apart, out)
            else:
                vpart = os.path.join(tmp, "v.mp4")
                rc, log = concat("v", vsegs, vpart, an=(s.mode == "v" or bool(ase)))
                if rc != 0: raise RuntimeError("Video birləşmədi: " + (log[0][:150] if log else "ffmpeg"))
                if ase:
                    rc2, log2 = concat("a", ase, apart)
                    if rc2 != 0: raise RuntimeError("Səs birləşmədi: " + (log2[0][:150] if log2 else "ffmpeg"))
                    rc3 = subprocess.run(["ffmpeg", "-y", "-v", "error", "-nostdin", "-i", vpart, "-i", apart,
                                          "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", out],
                                         capture_output=True, text=True, timeout=1800)
                    if rc3.returncode != 0 or not os.path.exists(out):
                        raise RuntimeError("Mux alınmadı: " + ((rc3.stderr or "").strip().splitlines()[-1:] or [""])[0][:150])
                else:
                    os.replace(vpart, out)
            s.path, s.name = out, os.path.basename(out)
            s.size = s.done_bytes = os.path.getsize(out)
            s.progress, s.speed, s.eta, s.phase = 100.0, 0, None, ""
            s.move_target()
            s.status = "complete"
            if failed:
                miss = ", ".join("#" + str(x[0]["i"]) for x in failed[:12]) + (" …" if len(failed) > 12 else "")
                s.note = f"{len(failed)} fraqment yüklənmədi və atlandı"
                s.hs_missing = f"Xəta verən fraqment(lər): {miss}"
            return 0
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    def _prefetch_par(s):
        """YouTube: seçilmiş səs treklərini (və native subtitrləri) ƏSAS video yükləməsi ilə
        paralel başladır. `mux_multi_audio`/`post` onların nəticələrini gözləyib birləşdirir."""
        try:
            tracks = audio_tracks(s.b)
            stem = safe_name(os.path.splitext(s.name or s.out_stem or "audio")[0] or "audio") or "audio"
            s._pre_audio = [None] * len(tracks)
            for i, t in enumerate(tracks):
                def one(i=i, t=t):
                    try:
                        url = t["url"] or s.url
                        fsel = "" if t["url"] else t["id"]
                        p = dl_audio_track(s.b, url, fsel, os.path.join(str(DL_DIR), stem + "." + s.id + ".pa%d" % i))
                        s._pre_audio[i] = p
                        if p and os.path.exists(p):
                            s._extra_done_bytes = (getattr(s, "_extra_done_bytes", 0) or 0) + os.path.getsize(p)
                            if s._extra_done_bytes > s._extra_total_bytes: s._extra_total_bytes = s._extra_done_bytes
                    except Exception:
                        pass
                    finally:
                        s._extra_done = (getattr(s, "_extra_done", 0) or 0) + 20
                th = threading.Thread(target=one, daemon=True)
                th.start(); s._pre_threads.append(th)
            if is_youtube(s.url) and s.native_subs and s.mode in SUBMODES and not s.ext_subs:
                def subs():
                    try:
                        p = subprocess.Popen(s.cmd(sub_only=True), stdout=subprocess.DEVNULL,
                                             stderr=subprocess.DEVNULL, start_new_session=True)
                        p.wait()
                    except Exception:
                        pass
                s._pre_subs = threading.Thread(target=subs, daemon=True)
                s._pre_subs.start()
        except Exception:
            pass

    def _mux_subs(s, files):
        """Hazır subtitr fayllarını videoya birləşdirir (ASS stilini saxlayaraq)."""
        if not (s.ff and files and s.path and os.path.exists(s.path)): return False
        files = s.style_subs(files)
        has_ass = any(str(f).lower().endswith((".ass", ".ssa")) for f in files)
        out = os.path.splitext(s.path)[0] + ".idm-smux.mkv"
        args = ["-i", s.path]
        for f in files: args += ["-i", f]
        args += ["-map", "0"]
        for i in range(len(files)): args += ["-map", "%d:0" % (i + 1)]
        args += (["-c", "copy"] if has_ass else ["-c", "copy", "-c:s", "srt"])
        for i, f in enumerate(files):
            base = re.sub(r"\.styled\.ass$", ".ass", str(f), flags=re.I)
            mm = re.search(r"\.([A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})?)\.(?:vtt|srt|ass|ssa)$", base, re.I)
            lang = mm.group(1) if mm else "und"
            args += ["-metadata:s:s:%d" % i, "language=" + lang]
            args += ["-metadata:s:s:%d" % i, "title=" + (lang.upper() if lang != "und" else "Alt yazı")]
            args += ["-disposition:s:%d" % i, "default" if i < 2 else "0"]
        rc, last = s.ffmpeg(args + [out])
        if rc == 0 and os.path.exists(out) and os.path.getsize(out) > 2048:
            newp = os.path.splitext(s.path)[0] + ".mkv"
            try: os.remove(s.path)
            except Exception: pass
            os.replace(out, newp)
            s.path, s.name = newp, os.path.basename(newp)
            return True
        rm(out)
        return False

    def exec_main(s):
        if not s.split: return s.exec(s.cmd())
        s.force_parts = s.parts = 2
        # video və audio AYNI ANDA: iki ayrı yt-dlp prosesi, hər birinin öz izləyicisi (s.tr[i]); ümumi irəliləyiş onların cəmidir
        s.tr = [dict(fin=0, cur=0, total=0, speed=0.0, eta=None, frac=0.0, finished=False, path="") for _ in range(2)]
        specs = ((s.vfmt, s.vn, ".idmv"), (s.afmt, s.an, ".idma"))
        procs = []
        for fmt, n, suf in specs:
            procs.append(subprocess.Popen(s.cmd(fmt=fmt, n=n, suffix=suf), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                          text=True, errors="replace", bufsize=1, start_new_session=True))
        s.procs = procs
        def pump(i):
            for line in procs[i].stdout: s.parse_track(i, line.rstrip())
        ths = [threading.Thread(target=pump, args=(i,), daemon=True) for i in range(2)]
        for th in ths: th.start()
        rcs = [p.wait() for p in procs]
        for th in ths: th.join(5)
        if s.removed: return 1
        if any(rcs):
            for p in procs:
                try:
                    if p.poll() is None: _kill_tree(p, signal.SIGTERM)
                except Exception: pass
            return next(r for r in rcs if r)
        v, a = s.tr[0]["path"], s.tr[1]["path"]
        if not (v and a and os.path.exists(v) and os.path.exists(a)):
            s.error = s.error or "Video/audio faylı tapılmadı (yt-dlp çıxış yolu oxunmadı)"
            return 1
        base, last = re.sub(r"\.idmv$", "", os.path.splitext(v)[0]), [""]
        s.phase, s.speed, s.eta = "Video+audio birləşdirilir (ffmpeg)", 0, None
        s.progress = max(s.progress, 99.0)
        for ext in ("mp4", "mkv"):
            out = f"{base}.{ext}"
            rc, last = s.ffmpeg(["-i", v, "-i", a, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", out])
            if rc == 0 and os.path.exists(out) and os.path.getsize(out) > 0:
                rm(v); rm(a); s.path = out
                return 0
            rm(out)
        s.error = "ffmpeg birləşdirmə alınmadı: " + last[0][:120]
        return 1

    def parse_track(s, i, line):
        """Paralel yükləmədə i-ci prosesin (0=video, 1=audio) çıxışını oxuyur və ümumi vəziyyəti yeniləyir."""
        tr = s.tr[i]
        if not line.startswith("PROG|"):
            s.watch(line)
            m = EXISTS_RE.match(line)
            if m:  # resume: bu trek əvvəlki cəhddə tam yüklənib
                with s.plock:
                    tr["path"], tr["finished"], tr["frac"] = m.group(1), True, 1.0
                    try: tr["fin"] += os.path.getsize(m.group(1))
                    except OSError: pass
                return
        if line.startswith("PROG|"):
            f = line.split("|", 9)
            if len(f) < 10: return
            st, fn = f[1], f[9]
            if fn.lower().endswith(SUB_EXT): return
            down, tot, est, spd, eta, fi, fc = (num(x) for x in f[2:9])
            with s.plock:
                if fn and fn != "NA": tr["path"] = fn if not fn.endswith(".part") else fn[:-5]
                total = tot or est
                if st == "finished":
                    tr["fin"] += int(tot or down or 0); tr["cur"] = tr["total"] = 0
                    tr["speed"], tr["eta"], tr["frac"], tr["finished"] = 0.0, None, 1.0, True
                else:
                    tr["cur"], tr["total"] = int(down or 0), int(total or 0)
                    tr["speed"], tr["eta"] = spd or 0, eta
                    tr["frac"] = min((down / total) if (total and down is not None) else ((fi / fc) if (fi and fc) else 0.0), 1.0)
                s.size = sum(x["fin"] + x["total"] for x in s.tr)
                s.done_bytes = sum(x["fin"] + x["cur"] for x in s.tr)
                s.speed = sum(x["speed"] for x in s.tr)
                etas = [x["eta"] for x in s.tr if x["eta"] and not x["finished"]]
                s.eta = max(etas) if etas else None
                known = s.size > 0 and all(x["fin"] + x["total"] > 0 for x in s.tr)   # hər iki axının ölçüsü məlumdursa bayta görə, yoxsa orta hissə
                s.known_streams = known
                blank = any(not (x["fin"] or x["total"] or x["cur"] or x["finished"]) for x in s.tr)   # axınlardan biri hələ heç nə bildirməyib: yanlış 50%-ə tullanma
                pct = (s.done_bytes / s.size * 100) if known else (None if blank else sum(x["frac"] for x in s.tr) / len(s.tr) * 100)
                if pct is not None: s.progress = max(s.progress, min(pct, 98.0))
                s.phase = "" if getattr(s, "yt", False) else ("Video yüklənir" if i == 0 else "Səs yüklənir")
            if i == 0 and SLOW_BPS > 0: s.guard(spd, fc)   # yalnız video izləyicisi (audio kiçikdir)
            s.boost(i, "a" if i == 1 else "v", spd, fi, fc)
            return
        if line.startswith("[download] Destination:"):
            m = DEST_RE.search(line)
            if m and not m.group(1).lower().endswith(SUB_EXT): tr["path"] = m.group(1)
        if "ERROR:" in line: s.error = line.split("ERROR:", 1)[1].strip()

    def check_av(s):
        """Birləşdirilmiş faylda səsin müddəti videodan ≥3% UZUNDURSA, səs yavaş/qalın səslənir (nümunə tezliyi səhv: məs. 44100 Hz səs 22050 Hz yazılıb).
        Nisbət standart tezliklərdən birinə uyğun gəlirsə (±1.5%) səs düzgün tezliyə qaytarılır (yalnız səs yenidən kodlanır, video toxunulmaz).
        Uyğun gəlmirsə fayl dəyişdirilmir, yalnız qeyd olunur. Alınmasa orijinal qalır."""
        p = s.path
        if not (s.ff and shutil.which("ffprobe") and p and os.path.exists(p)): return
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,sample_rate,duration", "-of", "json", p],
                           capture_output=True, text=True, errors="replace", timeout=30, stdin=subprocess.DEVNULL)
        st = (json.loads(r.stdout or "{}").get("streams") or [])
        v = next((x for x in st if x.get("codec_type") == "video"), None)
        a = next((x for x in st if x.get("codec_type") == "audio"), None)
        if not (v and a): return
        vd, ad, sr = num(v.get("duration")), num(a.get("duration")), int(num(a.get("sample_rate")) or 0)
        if not (vd and ad and sr and vd >= 5): return
        ratio = ad / vd
        if abs(ratio - 1) <= 0.03: return
        real = sr * ratio
        tgt = min((8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000), key=lambda t: abs(t - real))
        if ratio > 1.03 and abs(tgt / real - 1) < 0.015:
            out = os.path.splitext(p)[0] + ".idm-fix" + os.path.splitext(p)[1]
            s.phase = "Səs sürəti düzəldilir (ffmpeg)"
            rc, _ = s.ffmpeg(["-i", p, "-map", "0:v:0", "-c:v", "copy", "-map", "0:a:0", "-af", f"asetrate={tgt}", "-c:a", "aac", "-b:a", "192k", out])
            if rc == 0 and os.path.exists(out) and os.path.getsize(out) > 0:
                os.replace(out, p)
                s.note = f"Səs yavaş idi (nümunə tezliyi {sr}→{tgt} Hz səhv işarələnmişdi): düzəldildi"
            else: rm(out); s.note = f"Səs müddəti videodan {ratio:.2f}× uzundur (yavaş/qalın ola bilər), düzəltmək alınmadı"
        elif abs(ratio - 1) > 0.05:
            s.note = f"Səs müddəti ({ad:.0f} san) videodan ({vd:.0f} san) fərqlidir: səs sürəti uyğun olmaya bilər"

    def mux_multi_audio(s):
        """İstifadəçi səs treki/trekləri seçibsə: hər treki ayrıca endirib video ilə
        ffmpeg `-c copy` ilə birləşdirir (yt-dlp-nin `-map 0:a` xətasına düşmədən).
        Subtitle stream-ləri də qorunur. Nəticə .mkv-yə yazılır."""
        tracks = audio_tracks(s.b)
        if not tracks: return
        if not (s.path and os.path.exists(s.path)): return
        ff = shutil.which("ffmpeg")
        if not ff: raise RuntimeError("ffmpeg quraşdırılmayıb")
        tmp = tempfile.mkdtemp(prefix=".idm-mux-", dir=str(DL_DIR))
        got = []
        try:
            s.phase, s.speed, s.eta = "Səs trekləri ayrıca yüklənir", 0, None
            s._phase, s._audio_i, s._audio_n = "audio", 0, max(1, len(tracks))
            pre = list(getattr(s, "_pre_audio", []) or [])
            # YouTube: səs trekləri artıq video ilə paralel başladılıb — bitməsini gözlə.
            for th in list(getattr(s, "_pre_threads", []) or []):
                try: th.join()
                except Exception: pass
            base_done = int(getattr(s, "_extra_done_bytes", 0) or 0)
            for i, t in enumerate(tracks):
                if s.removed: return
                p = pre[i] if (i < len(pre) and pre[i]) else ""
                if p:
                    got.append((p, t.get("lang") or ""))
                    s._audio_i = i + 1
                    continue
                url = t["url"] or s.url
                fsel = "" if t["url"] else t["id"]
                def on_audio(done, total, spd, eta, i=i, base=base_done):
                    try:
                        total = int(total or 0); done = int(done or 0)
                        if total > 0:
                            s._extra_total_bytes = max(int(getattr(s, "_extra_total_bytes", 0) or 0), base + total)
                        if done > 0:
                            s._extra_done_bytes = max(int(getattr(s, "_extra_done_bytes", 0) or 0), base + done)
                        if spd: s.speed = spd
                        if eta is not None: s.eta = eta
                        s.phase = "Səs yüklənir (%d/%d)" % (i + 1, len(tracks))
                    except Exception: pass
                p = dl_audio_track(s.b, url, fsel, os.path.join(tmp, "a%d" % i), progress=on_audio)
                if p:
                    got.append((p, t.get("lang") or ""))
                    try:
                        base_done += os.path.getsize(p)
                        s._extra_done_bytes = max(int(getattr(s, "_extra_done_bytes", 0) or 0), base_done)
                        if s._extra_done_bytes > s._extra_total_bytes: s._extra_total_bytes = s._extra_done_bytes
                    except Exception: pass
                s._audio_i = i + 1
                s._extra_done = (getattr(s, "_extra_done", 0) or 0) + 20
            if not got: return
            s._phase = "merge"
            out = os.path.join(tmp, "muxed.mkv")
            newp = os.path.splitext(s.path)[0] + ".mkv"
            if os.path.abspath(newp) == os.path.abspath(s.path):
                newp = os.path.splitext(s.path)[0] + ".idm-av.mkv"
            args = [ff, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", s.path]
            for p, _ in got: args += ["-i", p]
            args += ["-map", "0:v:0", "-map", "0:s?"]
            for i in range(len(got)): args += ["-map", "%d:a:0" % (i + 1)]
            args += ["-c", "copy"]
            for i, (_, lang) in enumerate(got):
                if lang: args += ["-metadata:s:a:%d" % i, "language=" + lang]
            args += [out]
            s.phase = "Səs trekləri birləşdirilir (ffmpeg)"
            rc = subprocess.run(args, capture_output=True, text=True, timeout=3600).returncode
            if rc == 0 and os.path.exists(out) and os.path.getsize(out) > 2048:
                rm(s.path)
                os.replace(out, newp)
                s.path = newp; s.name = os.path.basename(newp)
                s.note = ("Seçilmiş %d səs treki birləşdirildi" % len(got)) + ((" · " + s.note) if s.note else "")
            else:
                rm(out)
        finally:
            try:
                for pp, _ in got:
                    if pp and os.path.dirname(pp) == str(DL_DIR) and re.search(r"\.pa\d+\.", os.path.basename(pp)):
                        rm(pp)
            except Exception:
                pass
            shutil.rmtree(tmp, ignore_errors=True)

    def ffmpeg(s, args):
        s.proc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-nostdin", *args], stdout=subprocess.DEVNULL,
                                  stderr=subprocess.PIPE, text=True, errors="replace", start_new_session=True)
        err = s.proc.communicate()[1]
        return s.proc.returncode, (err or "").strip().splitlines()[-1:] or [""]

    def flush_subs(s):
        """Müvəqqəti qovluqdakı boş olmayan subtitr fayllarını Downloads-a köçür."""
        moved = []
        if s.subdir:
            for f in sorted(glob.glob(os.path.join(glob.escape(s.subdir), "*"))):
                try:
                    if f.lower().endswith(SUB_EXT) and os.path.getsize(f) > 0:
                        d = unique_path(os.path.join(str(DL_DIR), os.path.basename(f)))
                        shutil.move(f, d); moved.append(d)
                except OSError: pass
            shutil.rmtree(s.subdir, ignore_errors=True)
            s.subdir = ""
        return moved

    def style_subs(s, files):
        """Yüklənən subtitr fayllarını seçilmiş ölçü/stil/fonla stilləndirilmiş .ass-ə çevirir."""
        ap = getattr(s, "subap", None)
        if not ap or not files: return files
        out = []
        for f in files:
            try:
                nf = style_subtitle_file(f, ap)
            except Exception:
                nf = f
            if nf and nf != f:
                rm(f)
            out.append(nf or f)
        return out

    def check_audio(s):
        """Səs rejimində yüklənən fayl həqiqətən oxunan səsdirmi (ffprobe). Qaytarır (ok, səbəb). Uyğunsuz konteyneri (webm/mka/mp4) .opus/.m4a-ya çevirir."""
        p = s.path
        if not p or not os.path.exists(p): return False, "fayl tapılmadı: " + (p or "?")
        sz = os.path.getsize(p)
        if sz < 1024: return False, f"fayl boşdur/çox kiçikdir ({sz} bayt)"
        fp = shutil.which("ffprobe")
        if not fp: return True, ""
        try:
            r = subprocess.run([fp, "-v", "error", "-show_entries", "stream=codec_type,codec_name:stream_disposition=attached_pic:format=duration", "-of", "json", p],
                               capture_output=True, text=True, errors="replace", timeout=30, stdin=subprocess.DEVNULL)
            j = json.loads(r.stdout or "{}")
        except Exception as e: return False, "ffprobe oxuya bilmədi: " + str(e)[:80]
        a = [x for x in (j.get("streams") or []) if x.get("codec_type") == "audio"]
        if not a: return False, "faylda səs axını yoxdur" + ((" (" + r.stderr.strip().splitlines()[-1][:80] + ")") if r.stderr.strip() else "")
        dur = num((j.get("format") or {}).get("duration"))
        if dur is not None and dur <= 0: return False, "səsin müddəti 0-dır"
        ext, codec = os.path.splitext(p)[1].lower(), str(a[0].get("codec_name") or "")
        tgt = {"opus": ".opus", "vorbis": ".ogg", "aac": ".m4a", "mp3": ".mp3", "flac": ".flac"}.get(codec)
        vids = [x for x in (j.get("streams") or []) if x.get("codec_type") == "video" and not (x.get("disposition") or {}).get("attached_pic")]
        if s.ff and (vids or (tgt and ext in (".webm", ".weba", ".mka", ".mp4", ".mkv", ".m4v"))):   # video kimi yüklənib / oynadıcıların tanımadığı konteyner: səs ayrılır
            t2 = tgt or ".m4a"
            out = os.path.splitext(p)[0] + t2
            dst = out if out != p else os.path.splitext(p)[0] + ".idm-a" + t2
            if out == p or not os.path.exists(out):
                rc, _ = s.ffmpeg(["-i", p, "-vn", "-map", "0:a:0"] + (["-c:a", "copy"] if tgt else ["-c:a", "aac", "-b:a", "192k"]) + [dst])
                if rc == 0 and os.path.exists(dst) and os.path.getsize(dst) > 1024:
                    rm(p)
                    if dst != out: os.replace(dst, out)
                    s.path = out; s.name = os.path.basename(out)
                    if vids: s.note = "Yüklənən fayl video daşıyırdı: səs ayrıldı (video hissəsi silindi)"
                else: rm(dst)
        return True, ""

    def post(s):
        """Əsas yükləmədən sonrakı subtitr mərhələləri. Subtitr uğursuz olsa video itmir: səbəb 'note' kimi göstərilir."""
        m = s.mode
        if m == "v" and s.b.get("stripAudio") and s.ff and s.path and os.path.exists(s.path):
            s.phase = "Audio çıxarılır (ffmpeg)"
            tmpv = os.path.splitext(s.path)[0] + ".idm-v" + os.path.splitext(s.path)[1]
            rc, last = s.ffmpeg(["-i", s.path, "-map", "0:v", "-c", "copy", tmpv])
            if rc == 0 and os.path.exists(tmpv) and os.path.getsize(tmpv) > 0: os.replace(tmpv, s.path)
            else: rm(tmpv); s.note = "Audio çıxarıla bilmədi: " + last[0][:100]
        if m == "s" and s.native_subs:
            files = s.style_subs(s.flush_subs())
            if files: s.set_sub_result(files)
            else: s.fail, s.error = True, s.error or ("Subtitr faylı yaranmadı: bu dil üçün mövcud deyil və ya sayt (məs. YouTube) "
                                                       "subtitr üçün əlavə token tələb edir")
        elif m in ("vs", "vas", "as") and s.native_subs and (not s.embed or s.keep_subs):
            s.phase, s.speed, s.eta = "Subtitr yüklənir", 0, None
            err0, s.error = s.error, ""
            pre = getattr(s, "_pre_subs", None)
            if pre:
                try: pre.join()
                except Exception: pass
            else:
                s.exec(s.cmd(sub_only=True))
            suberr, s.error = s.error, err0
            files = s.style_subs(s.flush_subs())
            if files and getattr(s, "yt_par", False) and s.ff:
                # YouTube paralel rejim: subtitr artıq videonun özü ilə eyni anda endirilib — indi birləşdir.
                if s._mux_subs(files):
                    if not s.keep_subs:
                        for f in files: rm(f)
                    s.note = "Subtitr videoya birləşdirildi"
                else:
                    s.note = "Subtitr ayrıca fayl kimi saxlandı: " + ", ".join(os.path.basename(f) for f in files)[:120]
            elif files and s.site_fix and s.ff and not s.keep_subs and s.path and os.path.exists(s.path):
                # dizipalizm: subtitr əvvəlcədən videoya yazılmır (split rejimi) — merge-dən sonra ffmpeg ilə birləşdir
                if (s.subap or any(str(f).lower().endswith((".ass", ".ssa")) for f in files)) and s._mux_subs(files):
                    for f in files: rm(f)
                    s.note = "Subtitr videoya birləşdirildi"
                else:
                    ext = os.path.splitext(s.path)[1].lower()
                    tmp = os.path.splitext(s.path)[0] + ".idm-s" + ext
                    rc, last = s.ffmpeg(["-i", s.path, "-i", files[0], "-map", "0", "-map", "1:0", "-c", "copy",
                                         "-c:s", "mov_text" if ext in (".mp4", ".m4v") else "srt", tmp])
                    if rc == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 0:
                        os.replace(tmp, s.path); rm(files[0])
                        s.note = "Subtitr videoya birləşdirildi"
                    else:
                        rm(tmp); s.note = "Subtitr ayrıca fayl kimi saxlandı: " + os.path.basename(files[0])
            elif files:
                if s.subap and s.ff and s.path and os.path.exists(s.path) and s._mux_subs(files):
                    if not s.keep_subs:
                        for f in files: rm(f)
                    s.note = "Subtitr videoya birləşdirildi"
                else:
                    s.note = ("Subtitr ayrıca fayl kimi saxlandı" + ("" if s.keep_subs and s.embed else " (videoya birləşdirmək mümkün olmadı)")
                              + ": " + ", ".join(os.path.basename(f) for f in files)[:120])
            else: s.note = "Subtitr alınmadı: " + (suberr or "bu dil üçün mövcud deyil")[:150]
        elif s.ext_subs and m in SUBMODES:
            s.post_ext()

    def set_sub_result(s, files):
        s.path, s.name = files[0], os.path.basename(files[0])
        s.size = s.done_bytes = sum(os.path.getsize(f) for f in files if os.path.exists(f))
        if len(files) > 1: s.note = f"{len(files)} subtitr faylı"

    def post_ext(s):
        """Səhifədən aşkarlanan (<track>, .vtt/.srt sorğusu) subtitrlər: yt-dlp bunları bilmir, helper özü yükləyir."""
        b = s.b
        hdr = {"User-Agent": b.get("userAgent") or "Mozilla/5.0"}
        if b.get("referer"): hdr["Referer"] = b["referer"]
        if b.get("cookie"): hdr["Cookie"] = b["cookie"]
        base = (os.path.splitext(os.path.basename(s.path))[0] if (s.mode != "s" and s.path)
                else safe_name(b.get("pageTitle") or b.get("title") or "") or "subtitr")[:150]
        tmp, got, errs = s.sub_tmp(), [], []
        s.phase, s.speed, s.eta = "Subtitr yüklənir", 0, None
        for i, x in enumerate(s.ext_subs):
            try:
                h2 = dict(hdr)  # hər subtitr faylının öz Referer/Cookie-si (CDN-də ola bilər)
                if x.get("referer"): h2["Referer"] = str(x["referer"])
                if x.get("cookie"): h2["Cookie"] = str(x["cookie"])
                data = fetch_sub(x["url"], h2)
                ext = sniff_sub(data)
                lang = re.sub(r"[^\w-]", "", str(x.get("lang") or "")) or f"sub{i + 1}"
                fn = os.path.join(tmp, f"{base}.{lang}.{ext}")
                with open(fn, "wb") as fh: fh.write(data)
                # İkili dil ASS-i məzmunundan tanı: SRT-yə çevrilsə \p1 bayraq
                # vektorları mətn kimi görünür — style-ları qorumaq üçün saxlanılır.
                head = data[:8192].decode("utf-8", "ignore") if ext == "ass" else ""
                keep_ass = bool(x.get("keepAss")) or ("Style: Dual" in head) or ("\\p1" in head)
                if s.ff and ext != "srt" and not keep_ass:  # vahid format: srt (alınmasa orijinal qalır)
                    srt = os.path.join(tmp, f"{base}.{lang}.srt")
                    rc, _ = s.ffmpeg(["-i", fn, srt])
                    if rc == 0 and os.path.exists(srt) and os.path.getsize(srt) > 0: os.remove(fn); fn = srt
                    elif os.path.exists(srt): os.remove(srt)
                got.append((fn, {**x, "keepAss": keep_ass}))
                s._extra_done = (getattr(s, "_extra_done", 0) or 0) + 1
            except Exception as e: errs.append(f"{x.get('label') or x.get('lang') or 'subtitr'}: {e}")
        # Seçilmiş görünüş (ölçü/stil/fon): alt yazını stilləndirilmiş .ass-ə çevir.
        if got and getattr(s, "subap", None):
            ng = []
            for fn, x in got:
                nf = style_subtitle_file(fn, s.subap)
                if nf and nf != fn:
                    rm(fn); fn = nf; x = {**x, "keepAss": True}
                ng.append((fn, x))
            got = ng
        if not got:
            msg = "Subtitr yüklənmədi: " + "; ".join(errs)[:200]
            if s.mode == "s": s.fail, s.error = True, msg
            else: s.note = msg
            return
        if s.mode == "s":
            s.set_sub_result(s.flush_subs())
            if errs: s.note = ((s.note + " · ") if s.note else "") + "Bəziləri alınmadı: " + "; ".join(errs)[:120]
            return
        muxed = False
        if s.ff and s.path and os.path.exists(s.path):
            s.phase = "Subtitr birləşdirilir (ffmpeg)"
            final = os.path.splitext(s.path)[0] + ".mkv"
            tmpout = os.path.splitext(s.path)[0] + ".idm-mux.mkv"
            args = ["-i", s.path]
            for f, _ in got: args += ["-i", f]
            args += ["-map", "0:v?", "-map", "0:a?"]
            for i in range(len(got)): args += ["-map", str(i + 1)]
            has_keep_ass = any(bool(x.get("keepAss")) for _, x in got)
            args += ["-c", "copy"] + ([] if has_keep_ass else ["-c:s", "srt"])
            for i, (_, x) in enumerate(got):
                lang = re.sub(r"[^\w-]", "", str(x.get("lang") or ""))[:16]
                if lang: args += [f"-metadata:s:s:{i}", "language=" + lang]
                args += [f"-metadata:s:s:{i}", "title=" + str(x.get("label") or x.get("lang") or "")[:60]]
                # İlk iki seçilmiş trek MPV-də sid/secondary-sid kimi aktiv olsun.
                args += [f"-disposition:s:{i}", "default" if i < 2 else "0"]
            rc, last = s.ffmpeg(args + [tmpout])
            if rc == 0 and os.path.exists(tmpout) and os.path.getsize(tmpout) > 0:
                old = s.path
                os.replace(tmpout, final)
                if os.path.abspath(old) != os.path.abspath(final):
                    try: os.remove(old)
                    except OSError: pass
                s.path, muxed = final, True
            else:
                rm(tmpout)
                s.note = "Subtitr videoya birləşdirilə bilmədi (" + (last[0][:80] if last else "ffmpeg xətası") + ")"
        if muxed and not s.keep_subs:
            shutil.rmtree(s.subdir, ignore_errors=True); s.subdir = ""
        else:
            files = s.flush_subs()
            if not muxed and not s.note: s.note = "Subtitr ayrıca fayl kimi saxlandı" + (" (ffmpeg yoxdur)" if not s.ff else "")
            elif muxed: s.note = "Subtitr həm də ayrıca saxlandı"

    def run(s):
        try:
            rc = 1
            while True:
                while s.status == "paused" and not s.removed: time.sleep(0.3)
                if s.removed: return
                SEM.acquire()
                try:
                    if s.status == "paused" or s.removed: continue
                    s.reset()
                    p0 = s.progress
                    try:
                        if s.yt_par and not s._pre_started and not s.exists and not s.removed:
                            s._pre_started = True
                            s._prefetch_par()
                        # xarici subtitr + "yalnız subtitr": yt-dlp lazım deyil
                        rc = 0 if (s.mode == "s" and s.ext_subs) else (
                            s.run_hs() if (s.hs and s.mode in ("va", "v") and s.ff) else
                            s.run_pv() if (s.pv and s.mode in ("va", "v", "vas", "vs", "a") and s.ff) else s.exec_main())
                        if rc == 0 and s.mode in ("a", "as") and not s.exists and not s.removed:
                            ok, why = s.check_audio()
                            if not ok: rc, s.bad_audio, s.error = 1, True, "Səs faylı yararsızdır: " + why
                        if rc == 0 and s.mode in ("va", "vas") and not s.exists and not s.removed:
                            try:
                                if not audio_tracks(s.b): s.check_av()
                            except Exception: pass   # yoxlama uğursuzdursa yükləmə pozulmasın
                        if rc == 0 and not s.exists and not s.removed:
                            try:
                                if s.b.get("audioNone") and s.mode in ("va", "vas") and s.path:
                                    strip_audio_streams(s.path)
                            except Exception: pass
                            try:
                                if s.mode not in ("a", "as"): s.mux_multi_audio()
                            except Exception as e: s.note = "Çoxsəsli birləşdirmə alınmadı: " + str(e)[:120]
                        if rc == 0 and not s.exists and not s.removed:
                            try: s.post()
                            except Exception as e:  # subtitr xətası videonu "uğursuz" etməsin
                                if s.mode == "s": s.fail, s.error = True, "Subtitr xətası: " + str(e)[:150]
                                else: s.note = "Subtitr xətası: " + str(e)[:150]
                    except Exception as e:
                        s.status, s.error = "error", str(e)
                        return
                finally: SEM.release()
                if s.removed: return
                if s.refreshing and rc != 0:   # sürət qoruyucusu dayandırdı: gözləmədən, eyni axın sayı ilə yarımçıq fayldan davam
                    s.refreshing, s.resume, s.error = False, True, ""
                    s.status, s.speed, s.eta = "waiting", 0, None
                    continue
                s.refreshing = False
                if s.bad_audio and not s.safe_audio:   # yararsız səs faylı: sil, 1 bağlantı ilə, aria2c-siz, təmiz başdan yenidən yüklə
                    s.safe_audio, s.bad_audio, s.resume = True, False, False
                    rm(s.path); s.clean_partials()
                    s.note, s.error, s.status = "Səs faylı yoxlamadan keçmədi: sadə rejimdə (1 bağlantı) yenidən yüklənir", "", "waiting"
                    continue
                if s.exists:  # eyni fayl artıq var: təkrar yükləmə
                    s.cleanup_subs()
                    s.status, s.progress, s.speed, s.eta, s.error = "complete", 100.0, 0, None, ""
                    s.path = s.exist_path
                    s.name = os.path.basename(s.path)
                    try: s.size = s.done_bytes = os.path.getsize(s.path)
                    except OSError: pass
                    s.phase = "Artıq yüklənib"
                    return
                pm = bool(NOACC_RE.search(host_of(s.url)))   # playmix CDN yeni TCP bağlantılarını müəyyən müddət bloklayır
                max_tries = 9 if pm else MAX_TRIES             # blokdan sonra özü davam etsin (1s yerinə uzun gözləmə)
                if (rc != 0 and not s.removed and not is_youtube(s.url) and s.mode != "s" and s.tries < max_tries
                        and s.total_tries < MAX_TOTAL_TRIES
                        and (s.throttled or BLOCK_RE.search(s.error or ""))):
                    if s.progress - p0 >= 5: s.tries = max(0, s.tries - 1)   # real irəliləyiş oldu: ardıcıl uğursuzluq sayılmır
                    s.tries += 1; s.total_tries += 1
                    host_penalize(s.url)
                    wait = min(300.0, 30.0 * 2 ** (s.tries - 1)) if pm else ((min(90.0, BACKOFF * 2 ** (s.tries - 1)) + random.uniform(0, BACKOFF / 2)) if ADAPTIVE else 1.0)
                    if s.tries >= max_tries - 1 and re.search(r"Errno 2", s.error or ""):
                        s.clean_partials(); s.resume = False      # fraqment faylları pozulub: təmiz başla
                    else: s.resume = True                         # yarımçıq fayldan təhlükəsiz davam (yt-dlp .ytdl fraqment indeksi)
                    s.status, s.speed, s.eta, s.error = "waiting", 0, None, ""
                    s.note = f"Server yavaşladı/blokladı: {wait:.0f} san gözləyib {round(host_scale(s.url) * 100)}% sürətlə davam edir (cəhd {s.tries}/{max_tries})"
                    t_end = time.time() + wait
                    while time.time() < t_end and not s.removed: time.sleep(0.5)
                    continue
                if rc != 0 and s.split and not s.split_retry and not s.removed:
                    # 144p kimi ayrı video-only + audio axınlarında iki paralel prosesdən biri
                    # (məs. audio 403/bağlantı kəsilməsi) uğursuz ola bilər. Bir dəfə tək yt-dlp
                    # prosesinə keçirik: eyni 144p formatı qorunur, yt-dlp video+audio-nu özü birləşdirir.
                    s.split_retry, s.split, s.retried, s.native_retry = True, False, True, True
                    s.resume = False; s.error = ""; s.path = ""
                    try: s.clean_partials()
                    except Exception: pass
                    s.note = "Ayrı video/səs axını alınmadı: 144p/eyni keyfiyyət tək prosesdə təkrar yüklənir"
                    s.status, s.progress, s.speed, s.eta = "waiting", 0.0, 0, None
                    continue
                if rc != 0 and not s.fb and s.mode in ("a", "as", "v", "va", "vas") and re.search(r"(?i)requested format is not available|format .* is not available", s.error or ""):
                    # Seçilmiş axın (id) yt-dlp-nin ikinci sorğusunda tapılmadı (sayt id-ləri dəyişir): ən yaxşı mövcud axınla bir dəfə yenidən cəhd
                    s.fb, s.split, s.embed = True, False, False
                    if s.mode == "v": s.b["stripAudio"] = True
                    s.note = "Seçilmiş axın tapılmadı, ən yaxşı mövcud axınla yükləndi (dil/keyfiyyət dəqiq uyğun olmaya bilər)"
                    continue
                if rc != 0 and s.embed and not s.retried:
                    # Subtitri birləşdirmək alınmadı: videonu subtitrsiz yüklə, subtitri ayrıca saxla (səssiz itirmə yoxdur)
                    s.retried, s.embed = True, False
                    s.note = "Subtitr videoya birləşdirilə bilmədi"
                    continue
                break
            if rc != 0 and s.hs and s.path and os.path.exists(s.path) and os.path.getsize(s.path) > 0 \
                    and not os.path.exists(s.path + ".part") and not os.path.exists(s.path + ".ytdl"):
                # hotstream: CDN-də olmayan parçalar atlandığı üçün yt-dlp kod 1 ilə çıxa bilər,
                # amma yekun fayl tam yazılıb. Faylın real müddətini yoxlayıb tamam sayırıq.
                try:
                    q = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                        "-of", "default=nw=1:nk=1", s.path],
                                       capture_output=True, text=True, timeout=30, stdin=subprocess.DEVNULL)
                    if num(q.stdout.strip()) > 0:
                        rc, s.error, s.note = 0, "", "Bəzi parçalar CDN-də yox idi (atlandı); fayl tamamlandı"
                except Exception: pass
            if rc == 0 and not s.fail:
                s.move_target()
                s.status, s.progress, s.speed, s.eta, s.phase, s.error = "complete", 100.0, 0, None, "", ""
                if getattr(s, "hs_missing", ""): s.error = s.hs_missing   # hansı fraqmentlər xəta verdi
                if not is_youtube(s.url): host_reward(s.url)
                if s.path: s.name = os.path.basename(s.path)
            else:
                s.status, s.speed = "error", 0
                s.error = s.error or f"yt-dlp xəta ilə bitdi (kod {rc})"
        finally:
            rm(s.cookiefile)
            if s.subdir: shutil.rmtree(s.subdir, ignore_errors=True)
            if s.hs: s.clean_frags()   # hotstream: yarımçıq .part-Frag* faylları qalmasın
            try:
                for p in (getattr(s, "_pre_audio", []) or []):
                    if p and os.path.dirname(p) == str(DL_DIR) and re.search(r"\.pa\d+\.", os.path.basename(p)): rm(p)
            except Exception: pass

    def cleanup_subs(s):
        if not s.exist_path: return
        for f in glob.glob(glob.escape(os.path.splitext(s.exist_path)[0]) + ".*"):
            try:
                if f.lower().endswith(SUB_EXT) and os.path.getmtime(f) >= s.t0 - 2: os.remove(f)
            except OSError: pass

    def parse(s, line):
        if not line.startswith("PROG|"): s.watch(line)
        if line.startswith("PROG|"):
            f = line.split("|", 9)
            if len(f) < 10: return
            st, fn = f[1], f[9]
            if fn.lower().endswith(SUB_EXT): return
            down, tot, est, spd, eta, fi, fc = (num(x) for x in f[2:9])
            if fn and fn != "NA": s.name = clean(os.path.basename(fn))
            key = re.sub(r"\.part$", "", os.path.basename(fn)) if fn and fn != "NA" else ""
            grew = False
            if key:
                s.seen_files.add(key)
                if len(s.seen_files) > s.parts: s.parts, grew = len(s.seen_files), True   # [info] sətri parça sayını az göstərmişdi: yenilə
            total = tot or est
            if st == "finished":
                if key and key in s.fin_files: return   # eyni fayl üçün təkrar "finished" (resume) ikiqat sayılmasın
                if key: s.fin_files.add(key)
                s.done += 1
                s.fin_bytes += int(tot or down or 0)
                s.size = s.done_bytes = s.fin_bytes
                frac, s.speed, s.eta = 0.0, 0, None
            else:
                frac = (down / total) if (total and down is not None) else ((fi / fc) if (fi and fc) else 0.0)
                s.speed, s.eta = spd or 0, eta
                s.size = s.fin_bytes + int(total or 0)
                s.done_bytes = s.fin_bytes + int(down or 0)
            pct = (min(s.done, s.parts) + min(frac, 1.0)) / s.parts * 100
            s.progress = min(pct, 99.0) if grew else max(s.progress, min(pct, 99.0))   # grew: səhv yüksək göstərilən bar geri düzəlir
            s.phase = "" if getattr(s, "yt", False) else ("Səs yüklənir" if s.mode in ("a", "as") else "Video yüklənir")
            if SLOW_BPS > 0: s.guard(spd, fc)
            s.boost(0, "a" if s.mode == "a" else "v", spd, fi, fc)
            return
        m = EXISTS_RE.match(line)
        if m and s.mode in ("a", "as") and s.ff:
            return   # səs rejimi: yt-dlp-nin -x mərhələsi (ExtractAudio) bitməlidir, yoxsa xam/yarımçıq fayl "tamam" sayılırdı
        if m and INTERMEDIATE_RE.search(m.group(1)):
            return   # ara format faylı (ad.f137.mp4) əvvəlki cəhddən qalıb: yekun deyil, prosesi öldürmə (əvvəl səssiz/yarımçıq fayl "tamam" sayılırdı)
        if m:
            # Yarımçıq fraqment/part faylı yekun video deyil ("Artıq yüklənib · 656 KB" səhvi).
            if re.search(r"(?:\.part-Frag\d+|\.part|\.ytdl)$", m.group(1)): return
            s.exists, s.exist_path = True, m.group(1)
            try: s._sig(signal.SIGTERM)
            except Exception: pass
            return
        if line.startswith("[info]"):
            m = FMT_RE.search(line)
            if m: s.parts = s.force_parts or max(1, len(m.group(2).split("+")))
        elif line.startswith("[download] Destination:"):
            m = DEST_RE.search(line)
            if m and not m.group(1).lower().endswith(SUB_EXT): s.path = m.group(1); s.dests.add(m.group(1))
        elif line.startswith(("[Merger]", "[ExtractAudio]", "[EmbedSubtitle]", "[Metadata]", "[FFmpeg", "[VideoConvertor]", "[Fixup")):
            s.phase, s.speed, s.eta = "Emal olunur (ffmpeg)", 0, None
            s.progress = max(s.progress, 99.0)
            if line.startswith(("[Merger]", "[ExtractAudio]")):
                m = DEST_RE.search(line)
                if m: s.path = m.group(1)
        if "ERROR:" in line: s.error = line.split("ERROR:", 1)[1].strip()

    def guard(s, spd, fc):
        """YouTube parçalı (HLS/DASH) axın: sürət davamlı aşağıdırsa (yavaş CDN qovşağı/bağlantı) prosesi yumşaq dayandırır;
        run() eyni yarımçıq fayldan YENİ manifest/bağlantılarla davam edir (ən çox 2 dəfə). Düz axınlara və digər saytlara toxunmur."""
        if not fc or spd is None or s.refreshing or s.removed or s.refreshes >= 2 or s.status != "active" or not is_youtube(s.url): return
        now = time.time()
        if now - s.t0 < SLOW_AFTER or spd >= SLOW_BPS: s.slow_t = 0; return
        if not s.slow_t: s.slow_t = now; return
        if now - s.slow_t >= SLOW_WIN:
            s.refreshes += 1; s.refreshing, s.slow_t = True, 0
            s.note = f"YouTube axını yavaşdır ({spd/1e6:.1f} MB/s): təzə bağlantılarla davam edir ({s.refreshes}/2)"
            s.soft_stop()

    def boost(s, i, kind, spd, fi, fc):
        """Parçalı axın davamlı yavaşdırsa (qalan vaxt uzun): paralel parça sayını 2x artırıb eyni yarımçıq fayldan davam edir.
        Audio: parça tezliyi (parça/san) ölçülür (kiçik parçalar bayt sürəti ilə ölçülmür); video: bayt sürəti. İstifadəçi say seçibsə toxunmur."""
        if NOACC_RE.search(host_of(s.url)): return   # playmix: heç bir sürətləndirmə yoxdur, əvvəlki sadə yolla yüklənir
        if (not BOOST or not fi or not fc or s.refreshing or s.removed or s.status != "active" or is_youtube(s.url)
                or s.boosts >= BOOST_MAXN or s.throttled or s.error or (s.an if kind == "a" else s.vn)): return
        now = time.time(); h = s.fq.setdefault(i, [])
        if not h or h[-1][1] != fi: h.append((now, fi))
        del h[:-60]
        if now - s.t0 < 12 or fc - fi < 30: return
        old = next((x for x in h if now - x[0] <= 15), None)
        if not old or now - old[0] < 8: return
        rate = max((fi - old[1]) / (now - old[0]), 0.01); eta = (fc - fi) / rate
        if kind == "a": slow = rate < 3 and eta > 45
        else: slow = spd is not None and spd < BOOST_VBPS and eta > 60
        if not slow: return
        aud, host = kind == "a", host_of(s.url)
        with HLOCK:
            cur = HOSTN.get((host, aud)) or (SAFE_A if aud else SAFE_V); new = min(BOOST_MAX, cur * 2)
            if new <= cur: return
            HOSTN[(host, aud)] = new
        s.boosts += 1; s.refreshing = True
        s.note = f"{'Audio' if aud else 'Video'} axını yavaşdır: paralel parça {cur} → {new} ilə davam edir"
        s.soft_stop()

    def soft_stop(s):
        """Yumşaq dayandırma (SIGINT): yt-dlp fraqment vəziyyətini (.ytdl) düzgün yazıb çıxır; 5 san sonra hələ işləyirsə SIGTERM."""
        s._sig(signal.SIGINT)
        def late():
            time.sleep(5)
            s._sig(signal.SIGTERM)
        threading.Thread(target=late, daemon=True).start()

    def watch(s, line):
        """Server bloklanma əlamətləri (403/429/5xx, reset, timeout, Errno 2): çox olarsa prosesi dayandır -> run() gözləyib az axınla davam etdirir."""
        if s.hs: return   # hotstream: parçaların bir qismi CDN-də 404/403-dür; öldürmək yerinə yt-dlp onları atlayır
        if not ADAPTIVE or s.throttled or is_youtube(s.url) or not BLOCK_RE.search(line): return
        now = time.time()
        s.hit_t = [t for t in s.hit_t if now - t < HIT_WINDOW] + [now]
        s.hits = len(s.hit_t)
        if s.hits >= HIT_LIMIT and not s.removed:
            s.throttled = True
            s.kill_all()

    def kill_all(s):
        for p in [s.proc, *s.procs]:
            try:
                if p and p.poll() is None: _kill_tree(p, signal.SIGTERM)
            except Exception: pass

    def clean_frags(s):
        """hotstream: bu işin yarımçıq fraqment fayllarını silir (yekun fayla toxunmur)."""
        try:
            if not s.out_stem: return
            base = glob.escape(os.path.join(str(DL_DIR), s.out_stem))
            for f in [*glob.glob(base + "*.part-Frag*"), *glob.glob(base + "*-Frag*")]:
                if s.path and os.path.abspath(f) == os.path.abspath(s.path): continue
                rm(f)
        except Exception: pass

    def clean_partials(s):
        """Yalnız fraqment xətası təkrarlananda: pozulmuş yarımçıq faylları sil ki, təmiz başlasın."""
        for p in {*s.dests, s.path, *(t.get("path") for t in s.tr)}:
            if not p: continue
            for f in [p + ".part", p + ".ytdl", *glob.glob(glob.escape(p) + ".part-Frag*"), *glob.glob(glob.escape(p) + "-Frag*")]: rm(f)

    def wipe_files(s, include_final=True, release=True):
        """LƏĞV: bu işə aid bütün fraqment/part/aralıq/subtitr qalıqlarını sil. Pause bunu çağırmır."""
        paths = set()
        for p in [s.path, s.exist_path, *s.dests, *(t.get("path") for t in s.tr), *s.seen_files, *s.fin_files]:
            if p: paths.add(str(p))
        if s.out_stem:
            try:
                paths.update(glob.glob(glob.escape(os.path.join(str(DL_DIR), s.out_stem)) + "*"))
            except Exception: pass
        for p in list(paths):
            for f in [p, p + ".part", p + ".ytdl", p + ".aria2",
                      *glob.glob(glob.escape(p) + ".part-Frag*"), *glob.glob(glob.escape(p) + "-Frag*"),
                      *glob.glob(glob.escape(p) + ".part.frag*")]:
                if include_final or not (os.path.exists(p) and f == p):
                    rm(f)
        if s.subdir:
            shutil.rmtree(s.subdir, ignore_errors=True); s.subdir = ""
        # Ləğvdən sonra heç bir qalıq qalmadısa, ad rezervasiyasını da azad et:
        # növbəti ilk yükləmə yenidən (2) yox, orijinal adla başlasın.
        if release and s.out_stem:
            key = os.path.join(str(DL_DIR), s.out_stem)
            if not _stem_taken(key, VIDEO_EXTS):
                with NAME_LOCK:
                    NAME_RESERVED.discard(key); STEM_RESERVED.discard(key)

    def running(s):
        return any(p and p.poll() is None for p in [s.proc, *s.procs])

    def _sig(s, sig):
        for p in [s.proc, *s.procs]:
            if p and p.poll() is None:
                try: _kill_tree(p, sig)
                except OSError: pass

    def action(s, a):
        if a == "pause":
            if s.status == "active": s._sig(signal.SIGSTOP); s.status, s.speed = "paused", 0
            elif s.status == "waiting": s.status = "paused"
        elif a == "resume":
            if s.status == "paused":
                if s.running(): s._sig(signal.SIGCONT); s.status = "active"
                else: s.status = "waiting"
        elif a in ("remove", "delete"):
            # remove = yalnız siyahıdan çıxar. delete = qalıqları tam sil. pause heç nə etmir.
            include_final = (a == "delete")
            s.removed = True
            try: s._sig(signal.SIGCONT); s._sig(signal.SIGTERM)
            except Exception: pass
            # Dərhal görünən faylları sil; proses hələ yazırsa, settle mərhələsi təkrar silir.
            if include_final:
                try: s.wipe_files(True, False)
                except Exception: pass
            def settle():
                for _ in range(30):
                    if not s.running(): break
                    time.sleep(0.2)
                try: s._sig(signal.SIGKILL)
                except Exception: pass
                time.sleep(0.3)
                if include_final:
                    try: s.wipe_files(True, True)
                    except Exception: pass
            threading.Thread(target=settle, daemon=True).start()
            JOBS.pop(s.id, None)
        elif a in ("open", "folder"): open_path(s.path, a == "folder")
        else: raise RuntimeError("naməlum əmr")

    def _bytes(s):
        """Bar və göstərilən done/size EYNİ mənbədən olsun: video + əlavə səslər.
        Video həcmi hələ bilinmirsə (0), ekstra səsləri hesaba qatmırıq — əks halda
        səs erkən bitəndə bar səhvən 99%-ə sıçrayır."""
        video = int(s.size or 0)
        if video <= 0: return 0, 0
        extra_t = extra_d = 0
        if s.mode in ("va", "vas") and not getattr(s, "split", False) and audio_tracks(s.b):
            extra_t = int(getattr(s, "_extra_total_bytes", 0) or 0)
            extra_d = int(getattr(s, "_extra_done_bytes", 0) or 0)
        if extra_d > extra_t: extra_t = extra_d   # təxmin kiçik olsa da done/size 100%-dən artıq olmasın
        return video + extra_t, int(s.done_bytes or 0) + extra_d

    def disp(s):
        """Vahid faiz. YouTube: bayt əsaslı (toxunulmur). Digər saytlarda video/səs
        ayrı olanda mərhələ əsaslı, geriyə getməyən (monotonic) hesab."""
        if s.status == "complete": return 100.0
        if not getattr(s, "yt", False) and (getattr(s, "split", False) or
                (s.mode in ("va", "vas") and not getattr(s, "split", False) and audio_tracks(s.b))):
            pct = None
            if getattr(s, "split", False):
                if getattr(s, "known_streams", False):
                    size, done = s._bytes()
                    if size > 0: pct = done / size * 100.0
                if pct is None: pct = float(s.progress or 0.0)
            else:
                size, done = s._bytes()
                et = int(getattr(s, "_extra_total_bytes", 0) or 0)
                if et > 0 and size > 0:
                    pct = done / size * 100.0
                else:
                    ph = getattr(s, "_phase", "video")
                    if ph == "merge":
                        pct = 99.0
                    elif ph == "audio":
                        ed = int(getattr(s, "_extra_done_bytes", 0) or 0)
                        frac = (min(1.0, ed / et) if et > 0 else
                                min(1.0, float(getattr(s, "_audio_i", 0) or 0) / max(1, int(getattr(s, "_audio_n", 1) or 1))))
                        pct = 85.0 + frac * 13.0
                    else:
                        pct = min(85.0, float(s.progress or 0.0) * 85.0 / 99.0)
            pct = min(99.0, max(0.0, float(pct or 0.0)))
            s._disp_floor = max(float(getattr(s, "_disp_floor", 0.0) or 0.0), pct)
            return s._disp_floor
        size, done = s._bytes()
        if size > 0:
            return min(99.0, done / size * 100.0)
        return min(99.0, float(s.progress or 0.0))

    def item(s):
        sz, dn = s._bytes()
        if s.status == "complete":
            dn = max(dn, sz); sz = max(sz, dn)
        return {"id": s.id, "source": "ytdlp", "name": s.name, "status": s.status, "progress": round(s.disp(), 1),
                "speed": s.speed, "size": sz, "done": dn, "eta": s.eta, "error": s.error,
                "phase": s.phase, "path": s.path, "note": s.note, "mode": s.mode,
                "t": int((getattr(s, "t0", 0) or 0) * 1000)}

HELPER_VER = 8

# Brauzerin özünün aldığı HLS playlist-lər (və açarlar): yt-dlp saytın özünə yox, buraya baxır.
# Bəzi saytlar brauzerə cavab verir, yt-dlp-yə 404 qaytarır. Ünvandakı təsadüfi id həm də giriş açarıdır.
MANIFESTS, MLOCK = {}, threading.Lock()

def r_manifest(b):
    if b.get("kind") == "key":
        data, ctype, ext = base64.b64decode(b.get("b64") or ""), "application/octet-stream", "key"
        if not 0 < len(data) <= 4096: raise RuntimeError("açar etibarsızdır")
    else:
        text = str(b.get("text") or "")
        tl = text.lstrip()
        if tl.startswith("#EXTM3U"):
            data, ctype, ext = text.encode("utf-8"), "application/vnd.apple.mpegurl", "m3u8"
        elif tl.startswith("<MPD") or "<MPD " in tl[:500] or "<MPD>" in tl[:500]:
            base = str(b.get("base") or "").strip()
            if base:
                def _absu(u):
                    u = u.strip()
                    if not u or re.match(r"^[a-z]+:", u, re.I) or u.startswith("//"): return u
                    return urllib.parse.urljoin(base, u)
                text = re.sub(r'(?i)\b(media|initialization|sourceURL|index|startURL|value)="([^"]+)"',
                              lambda m: m.group(1) + '="' + _absu(m.group(2)) + '"', text)
                text = re.sub(r'(?is)<BaseURL>\s*([^<]+?)\s*</BaseURL>',
                              lambda m: m.group(0) if re.match(r"^(?:[a-z]+:|//)", m.group(1).strip(), re.I)
                              else '<BaseURL>' + _absu(m.group(1)) + '</BaseURL>', text)
            data, ctype, ext = text.encode("utf-8"), "application/dash+xml", "mpd"
        else:
            raise RuntimeError("playlist/manifest etibarsızdır")
        if len(data) > 12_000_000: raise RuntimeError("playlist çox böyükdür")
    name = secrets.token_hex(12) + "." + ext
    now = time.time()
    with MLOCK:
        for k in [k for k, v in MANIFESTS.items() if now - v[0] > 86400]: MANIFESTS.pop(k, None)
        while len(MANIFESTS) > 800: MANIFESTS.pop(next(iter(MANIFESTS)), None)
        MANIFESTS[name] = (now, ctype, data)
    return {"ok": True, "url": f"http://127.0.0.1:{PORT}/m/{name}"}

def r_ping(_):
    return {"ok": True, "app": "JDM", "appVer": "1.0.0", "ver": HELPER_VER, "file": os.path.abspath(__file__), "dir": str(DL_DIR), "platform": "windows" if IS_WIN else "linux", "deps": {k: bool(shutil.which(k)) for k in ("aria2c", "yt-dlp", "ffmpeg")}}

def r_health(_):
    """YouTube/subtitr üçün real quraşdırma problemləri (popup xəbərdarlığı). Yavaş ola bilər, /ping-dən ayrıdır."""
    c = ytdlp_caps(force=True)
    return {"ok": True, "app": "JDM", "appVer": "1.0.0", "platform": "windows" if IS_WIN else "linux",
            "warnings": yt_health(), "ytdlp": c["version"], "runtime": c["runtime"],
            "ffmpeg": bool(shutil.which("ffmpeg")),
            "aria2c": bool(shutil.which("aria2c")), "audioFormats": audio_formats(),
            "songAlign": (not IS_WIN)}   # Windows-da yerli MMS/CTC dəstəklənmir

def r_list(_):
    return {"ok": True, "items": aria_items() + [j.item() for j in list(JOBS.values())] + [j.item() for j in list(CTXJOBS.values())] + [j.item() for j in list(UPLOADJOBS.values())]}

def r_add(b):
    return {"ok": True, "id": aria_add(b)}

def r_formats(b):
    return {"ok": True, **probe(b)}

def r_meta(b):
    return {"ok": True, **media_meta(b)}

def r_name(b):
    """Brauzer/page-context yükləmələri üçün mövcud fayla toxunmayan unikal ad."""
    fn = safe_name(b.get("filename") or "")
    if not fn: return {"ok": False, "error": "ad boşdur"}
    return {"ok": True, "name": os.path.basename(unique_path(os.path.join(str(DL_DIR), fn)))}

def r_pickdir(b):
    p = ctx_pick_dir()
    if not p: raise RuntimeError("Fayl meneceri dialoqu açılmadı və ya ləğv edildi")
    return {"ok": True, "path": p}

def r_share(b):
    u = str(b.get("url") or "")
    check_url(u)
    status, _ = _portal_share(u)
    if status == "ok": return {"ok": True, "method": "portal"}
    if status == "cancel": return {"ok": True, "canceled": True}
    status = _share_menu(u)
    if status == "ok": return {"ok": True, "method": "menu"}
    if status == "cancel": return {"ok": True, "canceled": True}
    raise RuntimeError("Sistem paylaşma menyusu açılmadı")

def r_duration(b):
    return {"ok": True, "duration": ctx_duration(b)}

def r_saveas(b):
    j = ctx_start_save(b)
    return {"ok": True, "id": j.id, "name": j.name}

def r_gif(b):
    j = ctx_start_gif(b)
    return {"ok": True, "id": j.id, "name": j.name}

def r_reveal(b):
    """Fayl menecerini açıb faylı seçir (siyahıdakı «qovluq» düyməsi)."""
    open_path(str(b.get("path") or ""), True)
    return {"ok": True}

def r_openfile(b):
    """Faylı default proqramla açır (video→pleyer, səs→musiqi, subtitr→redaktor)."""
    open_path(str(b.get("path") or ""), False)
    return {"ok": True}

# ---- Sİ Mode A: itkisiz (stream copy) seqment kəsmə + birləşdirmə, TƏK progress ----
_SEGCUT_N = [0]

class SegCutJob:
    """Seçilmiş vaxt seqmentlərini ffmpeg ilə `-c copy` (re-encode YOX) kəsib
    tək faylda birləşdirir. Popup-da BİR yükləmə sətri / BİR progress göstərir.

    Yükləmə ADİ yükləmənin EYNİ mühərriki (`Job`) ilə edilir: seçilmiş format/səs/
    subtitr olduğu kimi gəlir (yt-dlp + aria2c/paralel + retry + subtitr birləşdirmə).
    Sonra tam fayl seçilmiş seqmentlərə görə kəsilir, birləşdirilir və artıq qalan
    tam fayl (və köməkçi subtitr faylları) silinir."""
    def __init__(s, b):
        _SEGCUT_N[0] += 1
        s.id = f"m{_SEGCUT_N[0]}"; s.source = "ctx"; s.mode = "sicut"; s.kind = "sicut"
        s.b = dict(b)
        # Kəsmə mütləq videonu əhatə edir ("yalnız subtitr" rejimi seqment kəsmək üçün yararsızdır).
        if str(s.b.get("mode") or "").lower() == "s":
            s.b["mode"] = "vas" if s.b.get("subs") else "va"
        segs = []
        for it in (b.get("segments") or []):
            a, e = num(it.get("start")), num(it.get("end"))
            if e > a + 0.2: segs.append((a, e))
        segs.sort()
        s.segments = segs
        s.base_name = safe_name(b.get("name") or "Sİ klip") or "Sİ klip"
        # Yalnız-səs rejimində çıxış audio konteynerində olur (mkv yox); son addımda dəqiqləşir.
        s.audio_only = str(b.get("mode") or "").lower() == "a"
        _tgt = str(b.get("target") or "").strip()
        if _tgt:
            if not os.path.isabs(_tgt): _tgt = os.path.join(str(DL_DIR), os.path.basename(_tgt))
            if not re.search(r"\.[A-Za-z0-9]{2,5}$", _tgt): _tgt += ".mkv"
            s.name = os.path.basename(_tgt)
            s.target = _tgt
            try: os.makedirs(os.path.dirname(s.target), exist_ok=True)
            except Exception: pass
        else:
            s.name = s.base_name + (".mka" if s.audio_only else ".mkv")
            s.target = os.path.join(str(DL_DIR), s.name)
        s.status, s.progress, s.speed, s.size, s.done, s.eta = "waiting", 0.0, 0, 0, 0, None
        s.error, s.phase, s.path, s.proc, s.removed = "", "Gözləyir: 0%", "", None, False
        s.dljob = None          # tam yükləməni edən real Job (adi mühərrik)
        s.full = ""             # tam yüklənmiş fayl (seqment kəsiləndən sonra silinir)
        s._orig_full = ""       # səs birləşdirilməzsə əvəzlənən orijinal Job faylı
        s.sidecars = []         # subtitr faylları (yan + media-dan çıxarılan)
        s.note = ""             # adi yükləmədəki qeyd (məs. "seçilmiş axın tapılmadı")
        s.t0 = time.time()
        CTXJOBS[s.id] = s
        threading.Thread(target=s.run, daemon=True).start()

    def item(s):
        # `mode` məzmunu göstərir (v/a/s) ki, popup-da düzgün ikon (video/səs/subtitr) çıxsın.
        m = str(s.b.get("mode") or "va").lower()
        has_s = bool(s.b.get("subs")) or ("s" in m)
        if m in ("a", "as"): dm = "as" if has_s else "a"
        elif m in ("v", "vs"): dm = "vs" if has_s else "v"
        else: dm = "vas" if has_s else "va"
        return {"id": s.id, "source": "ctx", "name": s.name, "status": s.status,
                "progress": round(s.progress, 1), "speed": s.speed, "size": s.size,
                "done": s.done, "eta": s.eta, "error": s.error, "phase": s.phase,
                "path": s.path, "note": getattr(s, "note", ""), "mode": dm,
                "t": int((getattr(s, "t0", 0) or 0) * 1000)}

    def action(s, a):
        j = s.dljob
        if a == "pause":
            if s.status == "active":
                if j:
                    try: j.action("pause")
                    except Exception: pass
                s.status, s.speed = "paused", 0
        elif a == "resume":
            if s.status == "paused":
                if j:
                    try: j.action("resume")
                    except Exception: pass
                s.status = "active"
        elif a in ("remove", "delete"):
            s.removed = True
            if j:
                try: j.action("delete" if a == "delete" else "remove")
                except Exception: pass
            try:
                if s.proc: _kill_tree(s.proc, signal.SIGTERM)
            except Exception: pass
            CTXJOBS.pop(s.id, None)
            if a == "delete":
                rm(s.target)

    def _run_download(self):
        """ADİ yükləmənin EYNİ mühərriki (`Job`) ilə tam faylı endirir.
        Format/səs/subtitr seçimləri, retry, paralel (aria2c), subtitr birləşdirmə —
        hamısı adi yükləmədəki kimi. Progress birbaşa `Job`-dan sətirə ötürülür."""
        src = str(self.b.get("url") or "")
        page = str(self.b.get("pageUrl") or "")
        # YouTube seqmenti: seçilmiş birbaşa googlevideo axını yerinə YouTube səhifəsindən
        # adi yükləmənin EYNİ mexanizmi ilə (format/strat/paralel) endir.
        if is_youtube(page): src = page
        if not re.match(r"(?i)^https?://", src):
            return src                                  # yerli fayl: birbaşa kəsmə mənbəyi
        if not shutil.which("yt-dlp"):
            raise RuntimeError("yt-dlp quraşdırılmayıb")
        payload = dict(self.b)
        payload["url"] = src
        if page: payload["pageUrl"] = page
        payload["useTitle"] = False
        payload.setdefault("title", self.base_name)
        # Kəsmə üçün video lazımdır: "yalnız subtitr" rejimində fayl gəlməz — videolu rejimə keçir.
        if str(payload.get("mode") or "").lower() in ("s",):
            payload["mode"] = "vas" if payload.get("subs") else "va"
        # Popup bəzən format əvəzinə etiket göndərir ("all"/"best"/"auto"): yt-dlp bunları
        # "requested format is not available" sayır və seçilmiş axını itirir. Boş = ən yaxşı.
        fmt0 = str(payload.get("format") or "").strip()
        if fmt0.lower() in ("", "all", "best", "auto", "none", "-"): payload["format"] = ""
        # Seçilmiş səs trekini (format_id) əsas yükləməyə qat: bv*+<audioId>.
        aid = str(payload.get("audio") or payload.get("aa") or "").strip()
        if (aid and not payload.get("format") and re.fullmatch(r"[\w.\-]+", aid)
                and str(payload.get("mode") or "").lower() in ("va", "vas")):
            payload["format"] = "bv*+%s/bv*+ba/b" % aid
        j = Job(payload)                                # normal yükləmə mühərriki
        JOBS.pop(j.id, None)                            # gizli: popup-da ayrıca sətir görünməsin
        self.dljob = j
        self.status = "active"
        while True:
            if self.removed:
                try: j.action("delete")
                except Exception: pass
                return ""
            _sz, _dn = j._bytes()
            self.size = int(_sz)
            self.done = int(_dn)
            self.speed = int(j.speed or 0)
            self.eta = j.eta
            self.progress = min(99.0, float(j.disp()))   # bar = done/size (tam sinxron)
            self.phase = "Yüklənir… " + (j.phase or ("%.0f%%" % (j.disp() or 0.0)))
            self.note = j.note or ""
            st = j.status
            if st == "complete":
                p = j.path or getattr(j, "exist_path", "") or ""
                if p and os.path.exists(p):
                    return p
                raise RuntimeError("Yükləmə tamamlandı, amma fayl tapılmadı")
            if st == "error":
                raise RuntimeError("Media yüklənmədi (yt-dlp/ffmpeg) — " + (j.error or "")[:300])
            time.sleep(0.4)

    def _has_audio(s, path):
        return _has_audio_path(path)

    def _audio_count(s, path):
        """Fayldakı audio stream sayı (mux-un artıq edilib-edilmədiyini bilmək üçün)."""
        fp = shutil.which("ffprobe")
        if not fp or not path or not os.path.exists(path): return 0
        try:
            r = subprocess.run([fp, "-v", "error", "-select_streams", "a", "-show_entries",
                                "stream=index", "-of", "csv=p=0", path],
                               capture_output=True, text=True, errors="replace", timeout=30,
                               stdin=subprocess.DEVNULL)
            return len([x for x in (r.stdout or "").splitlines() if x.strip()])
        except Exception:
            return 0

    def _wait_aux(s, j):
        """Köməkçi (səs) Job bitənə qədər gözləyir; sətirin progress-i 80%-dən aşağı qalır."""
        while True:
            if s.removed:
                try: j.action("delete")
                except Exception: pass
                return ""
            st = j.status
            if st == "complete":
                p = j.path or getattr(j, "exist_path", "") or ""
                return p if (p and os.path.exists(p)) else ""
            if st == "error":
                return ""
            s.phase = "Səs treki yüklənir… " + (j.phase or ("%.0f%%" % (j.progress or 0.0)))
            time.sleep(0.4)

    def _fetch_tracks(s):
        """Seçilmiş BÜTÜN səs treklərini endirir: [(fayl, dil)]. Heç biri seçilməyibsə
        `ba` ilə tək fallback. Yt-dlp-nin `bv*+ba` səsi birləşdirmədiyi saytlar üçün."""
        items = []
        tracks = audio_tracks(s.b)
        if tracks:
            for i, t in enumerate(tracks):
                if s.removed: break
                s.phase = "Səs treki yüklənir… %d/%d" % (i + 1, len(tracks))
                url = t["url"] or str(s.b.get("url") or "")
                fsel = "" if t["url"] else t["id"]
                p = dl_audio_track(s.b, url, fsel, os.path.join(DL_DIR, safe_name(s.base_name + ".a%d" % i)))
                if p: items.append([p, t.get("lang") or ""])
            return items   # açıq seçim: alınmayan trek varsa default-la əvəz etmirik
        # Fallback: auto (`ba/w`) — əvvəl seçilmiş tək id, sonra src, sonra pageUrl.
        aid = str(s.b.get("audio") or s.b.get("aa") or "").strip()
        aid = aid if re.fullmatch(r"[\w.\-]+", aid) else "ba/w"
        au = str(s.b.get("audioUrl") or s.b.get("aaUrl") or "").strip()
        cands = []
        if au and re.match(r"(?i)^https?://", au): cands.append((au, ""))
        src = str(s.b.get("url") or "")
        if src and re.match(r"(?i)^https?://", src) and all(src != u for u, _ in cands): cands.append((src, aid))
        page = str(s.b.get("pageUrl") or "")
        if page and re.match(r"(?i)^https?://", page) and all(page != u for u, _ in cands): cands.append((page, aid))
        for k, (u, fsel) in enumerate(cands):
            p = dl_audio_track(s.b, u, fsel, os.path.join(DL_DIR, safe_name(s.base_name + ".fa%d" % k)))
            if p: return [[p, ""]]
        return []

    def _mux_audios(s, video, items, tmp):
        """Video + bir/çox səs treki: ffmpeg -c copy (mkv). Media-dakı subtitle-lər qorunur."""
        ff = shutil.which("ffmpeg")
        if not ff or not items: return ""
        out = os.path.join(tmp, "full_av.mkv")
        try:
            args = [ff, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", video]
            for p, _ in items: args += ["-i", p]
            args += ["-map", "0:v:0", "-map", "0:s?"]
            for i in range(len(items)): args += ["-map", "%d:a:0" % (i + 1)]
            args += ["-c", "copy"]
            for i, (_, lang) in enumerate(items):
                if lang: args += ["-metadata:s:a:%d" % i, "language=" + lang]
            args += [out]
            rc = subprocess.run(args, capture_output=True, text=True, timeout=3600).returncode
        except Exception:
            rc = 1
        if rc == 0 and os.path.exists(out) and os.path.getsize(out) > 1024:
            return out
        rm(out)
        return ""

    def _finalize_audio(self, path):
        """Yalnız-səs seqmentini düzgün audio konteynerinə (m4a/mp3/opus/…) gətirir."""
        ff = shutil.which("ffmpeg"); fp = shutil.which("ffprobe")
        if not ff or not path or not os.path.exists(path): return path
        codec = ""
        try:
            r = subprocess.run([fp, "-v", "error", "-select_streams", "a:0", "-show_entries",
                                "stream=codec_name", "-of", "csv=p=0", path],
                               capture_output=True, text=True, errors="replace", timeout=20,
                               stdin=subprocess.DEVNULL)
            codec = ((r.stdout or "").strip().splitlines() or [""])[0].strip().lower()
        except Exception:
            pass
        afmt = str(self.b.get("audioFormat") or "best").lower()
        explicit = afmt in ("m4a", "mp3", "flac", "opus", "vorbis", "wav")
        if explicit:
            ext = {"m4a": "m4a", "mp3": "mp3", "flac": "flac", "opus": "opus", "vorbis": "ogg", "wav": "wav"}[afmt]
        else:
            ext = {"aac": "m4a", "mp3": "mp3", "opus": "opus", "vorbis": "ogg", "flac": "flac",
                   "pcm_s16le": "wav", "pcm_s24le": "wav", "pcm_f32le": "wav"}.get(codec, "mka")
        base = os.path.splitext(path)[0]
        out = base + "." + ext
        if os.path.abspath(out) == os.path.abspath(path): return path
        args = [ff, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", path, "-vn"]
        if not explicit:
            args += ["-c:a", "copy"]
        elif afmt == "m4a":
            args += ["-c:a", "copy"] if codec == "aac" else ["-c:a", "aac", "-b:a", "192k"]
        else:
            args += _AFMT_ARGS.get(afmt, ["-c:a", "aac", "-b:a", "192k"])
        args += [out]
        try: rc = subprocess.run(args, capture_output=True, timeout=1800).returncode
        except Exception: rc = 1
        if rc == 0 and os.path.exists(out) and os.path.getsize(out) > 1024:
            try: os.remove(path)
            except Exception: pass
            return out
        rm(out)
        return path

    def _keyframe_times(s, path, fp):
        """Media-dakı video keyframe vaxtları (kəsmə dəqiqliyi üçün)."""
        try:
            r = subprocess.run([fp, "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
                                "-show_entries", "frame=pts_time", "-of", "csv=p=0", path],
                               capture_output=True, text=True, errors="replace", timeout=600,
                               stdin=subprocess.DEVNULL)
            return sorted(float(x.strip().rstrip(",")) for x in (r.stdout or "").splitlines()
                          if x.strip().rstrip(",").replace(".", "", 1).isdigit())
        except Exception:
            return []

    def _download(self, src, tmp):
        """run() üçün: tam faylı endirir, yan və media-ya hopdurulmuş subtitrləri qeyd edir."""
        full = self._run_download()
        if not full:
            raise RuntimeError("Yükləmə ləğv edildi")
        self.full = full
        base2 = os.path.splitext(os.path.basename(full))[0]
        self.sidecars = [os.path.join(str(DL_DIR), f) for f in sorted(os.listdir(str(DL_DIR)))
                         if f.startswith(base2 + ".") and re.search(r"\.(vtt|srt|ass|ssa)$", f)]
        # Normal yükləmə subtitri media-ya HOPDURA bilər (--embed-subs / mux). Kəsmə üçün onları
        # çıxarırıq. ASS/SSA trekləri OLDUĞU KİMİ (stil/rəng/bayraq) saxlanılır.
        try:
            fp = shutil.which("ffprobe")
            if fp and self.sidecars is not None:
                r = subprocess.run([fp, "-v", "error", "-select_streams", "s", "-show_entries",
                                    "stream=index,codec_name:stream_tags=language", "-of", "json", full],
                                   capture_output=True, text=True, errors="replace", timeout=30,
                                   stdin=subprocess.DEVNULL)
                subs = (json.loads(r.stdout or "{}").get("streams") or [])
                for k, stm in enumerate(subs[:24]):
                    lang = re.sub(r"[^A-Za-z0-9-]", "", str((stm.get("tags") or {}).get("language") or "")) or ("s%d" % k)
                    is_ass = str(stm.get("codec_name") or "").lower() in ("ass", "ssa")
                    outp = os.path.join(tmp, "emb%d.%s.%s" % (k, lang, "ass" if is_ass else "srt"))
                    ec = ["-c:s", "copy"] if is_ass else []
                    rc = subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error",
                                         "-nostdin", "-y", "-i", full, "-map", "0:s:%d" % k, *ec, outp],
                                        capture_output=True, text=True, timeout=120).returncode
                    if rc == 0 and os.path.exists(outp) and os.path.getsize(outp) > 16:
                        self.sidecars.append(outp)
                    else:
                        rm(outp)
        except Exception:
            pass
        # Eyni məzmunlu subtitr iki dəfə (həm yan fayl, həm media-dan çıxarılmış) olmasın.
        try:
            seen, uniq = set(), []
            for sp in self.sidecars:
                try:
                    with open(sp, "rb") as fh: h = hash(fh.read())
                except Exception:
                    h = sp
                if h in seen: continue
                seen.add(h); uniq.append(sp)
            self.sidecars = uniq
        except Exception:
            pass
        # Ayarlar → Alt yazı görünüşü: seqment çıxışında da eyni ölçü/stil/fon.
        ap = sub_appearance(self.b)
        if ap and self.sidecars:
            styled = []
            for sp in self.sidecars:
                try: nf = style_subtitle_file(sp, ap)
                except Exception: nf = sp
                if nf and nf != sp:
                    rm(sp)
                styled.append(nf or sp)
            self.sidecars = styled
        # Video ilə səsin AYRI axın olduğu saytlarda yt-dlp `bv*+ba`-da səsi birləşdirmir.
        # Seçilmiş BÜTÜN səs treklərini ayrıca endirib birləşdiririk (bir və ya çox).
        want_audio = str(self.b.get("mode") or "va").lower() in ("va", "vas")
        tracks = audio_tracks(self.b)
        skip_mux = bool(tracks) and self._audio_count(full) >= len(tracks)
        if want_audio and not skip_mux and (tracks or not _has_audio_path(full)):
            items = self._fetch_tracks()
            merged = self._mux_audios(full, items, tmp) if items else ""
            for p, _ in items:
                if p and p != merged: rm(p)
            if merged:
                self._orig_full = full
                full = merged
                self.note = ("Seçilmiş %d səs treki birləşdirildi" % len(items)) if tracks else "Səs treki ayrıca endirilib birləşdirildi"
            elif not _has_audio_path(full):
                raise RuntimeError("Audio treki alınmadı (mənbə səssizdir və ya səs axını ayrı verilir)")
            elif tracks:
                self.note = "Seçilmiş səs trekləri alınmadı, fayldakı mövcud səs saxlanıldı"
        # İstifadəçi bütün səs treklərini işarədən götürübsə: səs heç yüklənməsin.
        if want_audio and self.b.get("audioNone"):
            try: full = strip_audio_streams(full)
            except Exception: pass
        self.full = full
        return full


    def run(self):
        tmp = ""
        try:
            if not self.segments: raise RuntimeError("Seqment seçilməyib")
            if not shutil.which("ffmpeg"): raise RuntimeError("ffmpeg quraşdırılmayıb")
            self.status = "active"
            src = str(self.b.get("url") or "")
            if not src: raise RuntimeError("Axın URL-i yoxdur")
            tmp = tempfile.mkdtemp(prefix="idm-sicut-")
            media = self._download(src, tmp)
            media_start = media_start_time(media)
            try:
                _dbg = subprocess.run([shutil.which("ffprobe"), "-v", "error", "-show_entries",
                                       "stream=codec_type", "-of", "csv=p=0", media],
                                      capture_output=True, text=True).stdout.strip().replace("\n", "+")
            except Exception: pass
            self.progress = max(self.progress, 99.0)   # yükləmə bitdi (baytlar tam); kəsmə/mux 99%-də qalır
            self.phase = "Seqmentlər kəsilir…"
            parts = []
            mode = str(self.b.get("mode") or "va").lower()
            # Audio rejimlərində yalnız səs; digərlərində video + səs (səs itməsin).
            maps = ["-map", "0:a?"] if mode in ("a", "as", "s") else ["-map", "0:v:0?", "-map", "0:a?"]
            fp = shutil.which("ffprobe")
            # Lossless kəsmə üçün başlanğıcı NÖVBƏTİ keyframe-ə sığdır: stream copy ilə
            # ilk GOP nasaz olmasın. Subtitr/audio da eyni sığdırılmış aralıqla kəsilir.
            kfs = self._keyframe_times(media, fp) if fp else []
            segs = []
            for a0, e0 in self.segments:
                k = next((x for x in kfs if x >= a0 - 0.001), None) if kfs else None
                if k is None or k >= e0 - 0.05: k = a0
                segs.append((k, e0))
            total = len(segs)
            for i, (a, e) in enumerate(segs):
                if self.removed: return
                out = os.path.join(tmp, "seg%03d.mkv" % i)
                dur = max(0.4, e - a)
                # Həmişə stream copy: yenidən kodlaşdırma (CPU 99%) YOXDUR.
                # Keyframe-ə sığdırılmış başlanğıc üçün INPUT seek: PTS sıfırdan başlayır,
                # concat keçidlərində video donmur. Keyframe tapılmayıbsa output seek.
                input_seek = bool(kfs) and abs(a - next((x for x in kfs if abs(x - a) < 0.02), a)) < 0.02
                if input_seek:
                    cmd = [shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin",
                           "-progress", "pipe:1", "-nostats", "-fflags", "+genpts",
                           "-ss", "%.3f" % a, "-i", media, "-t", "%.3f" % dur,
                           *maps, "-c", "copy", "-avoid_negative_ts", "make_zero", "-y", out]
                else:
                    cmd = [shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin",
                           "-progress", "pipe:1", "-nostats",
                           "-i", media, "-ss", "%.3f" % a, "-to", "%.3f" % e,
                           *maps, "-c", "copy", "-avoid_negative_ts", "make_zero", "-y", out]
                self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                             text=True, errors="replace", bufsize=1, start_new_session=True)
                for line in self.proc.stdout:
                    if self.removed: break
                    if line.startswith("out_time_ms="):
                        try: cur = int(line.split("=", 1)[1]) / 1_000_000.0
                        except Exception: cur = 0
                        frac = min(1.0, max(0.0, cur / dur))
                        # Yükləmə bitib (99%); kəsmə/mux mərhələsi 99→100 aralığında irəliləsin.
                        self.progress = max(self.progress, min(99.7, 99.0 + ((i + frac) / max(1, total)) * 0.7))
                        self.phase = "Kəsilir %d/%d…" % (i + 1, total)
                self.proc.wait()
                if self.proc.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) < 2048:
                    raise RuntimeError("Seqment kəsilə bilmədi (%d)" % (i + 1))
                try:
                    _d3 = subprocess.run([shutil.which("ffprobe"), "-v", "error", "-show_entries",
                                          "stream=codec_type", "-of", "csv=p=0", out],
                                         capture_output=True, text=True).stdout.strip().replace("\n", "+")
                except Exception: pass
                parts.append(out)
            if self.removed: return
            # Real kəsilmiş müddətlər: subtitr offsetləri nominal yox, ffprobe ilə ölçülür.
            part_durs = []
            for _pi, _pp in enumerate(parts):
                _d = 0.0
                try:
                    _r = subprocess.run([shutil.which("ffprobe"), "-v", "error", "-show_entries", "format=duration",
                                         "-of", "default=nw=1:nk=1", _pp], capture_output=True, text=True,
                                        errors="replace", timeout=20, stdin=subprocess.DEVNULL)
                    _d = num((_r.stdout or "").strip()) or 0.0
                except Exception:
                    _d = 0.0
                if _d <= 0:
                    _d = max(0.04, segs[_pi][1] - segs[_pi][0]) if _pi < len(segs) else 0.04
                part_durs.append(_d)
            cut_segs = [(segs[i][0], segs[i][0] + part_durs[i]) for i in range(len(parts))]
            self.progress = max(self.progress, 99.75)
            self.phase = "Birləşdirilir (stream copy)…"
            lst = os.path.join(tmp, "list.txt")
            with open(lst, "w", encoding="utf-8") as fh:
                for si, pth in enumerate(parts):
                    fh.write("file '%s'\n" % pth.replace("'", "'\\''"))
                    # Duration hər seqmentin nəzərdə tutulan uzunluğu olsun: concat
                    # növbəti faylı audio/video qalıq fərqinə görə yox, dəqiq buradan başlasın.
                    if si < len(part_durs):
                        fh.write("duration %.3f\n" % max(0.04, part_durs[si]))
            cmd = [shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                   "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", lst,
                   "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", self.target]
            self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                         text=True, errors="replace", start_new_session=True)
            _, err = self.proc.communicate(timeout=600)
            if self.proc.returncode != 0:
                raise RuntimeError((err or "Birləşdirmə alınmadı")[-300:])
            # Yalnız-səs: nəticəni .mkv yox, düzgün audio konteynerinə (m4a/mp3/opus/…) gətir.
            if self.audio_only and not bool(self.b.get("subs")):
                try:
                    np = self._finalize_audio(self.target)
                    if np and np != self.target:
                        self.target = np; self.name = os.path.basename(np)
                        self.path = np
                except Exception:
                    pass
            try:
                _d2 = subprocess.run([shutil.which("ffprobe"), "-v", "error", "-show_entries",
                                      "stream=codec_type", "-of", "csv=p=0", self.target],
                                     capture_output=True, text=True).stdout.strip().replace("\n", "+")
            except Exception: pass
            # Subtitr rejimi: yalnız seçilmiş seqmentlərə düşən cue-lar götürülür,
            # vaxtlar sıfırdan yenidən qurulur və final MKV-yə soft track kimi mux olunur.
            if bool(self.b.get("subs")):
                try:
                    def parse_cue_file(path):
                        txt = open(path, encoding="utf-8", errors="replace").read().replace("\r", "")
                        out = []
                        for blk in re.split(r"\n{2,}", txt):
                            m = re.search(r"(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})", blk)
                            if not m: continue
                            def tosec(x):
                                x = x.replace(",", "."); p2 = x.split(":")
                                if len(p2) == 3: return int(p2[0]) * 3600 + int(p2[1]) * 60 + float(p2[2])
                                return int(p2[0]) * 60 + float(p2[1])
                            body = "\n".join([ln.strip() for ln in blk.split("\n") if ln.strip() and "-->" not in ln and not ln.strip().isdigit()])
                            if body: out.append((tosec(m.group(1)), tosec(m.group(2)), body))
                        _off = _vtt_map_offset(txt) - float(media_start or 0)
                        return [(max(0.0, a + _off), max(0.0, b + _off), t) for a, b, t in out]
                    def fmt_ts(v):
                        v = max(0.0, v); h = int(v // 3600); mi = int((v % 3600) // 60); se = v % 60
                        return "%02d:%02d:%06.3f" % (h, mi, se)
                    merged_dur = sum(part_durs) if part_durs else sum(max(0.2, e - a) for a, e in segs)
                    # ASS PlayRes (1920x1080) videonun real ölçüsünə uyğunlaşdırılır (asıxmanın qarşısı).
                    vw = vh = 0
                    try:
                        if fp:
                            pr = subprocess.run([fp, "-v", "error", "-select_streams", "v:0",
                                                 "-show_entries", "stream=width,height", "-of", "csv=p=0", media],
                                                capture_output=True, text=True, errors="replace", timeout=20,
                                                stdin=subprocess.DEVNULL)
                            pc = (pr.stdout or "").strip().split(",")
                            if len(pc) >= 2: vw, vh = int(pc[0] or 0), int(pc[1] or 0)
                    except Exception:
                        vw = vh = 0
                    subs_out = []   # [(fayl, ass_mi)]
                    for sp in self.sidecars:
                        ext = os.path.splitext(sp)[1].lower()
                        if ext in (".ass", ".ssa"):
                            # ASS/SSA: stil, rəng və bayraq vektorları toxunulmadan yalnız vaxtlar sürüşür.
                            try:
                                shifted = ass_shift_text(open(sp, encoding="utf-8", errors="replace").read(), cut_segs, media_start)
                            except Exception:
                                shifted = ""
                            if not shifted: continue
                            if vw > 0 and vh > 0:
                                try: shifted = ass_fit_video(shifted, vw, vh)
                                except Exception: pass
                            outp = os.path.splitext(sp)[0] + ".cut.ass"
                            open(outp, "w", encoding="utf-8").write(shifted)
                            subs_out.append((outp, True))
                            continue
                        cues = parse_cue_file(sp)
                        if not cues: continue
                        lines, off = ["WEBVTT", ""], 0.0
                        for si, (a, e) in enumerate(cut_segs):
                            dur2 = max(0.2, part_durs[si] if si < len(part_durs) else (e - a))
                            for c0, c1, body in cues:
                                if c1 <= a or c0 >= e: continue
                                s2 = max(0.0, c0 - a) + off; t2 = min(dur2, c1 - a) + off
                                if t2 - s2 < 0.15: continue
                                lines.append("%s --> %s\n%s" % (fmt_ts(s2), fmt_ts(t2), body))
                                lines.append("")
                            off += dur2
                        outp = os.path.splitext(sp)[0] + ".cut.vtt"
                        open(outp, "w", encoding="utf-8").write("\n".join(lines))
                        subs_out.append((outp, False))
                    # Sİ ilə hazırlanmış alt yazılar (mətn birbaşa verilir) — seqmentlərə görə kəsilir.
                    for j, a in enumerate(self.b.get("aiSubs") or []):
                        try:
                            lg = re.sub(r"[^A-Za-z0-9-]", "", str(a.get("lang") or "aze")) or "aze"
                            cues = parse_cues_media(str(a.get("srt") or ""), 0)
                            if not cues: continue
                            lines, off = ["WEBVTT", ""], 0.0
                            for si, (a0, e0) in enumerate(cut_segs):
                                dur2 = max(0.2, part_durs[si] if si < len(part_durs) else (e0 - a0))
                                for c0, c1, body in cues:
                                    if c1 <= a0 or c0 >= e0: continue
                                    s2 = max(0.0, c0 - a0) + off
                                    t2 = min(dur2, c1 - a0) + off
                                    if t2 - s2 < 0.15: continue
                                    lines.append("%s --> %s\n%s" % (fmt_ts(s2), fmt_ts(t2), body))
                                    lines.append("")
                                off += dur2
                            if len(lines) <= 2: continue
                            pj = os.path.join(tmp, "ai%d.%s.cut.vtt" % (j, lg))
                            with open(pj, "w", encoding="utf-8") as fh: fh.write("\n".join(lines))
                            subs_out.append((pj, False))
                        except Exception:
                            pass
                    if subs_out:
                        # Birləşdirilmiş seqment alt yazıları da eyni görünüş pipeline-ından keçsin.
                        ap = sub_appearance(self.b)
                        if ap:
                            fixed = []
                            for sp2, is_ass2 in subs_out:
                                try: nf2 = style_subtitle_file(sp2, ap)
                                except Exception: nf2 = sp2
                                if nf2 and nf2 != sp2:
                                    rm(sp2); sp2, is_ass2 = nf2, True
                                fixed.append((sp2, is_ass2))
                            subs_out = fixed
                        mixed = os.path.splitext(self.target)[0] + ".subs.mkv"
                        cmd2 = [shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                                "-i", self.target]
                        for sp, _ass in subs_out: cmd2 += ["-i", sp]
                        cmd2 += ["-map", "0"]
                        for i2 in range(len(subs_out)): cmd2 += ["-map", "%d:0" % (i2 + 1)]
                        cmd2 += ["-c", "copy"]
                        # ASS trekləri OLDUĞU KİMİ (MPV rəng/bayrağı göstərsin), qalanları srt.
                        for i2, (_sp, is_ass) in enumerate(subs_out):
                            if not is_ass: cmd2 += ["-c:s:%d" % i2, "srt"]
                        # Hər trekin dil metadatası fayl adından (məs. .tr-orig.cut.vtt) götürülür.
                        for i2, (sp, _ass) in enumerate(subs_out):
                            lang2 = "aze"
                            mm2 = re.search(r"\.([A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})?)\.(?:styled\.)?(?:cut\.)?(?:styled\.)?(?:vtt|ass|ssa|srt)$", sp, re.I)
                            if mm2: lang2 = mm2.group(1)
                            cmd2 += ["-metadata:s:s:%d" % i2, "language=" + lang2]
                            cmd2 += ["-metadata:s:s:%d" % i2, "title=" + (lang2.upper() if lang2 != "aze" else "Alt yazı")]
                            cmd2 += ["-disposition:s:%d" % i2, "default" if i2 < 2 else "0"]
                        cmd2 += ["-t", "%.3f" % (merged_dur + 0.2), mixed]
                        subprocess.run(cmd2, capture_output=True, timeout=300)
                        if os.path.exists(mixed) and os.path.getsize(mixed) > 2048:
                            os.replace(mixed, self.target)
                except Exception as e:
                    try: print("sicut subs mux:", e, file=sys.stderr, flush=True)
                    except Exception: pass
            self.done = os.path.getsize(self.target)
            self.size = self.done
            self.path = self.target
            self.progress = 100.0
            # Tam yüklənmiş fayl (və onun sidecar subtitrləri) silinir — yalnız kəsilmiş nəticə qalır.
            try:
                for full in [getattr(self, "full", ""), getattr(self, "_orig_full", "")]:
                    if full and os.path.exists(full) and full != self.target:
                        os.remove(full)
                # Orijinal (və ya birləşdirilmiş) faylın adına uyğun qalan subtitr/qalıq faylları.
                for src in [getattr(self, "_orig_full", ""), getattr(self, "full", "")]:
                    if not src: continue
                    fbase = os.path.splitext(os.path.basename(src))[0]
                    # Sidecar altyazılar video yanına KOPYALANMIR: əks halda pleyer
                    # həm kəsilmiş (mux) treki, həm də tam uzunluqlu .vtt faylını göstərir.
                    for f in list(os.listdir(str(DL_DIR))):
                        if not f.startswith(fbase + "."): continue
                        if not re.search(r"\.(vtt|srt|ttml|json3|ass)$", f): continue
                        try: os.remove(os.path.join(str(DL_DIR), f))
                        except Exception: pass
                for sp in list(getattr(self, "sidecars", []) or []):
                    try:
                        if os.path.dirname(sp) == str(DL_DIR) and os.path.exists(sp): os.remove(sp)
                    except Exception: pass
            except Exception:
                pass
            self.phase = "Tamamlandı"
            self.status = "complete"
        except Exception as e:
            self.status, self.error = "error", str(e)[:400]
            self.phase = "Xəta"
            # Uğursuz cəhdin tam yükləmə qalıqlarını (və köməkçi subtitr fayllarını) sil.
            try:
                for p in [getattr(self, "full", ""), getattr(self, "_orig_full", "")]:
                    if p and os.path.exists(p) and p != self.target:
                        os.remove(p)
                for sp in list(getattr(self, "sidecars", []) or []):
                    if os.path.dirname(sp) == str(DL_DIR) and os.path.exists(sp):
                        os.remove(sp)
            except Exception:
                pass
        finally:
            try:
                shutil.rmtree(tmp, ignore_errors=True)
            except Exception:
                pass

# ---- Sİ ixrac: PDF / MD / DOCX / XLSX / TXT ----
def _ai_rows(items):
    rows = []
    for it in (items or []):
        if not isinstance(it, dict): continue
        a = int(it.get("start") or 0); b2 = int(it.get("end") or 0)
        def ts(ms):
            s = max(0, ms // 1000); return "%02d:%02d" % (s // 60, s % 60)
        rows.append({
            "time": "%s - %s" % (ts(a), ts(b2)),
            "title": str(it.get("title") or ""),
            "text": str(it.get("text") or ""),
            "fields": [(str(f.get("label") or ""), str(f.get("value") or "")) for f in (it.get("fields") or []) if isinstance(f, dict)]
        })
    return rows

def r_aiexport(b):
    fmt = str(b.get("format") or "txt").lower()
    name = safe_name(b.get("name") or "Sİ") or "Sİ"
    items = b.get("items") or []
    rows = _ai_rows(items)
    out_dir = Path(str(DL_DIR))
    stamp = time.strftime("%Y%m%d-%H%M%S")
    base = "%s — %s" % (name, stamp)
    if fmt == "txt":
        text = "\n".join("%s | %s%s" % (r["time"], r["title"], ("\n" + r["text"]) if r["text"] else "") for r in rows)
        p = out_dir / (base + ".txt"); p.write_text(text, encoding="utf-8"); return {"ok": True, "path": str(p)}
    if fmt == "md":
        lines = ["# " + name, ""]
        for r in rows:
            lines.append("## %s — %s" % (r["time"], r["title"]))
            if r["text"]: lines.append(r["text"])
            for k, v in r["fields"]: lines.append("- **%s:** %s" % (k, v))
            lines.append("")
        p = out_dir / (base + ".md"); p.write_text("\n".join(lines), encoding="utf-8"); return {"ok": True, "path": str(p)}
    if fmt == "xlsx":
        import csv
        csv_path = out_dir / (base + ".csv")
        with open(csv_path, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["Vaxt", "Başlıq", "Mətn", "Sahələr"])
            for r in rows:
                w.writerow([r["time"], r["title"], r["text"], "; ".join("%s: %s" % (k, v) for k, v in r["fields"])])
        lo = shutil.which("libreoffice") or shutil.which("soffice")
        if not lo: raise RuntimeError("libreoffice tapılmadı (xlsx ixracı üçün)")
        subprocess.run([lo, "--headless", "--norestore", "--convert-to", "xlsx:Calc MS Excel 2007 XML",
                        "--outdir", str(out_dir), str(csv_path)], capture_output=True, timeout=180)
        xp = out_dir / (base + ".xlsx")
        rm(csv_path)
        if not xp.exists(): raise RuntimeError("XLSX yaradılmadı")
        return {"ok": True, "path": str(xp)}
    if fmt in ("pdf", "docx"):
        def esc(s):
            return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
        parts = ["<html><head><meta charset='utf-8'><style>body{font-family:'DejaVu Sans',sans-serif;font-size:11pt}",
                 "h1{font-size:16pt}h2{font-size:12.5pt;margin:10pt 0 3pt}p{margin:2pt 0}ul{margin:2pt 0 6pt 14pt}</style></head><body>",
                 "<h1>" + esc(name) + "</h1>"]
        for r in rows:
            parts.append("<h2>%s — %s</h2>" % (esc(r["time"]), esc(r["title"])))
            if r["text"]: parts.append("<p>%s</p>" % esc(r["text"]))
            if r["fields"]:
                parts.append("<ul>" + "".join("<li><b>%s:</b> %s</li>" % (esc(k), esc(v)) for k, v in r["fields"]) + "</ul>")
        parts.append("</body></html>")
        html_path = out_dir / (base + ".html")
        html_path.write_text("\n".join(parts), encoding="utf-8")
        lo = shutil.which("libreoffice") or shutil.which("soffice")
        if not lo: raise RuntimeError("libreoffice tapılmadı")
        target = 'pdf:writer_pdf_Export' if fmt == "pdf" else 'docx:Office Open XML Text'
        subprocess.run([lo, "--headless", "--norestore", "--convert-to", target, "--outdir", str(out_dir), str(html_path)],
                       capture_output=True, timeout=180)
        outp = out_dir / (base + (".pdf" if fmt == "pdf" else ".docx"))
        rm(html_path)
        if not outp.exists(): raise RuntimeError("İxrac faylı yaradılmadı")
        return {"ok": True, "path": str(outp)}
    raise RuntimeError("Naməlum ixrac formatı: " + fmt)

def r_sicut(b):
    segs = b.get("segments") or []
    if not segs: raise RuntimeError("Seqment seçilməyib")
    if len(segs) > 60: raise RuntimeError("Bir dəfəyə ən çoxu 60 seqment")
    if not shutil.which("ffmpeg"): raise RuntimeError("ffmpeg quraşdırılmayıb")
    j = SegCutJob(b)
    return {"ok": True, "id": j.id, "name": j.name}

def r_cutctx(b):
    j = ctx_start_cut(b)
    return {"ok": True, "id": j.id, "name": j.name}

def r_hlsmeta(b):
    hdr = {"User-Agent": b.get("userAgent") or FH_UA, "Referer": b.get("referer") or "", "Cookie": b.get("cookie") or ""}
    return {"ok": True, **fast_hls_meta(b.get("url"), hdr, timeout=float(b.get("timeout") or 3))}

def r_ytdlp(b):
    check_url(b.get("url"))
    # YouTube HLS manifesti (manifest.googlevideo.com/.../itag/NNN) yavaş işləyir:
    # eyni keyfiyyəti səhifənin DASH/progressive formatı ilə yüklə (paralel, sürətli).
    try:
        u0 = str(b.get("url") or "")
        mm = re.search(r"manifest\.googlevideo\.com/api/manifest/hls_playlist/[^\s]*?/itag/(\d+)/", u0, re.I)
        ref = str(b.get("referer") or "")
        if mm and is_youtube(ref):
            b = dict(b)
            b["url"] = ref.split("&")[0]
            mode0 = str(b.get("mode") or ("a" if b.get("audio") else "va"))
            itag = mm.group(1)
            b["format"] = ("ba/b" if mode0 in ("a", "as", "s") else (itag + "+ba/b"))
            b.setdefault("_hs_note", "HLS→DASH")
    except Exception:
        pass
    # hotstream.club: bütün manifest sorğuları Accept: */* tələb edir (ffmpeg/yt-dlp 404 alır).
    if _pv_scope(b.get("url")) or _pv_snap_flag(b.get("url")):
        b = {**b, "_pv": True}   # pilavyerplay: birbaşa URL və ya extension snapshot-ı
    _u = _hs_local(b.get("url"), b)
    _hs = (_u != b.get("url")) or _hs_snap_flag(b.get("url"))   # birbaşa hotstream URL-i və ya onun yerli snapshot-ı
    if _u != b.get("url"):
        b = {**b, "url": _u}
    if _hs:
        # Bu CDN yalnız "Origin/Referer: https://hotstream.club" qəbul edir; saytın (yfilmizle)
        # Origin-i ilə bütün seqmentlər 403 olur -> "Server yavaşladı/blokladı" dövrəsi.
        try: rh = (urllib.parse.urlsplit(str(b.get("referer") or "")).hostname or "").lower()
        except Exception: rh = ""
        b = {**b, "_hotstream": True}
        if not _HS_HOST.search(rh or ""): b["referer"] = "https://hotstream.club/"
    mode = b.get("mode") or ("a" if b.get("audio") else "va")
    if mode not in MODES: raise RuntimeError("Naməlum yükləmə rejimi")
    ext = [x for x in (b.get("extSubs") or []) if isinstance(x, dict) and re.match(r"(?i)^https?://", str(x.get("url") or ""))]
    if mode in SUBMODES and not (ext or b.get("subLang") or b.get("subAll")): raise RuntimeError("Subtitr seçilməyib")
    if not (mode == "s" and ext) and not shutil.which("yt-dlp"):
        raise RuntimeError("yt-dlp quraşdırılmayıb (pipx install yt-dlp)")
    if mode in ("a", "as") and b.get("audioFormat") not in (None, "", "best") and b.get("audioFormat") not in [x for x, _ in audio_formats()]:
        raise RuntimeError("Bu audio formatı bu sistemdə dəstəklənmir (ffmpeg və ya uyğun kodlayıcı yoxdur)")
    key = job_key(b)
    for j in list(JOBS.values()):
        if j.key == key and j.status in ("waiting", "active", "paused") and not j.removed:
            raise RuntimeError("Bu video bu keyfiyyətdə artıq yüklənir")
    return {"ok": True, "id": Job(b).id}

def r_action(b):
    a, src, i = b.get("action"), b.get("source"), b.get("id")
    if a == "pauseall":
        try: rpc("forcePauseAll")
        except Exception: pass
        for j in list(JOBS.values()): j.action("pause")
        for j in list(CTXJOBS.values()): j.action("pause")
    elif a == "resumeall":
        try: rpc("unpauseAll")
        except Exception: pass
        for j in list(JOBS.values()): j.action("resume")
        for j in list(CTXJOBS.values()): j.action("resume")
    elif a == "clear":
        for it in aria_items():
            if it["status"] in ("complete", "error"):
                try: rpc("removeDownloadResult", it["id"])
                except Exception: pass
        for j in list(JOBS.values()):
            if j.status in ("complete", "error"): JOBS.pop(j.id, None)
        for j in list(CTXJOBS.values()):
            if j.status in ("complete", "error"): CTXJOBS.pop(j.id, None)
        for j in list(UPLOADJOBS.values()):
            if j.status in ("complete", "error"): UPLOADJOBS.pop(j.id, None)
    elif a == "retry" and src == "ytdlp":
        j = JOBS.get(i)
        if not j: raise RuntimeError("tapılmadı")
        JOBS.pop(i, None)
        Job(j.b)
    elif src == "aria2": aria_action(i, a)
    elif src == "ctx":
        j = CTXJOBS.get(i)
        if not j: raise RuntimeError("tapılmadı")
        j.action(a)
    elif src == "upload":
        j = UPLOADJOBS.get(i)
        if not j: raise RuntimeError("tapılmadı")
        j.action(a)
    else:
        j = JOBS.get(i)
        if not j: raise RuntimeError("tapılmadı")
        j.action(a)
    return {"ok": True}



# ---- Alt yazı: AI faylları, lyrics, mahnı aligner, MPV stili (dual-dan port) ----
def _aisub_manifest(data, ext):
    """Faylı həm diskdə saxlayır, həm də muxing üçün qısaömürlü yerli URL verir."""
    ctype = {"srt": "application/x-subrip", "vtt": "text/vtt", "ttml": "application/ttml+xml",
             "dfxp": "application/ttml+xml", "json3": "application/json", "ass": "text/x-ass",
             "ssa": "text/x-ssa", "lrc": "text/plain"}.get(ext, "text/plain")
    token = secrets.token_hex(12) + "." + ext
    now = time.time()
    with MLOCK:
        for k in [k for k, v in MANIFESTS.items() if now - v[0] > 86400]: MANIFESTS.pop(k, None)
        while len(MANIFESTS) > 800: MANIFESTS.pop(next(iter(MANIFESTS)), None)
        MANIFESTS[token] = (now, ctype, data)
    return f"http://127.0.0.1:{PORT}/m/{token}"

def r_aisub_file(b):
    """Orijinal və tərcümə edilmiş subtitri REAL fayl kimi yazır.
    Fayl hazır olduqdan sonra path qaytarır; extension 'Hazırdır' vəziyyətini göstərir."""
    text = str(b.get("text") or "")
    if not text.strip() or len(text) > 8_000_000:
        raise RuntimeError("Subtitr mətni etibarsızdır")
    ext = re.sub(r"[^a-z0-9]", "", str(b.get("ext") or "srt").lower())
    if ext not in ("srt", "vtt", "ttml", "dfxp", "json3", "ass", "ssa", "lrc"):
        ext = "srt"
    stem = os.path.splitext(safe_name(b.get("name") or "subtitle"))[0] or "subtitle"
    lang = safe_name(str(b.get("lang") or "")).lower()
    if lang: stem += "." + lang
    raw_dir = str(b.get("dir") or "").strip()
    folder = Path(os.path.expanduser(raw_dir)) if raw_dir else (DL_DIR / "AI Subtitles")
    if not folder.is_absolute(): folder = DL_DIR / folder
    folder.mkdir(parents=True, exist_ok=True)
    path = unique_path(os.path.join(str(folder), stem + "." + ext))
    data = text.encode("utf-8")
    part = path + ".part"
    try:
        with open(part, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(part, path)
    except Exception:
        rm(part)
        raise
    url = _aisub_manifest(data, ext)
    return {"ok": True, "url": url, "path": path, "dir": str(folder), "name": os.path.basename(path),
            "lang": str(b.get("lang") or ""), "label": str(b.get("label") or ""), "ext": ext}

def r_aisub_delete(b):
    """İş bitdikdən sonra yalnız aralıq/orijinal subtitr fayllarını silir.
    İnteqrasiya üçün saxlanılan final SRT-yə toxunmur."""
    root = os.path.realpath(str(DL_DIR / "AI Subtitles"))
    paths = b.get("paths")
    if not isinstance(paths, list): paths = [b.get("path")] if b.get("path") else []
    removed = []
    for raw in paths[:20]:
        try:
            p = os.path.realpath(os.path.expanduser(str(raw or "")))
            if not p.startswith(root + os.sep): continue
            if os.path.isfile(p):
                rm(p)
                removed.append(p)
        except Exception:
            pass
    return {"ok": True, "removed": removed}

def r_aisub(b):
    """Geriyə uyğunluq: yalnız yaddaşda saxlayan köhnə /aisub endpoint-i."""
    text = str(b.get("text") or "")
    if "-->" not in text or len(text) > 8_000_000:
        raise RuntimeError("AI subtitr mətni etibarsızdır")
    data = text.encode("utf-8")
    name = secrets.token_hex(12) + ".srt"
    now = time.time()
    with MLOCK:
        for k in [k for k, v in MANIFESTS.items() if now - v[0] > 86400]: MANIFESTS.pop(k, None)
        while len(MANIFESTS) > 800: MANIFESTS.pop(next(iter(MANIFESTS)), None)
        MANIFESTS[name] = (now, "application/x-subrip", data)
    return {"ok": True, "url": f"http://127.0.0.1:{PORT}/m/{name}", "lang": str(b.get("lang") or ""), "label": str(b.get("label") or "")}

# MMS/CTC modeli ~1.2 GB yaddaş tutur; paralel 2-3 iş systemd-oomd-nin
# helper-i öldürməsinə səbəb olurdu. Ona görə vaxtlama tək növbə ilə işləyir.
_SONGALIGN_LOCK = threading.Lock()

def r_songalign(b):
    """Azərbaycan mahnısı: sözləri bir yerli MMS/CTC modeli ilə vaxtlandırır.

    Bütün model işi `song_align.py`-dədir (CPU ONNX). Xarici xidmət üçün
    IDM_ALIGN_URL verilə bilər; lokal rejimdə `.aligner-venv` istifadə olunur.
    """
    url = str(b.get("url") or "")
    lyrics = str(b.get("lyrics") or "")
    check_url(url)
    if IS_WIN:
        raise RuntimeError("Mahnı vaxtlandırması (MMS/CTC) Windows-da dəstəklənmir")
    if len(lyrics.strip()) < 20:
        raise RuntimeError("Mahnı sözləri boşdur")
    payload = {k: b.get(k) for k in ("url", "videoId", "title", "artist", "song", "lyrics", "duration", "exclude")}
    ext = os.environ.get("IDM_ALIGN_URL", "").strip()
    if ext:
        req = urllib.request.Request(ext, json.dumps(payload).encode("utf-8"),
                                     {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=900) as r:
            j = json.loads((r.read() or b"{}").decode("utf-8", "replace"))
        if not j.get("ok", True) or not j.get("cues"):
            raise RuntimeError(j.get("error") or "Xarici GPU aligner boş cavab verdi")
        return j
    # Keş: eyni video + eyni sözlər üçün MMS bir dəfə işləsin (təkrar tərcümə anında bitsin).
    ck = hashlib.sha1(("v2|" + "|".join(str(payload.get(k) or "") for k in ("videoId", "url", "duration", "lyrics"))).encode("utf-8")).hexdigest()
    cdir = CONF / "timed"
    cfile = cdir / (ck + ".json")
    try:
        if cfile.exists():
            j = json.loads(cfile.read_text(encoding="utf-8"))
            if j.get("ok") and j.get("cues"): return j
    except Exception:
        pass
    script = Path(__file__).with_name("song_align.py")
    if not script.exists():
        raise RuntimeError("Song aligner tapılmadı: song_align.py")
    # MMS/CTC yalnız bir yerli proqramdır; ayrı venv-də işləyir (torch yox).
    py = os.environ.get("IDM_ALIGN_PYTHON", "").strip()
    if not py:
        cand = Path(__file__).with_name(".aligner-venv") / "bin" / "python"
        py = str(cand) if cand.exists() else sys.executable
    # Yaddaş qoruyucusu: az boş RAM varsa MMS/CTC başlatmırıq (OOM öldürməsin).
    try:
        avail_mb = 0
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for ln in fh:
                if ln.startswith("MemAvailable:"):
                    avail_mb = int(ln.split()[1]) // 1024
                    break
        if avail_mb and avail_mb < 2400:
            raise RuntimeError("Yaddaş azdır (%d MB boşdur). Brauzer tablarını bağlayıb yenidən cəhd edin." % avail_mb)
    except RuntimeError:
        raise
    except Exception:
        pass
    env = dict(os.environ)
    env.setdefault("OMP_NUM_THREADS", "4")
    env.setdefault("OPENBLAS_NUM_THREADS", "4")
    env.setdefault("MKL_NUM_THREADS", "4")
    if not _SONGALIGN_LOCK.acquire(timeout=600):
        raise RuntimeError("Başqa mahnı vaxtlandırılır, bir az sonra yenidən cəhd edin")
    try:
        # Kilid altında keşi bir də yoxla (paralel eyni mahnı üçün təkrar işləməsin).
        try:
            if cfile.exists():
                j0 = json.loads(cfile.read_text(encoding="utf-8"))
                if j0.get("ok") and j0.get("cues"): return j0
        except Exception:
            pass
        p = subprocess.run([py, str(script)], input=json.dumps(payload).encode("utf-8"),
                           capture_output=True, timeout=900, cwd=str(script.parent), env=env)
    finally:
        _SONGALIGN_LOCK.release()
    out = (p.stdout or b"").decode("utf-8", "replace").strip()
    err = (p.stderr or b"").decode("utf-8", "replace").strip()
    try:
        j = json.loads(out.splitlines()[-1]) if out else {}
    except Exception:
        j = {}
    if p.returncode != 0 or not j.get("ok") or not j.get("cues"):
        raise RuntimeError((j.get("error") or err or out or "GPU song aligner xətası")[-700:])
    try:
        cdir.mkdir(parents=True, exist_ok=True)
        cfile.write_text(json.dumps(j, ensure_ascii=False), encoding="utf-8")
        for f in sorted(cdir.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)[200:]:
            f.unlink(missing_ok=True)
    except Exception:
        pass
    return j

_LYR_CACHE = {}
_LYRIC_SITES = None

def _lyr_norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).lower()
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def _lyr_slug(s):
    return "-".join(_lyr_norm(s).split())

def _lyr_http(url, timeout=35):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
    })
    with _safe_open(req, timeout=timeout) as r:
        b = r.read()
    if b[:2] == b"\x1f\x8b":
        import gzip
        b = gzip.decompress(b)
    return b.decode("utf-8", "ignore")

def _lyr_extract(html):
    # Yeni LyricsTranslate: #song-body içində ll-<par>-<line> div-ləri
    at = re.search(r'id=["\']song-body["\']', html or "", re.I)
    if at:
        chunk = html[at.start():at.start() + 300000]
        lines = re.findall(r'<div[^>]*class=["\'][^"\']*\bll-\d+-\d+\b[^"\']*["\'][^>]*>(.*?)</div>', chunk, re.S | re.I)
        out = []
        for x in lines:
            t = html_module.unescape(re.sub(r"<br\s*/?>", "\n", x))
            t = html_module.unescape(re.sub(r"<[^>]*>", " ", t))
            t = re.sub(r"[ \t]+", " ", t).strip()
            if t: out.append(t)
        if out: return "\n".join(out)
    # Köhnə LyricsTranslate: .song-node-text içində <p> / <br>
    m = re.search(r'<div[^>]*class=["\'][^"\']*song-node-text[^"\']*["\'][^>]*>(.*?)</div>', html or "", re.S | re.I)
    if m:
        x = re.sub(r"<br\s*/?>", "\n", m.group(1), flags=re.I)
        x = re.sub(r"</p\s*>", "\n", x, flags=re.I)
        x = html_module.unescape(re.sub(r"<[^>]*>", " ", x))
        lines = [re.sub(r"[ \t]+", " ", y).strip() for y in x.split("\n")]
        lines = [y for y in lines if y]
        if lines: return "\n".join(lines)
    return ""

def _lyr_wayback(artist, song, title):
    artist_slug, song_slug = _lyr_slug(artist), _lyr_slug(song or title)
    prefixes = []
    if artist_slug:
        prefixes.append("lyricstranslate.com/en/" + artist_slug + "-*")
    for prefix in prefixes:
        q = urllib.parse.urlencode({"url": prefix, "output": "json", "filter": "statuscode:200",
                                    "collapse": "urlkey", "limit": "300"})
        try:
            rows = json.loads(_lyr_http("https://web.archive.org/cdx/search/cdx?" + q, 40))
        except Exception:
            continue
        cand = []
        for row in rows[1:] if isinstance(rows, list) else []:
            if len(row) < 3: continue
            ts, orig = row[1], row[2]
            if "-lyrics" not in orig.lower() or "translation" in orig.lower():
                continue
            slug = urllib.parse.unquote(orig.split("/")[-1].lower())
            # title slug oxşarlığı + söz tokenləri
            u = re.sub(r"[^a-z0-9]+", "-", slug)
            tokens = [t for t in song_slug.split("-") if t]
            hit = sum(1 for t in tokens if t and t in u)
            import difflib
            score = hit + difflib.SequenceMatcher(None, song_slug, slug.replace("?amp=", "").replace("-lyrics.html", "")).ratio()
            cand.append((score, ts, orig))
        cand.sort(reverse=True)
        import time
        for score, ts, orig in cand[:6]:
            if score < 0.45: continue
            snap = "https://web.archive.org/web/%sid_/%s" % (ts, orig)
            for attempt in range(3):
                try:
                    html = _lyr_http(snap, 45)
                    lyr = _lyr_extract(html)
                    if len(lyr) >= 40:
                        return {"lyrics": lyr, "source": "lyricstranslate-wayback", "url": orig, "score": score}
                    break
                except Exception:
                    time.sleep(1.5 + attempt)
    return None

def r_lyrics(b):
    """LyricsTranslate + Wayback fallback (Cloudflare-i keçmək üçün arxiv)."""
    artist = str(b.get("artist") or "").strip()
    song = str(b.get("song") or "").strip()
    title = str(b.get("title") or "").strip()
    key = (_lyr_norm(artist) + "|" + _lyr_norm(song or title)).lower()
    if key in _LYR_CACHE: return _LYR_CACHE[key]
    out = _lyr_wayback(artist, song, title) or {"lyrics": "", "source": "", "url": "", "score": 0}
    if len(_LYR_CACHE) > 120: _LYR_CACHE.pop(next(iter(_LYR_CACHE)))
    _LYR_CACHE[key] = out
    return out

def r_songaudio(b):
    """YouTube audio → Gemini üçün inline MP3 (base64). Ağır model yoxdur."""
    url = str(b.get("url") or "")
    check_url(url)
    yt = shutil.which("yt-dlp")
    if not yt:
        raise RuntimeError("yt-dlp quraşdırılmayıb")
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg quraşdırılmayıb")
    with tempfile.TemporaryDirectory(prefix="idm-song-audio-") as td:
        out = str(Path(td) / "audio.%(ext)s")
        cmd = [yt, "--no-playlist", "--no-warnings", "--quiet", "-f", "bestaudio/best",
               "-x", "--audio-format", "mp3", "--audio-quality", "7", "-o", out]
        cmd += yt_args(url)
        ref = str(b.get("referer") or "")
        if ref:
            cmd += ["--referer", ref]
        try:
            p = subprocess.run(cmd + [url], capture_output=True, timeout=240,
                               stdin=subprocess.DEVNULL, cwd=td)
        except subprocess.TimeoutExpired:
            raise RuntimeError("Audio yükləmə vaxtı keçdi")
        if p.returncode != 0:
            err = (p.stderr or b"").decode("utf-8", "replace").strip().splitlines()
            raise RuntimeError((err[-1] if err else "yt-dlp audio xətası")[:500])
        files = sorted(Path(td).glob("audio*.mp3"))
        if not files:
            raise RuntimeError("MP3 audio yaranmadı")
        data = files[0].read_bytes()
        if len(data) > 18 * 1024 * 1024:
            raise RuntimeError("Audio Gemini inline limiti üçün çox böyükdür")
        dur = 0
        fp = shutil.which("ffprobe")
        if fp:
            try:
                q = subprocess.run([fp, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(files[0])],
                                   capture_output=True, text=True, timeout=15)
                dur = num(q.stdout.strip()) or 0
            except Exception: pass
        return {"ok": True, "mimeType": "audio/mp3", "data": base64.b64encode(data).decode("ascii"),
                "size": len(data), "duration": dur}

# ---- Genius sözləri: axtarış API-si + səhifə HTML-i (data-lyrics-container) ----
def _gen_norm(s):
    s = str(s or "").lower().replace("ə", "e").replace("ı", "i").replace("ş", "s").replace("ç", "c").replace("ğ", "g").replace("ö", "o").replace("ü", "u")
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def _gen_score(want_t, want_a, got_t, got_a):
    wt, gt = set(_gen_norm(want_t).split()), set(_gen_norm(got_t).split())
    wa, ga = set(_gen_norm(want_a).split()), set(_gen_norm(got_a).split())
    if not gt: return -1.0
    tscore = len(wt & gt) / max(1, min(len(wt), len(gt)))
    if _gen_norm(want_t) == _gen_norm(got_t): tscore += 1
    if _gen_norm(want_t) in _gen_norm(got_t) or _gen_norm(got_t) in _gen_norm(want_t): tscore += .35
    ascore = 0.0
    if wa and ga:
        ascore = 1.0 if (_gen_norm(want_a) in _gen_norm(got_a) or _gen_norm(got_a) in _gen_norm(want_a)) else len(wa & ga) / max(1, min(len(wa), len(ga)))
    return tscore + ascore * 1.25

def _gen_lyrics_from_html(html):
    starts = [m for m in re.finditer(r'<div[^>]*data-lyrics-container="true"[^>]*>', html, re.I)]
    blocks = []
    for m in starts:
        i = m.end(); depth = 1; end = -1
        for t in re.finditer(r'<div\b[^>]*>|</div\s*>', html[i:], re.I):
            if t.group(0).lower().startswith("</div"): depth -= 1
            else: depth += 1
            if depth == 0:
                end = i + t.start(); break
        if end < 0: continue
        raw = html[i:end]
        raw = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
        raw = re.sub(r"</(?:p|div|h\d)>", "\n", raw, flags=re.I)
        txt = html_module.unescape(re.sub(r"<[^>]*>", "", raw)).strip()
        txt = re.sub(r"[ \t]+\n", "\n", txt)
        txt = re.sub(r"\n{3,}", "\n\n", txt)
        if len(txt) >= 20: blocks.append(txt)
    if not blocks: return ""
    out = []
    for b in blocks:
        if b not in out and not any(b in x for x in out): out.append(b)
    text = "\n".join(out)
    text = re.sub(r"^\s*\d+\s+Contributors?[^\n]*\n", "", text, flags=re.I)
    return text.strip()

_LYR2 = {}

def r_genius(b):
    artist = str(b.get("artist") or "").strip()
    song = str(b.get("song") or "").strip()
    if not song: raise RuntimeError("Mahnı adı boşdur")
    ck = ("genius", _gen_norm(artist), _gen_norm(song))
    hit = _LYR2.get(ck)
    if hit and time.time() - hit[0] < 3600: return hit[1]
    hdr = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
           "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://genius.com/"}
    q = (artist + " " + song).strip()
    try:
        req = urllib.request.Request("https://genius.com/api/search/song?q=" + urllib.parse.quote(q), headers=hdr)
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.loads((r.read() or b"{}").decode("utf-8", "replace"))
    except Exception as e:
        raise RuntimeError("Genius axtarışı alınmadı: " + str(e)[:80])
    hits = []
    for sec in ((j.get("response") or {}).get("sections") or []):
        for h in (sec.get("hits") or []):
            x = h.get("result") or {}
            if x.get("path"): hits.append(x)
    best = None
    for x in hits[:8]:
        sc = _gen_score(song, artist, x.get("title") or x.get("full_title") or "", x.get("artist_names") or "")
        if sc >= 1 and (best is None or sc > best[0]): best = (sc, x)
    if not best: return {"ok": True, "lyrics": "", "source": "genius"}
    path = best[1].get("path") or ""
    url = "https://genius.com/" + path.lstrip("/")
    try:
        req2 = urllib.request.Request(url, headers={**hdr, "Accept": "text/html,application/xhtml+xml"})
        with urllib.request.urlopen(req2, timeout=20) as r:
            html = r.read(1_500_000).decode("utf-8", "replace")
    except Exception as e:
        raise RuntimeError("Genius səhifəsi açılmadı: " + str(e)[:80])
    text = _gen_lyrics_from_html(html)
    out = {"ok": True, "lyrics": text[:24000], "url": url, "source": "genius"}
    if len(_LYR2) > 200: _LYR2.pop(next(iter(_LYR2)))
    _LYR2[ck] = (time.time(), out)
    return out

# ---- Musixmatch sözləri: səhifə __NEXT_DATA__ JSON-undan oxunur (yalnız sözlər axtarışı üçün) ----
def _mxm_slug(s):
    s = str(s or "").lower()
    for a, b in (("ə", "e"), ("ı", "i"), ("ş", "s"), ("ç", "c"), ("ğ", "g"), ("ö", "o"), ("ü", "u")):
        s = s.replace(a, b)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s

def _mxm_slug_mixed(s):
    """Musixmatch-in real qaydası: yalnız ə→e, ı→i; ş/ç/ğ/ö/ü saxlanılır."""
    s = str(s or "").lower().strip().replace("ə", "e").replace("ı", "i")
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE)
    return re.sub(r"-{2,}", "-", s).strip("-")

def _mxm_slug_keep(s):
    """Musixmatch-in öz slug-ı: diakritiklər saxlanılır (Qara-Derviş/Yorğun)."""
    s = str(s or "").lower().strip()
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s

def _mxm_api_key():
    """Açar: env MXM_API_KEY və ya ~/.config/jdm/lyrics.json."""
    k = os.environ.get("MXM_API_KEY", "").strip()
    if k: return k
    for name in ("lyrics.json", "musixmatch.json"):
        try:
            j = json.loads((CONF / name).read_text(encoding="utf-8"))
            k = str(j.get("musixmatchApiKey") or j.get("apikey") or j.get("apiKey") or "").strip()
            if k: return k
        except Exception:
            continue
    return ""

_MXM_UNSIGNED_DEAD = [0.0]   # imzasız endpoint boş nəticə verdisə 10 dəq təkrar yoxlanmasın

def _mxm_search_urls(artist, song):
    """Musixmatch axtarışı: rəsmi API (açarla) və imzasız desktop endpoint-i.

    Qaytarılan URL-lər yalnız mahnı/sənətçi uyğunluğu yoxlanandan sonra qəbul
    olunur; uyğun nəticə yoxdursa boş siyahı (sonra slug üsulu işləyir).
    """
    out = []
    key = _mxm_api_key()
    if key and song:
        q = urllib.parse.urlencode({"apikey": key, "format": "json", "q_track": song,
                                    "q_artist": artist, "page_size": 8,
                                    "s_track_rating": "desc", "f_has_lyrics": 1})
        try:
            with urllib.request.urlopen("https://api.musixmatch.com/ws/1.1/track.search?" + q, timeout=20) as r:
                j = json.loads((r.read() or b"{}").decode("utf-8", "replace"))
            best = None
            for x in (((j.get("message") or {}).get("body") or {}).get("track_list") or []):
                tr = x.get("track") or {}
                sc = _gen_score(song, artist, tr.get("track_name") or "", tr.get("artist_name") or "")
                if sc >= 1 and (best is None or sc > best[0]):
                    best = (sc, tr)
            if best:
                u = str(best[1].get("track_share_url") or "").split("?")[0]
                if u.startswith("http"): out.append(u)
        except Exception:
            pass
    if song and (not out) and time.time() > _MXM_UNSIGNED_DEAD[0]:
        q = urllib.parse.urlencode({"app_id": "web-desktop-app-v1.0", "format": "json",
                                    "q": (artist + " " + song).strip(), "page_size": 8,
                                    "page": 1, "s_track_rating": "desc"})
        try:
            with urllib.request.urlopen("https://apic-desktop.musixmatch.com/ws/1.1/macro.search?" + q, timeout=20) as r:
                j = json.loads((r.read() or b"{}").decode("utf-8", "replace"))
            tl = ((((j.get("message") or {}).get("body") or {}).get("macro_result_list") or {})
                  .get("track_list") or [])
            hits = []
            for x in tl:
                tr = x.get("track") or {}
                sc = _gen_score(song, artist, tr.get("track_name") or "", tr.get("artist_name") or "")
                u = str(tr.get("track_share_url") or "").split("?")[0]
                if sc >= 1 and u.startswith("http"):
                    hits.append((sc, u))
            hits.sort(reverse=True)
            for sc, u in hits[:2]:
                if u not in out: out.append(u)
            if not hits:
                _MXM_UNSIGNED_DEAD[0] = time.time() + 600
        except Exception:
            _MXM_UNSIGNED_DEAD[0] = time.time() + 600
    return out

# ---- Lyricsify: öz axtarışı + LRC (vaxtlı) sözlər ----
_LYF_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
           "Chrome/156.0.0.0 Safari/537.36")

def _lyf_tr(s):
    """Qara Dərviş -> Qara Dervis (ə→e, ı→i, ğ→g, ş→s, ç→c, ö→o, ü→u)."""
    out = []
    for ch in str(s or ""):
        out.append({"ə": "e", "ı": "i", "ğ": "g", "ş": "s", "ç": "c", "ö": "o", "ü": "u",
                    "Ə": "E", "I": "I", "Ğ": "G", "Ş": "S", "Ç": "C", "Ö": "O", "Ü": "U"}.get(ch, ch))
    return "".join(out)

def _lyf_queries(artist, song):
    qs = []
    for a, s in ((artist, song), (_lyf_tr(artist), song), (artist, _lyf_tr(song)),
                 (_lyf_tr(artist), _lyf_tr(song))):
        q = ("%s %s" % (a or "", s or "")).strip()
        if q and q.lower() not in [x.lower() for x in qs]:
            qs.append(q)
    return qs

def _lyf_get(url, timeout=15):
    req = urllib.request.Request(url, headers={
        "User-Agent": _LYF_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.lyricsify.com/",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(1_500_000).decode("utf-8", "replace")

def _lrc_cues(text):
    """[mm:ss.xx] sətirlərini cue-lara çevirir (LRC)."""
    rows = []
    for line in str(text or "").replace("\r", "").split("\n"):
        m = re.match(r"^\s*\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$", line)
        if not m: continue
        frac = (m.group(3) or "0").ljust(3, "0")[:3]
        t = int(m.group(1)) * 60000 + int(m.group(2)) * 1000 + int(frac)
        txt = re.sub(r"\s+", " ", m.group(4) or "").strip()
        if txt: rows.append((t, txt))
    if len(rows) < 4: return []
    cues = []
    for i, (t, txt) in enumerate(rows):
        nxt = rows[i + 1][0] if i + 1 < len(rows) else t + 4000
        end = max(t + 700, min(nxt - 60, t + 8000))
        cues.append({"start": t, "end": end, "text": txt})
    return cues

def _lyf_page_lyrics(url):
    html = _lyf_get(url, 20)
    body = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    body = re.sub(r"(?i)<br\s*/?>", "\n", body)
    body = re.sub(r"(?i)</(?:div|p|li|h\d)>", "\n", body)
    body = html_module.unescape(re.sub(r"<[^>]*>", "", body))
    cues = _lrc_cues(body)
    if cues:
        text = "\n".join(c["text"] for c in cues)
        return {"lyrics": text[:24000], "lrc": cues, "url": url}
    # LRC yoxdursa sadə mətn (sətirlər)
    lines = [re.sub(r"\s+", " ", x).strip() for x in body.split("\n")]
    lines = [x for x in lines if len(x) >= 3 and not re.search(r"(?i)lyricsify|cookie|privacy|terms|sign in|upload|download lrc", x)]
    txt = "\n".join(lines)
    return {"lyrics": txt[:24000], "lrc": [], "url": url} if len(txt) >= 40 else None

def r_lyricsify(b):
    """Lyricsify axtarışı (ə/e, ı/i, ğ/g, ş/s variantları ilə) + LRC vaxtları."""
    artist = str(b.get("artist") or "").strip()
    song = str(b.get("song") or "").strip()
    if not song:
        raise RuntimeError("Mahnı adı boşdur")
    ck = ("lyf", _gen_norm(artist), _gen_norm(song))
    hit = _LYR2.get(ck)
    if hit and time.time() - hit[0] < 3600: return hit[1]
    want = ("%s %s" % (_gen_norm(artist), _gen_norm(song))).strip()
    best = None
    for q in _lyf_queries(artist, song)[:4]:
        for su in ("https://www.lyricsify.com/search?q=%s", "https://www.lyricsify.com/search/%s"):
            u = su % urllib.parse.quote_plus(q)
            try:
                html = _lyf_get(u, 15)
            except Exception:
                continue
            links = re.findall(r'href="(/lyric/[^"#?]+)"', html)
            seen = []
            for ln in links:
                if ln not in seen: seen.append(ln)
            scored = []
            for ln in seen[:20]:
                slug = _gen_norm(ln.replace("/lyric/", "").rsplit("/", 1)[0].replace("-", " "))
                sc = 0
                for w in set(want.split()):
                    if w and w in slug.split(): sc += 1
                if _gen_norm(song) and _gen_norm(song) in slug: sc += 2
                scored.append((sc, ln))
            scored.sort(reverse=True)
            for sc, ln in scored[:3]:
                if sc <= 0: break
                try:
                    got = _lyf_page_lyrics("https://www.lyricsify.com" + ln)
                except Exception:
                    continue
                if got and len(got["lyrics"]) >= 40:
                    best = {"ok": True, "lyrics": got["lyrics"], "lrc": got.get("lrc") or [],
                            "url": got["url"], "source": "lyricsify"}
                    break
            if best: break
        if best: break
    out = best or {"ok": True, "lyrics": "", "lrc": [], "source": "lyricsify"}
    if best:
        if len(_LYR2) > 200: _LYR2.pop(next(iter(_LYR2)))
        _LYR2[ck] = (time.time(), out)
    return out

def r_mxm(b):
    """Musixmatch: /lyrics/<artist>/<song> və -1/-2 variantlarını ardıcıl yoxlayır.

    Slug həm diakritiklərlə (kanonik: .../Qara-Derviş/Yorğun), həm də
    transliterasiya ilə sınanır; keçici 403/429/5xx-də bir dəfə təkrar sorğu
    göndərilir ki, sözlər səhvən "tapılmadı" sayılmasın."""
    artist = str(b.get("artist") or "").strip()
    song = str(b.get("song") or "").strip()
    if not song: raise RuntimeError("Mahnı adı boşdur")
    ck = ("mxm", _gen_norm(artist), _gen_norm(song))
    hit = _LYR2.get(ck)
    if hit and time.time() - hit[0] < 3600: return hit[1]
    if not _mxm_slug(song): raise RuntimeError("Slug boşdur")
    hdr = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.musixmatch.com/",
        "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document", "Sec-Fetch-User": "?1", "Upgrade-Insecure-Requests": "1",
    }
    api_urls = _mxm_search_urls(artist, song)   # API axtarışı (açar varsa) + imzasız endpoint
    ka, ks = _mxm_slug_keep(artist), _mxm_slug_keep(song)
    ma, ms = _mxm_slug_mixed(artist), _mxm_slug_mixed(song)
    ta, ts = _mxm_slug(artist), _mxm_slug(song)
    pairs, cands = [], list(api_urls)
    for a2, s2 in ((ma, ms), (ka, ks), (ka, ts), (ta, ks), (ta, ts)):
        if a2 and s2 and (a2, s2) not in pairs:
            pairs.append((a2, s2))
    # -1/-2 yalnız ehtimal olunan iki slug üçün (sorğu sayını azaltmaq üçün).
    suf_pairs = pairs[:1] + pairs[-1:] if len(pairs) > 1 else pairs[:1]
    for a2, s2 in pairs:
        u = "https://www.musixmatch.com/lyrics/%s/%s" % (
            urllib.parse.quote(a2), urllib.parse.quote(s2))
        if u not in cands:
            cands.append(u)
    for a2, s2 in suf_pairs:
        for suf in ("-1", "-2"):
            u = "https://www.musixmatch.com/lyrics/%s%s/%s" % (
                urllib.parse.quote(a2), suf, urllib.parse.quote(s2))
            if u not in cands:
                cands.append(u)
    for u in cands:
        html = None
        for attempt in (0, 1):
            try:
                req = urllib.request.Request(u, headers=hdr)
                with urllib.request.urlopen(req, timeout=20) as r:
                    if r.status != 200:
                        retry = r.status in (403, 429) or r.status >= 500
                        if retry and attempt == 0:
                            time.sleep(1.2)
                            continue
                        break
                    html = r.read(1_200_000).decode("utf-8", "replace")
                break
            except urllib.error.HTTPError as e:
                # 404/410 = belə səhifə yoxdur → təkrar cəhd mənasızdır.
                if (e.code in (403, 429) or e.code >= 500) and attempt == 0:
                    time.sleep(1.2)
                    continue
                break
            except Exception:
                if attempt == 0:
                    time.sleep(1.0)
                    continue
                break
        if not html:
            continue
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)</script>', html)
        if not m: continue
        try: j = json.loads(m.group(1))
        except Exception: continue
        pp = ((j.get("props") or {}).get("pageProps") or {})
        body = (((pp.get("trackInfo") or {}).get("data") or {}).get("lyrics") or {}).get("body") or \
               ((((pp.get("data") or {}).get("trackInfo") or {}).get("data") or {}).get("lyrics") or {}).get("body") or ""
        body = str(body).strip()
        if len(body) >= 40:
            out = {"ok": True, "lyrics": body[:24000], "url": u, "source": "musixmatch"}
            if len(_LYR2) > 200: _LYR2.pop(next(iter(_LYR2)))
            _LYR2[ck] = (time.time(), out)
            return out
    return {"ok": True, "lyrics": "", "source": "musixmatch"}

_MPV_STYLES = {"default", "cinematic", "minimalist", "neon"}

def r_mpvstyle(b):
    """Seçilmiş alt yazı stilini və görünüşünü MPV-yə ötürür (əsas mənbə: subtitle-settings.json)."""
    style = str(b.get("style") or "default").strip().lower()
    if style not in _MPV_STYLES:
        raise RuntimeError("Naməlum MPV alt yazı stili")
    ap = sub_appearance({"subAppearance": b.get("appearance") or b.get("subAppearance")})
    save_subtitle_settings({**ap, "visualStyle": style})
    mpv = Path.home() / ".config" / "mpv"
    mpv.mkdir(parents=True, exist_ok=True)
    # Köhnə Lua/versiyalarla uyğunluq üçün sadə fayl da yazılır.
    (mpv / "jdm-substyle").write_text("\n".join([
        "style=" + style, "size=%d" % int(ap.get("size") or 16),
        "bold=%d" % (1 if ap.get("bold") else 0), "italic=%d" % (1 if ap.get("italic") else 0),
        "underline=%d" % (1 if ap.get("underline") else 0), "bg=%d" % int(ap.get("bg") or 0),
    ]) + "\n", encoding="utf-8")
    _deploy_mpv_lua()
    return {"ok": True, "style": style, "appearance": ap}

def r_history(b):
    """Yükləmə tarixçəsini helper-də saxlayır (extension ID dəyişəndə köçürmə üçün)."""
    path = CONF / "history.json"
    if b and isinstance(b.get("items"), list):
        items = [x for x in b["items"] if isinstance(x, dict)][:20]
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, path)
        except Exception:
            pass
        return {"ok": True, "items": items}
    try:
        items = json.loads(path.read_text(encoding="utf-8") or "[]")
    except Exception:
        items = []
    return {"ok": True, "items": items if isinstance(items, list) else []}

ROUTES = {("GET", "/ping"): r_ping, ("GET", "/health"): r_health, ("GET", "/list"): r_list, ("GET", "/subtitle-settings"): r_subtitle_settings, ("POST", "/subtitle-settings"): r_subtitle_settings, ("GET", "/history"): r_history, ("POST", "/history"): r_history, ("POST", "/add"): r_add,
          ("POST", "/formats"): r_formats, ("POST", "/meta"): r_meta, ("POST", "/name"): r_name, ("POST", "/duration"): r_duration, ("POST", "/pickdir"): r_pickdir, ("POST", "/share"): r_share, ("POST", "/saveas"): r_saveas, ("POST", "/gif"): r_gif, ("POST", "/cut"): r_cutctx, ("POST", "/reveal"): r_reveal, ("POST", "/openfile"): r_openfile, ("POST", "/sicut"): r_sicut, ("POST", "/aiexport"): r_aiexport, ("POST", "/hlsmeta"): r_hlsmeta, ("POST", "/ytdlp"): r_ytdlp, ("POST", "/action"): r_action, ("POST", "/upload/start"): upload_start, ("POST", "/upload/end"): upload_end, ("POST", "/upload/abort"): upload_abort, ("POST", "/manifest"): r_manifest, ("POST", "/subinfo"): r_subinfo, ("POST", "/aisub"): r_aisub, ("POST", "/aisub/file"): r_aisub_file, ("POST", "/aisub/delete"): r_aisub_delete, ("POST", "/songalign"): r_songalign, ("POST", "/lyrics"): r_lyrics, ("POST", "/mxm"): r_mxm, ("POST", "/lyricsify"): r_lyricsify, ("POST", "/genius"): r_genius, ("POST", "/audio"): r_songaudio, ("POST", "/mpvstyle"): r_mpvstyle}

# ---- FastHLS: YALNIZ playmix.uno HLS axınları (IDM_FH_HOSTS ilə dəyişir, IDM_FH=0 ilə söndürülür). Digər saytlara toxunmur.
# yt-dlp bu axını birbaşa serverdən yox, helper-in yerli proxisindən (127.0.0.1) alır. Proxi parçaları öncədən, daimi (keep-alive) bağlantılarla,
# avtomatik artan paralellik və "ilişən parçanı ikinci sorğu ilə qabaqlama" (hedging) ilə yükləyib diskdə saxlayır. Bütün yt-dlp məntiqi (format, split, birləşdirmə, faiz) olduğu kimi qalır.
import http.client, hashlib
FH_ON = os.environ.get("IDM_FH", "1") == "1"   # playmix: daimi (keep-alive) bağlantılar; CDN yeni TCP bağlantılarını bloklayır
FH_RE = re.compile(os.environ.get("IDM_FH_HOSTS", r"(?:^|\.)playmix\.uno$"), re.I)
FH_PATH = re.compile(r"\.m3u8?$|\.txt$|sublist|/hls/", re.I)
FH_W0, FH_WMAX, FH_LOOK, FH_BYTES = 2, 16, 64, 256_000_000   # sublist/seqment axını: 16 daimi bağlantı (MAX səviyyəli paralellik)
FH_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FH_LOG = os.path.expanduser("~/jdm/fasthls.log")
FH_S, FH_L, FH_NOTE = {}, threading.Lock(), {}
_fh_tl = threading.local()

def fh_local_text(url):
    """Helper-in yerli manifesti (http://127.0.0.1:PORT/m/<token>) varsa mətnini qaytar."""
    try:
        p = urllib.parse.urlsplit(url or "")
        if p.hostname not in ("127.0.0.1", "localhost") or not p.path.startswith("/m/"): return ""
        name = p.path[3:].split("?")[0]
        with MLOCK: ent = MANIFESTS.get(name)
        return ent[2].decode("utf-8", "replace") if ent else ""
    except Exception: return ""

def fh_host_in(text, seen=None, depth=0):
    """Mətndə (və yerli /m/ manifestlərinin içində) playmix host-u axtarır."""
    if depth > 4: return ""
    seen = set() if seen is None else seen
    for m in re.finditer(r"https?://[^\s\"'<>]+", (text or "")[:300_000]):
        u = m.group(0)
        try: q = urllib.parse.urlsplit(u)
        except ValueError: continue
        if q.hostname and FH_RE.search(q.hostname): return q.hostname   # manifest içində seqmentlər .jpg/.ts də ola bilər
        if q.hostname in ("127.0.0.1", "localhost") and (q.path or "").startswith("/m/"):
            key = q.path[3:].split("?")[0]
            if key in seen: continue
            seen.add(key)
            h = fh_host_in(fh_local_text(u), seen, depth + 1)
            if h: return h
    return ""

def fh_target(url):
    """Axın playmix-dirsə host-u qaytarır. Extension playlist-i yerli snapshot-a çevirdiyi üçün
    yerli manifestin İÇİNDƏKİ (və onun variantlarının içindəki) seqment URL-lərinə də baxılır."""
    if not FH_ON: return ""
    try: p = urllib.parse.urlsplit(url or "")
    except ValueError: return ""
    if (p.hostname and FH_RE.search(p.hostname) and FH_PATH.search(p.path or "")
            and not re.search(r"\.(?:jpe?g|png|ts|m4s|mp4|aac|m4a|key|bin)$", p.path or "", re.I)):
        return p.hostname   # birbaşa seqment/fayl URL-i playlist kimi proksilənməsin
    return fh_host_in(fh_local_text(url))

def fh_match(url):
    return bool(fh_target(url))

def fh_log(msg):
    try:
        os.makedirs(os.path.dirname(FH_LOG), exist_ok=True)
        if os.path.exists(FH_LOG) and os.path.getsize(FH_LOG) > 1_000_000: os.replace(FH_LOG, FH_LOG + ".1")
        with open(FH_LOG, "a", encoding="utf-8") as f: f.write(time.strftime("%H:%M:%S ") + msg + "\n")
    except Exception: pass

def fh_get(se, url, rng=None, method="GET", timeout=20):
    """(status, başlıqlar, bədən): bu axın (thread) üçün daimi bağlantı; köhnəlmiş bağlantıda təzəsi ilə təkrar."""
    for _ in range(3):
        p = urllib.parse.urlsplit(url); key = (p.scheme, p.netloc)
        pool = getattr(_fh_tl, "c", None)
        if pool is None: pool = _fh_tl.c = {}
        c = pool.get(key); fresh = c is None
        if fresh:
            c = (http.client.HTTPSConnection if p.scheme == "https" else http.client.HTTPConnection)(p.netloc, timeout=timeout); pool[key] = c
        h = {"User-Agent": FH_UA, "Accept": "*/*", "Accept-Encoding": "identity", **se.hdr}
        if rng: h["Range"] = rng
        try:
            c.request(method, (p.path or "/") + ("?" + p.query if p.query else ""), headers=h)
            r = c.getresponse(); body = r.read()
        except Exception:
            try: c.close()
            except Exception: pass
            pool.pop(key, None)
            if fresh: raise
            continue
        if r.status in (301, 302, 303, 307, 308) and r.getheader("Location"):
            url = urllib.parse.urljoin(url, r.getheader("Location")); continue
        if (r.getheader("Connection") or "").lower() == "close": c.close(); pool.pop(key, None)
        return r.status, {k.lower(): v for k, v in r.getheaders()}, body
    raise RuntimeError("yönləndirmə dövrü")

class FHSess:
    def __init__(s, sid, hdr):
        s.sid, s.hdr, s.tbl, s.ix, s.pl, s.segs, s.segpl, s.jobs, s.nopf, s.t = sid, hdr, [], {}, {}, {}, {}, {}, set(), time.time()
        s.lk = threading.Lock()
    def reg(s, u):
        with s.lk:
            i = s.ix.get(u)
            if i is None: i = s.ix[u] = len(s.tbl); s.tbl.append(u)
            return i

def fh_wrap(b, mode, url, nonce=""):
    """Uyğun axın üçün yerli proxi ünvanı (mode: p = yoxlama, d = yükləmə); uyğun deyilsə ünvan olduğu kimi qalır."""
    if not fh_match(url): return url
    hdr = {}
    if b.get("userAgent"): hdr["User-Agent"] = str(b["userAgent"])
    if b.get("referer"):
        hdr["Referer"] = str(b["referer"])
        pr = urllib.parse.urlparse(hdr["Referer"])
        if pr.scheme in ("http", "https") and pr.netloc: hdr["Origin"] = f"{pr.scheme}://{pr.netloc}"
    host = fh_target(url) or (urllib.parse.urlparse(url).hostname or "")
    # playmix sublist hostu yalnız öz Origin/Referer-i ilə cavab verir; sayt referer-i 404 verir.
    if host and FH_RE.search(host):
        ref = str(b.get("referer") or "")
        if not FH_RE.search(ref):
            hdr["Referer"] = f"https://{host}/"
            hdr["Origin"] = f"https://{host}"
    ck = "; ".join(f"{c['name']}={c['value']}" for c in (b.get("cookies") or [])
                   if c.get("name") and host.endswith((c.get("domain") or "\0").lstrip(".")) and not any(ch in c["name"] + c["value"] for ch in "\r\n"))
    if ck: hdr["Cookie"] = ck
    sid = hashlib.sha1(json.dumps([url, hdr, mode, str(nonce)], sort_keys=True).encode()).hexdigest()[:16]
    with FH_L:
        now = time.time()
        for k in [k for k, v in FH_S.items() if now - v.t > 21600]: FH_S.pop(k, None)
        se = FH_S.get(sid) or FH_S.setdefault(sid, FHSess(sid, hdr)); se.t = now
    se.reg(url)
    return f"http://127.0.0.1:{PORT}/fh/{mode}/{sid}/0.m3u8"

def fh_rewrite(se, mode, plidx, base, text):
    lines, segs, out, nxt = text.splitlines(), [], [], False
    px = lambda u, k: f"http://127.0.0.1:{PORT}/fh/{mode}/{se.sid}/{se.reg(urllib.parse.urljoin(base, u.strip()))}.{k}"
    br = "#EXT-X-BYTERANGE" in text
    for ln in lines:
        t = ln.strip()
        if not t: out.append(ln); continue
        if t.startswith("#"):
            if t.startswith(("#EXT-X-MEDIA:", "#EXT-X-I-FRAME-STREAM-INF:")): k = "m3u8"
            else: k = "bin"
            if 'URI="' in t and t.startswith(("#EXT-X-KEY", "#EXT-X-SESSION-KEY", "#EXT-X-MAP", "#EXT-X-MEDIA:", "#EXT-X-I-FRAME-STREAM-INF:")):
                ln = re.sub(r'URI="([^"]*)"', lambda m: f'URI="{px(m.group(1), k)}"' if m.group(1) else m.group(0), ln)
            nxt = nxt or t.startswith("#EXT-X-STREAM-INF")
            out.append(ln); continue
        if nxt: out.append(px(t, "m3u8")); nxt = False
        else:
            u = px(t, "ts"); segs.append(se.ix[urllib.parse.urljoin(base, t)]); out.append(u)
    if segs:
        dur = sum(float(m) for m in re.findall(r"#EXTINF:([\d.]+)", text))
        vod = "#EXT-X-ENDLIST" in text or "PLAYLIST-TYPE:VOD" in text or dur > 1200
        with se.lk:
            se.segs[plidx] = segs
            for pos, i in enumerate(segs): se.segpl[i] = (plidx, pos)
            if br or not vod: se.nopf.add(plidx)
            else: se.nopf.discard(plidx)
        if mode == "d": fh_log(f"playlist {plidx}: {len(segs)} parça, {dur/60:.0f} dəq, öncədən yükləmə={'bəli' if plidx not in se.nopf else 'xeyr (byterange/canlı)'}")
    return ("\n".join(out) + "\n").encode()

class FHJob:
    def __init__(s, se, plidx, p0, look=FH_LOOK):
        s.se, s.pl, s.segs = se, plidx, se.segs[plidx]; s.n = len(s.segs); s.look = look
        s.maxc = 1 if look <= 1 else FH_WMAX   # yoxlama (p): hər playlist üçün 1 daimi bağlantı
        s.idle = 20 if look <= 1 else 90
        s.cv = threading.Condition()
        s.res, s.fail, s.infl, s.st, s.need, s.hedge, s.srv, s.ec = {}, {}, {}, {}, set(), set(), set(), {}
        s.next = s.hi = p0; s.bytes = s.dl = s.errs = s.hedges = 0; s.alive = 0; s.target = FH_W0; s.stop = False
        s.last = time.time(); s.lat = []; s.dir = tempfile.mkdtemp(prefix="idmfh-")
        with s.cv:
            for _ in range(FH_W0): s._spawn()
        threading.Thread(target=s.mon, daemon=True).start()

    def _spawn(s):
        s.alive += 1; threading.Thread(target=s.work, daemon=True).start()

    def _pick(s):
        for p in sorted(s.need):
            if p not in s.res and s.infl.get(p, 0) == 0: return p
        for p in list(s.hedge):
            s.hedge.discard(p)
            if p not in s.res and s.infl.get(p, 0) == 1: s.hedges += 1; return p
        while s.next < s.n and (s.next in s.res or s.next in s.infl): s.next += 1
        if s.next < s.n and s.next < s.hi + s.look and s.bytes < FH_BYTES:
            p = s.next; s.next += 1; return p
        return None

    def work(s):
        gone = False
        try:
            while True:
                with s.cv:
                    pos = None
                    while pos is None:
                        if s.stop: return
                        if s.alive > s.target: s.alive -= 1; gone = True; return
                        pos = s._pick()
                        if pos is None: s.cv.wait(0.5)
                    s.infl[pos] = s.infl.get(pos, 0) + 1; s.st.setdefault(pos, time.time())
                try: s.fetch(pos)
                finally:
                    with s.cv:
                        s.infl[pos] -= 1
                        if s.infl[pos] <= 0: s.infl.pop(pos, None); s.st.pop(pos, None)
                        s.cv.notify_all()
        finally:
            if not gone:
                with s.cv: s.alive -= 1

    def fetch(s, pos):
        url, t0, err = s.se.tbl[s.segs[pos]], time.time(), "?"
        for k in range(4):
            with s.cv:
                if s.stop or pos in s.res: return
            try:
                st, hd, body = fh_get(s.se, url)
                if st == 200 and body:
                    path = os.path.join(s.dir, f"{pos}.{threading.get_ident()}")
                    with open(path, "wb") as f: f.write(body)
                    with s.cv:
                        if pos in s.res or s.stop: rm(path)
                        else: s.res[pos] = (path, len(body), hd.get("content-type") or "video/mp2t"); s.bytes += len(body); s.dl += len(body); s.lat.append(time.time() - t0)
                        s.cv.notify_all()
                    return
                err = str(st)
            except Exception as e: err = type(e).__name__
            with s.cv: s.errs += 1; s.ec[err] = s.ec.get(err, 0) + 1
            time.sleep(min(2.0, 0.25 * 2 ** k))
        with s.cv: s.fail[pos] = err; s.cv.notify_all()

    def get(s, pos):
        t_end = time.time() + 90
        with s.cv:
            s.last = time.time(); s.hi = max(s.hi, pos); s.need.add(pos); s.cv.notify_all()
            while pos not in s.res and pos not in s.fail and time.time() < t_end and not s.stop: s.cv.wait(1.0)
            s.need.discard(pos); ent = s.res.pop(pos, None); s.fail.pop(pos, None)
            if ent: s.bytes -= ent[1]; s.srv.add(pos); s.hi = max(s.hi, pos + 1)
            s.cv.notify_all()
        if not ent: return None
        try:
            with open(ent[0], "rb") as f: data = f.read()
        except OSError: return None
        rm(ent[0]); return data, ent[2]

    def mon(s):
        last, ref, settled, w = 0, 0.0, False, 0
        try:
            while True:
                time.sleep(2.5); now = time.time(); w += 1
                with s.cv:
                    if s.stop: return
                    if now - s.last > s.idle or len(s.srv) >= s.n: return
                    rate = (s.dl - last) / 2.5; last = s.dl
                    lat = sorted(s.lat[-60:]); med = lat[len(lat) // 2] if lat else 0.0
                    for p, t in s.st.items():   # ilişən parça: ikinci sorğu ilə qabaqla
                        if s.infl.get(p) == 1 and p not in s.res and now - t > max(4.0, 3 * med): s.hedge.add(p)
                    room = s.next < s.hi + s.look and s.bytes < FH_BYTES and s.next < s.n
                    if s.errs > 12 and s.errs > 0.25 * (len(s.lat) + s.errs): s.target = max(1, int(s.target * 0.75)); s.errs = 0; settled = True
                    elif room and not settled and s.target < s.maxc and rate > 0:
                        if ref and rate < ref * 1.05: settled = True
                        else: ref = rate; s.target = min(s.maxc, s.target + 8)
                    elif settled and ref and rate < ref * 0.6 and room: settled, ref = False, rate
                    while s.alive < s.target: s._spawn()
                    FH_NOTE[urllib.parse.urlparse(s.se.tbl[0]).hostname or ""] = f"FastHLS: {rate/1e6:.1f} MB/s · {s.alive} axın · gecikmə {med:.1f}s · xəta {sum(s.ec.values())}"
                    if w % 2 == 0: fh_log(f"pl{s.pl} {len(s.srv)}/{s.n} {rate/1e6:.2f}MB/s axın={s.alive} gecikmə={med:.2f}s ikinci_sorğu={s.hedges} xəta={s.ec}")
        finally:
            with s.cv: s.stop = True; s.cv.notify_all()
            shutil.rmtree(s.dir, ignore_errors=True)

def fh_job(se, plidx, pos, look=FH_LOOK):
    with FH_L:
        if plidx in se.nopf or plidx not in se.segs: return None
        j = se.jobs.get(plidx)
        if not j or j.stop: j = se.jobs[plidx] = FHJob(se, plidx, pos, look)
        return j

def fh_range(data, rng):
    """bytes=0-0 / bytes=100- / bytes=-500 -> (start, end, slice); uyğunsuzsa None."""
    m = re.match(r"^bytes=(\d*)-(\d*)$", (rng or "").strip())
    if not m: return None
    a, b = m.group(1), m.group(2)
    try:
        if a == "":
            n = int(b); start = max(0, len(data) - n); end = len(data) - 1
        else:
            start = int(a); end = min(int(b), len(data) - 1) if b else len(data) - 1
    except ValueError: return None
    if start > end or start >= len(data): return None
    return start, end, data[start:end + 1]

def fh_serve(h, method):
    m = re.match(r"^/fh/([pd])/([0-9a-f]{16})/(\d+)\.(\w+)", h.path)
    host = (h.headers.get("Host") or "").split(":")[0]
    se = FH_S.get(m.group(2)) if m and host in ("127.0.0.1", "localhost") else None
    idx = int(m.group(3)) if m else -1
    if not se or idx >= len(se.tbl):
        h.send_response(404); h.send_header("Content-Length", "0"); h.end_headers(); return
    mode, kind, url = m.group(1), m.group(4), se.tbl[idx]
    def send(code, ctype, body, extra=None, blen=None):
        try:
            h.send_response(code); h.send_header("Content-Type", ctype); h.send_header("Content-Length", str(len(body) if blen is None else blen))
            for k, v in (extra or {}).items(): h.send_header(k, v)
            h.end_headers()
            if method != "HEAD": h.wfile.write(body)
        except OSError: pass
    try:
        if kind == "m3u8":
            body = se.pl.get(idx)
            if body is None:
                txt = fh_local_text(url)
                if txt:
                    body = fh_rewrite(se, mode, idx, url, txt)
                else:
                    for k in range(3):
                        st, hd, raw = fh_get(se, url)
                        if st == 200: break
                        time.sleep(0.5)
                    if st != 200: return send(st if st >= 400 else 502, "text/plain", b"")
                    txt = raw.decode("utf-8", "replace").lstrip("\ufeff")
                    if not txt.lstrip().startswith("#EXTM3U"): return send(200, hd.get("content-type") or "text/plain", raw)
                    body = fh_rewrite(se, mode, idx, url, txt)
                if idx not in se.nopf: se.pl[idx] = body
            return send(200, "application/vnd.apple.mpegurl", body)
        rng = h.headers.get("Range")
        if method == "GET" and idx in se.segpl:   # həm yoxlama (p), həm yükləmə (d): CDN bağlantısı daimi/proksidən
            pl, pos = se.segpl[idx]; job = fh_job(se, pl, pos, FH_LOOK if mode == "d" else 1)
            r = job.get(pos) if job else None
            if r:
                data, ctype = r
                if rng:
                    sl = fh_range(data, rng)
                    if sl:
                        a, b, part = sl
                        return send(206, ctype, part, {"Content-Range": f"bytes {a}-{b}/{len(data)}", "Accept-Ranges": "bytes"})
                else: return send(200, ctype, data)
            if mode == "d": return send(502, "text/plain", b"")   # parça alınmadı: yt-dlp dərhal xəta alıb yenidən davam etsin
        for k in range(3):
            st, hd, raw = fh_get(se, url, rng, "HEAD" if method == "HEAD" else "GET")
            if st < 500: break
            time.sleep(0.4)
        ex = {k: hd[k] for k in ("content-range", "accept-ranges") if k in hd}
        send(st, hd.get("content-type") or "application/octet-stream", raw, ex, int(hd.get("content-length") or len(raw)) if method == "HEAD" else None)
    except Exception:
        send(502, "text/plain", b"")
# ---- /FastHLS

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def _allowed(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        origin = self.headers.get("Origin")
        return host in ("127.0.0.1", "localhost") and (not origin or origin.startswith(("chrome-extension://", "moz-extension://")))

    def _send(self, code, obj=None):
        b = json.dumps(obj).encode() if obj is not None else b""
        self.send_response(code)
        if obj is not None: self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        o = self.headers.get("Origin")
        if o:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        if b: self.wfile.write(b)

    def do_OPTIONS(self): self._send(204 if self._allowed() else 403)

    def _serve_manifest(self, head=False):
        # yt-dlp sorğularında Origin başlığı saytın ünvanı ola bilər: burada yalnız Host yoxlanır, giriş açarı ünvandakı təsadüfi id-dir
        host = (self.headers.get("Host") or "").split(":")[0]
        with MLOCK: ent = MANIFESTS.get(self.path[3:].split("?")[0]) if host in ("127.0.0.1", "localhost") else None
        if not ent:
            self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", ent[1]); self.send_header("Content-Length", str(len(ent[2])))
        self.end_headers()
        if not head: self.wfile.write(ent[2])

    def _handle(self, method):
        if method == "GET" and self.path.startswith("/m/"): return self._serve_manifest()
        if method == "GET" and self.path.startswith("/fh/"): return fh_serve(self, "GET")
        if not self._allowed(): return self._send(403, {"ok": False, "error": "forbidden"})
        if method == "POST" and self.path.startswith("/upload/chunk"):
            try:
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                n = int(self.headers.get("Content-Length") or 0)
                if n < 0 or n > 32 * 1024 * 1024: raise RuntimeError("chunk ölçüsü yanlışdır")
                data = self.rfile.read(n)
                res = upload_chunk((q.get("id") or [""])[0], int((q.get("offset") or ["0"])[0] or 0), data)
                return self._send(200, res)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
        fn = ROUTES.get((method, self.path.split("?")[0]))
        if not fn: return self._send(404, {"ok": False, "error": "not found"})
        try:
            body = {}
            if method == "POST":
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            self._send(200, fn(body))
        except Exception as e:
            self._send(500, {"ok": False, "error": str(e)})

    def do_GET(self): self._handle("GET")
    def do_HEAD(self):
        if self.path.startswith("/m/"): return self._serve_manifest(head=True)
        if self.path.startswith("/fh/"): return fh_serve(self, "HEAD")
        self.send_response(405); self.send_header("Content-Length", "0"); self.end_headers()
    def do_POST(self): self._handle("POST")

def _aes128_cbc_decrypt(key_hex, iv_hex, data):
    """HLS AES-128-CBC şifrəsini açır. Linux-da `openssl`, Windows-da isə (openssl olmadığı üçün)
    saf Python AES ilə. Yalnız bu nadir yol üçün istifadə olunur."""
    key = bytes.fromhex(key_hex); iv = bytes.fromhex(iv_hex)
    if not IS_WIN:
        try:
            import subprocess as _sp
            r = _sp.run(["openssl", "aes-128-cbc", "-d", "-K", key_hex, "-iv", iv_hex],
                        input=data, capture_output=True, timeout=60)
            if r.returncode == 0 and r.stdout: return r.stdout
        except Exception:
            pass
    return _aes128_cbc_decrypt_py(key, iv, data)

def _aes128_cbc_decrypt_py(key, iv, data):
    # Minimal AES-128 (yalnız decrypt) — xarici asılılıq olmadan. State s[r][c] (sətir, sütun).
    sbox = [
        0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
        0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
        0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
        0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
        0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
        0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
        0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
        0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
        0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
        0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
        0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
        0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
        0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
        0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
        0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
        0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16]
    inv = [0]*256
    for i, v in enumerate(sbox): inv[v] = i
    rcon = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36]
    def xtime(a): return ((a << 1) ^ 0x1b) & 0xff if (a & 0x80) else (a << 1)
    def mul(a, b):
        r = 0
        while b:
            if b & 1: r ^= a
            a = xtime(a); b >>= 1
        return r & 0xff
    # Açar genişlənməsi: w[i] = 4 baytlıq söz (sütun kimi)
    w = [list(key[i*4:i*4+4]) for i in range(4)]
    for i in range(4, 44):
        t = list(w[i-1])
        if i % 4 == 0:
            t = [sbox[x] for x in (t[1:] + t[:1])]
            t[0] ^= rcon[i//4 - 1]
        w.append([w[i-4][j] ^ t[j] for j in range(4)])
    def add_rk(s, rnd):
        for c in range(4):
            for row in range(4): s[row][c] ^= w[rnd*4+c][row]
    def inv_shift_rows(s):
        for row in range(1, 4): s[row] = s[row][-row:] + s[row][:-row]
    def inv_sub_bytes(s):
        for row in range(4):
            for c in range(4): s[row][c] = inv[s[row][c]]
    def inv_mix_columns(s):
        for c in range(4):
            a = [s[row][c] for row in range(4)]
            s[0][c] = mul(a[0],14) ^ mul(a[1],11) ^ mul(a[2],13) ^ mul(a[3],9)
            s[1][c] = mul(a[0],9) ^ mul(a[1],14) ^ mul(a[2],11) ^ mul(a[3],13)
            s[2][c] = mul(a[0],13) ^ mul(a[1],9) ^ mul(a[2],14) ^ mul(a[3],11)
            s[3][c] = mul(a[0],11) ^ mul(a[1],13) ^ mul(a[2],9) ^ mul(a[3],14)
    out = bytearray(); prev = iv
    for off in range(0, len(data) - (len(data) % 16), 16):
        blk = data[off:off+16]
        s = [[blk[row + 4*c] for c in range(4)] for row in range(4)]
        add_rk(s, 10)
        for rnd in range(9, 0, -1):
            inv_shift_rows(s); inv_sub_bytes(s); add_rk(s, rnd); inv_mix_columns(s)
        inv_shift_rows(s); inv_sub_bytes(s); add_rk(s, 0)
        plain = bytes(s[row][c] for c in range(4) for row in range(4))
        out += bytes(plain[i] ^ prev[i] for i in range(16))
        prev = blk
    return bytes(out)


def _doctor():
    """Windows quraşdırmasını yoxlayır. `idm-helper.exe --doctor`."""
    import socket
    ok = True
    def line(name, good, detail=""):
        nonlocal ok
        if not good: ok = False
        print(("  [OK]  " if good else "  [X]   ") + name + (("  - " + detail) if detail else ""))
    print("JDM Helper --doctor")
    print("  platform :", "windows" if IS_WIN else "linux")
    print("  python   :", sys.version.split()[0])
    print("  exe      :", sys.executable)
    print("  app dir  :", str(APP_DIR) if APP_DIR is not None else "(linux)")
    print("  download :", str(DL_DIR))
    print("  config   :", str(CONF))
    for tool in ("aria2c", "yt-dlp", "ffmpeg", "ffprobe"):
        p = shutil.which(tool)
        line(tool, bool(p), p or "tapılmadı (bin/ qovluğunda olmalıdır)")
    js = shutil.which("deno") or shutil.which("node")
    line("deno/node", bool(js), js or "YouTube keyfiyyətləri üçün lazımdır")
    try:
        DL_DIR.mkdir(parents=True, exist_ok=True)
        test = DL_DIR / ".jdm-write-test"
        test.write_text("ok", encoding="utf-8"); test.unlink()
        line("download dir yazıla bilir", True)
    except Exception as e:
        line("download dir yazıla bilir", False, str(e))
    try:
        CONF.mkdir(parents=True, exist_ok=True)
        line("config dir yazıla bilir", True)
    except Exception as e:
        line("config dir yazıla bilir", False, str(e))
    try:
        s = socket.socket(); s.settimeout(0.5)
        free = s.connect_ex(("127.0.0.1", PORT)) != 0
        s.close()
        line("port %d boşdur" % PORT, free, "" if free else "artıq istifadə olunur (helper artıq işləyir?)")
    except Exception as e:
        line("port %d" % PORT, False, str(e))
    line("song align (MMS/CTC)", (not IS_WIN), "Windows-da dəstəklənmir" if IS_WIN else "")
    print("Nəticə:", "HAMISI YAXŞI" if ok else "BƏZİ YOXLAMALAR UĞURSUZ")
    return 0 if ok else 1


def main():
    if "--version" in sys.argv:
        print("JDM Helper 1.0.0"); return
    if "--doctor" in sys.argv:
        sys.exit(_doctor())
    # --hidden: installer Run açarı üçün; pəncərəsiz exe-də heç bir təsiri yoxdur (uyğunluq üçün qəbul edilir).
    DL_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=lambda: ensure_aria(), daemon=True).start()
    threading.Thread(target=ytdlp_caps, daemon=True).start()  # yt-dlp/JS runtime imkanlarını əvvəlcədən yoxla
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    srv.daemon_threads = True
    print(f"JDM helper: http://127.0.0.1:{PORT}  ->  {DL_DIR}", flush=True)
    srv.serve_forever()

if __name__ == "__main__":
    main()
