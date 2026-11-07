// JDM: birbaşa "file" yükləmələri üçün fayl adı seçimi. Təmiz funksiyalar (chrome/DOM yoxdur, node ilə sınanır).
// Problem: TikTok kimi CDN linklərinin yolu "/" ilə bitir (…/video/tos/…/<token>/?mime_type=video_mp4), ad "video" olur, uzantı yoxdur;
// aria2 təkrar adları video.1 … video.9 kimi nömrələyir. Burada: ad + uzantı birlikdə ağıllı seçilir.
// Qayda: adı artıq media uzantılı və "uydurulmamış" olan sayt linklərinə TOXUNULMUR (işləyən saytlar əvvəlki kimi qalır).
(function (root) {
  const MEDIA_EXT = /\.(?:mp4|m4v|webm|mkv|mov|flv|avi|mp3|m4a|aac|ogg|oga|ogv|opus|wav|flac|3gp|wmv)$/i;
  const WEB_EXT = /\.(?:php\d?|aspx?|jsp|cgi|html?|bin|dat|tmp|txt|json|download|part)$/i;
  const GENERIC = /^(?:video|audio|media|stream|file|index|download|play|player|watch|videoplayback|source|master|manifest|content|data|blob|clip|movie|v|a)$/i;
  const MIME_EXT = {
    "video/mp4": "mp4", "video/x-m4v": "m4v", "video/webm": "webm", "video/quicktime": "mov", "video/x-matroska": "mkv", "video/x-flv": "flv",
    "video/ogg": "ogv", "video/3gpp": "3gp", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
    "audio/ogg": "ogg", "audio/opus": "opus", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/flac": "flac"
  };
  const TWO_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
  const STEM_BYTES = 150;   // fayl sistemi limiti 255 bayt: ad + uzantı + aria2-nin ".N" əlavəsi üçün yer qalır

  const lastSeg = url => { try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch { return ""; } };
  const stemOf = name => String(name || "").trim().replace(MEDIA_EXT, "").replace(WEB_EXT, "").trim();
  const extOf = name => { const m = MEDIA_EXT.exec(String(name || "").trim()); return m ? m[0].slice(1).toLowerCase() : ""; };

  // uzantı: MIME başlığı, sonra URL-dəki mime_type/mime parametri (TikTok: mime_type=video_mp4)
  function extFromHints(url, mime) {
    const m = String(mime || "").split(";")[0].trim().toLowerCase();
    if (MIME_EXT[m]) return MIME_EXT[m];
    try {
      const q = new URL(url).searchParams;
      for (const k of ["mime_type", "mime", "mimetype", "content_type"]) {
        const v = (q.get(k) || "").toLowerCase().replace(/_/g, "/");
        if (MIME_EXT[v]) return MIME_EXT[v];
      }
    } catch {}
    return "";
  }

  // "yarıtmaz" ad: boş, "video" kimi ümumi söz, yalnız rəqəm, çox qısa, kod yığını (hash/token)
  function weakStem(s) {
    s = String(s || "").trim();
    if (!s || s.length <= 2 || GENERIC.test(s) || /^\d+$/.test(s)) return true;
    return !/\s/.test(s) && s.length >= 16 && /\d/.test(s) && /[a-z]/i.test(s) && /^[\w.\-~%=]+$/.test(s);
  }

  function brandOf(pageUrl) {
    try {
      const host = new URL(pageUrl).hostname.replace(/^www\./, "");
      if (/^[\d.]+$/.test(host) || host.includes(":")) return "";   // IP ünvanı: "brend" yoxdur
      const p = host.split(".");
      if (p.length < 2) return "";
      return (p.length >= 3 && p[p.length - 1].length === 2 && TWO_LEVEL.has(p[p.length - 2]) ? p[p.length - 3] : p[p.length - 2]).toLowerCase();
    } catch { return ""; }
  }

  // səhifə başlığından fayl adı. Sayt-səviyyəli ("TikTok - Make Your Day") və ya boş başlıq -> "" (ümumi sayılır, videoya aid deyil)
  function cleanTitle(title, pageUrl) {
    let t = String(title || "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, " ").replace(/\s+/g, " ").trim();
    const brand = brandOf(pageUrl);
    if (brand) {
      const b = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp("^" + b + "\\b", "i").test(t)) return "";   // "TikTok - Make Your Day": bütün saytın başlığıdır
      const on = new RegExp("^(.+?)\\s+on\\s+" + b + "\\s*:\\s*(.+)$", "i").exec(t);   // "Ad on TikTok: mətn"
      if (on) t = on[2].replace(/^["“”']+|["“”']+$/g, "").trim() || on[1];
      t = t.replace(new RegExp("\\s*[|\\-–—·•:]\\s*" + b + "(?:\\.[a-z]{2,6})?\\s*$", "i"), "").trim();   // "... | TikTok"
    }
    return t.length >= 3 ? t : "";
  }

  // Yandex video: başlıq SEO şablonu ilə gəlir ("Ad — Видео от kanal - смотреть онлайн в поиске Яндекса по Видео").
  // HLS/DASH yükləmələrində ad birbaşa bu başlıqdan götürülür: şablon qalsa uzun kiril adı 255 bayt limitini aşır.
  function searchTitle(title, pageUrl) {
    const t = String(title || "").trim();
    try {
      const u = new URL(pageUrl);
      if (/(?:^|\.)yandex\.[a-z.]+$/i.test(u.hostname) && /^\/video\//.test(u.pathname || ""))
        return t.replace(/\s*[—–-]\s*Видео от .*$/i, "").replace(/\s*-\s*смотреть онлайн.*$/i, "").trim() || t;
    } catch {}
    return t;
  }

  const hash36 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  // URL-dən sabit və VİDEOYA XAS identifikator: sorğuda id, yoxsa yolun ən sonuncu uzun tokeni, yoxsa yolun hashı
  function urlId(url) {
    try {
      const u = new URL(url);
      for (const k of ["video_id", "item_id", "aweme_id", "vid", "id"]) { const v = u.searchParams.get(k); if (v && /^[\w-]{6,}$/.test(v)) return v.slice(0, 20); }
      const segs = u.pathname.split("/").filter(Boolean);
      for (let i = segs.length - 1; i >= 0; i--) {
        let s = segs[i]; try { s = decodeURIComponent(s); } catch {}
        s = s.replace(/\.[a-z0-9]{1,4}$/i, "");
        if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s.slice(0, 14);
      }
      return hash36(u.origin + u.pathname);
    } catch { return hash36(String(url)); }
  }

  const capBytes = (s, n) => {
    const enc = new TextEncoder();
    while (s && enc.encode(s).length > n) s = s.slice(0, -1);
    return s.trim();
  };
  function finalName(stem, ext) {
    let s = String(stem || "").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").replace(/[. ]+$/, "");
    s = capBytes(s, STEM_BYTES).replace(/[. ]+$/, "") || "video";
    return s + "." + (ext || "mp4");
  }

  /**
   * item: {name, url}; ctx: {mime, title, pageUrl}
   * Qaytarır: {keep:true} (ada toxunma) və ya {keep:false, stem, ext} (ext boş ola bilər -> çağıran faylın baytlarından təyin edir)
   */
  function plan(item, ctx = {}) {
    const name = String(item.name || "").trim();
    const hasExt = !!extOf(name);
    // ad URL-dən götürülməyib, "video" ehtiyat sözüdür (yol "/" ilə bitir): uzantısı olsa belə yarıtmaz sayılır
    const synthetic = !lastSeg(item.url) && GENERIC.test(stemOf(name));
    const social = (() => { try { return /(?:fbcdn\.net|cdninstagram\.com|tiktokcdn[\w-]*\.com|tiktokv\.com|byteoversea\.com|ibytedtos\.com)$/i.test(new URL(item.url).hostname); } catch { return false; } })();
    if (hasExt && !synthetic && !(social && weakStem(stemOf(name)))) return { keep: true };   // sosial CDN-də kod yığını adı: videoya aid ad seçilir
    const ext = extOf(name) || extFromHints(item.url, ctx.mime);
    const own = stemOf(name);
    let stem = own;
    if (weakStem(own) || synthetic) {
      stem = cleanTitle(ctx.title, ctx.pageUrl) || [brandOf(ctx.pageUrl || item.url) || "video", urlId(item.url)].join("_");
    }
    return { keep: false, stem, ext };
  }

  // Sinxron: uzantı bilinirsə tam ad, yoxsa null (məs. siyahıda göstərmək üçün; real ad yükləmə anında təyin olunur)
  function nameSync(item, ctx) {
    const p = plan(item, ctx);
    return p.keep ? item.name : (p.ext ? finalName(p.stem, p.ext) : null);
  }

  const api = { plan, nameSync, finalName, extFromHints, weakStem, cleanTitle, brandOf, urlId, searchTitle };
  root.IDMNamer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
