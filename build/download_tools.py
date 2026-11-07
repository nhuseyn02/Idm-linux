#!/usr/bin/env python3
"""Download + verify the Windows tools listed in tools.json into bin/.

Run by CI (windows-latest) before PyInstaller. Refuses to continue if any
sha256 is the placeholder 'REPLACE_ME' (so an unverified release cannot ship).

Usage:
    python build/download_tools.py            # honour tools.json
    python build/download_tools.py --allow-unpinned   # dev only: skip hash check
"""
import argparse, hashlib, json, os, sys, urllib.request, zipfile, io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "bin"
TOOLS = ROOT / "build" / "tools.json"
UA = {"User-Agent": "jdm-windows-build"}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def pick_member(zf, pattern):
    names = zf.namelist()
    if not pattern:
        return None
    import fnmatch
    for n in names:
        if fnmatch.fnmatch(n, pattern):
            return n
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow-unpinned", action="store_true",
                    help="dev only: do not fail when sha256 is REPLACE_ME")
    args = ap.parse_args()

    BIN.mkdir(parents=True, exist_ok=True)
    spec = json.loads(TOOLS.read_text(encoding="utf-8"))
    failures = []

    for name, t in spec.get("tools", {}).items():
        dest = BIN / t["file"]
        want = str(t.get("sha256") or "").strip().lower()
        if want in ("", "replace_me") and not args.allow_unpinned:
            failures.append(f"{name}: sha256 not pinned (fill tools.json)")
            continue
        print(f"[*] {name} <- {t['url']}")
        try:
            data = fetch(t["url"])
        except Exception as e:
            failures.append(f"{name}: download failed: {e}")
            continue
        if t.get("archive") == "zip":
            try:
                zf = zipfile.ZipFile(io.BytesIO(data))
                member = pick_member(zf, t.get("member") or "")
                if not member:
                    failures.append(f"{name}: member '{t.get('member')}' not found in archive")
                    continue
                dest.write_bytes(zf.read(member))
            except Exception as e:
                failures.append(f"{name}: unzip failed: {e}")
                continue
        else:
            dest.write_bytes(data)
        got = sha256_file(dest)
        if want and want not in ("replace_me",):
            if got != want:
                failures.append(f"{name}: sha256 mismatch\n    expected {want}\n    got      {got}")
                continue
        print(f"    ok -> {dest.name}  sha256={got}")

    if failures:
        print("\nBUILD FAILED — tool verification problems:", file=sys.stderr)
        for f in failures:
            print("  - " + f, file=sys.stderr)
        sys.exit(1)
    print("\nAll tools downloaded and verified.")


if __name__ == "__main__":
    main()
