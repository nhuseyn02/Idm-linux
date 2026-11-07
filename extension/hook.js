// MAIN dünya (səhifənin öz konteksti), ümumi: ① fetch/XHR cavablarının MƏZMUNU (uzantısız m3u8/mpd/subtitr),
// ② pleyer obyektləri (jwplayer, video.js, hls.js.loadSource), ③ tanınmış qlobal konfiqurasiyalar (playerConfig, __INITIAL_STATE__ ...).
// Tapılanı content.js-ə CustomEvent ilə verir; yükləməyə və səhifənin işinə müdaxilə etmir.
(() => {
  if (window.__idmHook) return;
  window.__idmHook = true;
  const q = [], seen = new Set(), fq = [], fseen = new Set();
  const post = m => { try { document.dispatchEvent(new CustomEvent("__idm_ev", { detail: JSON.stringify(m) })); } catch {} };
  const clean = u => String(u).replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\\//g, "/").replace(/\\+$/, "");
  const abs = u => { try { return new URL(clean(u), location.href).href; } catch { return ""; } };
  // Instagram hekayə DASH seqment paramlarını (bytestart/byteend/range) çıxarıb tam fayl ünvanını verir.
  const canonMedia = u => {
    try {
      const x = new URL(u);
      if (!/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i.test(x.hostname)) return u;
      if (!x.searchParams.has("bytestart") && !x.searchParams.has("byteend") && !x.searchParams.has("range")) return u;
      x.searchParams.delete("bytestart"); x.searchParams.delete("byteend"); x.searchParams.delete("range");
      return x.href;
    } catch { return u; }
  };
  const emit = (type, raw, extra) => {
    const url = abs(raw);
    if (!/^https?:\/\//i.test(url)) return;
    const k = type + "|" + url; if (seen.has(k)) return; seen.add(k);
    const m = { type, url, ...extra }; if (q.length < 300) q.push(m); post(m);
  };
  const emitStream = u => { u = abs(u); if (/\.(?:m3u8?|mpd)(?:[?#]|$)/i.test(u)) emit("stream", u, { kind: /\.mpd(?:[?#]|$)/i.test(u) ? "dash" : "hls" }); };
  const isYtHost = /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com)$/i.test(location.hostname || "");
  const googDirect = u => {
    try {
      const x = new URL(u);
      if (!/(?:^|\.)googlevideo\.com$/i.test(x.hostname) || !/\/videoplayback$/i.test(x.pathname)) return false;
      const q = x.searchParams;
      if (q.has("range") || q.has("rn") || q.has("rbuf")) return false;
      const m = (q.get("mime") || "").toLowerCase();
      return /^(?:video|audio)\//.test(m) || /\b(?:picasa|fife|ph)\b/i.test((q.get("source") || "") + " " + (q.get("app") || "") + " " + (q.get("susc") || ""));
    } catch { return false; }
  };
  const emitFileUrl = (u, force) => {   // force: cavabın Content-Type-ı video/audio-dur (uzantı lazım deyil)
    u = canonMedia(abs(u));
    if (!/^https?:\/\//i.test(u) || SEG_ONLY.test(u)) return;
    if (googDirect(u) && isYtHost) return;   // YouTube səhifəsində googlevideo seqmentləri: səhifə yolu kifayətdir
    if (force || MEDIA_ONE.test(u) || googDirect(u)) emit("file", u, {});
  };
  const emitMedia = u => emitFileUrl(u, false);
  document.addEventListener("__idm_req", () => { q.forEach(post); fq.forEach(it => post({ type: "feeditem", ...it })); });   // content.js sonradan yüklənir: erkən tapılanları istək ilə təkrar göndər

  const M3U = /^\s*#EXTM3U/, MPD = /<MPD[\s>]/i, VTT = /^\uFEFF?\s*WEBVTT/, SRT = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/;
  const STREAM_RE = /https?:\\?\/\\?\/[^"'\s<>]+?\.(?:m3u8|mpd)(?:\?[^"'\s<>]*)?/gi;
  const SUB_RE = /https?:\\?\/\\?\/[^"'\s<>]+?\.(?:vtt|srt|ass|ssa|ttml|dfxp)(?:\?[^"'\s<>]*)?/gi;
  const MEDIA_RE = /https?:\\?\/\\?\/[^"'\s<>]+?\.(?:mp4|m4v|webm|mov|mkv|flv|3gp|m4a|mp3|aac|ogg|oga|opus|flac|wav)(?:\?[^"'\s<>]*)?/gi;
  const GOOG_RE = /https?:\\?\/\\?\/[^"'\s<>]+?googlevideo\.com\/videoplayback[^"'\s<>]*/gi;
  const MEDIA_ONE = /\.(?:mp4|m4v|webm|mov|mkv|flv|3gp|m4a|mp3|aac|ogg|oga|opus|flac|wav)(?:[?#]|$)/i;
  const SEG_ONLY = /\.(?:ts|m4s|cmfv|cmfa)(?:[?#]|$)|(?:\/(?:seg(?:ment)?|chunk|frag(?:ment)?|part|fileSequence)[-_.]?\d+(?:[\/?#.]|$))|[?&](?:bytestart|byteend|frag(?:ment)?|seg(?:ment)?|part|range|rn|rbuf)=/i;
  const SKIP = /\.(?:ts|m4s|mp4|m4v|webm|mkv|jpe?g|png|gif|webp|avif|svg|ico|woff2?|ttf|otf|css|js|mjs|aac|mp3|m4a|cmfv|cmfa|wasm)(?:[?#]|$)/i;
  const BIN = /^(?:image|video|audio|font)\//i;
  const TXT = /json|text\/|javascript|xml/i;
  const OK_CT = /^(?:|text\/(?!event-stream)|application\/(?:json|octet-stream|x-mpegurl|vnd\.apple\.mpegurl|dash\+xml|xml|x-unknown|x-subrip|ttml\+xml|javascript|x-javascript|x-www-form-urlencoded)|binary\/)/i;

  const handle = (url, ct, head, full) => {
    if (M3U.test(head)) return emit("stream", url, { kind: "hls", text: (full || head || "").slice(0, 2_000_000) });
    if (MPD.test(head)) return emit("stream", url, { kind: "dash", text: (full || head || "").slice(0, 2_000_000) });
    if (VTT.test(head) || SRT.test(head)) return emit("sub", url, { seen: true });
    if (/^(?:video|audio)\//i.test(ct)) emitFileUrl(url, true);   // birbaşa media cavabı (googlevideo/Picasa daxil)
    if (full && TXT.test(ct)) {   // JSON/HTML/JS cavabında gömülü m3u8/mpd/subtitr/media linkləri
      for (const m of full.matchAll(STREAM_RE)) emit("stream", m[0], { kind: /\.mpd(?:[?#]|$)/i.test(m[0]) ? "dash" : "hls" });
      for (const m of full.matchAll(SUB_RE)) emit("sub", m[0], { seen: false });
      for (const m of full.matchAll(MEDIA_RE)) emitMedia(m[0]);
      for (const m of full.matchAll(GOOG_RE)) emitFileUrl(m[0], false);
      if (FEEDHOST && /json/i.test(ct)) { try { feedWalk(parseLoose(full)); } catch {} }   // ④ lent API-si
    }
  };
  // Kəsilmiş (cap-a görə tamamlanmamış) JSON-u təhlil etməyə çalışır: ən uzun yararlı prefiksə qaytar
  // və bağlanmayan mötərizələri tamamla. Beləliklə böyük reels_media cavabı da indekslənir.
  const parseLoose = txt => {
    const s = String(txt || "");
    try { return JSON.parse(s); } catch {}
    const cut = s.length > 4000000 ? s.slice(0, 4000000) : s;
    let depth = 0, inStr = false, esc = false, lastGood = -1;
    for (let i = 0; i < cut.length; i++) {
      const c = cut[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") { depth--; if (depth === 0) lastGood = i; }
    }
    const tries = [];
    if (lastGood > 0) tries.push(cut.slice(0, lastGood + 1));
    // Kəsilmiş sətri (yarımçıq "..." içində) təmizlə, sonra bağlanmayan mötərizələri tamamla.
    let cleaned = cut.replace(/,\s*$/, "");
    { let str = false, e = false;
      for (let i = 0; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (str) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') str = false; continue; }
        if (c === '"') str = true;
      }
      if (str) { const q = cleaned.lastIndexOf('"'); cleaned = q >= 0 ? cleaned.slice(0, q) : cleaned; cleaned = cleaned.replace(/[,\s]*$/, ""); }
    }
    const open = [];
    { let str = false, e = false;
      for (const c of cleaned) {
        if (str) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') str = false; continue; }
        if (c === '"') str = true; else if (c === "{" || c === "[") open.push(c); else if (c === "}" || c === "]") open.pop();
      }
    }
    if (open.length) tries.push(cleaned + open.reverse().map(x => (x === "{" ? "}" : "]")).join(""));
    for (const t of tries) { try { return JSON.parse(t); } catch {} }
    return null;
  };
  // mətn olmayan (octet-stream/boş) cavablarda yalnız KİÇİK, ölçüsü məlum olanlar oxunur (manifest ~ KB); böyük/axın cavablarına toxunulmur
  const worth = (url, ct, len) => !SKIP.test(url) && !BIN.test(ct) && OK_CT.test(ct) && len <= 8e6 && (TXT.test(ct) || (len > 0 && len <= 6e5));

  // ---- ① fetch
  const readCap = async (res, cap) => {
    const rd = res.body.getReader(), dec = new TextDecoder(); let out = "", n = 0;
    try { for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; out += dec.decode(value, { stream: true }); if (n >= cap) break; } }
    finally { try { rd.cancel(); } catch {} }
    return out;
  };
  const of = window.fetch;
  window.fetch = function (input) {
    const p = of.apply(this, arguments);
    try {
      p.then(res => {
        try {
          const url = res.url || (input && input.url) || String(input);
          const ct = res.headers.get("content-type") || "", len = +res.headers.get("content-length") || 0;
          if (/^(?:video|audio)\//i.test(ct)) emitFileUrl(url, true);   // brauzerin özü çəkdi: URL kifayətdir
          if (!res.ok || !res.body || !worth(url, ct, len)) return;
          const txt = TXT.test(ct);
          readCap(res.clone(), txt ? (FEEDHOST ? 4e6 : 1.5e6) : 4096).then(t => handle(url, ct, t.slice(0, 2048), txt ? t : "")).catch(() => {});
        } catch {}
      }, () => {});
    } catch {}
    return p;
  };
  // ---- ① XMLHttpRequest
  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { try { this.__idmU = String(u); } catch {} return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("loadend", () => { try { onXhr(this); } catch {} });
    return xs.apply(this, arguments);
  };
  const onXhr = x => {
    if (x.status !== 200 && x.status !== 206) return;
    const url = x.responseURL || new URL(x.__idmU, location.href).href;
    const ct = x.getResponseHeader("content-type") || "", t = x.responseType, txt = TXT.test(ct);
    if (/^(?:video|audio)\//i.test(ct)) emitFileUrl(url, true);
    if (SKIP.test(url) || BIN.test(ct) || !OK_CT.test(ct)) return;
    if (t === "" || t === "text") { const s = x.responseText || ""; if (s.length <= 8e6 && (txt || s.length <= 6e5)) handle(url, ct, s.slice(0, 2048), txt ? s.slice(0, FEEDHOST ? 4e6 : 1.5e6) : ""); }
    else if (t === "arraybuffer" && x.response && x.response.byteLength <= 6e5) handle(url, ct, new TextDecoder().decode(new Uint8Array(x.response, 0, Math.min(2048, x.response.byteLength))), "");
    else if (t === "json" && txt) handle(url, ct, "", JSON.stringify(x.response || "").slice(0, 1.5e6));
    else if (t === "blob" && x.response && x.response.size <= 6e5) x.response.slice(0, 2048).text().then(s => handle(url, ct, s, "")).catch(() => {});
  };

  // ---- ② hls.js: loadSource(url); HTMLMediaElement.src = ".m3u8"
  const wrapHls = H => {
    try {
      const p = H && H.prototype;
      if (!p || p.__idmW || typeof p.loadSource !== "function") return;
      const o = p.loadSource; p.__idmW = 1;
      p.loadSource = function (u) { try { emitStream(u); } catch {} return o.apply(this, arguments); };
    } catch {}
  };
  try {
    let hv = window.Hls;
    Object.defineProperty(window, "Hls", { configurable: true, get: () => hv, set: v => { hv = v; wrapHls(v); } });
    if (hv) wrapHls(hv);
  } catch {}
  // HTMLMediaElement.prototype.src-i yenidən təyin etmirik: Brave bunu bəzən
  // "Cannot redefine property" / "Illegal invocation" kimi qaytarır.
  // Əvəzində media elementinin real hadisələrindən currentSrc oxunur.
  const escMediaEl = el => {
    try {
      if (!el || (el.tagName !== "VIDEO" && el.tagName !== "AUDIO")) return;
      const u = el.currentSrc || el.src || "";
      if (u) { emitStream(u); emitMedia(u); }
    } catch {}
  };
  document.addEventListener("loadstart", e => escMediaEl(e.target), true);
  document.addEventListener("loadedmetadata", e => escMediaEl(e.target), true);
  document.addEventListener("play", e => escMediaEl(e.target), true);

  // ---- ④ Qısa video lentləri (TikTok/Instagram/Facebook): API cavabı və başlanğıc JSON-dakı video elementləri -> feed.js üçün indeks.
  // Video elementinin real mənbəyinin YOLU (…/video/tos/…/<hash>/) ilə eyni videonun id/müəllif/təsviri eşləşdirilir:
  // feed ekranında permalink DOM-da olmasa belə video dəqiq tanınır.
  const FEEDHOST = /(?:^|\.)(?:tiktok|instagram|facebook)\.com$/i.test(location.hostname);
  const pathOf = u => { try { return new URL(u, location.href).pathname; } catch { return ""; } };
  const feedEmit = it => {
    const k = it.site + "|" + (it.id || it.code); if (fseen.has(k)) return; fseen.add(k);
    if (fq.length < 300) fq.push(it); post({ type: "feeditem", ...it });
  };
  const feedWalk = root => {
    let n = 0;
    const urls = (o, out, d) => {
      if (n > 80000 || d > 6 || o == null) return;
      if (typeof o === "string") { if (o.length < 3000 && /^https?:\/\//i.test(o)) out.push(o); return; }
      if (typeof o !== "object") return;
      for (const k in o) { n++; urls(o[k], out, d + 1); }
    };
    const paths = ks => [...new Set(ks.map(pathOf).filter(p => p.length > 8))].slice(0, 12);
    const visit = (o, d) => {
      if (!o || typeof o !== "object" || d > 14 || n++ > 80000) return;
      if (Array.isArray(o)) { for (const x of o) visit(x, d + 1); return; }
      const id = o.id != null ? String(o.id) : "";
      if (/^\d{16,20}$/.test(id) && o.video && typeof o.video === "object") {   // TikTok
        const a = o.author, user = typeof a === "string" ? a : (a && (a.uniqueId || a.unique_id)) || "";
        const ks = []; urls(o.video, ks, 0);
        feedEmit({ site: "tiktok", id, user: String(user || ""), desc: String(o.desc || "").slice(0, 300), paths: paths(ks) });
      } else if (typeof o.code === "string" && /^[\w-]{5,16}$/.test(o.code) && (o.video_versions || o.clips_metadata)) {   // Instagram
        const ks = []; urls(o.video_versions, ks, 0);
        const cap = o.caption && (o.caption.text || o.caption);
        feedEmit({ site: "instagram", code: o.code, user: String((o.user && o.user.username) || ""), desc: typeof cap === "string" ? cap.slice(0, 300) : "", paths: paths(ks) });
      } else if (o.video_versions && (o.pk != null || o.id != null)) {
        // Instagram HEKAYƏ (story): `code` yoxdur — media `pk` ilə tanınır və URL /stories/<user>/<pk>/ formasındadır.
        // `id` bəzən "<pk>_<userid>" və ya ədəd olur; kanonik ədədi pk çıxarılır ki, URL-dəki id ilə üst-üstə düşsün.
        const num = v => { const m = String(v == null ? "" : v).match(/^(\d{5,})/); return m ? m[1] : ""; };
        const id = num(o.pk) || num(o.id);
        if (id) {
          const ks = []; urls(o.video_versions, ks, 0);
          // Video trek(lər)inin TAM (imzalı) URL-lərini də birbaşa axın kimi göndər ki, JDM
          // seçilmiş hekayənin həqiqi media-sını dəqiq tuta bilsin (yalnız yol deyil).
          for (const k of ks) if (/^https?:\/\//i.test(k)) emit("file", k, { json: true });
          if (ks.length) feedEmit({ site: "instagram", code: id, user: String((o.user && o.user.username) || (o.owner && o.owner.username) || ""), desc: "", paths: paths(ks) });
        }
      } else if (o.audio_versions || o.audio_versions_list) {
        // Instagram hekayə SƏS treki ayrı sahədə gələ bilər — onun da tam URL-lərini göndər.
        const ks = []; urls(o.audio_versions || o.audio_versions_list, ks, 0);
        for (const k of ks) if (/^https?:\/\//i.test(k)) emit("file", k, { json: true });
      }
      for (const k in o) { const v = o[k]; if (v && typeof v === "object") visit(v, d + 1); }
    };
    visit(root, 0);
  };
  const feedScripts = () => {
    if (!FEEDHOST) return;
    for (const id of ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE", "__NEXT_DATA__"]) {
      const s = document.getElementById(id);
      if (s && s.textContent && s.textContent.length < 4e6) { try { feedWalk(JSON.parse(s.textContent)); } catch {} }
    }
  };
  document.addEventListener("DOMContentLoaded", feedScripts);

  // ---- ② jwplayer / video.js / ③ qlobal konfiqurasiyalar
  const fromObj = (root, depth = 0, budget = { n: 0 }, vis = new WeakSet()) => {   // məhdud dərinlik/say ilə obyekt ağacında URL axtarışı
    if (!root || typeof root !== "object" || depth > 6 || budget.n > 20000 || vis.has(root)) return;
    vis.add(root);
    let keys; try { keys = Object.keys(root); } catch { return; }
    for (const k of keys) {
      budget.n++; let v; try { v = root[k]; } catch { continue; }
      if (typeof v === "string") {
        if (v.length > 4000 || !/^https?:|^\/\//i.test(v)) continue;
        if (/\.(?:m3u8?|mpd)(?:[?#]|$)/i.test(v)) emitStream(v);
        else if (/\.(?:vtt|srt|ass|ssa|ttml|dfxp)(?:[?#]|$)/i.test(v)) emit("sub", v, { seen: false });
      } else if (v && typeof v === "object") fromObj(v, depth + 1, budget, vis);
    }
  };
  const GLOBALS = ["playerConfig", "__INITIAL_STATE__", "__PRELOADED_STATE__", "__NEXT_DATA__", "__NUXT__", "__playinfo__", "__playerdata__", "flashvars", "playerData", "videoData", "player_config", "jwConfig", "VIDEO_CONFIG"];
  let scans = 0;
  const scan = () => {
    if (scans++ > 12) return;
    feedScripts();
    try { if (typeof window.jwplayer === "function") { const p = window.jwplayer(); if (p && p.getPlaylist) fromObj(p.getPlaylist()); if (p && p.getConfig) fromObj(p.getConfig()); } } catch {}
    try {
      if (window.videojs && typeof window.videojs.getPlayers === "function") for (const pl of Object.values(window.videojs.getPlayers() || {})) {
        if (!pl) continue;
        try { fromObj(pl.currentSources && pl.currentSources()); } catch {}
        try { if (pl.currentSrc) emitStream(pl.currentSrc()); } catch {}
        try { const ts = pl.remoteTextTracks && pl.remoteTextTracks(); if (ts) for (let i = 0; i < ts.length; i++) if (ts[i] && ts[i].src) emit("sub", ts[i].src, { seen: false }); } catch {}
      }
    } catch {}
    for (const n of GLOBALS) { try { if (window[n] && typeof window[n] === "object") fromObj(window[n]); } catch {} }
  };
  [1500, 5000, 12000].forEach(t => setTimeout(scan, t));
  addEventListener("play", () => setTimeout(scan, 300), true);
  addEventListener("load", () => setTimeout(scan, 500));
})();
