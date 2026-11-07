This folder is filled by  build/download_tools.py  (run in CI before packaging).

Expected contents after a successful build:
    aria2c.exe
    ffmpeg.exe
    ffprobe.exe
    yt-dlp.exe
    deno.exe

The installer copies this whole folder to  {app}\bin\  and adds it to the
helper's PATH, so the frozen helper finds the tools by their bare names.

Do NOT commit the .exe files to git; they are downloaded and sha256-verified
during CI (see build/tools.json and .github/workflows/windows-build.yml).
