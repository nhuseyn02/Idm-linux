#!/usr/bin/env python3
"""CPU-only line timing for an Azerbaijani song using MMS/CTC forced alignment.

Input (stdin JSON): url, title, artist, song, lyrics, duration
Output (stdout JSON): {"ok": true, "device": "cpu", "cues": [{start,end,text}]}

Only one local model is used: MahmoudAshraf/mms-300m-1130-forced-aligner
(ONNX Runtime, CPU). Audio is fetched with yt-dlp/ffmpeg; no Demucs or Whisper.
"""
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path


def die(msg):
    print(json.dumps({"ok": False, "error": str(msg)[-900:]}, ensure_ascii=False))
    raise SystemExit(1)


def norm_word(s):
    s = unicodedata.normalize("NFKC", str(s or "")).lower()
    s = re.sub(r"[^\w\u00c0-\u02af\u1e00-\u1eff\u0400-\u04ff\u0600-\u06ff\u0900-\u0dff\u4e00-\u9fff]+", "", s)
    return s


def line_words(line):
    return [w for w in (norm_word(x) for x in re.split(r"\s+", str(line or ""))) if w]


def download_audio(url, tmp):
    try:
        import yt_dlp
    except Exception as e:
        die("yt-dlp Python modulu yoxdur: " + str(e))
    out = str(Path(tmp) / "audio.%(ext)s")
    opts = {
        "format": "bestaudio/best",
        "outtmpl": out,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
            "preferredquality": "0",
        }],
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as e:
        die("Audio yüklənmədi: " + str(e))
    files = sorted(Path(tmp).glob("audio*.wav"))
    if not files:
        die("Audio WAV faylı yaranmadı")
    return str(files[0])


def align_words(wav, lyrics, exclude=None):
    """Return [(normalized_word, start_ms, end_ms)] from MMS/CTC."""
    try:
        import onnxruntime as ort
        from ctc_forced_aligner import (
            Tokenizer, MODEL_URL, ensure_onnx_model, load_audio, generate_emissions,
            preprocess_text, get_alignments, get_spans, postprocess_results,
        )
    except Exception as e:
        die("MMS/CTC aligner quraşdırılmayıb: " + str(e))
    try:
        # int8 model varsa onu işlət: ~1.7 GB peak (fp32 ~4.2 GB) və daha sürətli.
        model_path = os.environ.get("IDM_ALIGN_MODEL", "").strip()
        if not model_path:
            i8 = Path.home() / "ctc_forced_aligner" / "model_int8.onnx"
            model_path = str(i8) if i8.exists() else str(Path.home() / "ctc_forced_aligner" / "model.onnx")
        if not Path(model_path).exists():
            model_path = str(Path.home() / "ctc_forced_aligner" / "model.onnx")
        ensure_onnx_model(model_path, MODEL_URL)
        opts = ort.SessionOptions()
        opts.enable_cpu_mem_arena = False
        opts.enable_mem_pattern = False
        # Yaddaş: hər thread/batch əlavə bufer deməkdir. Env ilə tənzimlənir.
        try:
            thr = int(os.environ.get("IDM_ALIGN_THREADS", "0") or 0)
        except Exception:
            thr = 0
        opts.intra_op_num_threads = max(1, min(8, thr or min(4, os.cpu_count() or 4)))
        opts.inter_op_num_threads = 1
        session = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
        tokenizer = Tokenizer()
        # Danışıq/applause intervallarını sıfırla ki, MMS orada söz axtarmasın.
        try:
            import librosa
            waveform, _sr = librosa.load(wav, sr=16000, mono=True)
            for iv in (exclude or []):
                a = max(0, int(float(iv.get("start", 0)) * 16000))
                b = max(a, int(float(iv.get("end", 0)) * 16000))
                if b > a: waveform[a:b] = 0
        except Exception:
            waveform = load_audio(wav)
        try:
            bsz = int(os.environ.get("IDM_ALIGN_BATCH", "0") or 0)
        except Exception:
            bsz = 0
        emissions, stride = generate_emissions(session, waveform, batch_size=max(1, min(8, bsz or 2)))
        text = " ".join([x.strip() for x in str(lyrics or "").replace("\r", "").split("\n") if x.strip()])
        tokens_starred, text_starred = preprocess_text(text, romanize=True, language="aze")
        segments, scores, blank = get_alignments(emissions, tokens_starred, tokenizer)
        spans = get_spans(tokens_starred, segments, blank)
        words = postprocess_results(text_starred, spans, stride, scores)
    except Exception as e:
        die("MMS/CTC alignment xətası: " + str(e))
    out = []
    for w in words or []:
        t = norm_word(w.get("text"))
        try:
            a = float(w.get("start")) * 1000.0
            b = float(w.get("end")) * 1000.0
        except Exception:
            continue
        if t and b > a:
            out.append((t, a, b))
    if not out:
        die("MMS/CTC söz tapmadı")
    return out


_TAG_LINE = re.compile(r"^\s*[\[（(]?\s*(?:intro|verse|pre[- ]?chorus|chorus|bridge|hook|refrain|outro|instrumental|music|interlude|post[- ]?chorus|bənd|beyt|nəqərat|keçid|giriş|çıxış|körpü|təkrar)(?:\s*\d+)?(?:\s*[:\-–—].*)?\s*[\]）)]?\s*$", re.I)

def align_lines(lyrics, asr_words):
    """Map official lyric lines to MMS/CTC word timestamps."""
    lines = [x.strip() for x in str(lyrics or "").replace("\r", "").split("\n")]
    lines = [x for x in lines if x and not _TAG_LINE.match(x)]
    line_tokens = []
    flat_tokens = []
    for li, line in enumerate(lines):
        ws = line_words(line)
        if not ws:
            continue
        line_tokens.append((li, line, len(flat_tokens), len(ws)))
        flat_tokens.extend(ws)
    if not flat_tokens:
        die("Sözlərdə vaxtlandırıla bilən söz yoxdur")

    asr_tokens = [w[0] for w in asr_words]
    sm = difflib.SequenceMatcher(None, flat_tokens, asr_tokens, autojunk=False)
    matches = {}
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            matches[a + k] = b + k

    anchors = []
    for li, text, start, count in line_tokens:
        idx = [matches.get(start + k) for k in range(count)]
        idx = [x for x in idx if x is not None]
        if idx:
            first = asr_words[min(idx)][1]
            last = asr_words[max(idx)][2]
            anchors.append((li, text, first, max(first + 120.0, last)))
        else:
            anchors.append((li, text, None, None))

    known = [i for i, a in enumerate(anchors) if a[2] is not None]
    if not known:
        die("Rəsmi sözlər oxunan sözlərlə uyğunlaşmadı")
    for i, a in enumerate(anchors):
        if a[2] is not None:
            continue
        prev = next((known[j] for j in range(len(known) - 1, -1, -1) if known[j] < i), None)
        nxt = next((known[j] for j in range(len(known)) if known[j] > i), None)
        if prev is None and nxt is None:
            continue
        if prev is None:
            t0 = max(0.0, anchors[nxt][2] - 1800.0)
            t1 = anchors[nxt][2] - 50.0
        elif nxt is None:
            t0 = anchors[prev][3] + 50.0
            t1 = t0 + 1800.0
        else:
            span = max(1, nxt - prev)
            frac = (i - prev) / span
            t0 = anchors[prev][3] + (anchors[nxt][2] - anchors[prev][3]) * max(0.0, frac - 0.35)
            t1 = anchors[prev][3] + (anchors[nxt][2] - anchors[prev][3]) * min(1.0, frac + 0.35)
        anchors[i] = (a[0], a[1], max(0.0, t0), max(t0 + 120.0, t1))

    cues = []
    for i, (li, text, start, end) in enumerate(anchors):
        if start is None or end is None:
            continue
        nxt = anchors[i + 1][2] if i + 1 < len(anchors) else None
        if nxt is not None and nxt > start:
            end = min(end, nxt - 35.0)
        if end <= start:
            end = start + 250.0
        cues.append({"start": int(round(start)), "end": int(round(end)), "text": text})
    return cues


def _fmt_ts(sec):
    sec = max(0, float(sec))
    return "%02d:%02d" % (int(sec // 60), int(round(sec % 60)))


def fix_cues(cues):
    """Vaxt qüsurlarını düzəlt (yalnız sıxılmış/gecikmiş sətirlər):
    - mahnının öz nitq sürətindən (saniyə/söz medianı) istifadə edir;
    - çox qısa sətirləri növbəti boşluğa qədər uzadır;
    - böyük boşluqdan sonra gələn sıxılmış sətri bir az erkən başladır;
    - 7 s-dən uzun sətirləri söz nisbətinə görə bölür."""
    cur = sorted([c for c in cues if not c.get("tag")], key=lambda c: (c["start"], c["end"]))
    if not cur: return cur
    def wc_of(c):
        return len([w for w in re.split(r"\s+", str(c.get("text") or "").strip()) if w])
    rates = []
    for c in cur:
        w = wc_of(c)
        d = (c["end"] - c["start"]) / 1000.0
        if w >= 2 and d > 0.2: rates.append(min(1.2, d / w))
    rates.sort()
    rate = rates[len(rates) // 2] if rates else 0.35
    rate = max(0.18, min(0.8, rate))
    for i, c in enumerate(cur):
        w = wc_of(c)
        exp = max(0.7, w * rate)
        dur = (c["end"] - c["start"]) / 1000.0
        prev_end = cur[i - 1]["end"] if i > 0 else 0
        nxt = cur[i + 1]["start"] if i + 1 < len(cur) else None
        # 1) sıxılmış sətir: boşluq varsa uzat
        if dur < max(0.7, 0.55 * exp):
            limit = (nxt - 40.0) if nxt is not None else (c["start"] + exp * 1000)
            c["end"] = int(round(max(c["end"], min(limit, c["start"] + max(0.7, 0.9 * exp) * 1000))))
        # 2) böyük boşluqdan sonra çox qısa sətir: bir az erkən başlat
        gap = c["start"] - prev_end
        if gap > 800 and (c["end"] - c["start"]) / 1000.0 < 0.6 * exp:
            shift = min(gap * 0.5, max(200.0, 400.0 * exp / max(0.7, exp)))
            ns = int(round(max(prev_end + 60, c["start"] - shift)))
            if ns < c["start"]: c["start"] = ns
    # 3) çox uzun sətirləri böl
    out = []
    for c in cur:
        dur = (c["end"] - c["start"]) / 1000.0
        words = [w for w in re.split(r"\s+", str(c.get("text") or "").strip()) if w]
        if dur >= 7.0 and len(words) >= 6:
            parts = 2 if dur < 12.0 else 3
            per = max(1, len(words) // parts)
            t0 = c["start"]
            for k in range(parts):
                seg = words[k * per:(k + 1) * per] if k < parts - 1 else words[k * per:]
                if not seg: continue
                share = len(seg) / max(1, len(words))
                t1 = c["end"] if k == parts - 1 else int(round(t0 + (c["end"] - c["start"]) * share))
                out.append({"start": int(round(t0)), "end": int(t1), "text": " ".join(seg)})
                t0 = t1
        else:
            out.append(c)
    # 4) toqquşmaları kəsil
    out.sort(key=lambda x: (x["start"], x["end"]))
    for i in range(len(out) - 1):
        if out[i]["end"] > out[i + 1]["start"] - 30:
            out[i]["end"] = max(out[i]["start"] + 200, out[i + 1]["start"] - 30)
    return out

def add_tag_cues(cues, exclude):
    """Exclude non-music intervals from lyric cues and add bracket tags."""
    if not exclude:
        return cues
    merged = []
    for iv in sorted(exclude, key=lambda x: float(x.get("start", 0))):
        a, b = max(0.0, float(iv.get("start", 0))), max(0.0, float(iv.get("end", 0)))
        label = str(iv.get("label") or "Danışıq / alqış").strip()
        if b <= a + 0.6: continue
        if merged and a <= merged[-1]["end"] + 0.15:
            merged[-1]["end"] = max(merged[-1]["end"], b)
            if label and label not in merged[-1]["label"]: merged[-1]["label"] += " / " + label
        else:
            merged.append({"start": a, "end": b, "label": label})
    def overlaps(c):
        a, b = c["start"] / 1000.0, c["end"] / 1000.0
        return any(b > iv["start"] + 0.02 and a < iv["end"] - 0.02 for iv in merged)
    out = [c for c in cues if not overlaps(c)]
    for iv in merged:
        out.append({"start": int(round(iv["start"] * 1000)), "end": int(round(iv["end"] * 1000)),
                    "text": "[%s - %s] [%s]" % (_fmt_ts(iv["start"]), _fmt_ts(iv["end"]), iv["label"]),
                    "tag": True})
    out.sort(key=lambda c: (c["start"], c["end"]))
    return out


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        die("JSON girişi yanlışdır")
    if not str(payload.get("url") or "").startswith(("http://", "https://")):
        die("URL yoxdur")
    lyrics = str(payload.get("lyrics") or "").strip()
    if len(lyrics) < 20:
        die("Mahnı sözləri yoxdur")
    with tempfile.TemporaryDirectory(prefix="idm-song-") as tmp:
        wav = download_audio(payload["url"], tmp)
        words = align_words(wav, lyrics, payload.get("exclude") or [])
    cues = fix_cues(add_tag_cues(align_lines(lyrics, words), payload.get("exclude") or []))
    if not cues:
        die("Vaxtlandırılmış sətir yaranmadı")
    print(json.dumps({"ok": True, "device": "cpu", "cues": cues}, ensure_ascii=False))


if __name__ == "__main__":
    main()
