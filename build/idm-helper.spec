# -*- mode: python ; coding: utf-8 -*-
# PyInstaller ONEFILE spec for the JDM Windows helper.
#
# Build:  pyinstaller build/idm-helper.spec --noconfirm --clean
# Output: dist/idm-helper.exe   (single self-contained exe, no Python needed)
#
# The helper finds bundled assets through sys._MEIPASS (see helper.py::_bundle_dir),
# so fonts/ and mpv_substyle.lua must be listed as datas below.

import os
from PyInstaller.utils.hooks import collect_submodules

ROOT = os.path.abspath(os.getcwd())

datas = [
    (os.path.join(ROOT, "helper", "fonts"), "fonts"),
    (os.path.join(ROOT, "helper", "mpv_substyle.lua"), "."),
]
# song_align.py is intentionally NOT bundled (MMS/CTC unsupported on Windows).

hiddenimports = collect_submodules("psutil") + ["psutil"]

a = Analysis(
    [os.path.join(ROOT, "helper", "helper.py")],
    pathex=[os.path.join(ROOT, "helper")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "torch", "onnxruntime", "PIL", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="idm-helper",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,          # no console window (background helper)
    disable_windowed_traceback=False,
    icon=None,
)
