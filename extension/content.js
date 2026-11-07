(() => {
  if (window.__idmLinux) return;
  window.__idmLinux = true;

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
  <style>
    *{box-sizing:border-box;font-family:system-ui,sans-serif}
    #b{position:fixed;display:none;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 7px;border:0;border-radius:13px;
       background:#1f9d55;color:#fff;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px #0007;line-height:1}
    #b:hover{background:#26b863}
    #b .ic{font-size:13px;line-height:1}
    #b .cnt{min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#0b5c34;color:#dfffea;font-size:10px;display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}
    #m{position:fixed;display:none;width:292px;max-height:min(410px,82vh);overflow:auto;background:#1c1c1e;color:#eee;
       border-radius:8px;box-shadow:0 6px 24px #000a;padding:4px;font-size:12px}
    .r{display:flex;gap:6px;align-items:center;padding:6px;border-radius:5px;cursor:pointer}
    .r:hover{background:#2c2c2e}
    .t{flex:none;font-size:10px;font-weight:700;background:#1f9d55;color:#fff;border-radius:4px;padding:2px 5px}
    .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .s{flex:none;color:#999;font-size:11px}
    .e{padding:10px;color:#aaa}
    .ctl{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:4px 8px;font-size:11px;color:#999}
    .ctl input{margin:0}
    .ctl select{background:#2c2c2e;color:#eee;border:0;border-radius:4px;padding:2px 4px;font-size:12px;max-width:210px}
  </style>
  <button id="b" title="JDM — videonu yüklə"><span class="ic">⬇</span><span class="cnt" id="c">0</span></button><div id="m"></div>`;
  const $b = root.getElementById("b"), $m = root.getElementById("m"), $c = root.getElementById("c");
  let cur = null, hideT = 0, menuOpen = false, lastMove = 0, feedOpen = false, openSeq = 0, feedT = 0, stateT = 0;
  let countT = 0, countSeq = 0, countV = null;
  let exactCount = null;   // popup-da REAL göstərilən axın sətirlərinin sayı (daxili state)
  let feedCount = null;
  let on = true, overlayOn = true;
  const active = () => on && overlayOn;
  const apply = () => { if (!active()) { menuOpen = false; $m.style.display = "none"; $b.style.display = "none"; try { stopCount(); } catch {} } };
  try {
    chrome.storage.local.get(["enabled", "overlay"]).then(s => { on = s.enabled !== false; overlayOn = s.overlay !== false; apply(); });
    chrome.storage.onChanged.addListener(ch => {
      if (ch.enabled) on = ch.enabled.newValue !== false;
      if (ch.overlay) overlayOn = ch.overlay.newValue !== false;
      apply();
    });
  } catch {}

  // ---- Axın aşkdetme üçün ümumi: Instagram hekayə DASH seqment paramlarını çıxarıb tam fayl ünvanı verir.
  const canonMedia = raw => {
    const s = String(raw || "");
    if (!s) return s;
    let x; try { x = new URL(s); } catch { return s; }
    if (!/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i.test(x.hostname)) return s;
    if (!x.searchParams.has("bytestart") && !x.searchParams.has("byteend") && !x.searchParams.has("range")) return s;
    x.searchParams.delete("bytestart"); x.searchParams.delete("byteend"); x.searchParams.delete("range");
    return x.href;
  };

  // ---- Axın aşkarlama (MAX-ın Meta + Telegram üsulları): səhifə mənbəyi + Performance API ----
  // webRequest tutmadığı və ya yanlış Referer ilə gördüyü m3u8/mpd-ləri BU çərçivənin (iframe-in) öz ünvanı ilə bildirir.
  const sentStreams = new Set();
  const reportStream = (raw, hint, text) => {
    if (!on) return;
    const u = String(raw).replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\\//g, "/").replace(/\\+$/, "");
    if (!/^https?:\/\//i.test(u) || sentStreams.has(u)) return;
    sentStreams.add(u);
    const kind = hint || (/\.mpd(?:[?#]|$)/i.test(u) ? "dash" : "hls");
    const tx = text ? String(text).replace(/\\u0026/g, "&") : "";
    try { chrome.runtime.sendMessage({ type: "streamFound", url: u, kind, frameUrl: location.href, text: tx }).catch(() => {}); } catch {}
  };
  const sentFiles = new Set();
  const isYtHost = /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com)$/i.test(location.hostname || "");
  // ---- Alt yazıların vizual stili (popup/overlay menyusundan seçilir) ----
  const IDM_VISUAL_KEYS = ["default", "cinematic", "minimalist", "neon"];
  const IDM_VISUAL = {
    cinematic: {
      fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: "600", color: "#f6e6c4",
      background: "transparent", textShadow: "0 2px 4px #000, 0 0 6px #000",
      border: "0", borderRadius: "0", padding: "0", letterSpacing: ".015em", boxShadow: "none"
    },
    minimalist: {
      fontFamily: "Inter, Roboto, Arial, Helvetica, sans-serif", fontWeight: "500", color: "#fff",
      background: "transparent", textShadow: "0 2px 6px #000, 0 0 2px #000", border: "0",
      borderRadius: "0", padding: "0", letterSpacing: ".01em", boxShadow: "none"
    },
    neon: {
      fontFamily: "Inter, system-ui, sans-serif", fontWeight: "700", color: "#e8ffff",
      background: "transparent", textShadow: "0 0 6px #23e6ff, 0 0 16px #ff37d0",
      border: "0", borderRadius: "0", padding: "0", letterSpacing: ".05em", boxShadow: "none"
    }
  };
  let IDM_SUB_VISUAL = "default";
  const IDM_SUB_APP_DEF = { size: 16, bold: false, italic: false, underline: false, bg: 10, font: "Default", fontResolved: "", fontMissing: false, fontFallback: "" };
  let IDM_SUB_APP = { ...IDM_SUB_APP_DEF };
  const idmNormSubApp = v => {
    v = v && typeof v === "object" ? v : {};
    const cl = (n, a, b, d) => { n = Math.round(+n); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
    return {
      size: cl(v.size, 2, 200, 16), bold: !!v.bold, italic: !!v.italic, underline: !!v.underline,
      bg: cl(v.bg, 0, 100, 10),
      font: String(v.font || "Default").slice(0, 120) || "Default",
      fontResolved: String(v.fontResolved || "").slice(0, 120),
      fontMissing: !!v.fontMissing, fontFallback: String(v.fontFallback || "").slice(0, 120)
    };
  };
  const IDM_VISUAL_WATCHERS = [];
  const idmSetSubVisual = v => {
    v = String(v || "").toLowerCase();
    if (!IDM_VISUAL_KEYS.includes(v)) v = "default";
    if (v === IDM_SUB_VISUAL) return;
    IDM_SUB_VISUAL = v;
    for (const fn of IDM_VISUAL_WATCHERS) { try { fn(v); } catch {} }
  };
  const idmSetSubAppearance = v => {
    const n = idmNormSubApp(v);
    if (n.size === IDM_SUB_APP.size && n.bold === IDM_SUB_APP.bold && n.italic === IDM_SUB_APP.italic
        && n.underline === IDM_SUB_APP.underline && n.bg === IDM_SUB_APP.bg
        && n.font === IDM_SUB_APP.font && n.fontResolved === IDM_SUB_APP.fontResolved) return;
    IDM_SUB_APP = n;
    for (const fn of IDM_VISUAL_WATCHERS) { try { fn(); } catch {} }
  };
  // YouTube-un ÖZ (orijinal) caption-larına da eyni stil. AI overlay ayrıca stil alır.
  const IDM_NATIVE_SUB_STYLE_ID = "idm-native-sub-visual-style";
  const idmNativeSubCss = key => {
    const v = IDM_VISUAL[key] || null;
    const ratio = IDM_SUB_APP.size / 16;
    const alpha = Math.round(IDM_SUB_APP.bg * 2.55) / 255;
    const box = alpha > 0;
    const base = "border:0!important;border-radius:0!important;box-shadow:none!important";
    const segBg = "background-color:" + (box ? "rgba(0,0,0," + alpha.toFixed(3) + ")" : "transparent") + "!important;" +
      (box ? "padding:.08em .28em!important;border-radius:.12em!important;" : "padding:0!important;");
    const chosen = IDM_SUB_APP.font && IDM_SUB_APP.font !== "Default"
      ? (IDM_SUB_APP.fontResolved || IDM_SUB_APP.font) : "";
    const fontNames = chosen
      ? [...new Set([IDM_SUB_APP.font, IDM_SUB_APP.fontResolved, "sans-serif"].filter(Boolean).map(x => String(x).replace(/"/g, "")))]
      : [];
    const fontCss = fontNames.length ? "font-family:" + fontNames.map(x => x === "sans-serif" ? x : '"' + x + '"').join(", ") + "!important"
      : (v && v.fontFamily ? "font-family:" + v.fontFamily + "!important" : "");
    const text = [
      fontCss,
      "font-weight:" + (IDM_SUB_APP.bold ? "700" : "400") + "!important",
      "font-style:" + (IDM_SUB_APP.italic ? "italic" : "normal") + "!important",
      "text-decoration:" + (IDM_SUB_APP.underline ? "underline" : "none") + "!important",
      // Rəng YALNIZ açıq şəkildə seçilmiş vizual stildən gəlir. "default" halda
      // heç bir rəng qaydası yazılmır ki, YouTube-un öz ağ rəngi toxunulmaz qalsın.
      v && v.color ? "color:" + v.color + "!important" : "",
      v && v.textShadow ? "text-shadow:" + v.textShadow + "!important" : "",
      v && v.letterSpacing ? "letter-spacing:" + v.letterSpacing + "!important" : ""
    ].filter(Boolean).join(";");
    // Ölçü YALNIZ leaf seqmentə verilir — iç-içə elementlərdə faiz qatlanmasın.
    const sizeCss = "font-size:calc(100% * " + ratio.toFixed(4) + ")!important";
    const scope = ":is(#movie_player, .html5-video-player)";
    return [
      scope + " .ytp-caption-window-container {background:transparent!important;border:0!important;box-shadow:none!important}",
      scope + " .caption-window:not(.idm-ai-caption-window),",
      scope + " .ytp-caption-window-container .caption-window:not(.idm-ai-caption-window) {background:transparent!important;" + base + "}",
      scope + " .caption-window:not(.idm-ai-caption-window) .ytp-caption-segment,",
      scope + " .caption-window:not(.idm-ai-caption-window) .caption-visual-line,",
      scope + " .caption-window:not(.idm-ai-caption-window) .captions-text {" + base + ";" + text + "}",
      scope + " .caption-window:not(.idm-ai-caption-window) .ytp-caption-segment {" + sizeCss + ";" + segBg + "}"
    ].join("\n");
  };
  const idmApplyNativeSubVisual = () => {
    try {
      let el = document.getElementById(IDM_NATIVE_SUB_STYLE_ID);
      if (!el) {
        el = document.createElement("style");
        el.id = IDM_NATIVE_SUB_STYLE_ID;
        (document.head || document.documentElement).append(el);
      }
      el.textContent = idmNativeSubCss(IDM_SUB_VISUAL);
    } catch {}
  };
  IDM_VISUAL_WATCHERS.push(() => idmApplyNativeSubVisual());
  idmApplyNativeSubVisual();
  try { chrome.storage.local.get(["subVisualStyle", "subAppearance"]).then(v => {
    if (v) idmSetSubVisual(v.subVisualStyle);
    if (v) idmSetSubAppearance(v.subAppearance);
  }).catch(() => {}); } catch {}
  try { chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.subVisualStyle) idmSetSubVisual(ch.subVisualStyle.newValue);
    if (ch.subAppearance) idmSetSubAppearance(ch.subAppearance.newValue);
  }); } catch {}
  // Helper JSON əsas mənbədir: storage boş olsa belə ayarları bərpa et.
  (async () => {
    try {
      if (window.top !== window) return;
      const j = await chrome.runtime.sendMessage({ type: "getSubSettings" }).catch(() => null);
      if (!j || !j.ok || !j.settings) return;
      const s = j.settings;
      const cur = await chrome.storage.local.get(["subAppearance", "subVisualStyle"]).catch(() => ({}));
      const curApp = idmNormSubApp(cur && cur.subAppearance);
      const curNonDefault = curApp.size !== 16 || curApp.bold || curApp.italic || curApp.underline || curApp.bg !== 10 || curApp.font !== "Default" ||
        ((cur && cur.subVisualStyle) || "default") !== "default";
      if (j.seedNeeded && curNonDefault) return;   // popup/background köhnə ayarları helper-ə köçürəcək
      const app = idmNormSubApp({ ...s, style: s.aiStyle });
      idmSetSubAppearance(app);
      idmSetSubVisual(s.visualStyle);
      const same = curApp.size === app.size && curApp.bold === app.bold && curApp.italic === app.italic &&
        curApp.underline === app.underline && curApp.bg === app.bg && curApp.font === app.font &&
        curApp.fontResolved === app.fontResolved && (cur && cur.subVisualStyle) === s.visualStyle;
      if (!same) chrome.storage.local.set({
        subAppearance: { ...app, style: ["default", "academic", "colloquial", "simplified"].includes(s.aiStyle) ? s.aiStyle : "default" },
        subVisualStyle: ["default", "cinematic", "minimalist", "neon"].includes(s.visualStyle) ? s.visualStyle : "default"
      }).catch(() => {});
    } catch {}
  })();
  function googleDirect(u) {   // Picasa/fife/Google Photos birbaşa MP4 (videoplayback), seqment deyil
    try {
      const x = new URL(u);
      if (!/(?:^|\.)googlevideo\.com$/i.test(x.hostname) || !/\/videoplayback$/i.test(x.pathname)) return false;
      const q = x.searchParams;
      if (q.has("range") || q.has("rn") || q.has("rbuf")) return false;
      const m = (q.get("mime") || "").toLowerCase();
      return /^(?:video|audio)\//.test(m) || /\b(?:picasa|fife|ph)\b/i.test((q.get("source") || "") + " " + (q.get("app") || "") + " " + (q.get("susc") || ""));
    } catch { return false; }
  }
  const reportFile = (u, json) => {
    u = canonMedia(String(u || ""));
    if (!on || !/^https?:\/\//i.test(u || "") || sentFiles.has(u) || sentFiles.size > 20) return;
    if (googleDirect(u) && isYtHost) return;   // YouTube səhifəsində googlevideo: səhifə yolu kifayətdir
    sentFiles.add(u);
    try { chrome.runtime.sendMessage({ type: "streamFound", url: u, kind: "file", json: !!json, frameUrl: location.href }).catch(() => {}); } catch {}
  };
  // <track kind="subtitles|captions" src=...>: yt-dlp-nin bilmədiyi səhifə subtitrləri (sayt öz fayllarını verir)
  const sentSubs = new Set();
  const reportTracks = () => {
    if (!on) return;
    try {
      for (const t of document.querySelectorAll("track")) {
        const u = t.src;
        if (!/^(subtitles|captions)$/i.test(t.kind) || !/^https?:\/\//i.test(u) || sentSubs.has(u)) continue;
        sentSubs.add(u);
        chrome.runtime.sendMessage({ type: "subFound", url: u, lang: t.srclang || "", label: t.label || "", frameUrl: location.href }).catch(() => {});
      }
    } catch {}
  };
  // Səhifə mənbəyində / Performance API-də tapılan .vtt/.srt: background onların həqiqətən subtitr olduğunu yoxlayır
  const SUB_RE = /https?:\\?\/\\?\/[^"'\s<>]+?\.(?:vtt|srt|ass|ssa|ttml|dfxp)(?:\?[^"'\s<>]*)?/gi;
  const MEDIA_EXT = /\.(?:mp4|m4v|webm|mov|mkv|flv|3gp|m4a|mp3|aac|ogg|oga|opus|flac|wav)(?:[?#]|$)/i;
  const SEG_ONLY = /\.(?:ts|m4s|cmfv|cmfa)(?:[?#]|$)|(?:\/(?:seg(?:ment)?|chunk|frag(?:ment)?|part|fileSequence)[-_.]?\d+(?:[\/?#.]|$))|[?&](?:bytestart|byteend|frag(?:ment)?|seg(?:ment)?|part|range|rn|rbuf)=/i;
  const hint = (html, i, len) => {   // JSON-da yaxınlıqdakı "label"/"srclang" açarları (varsa)
    const w = html.slice(Math.max(0, i - 160), i + len + 160);
    const g = k => { const m = w.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]{1,40})"', "i")); return m ? m[1] : ""; };
    return { label: g("label"), lang: g("srclang") || g("language") || g("lang") };
  };
  const scannedSubs = new Set();
  const sniffSub = t => /^WEBVTT/.test(t) || /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(t);
  // observed=true: brauzer bu faylı artıq real sorğu ilə aldı (Performance API) -> yoxlama lazım deyil.
  // Səhifə mənbəyindəki linklər əvvəl səhifənin öz kontekstində (düzgün Referer/cookie ilə) yoxlanır; CORS mane olarsa background yoxlayır.
  const reportSub = async (raw, h = {}, observed = false) => {
    if (!on) return;
    const u = String(raw).replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\\//g, "/").replace(/\\+$/, "");
    if (!/^https?:\/\//i.test(u) || scannedSubs.has(u)) return;
    scannedSubs.add(u);
    let verify = !observed;
    if (verify) {
      try {
        const r = await fetch(u, { headers: { Range: "bytes=0-1023" }, credentials: "include" });
        if (!r.ok) return;                                   // mövcud deyil -> göstərmə
        if (!sniffSub((await r.text()).slice(0, 1024).replace(/^\uFEFF/, "").trimStart())) return;
        verify = false;                                      // səhifə kontekstində təsdiqləndi
      } catch {}                                             // CORS/şəbəkə: background yoxlasın
    }
    try { chrome.runtime.sendMessage({ type: "subFound", url: u, lang: h.lang || "", label: h.label || "", frameUrl: location.href, verify }).catch(() => {}); } catch {}
  };
  // Universal: meta/atribut/performans-dan gələn qarışıq URL-i düzgün növə yönəlt
  const reportAny = u => {
    if (!/^https?:/i.test(u || "")) return;
    if (/\.(?:m3u8?|mpd)(?:[?#]|$)/i.test(u)) return reportStream(u);
    if (/\.(?:vtt|srt|ass|ssa|ttml|dfxp)(?:[?#]|$)/i.test(u)) return reportSub(u, {}, false);
    if ((googleDirect(u) || MEDIA_EXT.test(u)) && !SEG_ONLY.test(u)) return reportFile(u);
    if (CAND.test(u)) return reportCand(u);
    if (SUBCAND.test(u)) return reportSubCand(u);
  };
  // Uzantısız axın/altyazı namizədləri (məs. /m3u/<token>, /playlist, /master, /subtitle?id=): background məzmununa görə yoxlayır
  const SEG_EXT = /\.(?:ts|m4s|cmf[va]|aac|mp4|webm|js|css|png|jpe?g|gif|webp|svg|woff2?|ico|json|html?)(?:[?#]|$)/i;
  const CAND = /\/m3u8?(?:[\/?#]|$)|m3u8?(?:[?#&]|$)|\/(?:hls|playlist|master|manifest|chunklist)[\w.\-]*(?:[\/?#]|$)/i;
  const SUBCAND = /[\/_.\-](?:subs?|subtitles?|captions?|cc)(?:[\/_.\-?=]|$)/i;
  const sentCand = new Set(); let nCand = 0, nSubCand = 0;
  const clean = raw => String(raw).replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\\//g, "/").replace(/\\+$/, "");
  const reportCand = raw => {
    if (!on) return;
    const u = clean(raw);
    if (!/^https?:\/\//i.test(u) || sentCand.has(u) || sentStreams.has(u) || nCand >= 25) return;
    sentCand.add(u); nCand++;
    try { chrome.runtime.sendMessage({ type: "streamCandidate", url: u, frameUrl: location.href }).catch(() => {}); } catch {}
  };
  const reportSubCand = raw => {
    const u = clean(raw);
    if (nSubCand >= 30 || scannedSubs.has(u) || !/^https?:\/\//i.test(u)) return;
    nSubCand++; reportSub(u, {}, false);   // səhifə kontekstində məzmunu yoxlanır (WEBVTT / zaman kodları)
  };
  // Pleyer konfiqurasiyasındakı {"file":"...","kind":"captions"} tipli trek siyahıları (uzantısız URL-lər də daxil)
  const TRACK_A = /"(?:file|src|url|link)"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"[^{}]{0,240}?"kind"\s*:\s*"(?:captions?|subtitles?)"/gi;
  const TRACK_B = /"kind"\s*:\s*"(?:captions?|subtitles?)"[^{}]{0,240}?"(?:file|src|url|link)"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"/gi;
  const URL_ANY = /https?:\\?\/\\?\/[^"'\s<>]+/gi;
  const STREAM_RE = /https?:\\?\/\\?\/[^"'\s<>]+?\.(?:m3u8|mpd)(?:\?[^"'\s<>]*)?/gi;
  // Ağır DOM skanı: böyük səhifələrdə (məs. Pornhub) `documentElement.innerHTML` sinxron oxunması
  // media `play` anında əsas ipi bloklayır və video donur. Ona görə skan YALNIZ boş vaxtda
  // (requestIdleCallback) icra olunur və tez-tez təkrarlanmasının qarşısı alınır.
  let scanPageBusy = false, scanPageAt = 0, scanFullDone = false;
  const idle = fn => {
    try { if (typeof requestIdleCallback === "function") { requestIdleCallback(fn, { timeout: 600 }); return; } } catch {}
    setTimeout(fn, 0);
  };
  const scanPageNow = () => {
    if (!on) return;
    reportTracks();
    try {
      const elCount = document.getElementsByTagName("*").length || 0;
      const huge = elCount > 4000;
      // Çox böyük səhifələrdə bütün HTML-i hər dəfə yenidən oxumaq bahalıdır: tam HTML yalnız BİR dəfə
      // skan olunur; sonrakı çağırışlarda yalnız canlı media elementləri/meta yenilənir.
      if (!huge || !scanFullDone) {
        let html = document.documentElement.innerHTML;
        if (html.length > 5e6) html = html.slice(0, 5e6);
        for (const m of html.matchAll(STREAM_RE)) reportStream(m[0]);
        for (const m of html.matchAll(SUB_RE)) reportSub(m[0], hint(html, m.index, m[0].length));
        for (const re of [TRACK_A, TRACK_B]) for (const m of html.matchAll(re)) reportSub(m[1], hint(html, m.index, m[0].length));
        for (const m of html.slice(0, 2e6).matchAll(URL_ANY)) {
          const u = m[0];
          if (SEG_EXT.test(u)) continue;
          if (CAND.test(u)) reportCand(u); else if (SUBCAND.test(u)) reportSubCand(u);
        }
        scanFullDone = true;
      }
      for (const v of document.querySelectorAll("video, audio, source"))
        for (const s of [v.currentSrc, v.src]) {
          if (!s || !/^https?:/i.test(s)) continue;   // blob: (MSE) burada tanınmır; hook/webRequest tutur
          if (/\.(m3u8|mpd)(?:[?#]|$)/i.test(s)) reportStream(s);
          else reportFile(s);                          // uzantısız birbaşa media (məs. /stream/<token>)
        }
      for (const m of document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[property="og:audio"], meta[property="og:audio:url"], meta[name="twitter:player:stream"]')) {
        const u = m.content || m.getAttribute("content") || "";
        if (u) reportAny(u);
      }
      // Bu çərçivənin özü playlist-dirsə (link birbaşa açılıb / iframe m3u8 mətni göstərir).
      // `innerText` reflow yaradır: onu yalnız YOXS (kiçik) sənədlərdə yoxlayırıq.
      if (elCount < 400) {
        const bt = ((document.body && (document.body.innerText || document.body.textContent)) || "").slice(0, 200);
        if (/^\s*#EXTM3U/.test(bt)) reportStream(location.href, "hls");
      }
      if (/xml|dash/i.test(document.contentType || "") && /<MPD[\s>]/i.test(document.documentElement.outerHTML.slice(0, 4000))) reportStream(location.href, "dash");
    } catch {}
  };
  // `play`/`loadedmetadata` kimi tez-tez təkrarlanan hadisələrdən çağırılır: skanı boş vaxta atır və
  // eyni anda bir dəfədən artıq icra olunmasına / 1.5 san içində təkrarlanmasına imkan vermir.
  const scanPage = (force) => {
    if (!on) return;
    const now = Date.now();
    if (!force && (scanPageBusy || now - scanPageAt < 1500)) return;
    scanPageBusy = true; scanPageAt = now;
    if (force) scanFullDone = false;
    idle(() => { scanPageBusy = false; scanPageNow(); });
  };
  // DOM/HTML skanı ilə yanaşı Performance API-də artıq qeydə alınmış real şəbəkə URL-lərini də yenidən bildir.
  const scanPerf = () => {
    try {
      for (const e of performance.getEntriesByType("resource")) {
        const u = e.name || "";
        if (!/^https?:/i.test(u)) continue;
        if (/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(u)) reportStream(u);
        else if (/\.(?:vtt|srt|ass|ssa|ttml|dfxp)(?:[?#]|$)/i.test(u)) reportSub(u, {}, true);
        else if ((googleDirect(u) || MEDIA_EXT.test(u)) && !SEG_ONLY.test(u) && ((e.transferSize || 0) >= 50_000 || /^(?:video|audio)$/i.test(e.initiatorType || ""))) reportFile(u);
        else if (!SEG_EXT.test(u)) { if (CAND.test(u)) reportCand(u); else if (SUBCAND.test(u)) reportSubCand(u); }
      }
    } catch {}
  };
  try {
    const onEntry = e => {
      if (/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(e.name)) reportStream(e.name);
      else if (/\.(?:vtt|srt|ass|ssa|ttml|dfxp)(?:[?#]|$)/i.test(e.name)) reportSub(e.name, {}, true);
      else if ((googleDirect(e.name) || MEDIA_EXT.test(e.name)) && !SEG_ONLY.test(e.name) && ((e.transferSize || 0) >= 50_000 || /^(?:video|audio)$/i.test(e.initiatorType || ""))) reportFile(e.name);
      else if (!SEG_EXT.test(e.name)) { if (CAND.test(e.name)) reportCand(e.name); else if (SUBCAND.test(e.name)) reportSubCand(e.name); }
    };
    performance.getEntriesByType("resource").forEach(onEntry);
    new PerformanceObserver(l => l.getEntries().forEach(onEntry)).observe({ type: "resource", buffered: true });
  } catch {}
  scanPage(); setTimeout(scanPage, 2000); setTimeout(scanPage, 6000);
  try {
    new MutationObserver(ms => {
      for (const m of ms) for (const n of m.addedNodes)
        if (n.nodeType === 1 && (n.tagName === "TRACK" || n.querySelector && n.querySelector("track"))) return reportTracks();
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
  addEventListener("play", scanPage, true);
  addEventListener("play", e => { const t = e.target; if (t && /^(?:VIDEO|AUDIO)$/.test(t.tagName || "")) autoScan(450); }, true);
  addEventListener("loadedmetadata", e => { const t = e.target; if (t && /^(?:VIDEO|AUDIO)$/.test(t.tagName || "")) autoScan(650); }, true);
  setTimeout(() => autoScan(1200), 1500);
  // ---- Player Navigation & Stale Stream Tracker: SPA URL / iframe src / yeni video mənbəyi dəyişdikdə
  // background köhnə media map-ni təmizləyir; YouTube adi səhifəsində və feed rejimində toxunmur.
  let lastLoc = location.href, lastVideoEl = null, lastVideoDir = "", lastFrameSig = "", playerT = 0, playerReadyAt = Date.now();
  const bigFrame = el => { try { const r = el.getBoundingClientRect(); return r.width >= 240 && r.height >= 135; } catch { return false; } };
  const signalPlayer = reason => {
    if (!on) return;
    autoScan(650);   // URL/player dəyişdi: popup-a basmadan state-i təzələ
    if (isYtHost || Date.now() - playerReadyAt < 1800) return;
    clearTimeout(playerT);
    playerT = setTimeout(() => {
      try { chrome.runtime.sendMessage({ type: "playerChanged", reason, url: location.href }).catch(() => {}); } catch {}
    }, 650);
  };
  // SPA URL, böyük iframe src dəyişikliyi və yeni aktiv <video> elementi: player/server dəyişməsi.
  // Eyni video elementində keyfiyyət dəyişməsi təmizlənmir (əvvəlki aqressiv loadstart handler-i söndürülüb).
  const frameSig = () => [...document.querySelectorAll("iframe")].filter(bigFrame).map(f => f.src || "").join("|");
  lastFrameSig = frameSig();
  try {
    new MutationObserver(ms => {
      for (const m of ms) if (m.type === "attributes" && m.target && m.target.tagName === "IFRAME") {
        const s = frameSig(); if (s !== lastFrameSig) { lastFrameSig = s; if (bigFrame(m.target)) signalPlayer("iframe"); }
        break;
      }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["src"] });
  } catch {}
  setInterval(() => {
    if (location.href !== lastLoc) { lastLoc = location.href; signalPlayer("url"); }
    const vs = [...document.querySelectorAll("video")].filter(bigFrame);
    const v = vs.find(x => !x.paused && !x.ended) || vs[0] || null;
    if (v && lastVideoEl && v !== lastVideoEl) signalPlayer("video-element");
    if (v) {
      let dir = ""; try { const x = new URL(v.currentSrc || v.src || "", location.href); dir = x.origin + x.pathname.replace(/\/[^\/]*$/, "/"); } catch {}
      if (v === lastVideoEl && lastVideoDir && dir && dir !== lastVideoDir) signalPlayer("video-source");
      lastVideoEl = v; lastVideoDir = dir;
    }
  }, 900);
  // hook.js (MAIN dünya): fetch/XHR məzmunu, pleyer obyektləri, qlobal konfiqurasiyalar -> axın/subtitr
  document.addEventListener("__idm_ev", e => {
    try {
      const d = JSON.parse(e.detail);
      if (!d || typeof d.url !== "string") return;
      if (d.type === "stream" && (d.kind === "hls" || d.kind === "dash")) reportStream(d.url, d.kind, d.text);
      else if (d.type === "sub") reportSub(d.url, {}, !!d.seen);
      else if (d.type === "file") reportFile(d.url, !!d.json);
    } catch {}
  });
  document.dispatchEvent(new CustomEvent("__idm_req"));   // hook-un erkən tapdıqlarını istə

  const mount = () => {
    const f = document.fullscreenElement;
    const t = f && f.tagName !== "VIDEO" ? f : document.documentElement;
    if (t && host.parentNode !== t) t.appendChild(host);
  };
  mount();
  document.addEventListener("fullscreenchange", mount);
  ["mousedown", "mouseup", "pointerdown", "pointerup", "click", "dblclick"].forEach(ev =>
    host.addEventListener(ev, e => e.stopPropagation()));

  const videoRect = v => {
    if (!v || !v.getBoundingClientRect) return null;
    const r = v.getBoundingClientRect();
    if (r.width < 120 || r.height < 70) return null;
    const vw = Math.max(1, innerWidth), vh = Math.max(1, innerHeight);
    const iw = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const ih = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (iw < 100 || ih < 60 || (iw * ih) < (r.width * r.height) * 0.18) return null;
    try {
      const st = getComputedStyle(v);
      if (st.visibility === "hidden" || st.display === "none" || +st.opacity === 0) return null;
    } catch {}
    if (v.closest && v.closest('[aria-hidden="true"]')) return null;
    return r;
  };
  const findVideo = (x, y) => {
    let best = null, bestArea = 0;
    for (const v of document.querySelectorAll("video")) {
      const r = videoRect(v);
      if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (area > bestArea) { best = v; bestArea = area; }
    }
    return best;
  };
  const focusSources = v => {
    if (!v) return [];
    // Sayğac üçün yalnız HAZIRDA seçilmiş media URL-i: currentSrc → src → ilk <source>.
    // currentSrc + src + source-ları birlikdə saymaq eyni axını 2-3 dəfə göstərirdi.
    let u = String(v.currentSrc || v.src || "");
    if (!u) { try { const s = v.querySelector && v.querySelector("source"); u = String(s && s.src || ""); } catch {} }
    if (!/^(?:https?:|blob:)/i.test(u) || /\.(?:ts|m4s|cmf[va])(?:[?#]|$)/i.test(u)) return [];
    return [u];
  };
  const stopCount = () => { if (countT) clearInterval(countT); countT = 0; countV = null; countSeq++; };
  const countSig = v => focusSources(v)[0] || "";
  const setBadge = n => { $c.textContent = !(n > 0) ? "0" : n > 99 ? "99+" : String(n); };
  const popupRows = () => $m.querySelectorAll(".r[data-stream='1']").length;
  const rememberCount = (v, n) => { if (v) exactCount = { v, sig: countSig(v), n, at: Date.now() }; };
  const updateCount = async v => {
    const seq = ++countSeq;
    let n = focusSources(v).length;
    // Popup açılanda render olunan sətirlər mənbədir: YouTube keyfiyyətləri, feed direct sətirləri
    // və digər media sətirləri məhz buradan sayılır. mediaCount yalnız hələ açılmamış popup üçündür.
    if (exactCount && exactCount.v === v && exactCount.sig === countSig(v) && Date.now() - exactCount.at < 30000) {
      n = exactCount.n;
    } else {
      try {
        const r = await chrome.runtime.sendMessage({ type: "mediaCount", focusUrls: focusSources(v), pageUrl: location.href });
        if (r && r.ok) n = Math.max(n, +r.count || 0);
      } catch {}
    }
    if (seq !== countSeq || !v || cur !== v) return;
    setBadge(n);
  };
  const startCount = v => {
    if (!v) return;
    if (countV === v && countT) return;
    stopCount(); countV = v; updateCount(v);
    countT = setInterval(() => {
      if (!active() || $b.style.display === "none" || !cur) { stopCount(); return; }
      updateCount(cur);
    }, 1200);
  };
  // ---- Avtomatik state skanı: istifadəçi popup-a basmadan video oxunanda keyfiyyət/feed state-i hazır olsun.
  let autoT = 0, autoBusy = false, autoUrl = "";
  function autoScan(delay = 500) {
    if (!on) return;
    clearTimeout(autoT);
    autoT = setTimeout(async () => {
      autoT = 0;
      if (!on || autoBusy) return;
      autoBusy = true;
      try {
        const r = await chrome.runtime.sendMessage({ type: "getOptions", auto: true });
        if (r && r.ok !== false && Number.isFinite(+r.count)) {
          const n = +r.count;
          autoUrl = location.href;
          if (cur) { rememberCount(cur, n); setBadge(n); }
        }
      } catch {}
      finally { autoBusy = false; }
    }, Math.max(150, delay));
  }
  const place = v => {
    const r = v.getBoundingClientRect();
    const bw = Math.max(42, $b.offsetWidth || 48);
    const left = Math.max(4, Math.min(innerWidth - bw - 4, r.right - bw - 4));
    const top = Math.max(4, Math.min(innerHeight - 30, r.top + 6));
    $b.style.left = left + "px"; $b.style.top = top + "px"; $b.style.display = "flex";
    const mw = 292, mh = $m.offsetHeight || 280;
    const ml = Math.max(4, Math.min(innerWidth - mw - 4, r.right - mw - 4));
    const below = top + 30;
    const mt = below + mh <= innerHeight - 4 ? below : Math.max(4, r.top - mh - 6);
    $m.style.left = ml + "px"; $m.style.top = mt + "px";
  };
  const hide = () => { if (!menuOpen) { $b.style.display = "none"; stopCount(); } };
  const closeMenu = () => { menuOpen = false; feedOpen = false; $m.style.display = "none"; };

  addEventListener("mousemove", e => {
    if (!active()) return;
    const now = Date.now();
    if (now - lastMove < 55) return;
    lastMove = now;
    if (!host.isConnected) mount();
    const v = findVideo(e.clientX, e.clientY);
    if (v) {
      cur = v; place(v); clearTimeout(hideT); hideT = 0; startCount(v);
    } else if (!menuOpen && $b.style.display !== "none") {
      clearTimeout(hideT); hideT = setTimeout(hide, 420);
    }
  }, true);
  const reposition = () => {
    if (!active() || !cur || $b.style.display === "none") return;
    if (!videoRect(cur)) { hide(); return; }
    place(cur);
  };
  addEventListener("scroll", reposition, true);
  addEventListener("resize", reposition);
  addEventListener("click", e => { if (menuOpen && !e.composedPath().includes(host)) closeMenu(); }, true);

  const fmtSize = n => !n ? "" : n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB";
  const fileName = u => { try { return decodeURIComponent(new URL(u).pathname.split("/").pop()) || "video"; } catch { return "video"; } };
  const normStream = u => { try { const x = new URL(u, location.href); return x.origin + x.pathname; } catch { return String(u || ""); } };
  const msg = t => { $m.replaceChildren(); const d = document.createElement("div"); d.className = "e"; d.textContent = t; $m.appendChild(d); };
  const ctxHandlers = IDMShared.makeContextHandlers(m => chrome.runtime.sendMessage(m), msg);

  // renderSource (shared.js) üçün UI adapteri
  const ui = {
    line: (p, text, title, tip) => { const d = document.createElement("div"); d.className = "e"; d.style.cssText = "padding:6px 8px;font-size:11px"; d.textContent = text; if (tip) IDMShared.attachTip(d, tip, root); else if (title) d.title = title; p.append(d); },
    ctl: p => { const d = document.createElement("div"); d.className = "ctl"; p.append(d); return d; },
    addRow: (p, tag, name, size, title, getPayload, meta) => {
      let payload = null; try { payload = getPayload ? getPayload() : null; } catch {}
      const m = { ...(meta || {}), payload, url: (meta && meta.url) || title };
      return addRow(p, tag, name, size, title, () => pick(payload || getPayload()), m);
    },
    tipRoot: root
  };
  const pick = async payload => {
    feedOpen = false; msg("Göndərilir…");
    try {
      const r = await chrome.runtime.sendMessage({ type: "download", ...payload });
      msg(r && r.ok ? "✓ Yükləməyə əlavə olundu" : "✗ " + ((r && r.error) || "xəta"));
    } catch { msg("✗ Əlaqə xətası"); }
    setTimeout(closeMenu, 1600);
  };
  const addRow = (parent, tag, name, size, title, onClick, meta) => {
    const row = document.createElement("div"); row.className = "r"; row.dataset.stream = "1";
    const t = document.createElement("span"); t.className = "t"; t.textContent = tag;
    const n = document.createElement("span"); n.className = "n"; n.textContent = meta ? (IDMShared.rowTitle(name, meta, 32) || tag) : name; if (title && !meta) n.title = title;
    // meta verilibsə: vahid dizayn (sağda format + həcm, üzərinə gələndə məlumat pəncərəsi); verilməyibsə əvvəlki görünüş
    let s; if (meta) s = IDMShared.metaEl(meta); else { s = document.createElement("span"); s.className = "s"; s.textContent = fmtSize(size); }
    row.append(t, n, s); row.addEventListener("click", onClick); parent.append(row);
    IDMShared.bindRowMenu(row, () => ({ url: (meta && meta.url) || title, name: (meta && meta.name) || name, kind: (meta && meta.kind) || (/^(?:HLS|DASH)$/i.test(tag) ? "hls" : "file"), payload: (meta && meta.payload) || null, duration: meta && meta.dur }), ctxHandlers);
    if (meta && meta.tip) IDMShared.attachTip(row, meta.tip, root);
  };

  const feedApi = {
    state: { open: new Set(), loaded: new Map() },
    group: key => chrome.runtime.sendMessage({ type: "feedGroup", key }),
    refresh: async () => { try { await chrome.runtime.sendMessage({ type: "feedRefresh" }); } catch {} if (menuOpen) openMenu(); }
  };
  try {   // video dəyişəndə açıq menyu yenilənir (bir listener; yükləmə mesajı göstərilərkən toxunulmur)
    chrome.runtime.onMessage.addListener(m => {
      if (m && m.type === "mediaStateChanged") {
        // Yeni axın tutuldu / ölçü dəyişdi / feed yeniləndi: dərhal state-dən say, açıq menyunu yenilə.
        exactCount = null;
        if (!["auto", "title", "size", "attach"].includes(m.reason)) autoScan(650);
        if (menuOpen) {
          // Alt yazı paneli açıqdırsa menyunu yenidən çəkmə: istifadəçinin seçimi pozulmasın.
          if (IDMShared.subPanelOpen && IDMShared.subPanelOpen()) return;
          clearTimeout(stateT);
          stateT = setTimeout(() => { if (menuOpen && !(IDMShared.subPanelOpen && IDMShared.subPanelOpen())) openMenu(); }, 220);
        } else if (cur) updateCount(cur);
      }
      if (m && m.type === "feedChanged" && menuOpen && feedOpen) { clearTimeout(feedT); feedT = setTimeout(() => { if (menuOpen && feedOpen) openMenu(); }, 300); }
      if (m && m.type === "rescanPage") {
        menuSig = "";
        sentStreams.clear(); sentFiles.clear(); sentSubs.clear(); scannedSubs.clear(); sentCand.clear(); nCand = 0; nSubCand = 0;
        try { scanPage(true); scanPerf(); } catch {}
      }
      if (m && m.type === "mediaReset") { exactCount = null; menuSig = ""; }
      if (m && m.type === "mediaReset" && menuOpen && !feedOpen) {
        sentStreams.clear(); sentFiles.clear(); sentSubs.clear(); scannedSubs.clear(); sentCand.clear(); nCand = 0; nSubCand = 0;
        // player dəyişməsində köhnə DOM-u yenidən taramaq köhnə axınları geri gətirərdi; yalnız manual rescan scan edir
        if (m.reason === "rescan") { try { scanPage(true); scanPerf(); } catch {} }
        // rescan açılışını rescanStreams/popup idarə edir; burada erkən açılıb axınları boş göstərmirik
        if (m.reason !== "rescan") setTimeout(() => { if (menuOpen && !feedOpen) openMenu(); }, 450);
      }
    });
  } catch {}
  let rescanning = false;
  async function rescanStreams() {
    if (rescanning) return;
    rescanning = true; msg("Yenidən skan edilir…");
    sentStreams.clear(); sentFiles.clear(); sentSubs.clear(); scannedSubs.clear(); sentCand.clear(); nCand = 0; nSubCand = 0;
    try { await chrome.runtime.sendMessage({ type: "rescan" }); } catch {}
    try { scanPage(true); scanPerf(); } catch {}
    await new Promise(r => setTimeout(r, 900));
    rescanning = false;
    openMenu(true);
  }
  let menuSig = "";
  async function openMenu(force = false) {
    const had = menuOpen && $m.children.length > 0;
    menuOpen = true; feedOpen = false; $m.style.display = "block";
    if (!had || force) msg("Keyfiyyətlər yoxlanılır…");   // hər state yeniləməsində mətn yanıb-sönməsin
    const focusV = cur, focusUrls = focusSources(focusV), focusSet = new Set(focusUrls.map(normStream));
    const seq = ++openSeq;
    let res;
    try { res = await chrome.runtime.sendMessage({ type: "getOptions", fast: true }); }
    catch { return msg("Extension yenilənib, səhifəni yeniləyin."); }
    if (seq !== openSeq || !menuOpen) return;   // köhnə cavab yenisini əvəz etməsin
    if (!res || res.ok === false) return msg("✗ " + ((res && res.error) || "xəta"));
    const sig = IDMShared.sigOf ? IDMShared.sigOf(res) : "";
    if (!force && had && sig && sig === menuSig) return;   // məzmun dəyişməyib: menyunu yenidən çəkmə
    menuSig = sig;
    if (res.feed) {   // qısa video lenti: qruplar (shared.js)
      feedOpen = true; $m.replaceChildren();
      IDMShared.renderFeed($m, res, { pageUrl: res.pageUrl, title: res.title, subsOn: res.subsOn !== false }, ui, feedApi);
      // Yalnız AKTİV qrup: əvvəl oxudulan qruplar açılanda onların sətirləri sayğaca əlavə olunmur.
      const g = res.cur || {}, gn = (g.options || []).length + (g.direct || []).length;
      feedCount = gn; rememberCount(focusV, gn); setBadge(gn);
      return;
    }
    let items = [...(res.items || [])];
    // Popup konkret videonun üstündə açılıb: yalnız həmin videonun axınlarını saxla.
    if (focusUrls.length) {
      // HLS snapshot zamanı item.url yerli /m/<token> olur; orijinal URL isə item.orig-də qalır.
      // Əvvəl yalnız it.url yoxlanıldığı üçün bu axınlar atılır, keyfiyyət/həcm/müddət itirdi.
      let exact = items.filter(i => focusUrls.includes(i.url) || focusSet.has(normStream(i.url))
        || (i.orig && (focusUrls.includes(i.orig) || focusSet.has(normStream(i.orig))))
        || (i.pUrl && (focusUrls.includes(i.pUrl) || focusSet.has(normStream(i.pUrl)))));
      // MSE <video> currentSrc blob-dur; HLS/CDN item isə ayrı URL-dir. Bu halda yalnız blob-u
      // göstərmək səhvdir: səhifədə tutulmuş HLS/DASH item-lərini saxla, subtitle-only görünüşü aradan qaldır.
      if (!exact.length && focusUrls.some(u => /^blob:/i.test(u))) {
        const hs = items.filter(i => i.kind === "hls" || i.kind === "dash" || (i.options && i.options.length));
        if (hs.length) exact = hs;
      }
      items = exact;
    }
    const vfps = await IDMShared.videoFps(focusV || cur).catch(() => 0);   // cari <video> -> real FPS
    if (vfps > 0) for (const it of items) if (!it.fps && cur && it.url === (cur.currentSrc || cur.src)) it.fps = vfps;
    // Inline/stream: yalnız popup-ın açıldığı KONKRET videonun mənbələri.
    const seen = new Set();
    for (const i of items) for (const u of [i.url, i.orig, i.pUrl]) if (u) { seen.add(u); seen.add(normStream(u)); }
    for (const src of focusUrls) {
      // YouTube <video> MSE blob-dur: səhifə keyfiyyətləri onsuz da yt-dlp ilə gəlir.
      // Blob-u ayrıca sətir kimi göstərmək sayğacı süni şəkildə artırır və yüklənə bilmir.
      if (isYtHost && /^blob:/i.test(src)) continue;
      if (/^blob:/i.test(src) && items.some(i => i.kind === "hls" || i.kind === "dash")) continue;   // HLS varsa blob sətri yox
      if (!/^(?:https?:|blob:)/i.test(src) || seen.has(src) || seen.has(normStream(src)) || /\.(?:ts|m4s|cmf[va])(?:[?#]|$)/i.test(src)) continue;
      const kind = /\.m3u8?(?:[?#]|$)/i.test(src) ? "hls" : /\.mpd(?:[?#]|$)/i.test(src) ? "dash" : "file";
      items.push({ url: src, kind, name: fileName(src), size: 0, fps: vfps, referer: location.href });
      seen.add(src); seen.add(normStream(src));
    }
    // Bütün birbaşa media növləri üçün FPS: background /meta (ffprobe) — HLS/DASH/fayl, digər saytlar daxil
    const missFps = items.filter(i => !i.fps && !(i.options && i.options.length) && /^https?:/i.test(i.url || "")).slice(0, 6);
    if (missFps.length) await Promise.all(missFps.map(async it => {
      try {
        const r = await chrome.runtime.sendMessage({ type: "mediaMeta", url: it.url, referer: it.referer || location.href, pageUrl: location.href });
        if (r && r.ok && r.fps > 0) it.fps = r.fps;
      } catch {}
    }));
    $m.replaceChildren();
    if (res.title) {
      const titleRow = document.createElement("div"); titleRow.className = "r"; titleRow.style.fontWeight = "bold";
      titleRow.textContent = IDMShared.smartTitle(res.title, 40); $m.appendChild(titleRow);
      IDMShared.attachTip(titleRow, { kind: "v", title: res.title, fields: [["Mənbə", IDMShared.hostOf(res.pageUrl)]] }, root);
    }
    const rbtn = document.createElement("button");
    rbtn.type = "button"; rbtn.textContent = "⟳ Yenidən yoxla"; rbtn.title = "Media axınlarını sıfırla və yenidən skan et";
    rbtn.style.cssText = "display:block;margin:4px 8px 6px;padding:4px 8px;border:1px solid #555;border-radius:5px;background:#2b2b2f;color:#eee;font-size:12px;cursor:pointer";
    rbtn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); rescanStreams(); });
    $m.appendChild(rbtn);
    // Hər mənbə üçün (səhifə / HLS / DASH): rejim, keyfiyyət, səs, subtitr — ortaq məntiq shared.js-dədir
    const ctx = { pageUrl: res.pageUrl, title: res.title, subsOn: res.subsOn !== false };
    const pageSubs = res.pageSubs || [];
    let subsTaken = false;
    const takeSubs = () => { if (subsTaken) return []; subsTaken = true; return pageSubs; };
    for (const w of res.warnings || []) ui.line($m, "⚠ " + w);
    if (res.options.length) IDMShared.renderSource($m, { options: res.options, audios: res.audios, subs: res.subs, aq: res.aq, caps: res.caps, strat: res.strat }, items.length ? { text: "Səhifə videosu (yt-dlp)" } : null, ctx, ui, takeSubs());
    for (const it of items) {
      const kt = it.kind === "hls" ? "HLS" : it.kind === "dash" ? "DASH" : (it.name.split(".").pop() || "VIDEO").slice(0, 5).toUpperCase();
      const tag = kt + (it.fps ? " " + Math.round(it.fps) + "FPS" : "");
      if (it.options && it.options.length) IDMShared.renderSource($m, it, { text: kt + " · " + IDMShared.smartTitle(it.name, 34), title: it.url, tip: { kind: "v", title: it.name, fields: [["Növ", kt], ["Mənbə", IDMShared.hostOf(it.url)]] } }, ctx, ui, takeSubs());
      else {
        const fm = it.kind === "hls" || it.kind === "dash" ? kt : IDMShared.extFmt(it.name);
        const dt = IDMShared.fmtDur(it.dur);
        // Tək axın (keyfiyyət siyahısı yoxdur): rejim menyusu (Video + Səs / Yalnız video / Yalnız səs) görünsün.
        const au = /^(?:MP3|M4A|AAC|OGG|OPUS|FLAC|WAV|MKA)$/.test(fm);
        if (!au && IDMShared.renderSource($m, IDMShared.directSource(it, tag, fm), null, ctx, ui, [])) {
          if (it.probeError) { const w = document.createElement("div"); w.className = "e"; w.style.cssText = "padding:2px 8px;font-size:11px"; w.textContent = "⚠ " + it.probeError; $m.appendChild(w); }
          continue;
        }
        addRow($m, tag, it.name + (dt ? " · " + dt : ""), it.size, it.url, () => pick({ item: { url: it.url, kind: it.kind, name: it.name, size: it.size, referer: it.referer, dur: it.dur } }),
          { fmt: fm, size: it.size, est: it.est, dur: it.dur, tip: { kind: "v", title: it.name, fields: [["Format", fm], ["FPS", it.fps ? Math.round(it.fps) + " FPS" : ""], ["Müddət", dt], ["Həcm", (it.est && it.size ? "~" : "") + (IDMShared.fmtSize(it.size) || "bilinmir")], ["Mənbə", IDMShared.hostOf(it.url)]] } });
        if (it.probeError) { const w = document.createElement("div"); w.className = "e"; w.style.cssText = "padding:2px 8px;font-size:11px"; w.textContent = "⚠ " + it.probeError; $m.appendChild(w); }
      }
    }
    // Video yoxdur/tanınmadı, amma səhifə öz subtitr faylını verir: yalnız subtitr yüklənə bilər
    if (!subsTaken && pageSubs.length)
      IDMShared.renderSource($m, { options: [], audios: [], subs: [], url: res.pageUrl, kind: "page", name: res.title }, { text: "Aşkarlanan subtitrlər" }, ctx, ui, takeSubs());
    if (!$m.children.length) msg("✗ " + (res.error || "Yüklənə bilən keyfiyyət tapılmadı"));
    else { rememberCount(focusV, popupRows()); setBadge(popupRows()); }
  }
  // Google Photos/Picasa: token tez bitə bilər. Yükləmə anında səhifədəki <video> cari (təzə) URL-ni qaytarır.
  try {
    chrome.runtime.onMessage.addListener((m, _s, reply) => {
      if (!m || m.type !== "mediaRefresh") return;
      const urls = [];
      if (!isYtHost) for (const el of document.querySelectorAll("video, audio, source"))
        for (const s of [el.currentSrc, el.src]) if (s && googleDirect(s)) urls.push(s);
      reply({ urls: [...new Set(urls)] });
      return true;
    });
  } catch {}
  // Menyu daxilində rejim/keyfiyyət filtri sətirləri yenidən çəkdikdə sayğac da dərhal yenilənir.
  let countSyncT = 0;
  try {
    new MutationObserver(() => {
      if (!menuOpen) return;
      clearTimeout(countSyncT);
      countSyncT = setTimeout(() => {
        if (!menuOpen) return;
        const n = feedOpen ? (feedCount == null ? 0 : feedCount) : popupRows();
        if (cur) rememberCount(cur, n);
        setBadge(n);
      }, 20);
    }).observe($m, { childList: true, subtree: true });
  } catch {}
  // ---- YouTube canlı AI alt yazı (yalnız YouTube; istifadəçi menyudan başladanda) ----
  // YouTube-un öz caption pəncərəsini oxuyur, mətn dəyişdikcə bir sorğu göndərir və
  // native caption-ları gizlədib eyni yerdə tərcüməni göstərir. Digər saytlarda bu blok işləmir.
  let liveTop = false;
  try { liveTop = window.top === window; } catch {}
  if (isYtHost && liveTop) {
    const LIVE_ID = "idm-yt-live-caption";
    const live = {
      active: false, target: "az", gen: 0, busy: false, pending: "",
      lastSrc: "", shown: "", cache: new Map(),
      overlay: null, style: null, mo: null, root: null, tick: 0, sched: 0, hint: 0
    };

    const liveNorm = text => {
      const out = [];
      for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
        const line = raw.replace(/\s+/g, " ").trim();
        if (!line) continue;
        if (!out.some(x => x.toLowerCase() === line.toLowerCase())) out.push(line);
      }
      return out.slice(-2).join("\n");
    };

    const readCaption = () => {
      try {
        const wins = [...document.querySelectorAll(".ytp-caption-window-container .ytp-caption-window, .ytp-caption-window-container .caption-window, #movie_player .caption-window")]
          .filter(w => { try { const r = w.getBoundingClientRect(); return r.width > 2 && r.height > 2; } catch { return false; } });
        let raw = wins.length ? wins.map(w => w.innerText || w.textContent || "").join("\n") : "";
        if (!raw) {
          const c = document.querySelector(".ytp-caption-window-container");
          raw = c ? (c.innerText || c.textContent || "") : "";
        }
        return liveNorm(raw);
      } catch { return ""; }
    };

    const liveVisualApply = el => {
      if (!el) return;
      const wasDisplay = el.style.display;
      el.style.cssText = [
        "position:fixed", "left:50%", "bottom:9%", "transform:translateX(-50%)",
        "max-width:min(82vw,1100px)", "padding:0", "background:transparent",
        "color:#fff", "font:500 clamp(17px,2.4vw,28px)/1.35 'YouTube Sans','Roboto','Arial',sans-serif",
        "text-align:center", "white-space:pre-line", "border:0", "border-radius:0", "box-shadow:none",
        "text-shadow:0 2px 4px #000,0 0 3px #000", "pointer-events:none",
        "z-index:2147483646", "display:none", "box-sizing:border-box"
      ].join(";");
      const custom = IDM_VISUAL[IDM_SUB_VISUAL];
      if (custom) {
        for (const k of ["fontFamily", "fontWeight", "color", "textShadow", "letterSpacing"]) {
          if (custom[k] != null) el.style[k] = custom[k];
        }
      }
      if (wasDisplay) el.style.display = wasDisplay;
    };
    const ensureOverlay = () => {
      if (!document.body) return null;
      let el = document.getElementById(LIVE_ID);
      if (!el) {
        el = document.createElement("div");
        el.id = LIVE_ID;
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        el.dir = "auto";
        el.style.cssText = [
          "position:fixed", "left:50%", "bottom:9%", "transform:translateX(-50%)",
          "max-width:min(82vw,1100px)", "padding:0", "background:transparent",
          "color:#fff", "font:500 clamp(17px,2.4vw,28px)/1.35 'YouTube Sans','Roboto','Arial',sans-serif",
          "text-align:center", "white-space:pre-line", "border:0", "border-radius:0", "box-shadow:none",
          "text-shadow:0 2px 4px #000,0 0 3px #000", "pointer-events:none",
          "z-index:2147483646", "display:none"
        ].join(";");
      }
      const parent = document.fullscreenElement || document.body;
      if (el.parentElement !== parent) parent.append(el);
      live.overlay = el;
      liveVisualApply(el);
      if (!live.style) {
        live.style = document.createElement("style");
        live.style.id = LIVE_ID + "-style";
        live.style.textContent = ".ytp-caption-window-container,#movie_player .caption-window{opacity:0!important}";
        (document.head || document.documentElement).append(live.style);
      }
      return el;
    };

    IDM_VISUAL_WATCHERS.push(() => { if (live.overlay) liveVisualApply(live.overlay); });

    const hideNative = on => {
      if (on) {
        if (!live.style) {
          live.style = document.createElement("style");
          live.style.id = LIVE_ID + "-style";
          live.style.textContent = ".ytp-caption-window-container,#movie_player .caption-window{opacity:0!important}";
          (document.head || document.documentElement).append(live.style);
        }
      } else if (live.style) {
        live.style.remove();
        live.style = null;
      }
    };

    const paint = text => {
      const val = liveNorm(text);
      const el = ensureOverlay();
      if (!el) return;
      if (val === live.shown) return;
      live.shown = val;
      el.textContent = val;
      el.style.display = val ? "block" : "none";
    };

    const disconnect = () => {
      if (live.mo) { try { live.mo.disconnect(); } catch {} }
      live.mo = null;
      live.root = null;
    };

    const arm = () => {
      if (!live.active || document.hidden) return;
      const cap = document.querySelector(".ytp-caption-window-container");
      const root = cap || document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
      if (!root) { disconnect(); return; }
      if (root === live.root && live.mo) return;
      disconnect();
      live.root = root;
      live.mo = new MutationObserver(() => schedule(90));
      live.mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
    };

    const schedule = (delay = 100) => {
      clearTimeout(live.sched);
      live.sched = setTimeout(() => {
        live.sched = 0;
        if (!live.active || document.hidden) return;
        readCurrent();
      }, delay);
    };

    const readCurrent = () => {
      if (!live.active) return;
      const text = readCaption();
      if (text === live.lastSrc) return;
      if (!text) {
        if (live.lastSrc) { live.lastSrc = ""; paint(""); }
        return;
      }
      clearTimeout(live.hint);
      live.lastSrc = text;
      live.pending = text;
      if (!live.busy) process(live.gen);
    };

    const process = async gen => {
      if (live.busy) return;
      live.busy = true;
      try {
        while (live.active && gen === live.gen && live.pending) {
          const text = live.pending;
          live.pending = "";
          const key = live.target + "|" + text;
          let out = live.cache.get(key);
          if (out == null) {
            let r = null;
            try { r = await chrome.runtime.sendMessage({ type: "liveSubTranslate", text, target: live.target }); } catch {}
            if (gen !== live.gen || !live.active) return;
            if (r && r.ok && r.text) {
              out = String(r.text || "");
              live.cache.set(key, out);
              while (live.cache.size > 240) live.cache.delete(live.cache.keys().next().value);
            } else {
              out = "";
              if (r && r.error && text === live.lastSrc) paint("⚠ " + String(r.error));
            }
          }
          if (gen !== live.gen || !live.active) return;
          if (text === live.lastSrc && out) paint(out);
        }
      } finally {
        if (gen === live.gen) live.busy = false;
      }
    };

    const start = target => {
      if (!isYtHost || !on) return false;
      live.target = String(target || "az").split("-")[0] || "az";
      live.active = true;
      live.gen++;
      live.busy = false;
      live.pending = "";
      live.lastSrc = "";
      live.shown = "";
      hideNative(true);
      ensureOverlay();
      paint("");
      clearTimeout(live.hint);
      live.hint = setTimeout(() => {
        if (live.active && !live.lastSrc && !live.shown) paint("YouTube alt yazısını aktiv edin");
      }, 1800);
      arm();
      schedule(0);
      clearInterval(live.tick);
      live.tick = setInterval(() => {
        if (!live.active || document.hidden) return;
        ensureOverlay();
        arm();
        schedule(0);
      }, 900);
      return true;
    };

    const stop = () => {
      live.active = false;
      live.gen++;
      live.busy = false;
      live.pending = "";
      live.lastSrc = "";
      live.shown = "";
      clearTimeout(live.sched);
      clearTimeout(live.hint);
      clearInterval(live.tick);
      live.tick = 0;
      disconnect();
      hideNative(false);
      if (live.overlay) live.overlay.remove();
      live.overlay = null;
    };

    try {
      chrome.runtime.onMessage.addListener((m, _s, reply) => {
        if (!m) return;
        if (m.type === "liveSubStart") { reply({ ok: start(m.target) }); return true; }
        if (m.type === "liveSubStop") { stop(); reply({ ok: true }); return true; }
      });
    } catch {}

    document.addEventListener("fullscreenchange", () => { if (live.active) ensureOverlay(); }, true);
    document.addEventListener("visibilitychange", () => {
      if (!live.active) return;
      if (document.hidden) { disconnect(); clearTimeout(live.sched); }
      else { arm(); schedule(0); }
    });
    try {
      chrome.storage.onChanged.addListener(ch => {
        if ((ch.enabled && ch.enabled.newValue === false) || (ch.subs && ch.subs.newValue === false)) stop();
      });
    } catch {}
  }

  // ---- YouTube AI alt yazı inteqrasiyası (YouTube-un öz caption/menyu görünüşü) ----
  if (isYtHost && liveTop) {
    const ytAI = { track: null, tracks: new Map(), rows: new Map(), activeId: "", active: false, cues: [], style: null, mo: null, tick: 0,
      subAt: 0, subPanel: null, sched: 0, win: null, lastText: "", lastStyleKey: "", ccAt: 0, ccObs: null, ccBtn: null,
      shownKey: "", frameN: 0, raf: 0, videoKey: "", customMain: false,
      customPanel: null, customBase: null, customOpen: false, offRow: null,
      geoObs: null, geoSched: 0, geoAligned: false, geoTop: false };

    const ytText = t => String(t || "").replace(/\r/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const ytCueText = t => String(t || "").replace(/\r/g, "").split("\n").map(ytText).filter(Boolean).slice(0, 2).join("\n");
    const ytLang = code => {
      const AZ = { "ab": 'Abxaz dili', "af": 'Afrikaans', "sq": 'Albaniya dili', "de": 'Alman dili', "am": 'Amhar dili', "av": 'Avar dili', "az": 'Azərbaycan dili', "ba": 'Başqırd dili', "eu": 'Bask dili', "be": 'Belarus dili', "bn": 'Benqal dili', "my": 'Birman dili', "bg": 'Bolqar dili', "bs": 'Bosniya dili', "ce": 'Çeçen dili', "cs": 'Çex dili', "zh-CN": 'Çin dili - Mandarin / Sadələşdirilmiş', "zh-TW": 'Çin dili - Ənənəvi', "zh-cn": 'Çin dili - Mandarin / Sadələşdirilmiş', "zh-tw": 'Çin dili - Ənənəvi', "cv": 'Çuvaş dili', "da": 'Danimarka dili', "hy": 'Erməni dili', "ar": 'Ərəb dili', "eo": 'Esperanto', "et": 'Eston dili', "fa": 'Fars dili', "fi": 'Fin dili', "fr": 'Fransız dili', "fy": 'Friz dili', "gag": 'Qaqauz dili', "gl": 'Qalisian dili', "kk": 'Qazax dili', "ky": 'Qırğız dili', "gu": 'Qucarat dili', "ka": 'Gürcü dili', "ha": 'Hausa', "hi": 'Hindi dili', "nl": 'Holland dili', "hr": 'Xorvat dili', "ig": 'İqbo dili', "id": 'İndoneziya dili', "en": 'İngilis dili', "ga": 'İrland dili', "is": 'İsland dili', "es": 'İspan dili', "sv": 'İsveç dili', "it": 'İtalyan dili', "he": 'İvrit dili', "kn": 'Kannada dili', "yue": 'Kanton dili', "ca": 'Katalan dili', "ko": 'Koreya dili', "ku": 'Kurd dili', "km": 'Kxmer dili', "lo": 'Laos dili', "la": 'Latın dili', "lv": 'Latış dili', "lez": 'Ləzgi dili', "lt": 'Litva dili', "lb": 'Lüksemburq dili', "hu": 'Macar dili', "mk": 'Makedon dili', "mg": 'Malaqas dili', "ms": 'Malay dili', "ml": 'Malayalam dili', "mt": 'Malta dili', "mr": 'Marathi dili', "mn": 'Monqol dili', "ne": 'Nepal dili', "no": 'Norveç dili', "uz": 'Özbək dili', "pa": 'Pəncab dili', "pl": 'Polyak dili', "pt": 'Portuqal dili', "ps": 'Puştu dili', "ro": 'Rumın dili', "ru": 'Rus dili', "sa": 'Sanskrit', "sr": 'Serb dili', "si": 'Sinhala dili', "sk": 'Slovak dili', "sl": 'Sloven dili', "so": 'Somali dili', "sw": 'Suahili', "su": 'Sundan dili', "sn": 'Şona dili', "tg": 'Tacik dili', "ta": 'Tamil dili', "tl": 'Taqaloq / Filippin dili', "tt": 'Tatar dili', "th": 'Tay dili', "te": 'Teluqu dili', "tyv": 'Tuvaca', "tr": 'Türk dili', "tk": 'Türkman dili', "uk": 'Ukrayna dili', "ur": 'Urdu', "ug": 'Uyğur dili', "cy": 'Valliy dili', "vi": 'Vyetnam dili', "xh": 'Xosa dili', "ja": 'Yapon dili', "jv": 'Yava dili', "yo": 'Yoruba dili', "el": 'Yunan dili', "zu": 'Zulu dili', "fil": 'Filippin dili', "zh": 'Çin dili' };
      const raw = String(code || "").toLowerCase().replace(/_/g, "-").replace(/-orig$/, "");
      if (raw === "dual" || raw === "ikili") return "İkili dil";
      if (AZ[raw]) return AZ[raw];
      const key = raw.split("-")[0];
      if (AZ[key]) return AZ[key];
      try {
        const n = new Intl.DisplayNames(["az"], { type: "language" }).of(String(code || ""));
        if (n && n.toLowerCase() !== key) return n.charAt(0).toLocaleUpperCase("az") + n.slice(1);
      } catch {}
      return String(code || "");
    };
    const ytParseTime = s => {
      const m = String(s || "").match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
      if (!m) return 0;
      return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 + (+m[4] || 0) * (String(m[4]).length === 2 ? 10 : 1);
    };
    const ytParse = text => {
      const out = [];
      for (const b of String(text || "").replace(/\r/g, "").split(/\n{2,}/)) {
        const lines = b.split("\n").map(x => x.trim()).filter(Boolean);
        const ti = lines.findIndex(x => /-->/.test(x));
        if (ti < 0) continue;
        const m = lines[ti].match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/);
        if (!m) continue;
        const txt = ytCueText(lines.slice(ti + 1).join("\n"));
        if (txt) out.push({ start: ytParseTime(m[1]), end: ytParseTime(m[2]), text: txt });
      }
      return out.sort((a, b) => a.start - b.start);
    };

    const ytPlayer = () => document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
    const ytContainer = () => document.getElementById("ytp-caption-window-container") || document.querySelector(".ytp-caption-window-container");
    const ytNativeWindow = c => c ? [...c.querySelectorAll(".caption-window:not(.idm-ai-caption-window)")].pop() || null : null;
    const ytVisible = el => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    };
    const ytVideoKey = () => {
      try {
        const u = new URL(location.href);
        if (/(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(u.hostname)) {
          return u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|embed|live|watch)\/([^/?#]+)/) || [])[1] || u.pathname;
        }
        return u.href;
      } catch { return String(location.href || ""); }
    };

    const ytCCButton = () => document.querySelector(".ytp-subtitles-button");
    const ytCaptionsOn = () => {
      const b = ytCCButton();
      return !b || b.getAttribute("aria-pressed") === "true";
    };
    const ytWatchCC = () => {
      const b = ytCCButton();
      if (!b) return;
      if (ytAI.ccBtn === b && ytAI.ccObs) return;
      if (ytAI.ccObs) { try { ytAI.ccObs.disconnect(); } catch {} }
      ytAI.ccBtn = b;
      try {
        ytAI.ccObs = new MutationObserver(() => {
          if (!ytAI.active) return;
          if (b.getAttribute("aria-pressed") !== "true" && Date.now() - ytAI.ccAt > 350) ytDeactivate();
        });
        ytAI.ccObs.observe(b, { attributes: true, attributeFilter: ["aria-pressed"] });
      } catch { ytAI.ccObs = null; }
    };

    // YouTube-un öz caption ölçü düsturu (captions.js: Qsb): 640px eninə 16px, portretdə 480px bazası.
    const ytFontSize = () => {
      const p = ytPlayer();
      const w = Math.max(1, Math.round(p?.clientWidth || p?.getBoundingClientRect().width || 0));
      const h = Math.max(1, Math.round(p?.clientHeight || p?.getBoundingClientRect().height || 0));
      if (!w) return 20;
      return Math.max(16, w >= h ? w / 640 * 16 : w / 480 * 16);
    };

    const ytTextStyle = (noVisual = false) => {
      const c = ytContainer();
      const nw = ytNativeWindow(c);
      const seg = nw && nw.querySelector(".ytp-caption-segment");
      const fs = ytFontSize();
      let st;
      if (seg) {
        const s = getComputedStyle(seg);
        const bg = s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)" ? s.backgroundColor : "";
        // Rəngi YALNIZ birbaşa inline stildən götürürük. Native caption-a bizim
        // enjekte etdiyimiz CSS də düşür; computed rəng oradan sızıb AI overlay-i
        // mavi çalar edə bilər. Inline yoxdursa default ağdır.
        const inlineCol = String(seg.style && seg.style.color || "").trim();
        st = {
          fontFamily: s.fontFamily || '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, sans-serif',
          fontSize: parseFloat(s.fontSize) > 0 ? s.fontSize : fs + "px",
          lineHeight: s.lineHeight && s.lineHeight !== "normal" ? s.lineHeight : "1.375",
          color: inlineCol && inlineCol !== "rgba(0, 0, 0, 0)" ? inlineCol : "#fff",
          background: "transparent",
          fontWeight: s.fontWeight || "400",
          textShadow: s.textShadow && s.textShadow !== "none" ? s.textShadow : "0 2px 4px #000, 0 0 3px #000",
          borderRadius: "0",
          padding: "0", letterSpacing: "normal", border: "0", boxShadow: "none"
        };
      } else {
        st = {
          fontFamily: '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, sans-serif',
          fontSize: fs + "px", lineHeight: "1.375", color: "#fff",
          background: "transparent", fontWeight: "400", textShadow: "0 2px 4px #000, 0 0 3px #000",
          borderRadius: "0",
          padding: "0", letterSpacing: "normal", border: "0", boxShadow: "none"
        };
      }
      const custom = noVisual ? null : IDM_VISUAL[IDM_SUB_VISUAL];
      const base = custom ? { ...st, ...custom } : st;
      // İstifadəçi ayarları (ölçü / şrift / qalın / kursiv / altdan xətt / fon) hər yerdə eyni.
      const ratio = IDM_SUB_APP.size / 16;
      const alpha = Math.round(IDM_SUB_APP.bg * 2.55) / 255;
      const chosen = IDM_SUB_APP.font && IDM_SUB_APP.font !== "Default"
        ? (IDM_SUB_APP.fontResolved || IDM_SUB_APP.font) : "";
      const fam = chosen
        ? [...new Set([IDM_SUB_APP.font, IDM_SUB_APP.fontResolved, "sans-serif"].filter(Boolean).map(x => String(x).replace(/"/g, "")))]
            .map(x => x === "sans-serif" ? x : '"' + x + '"').join(", ")
        : base.fontFamily;
      return {
        ...base,
        fontFamily: fam,
        fontSize: Math.max(8, Math.round(ytFontSize() * ratio)) + "px",
        fontWeight: IDM_SUB_APP.bold ? "700" : "400",
        fontStyle: IDM_SUB_APP.italic ? "italic" : "normal",
        textDecoration: IDM_SUB_APP.underline ? "underline" : "none",
        background: alpha > 0 ? "rgba(0,0,0," + alpha.toFixed(3) + ")" : "transparent",
        padding: alpha > 0 ? ".08em .28em" : "0"
      };
    };

    const ytShowStyle = () => {
      if (!ytAI.style) {
        ytAI.style = document.createElement("style");
        ytAI.style.id = "idm-yt-ai-subs-style";
      }
      ytAI.style.textContent = "#ytp-caption-window-container .caption-window:not(.idm-ai-caption-window){visibility:hidden!important;opacity:0!important;pointer-events:none!important}" +
        ".ytp-panel-menu.idm-yt-ai-active .ytp-menuitem[role='menuitemradio']:not(.idm-yt-ai-item) .ytp-menuitem-label{background-image:none!important}" +
        ".idm-yt-ai-panel .ytp-panel-menu{max-height:min(70vh,520px);overflow-y:auto}" +
        ".idm-yt-ai-panel .idm-yt-ai-item[aria-checked='true'] .ytp-menuitem-label::before{content:'✓ ';font-weight:700}" +
        ".idm-yt-ai-main .ytp-menuitem-content{min-width:1.2em;text-align:right}";
      if (!ytAI.style.isConnected) (document.head || document.documentElement).append(ytAI.style);
    };
    const ytHideStyle = () => {
      try { if (ytAI.style) ytAI.style.remove(); } catch {}
      ytAI.style = null;
    };

    const ytEnsure = () => {
      const player = ytPlayer();
      if (!player) return null;
      let c = ytContainer();
      if (!c) {
        c = document.createElement("div");
        c.id = "ytp-caption-window-container";
        c.className = "ytp-caption-window-container";
        c.dataset.layer = "4";
        player.append(c);
      }
      // CC söndürüləndə YouTube konteyneri display:none edə bilər; AI trek
      // seçildikdə onu yenidən görünən et.
      c.style.display = "block";
      c.style.visibility = "visible";
      c.style.opacity = "1";
      let w = c.querySelector(".idm-ai-caption-window");
      if (!w) {
        w = document.createElement("div");
        w.className = "caption-window ytp-caption-window-bottom idm-ai-caption-window";
        w.tabIndex = 0; w.dir = "auto"; w.setAttribute("aria-live", "off");
      }
      if (w.parentElement !== c) c.append(w);
      const nw = ytNativeWindow(c);
      const cr = c.getBoundingClientRect();
      let aligned = false, topMode = false;
      if (nw) {
        const nr = nw.getBoundingClientRect();
        const ns = getComputedStyle(nw);
        topMode = nw.classList.contains("ytp-caption-window-top") || (ns.top !== "auto" && (ns.bottom === "auto" || parseFloat(ns.top) < parseFloat(ns.bottom)));
        // Native pəncərə görünməsə belə (biz onu visibility:hidden edirik) ölçüsü qalır.
        if (nr.width > 1 && nr.height > 1 && cr.width > 1 && cr.height > 1) {
          const snap = v => Math.round(v * 2) / 2; // bottom üçün yarım piksel sabitliyi
          w.style.margin = "0";
          w.style.transition = "bottom .12s linear, top .12s linear";
          // Horizontal: həmişə pleyerin tam mərkəzi (native pəncərənin sola sürüşməsi təsir etməsin).
          w.style.left = "50%";
          w.style.transform = "translateX(-50%)";
          w.style.right = "";
          w.style.width = "max-content";
          w.style.maxWidth = "96%";
          w.style.maxHeight = "96%";
          w.style.textAlign = "center";
          if (topMode) {
            w.classList.remove("ytp-caption-window-bottom"); w.classList.add("ytp-caption-window-top");
            w.style.top = snap(nr.top - cr.top) + "px"; w.style.bottom = "";
          } else {
            w.classList.remove("ytp-caption-window-top"); w.classList.add("ytp-caption-window-bottom");
            w.style.bottom = snap(cr.bottom - nr.bottom) + "px"; w.style.top = "";
          }
          ytAI.geoAligned = true; ytAI.geoTop = topMode;
          aligned = true;
        }
      }
      if (!aligned) {
        const ns = nw ? getComputedStyle(nw) : null;
        topMode = !!(nw && nw.classList.contains("ytp-caption-window-top")) || !!(ns && ns.top !== "auto" && ns.bottom === "auto");
        w.style.transition = "";
        w.style.margin = "0";
        w.style.left = "50%";
        w.style.transform = "translateX(-50%)";
        w.style.right = "";
        w.style.width = (nw && nw.style.width) || "max-content";
        w.style.maxWidth = (nw && nw.style.maxWidth) || (ns && ns.maxWidth !== "none" ? ns.maxWidth : "96%");
        w.style.maxHeight = (nw && nw.style.maxHeight) || (ns && ns.maxHeight !== "none" ? ns.maxHeight : "96%");
        w.style.textAlign = "center";
        if (topMode) {
          w.classList.remove("ytp-caption-window-bottom"); w.classList.add("ytp-caption-window-top");
          w.style.top = (nw && nw.style.top) || (ns && ns.top !== "auto" ? ns.top : "0px"); w.style.bottom = "";
        } else {
          w.classList.remove("ytp-caption-window-top"); w.classList.add("ytp-caption-window-bottom");
          w.style.bottom = (nw && nw.style.bottom) || (ns && ns.bottom !== "auto" ? ns.bottom : "2%"); w.style.top = "";
        }
      }
      if (!aligned) { ytAI.geoAligned = false; ytAI.geoTop = topMode; }
      w.style.margin = "0";
      w.style.padding = "0";
      w.style.border = "0";
      w.style.borderRadius = "0";
      w.style.boxShadow = "none";
      w.style.background = "transparent";
      w.style.backgroundColor = "transparent";
      w.style.pointerEvents = "none";
      w.style.visibility = "visible";
      w.style.opacity = "1";
      w.style.zIndex = "10";
      ytAI.win = w;
      return w;
    };

    const ytArmGeometry = () => {
      if (ytAI.geoObs) return;
      const player = ytPlayer();
      if (!player) return;
      try {
        ytAI.geoObs = new MutationObserver(() => {
          if (!ytAI.active || ytAI.geoSched) return;
          ytAI.geoSched = requestAnimationFrame(() => {
            ytAI.geoSched = 0;
            if (ytAI.active) ytEnsure();
          });
        });
        ytAI.geoObs.observe(player, { attributes: true, attributeFilter: ["class", "style"], childList: true, subtree: false });
        const c = ytContainer();
        if (c) ytAI.geoObs.observe(c, { childList: true, subtree: false });
      } catch { ytAI.geoObs = null; }
    };

    let ytMeasureCtx = null;
    const ytGraphemes = text => {
      try { return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(String(text || ""))].map(x => x.segment); }
      catch { return Array.from(String(text || "")); }
    };
    const ytMeasureText = (text, st) => {
      try {
        if (!ytMeasureCtx) ytMeasureCtx = document.createElement("canvas").getContext("2d");
        if (!ytMeasureCtx) throw new Error("no canvas");
        ytMeasureCtx.font = `${st.fontWeight || 400} ${st.fontSize || "20px"} ${st.fontFamily || "sans-serif"}`;
        return ytMeasureCtx.measureText(String(text || "")).width;
      } catch {
        return ytGraphemes(text).length * (parseFloat(st.fontSize) || 20) * 0.52;
      }
    };
    // Uzun simvol/sətir: ən çox 2 balanslı sətir. Sözlər (və ya CJK qrafemləri) ortadan bölünmür.
    const ytLayoutLines = (text, st) => {
      const raw = String(text || "").split("\n").map(ytText).filter(Boolean);
      if (!raw.length) return [];
      const player = ytPlayer();
      const pw = Math.max(1, player?.clientWidth || player?.getBoundingClientRect().width || 760);
      const maxW = Math.max(220, Math.min(1100, pw * 0.86));
      const maxChars = 48;
      const fits = s => ytMeasureText(s, st) <= maxW && ytGraphemes(s).length <= maxChars;
      if (raw.length === 2 && raw.every(fits)) return raw;
      const full = raw.join(" ");
      if (raw.length === 1 && fits(full)) return [full];
      const spaced = /\s/.test(full);
      const units = spaced ? full.split(/\s+/).filter(Boolean) : ytGraphemes(full);
      if (units.length < 2) return [full];
      let best = null, bestScore = Infinity;
      for (let i = 1; i < units.length; i++) {
        const left = units.slice(0, i).join(spaced ? " " : "").trim();
        const right = units.slice(i).join(spaced ? " " : "").trim();
        if (!left || !right) continue;
        // Durğu işarəsi ilə başlayan sətri başlatma (mümkünsə).
        if (spaced && i > 1 && /^[,.;:!?…%\u3002\uFF0C\uFF01\uFF1F]/u.test(right)) continue;
        const lw = ytMeasureText(left, st), rw = ytMeasureText(right, st);
        const lc = ytGraphemes(left).length, rc = ytGraphemes(right).length;
        const over = Math.max(0, lw - maxW) + Math.max(0, rw - maxW) +
          Math.max(0, lc - maxChars) * (parseFloat(st.fontSize) || 20) * 0.6 +
          Math.max(0, rc - maxChars) * (parseFloat(st.fontSize) || 20) * 0.6;
        const score = over * 20 + Math.abs(lw - rw) + Math.abs(lc - rc) * 0.35;
        if (score < bestScore) { bestScore = score; best = [left, right]; }
      }
      return best || [full];
    };

    const ytPaint = text => {
      if (!ytAI.active) return;
      const val = String(text || "").slice(0, 1200);
      const track = ytAI.track || {};
      const dual = !!track.dual;
      // İkili alt yazıya qlobal vizual stil tətbiq olunmur; rənglər trek metadata-sındandır.
      const st = ytTextStyle(dual);
      const key = [st.fontFamily, st.fontSize, st.lineHeight, st.color, st.background, st.fontWeight, st.fontStyle, st.textDecoration, st.textShadow, st.borderRadius, st.padding, st.letterSpacing, st.border, st.boxShadow,
        dual ? "dual" : "", track.id || "", track.topColor || "", track.bottomColor || "", track.topFlag || "", track.bottomFlag || ""].join("|");
      const w0 = ytAI.win;
      if (val === ytAI.lastText && key === ytAI.lastStyleKey) {
        if (!val) { if (w0) w0.style.display = "none"; return; }
        const wr = ytEnsure();
        if (wr) { ytShowStyle(); wr.style.display = "block"; }
        return;
      }
      ytAI.lastText = val; ytAI.lastStyleKey = key;
      if (!val) { if (w0) w0.style.display = "none"; return; }
      const w = ytEnsure();
      if (!w) return;
      ytShowStyle();
      const ct = document.createElement("span");
      ct.className = "captions-text";
      ct.style.cssText = "word-wrap:normal;display:block;";
      const paintColor = (el, color) => {
        const c = String(color || "#ffffff").trim();
        if (/gradient\(/i.test(c)) {
          el.style.backgroundImage = c; el.style.webkitBackgroundClip = "text"; el.style.backgroundClip = "text";
          el.style.color = "transparent"; el.style.webkitTextFillColor = "transparent";
        } else {
          el.style.color = c; el.style.fill = c;
        }
      };
      if (dual) {
        const lines = val.split("\n").slice(0, 2);
        lines.forEach((line, i) => {
          const txt = ytText(line);
          if (!txt) return;
          const color = i === 0 ? (track.topColor || "#ffffff") : (track.bottomColor || "#ffffff");
          const lineEl = document.createElement("span");
          lineEl.className = "caption-visual-line";
          lineEl.style.cssText = "display:block;width:fit-content;margin:0 auto " + (i === 0 ? ".06em" : "0") + ";white-space:pre-wrap;text-align:center;line-height:" + st.lineHeight + ";" +
            "font-family:" + st.fontFamily + ";font-size:" + st.fontSize + ";background:" + st.background + ";padding:" + st.padding + ";";
          const flag = i === 0 ? track.topFlag : track.bottomFlag;
          if (flag) {
            const fs = document.createElement("span");
            fs.textContent = flag;
            fs.style.cssText = "margin-right:.38em;font-family:'Noto Color Emoji','Noto Sans',sans-serif;";
            lineEl.append(fs);
          }
          const ts = document.createElement("span");
          ts.className = "ytp-caption-segment";
          ts.textContent = txt;
          ts.style.cssText = "display:inline;white-space:pre-wrap;background:transparent;padding:0;border:0;box-shadow:none;" +
            "color:" + color + ";" +
            "font-family:" + st.fontFamily + ";font-size:" + st.fontSize + ";line-height:" + st.lineHeight + ";" +
            "font-weight:" + st.fontWeight + ";font-style:" + st.fontStyle + ";text-decoration:" + st.textDecoration + ";text-shadow:" + st.textShadow + ";" +
            "letter-spacing:" + st.letterSpacing + ";";
          paintColor(ts, color);
          lineEl.append(ts);
          ct.append(lineEl);
        });
      } else {
        for (const line of ytLayoutLines(val, st)) {
          if (!line) continue;
          const lineEl = document.createElement("span");
          lineEl.className = "caption-visual-line";
          lineEl.style.display = "block";
          const seg = document.createElement("span");
          seg.className = "ytp-caption-segment";
          seg.textContent = line;
          seg.style.cssText = "display:inline-block;white-space:pre-wrap;box-decoration-break:clone;-webkit-box-decoration-break:clone;" +
            "background:" + st.background + ";color:" + st.color + ";fill:" + st.color + ";" +
            "font-family:" + st.fontFamily + ";font-size:" + st.fontSize + ";line-height:" + st.lineHeight + ";" +
            "font-weight:" + st.fontWeight + ";text-shadow:" + st.textShadow + ";border-radius:" + st.borderRadius + ";" +
            "padding:" + st.padding + ";letter-spacing:" + st.letterSpacing + ";border:" + st.border + ";box-shadow:" + st.boxShadow + ";";
          lineEl.append(seg);
          ct.append(lineEl);
        }
      }
      w.replaceChildren(ct);
      w.style.display = "block";
    };

    const ytShownReset = () => { ytAI.shownKey = ""; ytAI.frameN = 0; };

    const ytSyncMenu = () => {
      for (const p of document.querySelectorAll(".ytp-panel-menu.idm-yt-ai-active")) {
        if (!ytAI.active || p !== ytAI.subPanel) p.classList.remove("idm-yt-ai-active");
      }
      if (ytAI.active && ytAI.subPanel) ytAI.subPanel.classList.add("idm-yt-ai-active");
      for (const [id, row] of ytAI.rows) row.setAttribute("aria-checked", ytAI.active && id === ytAI.activeId ? "true" : "false");
      if (ytAI.offRow) ytAI.offRow.setAttribute("aria-checked", "false");
    };

    const ytStep = () => {
      if (!ytAI.active) return;
      // AI/ikili alt yazı native CC trek tipindən asılı deyil: YouTube-da heç bir
      // caption treki olmayanda CC düyməsi "off" qalır və əvvəl overlay dərhal
      // gizlədilirdi. İndi seçilmiş trek aktiv olduqca göstərilir.
      if (!ytAI.track || !ytAI.cues.length) { ytPaint(""); return; }
      const v = document.querySelector("video");
      if (!v) return;
      const t = (v.currentTime || 0) * 1000;
      let cue = null;
      for (const c of ytAI.cues) {
        if (c.start <= t && t < c.end && c.text) cue = c;
      }
      if (!cue) {
        if (ytAI.lastText) ytPaint("");
        ytAI.shownKey = "";
        return;
      }
      const key = cue.start + "|" + cue.end + "|" + cue.text;
      if (key !== ytAI.shownKey) {
        ytAI.shownKey = key;
        ytPaint(ytCueText(cue.text));
      }
      ytAI.frameN++;
      if (ytAI.frameN % 6 === 0) ytEnsure();
    };

    const ytFrame = () => {
      if (!ytAI.active) { ytAI.raf = 0; return; }
      ytStep();
      if (ytAI.active) ytAI.raf = requestAnimationFrame(ytFrame);
      else ytAI.raf = 0;
    };

    const ytActivateTrack = id => {
      const tr = ytAI.tracks.get(id);
      if (!tr) return;
      ytAI.activeId = id; ytAI.track = tr; ytAI.cues = tr.cues || ytParse(tr.srt);
      ytAI.active = true; ytAI.ccAt = Date.now();
      ytShownReset();
      const menu = document.querySelector(".ytp-settings-menu");
      const menuOpen = !!menu && ytVisible(menu);
      if (menuOpen) {
        const sb = document.querySelector(".ytp-settings-button");
        if (sb) { try { sb.click(); } catch {} }
      }
      // Seçimdən sonra sintetik paneli bağla; növbəti açılışda əsas menyu görünsün.
      ytAI.customOpen = false;
      if (ytAI.customPanel) ytAI.customPanel.style.display = "none";
      if (ytAI.customBase && ytAI.customBase.isConnected) ytAI.customBase.style.display = "";
      ytAI.subPanel = null;
      const b = ytCCButton();
      if (b && b.getAttribute("aria-pressed") !== "true") {
        const turnOn = () => {
          const bb = ytCCButton();
          if (bb && bb.getAttribute("aria-pressed") !== "true") {
            try { bb.click(); } catch {}
            ytAI.ccAt = Date.now();
          }
        };
        if (menuOpen) setTimeout(turnOn, 80); else turnOn();
      }
      ytAI.lastText = ""; ytAI.lastStyleKey = "";
      ytShowStyle(); ytEnsure(); ytArmGeometry(); ytInject(); ytSyncMenu();
      ytStep();
      if (!ytAI.raf) ytAI.raf = requestAnimationFrame(ytFrame);
    };

    const ytDeactivate = () => {
      ytAI.active = false; ytAI.activeId = ""; ytAI.track = null; ytAI.cues = [];
      ytShownReset();
      if (ytAI.raf) { try { cancelAnimationFrame(ytAI.raf); } catch {} ytAI.raf = 0; }
      ytHideStyle(); ytSyncMenu();
      ytAI.lastText = ""; ytAI.lastStyleKey = "";
      if (ytAI.win) ytAI.win.style.display = "none";
    };

    const ytSubPanel = (menu, mainPanel) => {
      // Sintetik alt yazı paneli açıqdırsa yalnız onun öz siyahısına yaz.
      if (ytAI.customOpen && ytAI.customPanel && ytAI.customPanel.isConnected && ytVisible(ytAI.customPanel)) {
        return ytAI.customPanel.querySelector(".ytp-panel-menu");
      }
      const panels = [...menu.querySelectorAll(".ytp-panel-menu")].filter(ytVisible);
      if (ytAI.subPanel && panels.includes(ytAI.subPanel)) return ytAI.subPanel;
      const titles = [...menu.querySelectorAll(".ytp-panel-title")].map(e => e.textContent || "");
      if (titles.some(t => /(?:altyaz|alt\s*yaz|subtitles?|captions?|untertitel|subtítulos|sous-titres|\bcc\b)/i.test(t))) return panels[panels.length - 1] || null;
      const byText = panels.find(p => p !== mainPanel && /(?:otomatik\s*çevir|auto[-\s]*translate|kapalı|\boff\b)/i.test(p.innerText || ""));
      if (byText) return byText;
      // Əsas "Keyfiyyət" panelinə heç vaxt alt yazı sətri yazmırıq.
      return null;
    };

    const ytCreateRow = (id, sample) => {
      let row;
      if (sample) {
        row = sample.cloneNode(true);
        row.querySelectorAll("[id]").forEach(e => e.removeAttribute("id"));
        const lbl = row.querySelector(".ytp-menuitem-label");
        if (lbl) row.replaceChildren(lbl);
        else {
          const l = document.createElement("div"); l.className = "ytp-menuitem-label"; row.replaceChildren(l);
        }
      } else {
        row = document.createElement("div");
        row.className = "ytp-menuitem";
        const l = document.createElement("div"); l.className = "ytp-menuitem-label"; row.append(l);
      }
      row.classList.add("idm-yt-ai-item");
      row.setAttribute("role", "menuitemradio");
      row.setAttribute("tabindex", "0");
      row.removeAttribute("aria-haspopup");
      row.dataset.aiId = String(id);
      row.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); ytActivateTrack(id); });
      row.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); ytActivateTrack(id); } });
      return row;
    };

    const ytSettingsMenu = () => document.querySelector(".ytp-settings-menu");
    const ytBasePanel = menu => {
      if (ytAI.customBase && ytAI.customBase.isConnected && (ytAI.customOpen || ytVisible(ytAI.customBase))) return ytAI.customBase;
      const panels = [...menu.querySelectorAll(".ytp-panel:not(.idm-yt-ai-panel)")];
      // "Keyfiyyət" alt panelinin özü deyil, "Keyfiyyət" sətri olan əsas panel.
      const main = panels.find(p => [...p.querySelectorAll(".ytp-menuitem")].some(e => /(?:keyfiyy|quality)/i.test(e.textContent || "")));
      if (main) return main;
      return panels.find(ytVisible) || panels[0] || menu;
    };
    const ytCloseCustomPanel = () => {
      if (ytAI.customPanel) ytAI.customPanel.style.display = "none";
      const base = ytAI.customBase;
      if (base && base.isConnected) base.style.display = "";
      ytAI.customOpen = false;
      ytAI.subPanel = null;
      ytSyncMenu();
    };
    const ytCustomPanel = (menu, base) => {
      if (ytAI.customPanel && ytAI.customPanel.isConnected) return ytAI.customPanel;
      const panel = document.createElement("div");
      panel.className = "ytp-panel idm-yt-ai-panel";
      panel.style.display = "none";
      const baseHeader = base && base.querySelector(".ytp-panel-header");
      let hdr;
      if (baseHeader) {
        hdr = baseHeader.cloneNode(true);
        hdr.querySelectorAll("[id]").forEach(e => e.removeAttribute("id"));
        hdr.querySelectorAll("[aria-owns],[aria-controls]").forEach(e => { e.removeAttribute("aria-owns"); e.removeAttribute("aria-controls"); });
      } else {
        hdr = document.createElement("div");
        hdr.className = "ytp-panel-header";
      }
      let back = hdr.querySelector(".ytp-panel-back-button");
      if (!back) {
        back = document.createElement("button");
        back.className = "ytp-button ytp-panel-back-button";
        back.setAttribute("aria-label", "Geri");
        back.textContent = "‹";
        hdr.insertBefore(back, hdr.firstChild);
      }
      back.style.cursor = "pointer";
      back.style.display = "inline-block";
      back.removeAttribute("aria-hidden");
      back.setAttribute("tabindex", "0");
      back.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        ytCloseCustomPanel();
      }, true);
      let title = hdr.querySelector(".ytp-panel-title");
      if (!title) {
        title = document.createElement("div");
        title.className = "ytp-panel-title";
        hdr.append(title);
      }
      title.textContent = "Altyazılar / CC";
      const pm = document.createElement("div");
      pm.className = "ytp-panel-menu";
      pm.setAttribute("role", "menu");
      panel.append(hdr, pm);
      menu.append(panel);
      ytAI.customPanel = panel;
      ytAI.customBase = base;
      return panel;
    };
    const ytOpenCustomPanel = () => {
      const menu = ytSettingsMenu();
      if (!menu) return;
      const base = ytBasePanel(menu);
      if (!base) return;
      const panel = ytCustomPanel(menu, base);
      for (const p of menu.querySelectorAll(".ytp-panel")) if (p !== panel) p.style.display = "none";
      ytAI.customBase = base;
      panel.style.display = "";
      ytAI.customOpen = true;
      ytAI.subPanel = panel.querySelector(".ytp-panel-menu");
      setTimeout(ytInject, 0);
    };

    const ytInject = () => {
      const clearRows = () => {
        for (const row of ytAI.rows.values()) { try { row.remove(); } catch {} }
        ytAI.rows.clear();
        if (ytAI.offRow) { try { ytAI.offRow.remove(); } catch {} ytAI.offRow = null; }
      };
      if (!ytAI.tracks.size) {
        clearRows();
        for (const el of document.querySelectorAll(".idm-yt-ai-main")) { try { el.remove(); } catch {} }
        if (ytAI.customPanel) { try { ytAI.customPanel.remove(); } catch {} }
        ytAI.customPanel = null; ytAI.customBase = null; ytAI.customOpen = false;
        ytAI.customMain = false; ytAI.subPanel = null;
        return;
      }
      const menu = ytSettingsMenu();
      if (!menu) { clearRows(); return; }
      if (!ytVisible(menu)) {
        if (ytAI.customOpen) {
          if (ytAI.customPanel) ytAI.customPanel.style.display = "none";
          if (ytAI.customBase && ytAI.customBase.isConnected) ytAI.customBase.style.display = "";
          ytAI.customOpen = false; ytAI.subPanel = null;
        }
        return;
      }
      const base = ytBasePanel(menu);
      const baseMenu = base && base.querySelector(".ytp-panel-menu");
      if (!baseMenu) { clearRows(); return; }

      const items = [...baseMenu.querySelectorAll(".ytp-menuitem")];
      const nativeMain = items.find(el => !el.classList.contains("idm-yt-ai-item") && !el.classList.contains("idm-yt-ai-main") &&
        /(?:altyaz[ıi]|alt\s*yaz[ıi]|subtitles?|captions?|untertitel|subtítulos|sous-titres|\bcc\b)/i.test(el.textContent || ""));
      let mainItem = nativeMain;

      if (nativeMain) {
        ytAI.customMain = false;
        ytAI.customOpen = false;
        for (const el of document.querySelectorAll(".idm-yt-ai-main")) { try { el.remove(); } catch {} }
        if (ytAI.customPanel) { try { ytAI.customPanel.remove(); } catch {} }
        ytAI.customPanel = null; ytAI.customBase = null; ytAI.offRow = null;
        if (!nativeMain._idmAiClick) {
          nativeMain._idmAiClick = true;
          nativeMain.addEventListener("click", () => {
            ytAI.subAt = Date.now() + 2500;
            setTimeout(ytInject, 0); setTimeout(ytInject, 120); setTimeout(ytInject, 360);
          }, true);
        }
      } else {
        // Caption treki olmayan YouTube videolarında "Altyazılar / CC" üçün ayrı
        // native görünüşlü giriş yaradırıq. Onun sətirləri əsas "Keyfiyyət"
        // panelinə YAZILMIR; ayrı alt panel açılır.
        mainItem = baseMenu.querySelector(".idm-yt-ai-main");
        if (!mainItem) {
          const sample = [...baseMenu.querySelectorAll('.ytp-menuitem[aria-haspopup="true"]')].find(e => !e.classList.contains("idm-yt-ai-main"));
          if (sample) {
            mainItem = sample.cloneNode(true);
            mainItem.querySelectorAll("[id]").forEach(e => e.removeAttribute("id"));
            mainItem.querySelectorAll("[aria-owns],[aria-controls]").forEach(e => { e.removeAttribute("aria-owns"); e.removeAttribute("aria-controls"); });
            const content = mainItem.querySelector(".ytp-menuitem-content");
            if (content) content.textContent = "›";
          } else {
            mainItem = document.createElement("div");
            mainItem.className = "ytp-menuitem";
            const l = document.createElement("div"); l.className = "ytp-menuitem-label";
            const c = document.createElement("div"); c.className = "ytp-menuitem-content"; c.textContent = "›";
            mainItem.append(l, c);
          }
          mainItem.classList.add("idm-yt-ai-main");
          mainItem.setAttribute("role", "menuitem");
          mainItem.setAttribute("aria-haspopup", "true");
          const lbl = mainItem.querySelector(".ytp-menuitem-label");
          if (lbl) lbl.textContent = "Altyazılar / CC";
          mainItem.addEventListener("click", ev => {
            ev.preventDefault(); ev.stopPropagation();
            ytOpenCustomPanel();
          }, true);
          baseMenu.insertBefore(mainItem, baseMenu.firstChild);
        }
        ytAI.customMain = true;
        ytAI.customBase = base;
      }

      let target = nativeMain ? ytSubPanel(menu, baseMenu) : (ytAI.customOpen && ytAI.customPanel && ytAI.customPanel.isConnected
        ? ytAI.customPanel.querySelector(".ytp-panel-menu") : null);
      if (!target) {
        // Native alt yazı paneli bağlıdırsa sətirləri gizlət; custom panel isə
        // bağlanana qədər DOM-da qalsın.
        if (!ytAI.customOpen) clearRows();
        return;
      }
      ytAI.subPanel = target;
      const sample = [...target.querySelectorAll('.ytp-menuitem[role="menuitemradio"]')].find(e => !e.classList.contains("idm-yt-ai-item"));
      for (const [id, tr] of ytAI.tracks) {
        let row = ytAI.rows.get(id);
        if (!row || !row.isConnected) {
          row = ytCreateRow(id, sample);
          ytAI.rows.set(id, row);
        }
        const lbl = row.querySelector(".ytp-menuitem-label");
        if (lbl) lbl.textContent = tr.dual ? "İkili dil" : ("Sİ " + (ytLang(tr.lang || tr.label || "") || "Alt yazı"));
      }
      for (const [id, row] of [...ytAI.rows]) {
        if (!ytAI.tracks.has(id)) { try { row.remove(); } catch {} ytAI.rows.delete(id); }
      }

      if (!nativeMain) {
        let off = ytAI.offRow;
        if (!off || !off.isConnected) {
          off = ytCreateRow("__off__", null);
          off.classList.add("idm-yt-ai-off");
          const lbl = off.querySelector(".ytp-menuitem-label");
          if (lbl) lbl.textContent = "Qapalı";
          off.addEventListener("click", ev => {
            ev.preventDefault(); ev.stopImmediatePropagation();
            ytDeactivate(); ytCloseCustomPanel();
          }, true);
          ytAI.offRow = off;
        }
        if (off.parentElement !== target) target.insertBefore(off, target.firstChild);
      }

      const desired = [...ytAI.tracks.keys()].map(id => ytAI.rows.get(id)).filter(Boolean);
      const auto = [...target.querySelectorAll(".ytp-menuitem")].find(e => !e.classList.contains("idm-yt-ai-item") && /(?:otomatik\s*çevir|auto[-\s]*translate)/i.test(e.innerText || ""));
      let same = false;
      if (desired.length) {
        let node = auto ? auto.previousElementSibling : target.lastElementChild;
        const got = [];
        while (node && got.length < desired.length && node.classList && node.classList.contains("idm-yt-ai-item")) {
          got.unshift(node); node = node.previousElementSibling;
        }
        same = got.length === desired.length && got.every((r, i) => r === desired[i]);
      }
      if (!same) {
        for (const row of desired) {
          if (auto) auto.before(row); else target.append(row);
        }
      }
      ytSyncMenu();
    };

    const ytArm = () => {
      ytInject();
      if (!ytAI.mo) {
        try {
          const root = ytPlayer() || document.body;
          ytAI.mo = new MutationObserver(() => {
            if (ytAI.sched) return;
            ytAI.sched = setTimeout(() => { ytAI.sched = 0; ytInject(); }, 120);
          });
          ytAI.mo.observe(root, { childList: true, subtree: true });
        } catch { ytAI.mo = null; }
      }
    };

    const ytCleanup = () => {
      ytDeactivate();
      for (const row of ytAI.rows.values()) { try { row.remove(); } catch {} }
      ytAI.rows.clear();
      for (const el of document.querySelectorAll(".idm-yt-ai-main")) { try { el.remove(); } catch {} }
      if (ytAI.offRow) { try { ytAI.offRow.remove(); } catch {} ytAI.offRow = null; }
      if (ytAI.customPanel) { try { ytAI.customPanel.remove(); } catch {} }
      ytAI.customPanel = null; ytAI.customBase = null; ytAI.customOpen = false;
      ytAI.customMain = false;
      ytAI.tracks.clear();
      ytAI.subPanel = null;
      if (ytAI.win) { try { ytAI.win.remove(); } catch {} ytAI.win = null; }
      if (ytAI.mo) { try { ytAI.mo.disconnect(); } catch {} ytAI.mo = null; }
      if (ytAI.ccObs) { try { ytAI.ccObs.disconnect(); } catch {} ytAI.ccObs = null; ytAI.ccBtn = null; }
      if (ytAI.geoObs) { try { ytAI.geoObs.disconnect(); } catch {} ytAI.geoObs = null; }
      if (ytAI.geoSched) { try { cancelAnimationFrame(ytAI.geoSched); } catch {} ytAI.geoSched = 0; }
      if (ytAI.sched) { clearTimeout(ytAI.sched); ytAI.sched = 0; }
    };

    const ytRemoveTrack = id => {
      ytAI.tracks.delete(id);
      const row = ytAI.rows.get(id);
      if (row) { try { row.remove(); } catch {} ytAI.rows.delete(id); }
      if (ytAI.activeId === id) ytDeactivate();
      if (ytAI.tracks.size) { ytArm(); ytSyncMenu(); }
      else ytCleanup();
    };

    const ytDropForNav = () => {
      ytCleanup();
      ytChClear();
      try { chrome.runtime.sendMessage({ type: "aiResultClearTab" }).catch(() => {}); } catch {}
    };

    const ytUpsertTrack = sub => {
      if (!sub || !sub.srt || !sub.id) return false;
      ytAI.tracks.set(String(sub.id), { ...sub, cues: ytParse(sub.srt) });
      ytAI.videoKey = ytVideoKey();
      return true;
    };

    const ytOpenSubs = () => {
      if (!ytAI.tracks.size) return;
      const menu0 = document.querySelector(".ytp-settings-menu");
      if (!menu0 || !ytVisible(menu0)) {
        const sb = document.querySelector(".ytp-settings-button");
        if (sb) { try { sb.click(); } catch {} }
      }
      setTimeout(() => {
        ytInject();
        const menu = document.querySelector(".ytp-settings-menu");
        if (!menu) return;
        const main = [...menu.querySelectorAll(".ytp-menuitem")].find(el =>
          !el.classList.contains("idm-yt-ai-item") &&
          (el.classList.contains("idm-yt-ai-main") ||
           /(?:altyaz[ıi]|alt\s*yaz[ıi]|subtitles?|captions?|untertitel|subtítulos|sous-titres|\bcc\b)/i.test(el.textContent || "")));
        if (main) { try { main.click(); } catch {} }
        setTimeout(ytInject, 160);
      }, 180);
    };
    const ytAdd = sub => {
      if (!ytUpsertTrack(sub)) return false;
      ytArm();
      ytSyncMenu();
      ytOpenSubs();
      return true;
    };

    const ytSyncTracks = subs => {
      const list = (Array.isArray(subs) ? subs : []).filter(s => s && s.id && s.srt);
      const ids = new Set(list.map(s => String(s.id)));
      for (const s of list) ytUpsertTrack(s);
      for (const id of [...ytAI.tracks.keys()]) if (!ids.has(id)) {
        ytAI.tracks.delete(id);
        const row = ytAI.rows.get(id);
        if (row) { try { row.remove(); } catch {} ytAI.rows.delete(id); }
        if (ytAI.activeId === id) ytDeactivate();
      }
      if (ytAI.tracks.size) { ytArm(); ytOpenSubs(); } else ytCleanup();
      ytSyncMenu();
      return { ok: list.length > 0 && [...ids].every(id => ytAI.tracks.has(id)), count: ytAI.tracks.size };
    };

    // ---- Sİ fəsilləri: YouTube pleyerində panel + cari fəsil + bar üzərində ad + ayar menyusu ----
    const ytChFmt = ms => { const s = Math.max(0, Math.floor((+ms || 0) / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
    let ytChState = null;
    const ytChClear = () => {
      const s = ytChState; ytChState = null;
      try { if (!s) { document.querySelectorAll(".idm-yt-chapters,.idm-yt-ch-tick,.idm-yt-ch-chip,.idm-yt-ch-tip,.idm-yt-ch-mi").forEach(e => e.remove()); return; } } catch {}
      try { s.box && s.box.remove(); } catch {}
      try { s.chip && s.chip.remove(); } catch {}
      try { s.tip && s.tip.remove(); } catch {}
      try { s.ticks.forEach(t => t.el.remove()); } catch {}
      try { s.mo && s.mo.disconnect(); } catch {}
      try { s.video && s.onTime && s.video.removeEventListener("timeupdate", s.onTime); } catch {}
      try { s.barEl && s.onMove && s.barEl.removeEventListener("mousemove", s.onMove); } catch {}
      try { s.barEl && s.onLeave && s.barEl.removeEventListener("mouseleave", s.onLeave); } catch {}
      try { document.querySelectorAll(".idm-yt-ch-mi").forEach(e => e.remove()); } catch {}
    };
    const ytApplyChapters = chapters => {
      try {
        if (!/(?:^|\.)youtube\.com$/i.test(location.hostname)) return { ok: false, error: "Yalnız YouTube" };
        const list = (Array.isArray(chapters) ? chapters : [])
          .map(c => ({ start: Math.max(0, +c.start || 0), title: String(c.title || c.text || "").replace(/\s+/g, " ").trim() }))
          .filter(c => c.title).sort((a, b) => a.start - b.start);
        if (!list.length) return { ok: false, error: "Fəsil yoxdur" };
        ytChClear();
        const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
        if (!player) return { ok: false, error: "YouTube pleyeri tapılmadı" };
        const video = player.querySelector("video") || document.querySelector("video.html5-main-video") || document.querySelector("video");
        try { if (getComputedStyle(player).position === "static") player.style.position = "relative"; } catch {}

        const st = { list, player, video, ticks: [], open: true };
        // ---- panel
        const box = document.createElement("div"); box.className = "idm-yt-chapters";
        box.style.cssText = "position:absolute;right:12px;bottom:64px;z-index:61;width:320px;max-height:56%;overflow:auto;background:rgba(15,15,15,.93);color:#f1f1f1;border:1px solid rgba(255,255,255,.18);border-radius:12px;box-shadow:0 8px 30px #000a;font:13px/1.35 Roboto,Arial,sans-serif";
        const hd = document.createElement("div");
        hd.style.cssText = "position:sticky;top:0;display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(15,15,15,.97);border-bottom:1px solid rgba(255,255,255,.12);font-weight:600";
        const tt = document.createElement("span"); tt.textContent = "Fəsillər"; tt.style.cssText = "flex:1";
        const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.title = "Bağla (yenidən açmaq üçün aşağıdakı «Fəsillər» düyməsi və ya ayarlar)";
        x.style.cssText = "border:0;background:transparent;color:#aaa;font:16px system-ui;cursor:pointer;padding:0 2px";
        x.onclick = ev => { ev.stopPropagation(); setOpen(false); };
        hd.append(tt, x); box.append(hd);
        st.box = box;

        const setOpen = v => { st.open = !!v; box.style.display = st.open ? "block" : "none"; };
        setOpen(true);

        // ---- tərəqqi barı: markerlər + hover-də fəsil adı
        const barEl = player.querySelector(".ytp-progress-bar-container");
        try { if (barEl && getComputedStyle(barEl).position === "static") barEl.style.position = "relative"; } catch {}
        st.barEl = barEl;
        const ticks = list.map(c => {
          const el = document.createElement("div"); el.className = "idm-yt-ch-tick";
          el.style.cssText = "position:absolute;top:0;bottom:0;width:2px;background:rgba(255,255,255,.7);z-index:60;cursor:pointer";
          el.title = ytChFmt(c.start) + " " + c.title;
          el.onclick = ev => { ev.stopPropagation(); ev.preventDefault(); if (video) video.currentTime = c.start / 1000; };
          if (barEl) barEl.append(el);
          return { el, start: c.start };
        });
        st.ticks = ticks;
        const place = () => {
          const d = Math.max(1, video && isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 0);
          for (const tk of ticks) {
            if (tk.start <= 0 || !d) { tk.el.style.display = "none"; continue; }
            tk.el.style.display = "block";
            tk.el.style.left = Math.min(100, Math.max(0, tk.start / d * 100)) + "%";
          }
        };
        place();
        if (video) { try { video.addEventListener("durationchange", place); } catch {} }

        const tip = document.createElement("div"); tip.className = "idm-yt-ch-tip";
        tip.style.cssText = "position:absolute;z-index:62;display:none;pointer-events:none;background:rgba(15,15,15,.95);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;font:600 12px Roboto,Arial,sans-serif;white-space:nowrap";
        st.tip = tip;
        const idxAt = ms => { let i = 0; for (let k = 0; k < list.length; k++) if (list[k].start <= ms) i = k; return i; };
        if (barEl) {
          st.onMove = ev => {
            try {
              const r = barEl.getBoundingClientRect();
              const p = Math.min(1, Math.max(0, (ev.clientX - r.left) / Math.max(1, r.width)));
              const dur = video && isFinite(video.duration) ? video.duration * 1000 : 0;
              if (!dur) return;
              const ms = p * dur, i = idxAt(ms);
              tip.textContent = ytChFmt(list[i].start) + "  " + list[i].title;
              tip.style.display = "block";
              const pr = player.getBoundingClientRect();
              tip.style.left = Math.max(4, Math.min(pr.width - 180, ev.clientX - pr.left - 40)) + "px";
              tip.style.bottom = "70px";
            } catch {}
          };
          st.onLeave = () => { tip.style.display = "none"; };
          barEl.addEventListener("mousemove", st.onMove);
          barEl.addEventListener("mouseleave", st.onLeave);
        }

        list.forEach(c => {
          const b = document.createElement("button"); b.type = "button";
          b.style.cssText = "display:flex;gap:10px;width:100%;text-align:left;align-items:baseline;border:0;background:transparent;color:#f1f1f1;padding:8px 12px;cursor:pointer;font:13px/1.35 Roboto,Arial,sans-serif";
          const ts = document.createElement("span"); ts.textContent = ytChFmt(c.start);
          ts.style.cssText = "flex:none;min-width:42px;color:#3ea6ff;font-variant-numeric:tabular-nums;font-weight:600";
          const nm = document.createElement("span"); nm.textContent = c.title;
          nm.style.cssText = "flex:1;min-width:0;white-space:normal;word-break:break-word";
          b.append(ts, nm);
          b.onmouseenter = () => b.style.background = "#272727";
          b.onmouseleave = () => b.style.background = "transparent";
          b.onclick = () => { if (video) video.currentTime = c.start / 1000; };
          box.append(b);
        });

        // ---- YouTube ayarlar menyusuna "Fəsillər" əlavə et
        const injectMenu = () => {
          try {
            const menu = player.querySelector(".ytp-settings-menu");
            if (!menu || !ytChState) return;
            const disp = getComputedStyle(menu).display;
            if (disp === "none" || menu.offsetParent === null) return;
            const pm = menu.querySelector(".ytp-panel-menu");
            if (!pm || pm.querySelector(".idm-yt-ch-mi")) return;
            const item = document.createElement("div");
            item.className = "ytp-menuitem idm-yt-ch-mi";
            item.setAttribute("role", "menuitem"); item.tabIndex = 0;
            const lbl = document.createElement("div"); lbl.className = "ytp-menuitem-label"; lbl.textContent = "Fəsillər";
            const val = document.createElement("div"); val.className = "ytp-menuitem-content";
            const vs = document.createElement("span"); vs.textContent = st.open ? "Aktiv" : "Söndürülüb";
            vs.style.color = st.open ? "#3ea6ff" : "#aaa"; val.append(vs);
            item.append(lbl, val);
            item.onclick = ev => { ev.stopPropagation(); setOpen(!st.open); vs.textContent = st.open ? "Aktiv" : "Söndürülüb"; vs.style.color = st.open ? "#3ea6ff" : "#aaa"; };
            pm.append(item);
          } catch {}
        };
        try {
          st.mo = new MutationObserver(() => injectMenu());
          st.mo.observe(player, { childList: true, subtree: true });
        } catch {}
        const sb = player.querySelector(".ytp-settings-button");
        if (sb) { try { sb.addEventListener("click", () => setTimeout(injectMenu, 60)); } catch {} }
        injectMenu();

        player.append(box, tip);
        ytChState = st;
        return { ok: true, count: list.length };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    };

    try {
      chrome.runtime.onMessage.addListener((m, _s, reply) => {
        if (!m) return;
        if (m.type === "ytAiAdd") { reply({ ok: ytAdd(m.sub) }); return true; }
        if (m.type === "ytAiSync") { reply(ytSyncTracks(m.subs)); return true; }
        if (m.type === "ytChaptersApply") { reply(ytApplyChapters(m.chapters)); return true; }
        if (m.type === "ytAiRemove") {
          if (m.id) ytRemoveTrack(String(m.id)); else ytCleanup();
          reply({ ok: true }); return true;
        }
        if (m.type === "ytAiClear") { ytCleanup(); reply({ ok: true }); return true; }
      });
    } catch {}

    // YouTube SPA: başqa videoya keçəndə köhnə AI alt yazısı həmin tabda qalmasın.
    ytAI.videoKey = ytVideoKey();
    const ytCheckNav = () => {
      const k = ytVideoKey();
      if (k === ytAI.videoKey) return;
      ytAI.videoKey = k;
      ytDropForNav();
    };
    const ytNavSoon = () => setTimeout(ytCheckNav, 0);
    document.addEventListener("yt-navigate-finish", ytNavSoon, true);
    document.addEventListener("yt-navigate-start", ytNavSoon, true);
    document.addEventListener("yt-page-data-updated", ytNavSoon, true);
    window.addEventListener("popstate", ytNavSoon, true);
    setInterval(ytCheckNav, 1000);

    IDM_VISUAL_WATCHERS.push(() => {
      ytAI.lastStyleKey = ""; ytAI.shownKey = "";
      if (ytAI.active) ytStep();
    });
    document.addEventListener("fullscreenchange", () => { if (ytAI.active) { ytAI.lastText = ""; ytEnsure(); ytStep(); } }, true);
    document.addEventListener("click", e => {
      if (!ytAI.active || !ytAI.subPanel || !e.target || !e.target.closest) return;
      const mi = e.target.closest(".ytp-menuitem");
      if (mi && ytAI.subPanel.contains(mi) && !mi.classList.contains("idm-yt-ai-item")) ytDeactivate();
    }, true);
    // Settings bağlananda sintetik panelin "display" vəziyyəti yadda qalmasın.
    document.addEventListener("click", e => {
      const sb = e.target && e.target.closest && e.target.closest(".ytp-settings-button");
      if (!sb) return;
      setTimeout(() => { if (ytAI.customOpen) ytCloseCustomPanel(); }, 80);
    }, true);
  }

  $b.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); if (cur) startCount(cur); menuOpen ? closeMenu() : openMenu(); });
})();
