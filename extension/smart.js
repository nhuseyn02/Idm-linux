// Universal ağıllı media tutma (smart interception): DOM + Performance + inline JSON/script.
// Yalnız mövcud "streamFound / streamCandidate / subFound" mesajlarını göndərir; yükləmə məntiqinə toxunmur.
// Bütün saytlarda işləyir; tapdığı URL-ləri background onsuz da yoxlayır (MIME/məzmun sniff).
(() => {
  "use strict";
  const MEDIA = /\.(?:mp4|m4v|webm|mov|mkv|flv|3gp|m4a|mp3|aac|ogg|oga|opus|flac|wav|weba)(?:[?#]|$)/i;
  const STREAM = /\.(?:m3u8?|mpd)(?:[?#]|$)/i;
  const SUB = /\.(?:vtt|srt|ass|ssa|ttml|dfxp)(?:[?#]|$)/i;
  const SEG = /\.(?:ts|m4s|cmfv|cmfa)(?:[?#]|$)|(?:\/(?:seg(?:ment)?|chunk|frag(?:ment)?|part|fileSequence)[-_.]?\d+(?:[\/?#.]|$))|[?&](?:bytestart|byteend|frag(?:ment)?|seg(?:ment)?|part|range|rn|rbuf)=/i;
  const PAGE = /\.(?:html?|php|json|js|css|xml)(?:[?#]|$)/i;
  const HINT = /(?:\/(?:manifest|playlist|master|index|stream|media|source|video|audio)(?:[\/._?=&-]|$))|(?:[?&](?:file|url|src|video|audio|media|stream|format)=)/i;
  const clean = u => String(u || "").replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\\//g, "/").replace(/\\+$/, "").trim();

  function googleDirect(s) {   // Google Photos/Picasa/fife birbaşa MP4 (videoplayback), seqment deyil
    try {
      const x = new URL(s);
      if (!/(?:^|\.)googlevideo\.com$/i.test(x.hostname) || !/\/videoplayback$/i.test(x.pathname)) return false;
      const q = x.searchParams;
      if (q.has("range") || q.has("rn") || q.has("rbuf")) return false;
      const m = (q.get("mime") || "").toLowerCase();
      return /^(?:video|audio)\//.test(m) || /\b(?:picasa|fife|ph)\b/i.test((q.get("source") || "") + " " + (q.get("app") || "") + " " + (q.get("susc") || ""));
    } catch { return false; }
  }

  function kindOf(u) {
    const s = clean(u);
    if (!/^https?:\/\//i.test(s)) return "";
    if (googleDirect(s)) return "file";
    let p; try { p = new URL(s); } catch { return ""; }
    const path = p.pathname || "";
    if (STREAM.test(path)) return /\.m3u8?$/i.test(path) ? "hls" : "dash";
    if (SUB.test(path)) return "sub";
    if (SEG.test(s)) return "";                       // HLS/DASH seqmentləri ayrıca media kimi göstərilmir
    if (MEDIA.test(path)) return "file";
    if (!PAGE.test(path) && HINT.test(path + "?" + p.search)) return "candidate";
    return "";
  }

  function urlsInText(t) {
    const out = [], re = /https?:\\?\/\\?\/[^"'\s<>]+/gi;
    let m, n = 0;
    while ((m = re.exec(String(t || ""))) && n < 300) {
      const u = clean(m[0]), k = kindOf(u);
      if (k) { out.push({ url: u, kind: k }); n++; }
    }
    return out;
  }

  const api = { kindOf, urlsInText, clean, googleDirect };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof document === "undefined" || typeof performance === "undefined" || typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;
  if (window.__idmSmart) return;
  window.__idmSmart = 1;

  const sent = new Set();
  // Instagram hekayə DASH seqment paramlarını çıxarıb tam fayl ünvanını verir (bytestart/byteend/range).
  function canonMedia(raw) {
    const s = clean(raw);
    let x; try { x = new URL(s); } catch { return s; }
    if (!/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i.test(x.hostname)) return s;
    if (!x.searchParams.has("bytestart") && !x.searchParams.has("byteend") && !x.searchParams.has("range")) return s;
    x.searchParams.delete("bytestart"); x.searchParams.delete("byteend"); x.searchParams.delete("range");
    return x.href;
  }
  function report(url, kind, trust) {
    const u = canonMedia(url), k = kind || kindOf(u);
    if (!k || !/^https?:\/\//i.test(u) || sent.has(u)) return;
    if (googleDirect(u) && /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com)$/i.test(location.hostname || "")) return;
    if (sent.size > 600) sent.clear();
    sent.add(u);
    const m = k === "sub"
      ? { type: "subFound", url: u, frameUrl: location.href, verify: trust !== true }
      : k === "candidate"
        ? { type: "streamCandidate", url: u, frameUrl: location.href }
        : { type: "streamFound", url: u, kind: k, frameUrl: location.href };
    try { chrome.runtime.sendMessage(m).catch(() => {}); } catch {}
  }

  const ATTRS = ["src", "currentSrc", "data-src", "data-url", "data-file", "data-video", "data-video-url",
    "data-audio-url", "data-stream", "data-hls", "data-mpd", "data-mp4", "data-media", "data-source"];
  const NODES = "video,audio,source,track,[data-src],[data-url],[data-file],[data-video],[data-video-url],[data-audio-url],[data-stream],[data-hls],[data-mpd],[data-mp4],[data-media],[data-source]";
  const METAS = ['meta[property="og:video"]', 'meta[property="og:video:url"]', 'meta[property="og:video:secure_url"]',
    'meta[property="og:audio"]', 'meta[property="og:audio:url"]', 'meta[name="twitter:player:stream"]'];

  function collectDom() {
    let n = 0;
    for (const el of document.querySelectorAll(NODES)) {
      if (n++ > 450) break;
      for (const a of ATTRS) {
        let v;
        try { v = el[a]; } catch { v = null; }
        if (typeof v !== "string" || !v) { try { v = el.getAttribute && el.getAttribute(a); } catch { v = null; } }
        if (typeof v === "string" && v) {
          const k = kindOf(v);
          if (k) report(v, k, a === "src" || a === "currentSrc" || a === "data-src");
        }
      }
    }
    for (const m of document.querySelectorAll(METAS.join(","))) {
      const v = m.content || m.getAttribute("content") || "";
      if (v) report(v, kindOf(v), true);
    }
    for (const a of document.querySelectorAll("a[href]")) {
      if (n++ > 800) break;
      const h = a.href;
      if (/(?:\.m3u8?|\.mpd|\.mp4|\.webm|\.m4v|\.mov|\.m4a|\.mp3|\.ogg|\.opus)(?:[?#]|$)/i.test(h)) report(h, kindOf(h), true);
    }
  }

  function collectPerf() {
    let n = 0;
    for (const e of performance.getEntriesByType("resource")) {
      if (n++ > 700) break;
      const k = kindOf(e.name);
      if (!k) continue;
      if (k === "file" && (e.transferSize || 0) < 50_000 && !/^(?:video|audio)$/i.test(e.initiatorType || "")) continue;
      report(e.name, k, true);
    }
  }

  function collectText() {
    let budget = 4_000_000, n = 0;
    for (const s of document.querySelectorAll("script:not([src])")) {
      const t = s.textContent || "";
      if (!t || t.length > budget) continue;
      budget -= t.length;
      for (const x of urlsInText(t)) { if (x.kind === "candidate") continue; report(x.url, x.kind, false); if (++n > 250) return; }
    }
  }

  let timer = 0;
  function scan() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      try { collectDom(); } catch {}
      try { collectPerf(); } catch {}
      try { collectText(); } catch {}
    }, 220);
  }

  addEventListener("DOMContentLoaded", scan, true);
  addEventListener("load", scan, true);
  addEventListener("playing", scan, true);
  addEventListener("loadedmetadata", scan, true);
  try { new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true }); } catch {}
  try { new PerformanceObserver(l => { if (l.getEntries().length) scan(); }).observe({ type: "resource", buffered: true }); } catch {}
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; sent.clear(); scan(); } }, 1200);
  scan();
  setTimeout(scan, 1500);
  setTimeout(scan, 5000);
})();
