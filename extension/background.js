// Fayl adı seçimi (namer.js). Yüklənməsə heç nə pozulmur: köhnə adlandırma işləyir.
try { importScripts("namer.js"); } catch (e) { console.warn("namer.js yüklənmədi, köhnə adlandırma işləyəcək:", e.message); }
// IDM üslubunda request/response metadata sniffer. YouTube məntiqinə toxunmur (sniffer YouTube-u tam skip edir).
try { importScripts("idm-sniffer.js"); } catch (e) { console.warn("idm-sniffer.js yüklənmədi:", e.message); }
// Alt yazı: AI tərcümə/ikili dil/vaxt düzəlişi (ai-subs.js) və ASS bayraqları.
try { importScripts("ai-subs.js"); } catch (e) { console.warn("ai-subs.js yüklənmədi:", e.message); }
try { importScripts("flags-ass.js"); } catch (e) { console.warn("flags-ass.js yüklənmədi:", e.message); }
try { importScripts("ai-features.js"); } catch (e) { console.warn("ai-features.js yüklənmədi:", e.message); }
const HELPER = "http://127.0.0.1:6811";
// Helper imkanları (platforma xüsusiyyətləri). Windows-da mahnı vaxtlandırması (MMS/CTC) dəstəklənmir.
let _helperCaps = { t: 0, songAlign: true };
async function helperCaps() {
  if (Date.now() - _helperCaps.t < 60000) return _helperCaps;
  try {
    const h = await fetch(HELPER + "/health", { signal: AbortSignal.timeout(8000) }).then(r => r.json());
    _helperCaps = { t: Date.now(), songAlign: h.songAlign !== false };
  } catch { _helperCaps = { t: Date.now(), songAlign: true }; }
  return _helperCaps;
}
const DEFAULTS = { enabled: true, intercept: true, overlay: true, subs: true, feedMode: true, vstreams: 0, astreams: 0,
  capTikTok: true, capInstagram: true, capWhatsApp: true, capX: true, capFacebook: true, capTelegram: true };
// Sosial şəbəkə üzrə tutma açarları (Ayarlar → Endirmələr).
const SITE_CAPS = [
  ["capTikTok", /(?:^|\.)tiktok\.com$/i],
  ["capInstagram", /(?:^|\.)instagram\.com$/i],
  ["capWhatsApp", /(?:^|\.)(?:whatsapp\.com|wa\.me)$/i],
  ["capX", /(?:^|\.)(?:x\.com|twitter\.com)$/i],
  ["capFacebook", /(?:^|\.)(?:facebook\.com|fb\.watch|fb\.com)$/i],
  ["capTelegram", /(?:^|\.)(?:t\.me|telegram\.org|telegram\.me)$/i]
];
self.IDM_SITE_ALLOWED = u => {
  let h = "";
  try { h = new URL(u).hostname.toLowerCase(); } catch { return true; }
  for (const [k, re] of SITE_CAPS) if (re.test(h)) return C[k] !== false;
  return true;
};
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav|flac)(?:[?#]|$)/i;
const streamsFor = name => (AUDIO_EXT.test(name || "") ? C.astreams : C.vstreams) || undefined;   // paralel axın sayı (0/boş = standart)
const media = new Map();
const subMedia = new Map();   // tabId -> Map(url -> {url,lang,label,referer,...}): səhifədən aşkarlanan subtitr faylları
const feed = new Map();   // tabId -> { cur, active, videos: Map(key -> {key,site,id,url,title,src,time,...}) } (qısa video lentləri)
const pageProbeCache = new Map();   // `${tabId}|${url}` -> { t, r }: təkrar açılışda keyfiyyətlər dərhal
const mediaEpoch = new Map();       // tabId -> nəsil: player dəyişəndə köhnə async cavabları at
const mediaResetAt = new Map();     // tabId -> son təmizləmə vaxtı (köhnə requestləri qəbul etməmək)
const freshPage = new Map();        // tabId -> məcburi təzə probe vaxtı (rescan/player dəyişməsi)
const stateRev = new Map();         // tabId -> media state nəsli (real-time sinxronizasiya)
const stateTimers = new Map();      // tabId -> debounce timer
const stateCountCache = new Map();  // tabId -> {url,count,t}: son getOptions state sayı
const autoResults = new Map();      // tabId -> {url,t,r}: avtomatik probe nəticəsi
const aiResults = new Map();   // tabId -> [AI/ikili alt yazı nəticələri] (yalnız sessiya)
const ownDownloads = new Set();
const recent = new Set();
let C = { ...DEFAULTS };

// ================= Sİ (AI) =================
const siSubs = new Map();    // tabId -> {url, t, sources:[{url,lang,label,auto}]}
const siActiveSel = new Map(); // tabId -> {t, pageUrl, sel:{...}, stream:{url,kind,name}}
const siWarm = new Map();    // tabId -> son yoxlanılan URL

function siSubsFrom(r) {
  const out = [];
  for (const s of (r && r.subs) || []) {
    const u = String((s && s.url) || "");
    if (!/^https?:/i.test(u)) continue;
    const auto = s.auto === true || s.src === "auto" || /auto|avto/i.test(String(s.label || ""));
    out.push({ url: u, lang: String(s.lang || s.dlang || ""), label: String(s.label || s.name || ""), auto, fmt: s.fmt || s.ext || "" });
  }
  return out;
}
function siDedupe(list) {
  const seen = new Set(), out = [];
  for (const s of list) {
    const k = s.url;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
async function siProbeSubs(tabId, pageUrl) {
  const cookies = await getCookies(pageUrl).catch(() => []);
  const r = await helper("/formats", {
    url: pageUrl, cookies, referer: pageUrl, userAgent: navigator.userAgent, cookie: cookieStr(cookies)
  }, 30000);
  const list = siSubsFrom(r);
  siSubs.set(tabId, { url: pageUrl, t: Date.now(), sources: list });
  return list;
}
function siWarmSubs(tabId, pageUrl) {
  if (!pageUrl || siWarm.get(tabId) === pageUrl) return;
  siWarm.set(tabId, pageUrl);
  siProbeSubs(tabId, pageUrl).then(list => {
    // Menyu növbəti açılışda hazır olsun.
    try { siSetMenuVisible(list.length > 0); } catch {}
  }).catch(() => {});
}
function siPickDefault(list, titleLang) {
  if (!list.length) return null;
  const langOf = s => String((self.IDMAI && self.IDMAI.baseLang(s.lang || s.label || "")) || "").toLowerCase();
  const zip = (arr, lg) => (lg ? arr.find(s => langOf(s) === lg) : null);
  const manual = list.filter(s => !s.auto);
  const auto = list.filter(s => s.auto);
  return zip(manual, titleLang) || manual[0] || zip(auto, titleLang) || auto[0] || list[0];
}
function siInherited(tabId) {
  const a = siActiveSel.get(tabId);
  if (!a || Date.now() - a.t > 30 * 60 * 1000) return null;
  return a;
}
// YouTube səhifəsindəki captionTracks (yt-dlp-dən asılı olmayan sürətli yol).
async function siYouTubeCaptions(pageUrl) {
  const vid = ytVideoIdFromUrl(pageUrl || "");
  if (!vid) return [];
  try {
    const r = await fetch("https://www.youtube.com/watch?v=" + encodeURIComponent(vid) + "&hl=en", {
      credentials: "include", headers: { "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) return [];
    const html = (await r.text()).slice(0, 5_000_000);
    const m = html.match(/"captionTracks":(\[[\s\S]*?\])/);
    if (!m) return [];
    let arr; try { arr = JSON.parse(m[1]); } catch { return []; }
    return arr.map(x => ({
      url: String(x.baseUrl || ""),
      lang: String(x.languageCode || ""),
      label: String((x.name && (x.name.simpleText || (x.name.runs && x.name.runs[0] && x.name.runs[0].text))) || x.languageCode || ""),
      auto: /asr/i.test(String(x.kind || "")) || /auto|avto/i.test(String(x.vssId || "")) || String(x.kind || "") === "asr"
    })).filter(s => /^https?:/i.test(s.url));
  } catch { return []; }
}

async function siSourcesFor(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const pageUrl = tab.url || "";
  const dbg = { pageUrl, cached: false, subMedia: 0, captions: 0, probe: "skip", error: "" };
  const cached = siSubs.get(tabId);
  let list = (cached && cached.url === pageUrl && Date.now() - cached.t < 600000) ? cached.sources.slice() : [];
  dbg.cached = list.length > 0;
  if (!list.length) {
    const sm = siDedupe([...(subMedia.get(tabId)?.values() || [])].map(s => ({
      url: String(s.url || ""), lang: String(s.lang || ""), label: String(s.label || s.name || ""),
      auto: s.auto === true || /auto|avto/i.test(String(s.label || ""))
    })).filter(s => /^https?:/i.test(s.url)));
    dbg.subMedia = sm.length;
    list = sm;
  }
  if (!list.length && isYoutubeTab({ url: pageUrl })) {
    const yt = await siYouTubeCaptions(pageUrl).catch(() => []);
    dbg.captions = yt.length;
    list = yt;
  }
  if (!list.length) {
    try { list = await siProbeSubs(tabId, pageUrl); dbg.probe = "ok:" + list.length; }
    catch (e) { dbg.probe = "fail"; dbg.error = String(e && e.message || e).slice(0, 160); list = []; }
  }
  // Sİ ilə hazırlanmış alt yazılar da mənbə kimi göstərilir.
  try {
    for (const a of (aiResults.get(tabId) || [])) {
      if (!a || !a.srt || !a.id) continue;
      const u = "ai:" + a.id;
      if (list.some(x => x.url === u)) continue;
      list.push({ url: u, lang: String(a.lang || "az"), label: "Sİ · " + String(a.label || a.lang || "AI"),
                  auto: false, ai: true, srt: a.srt, id: a.id });
    }
  } catch {}
  const titleLang = await detectTitleLang(tab.title || "").catch(() => "");
  // YouTube: başlıq dilində avtomatik tərcümə treki (tlang) əlavə et.
  if (titleLang && list.length && isYoutubeTab({ url: pageUrl })) {
    for (const s of list.slice(0, 6)) {
      if (!s.auto || !s.lang || s.lang === titleLang) continue;
      const u = s.url + (s.url.includes("?") ? "&" : "?") + "tlang=" + encodeURIComponent(titleLang);
      if (list.some(x => x.url === u)) continue;
      list.push({ url: u, lang: titleLang, label: (s.label || s.lang) + " → " + titleLang, auto: true });
    }
  }
  const inh = siInherited(tabId);
  let chosen = siPickDefault(list, titleLang);
  // Miras: paneldə seçilmiş alt yazı mənbəyi varsa, onu saxla (yenidən soruşma).
  if (inh && inh.sel && inh.sel.subUrl) {
    const hit = list.find(s => s.url === inh.sel.subUrl);
    if (hit) chosen = hit;
  }
  return { pageUrl, title: tab.title || "", sources: list, selected: chosen ? chosen.url : "", titleLang,
           inherited: inh ? { sel: inh.sel || {}, stream: inh.stream || null, t: inh.t } : null,
           debug: { ...dbg, total: list.length } };
}
// Genişləndir / "i" üçün seçilmiş alt yazının konkret zaman aralığındakı mətni.
const siCueCache = new Map();
async function siCuesFor(tabId, sourceUrl) {
  if (tabId == null) return [];
  const tab = await chrome.tabs.get(tabId);
  const info = await siSourcesFor(tabId);
  const src = info.sources.find(s => s.url === sourceUrl) ||
              info.sources.find(s => s.url === info.selected) ||
              info.sources[0];
  if (!src) return [];
  const key = tabId + "|" + src.url;
  const hit = siCueCache.get(key);
  if (hit && Date.now() - hit.t < 300000) return hit.cues;
  let cues = [];
  try {
    if (src.ai && src.srt) cues = self.IDMAI.parseSubtitle(String(src.srt), "srt");
    else cues = (await fetchAiSubtitle(src, tab.url || "")).cues;
  } catch { cues = []; }
  siCueCache.set(key, { t: Date.now(), cues });
  if (siCueCache.size > 12) { try { siCueCache.delete(siCueCache.keys().next().value); } catch {} }
  return cues;
}
function siContextText(cues, start, end) {
  const a = Math.max(0, (+start || 0) - 1500);
  const b = (+end || 0) + 1500;
  return (cues || [])
    .filter(c => +c.end >= a && +c.start <= b)
    .map(c => String(c.text || "").replace(/\s+/g, " ").trim())
    .filter(Boolean).join(" ").slice(0, 5000);
}

async function siChapters(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const vid = ytVideoIdFromUrl(tab.url || "");
  if (!vid) throw new Error("Bu YouTube videosu deyil");
  const r = await fetch("https://www.youtube.com/watch?v=" + encodeURIComponent(vid) + "&hl=en", {
    credentials: "include", headers: { "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000)
  });
  const html = (await r.text()).slice(0, 6_000_000);
  const re = /"chapterRenderer":\{[\s\S]{0,500}?"simpleText":"((?:[^"\\]|\\.)*)"[\s\S]{0,300}?"timeRangeStartMillis":(\d+)/g;
  const rows = [];
  let m;
  while ((m = re.exec(html))) {
    rows.push({ start: +m[2], title: m[1].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"') });
  }
  if (!rows.length) return { items: [], note: "Bu videoda YouTube native fəsil markerləri yoxdur." };
  rows.sort((a, b) => a.start - b.start);
  const F = self.IDM_AI_FEATURES;
  const items = rows.map((x, i) => ({
    start: x.start,
    end: (rows[i + 1] ? rows[i + 1].start : x.start + 30000),
    title: F.shortTitle(x.title), text: ""
  }));
  return { items, note: "YouTube native fəsilləri" };
}
async function siRunFeature(msg) {
  const F = self.IDM_AI_FEATURES;
  const f = F && F.byId(msg.featureId);
  if (!f) throw new Error("AI xüsusiyyəti tapılmadı (featureId: " + String(msg.featureId || "—") + ")");
  if (!f.native && !f.task) throw new Error("AI xüsusiyyətinin tapşırığı yoxdur: " + f.id + " (kataloqu yeniləyin)");
  if (f.native) {
    const ch = await siChapters(msg.tabId);
    return { ...ch, source: { label: "YouTube", lang: "", auto: false } };
  }
  const tab = await chrome.tabs.get(msg.tabId);
  const pageUrl = tab.url || "";
  const info = await siSourcesFor(msg.tabId);
  const inh = info.inherited;
  const wantUrl = msg.sourceUrl || (inh && inh.sel && inh.sel.subUrl) || "";
  let src = info.sources.find(s => s.url === wantUrl) || info.sources.find(s => s.url === info.selected) || info.sources[0];
  if (!src) throw new Error("Alt yazı mənbəyi yoxdur");
  let parsed = null;
  try {
    if (src.ai && src.srt) {
      const cues = self.IDMAI.parseSubtitle(String(src.srt), "srt");
      parsed = { cues, text: String(src.srt) };
    } else {
      parsed = await fetchAiSubtitle(src, pageUrl);
    }
  } catch (e) { parsed = null; }
  if (!parsed || !parsed.cues || !parsed.cues.length) {
    // YouTube captionTracks URL-ləri bəzən boş qaytarır (PO token). yt-dlp ilə
    // işləyən trekləri alıb eyni dildə yenidən cəhd et.
    const fresh = await siProbeSubs(msg.tabId, pageUrl).catch(() => []);
    const want = String(src.lang || "").toLowerCase();
    const alt = fresh.find(s => String(s.lang || "").toLowerCase() === want) ||
                fresh.find(s => String(s.lang || "").toLowerCase().split("-")[0] === want.split("-")[0]) ||
                fresh[0];
    if (alt) {
      src = alt;
      parsed = await fetchAiSubtitle(alt, pageUrl).catch(() => null);
    }
  }
  if (!parsed || !parsed.cues || !parsed.cues.length) {
    throw new Error("Alt yazı mətni alınmadı (mənbə boş qaytardı). Panelde «⟳ Mənbələri yenilə» basıb yenidən cəhd edin.");
  }
  const cfg = await chrome.storage.local.get(["geminiApiKey", "geminiModel"]);
  if (!cfg.geminiApiKey) throw new Error("Gemini API açarı yoxdur (Ayarlar → Sİ)");
  const ui = await chrome.storage.local.get("uiLang").catch(() => ({}));
  const res = await self.IDMAI.runFeature({
    cues: parsed.cues, feature: f, keyword: msg.keyword || "", searchMode: msg.searchMode || "",
    apiKey: cfg.geminiApiKey, model: cfg.geminiModel,
    lang: ["ru", "en"].includes(ui && ui.uiLang) ? ui.uiLang : "az"
  });
  return { ...res, source: { label: src.label || src.lang || "", lang: src.lang || "", auto: !!src.auto } };
}
async function siExport(msg) {
  const F = self.IDM_AI_FEATURES;
  const items = Array.isArray(msg.items) ? msg.items : [];
  if (!items.length) throw new Error("İxrac üçün seqment yoxdur");
  const format = String(msg.format || "txt").toLowerCase();
  const name = String(msg.name || "Sİ — AI");
  if (["pdf", "docx", "xlsx", "txt", "md"].includes(format)) {
    const r = await helper("/aiexport", { format, name, items }, 180000);
    return { ok: true, path: r.path || "" };
  }
  const text = F.serialize(items, format, { name });
  const ext = ["srt", "vtt", "csv", "json"].includes(format) ? format : "txt";
  const r = await helper("/aisub/file", { text, name, lang: "", ext, dir: "" }, 20000);
  return { ok: true, path: r.path || r.url || "" };
}
async function siCut(msg) {
  const items = Array.isArray(msg.items) ? msg.items : [];
  if (!items.length) throw new Error("Seqment seçilməyib");
  const tab = await chrome.tabs.get(msg.tabId);
  const inh = siInherited(msg.tabId);
  const inhStream = inh && inh.stream && inh.stream.url ? inh.stream : null;
  const all = [...(media.get(msg.tabId)?.values() || [])].filter(i => !okcdnSegment(i.url));
  const pick = (inhStream && (all.find(i => i.url === inhStream.url) || inhStream)) ||
               all.find(i => i.kind === "file" && /mp4|webm|mkv|mov/i.test(i.url)) ||
               all.find(i => i.kind === "hls" || i.kind === "dash") || all[0];
  if (!pick || !pick.url) throw new Error("Bu səhifədə video axını tapılmadı");
  const name = "Sİ — " + String(items[0].title || tab.title || "klip");
  // TƏK iş: bütün seqmentlər itkisiz (stream copy) kəsilir və bir faylda birləşdirilir.
  // Yükləmə ADİ yükləmənin EYNİ mühərriki ilə gedir: format/səs/subtitr seçimləri paneldən miras alınır.
  const sel = (inh && inh.sel) || {};
  const mode = String(sel.mode || "va");
  const pageUrl = tab.url || "";
  const titleLang = await detectTitleLang(tab.title || "").catch(() => "");
  const info2Sources = (await siSourcesFor(msg.tabId).catch(() => ({ sources: [] }))).sources || [];

  const ytPage = isYoutubeTab({ url: pageUrl });
  const cookies = await getCookies(ytPage ? pageUrl : pick.url).catch(() => []);
  const reqHeaders = pick.headers || {};
  const common = ytPage
    ? { referer: pageUrl, userAgent: navigator.userAgent, cookie: cookieStr(cookies), headers: {} }
    : { referer: pick.referer || pageUrl, userAgent: pick.userAgent || navigator.userAgent,
        cookie: pick.cookie || cookieStr(cookies), headers: reqHeaders };

  // Seçilmiş BÜTÜN alt yazılar: əsas paneldən (sel.extSubs) + AI paneldən (msg.subUrls).
  const chosen = (Array.isArray(msg.subUrls) && msg.subUrls.length
    ? msg.subUrls.map(u => (info2Sources.find(s => s.url === u) || { url: u }))
    : []).filter(Boolean);
  const extSubs = [], seenUrls = new Set();
  const addExt = s => {
    if (!s || !s.url || !/^https?:/i.test(s.url) || seenUrls.has(s.url)) return;
    seenUrls.add(s.url);
    extSubs.push({ url: s.url, lang: s.lang || "", label: s.label || "", referer: s.referer || pageUrl,
      fmt: s.fmt || "", keepAss: !!s.keepAss });
  };
  if (Array.isArray(sel.extSubs)) for (const s of sel.extSubs) addExt(s);
  for (const s of chosen) if (s.url && !s.ai) addExt(s);
  const aiSubs = chosen.filter(s => s.ai && s.srt).map(s => ({ lang: s.lang || "aze", srt: s.srt }));
  // Heç bir subtitr gəlmədisə, əsas paneldə seçilmiş tək xarici subtitri götür.
  if (!extSubs.length && !aiSubs.length && sel.subUrl && /^https?:/i.test(sel.subUrl)) {
    addExt({ url: sel.subUrl, lang: sel.subLang || "", label: sel.subLabel || "", referer: pageUrl });
  }
  const subLangs = (Array.isArray(msg.subUrls) && msg.subUrls.length
    ? msg.subUrls.map(u => (info2Sources.find(s => s.url === u) || {}).lang).filter(Boolean)
    : (sel.subLang ? [sel.subLang] : [titleLang || "en"])).filter((v, i, a) => v && a.indexOf(v) === i);
  const needSubs = /s/.test(mode) || extSubs.length > 0 || aiSubs.length > 0 || !!sel.subAll;
  let dlMode = mode;
  if (needSubs) {
    // Subtitr seçilibsə, yükləmə rejimi onu dəstəkləməlidir (Job yalnız SUBMODES-də subtitr çəkir).
    if (!/s/.test(dlMode)) dlMode = ({ v: "vs", a: "as", va: "vas" })[dlMode] || "vas";
  }

  // Seçilmiş BÜTÜN səs trekləri (tək və ya çox). Video+səs rejimində hər trek ayrıca enib birləşdirilir.
  const audioOnly = dlMode === "a" || dlMode === "as";
  const audioNone = !!sel.audioNone && !audioOnly;
  const audioDefaultOnly = !!sel.audioDefault && !audioOnly;
  let audioTracks = (!audioOnly && !audioNone && !audioDefaultOnly && Array.isArray(sel.audioTracks))
    ? sel.audioTracks.filter(t => t && (t.id || t.url)).map(t => ({ id: String(t.id || ""), url: String(t.url || ""), lang: String(t.lang || ""), size: +t.size || 0, est: !!t.est }))
    : [];
  if (audioOnly) {
    const id = String(sel.aa || sel.audio || "").trim(), u = String(sel.aaUrl || sel.audioUrl || "").trim();
    if (id || u) audioTracks = [{ id, url: u, lang: "" }];
  }
  const audioId = audioTracks[0] ? audioTracks[0].id : "";
  const audioUrl = audioTracks[0] ? audioTracks[0].url : "";

  // Format seçicisi: səs trekləri varsa video ən yaxşı seçilir, səslər `audioTracks` ilə ayrıca gəlir.
  const h = (String(sel.quality || "").match(/(\d{3,4})p/) || [])[1] || "";
  let fmt = "";
  if (/va|vas/.test(dlMode)) {
    if (audioNone) fmt = h ? `bv*[height<=${h}]/b[height<=${h}]` : "bv*/b";
    else if (audioTracks.length) fmt = "bv*/b";
    else fmt = h ? `bv*[height<=${h}]+ba/b[height<=${h}]` : "";
  } else if (dlMode === "v" || dlMode === "vs") {
    fmt = h ? `bv*[height<=${h}]/b[height<=${h}]` : "";
  } else if (audioOnly) {
    fmt = audioId;
  }

  const payload = {
    url: pick.url, kind: pick.kind || "file", name, pageUrl,
    ...common, cookies,
    // Format/keyfiyyət: adi yükləmədəki kimi (panel seçimi; yoxdursa Job ən yaxşını götürür).
    format: fmt,
    audio: audioId, audioUrl, audioTracks, audioNone, audioDefault: audioDefaultOnly,
    label: sel.quality || pick.name || "",
    mode: dlMode,
    audioFormat: sel.afmt || "best",
    audioQuality: sel.aq || "",
    subAll: !!sel.subAll, subAuto: !!sel.subAuto, keepSubs: false,
    subLang: (!extSubs.length && !aiSubs.length && !sel.subAll && subLangs.length) ? subLangs[0] : "",
    subs: needSubs,
    subAppearance: (await chrome.storage.local.get("subAppearance").catch(() => ({}))).subAppearance || null,
    // Kəsmə üçün subtitrlər ayrıca fayl kimi gərəkdir (media-ya hopdurulmuş treklər kəsilə bilmir).
    extSubs, aiSubs,
    vStreams: C.vstreams || undefined, aStreams: C.astreams || undefined,
    pageTitle: tab.title || "", title: name, useTitle: true,
    segments: items.map(it => ({ start: Math.max(0, (+it.start || 0) / 1000), end: Math.max(0, (+it.end || 0) / 1000) }))
  };
  if (sel.strat) payload.strat = sel.strat;
  const r = await helper("/sicut", payload, 30000);
  return { ok: true, id: r.id, name: r.name, count: items.length };
}
function siSetMenuVisible(v) {
  try { chrome.contextMenus.update("si-root", { visible: !!v }); } catch {}
}
function siOpenWindow(tabId, featureId) {
  const url = chrome.runtime.getURL("ai.html") + "?tab=" + encodeURIComponent(tabId) + "&f=" + encodeURIComponent(featureId || "");
  // Ən etibarlı yol: yeni tab. Alınmasa — ayrıca pəncərə.
  try {
    chrome.tabs.create({ url, active: true }).catch(() => {
      try { chrome.windows.create({ url, type: "popup", width: 620, height: 760 }); } catch {}
    });
  } catch {
    try { chrome.windows.create({ url, type: "popup", width: 620, height: 760 }); } catch {}
  }
}
async function siOpenPanel(tabId, featureId) {
  try { await chrome.storage.session.set({ siPending: { tabId, feature: featureId, t: Date.now() } }); } catch {}
  // Etibarlı yol: ayrıca AI pəncərəsi (popup API-si bəzi hallarda heç nə göstərmir).
  siOpenWindow(tabId, featureId);
}
// ================= /Sİ (AI) =================

const ready = (async () => {
  C = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  const { media: s, subs: ss, feed: fd } = await chrome.storage.session.get(["media", "subs", "feed"]);
  if (s) for (const [t, arr] of Object.entries(s)) media.set(+t, new Map(arr.map(i => [i.url, i])));
  if (ss) for (const [t, arr] of Object.entries(ss)) subMedia.set(+t, new Map(arr.map(i => [i.url, i])));
  if (fd) for (const [t, o] of Object.entries(fd)) feed.set(+t, { cur: o.cur, active: !!o.active, videos: new Map(o.videos.map(v => [v.key, v])) });
  if (!C.enabled) offBadge();
})();
let pt;
const persist = () => {
  clearTimeout(pt);
  pt = setTimeout(() => chrome.storage.session.set({
    media: Object.fromEntries([...media].map(([t, m]) => [t, [...m.values()]])),
    subs: Object.fromEntries([...subMedia].map(([t, m]) => [t, [...m.values()]])),
    feed: Object.fromEntries([...feed].map(([t, f]) => [t, { cur: f.cur, active: f.active, videos: [...f.videos.values()] }]))
  }), 300);
};
function offBadge() {
  chrome.action.setBadgeText({ text: "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#777" });
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  for (const k in ch) C[k] = ch[k].newValue ?? DEFAULTS[k];
  if (ch.enabled) {
    if (C.enabled) chrome.action.setBadgeText({ text: "" });
    else {
      media.clear(); subMedia.clear(); persist(); offBadge();
      chrome.tabs.query({}).then(ts => ts.forEach(t => badge(t.id, 0)));
    }
  }
});

async function helperRaw(path, body, timeout = 120000) {
  let r;
  try {
    r = await fetch(HELPER + path, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body,
      signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    const stopped = e && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new Error(stopped
      ? `Helper cavab vermədi (${Math.round(timeout / 1000)} s vaxt aşdı)`
      : "Helper işləmir (systemctl --user status idm-linux-v3)");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

async function helper(path, body, timeout = 10000) {
  let r;
  try {
    r = await fetch(HELPER + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    const stopped = e && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new Error(stopped
      ? `Helper cavab vermədi (${Math.round(timeout / 1000)} s vaxt aşdı)`
      : "Helper işləmir (systemctl --user status idm-linux-v3)");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

async function getCookies(url) {
  try {
    return (await chrome.cookies.getAll({ url })).map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate
    }));
  } catch { return []; }
}
const cookieStr = cs => cs.map(x => `${x.name}=${x.value}`).join("; ");

function classify(url, mime) {
  mime = (mime || "").split(";")[0].trim().toLowerCase();
  let ext = "";
  try { ext = new URL(url).pathname.split(".").pop().toLowerCase(); } catch { return null; }
  if (["ts", "m4s", "cmfv", "cmfa", "vtt", "srt"].includes(ext)) return null;
  if (mime === "video/mp2t" || mime === "video/iso.segment") return null;
  if (ext === "m3u8" || ext === "m3u" || mime.includes("mpegurl")) return "hls";
  if (ext === "mpd" || mime.includes("application/dash+xml")) return "dash";
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return "file";
  if (["mp4", "m4v", "webm", "mkv", "mov", "flv", "avi", "3gp", "mp3", "m4a", "m4b", "aac", "ogg", "oga", "opus", "flac", "wav", "weba", "mka"].includes(ext)) return "file";
  return null;
}
function nameFrom(url) {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop()) || "video"; } catch { return "video"; }
}
// ok.ru CDN (okcdn) HLS seqmenti: pleyer bunları <video>/<source> src kimi bildirir
// (".../fn/s131.v.m4s", ".../fn/s392.a.m4s"). Media sayılmır: ffprobe onlarda ilişir və popup cavabı çatmır.
// Yalnız *.okcdn.ru hostu + .m4s/.ts uzantısı — digər heç bir axına təsir etmir.
const okcdnSegment = u => {
  try { const x = new URL(u); return /(?:^|\.)okcdn\.ru$/i.test(x.hostname) && /\.(?:m4s|ts)$/i.test(x.pathname); }
  catch { return false; }
};
// Google Photos/Picasa/fife birbaşa MP4 axını: /videoplayback + mime=video|audio, seqment (range/rn/rbuf) deyil.
function googleDirectUrl(u) {
  try {
    const x = new URL(u);
    if (!/(?:^|\.)googlevideo\.com$/i.test(x.hostname) || !/\/videoplayback$/i.test(x.pathname)) return false;
    const q = x.searchParams;
    if (q.has("range") || q.has("rn") || q.has("rbuf")) return false;
    const mime = (q.get("mime") || "").toLowerCase();
    if (/^(?:video|audio)\//.test(mime)) return true;
    return /\b(?:picasa|fife|ph)\b/i.test((q.get("source") || "") + " " + (q.get("app") || "") + " " + (q.get("susc") || ""));
  } catch { return false; }
}
const googleSizeCache = new Map(), googleSizePending = new Set();
function googleEstimate(u) {   // dəqiq ölçü alınmasa: dur + itag bitrate təxmini (UI-da "~")
  try {
    const q = new URL(u).searchParams, dur = parseFloat(q.get("dur") || "0"), itag = q.get("itag") || "";
    const mbps = ({ 17: 0.05, 18: 0.5, 22: 2.0, 37: 3.0, 38: 4.0, 59: 0.7 })[itag] || 1.5;
    return dur > 0 ? Math.round(dur * mbps * 125000) : 0;
  } catch { return 0; }
}
async function probeGoogleSize(url, hdr) {
  if (!googleDirectUrl(url)) return 0;
  if (googleSizeCache.has(url)) return googleSizeCache.get(url).n;
  for (const m of media.values()) { const it = m.get(url); if (it && it.est === false && it.size > 0) { googleSizeCache.set(url, { n: it.size, est: false }); return it.size; } }
  if (googleSizePending.has(url)) return 0;
  googleSizePending.add(url);
  let n = 0;
  try {
    const r = await withHeaders(url, hdr || {}, () => fetch(url, { headers: { Range: "bytes=0-0" }, credentials: "include", signal: AbortSignal.timeout(8000) }));
    if (r.status === 200 || r.status === 206) {
      const m = /\/(\d+)\s*$/.exec(r.headers.get("content-range") || "");
      if (m) n = parseInt(m[1], 10);
      else if (r.status === 200) n = parseInt(r.headers.get("content-length") || "0", 10) || 0;
    }
    try { r.body && r.body.cancel(); } catch {}
  } catch {} finally { googleSizePending.delete(url); }
  let est = false;
  if (!(n > 0)) { n = googleEstimate(url); est = n > 0; }
  googleSizeCache.set(url, { n, est });
  if (googleSizeCache.size > 300) googleSizeCache.delete(googleSizeCache.keys().next().value);
  if (n > 0) for (const [tid, m] of media) { const it = m.get(url); if (it) { it.size = n; it.est = est; persist(); notifyState(tid, "size"); break; } }
  return n;
}
function badge(tabId, n) {
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#1f9d55" }).catch(() => {});
}
// Media map / feed / subtitr / player dəyişdikdə popup və overlay-ə DƏRHAL xəbər ver.
function notifyState(tabId, reason = "media") {
  if (tabId == null || tabId < 0) return;
  if (["media", "feed", "reset", "url", "subs", "size", "attach"].includes(reason)) autoResults.delete(tabId);
  const rev = (stateRev.get(tabId) || 0) + 1; stateRev.set(tabId, rev);
  clearTimeout(stateTimers.get(tabId));
  stateTimers.set(tabId, setTimeout(() => {
    stateTimers.delete(tabId);
    const m = { type: "mediaStateChanged", tabId, rev, reason };
    try { chrome.runtime.sendMessage(m).catch(() => {}); } catch {}
    try { chrome.tabs.sendMessage(tabId, m).catch(() => {}); } catch {}
  }, 70));
}
function stateCount(tabId, url) {
  const c = stateCountCache.get(tabId);
  return c && (!url || c.url === url) && Date.now() - c.t < 45000 ? c.count : -1;
}
// Player/server/URL dəyişdikdə köhnə media və keşləri təmizlə; yeni nəsil aç.
function clearTabMedia(tabId, signal = false, reason = "") {
  if (tabId < 0) return;
  media.delete(tabId); subMedia.delete(tabId); pageHeads.delete(tabId); bigSniff.delete(tabId);
  for (const k of [...sniffed]) if (k.startsWith(tabId + "|")) sniffed.delete(k);
  mediaEpoch.set(tabId, (mediaEpoch.get(tabId) || 0) + 1);
  mediaResetAt.set(tabId, Date.now());
  stateCountCache.delete(tabId); autoResults.delete(tabId);
  for (const k of [...pageProbeCache.keys()]) if (k.startsWith(tabId + "|")) pageProbeCache.delete(k);
  badge(tabId, 0); persist(); notifyState(tabId, "reset");
  if (signal) { try { chrome.tabs.sendMessage(tabId, { type: "mediaReset", reason }).catch(() => {}); } catch {} }
}
// ---- Səhifədən subtitr faylları (yt-dlp bunları bilmir: <track src=...vtt>, player-in öz .vtt/.srt sorğusu)
const SUB_EXTS = ["vtt", "srt", "ass", "ssa", "ttml", "dfxp"];
const SUB_MIME = /^(text\/vtt|application\/x-subrip|text\/srt|application\/ttml\+xml|application\/x-subtitle)/;
const LANGS = {
  en: "English", tr: "Türkçe", az: "Azərbaycanca", ru: "Русский", ar: "العربية", fa: "فارسی", es: "Español", fr: "Français",
  de: "Deutsch", it: "Italiano", pt: "Português", nl: "Nederlands", pl: "Polski", uk: "Українська", ja: "日本語", ko: "한국어",
  zh: "中文", hi: "हिन्दी", ka: "ქართული", hy: "Հայերեն", kk: "Қазақша", uz: "Oʻzbekcha", ro: "Română", el: "Ελληνικά",
  he: "עברית", sv: "Svenska", cs: "Čeština", hu: "Magyar", bg: "Български", id: "Indonesia", vi: "Tiếng Việt", th: "ไทย"
};
const LANG_ALIAS = {
  eng: "en", english: "en", tur: "tr", turkish: "tr", turkce: "tr", aze: "az", azerbaijani: "az", rus: "ru", russian: "ru",
  ara: "ar", arabic: "ar", fas: "fa", per: "fa", persian: "fa", farsi: "fa", spa: "es", spanish: "es", fra: "fr", fre: "fr", french: "fr",
  deu: "de", ger: "de", german: "de", ita: "it", italian: "it", por: "pt", portuguese: "pt", nld: "nl", dut: "nl", pol: "pl",
  ukr: "uk", jpn: "ja", japanese: "ja", kor: "ko", korean: "ko", zho: "zh", chi: "zh", chinese: "zh", hin: "hi", hindi: "hi"
};
// Dil yalnız AÇIQ işarədən çıxarılır: tam dil adı (english), tam fayl adı (tr.vtt), nöqtəli sonluq (movie.en.vtt),
// "sub/lang/captions" açar sözünün qonşusu (subtitle_tr.srt) və ya qovluq adı (/tr/x.vtt). Tapılmasa boş qalır (uydurulmur).
const LANG_KEYS = ["sub", "subs", "subtitle", "subtitles", "cc", "caption", "captions", "lang", "language"];
function guessLang(url) {
  try {
    const segs = decodeURIComponent(new URL(url).pathname).toLowerCase().split("/").filter(Boolean).slice(-2);
    const file = (segs.pop() || "").replace(/\.[a-z0-9]+$/, ""), dir = segs.pop() || "";
    const code = t => LANGS[t] ? t : /^[a-z]{2}-[a-z]{2,4}$/.test(t) && LANGS[t.split("-")[0]] ? t.split("-")[0] : LANG_ALIAS[t] || "";
    const toks = file.split(/[._\-\s]+/).filter(Boolean);
    for (const t of toks) if (t.length > 3 && LANG_ALIAS[t]) return LANG_ALIAS[t];
    let c = code(file) || (file.includes(".") && code(file.split(".").pop()));
    if (c) return c;
    const ft = file.split(/[_\-\s]+/).filter(Boolean);
    for (let i = 0; i < ft.length; i++) if (LANG_KEYS.includes(ft[i])) { c = code(ft[i + 1] || "") || code(ft[i - 1] || ""); if (c) return c; }
    return code(dir);
  } catch {}
  return "";
}
function isSubResponse(url, mime) {
  let ext = ""; try { ext = new URL(url).pathname.split(".").pop().toLowerCase(); } catch { return false; }
  return SUB_EXTS.includes(ext) || SUB_MIME.test((mime || "").toLowerCase());
}
const subDirs = new Map();   // HLS/DASH seqment .vtt-lərini ayırd etmək üçün: eyni qovluqda çoxlu fayl = seqmentdir
// Səhifə mənbəyində tapılan .vtt/.srt linkləri köhnə/ölü ola bilər: mövcud olmayanı göstərmə
async function looksLikeSub(url) {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-1023" }, credentials: "include", signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const t = (await r.text()).slice(0, 1024).replace(/^\uFEFF/, "").trimStart();
    return /^WEBVTT/.test(t) || /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(t);
  } catch { return false; }
}
// Səhifə subtitrləri: helper faylın İÇİNƏ baxıb dili və növünü (tam / yalnız xüsusi-forced / SDH) müəyyən edir.
// Alınmasa (köhnə helper, şəbəkə, 9 san-dən uzun) subtitrlər əvvəlki kimi qalır; helper nəticəni keşləyir, növbəti açılışda hazır olur.
async function enrichSubs(subs) {
  if (!subs.length) return subs;
  try {
    const list = await Promise.all(subs.slice(0, 40).map(async s => ({ url: s.url, referer: s.referer || "", cookie: cookieStr(await getCookies(s.url)) })));
    const r = await Promise.race([helper("/subinfo", { subs: list, userAgent: navigator.userAgent }, 20000), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 9000))]);
    const by = new Map((r.infos || []).map(i => [i.url, i]));
    const out = [], sig = new Set();
    for (const s of subs) {
      const i = by.get(s.url);
      if (!i) { out.push(s); continue; }
      if (i.seg || i.bad) continue;   // HLS altyazı seqmenti və ya altyazı olmayan cavab (HTML və s.)
      if (!i.cues) { out.push(s); continue; }
      const e = { ...s, dlang: i.dlang || "", dconf: i.dconf || 0, kind: i.kind || "", cues: i.cues, dur: i.dur || 0, mins: i.mins, size: i.size || 0, fmt: i.fmt || "" };
      const k = [e.dlang, e.cues, e.size].join("|"); if (sig.has(k)) continue; sig.add(k);   // eyni dil + sətir + ölçü = eyni fayl (güzgü link)
      out.push(e);
    }
    return out;
  } catch { return subs; }
}
async function addSub(tabId, item) {
  await ready;
  if (!C.enabled || tabId < 0 || !/^https?:/i.test(item.url)) return;
  let path = ""; try { path = new URL(item.url).pathname; } catch { return; }
  const name = path.split("/").pop();
  if (/(?:^|[-_.])(?:seg(?:ment)?|chunk|frag(?:ment)?)[-_.]?\d+/i.test(name)) return;
  const dirKey = tabId + "|" + new URL(item.url).origin + path.slice(0, path.lastIndexOf("/")) + "|" + name.replace(/\d+/g, "#");
  let d = subDirs.get(dirKey); if (!d) subDirs.set(dirKey, d = new Set());
  if (d.size > 12) return;
  d.add(item.url);
  let m = subMedia.get(tabId); if (!m) subMedia.set(tabId, m = new Map());
  if (d.size > 12) { for (const u of d) m.delete(u); persist(); return; }   // seqmentlər: hamısını sil
  if (subDirs.size > 300) subDirs.clear();
  const old = m.get(item.url);
  if (old) { if (!old.referer && item.referer) old.referer = item.referer; return; }
  const lang = item.lang || guessLang(item.url);
  m.set(item.url, { url: item.url, lang, name: decodeURIComponent(name) || "subtitr", label: item.label || LANGS[lang.split("-")[0]] || "", referer: item.referer || "", time: Date.now() });
  if (m.size > 40) m.delete(m.keys().next().value);
  persist(); notifyState(tabId, "subs");
  if (!item.noSib) probeSubSiblings(tabId, item).catch(() => {});
}

// Nömrəli alt yazı (məs. .../1.vtt): eyni qovluqda qonşu nömrələr (0..10) başqa dillər ola bilər, pleyer isə yalnız seçilmişi sorğulayır.
// Məhdud yoxlama: bir qovluq üçün 1 dəfə, ≤10 kiçik sorğu; HLS seqmenti (X-TIMESTAMP-MAP) və ya altyazı olmayan fayl varsa dayanır.
const sibDone = new Set();
async function probeSubSiblings(tabId, item) {
  let u; try { u = new URL(item.url); } catch { return; }
  const m = /^(.*\/)(\d{1,2})\.(vtt|srt)$/i.exec(u.pathname); if (!m) return;
  const key = tabId + "|" + u.origin + m[1]; if (sibDone.has(key)) return;
  sibDone.add(key); if (sibDone.size > 200) sibDone.clear();
  const hdr = { referer: item.referer || "" };
  const head = async url => { try { return decodeHead(await withHeaders(url, hdr, () => readHeadBytes(url, 1024))); } catch { return ""; } };
  const t0 = await head(item.url);
  if (!isSubText(t0) || /X-TIMESTAMP-MAP/i.test(t0)) return;
  const nums = [...Array(11).keys()].filter(n => String(n) !== m[2]), found = [];
  for (let i = 0; i < nums.length; i += 4) {
    const res = await Promise.all(nums.slice(i, i + 4).map(async n => { const url = u.origin + m[1] + n + "." + m[3] + u.search; return [url, await head(url)]; }));
    for (const [url, t] of res) { if (/X-TIMESTAMP-MAP/i.test(t)) return; if (isSubText(t)) found.push(url); }
  }
  for (const url of found) await addSub(tabId, { url, referer: item.referer || "", noSib: true });
}

// ---- Səhifə başlığı snapshot-ı: SPA saytlarda (film seçildikcə başlıq dəyişir) ad "yükləməyə basılan andakı" yox, elementin TUTULDUĞU andakı başlıqdan alınır.
const tabInfo = new Map();   // tabId -> { url, title, at } (at: son url/başlıq dəyişikliyi)
self.IDM_TAB_URL = id => (tabInfo.get(id) || {}).url || "";
chrome.tabs.onUpdated.addListener((id, ch, tab) => {
  if (ch.url === undefined && ch.title === undefined) return;
  const prevUrl = (tabInfo.get(id) || {}).url || "";
  tabInfo.set(id, { url: tab.url || "", title: tab.title || "", at: Date.now() });
  if (ch.url !== undefined && tab.url && prevUrl && tab.url !== prevUrl) {
    const ff = feed.get(id); if (ff) ff.active = false;
    clearTabMedia(id, true, "url");
    freshPage.set(id, Date.now());
    notifyState(id, "url");
  }
  if (ch.title !== undefined) {   // başlıq gec yenilənir: son 8 san-də tutulmuş, EYNİ səhifəyə aid elementlər düzəldilir (əvvəlki filmin elementlərinə toxunulmur)
    const m = media.get(id); let c = false;
    if (m) for (const it of m.values()) if (it.pUrl === tab.url && Date.now() - it.time < 8000 && it.pTitle !== tab.title) { it.pTitle = tab.title || ""; c = true; }
    if (c) { persist(); notifyState(id, "title"); }
  }
});
chrome.tabs.onRemoved.addListener(id => tabInfo.delete(id));
function snapTitle(item, tab) {   // yükləmə/ad üçün başlıq: snapshot > (tutulmadan sonra başlıq dəyişibsə boş: yanlış ad verməkdənsə) > cari başlıq
  const rec = media.get(tab?.id)?.get(item.orig || item.url), ti = tabInfo.get(tab?.id);
  const N = self.IDMNamer, clean = t => (t && N ? N.searchTitle(t, tab?.url || "") : t);
  if (rec && rec.pTitle) return clean(rec.pTitle);
  if (rec && ti && rec.time < ti.at) return "";
  return clean(tab?.title || "");
}

// ---- IDM sniffer metadata: request/response headers, cookie, UA, referer və s. media elementinə birləşdirilir.
function idmApply(item, meta) {
  if (!meta || !item) return item;
  item.idm = { headers: meta.headers || {}, cookie: meta.cookie || "", userAgent: meta.userAgent || "",
    referer: meta.referer || "", origin: meta.origin || "", status: meta.status || 0, mime: meta.mime || "",
    size: meta.size || 0, method: meta.method || "", ip: meta.ip || "", name: meta.name || "" };
  if (!item.referer && meta.referer) item.referer = meta.referer;
  if (!item.origin && meta.origin) item.origin = meta.origin;
  if (!item.cookie && meta.cookie) item.cookie = meta.cookie;
  if (!item.userAgent && meta.userAgent) item.userAgent = meta.userAgent;
  if (!item.headers && meta.headers && Object.keys(meta.headers).length) item.headers = meta.headers;
  if (!item.mime && meta.mime) item.mime = meta.mime;
  if (!item.size && meta.size) { item.size = meta.size; item.est = false; }
  if (!item.name && meta.name) item.name = meta.name;
  return item;
}
async function addMedia(tabId, item) {
  await ready;
  if (!C.enabled) return;
  if (okcdnSegment(item.url)) return;   // okcdn HLS seqmenti: ayrı media deyil (manifest özü kifayətdir)
  const reset = mediaResetAt.get(tabId);
  if (item.reqAt && reset && item.reqAt < reset) return;   // player dəyişməsindən əvvəl başlamış köhnə sorğu
  const pk = `${tabId}|${item.url}`;
  const pm = self.IDM_PENDING && self.IDM_PENDING.get(pk);
  if (pm) { item = idmApply(item, pm); self.IDM_PENDING.delete(pk); }
  let m = media.get(tabId);
  if (!m) { m = new Map(); media.set(tabId, m); }
  const old = m.get(item.url);
  if (old) {
    let changed = false;
    if ((!old.est || item.est === false) && item.size > old.size) { old.size = item.size; if (item.est !== undefined) old.est = item.est; changed = true; }
    if (!old.referer && item.referer) { old.referer = item.referer; changed = true; }
    if (!old.cookie && item.cookie) { old.cookie = item.cookie; changed = true; }
    if (!old.userAgent && item.userAgent) { old.userAgent = item.userAgent; changed = true; }
    if (!old.headers && item.headers) { old.headers = item.headers; changed = true; }
    if (item.jsonSrc && !old.jsonSrc) { old.jsonSrc = true; changed = true; }
    if (item.idm) { old.idm = { ...(old.idm || {}), ...item.idm }; changed = true; }
    persist();
    if (changed) notifyState(tabId, "media");
    return;
  }
  let ti = tabInfo.get(tabId);
  if (!ti && tabId >= 0) { try { const t = await chrome.tabs.get(tabId); tabInfo.set(tabId, ti = { url: t.url || "", title: t.title || "", at: 0 }); } catch {} }
  if (ti && !item.pTitle) { item.pTitle = ti.title; item.pUrl = ti.url; }
  m.set(item.url, item);
  if (m.size > 150) m.delete(m.keys().next().value);
  badge(tabId, m.size);
  persist(); notifyState(tabId, "media");
}
// Snifferin async addMedia-dan əvvəl tapdığı metadata-nı mövcud sətrə birləşdirir.
self.IDM_ATTACH = (tabId, url, meta) => {
  const m = media.get(tabId), it = m && m.get(url);
  if (!it) return;
  idmApply(it, meta);
  persist(); notifyState(tabId, "attach");
};

// Hər sorğunun həqiqi Referer/Origin-i (iframe pleyerdə səhifə ünvanı ilə eyni olmur, CDN bunu yoxlayır)
const reqHdr = new Map();
chrome.webRequest.onSendHeaders.addListener(d => {
  const g = n => (d.requestHeaders.find(x => x.name.toLowerCase() === n) || {}).value || "";
  reqHdr.set(d.requestId, { referer: g("referer"), origin: g("origin") });
  if (reqHdr.size > 400) reqHdr.delete(reqHdr.keys().next().value);
}, { urls: ["<all_urls>"] }, ["requestHeaders", "extraHeaders"]);

// Uzantısız / "text/plain" / "octet-stream" kimi gizlədilmiş m3u8 və mpd-ləri məzmununa görə tanı
const sniffed = new Set();   // `${tabId}|${url}` (eyni URL başqa tabda yenidən yoxlana bilsin)
const manText = new Map();   // url -> playlist mətni (sniff zamanı alınıb)
const sniffKey = d => (d && d.tabId >= 0 ? d.tabId + "|" : "w|") + String(d && d.url || "");
const SNIFF_N = 262144;
const SNIFF_MIME = /^(|text\/plain|application\/octet-stream|binary\/octet-stream|application\/x-unknown)$/;
// ---- Məzmun yoxlaması (sniff). Sorğu başlıqları (Referer/Origin) declarativeNetRequest ilə hazırlanır;
// alınmasa (CORS/cookie) səhifənin öz kontekstində cookie ilə təkrar cəhd edilir.
let ruleSeq = 0;
async function withHeaders(url, hdr, fn) {
  const headers = [];
  if (hdr && hdr.referer) headers.push({ header: "Referer", operation: "set", value: hdr.referer });
  if (hdr && hdr.origin) headers.push({ header: "Origin", operation: "set", value: hdr.origin });
  if (!headers.length || /[*^|]/.test(url)) return fn();
  const id = 1000 + (ruleSeq = (ruleSeq + 1) % 50000);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id], addRules: [{ id, priority: 1,
      action: { type: "modifyHeaders", requestHeaders: headers },
      condition: { urlFilter: "|" + url + "|", resourceTypes: ["xmlhttprequest", "other"], tabIds: [-1] } }] });
  } catch { return fn(); }
  try { return await fn(); }
  finally { chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {}); }
}
// Cavabın yalnız ilk n baytı oxunur (Range-ı dəstəkləməyən serverdə də bütün faylı yükləmir)
async function readHeadBytes(url, n = 4096) {
  const r = await fetch(url, { headers: { Range: "bytes=0-" + (n - 1) }, credentials: "include", signal: AbortSignal.timeout(6000) });
  if (!r.ok || !r.body) return new Uint8Array(0);
  const rd = r.body.getReader(), parts = []; let len = 0;
  while (len < n) { const { done, value } = await rd.read(); if (done) break; parts.push(value); len += value.length; }
  rd.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(len, n)); let o = 0;
  for (const p of parts) { const take = Math.min(p.length, out.length - o); out.set(p.subarray(0, take), o); o += take; if (o >= out.length) break; }
  return out;
}
const pageHeads = new Map();   // tabId -> səhifə kontekstində cəhd sayı (məhdud)
async function pageHead(tabId, url, n = 4096) {
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, args: [url, n], func: async (u, n) => {
      try {
        const r = await fetch(u, { headers: { Range: "bytes=0-" + (n - 1) }, credentials: "include" });
        if (!r.ok || !r.body) return null;
        const rd = r.body.getReader(), out = []; let len = 0;
        while (len < n) { const { done, value } = await rd.read(); if (done) break; for (const x of value) { if (len++ < n) out.push(x); } }
        rd.cancel().catch(() => {});
        return out;
      } catch { return null; }
    } });
    for (const x of res || []) if (x && x.result && x.result.length) return new Uint8Array(x.result);
  } catch {}
  return new Uint8Array(0);
}
function decodeHead(b) {   // UTF-8 / UTF-16 (BOM və ya sıfır baytlarından) / tək baytlı kodlaşdırmalar: işarələr ASCII olduğu üçün tanınır
  if (!b.length) return "";
  let enc = "utf-8", s = 0;
  if (b[0] === 0xFF && b[1] === 0xFE) { enc = "utf-16le"; s = 2; }
  else if (b[0] === 0xFE && b[1] === 0xFF) { enc = "utf-16be"; s = 2; }
  else if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) s = 3;
  else if (b.length > 8 && b[1] === 0 && b[3] === 0 && b[0] !== 0) enc = "utf-16le";
  else if (b.length > 8 && b[0] === 0 && b[2] === 0 && b[1] !== 0) enc = "utf-16be";
  try { return new TextDecoder(enc, { fatal: false }).decode(b.subarray(s)).replace(/^\uFEFF/, ""); } catch { return ""; }
}
// Uzantısız / MIME-sız birbaşa media: "sehrli" baytlara görə (MP4/M4A, WebM, FLV, OGG, FLAC, WAV, MP3)
function magicKind(b) {
  if (b.length < 12) return "";
  const at = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (at(4, "ftyp")) return /^M4[AB]/.test(String.fromCharCode(b[8], b[9], b[10])) ? "m4a" : "mp4";
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return "webm";
  if (at(0, "FLV") && b[3] === 1) return "flv";
  if (at(0, "OggS")) return "ogg";
  if (at(0, "fLaC")) return "flac";
  if (at(0, "RIFF") && at(8, "WAVE")) return "wav";
  if (at(0, "ID3") || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0 && (b[1] & 0x18) !== 0x08 && (b[1] & 0x06) !== 0 && (b[2] >> 4) !== 0xF && ((b[2] >> 2) & 3) !== 3)) return "mp3";
  return "";
}
const PLAY_MIX_RE = /(?:^|\.)playmix\.uno$/i;
function playmixHeaders(url, hdr) {
  try {
    const host = new URL(url).hostname;
    if (!PLAY_MIX_RE.test(host)) return hdr || {};
    let rh = "";
    try { rh = new URL((hdr && hdr.referer) || "").hostname; } catch {}
    if (!PLAY_MIX_RE.test(rh)) return { ...(hdr || {}), referer: `https://${host}/`, origin: `https://${host}` };
  } catch {}
  return hdr || {};
}
const isSubText = t => /^\s*WEBVTT/.test(t) || /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(t) || /^\s*\[Script Info\]/i.test(t)
  || (/^\s*(?:<\?xml[^>]*>\s*)?</.test(t) && /<tt[\s>:]|<p\s[^>]*\bbegin=|<(?:subtitle|dialog)s?[\s>]/i.test(t.slice(0, 4096)));   // TTML/DFXP və XML altyazılar
async function sniffAndAdd(d, hdr, opt = {}) {
  hdr = playmixHeaders(d.url, hdr);
  const sk = sniffKey(d);
  if (sniffed.has(sk)) return;
  sniffed.add(sk); if (sniffed.size > 500) sniffed.clear();
  // Rescan-də media silinsə də əvvəl oxunmuş HLS mətni ilə dərhal bərpa et
  const cached = manText.get(d.url);
  if (cached && /^\s*#EXTM3U/.test(cached)) {
    addMedia(d.tabId, { url: d.url, kind: "hls", mime: "", size: 0, name: nameFrom(d.url), time: Date.now(),
      referer: (hdr && hdr.referer) || "", origin: (hdr && hdr.origin) || "" });
    return;
  }
  try {
    let b = new Uint8Array(0);
    try { b = await withHeaders(d.url, hdr, () => readHeadBytes(d.url, SNIFF_N)); } catch {}
    if (!b.length && d.tabId >= 0 && (pageHeads.get(d.tabId) || 0) < 12) {
      pageHeads.set(d.tabId, (pageHeads.get(d.tabId) || 0) + 1);
      b = await pageHead(d.tabId, d.url, SNIFF_N);
    }
    if (!b.length) return;
    const t = decodeHead(b);
    const kind = /^\s*#EXTM3U/.test(t) ? "hls" : /<MPD[\s>]/i.test(t) ? "dash" : null;
    if (kind === "hls" && b.length < SNIFF_N) { manText.set(d.url, t); if (manText.size > 150) manText.delete(manText.keys().next().value); }
    if (kind) addMedia(d.tabId, { url: d.url, kind, mime: "", size: 0, name: nameFrom(d.url), time: Date.now(), referer: hdr.referer, origin: hdr.origin });
    else if (isSubText(t)) addSub(d.tabId, { url: d.url, referer: hdr.referer });   // uzantısız / "text/plain" altyazı
    else {
      const mk = magicKind(b);
      if (mk && (!opt.size || opt.size >= 150 * 1024)) {
        let name = nameFrom(d.url); if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += "." + mk;
        addMedia(d.tabId, { url: d.url, kind: "file", mime: "", size: opt.size || 0, name, time: Date.now(), referer: hdr.referer, origin: hdr.origin });
      }
    }
  } catch {}
}
// Content-Disposition: attachment; filename="x.mp4" -> fayl adı
function cdName(v) {
  if (!v) return "";
  let m = /filename\*\s*=\s*(?:utf-8)?'[^']*'([^;]+)/i.exec(v);
  if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, "")); } catch {} }
  m = /filename\s*=\s*"?([^";]+)"?/i.exec(v);
  return m ? m[1].trim() : "";
}
const SNIFF_TYPES = ["xmlhttprequest", "media", "other", "sub_frame", "main_frame", "object"];
const bigSniff = new Map();   // tabId -> böyük "gizli" fayl yoxlamalarının sayı (məhdud)
// URL-də axın/altyazı ipucu: belə sorğular (text/html, json, octet-stream və s. MIME ilə də olsa) məzmununa görə yoxlanır
const URL_HINT = /(?:m3u8?|mpegurl|\/hls\b|\/(?:list|stream|source|sources)\/[^\/?#]{12,}|playlist|master|manifest|chunklist|\/dash\b|\/subs?(?:title|titles)?\b|caption|vtt|srt|[?&](?:lang|language|label)=|(?:master|manifest|playlist|index|video|audio)[\w.\-]*\.(?:txt|json)(?:[?#]|$)|stream\.php|^https?:\/\/[^\/]*(?:hls|dash)[^\/]*\/)/i;
const STRONG_M3U = /\/m3u8?(?:[\/?#]|$)/i;

function onHeaders(d) {
  if (d.statusCode !== 200 && d.statusCode !== 206) return;
  let host; try { host = new URL(d.url).hostname; } catch { return; }
  if (/(?:^|\.)googlevideo\.com$/i.test(host)) {
    let ih = "", th = "";
    try { ih = new URL(d.initiator || "").hostname; } catch {}
    try { th = new URL((tabInfo.get(d.tabId) || {}).url || "").hostname; } catch {}
    const yt = /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com)$/i.test(ih) || /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com)$/i.test(th);
    if (yt || !googleDirectUrl(d.url)) return;
  }
  const h = n => (d.responseHeaders.find(x => x.name.toLowerCase() === n) || {}).value;
  const mime = h("content-type");
  const cdn = cdName(h("content-disposition"));
  const hdr = playmixHeaders(d.url, reqHdr.get(d.requestId) || { referer: "", origin: "" });
  let size = parseInt(h("content-length") || "0", 10);
  if ((isSubResponse(d.url, mime) || (cdn && SUB_EXTS.includes(cdn.split(".").pop().toLowerCase()))) && (!size || size < 3 * 1024 * 1024)) { addSub(d.tabId, { url: d.url, referer: hdr.referer }); return; }
  const cr = h("content-range");
  if (cr) { const m = cr.match(/\/(\d+)$/); if (m) size = parseInt(m[1], 10); }
  let kind = classify(d.url, mime), viaCd = "";
  if (!kind && cdn) { try { kind = classify(new URL("/" + encodeURIComponent(cdn), d.url).href, mime); if (kind) viaCd = cdn; } catch {} }
  if (!kind) {
    const m0 = (mime || "").split(";")[0].trim().toLowerCase();
    const hinted = URL_HINT.test(d.url) && (/^(text\/(?!css|javascript)|application\/(json|xml|octet-stream|x-|vnd\.))/.test(m0) || (m0 === "text/html" && STRONG_M3U.test(d.url)));
    if (SNIFF_TYPES.includes(d.type) && (SNIFF_MIME.test(m0) || hinted) && (!size || size < 2 * 1024 * 1024))
      sniffAndAdd(d, hdr, { size });
    else if (["xmlhttprequest", "media", "other", "object"].includes(d.type) && size >= 2 * 1024 * 1024 && (!!cr || /bytes/i.test(h("accept-ranges") || ""))
      && /^(|image\/|application\/(octet-stream|x-|force-download)|binary\/|text\/plain)/.test(m0) && (bigSniff.get(d.tabId) || 0) < 30) {
      bigSniff.set(d.tabId, (bigSniff.get(d.tabId) || 0) + 1);   // MIME-ı yalan olan (şəkil/octet-stream kimi göstərilən) böyük media
      sniffAndAdd(d, hdr, { size });
    }
    return;
  }
  if (kind === "file" && size && size < (/(?:video|audio)\//i.test(mime || "") ? 20 * 1024 : 150 * 1024)) return;
  const gd = kind === "file" && googleDirectUrl(d.url);
  // Instagram hekayə DASH seqmenti (bytestart/byteend) tam fayl ünvanına çevrilir ki, media sətri
  // həqiqi tam URL ilə görünsün və yüklənsin.
  const canon = kind === "file" ? canonicalMediaUrl(d.url) : d.url;
  const add = addMedia(d.tabId, { url: canon, kind, mime, size, name: viaCd || nameFrom(canon), time: Date.now(), reqAt: d.timeStamp, referer: hdr.referer, origin: hdr.origin,
    est: gd ? !(!!cr || d.statusCode === 200) : undefined });
  if (kind === "file" && googleDirectUrl(d.url)) add.then(() => probeGoogleSize(d.url, hdr)).catch(() => {});
}
chrome.webRequest.onHeadersReceived.addListener(d => {
  if (d.tabId >= 0) return onHeaders(d);
  // Web Worker / Service Worker sorğuları tabId=-1 verir (bəzi pleyerlər seqmentləri orada yükləyir): aktiv tabə bağla
  if (!/^https?:/i.test(d.initiator || "")) return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(ts => { if (ts[0] && ts[0].id >= 0) onHeaders({ ...d, tabId: ts[0].id }); }).catch(() => {});
}, { urls: ["<all_urls>"] }, ["responseHeaders"]);

chrome.webNavigation.onCommitted.addListener(d => {
  if (d.frameId !== 0) return;
  clearTabMedia(d.tabId, false);
  freshPage.set(d.tabId, Date.now());   // tam yüklənmə: ilk probe keşi keçsin
  const ff = feed.get(d.tabId); if (ff) ff.active = false;   // tam yüklənmə: feed.js yenidən bildirənə qədər köhnə yol
  persist(); notifyState(d.tabId, "navigation");
});
chrome.tabs.onRemoved.addListener(id => { media.delete(id); subMedia.delete(id); feed.delete(id); freshPage.delete(id); mediaResetAt.delete(id); mediaEpoch.delete(id); stateRev.delete(id); stateCountCache.delete(id); autoResults.delete(id); clearTimeout(stateTimers.get(id)); stateTimers.delete(id); for (const k of [...feedFormats.keys()]) if (k.startsWith(id + "|")) feedFormats.delete(k); persist(); });

// Birbaşa fayl adı. Adı artıq media uzantılı olan linklərə toxunmur. Uzantı yoxdursa: MIME / URL (mime_type=video_mp4) / faylın ilk baytları.
async function fileNameFor(item, tab) {
  const N = self.IDMNamer;
  if (!N) return item.name;
  try {
    const ctx = { mime: media.get(tab?.id)?.get(item.url)?.mime || item.mime || "", title: snapTitle(item, tab), pageUrl: tab?.url || "" };
    const p = N.plan(item, ctx);
    if (p.keep) return item.name;
    let ext = p.ext;
    if (!ext) { try { ext = magicKind(await withHeaders(item.url, { referer: item.referer || ctx.pageUrl }, () => readHeadBytes(item.url, 64))); } catch {} }
    return N.finalName(p.stem, ext || "mp4");
  } catch (e) { console.warn("fileNameFor:", e.message); return item.name; }
}

// ---- Telegram Web: media URL-ləri (/k/stream/{json}, /a/progressive/..., blob:) serverdə yoxdur, səhifənin service worker-i verir.
// aria2/yt-dlp bunları kənardan çəkəndə 302 (yer başlığı olmadan) alır -> yükləmə səhifənin öz kontekstində (SW üzərindən) edilir.
const TG_HOST = /(?:^|\.)telegram\.org$/i;
function isTgVirtual(url, tab) {
  try {
    const u = new URL(url);
    if (u.protocol === "blob:") return TG_HOST.test(new URL(tab?.url || "").hostname);
    return TG_HOST.test(u.hostname) && /\/(?:stream|progressive)\//i.test(u.pathname);
  } catch { return false; }
}
// WhatsApp/X: blob (və WhatsApp CDN) URL-ləri səhifə kontekstində açılır; helper-ə göndərilsə 400 olur.
const PAGE_MEDIA_HOST = /(?:^|\.)(?:telegram\.org|whatsapp\.com|x\.com|twitter\.com)$/i;
function isPageVirtual(url, tab) {
  if (isTgVirtual(url, tab)) return true;
  try {
    const u = new URL(url), th = new URL(tab?.url || "").hostname;
    if (u.protocol === "blob:") return PAGE_MEDIA_HOST.test(th);
    if (/(?:^|\.)whatsapp\.com$/i.test(th) && /(?:^|\.)whatsapp\.(?:com|net)$/i.test(u.hostname)) return true;
    return false;
  } catch { return false; }
}
// WhatsApp/Telegram/other page-context (blob, SW Range) media: page fetch -> helper upload.
// The browser's own download anchor is NOT used here; all bytes go to the internal manager.
function b64Bytes(b64) {
  const s = atob(String(b64 || "")); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function pageFetchChunk(tabId, url, start, end) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", args: [url, start, end], func: async (u, a, b) => {
    try {
      // blob: Range adətən dəstəklənmir. Blobu səhifədə bir dəfə yadda saxla, sonra slice et.
      if (String(u).startsWith("blob:")) {
        const w = window; w.__idmPageBlobs = w.__idmPageBlobs || {};
        let bl = w.__idmPageBlobs[u];
        if (!bl) { const fr = await fetch(u, { credentials: "include", cache: "no-store" }); bl = await fr.blob(); w.__idmPageBlobs[u] = bl; }
        const end = Math.min(bl.size, b + 1), part = bl.slice(Math.min(a, bl.size), end);
        const ab = await part.arrayBuffer(); const v = new Uint8Array(ab);
        let bin = ""; const CH = 0x8000;
        for (let i = 0; i < v.length; i += CH) bin += String.fromCharCode(...v.subarray(i, i + CH));
        return { status: 206, cr: `bytes ${a}-${Math.max(a, end - 1)}/${bl.size}`, ct: bl.type || "",
          len: v.length, b64: btoa(bin) };
      }
      const r = await fetch(u, { headers: { Range: `bytes=${a}-${b}` }, credentials: "include", cache: "no-store" });
      const ab = await r.arrayBuffer(); const v = new Uint8Array(ab);
      const ct = r.headers.get("content-type") || "";
      if (r.status === 200 && v.length > (b - a + 1)) {
        // Server Range-i saymadı: tam cavabı səhifədə saxla və slice ilə ver.
        const w = window; w.__idmPageBlobs = w.__idmPageBlobs || {};
        const bl = new Blob([v], { type: ct }); w.__idmPageBlobs[u] = bl;
        const end = Math.min(bl.size, b + 1), part = bl.slice(Math.min(a, bl.size), end);
        const pv = new Uint8Array(await part.arrayBuffer());
        let pb = ""; const C2 = 0x8000;
        for (let i = 0; i < pv.length; i += C2) pb += String.fromCharCode(...pv.subarray(i, i + C2));
        return { status: 206, cr: `bytes ${a}-${Math.max(a, end - 1)}/${bl.size}`, ct, len: pv.length, b64: btoa(pb) };
      }
      let bin = ""; const CH = 0x8000;
      for (let i = 0; i < v.length; i += CH) bin += String.fromCharCode(...v.subarray(i, i + CH));
      return { status: r.status, cr: r.headers.get("content-range") || "", ct,
        len: v.length, b64: btoa(bin) };
    } catch (e) { return { error: String(e && e.message || e) }; }
  } });
  const r = res && res[0] && res[0].result;
  if (!r || r.error) throw new Error((r && r.error) || "Səhifə fetch alınmadı");
  return r;
}
function isYoutubeTab(tab) {
  try { return /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(tab && tab.url || "").hostname); }
  catch { return false; }
}
async function pageDropBlob(tabId, url) {
  try { await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", args: [url],
    func: u => { try { if (window.__idmPageBlobs) delete window.__idmPageBlobs[u]; } catch {} } }); } catch {}
}
// WhatsApp status: spinner görünəndə blob/MSE hələ tam dolmayıb. Yükləməni başlatmadan
// əvvəl səhifədəki <video> elementinin buffered/duration vəziyyətini gözləyirik.
async function pageWaitReady(tabId, url, timeout = 30000) {
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", args: [url, timeout], func: async (u, ms) => {
      const t0 = Date.now(); let last = -1, stable = 0;
      const find = () => {
        const vs = [...document.querySelectorAll("video,audio")];
        return vs.find(v => (v.currentSrc || v.src) === u)
          || (String(u).startsWith("blob:") ? vs.find(v => /^blob:/.test(v.currentSrc || v.src) && !v.paused) : null)
          || vs.find(v => !v.paused && v.readyState >= 2) || vs[0] || null;
      };
      for (;;) {
        const v = find();
        if (v) {
          const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
          let buf = 0; try { buf = v.buffered && v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0; } catch {}
          const src = v.currentSrc || v.src || "";
          const full = dur > 0 ? buf >= dur - 0.5 : (v.readyState >= 3 && v.networkState === 1);
          if (full || v.ended) return { ok: true, src, dur, buf, ready: v.readyState, net: v.networkState };
          if (dur <= 0 && buf > 0) { if (Math.abs(buf - last) < 0.02) stable++; else stable = 0; if (stable >= 3) return { ok: true, src, dur, buf, ready: v.readyState, net: v.networkState, estimated: true }; }
          last = buf;
        }
        if (Date.now() - t0 >= ms) return { ok: false, src: v ? (v.currentSrc || v.src || "") : "", dur: 0, buf: 0, ready: v ? v.readyState : 0, net: v ? v.networkState : 0, timeout: true };
        await new Promise(r => setTimeout(r, 300));
      }
    } });
    return (res && res[0] && res[0].result) || { ok: false };
  } catch { return { ok: false }; }
}
async function pageUpload(item, tab, filename, extra = {}) {
  if (!tab || tab.id < 0) throw new Error("Səhifə konteksti yoxdur");
  let name = String(filename || item.name || "").trim();
  if (!name || /^[\[{]/.test(name)) name = (self.IDMNamer && self.IDMNamer.cleanTitle(tab.title, tab.url)) || "media";
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += ".mp4";
  // WhatsApp status spinner: blob hələ tam dolmamışsa gözlə; lazy/partial blob yükləməyə çalışmırıq.
  let url = item.url;
  try {
    const pageHost = new URL(tab.url || "").hostname;
    if (String(url).startsWith("blob:") || /(?:^|\.)whatsapp\.com$/i.test(pageHost)) {
      const wr = await pageWaitReady(tab.id, url, 30000);
      if (wr && wr.src && wr.src !== url && String(wr.src).startsWith("blob:")) url = wr.src;
      if (wr && wr.ok === false) console.warn("WhatsApp media hələ tam hazır deyil; mövcud buffer yoxlanır");
    }
  } catch {}
  const probe = await pageFetchChunk(tab.id, url, 0, 0);
  const cr = /bytes\s+\d+-\d+\/(\d+)/i.exec(probe.cr || "");
  let total = cr ? parseInt(cr[1], 10) : (probe.status === 200 ? probe.len : 0);
  const st = await helper("/upload/start", { filename: name, total, audioOnly: extra.mode === "a", stripAudio: extra.mode === "v", audioFormat: extra.audioFormat || "best" }, 15000);
  const id = st.id;
  const up = async (off, buf) => { await helperRaw(`/upload/chunk?id=${encodeURIComponent(id)}&offset=${off}`, buf, 120000); };
  try {
    if (probe.status === 200) {   // Range ignored (typically blob:) — use the probe's full body once.
      await up(0, b64Bytes(probe.b64));
    } else {
      // Telegram SW bəzən tələb olunan Range-dən daha az bayt qaytarır (partial chunk) və
      // bəzən total ölçüsünü ümumiyyətlə vermir. Ona görə açıq Range ilə REAL uzunluqla irəliləyirik.
      const chunk = 4 * 1024 * 1024;
      let pos = 0, stalls = 0, open = !total;
      while (open || pos < total) {
        const end = open ? pos + chunk - 1 : Math.min(total, pos + chunk) - 1;
        const r = await pageFetchChunk(tab.id, url, pos, end);
        if (r.status === 416 && pos > 0) break;
        if (r.status !== 206 && r.status !== 200) throw new Error("Səhifə Range HTTP " + r.status);
        const cr = /bytes\s+\d+-\d+\/(\d+)/i.exec(r.cr || "");
        if (cr) { const t = parseInt(cr[1], 10); if (t > 0) { total = t; open = false; } }
        const data = b64Bytes(r.b64);
        if (!data.length) {
          if (++stalls > 12) throw new Error("Natamam endirmə: səhifə axını dayandı");
          await new Promise(res => setTimeout(res, 500));
          continue;
        }
        stalls = 0;
        if (!open && total > 0 && pos + data.length > total) data = data.subarray(0, total - pos);
        await up(pos, data);
        pos += data.length;
        if (r.status === 200 && open) break;   // Range sayılmayıb: tam cavab gəlib
      }
    }
    const end = await helper("/upload/end", { id }, (extra.mode === "a" || extra.mode === "v") ? 300000 : 30000);
    await pageDropBlob(tab.id, url);
    return { ok: true, path: end.path || "", name: end.name || name };
  } catch (e) {
    await helper("/upload/abort", { id }, 10000).catch(() => {});
    await pageDropBlob(tab.id, url);
    throw e;
  }
}

// Qorunan (noforwards) Telegram media da səhifənin öz kontekstində mövcuddur: normal video kimi
// feed-ə düşür və eyni page-context (blob/SW Range) yolu ilə yüklənir. Yalnız Telegram-a aiddir.
async function tgPageDownload(item, tab) {
  const N = self.IDMNamer;
  let name = String(item.name || "").trim();
  if (!name || /^[\[{]/.test(name)) name = (N && N.cleanTitle(tab.title, tab.url)) || "Telegram videosu";
  try { const u = await helper("/name", { filename: name }, 3000); if (u && u.ok && u.name) name = u.name; } catch {}
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", args: [item.url, name], func: (url, name) => {
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#1c1c1e;color:#fff;font:13px system-ui,sans-serif;padding:8px 12px;border-radius:8px;box-shadow:0 2px 10px #0008";
    document.documentElement.appendChild(bar);
    const say = (t, ms) => { bar.textContent = "JDM · " + t; if (ms) setTimeout(() => bar.remove(), ms); };
    (async () => {
      try {
        const parts = []; let pos = 0, total = 0, type = "";
        for (let g = 0; g < 20000; g++) {   // SW hissə-hissə (Range) cavab verir: bütün fayl yığılana qədər
          say(name + (total ? " " + Math.floor(pos * 100 / total) + "%" : " …"));
          const r = await fetch(url, { headers: { Range: "bytes=" + pos + "-" } });
          if (r.status === 416 && pos > 0) break;
          if (!r.ok) throw new Error("HTTP " + r.status);
          type = type || (r.headers.get("content-type") || "").split(";")[0];
          const cr = /\/(\d+)\s*$/.exec(r.headers.get("content-range") || "");
          if (cr) total = +cr[1];
          const b = await r.blob();
          if (r.status === 200) { parts.length = 0; parts.push(b); pos = total = b.size; break; }   // Range nəzərə alınmadı: tam fayl
          if (!b.size) break;
          parts.push(b); pos += b.size;
          if (total && pos >= total) break;
        }
        if (!pos) throw new Error("boş cavab");
        const EXT = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg" };
        let fn = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim();
        if (!/\.(?:mp4|m4v|webm|mkv|mov|mp3|m4a|ogg|opus|wav|flac)$/i.test(fn)) fn += "." + (EXT[type] || "mp4");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(parts, { type: type || "video/mp4" })); a.download = fn;
        document.documentElement.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 120000);
        say("✓ " + fn, 4000);
      } catch (e) { say("✗ " + (e && e.message || e), 8000); }
    })();
    return true;
  } });
}

// YALNIZ Google Photos / Picasa mənşəli googlevideo axınları üçün.
// Video DownloadHelper-in bu tip axınlarda istifadə etdiyi browser Range/fetch + real request başlıqları modeli.
function googlePicasaUrl(u, pageUrl) {
  if (!googleDirectUrl(u)) return false;
  try {
    if (pageUrl && /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(pageUrl).hostname)) return false;
    const q = new URL(u).searchParams;
    const src = ((q.get("source") || "") + " " + (q.get("app") || "") + " " + (q.get("susc") || "")).toLowerCase();
    if (/\b(?:picasa|fife|ph)\b/i.test(src)) return true;
    if (pageUrl) {
      const h = new URL(pageUrl).hostname.toLowerCase();
      if (/(?:^|\.)(?:photos\.google\.com|picasaweb\.google\.com)$/i.test(h)) return true;
    }
  } catch {}
  return false;
}

async function googleUpload(item, tab, filename) {
  const u = item.url, im = item.idm || {};
  const hdrs = { ...(item.headers || im.headers || {}) };
  for (const k of ["range", "cookie", "user-agent", "referer", "host", "content-length", "connection", "accept-encoding"]) delete hdrs[k];
  const ref = item.referer || im.referer || tab?.url || "";
  const opts = { credentials: "include", cache: "no-store", referrer: ref || undefined };
  const probe = await fetch(u, { ...opts, headers: { ...hdrs, Range: "bytes=0-0" }, signal: AbortSignal.timeout(30000) });
  if (!probe.ok) throw new Error("Google stream HTTP " + probe.status);
  const cr = /bytes\s+\d+-\d+\/(\d+)/i.exec(probe.headers.get("content-range") || "");
  let total = cr ? parseInt(cr[1], 10) : parseInt(probe.headers.get("content-length") || "0", 10) || 0;
  let start = await helper("/upload/start", { filename: filename || nameFrom(u), total }, 15000);
  const id = start.id;
  const up = async (off, buf) => { await helperRaw(`/upload/chunk?id=${encodeURIComponent(id)}&offset=${off}`, buf, 120000); };
  try {
    if (probe.status === 200 && probe.body) {
      const rd = probe.body.getReader(); let off = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; if (value && value.length) { await up(off, value); off += value.length; } }
    } else {
      try { probe.body && probe.body.cancel(); } catch {}
      if (!total) throw new Error("Google stream ölçüsü bilinmir");
      const chunk = 4 * 1024 * 1024;
      let next = 0;
      const take = () => { const a = next; next += chunk; return a; };
      const worker = async () => {
        for (;;) {
          const a = take(); if (a >= total) return;
          const b = Math.min(total, a + chunk) - 1;
          const r = await fetch(u, { ...opts, headers: { ...hdrs, Range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(60000) });
          if (!r.ok) throw new Error("Google Range HTTP " + r.status);
          if (r.status !== 206) throw new Error("Google server Range qəbul etmədi");
          await up(a, new Uint8Array(await r.arrayBuffer()));
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, Math.max(1, Math.ceil(total / chunk))) }, worker));
    }
    const end = await helper("/upload/end", { id }, 30000);
    return { ok: true, path: end.path || "", name: end.name || filename };
  } catch (e) {
    await helper("/upload/abort", { id }, 10000).catch(() => {});
    throw e;
  }
}

async function startDownload(item, tab, format = "", label = "", extra = {}) {
  await ready;
  const target = String(extra.target || "");
  if (tab && tab.id >= 0) {
    const rec = media.get(tab.id)?.get(item.orig || item.url);
    if (rec) item = { ...item, idm: item.idm || rec.idm, headers: item.headers || rec.headers,
      cookie: item.cookie || rec.cookie, userAgent: item.userAgent || rec.userAgent,
      referer: item.referer || rec.referer, origin: item.origin || rec.origin,
      mime: item.mime || rec.mime, size: item.size || rec.size };
  }
  if (item.kind === "file" && tab && (isPageVirtual(item.url, tab)
      || (String(item.url || "").startsWith("blob:") && !isYoutubeTab(tab)))) {
    return pageUpload(item, tab, item.name || "", extra);
  }
  // Google Photos/Picasa birbaşa MP4: token tez bitə bilər; əvvəlcə səhifədəki cari <video> URL-ini götür.
  if (item.kind === "file" && googleDirectUrl(item.url)) {
    try {
      const r = tab && tab.id >= 0 ? await chrome.tabs.sendMessage(tab.id, { type: "mediaRefresh", url: item.url }) : null;
      const oid = new URL(item.url).searchParams.get("id");
      const cand = ((r && r.urls) || []).filter(u => googleDirectUrl(u) && (!oid || (() => { try { return new URL(u).searchParams.get("id") === oid; } catch { return false; } })()));
      if (cand.length) {
        cand.sort((a, b) => { try { return (+new URL(b).searchParams.get("expire") || 0) - (+new URL(a).searchParams.get("expire") || 0); } catch { return 0; } });
        item = { ...item, url: cand[0] };
      }
    } catch {}
  }
  const ptitle = snapTitle(item, tab);   // HLS-ə çevrilmədən ƏVVƏL: orijinal url ilə snapshot tapılır
  const pageUrl = (item.kind === "page" && item.pageUrl) || tab?.url || "";   // lent videosu: permalink (item.pageUrl); adi yolda dəyişməz
  if (item.kind === "hls" && !item.orig) {
    const loc = await localize(item, item.referer || pageUrl, tab?.id ?? -1);
    if (loc) item = { ...item, url: loc, orig: item.url };
  }
  let cookies = await getCookies(item.kind === "page" ? pageUrl : (item.orig || item.url));
  if (item.kind === "file" && googleDirectUrl(item.url) && pageUrl) {   // Photos sessiya cookie-ləri CDN-ə də ötürülür
    const by = new Map(cookies.map(c => [c.name, c]));
    for (const c of await getCookies(pageUrl)) if (!by.has(c.name)) by.set(c.name, c);
    cookies = [...by.values()];
  }
  // JDM sniffer metadata-sı varsa, brauzerin real request başlıqları/cookie/UA/referer istifadə olunur.
  // Bunlar platformaya görə 403/401-in qarşısını alır və native IDM yönləndirməsinin ekvivalentidir.
  const idm = item.idm || {};
  const reqHeaders = item.headers || idm.headers || {};
  const _loginHost = /(?:^|\.)(?:instagram|threads|facebook)\.com$/i.test(hostOfUrl(pageUrl));
  const common = { referer: (item.kind !== "page" && (item.referer || idm.referer)) || pageUrl,
    userAgent: item.userAgent || idm.userAgent || navigator.userAgent,
    cookie: item.cookie || idm.cookie || cookieStr(cookies),
    cookiesFromBrowser: (_loginHost && !cookies.length) ? "brave" : undefined,
    headers: reqHeaders };
  if (item.kind === "file") {
    let filename;
    if (googleDirectUrl(item.url)) {   // 403-lük başlıq yoxlamasına vaxt itirmədən dərhal daxili yükləmə
      filename = String(item.name || "google-video").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim() || "google-video";
      if (!/\.[a-z0-9]{2,5}$/i.test(filename)) filename += ".mp4";
    } else filename = await fileNameFor(item, tab);
    // Yalnız Picasa/Google Photos tipi üçün VDH-ə bənzər Range/fetch yolu; digər file axınları dəyişmir.
    if (googlePicasaUrl(item.url, pageUrl)) {
      try { return await googleUpload(item, tab, filename); }
      catch (e) { console.warn("Google/Picasa upload fallback:", e && e.message || e); }
    }
    // "Yalnız səs" / "Yalnız video": fayl olduğu kimi yüklənmir — yt-dlp endirir, ffmpeg ayırır.
    if (extra.mode === "a" || extra.mode === "v") {
      const stem = String(filename || item.name || "media").replace(/\.[a-z0-9]{2,5}$/i, "").trim() || "media";
      return helper("/ytdlp", { ...common, cookies, url: item.url, format: "", label: extra.mode === "a" ? "Audio" : "",
        mode: extra.mode, stripAudio: extra.mode === "v", audioFormat: extra.audioFormat || "best",
        title: stem, useTitle: true, target: target || undefined, vStreams: C.vstreams || undefined, aStreams: C.astreams || undefined });
    }
    return helper("/add", { ...common, url: item.url, filename, target: target || undefined, streams: streamsFor(filename || item.url) });
  }
  const isPage = item.kind === "page";
  // Rejim (va|a|vs|vas|s), audio formatı, subtitr seçimi (yt-dlp dili və ya səhifədən aşkarlanan fayl)
  const ex = {};
  for (const k of ["mode", "audioFormat", "audioQuality", "stripAudio", "strat", "subLang", "subAuto", "subAll", "keepSubs", "audioTracks", "audioDefault", "audioNone", "subAppearance", "target"]) if (extra[k] !== undefined) ex[k] = extra[k];
  if (Array.isArray(extra.extSubs)) ex.extSubs = await Promise.all(extra.extSubs.map(async x => ({
    url: x.url, lang: x.lang, label: x.label, referer: x.referer || pageUrl, cookie: cookieStr(await getCookies(x.url)),
    fmt: x.fmt || "", keepAss: !!x.keepAss
  })));
  return helper("/ytdlp", {
    ...common, cookies, url: isPage ? pageUrl : item.url, orig: item.orig || "", pageUrl,
    format, label, ...ex, vStreams: C.vstreams || undefined, aStreams: C.astreams || undefined,
    pageTitle: (isPage && item.pageUrl ? item.name : (isPage ? tab?.title : ptitle)) || "",
    title: isPage && item.pageUrl ? item.name : (isPage ? undefined : ptitle), useTitle: isPage && item.pageUrl ? !!item.name : !isPage
  });
}


// ---- HLS snapshot: brauzer playlist-i ÖZÜ (düzgün Referer/cookie ilə) alır, helper-in yerli ünvanından yt-dlp-yə verilir.
// Səbəb: bəzi saytlar (məs. hotstream /list/<token>) brauzerə cavab verir, yt-dlp-yə isə 404 qaytarır.
const originOf = u => { try { return new URL(u).origin; } catch { return ""; } };
const absU = (base, u) => { try { return new URL(u, base).href; } catch { return u; } };
const snapCache = new Map();   // orijinal url -> { local, t }
const mediaMetaCache = new Map();   // url -> { fps, height, width, vcodec, t }
async function probeMediaMeta(it) {
  if (!it || !/^https?:/i.test(it.url || "")) return it;
  const c = mediaMetaCache.get(it.url);
  if (c && Date.now() - c.t < 600000) return { ...it, ...c, t: undefined };
  try {
    const cookies = await getCookies(it.url);
    const h = await helper("/meta", { url: it.url, referer: it.referer || it.pageUrl || "", userAgent: navigator.userAgent, cookie: cookieStr(cookies) }, 12000);
    const m = { fps: Math.round(+h.fps || 0), height: +h.height || 0, width: +h.width || 0, vcodec: h.vcodec || "",
      size: +h.size > 0 ? +h.size : (it.size || 0), dur: +h.duration > 0 ? +h.duration : (it.dur || 0), t: Date.now() };
    mediaMetaCache.set(it.url, m);
    if (mediaMetaCache.size > 500) mediaMetaCache.delete(mediaMetaCache.keys().next().value);
    return { ...it, ...m, t: undefined };
  } catch {
    mediaMetaCache.set(it.url, { fps: 0, height: 0, width: 0, vcodec: "", t: Date.now() });
    return it;
  }
}
async function fetchBytes(url, hdr, tabId, n) {
  let x = new Uint8Array(0);
  try { x = await withHeaders(url, hdr, () => readHeadBytes(url, n)); } catch {}
  if (!x.length && tabId >= 0) x = await pageHead(tabId, url, n);
  return x;
}
async function getPlaylistText(url, hdr, tabId) {
  const c = manText.get(url); if (c) return c;
  const t = decodeHead(await fetchBytes(url, hdr, tabId, 1500000));
  if (!/^\s*#EXTM3U/.test(t)) throw new Error("Playlist brauzerdən də alınmadı");
  return t;
}
async function localKey(u, hdr, tabId) {
  if (!/^https?:/i.test(u)) return u;
  const x = await fetchBytes(u, hdr, tabId, 4096);
  if (!x.length) return u;
  try { return (await helper("/manifest", { kind: "key", b64: btoa(String.fromCharCode(...x)) })).url; } catch { return u; }
}
async function snapshotHls(url, hdr, tabId, st) {
  if (st.n++ > 60) throw new Error("Çox playlist");
  const text = await getPlaylistText(url, hdr, tabId);
  const lines = text.split(/\r?\n/), master = lines.some(l => l.startsWith("#EXT-X-STREAM-INF"));
  if (!master && !/#EXT-X-ENDLIST/.test(text)) throw new Error("canlı axın: snapshot olmur");
  const out = [];
  for (const l of lines) {
    if (!l.trim()) { out.push(l); continue; }
    if (l.startsWith("#")) {
      if (l.startsWith("#EXT-X-I-FRAME-STREAM-INF")) continue;
      const m = /URI="([^"]*)"/.exec(l);
      if (m && m[1] && !/^data:/i.test(m[1])) {
        const au = absU(url, m[1]), tag = l.slice(0, l.indexOf(":"));
        let nu = au;
        if (tag === "#EXT-X-MEDIA") { try { nu = await snapshotHls(au, hdr, tabId, st); } catch { nu = au; } }
        else if (tag === "#EXT-X-KEY" || tag === "#EXT-X-SESSION-KEY") nu = await localKey(au, hdr, tabId);
        out.push(l.replace(m[0], 'URI="' + nu + '"'));
      } else out.push(l);
    } else out.push(master ? await snapshotHls(absU(url, l.trim()), hdr, tabId, st) : absU(url, l.trim()));
  }
  return (await helper("/manifest", { kind: "m3u8", text: out.join("\n") })).url;
}
async function localize(it, ref, tabId) {
  const c = snapCache.get(it.url);
  if (c && Date.now() - c.t < 600000) return c.local;
  try {
    const local = await snapshotHls(it.url, { referer: ref, origin: it.origin || originOf(ref) }, tabId, { n: 0 });
    snapCache.set(it.url, { local, t: Date.now() });
    if (snapCache.size > 100) snapCache.delete(snapCache.keys().next().value);
    return local;
  } catch (e) { console.warn("snapshot:", e.message); return ""; }
}

// Manifestdəki RESOLUTION/FRAME-RATE -> popup keyfiyyət sətirləri. HLS "Auto"/"HLS" fallback-i üçün.
function hlsQuality(w, h) {
  const m = Math.max(+w || 0, +h || 0);
  return m >= 3800 ? 2160 : m >= 2500 ? 1440 : m >= 1900 ? 1080 : m >= 1200 ? 720 : m >= 840 ? 480 : m >= 620 ? 360 : m >= 400 ? 240 : (+h || 0);
}
function hlsManifestOptions(m) {
  const vs = (m && m.master && (m.variants || []).filter(v => +v.height > 0)) || [];
  return vs.map((v, i) => {
    const h = Math.round(+v.height || 0), fp = Math.round(+v.fps || 0);
    const q = hlsQuality(v.width, h);
    const codec = String(v.codecs || "").split(",")[0].trim();
    return { id: "hls-" + h + "-" + i, tag: q + "p" + (fp ? " " + fp + "FPS" : ""),
      label: [codec, "HLS"].filter(Boolean).join(" • "), selector: "bv[height=" + h + "]+ba",
      audio: false, size: 0, est: true, height: h, fps: fp, hf: fp >= 55, hdr: !!v.hdr,
      codec, hdrLabel: "", url: String(v.url || ""), dur: 0, vid: "", vsel: "" };
  });
}

// HLS/DASH axınları üçün də YouTube kimi keyfiyyət siyahısı: hər axın helper /formats ilə yoxlanılır
async function probeStreams(items, pageUrl, tabTitle = "", tabId = -1, fresh = false) {
  const streams = items.filter(i => i.kind === "hls" || i.kind === "dash").slice(0, 10);
  const files = items.filter(i => i.kind === "file");
  const probed = await Promise.all(streams.map(async it => {
    const ref = it.referer || pageUrl;
    let base = { ...it, referer: ref, name: it.pTitle || tabTitle || it.name };
    const run = async u => {
      const cookies = await getCookies(it.url);
      return helper("/formats", { url: u, cookies, referer: ref, userAgent: navigator.userAgent, cookie: cookieStr(cookies), fresh: !!fresh, pageUrl }, 25000);
    };
    const pack = (b, h) => ({ ...b, options: h.options || [], audios: h.audios || [], subs: h.subs || [], aq: h.aq || [], caps: h.caps || {}, warnings: h.warnings || [] });
    const hasHeight = p => (p.options || []).some(o => +o.height > 0);
    // yt-dlp bəzən HLS master-in variantlarını height-siz qaytarır. Bu halda manifestin özündən
    // #EXT-X-STREAM-INF / RESOLUTION oxunur və popup-da "HLS" yerinə real 1080p/720p göstərilir.
    const fromManifest = async (u, b) => {
      try {
        const cookies = await getCookies(it.url);
        const m = await helper("/hlsmeta", { url: u, referer: ref, userAgent: navigator.userAgent, cookie: cookieStr(cookies) }, 8000);
        const opts = hlsManifestOptions(m);
        if (!opts.length) return null;
        return { ...b, options: opts, audios: [], subs: [], aq: [], caps: { ffmpeg: true, audioOnly: false, audioSeparate: false, videoOnly: false }, warnings: [] };
      } catch { return null; }
    };
    let err;
    // ok.ru CDN (okcdn) manifesti dərhal orijinal ünvandan yoxlanılır: snapshot hər probda master + bütün variant
    // playlistlərini çəkir və okcdn aqressiv limit qoyur (eyni URL bir dəfə 200, sonra 400). Digər hostlar dəyişmir.
    const okcdn = /(?:^|\.)okcdn\.ru$/i.test(hostOfUrl(it.url));
    if (it.kind === "hls" && !okcdn) {   // əvvəl brauzerin özünün aldığı playlist (yt-dlp 404 alan saytlar üçün)
      const loc = await localize(it, ref, tabId);
      if (loc) {
        try {
          const p = pack({ ...base, url: loc, orig: it.url }, await run(loc));
          if (hasHeight(p)) return p;
          return (await fromManifest(loc, p)) || p;
        } catch (e) { err = e; }
      }
    }
    try {
      const p = pack(base, await run(it.url));
      if (hasHeight(p)) return p;
      return (await fromManifest(it.url, p)) || p;
    } catch (e) {
      const p = { ...base, options: [], probeError: String((err || e).message || (err || e)) };
      return (await fromManifest(it.url, p)) || p;
    }
  }));
  // Bir axında çox keyfiyyət varsa (master), tək-seçimli variant playlistləri gizlət
  // YALNIZ eyni master-in qovluğu altındakı tək-seçimli variantlar gizlənir; başqa qovluqdakı (məs. əsas film) axın qalır
  const dirOf = u => { try { const x = new URL(u); return x.origin + x.pathname.slice(0, x.pathname.lastIndexOf("/") + 1); } catch { return u; } };
  const masters = probed.filter(i => i.options.length > 1).map(i => dirOf(i.url));
  // master altındakı adi video variantları gizlədilir; audio/sublist/subtitle axınları həmişə qalır
  const keepVariant = u => /\.txt(?:[?#]|$)/i.test(String(u || "")) || /(?:^|[\/_.-])(?:sub|subs|subtitle|subtitles|audio|aud|sublist|master|playlist|manifest)(?:[\/_.-]|\d|$)/i.test(String(u || ""));
  const list = probed.filter(i => i.options.length > 1 || keepVariant(i.url) || !masters.some(d => dirOf(i.url).startsWith(d)));
  const big = i => Math.max(0, ...(i.options || []).map(o => o.size || 0), i.size || 0);
  // DoodStream (uk-traffic / rapidrame): master bir keyfiyyətlidir → həm master, həm onun media/audio
  // playlist-i ayrı-ayrı sətir kimi göstərilirdi. Bu CDN-lərdə master varsa yalnız master qalır.
  const ukUrl = i => String(i.orig || i.url || "");
  const isUk = u => /(?:^|\.)(?:uk-traffic|rapidrame)[a-z0-9-]*\.[a-z]{2,}$/i.test(hostOfUrl(u));
  const isUkMaster = u => isUk(u) && /\/master\.m3u8(?:[?#]|$)/i.test(u);
  const ukList = probed.some(i => isUkMaster(ukUrl(i))) ? list.filter(i => !isUk(ukUrl(i)) || isUkMaster(ukUrl(i))) : list;
  // Universal FPS: birbaşa fayllar və keyfiyyət siyahısı olmayan axınlar üçün helper /meta (ffprobe)
  const filesMeta = await Promise.all(files.slice(0, 8).map(probeMediaMeta));
  // ok.ru/okcdn: hər keyfiyyət ayrıca yolsuz "?type=N&ct=11/12" linkidir — hamısı "video" adlanır, biri yalnız
  // video, digəri yalnız səs. Master DASH varsa bu tək-tək sətirlər keyfiyyət siyahısını qarışdırır.
  const OKRU = /(?:^|\.)(?:okcdn\.ru|ok\.ru)$/i;
  const filesOut = [...filesMeta, ...files.slice(8)].filter(f => !OKRU.test(hostOfUrl(f.url)) || keepVariant(f.url) || !masters.some(d => dirOf(f.url).startsWith(d)));
  const listMeta = await Promise.all(ukList.map(async i => (i.options && i.options.length) ? i : probeMediaMeta(i)));
  listMeta.sort((a, b) => big(b) - big(a));
  filesOut.sort((a, b) => (b.size || 0) - (a.size || 0));
  return [...listMeta, ...filesOut];
}


// ---- Qısa video lenti (feed.js): qruplar. Cari video avtomatik yoxlanır; əvvəlkilər yalnız açılanda (feedGroup). Lent söndürülübsə/aktiv deyilsə köhnə yol dəyişməz işləyir.
const FEED_KEEP = 10;
const feedFormats = new Map();   // `${tabId}|${key}` -> Promise<nəticə>: eyni video üçün /formats bir dəfə (uğursuzluq saxlanmır)
const sortBySize = opts => opts.map((o, i) => [o, i]).sort((a, b) => ((b[0].size > 0) - (a[0].size > 0)) || (a[0].size > 0 ? b[0].size - a[0].size : a[1] - b[1])).map(x => x[0]);   // ölçü məlum olanlar böyükdən kiçiyə; bilinməyənlər olduğu yerdə
const feedName = v => v.title || [v.site, v.id].filter(Boolean).join("_") || "video";   // başlıq yoxdursa: sayt_id (uydurma məzmun adı yoxdur)
const normSrc = u => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return String(u); } };
const FEED_NO_PROBE = new Set(["whatsapp", "threads", "reddit", "vimeo", "dailymotion", "twitch", "soundcloud", "linkedin"]);
function feedProbe(tabId, v) {
  const ck = tabId + "|" + v.key;
  if (feedFormats.has(ck)) return feedFormats.get(ck);
  const empty = error => ({ options: [], audios: [], subs: [], aq: [], caps: {}, warnings: [], strat: "", error });
  if (FEED_NO_PROBE.has(v.site)) return Promise.resolve(empty("Media birbaşa səhifədən tutulur; yt-dlp keyfiyyət sorğusu göndərilmir"));
  if (v.weak) return Promise.resolve(empty("Bu video üçün keçid (permalink) tapılmadı: keyfiyyətlər sorğulanmır"));
  const p = (async () => {
    try {
      const cookies = await getCookies(v.url);
      const to = (v.site === "x" || v.site === "pinterest") ? 25000 : 70000;
      const h = await helper("/formats", { url: v.url, cookies, referer: v.url, userAgent: navigator.userAgent, cookie: cookieStr(cookies) }, to);
      let opts = h.options || [];
      // Lentdə permalink /formats height vermirsə, əldə olan HLS manifestindən real rezolusiyanı oxu.
      if (!opts.some(o => +o.height > 0)) {
        const mu = /\.m3u8(?:[?#]|$)/i.test(v.src || "") ? v.src : (/\.m3u8(?:[?#]|$)/i.test(v.url || "") ? v.url : "");
        if (mu) {
          try {
            const m = await helper("/hlsmeta", { url: mu, referer: v.url, userAgent: navigator.userAgent, cookie: cookieStr(cookies) }, 8000);
            const hm = hlsManifestOptions(m);
            if (hm.length) opts = hm;
          } catch {}
        }
      }
      return { options: sortBySize(opts), audios: h.audios || [], subs: h.subs || [], aq: h.aq || [], caps: h.caps || {}, warnings: h.warnings || [], strat: h.strat || "", error: "" };
    } catch (e) { feedFormats.delete(ck); return empty(feedErrText(v.site, e)); }
  })();
  feedFormats.set(ck, p); return p;
}
// Lent probunda yt-dlp-nin xam login/cookie xətası istifadəçiyə göstərilməsin:
// media brauzerdə onsuz da tutulur, ona görə qısa, aydın mətn ver.
function feedErrText(site, e) {
  const s = String((e && e.message) || e);
  if (/log ?in|login|cookies|authentication|rate.?limit|not available|private|sign in/i.test(s))
    return (site === "instagram" || site === "facebook" || site === "fbwatch" || site === "threads")
      ? "Keyfiyyət siyahısı alınmadı (giriş tələb olunur); media səhifədən tutulur" : "Giriş tələb olunur";
  return s;
}
const FEED_FALLBACK = new Set(["whatsapp", "x", "threads", "reddit", "vimeo", "dailymotion", "twitch", "soundcloud", "pinterest", "linkedin", "tiktok", "instagram", "facebook", "fbwatch"]);
// Instagram HEKAYƏ (və ümumi fbcdn) DASH seqment sorğuları URL-ə `bytestart`/`byteend` (bəzən `range`)
// parametrləri əlavə edir. Həmin URL ayrı seqmentdir və media kimi düzgün yüklənmir. Bu funksiya
// həmin parametrləri çıxarıb TAM fayl ünvanını (digər alətlərin istifadə etdiyi formanı) qaytarır.
const IG_CDN_HOST = /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i;
function canonicalMediaUrl(raw) {
  const s = String(raw || "");
  if (!s) return s;
  let u; try { u = new URL(s); } catch { return s; }
  if (!IG_CDN_HOST.test(u.hostname)) return s;
  if (!u.searchParams.has("bytestart") && !u.searchParams.has("byteend") && !u.searchParams.has("range")) return s;
  u.searchParams.delete("bytestart");
  u.searchParams.delete("byteend");
  u.searchParams.delete("range");
  return u.href;
}

// Instagram CDN stream növü: `efg` parametrindəki vencode_tag-ə görə video/səs ayrılır.
function igStreamTag(u) {
  try {
    const x = new URL(u);
    if (!IG_CDN_HOST.test(x.hostname)) return "";
    const efg = x.searchParams.get("efg");
    if (!efg) return "";
    let s = "";
    try { s = decodeURIComponent(efg); } catch { s = efg; }
    try {
      const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
      s = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : "";
    } catch { s = ""; }
    if (!s) return "";
    let j; try { j = JSON.parse(s); } catch { return ""; }
    const tag = String(j.vencode_tag || j.encode_tag || "");
    if (/_audio\b|heaac|audio/i.test(tag)) return "audio";
    if (/dash_|vp9|avc|hevc|_\d{3,4}p\b/i.test(tag)) return "video";
    return "";
  } catch { return ""; }
}

const FEED_CDN = {
  tiktok: /(?:^|\.)(?:tiktokcdn\.com|tiktok\.com)$/i, instagram: /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i,
  facebook: /(?:^|\.)fbcdn\.net$/i, fbwatch: /(?:^|\.)fbcdn\.net$/i, threads: /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i,
  x: /(?:^|\.)twimg\.com$/i, whatsapp: /(?:^|\.)(?:whatsapp\.net|whatsapp\.com)$/i, reddit: /(?:^|\.)(?:v\.redd\.it|redd\.it)$/i,
  vimeo: /(?:^|\.)vimeocdn\.com$/i, dailymotion: /(?:^|\.)dmcdn\.net$/i, twitch: /(?:^|\.)ttvnw\.net$/i,
  soundcloud: /(?:^|\.)sndcdn\.com$/i, pinterest: /(?:^|\.)pinimg\.com$/i, linkedin: /(?:^|\.)licdn\.com$/i,
};
const FEED_WIN = { tiktok: 30000, instagram: 30000, facebook: 60000, fbwatch: 60000 };
const hostOfUrl = u => { try { return new URL(u).hostname; } catch { return ""; } };
const dirOfUrl = u => { try { const x = new URL(u); return x.origin + x.pathname.slice(0, x.pathname.lastIndexOf("/") + 1); } catch { return u; } };
function feedMediaExt(v) {
  const u = String((v && v.src) || "");
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(u);
  if (v && v.media === "audio") return m && /^(?:m4a|m4b|mp3|aac|ogg|opus|weba|webm|wav|flac)$/i.test(m[1]) ? m[1].toLowerCase() : "ogg";
  return m && /^(?:mp4|m4v|webm|mov|mkv|m4a)$/i.test(m[1]) ? m[1].toLowerCase() : "mp4";
}
function feedMediaHit(tabId, v) {   // blob/MSE arxasındakı real HTTP axınının Content-Length/müddətini tapır
  const all = [...(media.get(tabId)?.values() || [])].filter(i => ["file", "hls", "dash"].includes(i.kind) && /^https?:/i.test(i.url));
  if (!all.length) return null;
  const u = String(v.src || "");
  if (u && /^https?:/i.test(u)) {
    const exact = all.filter(i => i.url === u || normSrc(i.url) === normSrc(u));
    if (exact.length) return exact.sort((a, b) => (b.time || 0) - (a.time || 0))[0];
  }
  const paths = [...new Set((v.hints || []).map(h => { try { return new URL(h, v.pageUrl || "https://x.invalid/").pathname; } catch { return ""; } }).filter(x => x.length > 8))];
  const score = uu => { try { const p = new URL(uu).pathname; return paths.some(h => p === h || p.startsWith(h.replace(/\/$/, "") + "/") || h.endsWith(p)) ? 1 : 0; } catch { return 0; } };
  let cand = paths.length ? all.filter(i => score(i.url)).sort((a, b) => (b.time || 0) - (a.time || 0)) : [];
  // Telegram/WhatsApp-da vaxta görə uyğunlaşdırma etmirik: service worker-in eyni chunk-ı
  // bütün mesajlara 524288 bayt kimi görünə bilər. Yalnız dəqiq URL və ya hint path qəbul olunur.
  return cand[0] || null;
}
function feedEstimateSize(v, dur) {
  if (!(dur > 0)) return 0;
  let kbps;
  if (v.media === "audio") kbps = 128;
  else {
    const h = +v.height || 0, fp = +v.fps || 0;
    kbps = h >= 2160 ? 12000 : h >= 1440 ? 8000 : h >= 1080 ? 4500 : h >= 720 ? 2500 : h >= 480 ? 1200 : h >= 360 ? 700 : 450;
    if (fp >= 50) kbps *= 1.3;
  }
  return Math.round(kbps * 125 * dur);
}
// Telegram/WhatsApp service worker bəzən hər mesaj üçün 512 KiB-lik buffer chunk-ı
// Content-Length kimi verir. Bu, media faylının həcmi deyil; belə dəyərləri rədd edirik.
const FEED_CHUNK_SIZES = new Set([524288, 262144, 131072]);
function feedGoodSize(v, n) {
  n = +n || 0;
  if (!(n > 0)) return false;
  const r = Math.round(n);
  if (v && (v.site === "telegram" || v.site === "whatsapp")) {
    // UI 524 KB göstərən service-worker buffer chunk-ı (524288 ± yuvarlaqlaşdırma).
    if (r >= 520000 && r <= 530000) return false;
    if (FEED_CHUNK_SIZES.has(r)) return false;
  }
  return true;
}
function feedFillMeta(d, v) {
  if (!d || !v) return d;
  if (d.size && !feedGoodSize(v, d.size)) { d.size = 0; d.est = true; }
  if (!d.size && v.size && feedGoodSize(v, v.size)) { d.size = +v.size || 0; d.est = !!v.sizeEst; }
  if (!d.size && v.size && !feedGoodSize(v, v.size)) d.est = true;
  if (!d.dur && v.dur) d.dur = +v.dur || 0;
  if (!d.fps && v.fps) d.fps = +v.fps || 0;
  if (!d.size && d.dur && (v.site === "telegram" || v.site === "whatsapp")) {
    d.size = feedEstimateSize(v, d.dur); d.est = true;
  }
  if (!d.name) d.name = feedName(v) + "." + feedMediaExt(v);
  return d;
}
function feedDirect(tabId, v) {   // video elementinin mənbəyi ilə eyni media; blob/MSE platformalarında CDN + vaxt pəncərəsi ilə uyğunlaşdırma
  const metaFps = u => { const c = mediaMetaCache.get(u); return c ? (c.fps || 0) : 0; };
  const social = FEED_FALLBACK.has(v.site);
  if (v.site === "telegram") {   // permalink/yt-dlp yoxdur: videonun öz mənbəyi (SW axını və ya blob) səhifə daxilindən yüklənir
    const N0 = self.IDMNamer, ex0 = feedMediaExt(v);
    const row = (u, it) => feedFillMeta({ url: u, kind: (it && it.kind) || "file", size: (it && it.size) || 0, est: !!(it && it.est), dur: (it && it.dur) || 0, fps: v.fps || (it && it.fps) || 0,
      referer: (it && it.referer) || v.pageUrl, name: N0 ? N0.finalName(feedName(v), ex0) : feedName(v) + "." + ex0 }, v);
    // Protected (noforwards) media da eyni yolla göstərilir/yüklənir; başqa saytlar bu şaxəyə düşmür.
    if (v.src) return [row(v.src, feedMediaHit(tabId, v))];
    // Bəzi Telegram pleyerlərində video elementinin src-si bir an gec görünür.
    // Bu halda yalnız HƏMİN cari video üçün yaxın vaxtda tutulmuş axını götürürük;
    // köhnə çat videolarına qayıtmırıq (best-effort, 12 saniyə pəncərə).
    const all = [...(media.get(tabId)?.values() || [])].filter(i => ["file", "hls", "dash"].includes(i.kind) && /^https?:/i.test(i.url));
    const paths = [...new Set((v.hints || []).map(h => { try { return new URL(h, v.pageUrl || "https://x.invalid/").pathname; } catch { return ""; } }).filter(x => x.length > 8))];
    const score = u => { try { const p = new URL(u).pathname; return paths.some(h => p === h || p.startsWith(h.replace(/\/$/, "") + "/") || h.endsWith(p)) ? 1 : 0; } catch { return 0; } };
    let cand = all.filter(i => score(i.url)).sort((a, b) => (b.time || 0) - (a.time || 0));
    if (!cand.length) cand = all.filter(i => Math.abs((i.time || 0) - (v.time || 0)) <= 12000).sort((a, b) => (b.time || 0) - (a.time || 0));
    if (!cand.length) return [];
    return [row(cand[0].url, cand[0])];
  }
  const N = self.IDMNamer;
  const pageRow = (u, it) => feedFillMeta({ url: u, kind: "file", size: (it && it.size) || 0, est: !!(it && it.est), dur: (it && it.dur) || 0, fps: v.fps || (it && it.fps) || 0,
    referer: (it && it.referer) || v.pageUrl || v.url, name: N ? N.finalName(feedName(v), feedMediaExt(v)) : feedName(v) + "." + feedMediaExt(v) }, v);
  if (v.site === "whatsapp") {   // WhatsApp: decrypted blob və ya CDN URL-i yalnız səhifə kontekstində açılır
    if (!v.src) return [];
    return [pageRow(v.src, feedMediaHit(tabId, v))];
  }
  const blobRow = v.site === "x" && v.src && /^blob:/i.test(v.src) ? pageRow(v.src) : null;   // X: blob son çarə
  const out = [], seen = new Set();
  if (!v.src && !social) return blobRow ? [blobRow] : [];
  const k = normSrc(v.src || "");
  const all = [...(media.get(tabId)?.values() || [])];
  const AUDIO_ONLY = /(?:\.(?:m4a|mp3|aac|ogg|opus|wav|weba)(?:[?#]|$))|(?:\/(?:aud|audio|audio_only|aac)\/)/i;
  const exact = v.src ? (() => {
    const ok = i => (i.kind === "file" || i.kind === "hls" || i.kind === "dash") && !(v.site === "x" && AUDIO_ONLY.test(i.url));
    const same = all.filter(i => ok(i) && i.url === v.src);   // eyni tam URL (query/token ilə) ən güclü sübutdur
    return same.length ? same : all.filter(i => ok(i) && normSrc(i.url) === k);
  })() : [];
  // Smart Active Stream: hook/feature indeksindən gələn aktiv videonun media yolları ilə dəqiq uyğunlaşdırma.
  // Bu, blob/MSE arxasında olan və ya vaxt pəncərəsində qonşu videolarla qarışan axınları ayırır.
  const mediaPath = u => { try { const x = new URL(u); return x.pathname; } catch { return ""; } };
  const hintPaths = [...new Set((v.hints || []).map(h => {
    try { const x = new URL(h, v.pageUrl || "https://x.invalid/"); return x.pathname; } catch { return ""; }
  }).filter(x => x.length > 8))];
  const hintScore = u => {
    const p = mediaPath(u); let best = 0;
    for (const h of hintPaths) {
      const hb = h.split("/").pop() || "", hd = h.replace(/\/[^\/]*$/, "/"), generic = /^(?:video|index|master|playlist|media|file|stream)\./i.test(hb);
      if (p === h) best = Math.max(best, 5);
      else if (p.startsWith(h.replace(/\/$/, "") + "/")) best = Math.max(best, 4);
      else if (hb.length > 16 && !generic && p.split("/").pop() === hb) best = Math.max(best, 3);
      else if (hd.length > 9 && p.startsWith(hd)) best = Math.max(best, 2);
    }
    return best;
  };
  const hinted = hintPaths.length ? all.filter(i => ["hls", "dash", "file"].includes(i.kind) && /^https?:/i.test(i.url) && !AUDIO_ONLY.test(i.url) && hintScore(i.url) > 0)
    .map(i => ({ i, s: hintScore(i.url) })).sort((a, b) => (b.s - a.s) || ((b.i.time || 0) - (a.i.time || 0))).map(x => x.i) : [];
  const cdn = FEED_CDN[v.site], win = FEED_WIN[v.site] || 180000;
  // Instagram HEKAYƏ üçün SıRF bu işə baxan ağıllı seçim: aktiv hekayənin öz media-sı seçilir,
  // əlaqəsiz/qonşu axınlar göstərilmir.
  const igStory = v.site === "instagram" && /^\/stories\//i.test(String((() => { try { return new URL(v.url).pathname; } catch { return ""; } })()));
  const igFallback = () => {
    const anchor = +(v.activeAt || v.time || 0) || Date.now();
    const near = all.filter(i => ["hls", "dash", "file"].includes(i.kind) && /^https?:/i.test(i.url)
      && (!cdn || cdn.test(hostOfUrl(i.url))) && !AUDIO_ONLY.test(i.url) && Math.abs((i.time || 0) - anchor) < Math.min(win, 45000));
    return near.sort((a, b) => Math.abs((a.time || 0) - anchor) - Math.abs((b.time || 0) - anchor));
  };
  let list;
  if (igStory) {
    // Instagram HEKAYƏ: video trekini (hint tam yol uyğunluğu və ya aktiv ana ən yaxın) götür,
    // həmçinin həmin hekayənin AYRI SƏS trekini (efg → *_audio) əlavə et. Instagram DASH video və
    // səsi ayrı .mp4 kimi verir; əvvəl yalnız biri göstərilirdi.
    const anchor = +(v.activeAt || v.time || 0) || Date.now();
    const igCand = a => {
      if (!["hls", "dash", "file"].includes(a.kind) || !/^https?:\/\//i.test(a.url) || !IG_CDN_HOST.test(hostOfUrl(a.url))) return false;
      if (Math.abs((a.time || 0) - anchor) >= Math.min(win, 45000)) return false;
      // Yalnız aktiv hekayənin trek(ləri): tanınan efg (video/səs) və ya hint yoluna uyğun olan.
      return !!igStreamTag(a.url) || (hintPaths.length > 0 && hintScore(a.url) > 0);
    };
    const pool = (() => {
      // Eyni trek üçün həm JSON-dan gələn tam URL, həm də seqmentdən kanonik URL ola bilər: JSON üstün tutulur.
      const byPath = new Map();
      for (const a of all.filter(igCand)) {
        const k = normSrc(a.url), prev = byPath.get(k);
        if (!prev || (a.jsonSrc && !prev.jsonSrc)) byPath.set(k, a);
      }
      return [...byPath.values()];
    })();
    const vids = pool.filter(a => igStreamTag(a.url) !== "audio");
    const auds = pool.filter(a => igStreamTag(a.url) === "audio");
    let vidPick;
    if (hinted.length) {
      const scored = hinted.map(a => ({ a, s: hintScore(a.url) })).filter(x => igStreamTag(x.a.url) !== "audio");
      const best = scored.length ? Math.max(...scored.map(x => x.s)) : 0;
      vidPick = scored.filter(x => x.s === best && best > 0).map(x => x.a);
    }
    if (!vidPick || !vidPick.length) vidPick = vids.sort((a, b) => Math.abs((a.time || 0) - anchor) - Math.abs((b.time || 0) - anchor)).slice(0, 1);
    // Səs treki: video ilə eyni hekayəyə aid olan, aktiv ana ən yaxın audio (server onu adətən video ilə yanaşı tutur).
    const audPick = auds.sort((a, b) => Math.abs((a.time || 0) - anchor) - Math.abs((b.time || 0) - anchor)).slice(0, 1);
    list = [...vidPick, ...audPick];
  } else if (exact.length) list = exact;
  else if (hinted.length) list = hinted;
  else if (social) {
    if (v.site === "instagram") list = igFallback();
    else list = all.filter(i => ["hls", "dash", "file"].includes(i.kind) && /^https?:/i.test(i.url)
      && (!cdn || cdn.test(hostOfUrl(i.url))) && !(v.site === "x" && AUDIO_ONLY.test(i.url))
      && Math.abs((i.time || 0) - (v.time || 0)) < win).sort((a, b) => (b.time || 0) - (a.time || 0));
  } else list = [];
  for (const i of list) {
    const key = normSrc(i.url); if (seen.has(key)) continue; seen.add(key);
    const dir = (i.kind === "hls" || i.kind === "dash") ? dirOfUrl(i.url) : "";
    if (dir) { if (seen.has("d:" + dir)) continue; seen.add("d:" + dir); }
    const isAudioStream = igStory && igStreamTag(i.url) === "audio";
    const ext = isAudioStream ? "m4a" : (v.media === "audio" ? feedMediaExt(v) : ((/\.(mp4|webm|m4v|mov|m4a|mp3|ogg|opus)(?:[?#]|$)/i.exec(i.name || i.url || "") || [])[1] || "mp4"));
    const baseNm = feedName(v) + (isAudioStream ? " (səs)" : "");
    const nm = out.length ? (baseNm + (isAudioStream ? "" : " " + out.length)) : baseNm;
    out.push(feedFillMeta({ url: i.url, kind: i.kind || "file", size: i.size || 0, est: !!i.est, dur: i.dur || 0, fps: isAudioStream ? 0 : (i.fps || metaFps(i.url) || v.fps || 0), referer: i.referer, name: N ? N.finalName(nm, ext) : nm + "." + ext }, v));
    if (out.length >= ((v.site === "telegram" || v.site === "pinterest") ? 6 : (igStory ? 3 : 3))) break;
  }
  if (blobRow && out.length < 3 && !seen.has(normSrc(blobRow.url))) out.push(blobRow);
  return out;
}
const feedGroup = async (tabId, v, r) => {
  let direct = (r && r.options && r.options.length && (v.site === "x" || v.site === "pinterest")) ? [] : feedDirect(tabId, v);
  // Telegram/Pinterest: feed mesajı anında <video>.src hələ boş ola bilər.
  // Səhifədən HAZIRDA oynayan videonun mənbəyini birbaşa soruşub cari qrupu tamamlayırıq.
  if ((v.site === "telegram" || v.site === "whatsapp" || v.site === "pinterest") && tabId >= 0) {
    try {
      const ai = await chrome.tabs.sendMessage(tabId, { type: "feedInfo" });
      if (ai && ai.ok && ai.src) {
        const hit = direct.find(d => d.url === ai.src || normSrc(d.url) === normSrc(ai.src));
        if (hit) {
          if (!hit.size && ai.size > 0) { hit.size = +ai.size; hit.est = !!ai.sizeEst; }
          if (!hit.dur && ai.duration > 0) hit.dur = +ai.duration;
          if (!hit.fps && ai.fps > 0) hit.fps = +ai.fps;
        } else {
          const N1 = self.IDMNamer, ex1 = feedMediaExt({ ...v, src: ai.src, media: ai.media || v.media });
          direct.unshift(feedFillMeta({ url: ai.src, kind: "file", size: +ai.size || 0, est: !!ai.sizeEst, dur: +ai.duration || 0, fps: v.fps || +ai.fps || 0,
            referer: v.pageUrl || v.url, name: N1 ? N1.finalName(feedName(v), ex1) : feedName(v) + "." + ex1 }, { ...v, media: ai.media || v.media, dur: +ai.duration || v.dur }));
          if (direct.length > 6) direct.length = 6;
        }
      }
    } catch {}
  }
  // Feed direct sətirləri üçün universal FPS/müddət/həcm: yalnız HTTP URL-lərdə (blob səhifə kontekstindədir)
  await Promise.all(direct.slice(0, 3).map(async d => {
    if (v.site !== "telegram" && v.site !== "whatsapp" && (!d.fps || !d.dur || !d.size) && /^https?:/i.test(d.url || "")) {
      const m = await probeMediaMeta(d);
      if (m) { if (!d.fps && m.fps > 0) d.fps = m.fps; if (!d.size && m.size > 0) { d.size = m.size; d.est = false; } if (!d.dur && m.dur > 0) d.dur = m.dur; }
    }
  }));
  direct.forEach(d => feedFillMeta(d, v));
  return { key: v.key, name: feedName(v), url: v.url, site: v.site, weak: v.weak, protected: !!v.protected, time: v.time, ...r, direct };
};
async function feedResponse(tabId, f) {
  const cur = f.videos.get(f.cur), r = await feedProbe(tabId, cur);
  // Telegram chat/story: popup yalnız HAZIRDA oxudulan videonu göstərsin.
  // Köhnə çat videoları "Əvvəl oxudulanlar" siyahısında əlaqəsiz adlar/kimliklər yaradırdı.
  const prev = cur.site === "telegram" ? [] : [...f.videos.keys()].filter(k => k !== f.cur).reverse().map(k => { const v = f.videos.get(k); return { key: k, name: feedName(v), site: v.site, time: v.time }; });
  return { ok: true, feed: true, pageUrl: cur.url, enabled: C.enabled, subsOn: C.subs, title: feedName(cur), options: [], items: [], pageSubs: [], cur: await feedGroup(tabId, cur, r), prev };
}
function notifyFeed(tabId) {
  stateCountCache.delete(tabId); autoResults.delete(tabId);
  chrome.runtime.sendMessage({ type: "feedChanged", tabId }).catch(() => {});
  chrome.tabs.sendMessage(tabId, { type: "feedChanged" }).catch(() => {});
  notifyState(tabId, "feed");
}


// ================= ALT YAZI: MPV stili + AI/ikili dil (dual-dan port) =================
// MPV stili üçün tək yazma növbəsi: startup, storage dəyişikliyi və menyu eyni anda
// gəlsə də köhnə "default" yeni seçilmiş stilin üstünə yazılmır. Həmişə ən son stil qalır.
let mpvPending = null;
let mpvBusy = false;
let mpvRetry = null;
const MPV_STYLES = ["default", "cinematic", "minimalist", "neon"];
function queueMpvStyle(style, appearance) {
  style = String(style || "default").toLowerCase();
  if (!MPV_STYLES.includes(style)) style = "default";
  if (mpvRetry) { clearTimeout(mpvRetry); mpvRetry = null; }
  mpvPending = { style, appearance: appearance && typeof appearance === "object" ? appearance : null };
  flushMpvQueue();
}
async function flushMpvQueue() {
  if (mpvBusy) return;
  mpvBusy = true;
  try {
    while (mpvPending != null) {
      const job = mpvPending;
      mpvPending = null;
      try {
        const r = await helper("/mpvstyle", { style: job.style, appearance: job.appearance }, 8000);
        if (!r || !r.ok) throw new Error("mpvstyle");
      } catch {
        // Helper hələ hazır deyilsə son seçimi bir dəfə gecikmə ilə təkrar yoxla.
        if (mpvPending == null) {
          if (mpvRetry) clearTimeout(mpvRetry);
          mpvRetry = setTimeout(() => {
            mpvRetry = null;
            if (mpvPending == null) mpvPending = job;
            flushMpvQueue();
          }, 5000);
        }
      }
    }
  } finally {
    mpvBusy = false;
  }
}
function subAppFromSettings(s) {
  s = s && typeof s === "object" ? s : {};
  const num = (v, a, b, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
  return {
    size: num(s.size, 2, 200, 16), bold: !!s.bold, italic: !!s.italic, underline: !!s.underline,
    bg: num(s.bg, 0, 100, 10), font: String(s.font || "Default"),
    fontResolved: String(s.fontResolved || ""), fontMissing: !!s.fontMissing, fontFallback: String(s.fontFallback || ""),
    style: ["default", "academic", "colloquial", "simplified"].includes(s.aiStyle) ? s.aiStyle : "default"
  };
}
async function syncStoredMpvStyle() {
  // Alt yazı ayarlarının əsas mənbəyi helper-in JSON faylıdır. Açılışda onu chrome.storage-a köçür.
  try {
    const j = await helper("/subtitle-settings", null, 7000);
    if (j && j.ok && j.settings) {
      const s = j.settings;
      const cur = await chrome.storage.local.get(["subAppearance", "subVisualStyle"]).catch(() => ({}));
      const curApp = subAppFromSettings(cur && cur.subAppearance);
      const curNonDefault = curApp.size !== 16 || curApp.bold || curApp.italic || curApp.underline ||
        curApp.bg !== 10 || curApp.font !== "Default" || curApp.style !== "default" ||
        ((cur && cur.subVisualStyle) || "default") !== "default";
      if (j.seedNeeded && curNonDefault) {
        await helper("/subtitle-settings", { settings: { ...curApp, visualStyle: (cur && cur.subVisualStyle) || "default" } }, 7000).catch(() => {});
      } else {
        await chrome.storage.local.set({
          subAppearance: subAppFromSettings(s),
          subVisualStyle: ["default", "cinematic", "minimalist", "neon"].includes(s.visualStyle) ? s.visualStyle : "default"
        }).catch(() => {});
      }
    }
  } catch {}
}
async function syncHistoryWithHelper() {
  // Köhnə extension-un tarixçəsini helper-dən götür, birləşdir, geri yaz.
  try {
    const remote = await helper("/history", null, 5000).catch(() => null);
    const st = await chrome.storage.local.get("dlHistory").catch(() => ({}));
    const cur = Array.isArray(st && st.dlHistory) ? st.dlHistory : [];
    const keys = new Set(cur.map(x => x && x.key));
    const add = (remote && Array.isArray(remote.items) ? remote.items : []).filter(x => x && x.key && !keys.has(x.key));
    let merged = cur;
    if (add.length) {
      merged = [...cur, ...add].sort((a, b) => (+b.t || 0) - (+a.t || 0)).slice(0, 20);
      await chrome.storage.local.set({ dlHistory: merged }).catch(() => {});
    }
    if (merged.length) await helper("/history", { items: merged.slice(0, 20) }, 5000).catch(() => {});
  } catch {}
}
setTimeout(syncHistoryWithHelper, 2500);
syncStoredMpvStyle();
try { chrome.runtime.onStartup.addListener(syncStoredMpvStyle); } catch {}
try { chrome.runtime.onInstalled.addListener(syncStoredMpvStyle); } catch {}

// ---- Subtitrsiz YouTube musiqisi: internet sözləri + vaxt mənbəyi ----
const lrcCache = new Map();
async function lrclibFor(artist, title, duration = 0) {
  if (!title) return { sync: "", plain: "" };
  const key = [artist, title, Math.round(duration)].join("|").toLowerCase();
  if (lrcCache.has(key)) return lrcCache.get(key);
  const q = new URLSearchParams({ track_name: title });
  if (artist) q.set("artist_name", artist);
  if (duration > 0) q.set("duration", String(Math.round(duration)));
  let out = { sync: "", plain: "" };
  try {
    const r = await fetch("https://lrclib.net/api/search?" + q.toString(), { signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const arr = await r.json().catch(() => []);
      if (Array.isArray(arr)) {
        const exact = duration > 0 ? arr.find(x => x && x.syncedLyrics && Math.abs((+x.duration || 0) - duration) <= 3) : null;
        const item = exact || arr.find(x => x && x.syncedLyrics) || arr.find(x => x && x.plainLyrics);
        if (item) out = { sync: String(item.syncedLyrics || "").trim(), plain: String(item.plainLyrics || "").trim(), duration: +item.duration || duration };
      }
    }
  } catch {}
  if (lrcCache.size > 80) lrcCache.delete(lrcCache.keys().next().value);
  lrcCache.set(key, out);
  return out;
}
function parseLrc(text, duration = 0) {
  const raw = String(text || "").replace(/\r/g, "");
  const rows = [];
  let offset = 0;
  for (const line of raw.split("\n")) {
    const om = /^\s*\[offset:([+-]?\d+)\]\s*$/i.exec(line);
    if (om) { offset = +om[1] || 0; continue; }
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const textPart = line.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    if (!textPart) continue;
    for (const m of tags) {
      const frac = m[3] ? +(m[3].padEnd(3, "0").slice(0, 3)) : 0;
      const start = (+m[1] || 0) * 60000 + (+m[2] || 0) * 1000 + frac + offset;
      if (start >= 0) rows.push({ start, text: textPart });
    }
  }
  rows.sort((a, b) => a.start - b.start);
  const cues = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i], next = rows[i + 1];
    let end = next ? next.start - 40 : (duration > 0 ? Math.min(duration * 1000, cur.start + 7000) : cur.start + 5000);
    if (!(end > cur.start)) end = cur.start + (next ? Math.max(200, (next.start - cur.start) / 2) : 3000);
    if (duration > 0) end = Math.min(end, duration * 1000);
    if (end > cur.start) cues.push({ start: cur.start, end: Math.round(end), text: cur.text });
  }
  return cues;
}
async function songSeedSource(msg, tab, id, mediaTitle, cfg = {}) {
  const pageUrl = msg.pageUrl || tab?.url || "";
  const song = await getSongInfo(pageUrl, mediaTitle, cfg, id);
  if (!song || !song.song) throw new Error("Bu YouTube videosu musiqi kimi aşkarlanmadı");
  const azSong = await ensureAzLyrics(song, cfg, mediaTitle, null, id);
  const artist = song.artist || song.channel || "";
  const title = song.songTitle || song.videoTitle || mediaTitle;
  aiProgress(id, 6, "Mahnı sözləri və vaxtlar axtarılır…", { eta: null });
  const ref = song._lrclib || await lrclibFor(artist, title, song.duration || 0);
  song._lrclib = ref;
  let cues = [];
  let source = "lrclib";
  const lyrics = self.IDMAI.cleanLyricsText ? self.IDMAI.cleanLyricsText(song.lyrics || ref.plain || "") : (song.lyrics || ref.plain || "");
  // Rəsmi sayt sözləri varsa LRC mətnini üstün tutma: sözlər saytdakı kimi
  // qalsın, vaxt isə lokal MMS/CTC ilə verilsin.
  if (!(azSong && lyrics) && ref.sync) {
    cues = parseLrc(ref.sync, song.duration || ref.duration || 0);
  }
  if (!cues.length) {
    // Azərbaycan mahnısı: əvvəl keşdəki timed lyrics; yoxsa bir dəfə lokal MMS/CTC.
    if (azSong && lyrics) {
      if (Array.isArray(song.lrcCues) && lrcCuesValid(song.lrcCues, song.duration)) {
        cues = song.lrcCues;
        source = "lrc";
      }
      if (!cues.length) {
        const timed = timedCues(song, lyrics);
        if (timed) {
          cues = timed.cues;
          source = "mms-cache";
          song.timed = timed;
        } else {
          try {
            cues = await alignAzSong({ url: pageUrl, song, lyrics, mediaTitle, id });
            source = "mms-az";
            await saveTimedSong(song, song.id, { lang: "az", lyrics, cues, source: "mms", at: Date.now(), translations: {} });
          } catch (e) {
            try { aiProgress(id, 7, "MMS/CTC alınmadı · Gemini audio ilə davam…", { eta: 0 }); } catch {}
          }
        }
      }
    }
    if (!cues.length) {
      aiProgress(id, 7, "Audio Gemini-yə göndərilir…", { eta: null });
      const au = await helper("/audio", { url: pageUrl, referer: pageUrl }, 300000);
      if (!au || !au.data) throw new Error("Audio Gemini üçün hazırlana bilmədi");
      const aligned = await self.IDMAI.alignLyricsWithAudio({
        audio: { mimeType: au.mimeType || "audio/mp3", data: au.data },
        lyrics, duration: au.duration || song.duration || 0,
        apiKey: cfg.geminiApiKey, model: cfg.geminiModel,
        onProgress: (pct, text) => {
          const p = Math.max(7, Math.min(9, 7 + Math.round((Math.max(12, Math.min(16, pct)) - 12) / 4)));
          aiProgress(id, p, text || "Audio Gemini ilə vaxtlandırılır…", { eta: 0 });
        }
      });
      cues = (aligned.cues || []).map(c => ({ start: Math.max(0, Math.round(+c.start || 0)), end: Math.max(0, Math.round(+c.end || 0)), text: String(c.text || "").trim() })).filter(c => c.text && c.end > c.start);
      source = "gemini-audio";
    }
  }
  if (!cues.length) throw new Error("Mahnı üçün vaxtlandırılmış alt yazı hazırlana bilmədi");
  cues.sort((a, b) => a.start - b.start);
  const srt = self.IDMAI.toSrt(cues);
  const saved = await helper("/aisub/file", {
    text: srt, name: aiSubName(msg) + ".lyrics", lang: "", ext: "srt", dir: ""
  }, 20000);
  if (!saved || !saved.url) throw new Error("Mahnı sözləri alt yazı faylı kimi saxlanmadı");
  return { sub: { id: id + "-seed", url: saved.url, path: saved.path || "", fmt: "srt", lang: "", label: "Mahnı sözləri", auto: false, noYoutube: true }, path: saved.path || "", source };
}

// ---- AI Subtitr: mənbə seçimi, Gemini tərcüməsi, helper-də SRT, sonra mövcud yükləmə axını.
function aiProgress(id, pct, text, extra = {}) {
  try { chrome.runtime.sendMessage({ type: "aiProgress", id, pct, text, ...extra }).catch(() => {}); } catch {}
}

// Orijinal subtitr faylının uzantısı və videosuz baza adı.
function aiSubExt(fmt) {
  const f = String(fmt || "").toLowerCase();
  if (f.includes("json")) return "json3";
  if (f.includes("ttml") || f.includes("dfxp")) return "ttml";
  if (f.includes("ass") || f.includes("ssa")) return "ass";
  if (f.includes("vtt")) return "vtt";
  return "srt";
}
function aiSubName(msg) {
  const item = (msg.payload && msg.payload.item) || {};
  let name = String(item.name || msg.title || (msg.payload && msg.payload.label) || "subtitle");
  name = name.split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,6}$/i, "").trim();
  return name || "subtitle";
}

async function fetchAiSubtitle(sub, pageUrl) {
  if (!sub || !/^https?:/i.test(sub.url || "")) throw new Error("Subtitr URL-i yoxdur");
  const headers = { "User-Agent": navigator.userAgent };
  if (sub.referer || pageUrl) headers.Referer = sub.referer || pageUrl;
  try {
    const ck = cookieStr(await getCookies(sub.url));
    if (ck) headers.Cookie = ck;
  } catch {}
  if (sub.cookie) headers.Cookie = sub.cookie;
  const opts = { headers, credentials: "include", signal: AbortSignal.timeout(30000) };
  if (pageUrl) { try { opts.referrer = pageUrl; } catch {} }
  const r = await fetch(sub.url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = (await r.text()).slice(0, 8_000_000);
  const fmt = sub.fmt || sub.ext || "";
  // YouTube auto-caption-ları cumulative-dir: mətni AI-yə/muxing-ə verməzdən əvvəl təmizlə.
  const yt = !sub.noYoutube && (isYoutubeTab({ url: sub.url || "" }) || isYoutubeTab({ url: pageUrl || "" }));
  let cues = self.IDMAI.parseSubtitle(text, fmt, { youtube: yt });
  if (self.IDMAI.stripNonSpeech) cues = self.IDMAI.stripNonSpeech(cues);
  if (!cues.length) throw new Error("Subtitr mətni boşdur");
  return {
    text: self.IDMAI.toSrt(cues),
    rawText: text,
    cues,
    fmt: "srt",
    youtube: yt
  };
}

// YouTube .srt/.vtt faylını muxing-dən əvvəl delta-çıxarılmış, overlap-siz SRT-yə çevirir.
async function cleanYoutubeSubtitleForMux(entry, pageUrl) {
  if (!entry || !/^https?:/i.test(entry.url || "")) return null;
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(entry.url)) return null;   // artıq lokal AI faylıdır
  if (!self.IDMAI || !self.IDMAI.normalizeSubtitleCues) return null;
  const headers = { "User-Agent": navigator.userAgent };
  if (entry.referer || pageUrl) headers.Referer = entry.referer || pageUrl;
  try {
    if (entry.cookie) headers.Cookie = entry.cookie;
    else {
      const ck = cookieStr(await getCookies(entry.url));
      if (ck) headers.Cookie = ck;
    }
  } catch {}
  const r = await fetch(entry.url, { headers, credentials: "include", signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const text = (await r.text()).slice(0, 8_000_000);
  const fmt = /\.vtt(?:[?#]|$)/i.test(entry.url) ? "vtt" : /\.srt(?:[?#]|$)/i.test(entry.url) ? "srt" : "";
  const cues = self.IDMAI.parseSubtitle(text, fmt, { youtube: true });
  if (!cues.length) return null;
  // Seçilmiş vizual stil varsa orijinal YouTube subtitri də ASS kimi yazılır:
  // MPV/ffmpeg onu script və ya config olmadan belə seçilmiş stillə göstərir.
  let visualStyle = "default", subAppearance = null;
  try {
    const v = await chrome.storage.local.get(["subVisualStyle", "subAppearance"]);
    visualStyle = ["default", "cinematic", "minimalist", "neon"].includes(v && v.subVisualStyle) ? v.subVisualStyle : "default";
    subAppearance = v && v.subAppearance || null;
  } catch {}
  if ((visualStyle !== "default" || subAppearance) && self.IDMAI.toAss) {
    const ass = self.IDMAI.toAss(cues, visualStyle, subAppearance);
    const saved = await helper("/aisub/file", {
      text: ass, name: String(entry.label || "youtube").slice(0, 80),
      lang: entry.lang || "", ext: "ass", dir: ""
    }, 20000);
    if (saved && saved.url) return { ...entry, url: saved.url, fmt: "ass", label: entry.label || "YouTube" };
  }
  const srt = self.IDMAI.toSrt(cues);
  if (!srt.trim()) return null;
  const saved = await helper("/aisub/file", {
    text: srt, name: String(entry.label || "youtube").slice(0, 80),
    lang: entry.lang || "", ext: "srt", dir: ""
  }, 20000);
  return saved && saved.url ? { ...entry, url: saved.url, fmt: "srt", label: entry.label || "YouTube" } : null;
}

// Bir neçə subtitr mənbəyini paralel yoxlayır; ilk uğurlu cavabı qaytarır.
// Beləliklə birinci mənbə 30 saniyə gözlətsə də, digər mənbə dərhal tərcüməyə keçir.
function firstFulfilled(promises) {
  return new Promise(resolve => {
    let pending = promises.length;
    if (!pending) return resolve(null);
    promises.forEach(p => Promise.resolve(p).then(value => resolve(value)).catch(() => {
      if (--pending === 0) resolve(null);
    }));
  });
}

function aiResultStore(tabId, rec) {
  if (tabId == null || tabId < 0) return;
  let arr = aiResults.get(tabId) || [];
  arr = arr.filter(x => x && x.id !== rec.id);
  arr.push(rec);
  aiResults.set(tabId, arr.slice(-180));
  persist();
}
function aiResultUpdate(tabId, id, patch) {
  const arr = aiResults.get(tabId) || [];
  const it = arr.find(x => x && x.id === id);
  if (it) { Object.assign(it, patch || {}); persist(); }
  return it;
}
function aiResultDelete(tabId, id) {
  const old = (aiResults.get(tabId) || []).find(x => x && x.id === id);
  const arr = (aiResults.get(tabId) || []).filter(x => x && x.id !== id);
  if (arr.length) aiResults.set(tabId, arr); else aiResults.delete(tabId);
  persist();
  // "×" ilə silinəndə yalnız keş/YouTube qeydi deyil, final SRT/ASS faylları da silinir.
  if (old) {
    const paths = [...new Set([old.path, old.srtPath, old.assPath].filter(Boolean))];
    if (paths.length) { try { helper("/aisub/delete", { paths }, 5000).catch(() => {}); } catch {} }
  }
}
function aiResultDrop(tabId, id) {
  // Başqa videoya keçid: yalnız bu tab/video üçün keş qeydini çıxar; faylı silmə.
  const arr = (aiResults.get(tabId) || []).filter(x => x && x.id !== id);
  if (arr.length) aiResults.set(tabId, arr); else aiResults.delete(tabId);
  persist();
}
function aiResultClearTab(tabId) {
  aiResults.delete(tabId);
  persist();
}

async function detectTitleLang(title) {
  const text = String(title || "").trim();
  if (!text) return "";
  // CLD qısa başlıqlarda Azərbaycan dilini bəzən tr kimi qaytarır: səciyyəvi hərf/sözlərlə düzəlt.
  if (/[əƏ]/.test(text) || /(?<![\p{L}])(?:və|ilə|üçün|haqqında|necə|çox|yox|amma|ancaq|həm|hər|görə|etmək|Azərbaycan|Bakı)(?![\p{L}])/u.test(text)) return "az";
  try {
    if (!chrome.i18n || !chrome.i18n.detectLanguage) return "";
    const r = await new Promise(resolve => chrome.i18n.detectLanguage(text.slice(0, 1200), resolve));
    const list = ((r && r.languages) || []).filter(x => x && x.language && x.percentage > 0)
      .sort((a, b) => b.percentage - a.percentage);
    const code = list.length ? String(list[0].language || "").toLowerCase().replace(/_/g, "-").split("-")[0] : "";
    return ["und", "mul", "zxx", "unknown"].includes(code) ? "" : code;
  } catch { return ""; }
}

// ---- Azərbaycan mahnıları: Gemini sözlər + lokal MMS/CTC timing ----
function looksAzText(v) {
  const t = String(v || "");
  return /[əƏ]/.test(t) || /(?<![\p{L}])(?:və|ilə|üçün|haqqında|necə|çox|yox|amma|ancaq|həm|hər|görə|etmək|Azərbaycan|Bakı)(?![\p{L}])/u.test(t);
}

async function isAzSongInfo(song, mediaTitle, picked) {
  if (song && song.analysis) {
    if (!song.analysis.isMusic) return false;
    if (song.analysis.language && song.analysis.language !== "az") return false;
  }
  if (song && song.az) return true;
  if (picked && self.IDMAI && self.IDMAI.baseLang) {
    const pl = self.IDMAI.baseLang(picked.lang || picked.dlang || "");
    if (pl === "az") return true;
  }
  if (looksAzText(mediaTitle) || looksAzText(song && song.videoTitle) ||
      looksAzText(song && song.channel) || looksAzText(song && song.lyrics)) return true;
  return (await detectTitleLang(mediaTitle)) === "az";
}

// LRC vaxtları mahnının müddətinə uyğundurmu? (başqa versiya/başqa mahnı olmasın)
function lrcCuesValid(cues, duration) {
  if (!Array.isArray(cues) || cues.length < 8) return false;
  const last = Math.max(...cues.map(c => +c.end || 0));
  const dur = +duration || 0;
  if (!dur) return true;
  const ratio = last / (dur * 1000);
  return ratio >= 0.6 && ratio <= 1.08;
}

async function ensureAzLyrics(song, cfg, mediaTitle, picked, id, sample = "") {
  if (!song || !song.song) return false;
  let az = await isAzSongInfo(song, mediaTitle, picked);
  // Sözlər yoxsa və ya mənbə rəsmi sayt deyilsə, əvvəlcə rəsmi saytların öz
  // mətnini götür. Gemini yalnız son fallback-dir: əvvəl Gemini mətni götürəndə
  // rəsmi sözlər səhv variantla əvəz olunurdu (məs. "Müharibə" → "Mųharibə").
  const currentLyricsSource = String(song.lyricsSource || "");
  const currentOfficial = /(?:^https?:|azlyrics|genius|lyrics\.ovh)/i.test(currentLyricsSource);
  // Uğursuz axtarış sessiya boyu "donmasın": 45 s-dən sonra yeni cəhddə yenidən
  // sorğu verilir (Musixmatch/Genius keçici blokları tez keçir).
  const lyricsTriedAt = Number(song._azLyricsTried || 0);
  const lyricsRetryOk = !lyricsTriedAt || (Date.now() - lyricsTriedAt > 45000);
  if ((!song.lyrics || !currentOfficial) && lyricsRetryOk) {
    song._azLyricsTried = Date.now();
    const keySong = song.songTitle || song.videoTitle || mediaTitle || "";
    const artist = song.artist || song.channel || "";
    try {
      const hit = await lyricsLookup(artist, keySong, mediaTitle, { id, cfg, sample });
      if (hit && hit.lyrics) {
        song.lyrics = hit.lyrics;
        song.lyricsSource = hit.source || "lyrics";
        if (hit.lrc && lrcCuesValid(hit.lrc, song.duration)) song.lrcCues = hit.lrc;
      }
    } catch {}
  }
  if (song.lyrics && self.IDMAI && self.IDMAI.cleanLyricsText) song.lyrics = self.IDMAI.cleanLyricsText(song.lyrics);
  if (!az && song.lyrics) az = await isAzSongInfo(song, mediaTitle, picked);
  return az;
}

async function researchSongInfo(info, mediaTitle, cfg) {
  if (!info) return null;
  const title = String(info.videoTitle || mediaTitle || "").trim();
  if (!title) return null;
  const channel = String(info.channel || "").trim();
  const meta = parseSongMeta(title, channel);
  const artist = meta.artist || channel;
  const song = meta.song || title;
  let lyr = "";
  try {
    const hit = await lyricsLookup(artist, song, title, { cfg });
    if (hit && hit.lyrics) lyr = hit.lyrics;
  } catch {}
  if (!lyr) {   // sənətçi adı yanlış ola bilər: yalnız mahnı adı ilə bir dəfə
    try {
      const hit2 = await lyricsLookup("", song, title, { cfg });
      if (hit2 && hit2.lyrics) lyr = hit2.lyrics;
    } catch {}
  }
  if (lyr && self.IDMAI && self.IDMAI.cleanLyricsText) lyr = self.IDMAI.cleanLyricsText(lyr);
  if (lyr && lyr.length >= 40) {
    const lang = await detectTitleLang(lyr);
    const az = looksAzText(lyr) || lang === "az";
    return { song: true, az, language: lang || (az ? "az" : ""), lyrics: lyr, artist, songTitle: song, confidence: 1, source: "lyrics" };
  }
  if (self.IDMAI && self.IDMAI.classifySong && cfg && cfg.geminiApiKey) {
    const c = await self.IDMAI.classifySong({ title, channel, apiKey: cfg.geminiApiKey, model: cfg.geminiModel });
    if (c && c.isSong && (+c.confidence || 0) >= 0.5) {
      return { song: true, az: String(c.language || "").toLowerCase() === "az", language: String(c.language || "").toLowerCase(), lyrics: "", artist: c.artist || artist, songTitle: c.song || song, confidence: +c.confidence || 0, source: "search" };
    }
  }
  return null;
}

async function alignAzSong({ url, song, lyrics, mediaTitle, id }) {
  if (!lyrics || lyrics.trim().length < 20) throw new Error("Mahnı sözləri yoxdur");
  const t0 = Date.now();
  const stage = txt => { try { aiProgress(id, 8, txt, { eta: null }); } catch {} };
  stage("Azərbaycan mahnısı: audio yüklənir → MMS/CTC modeli işə düşür… (0 s)");
  const tick = setInterval(() => stage(`MMS/CTC sözləri səsə uyğunlaşdırır… (${Math.round((Date.now() - t0) / 1000)} s)`), 5000);
  let r;
  try {
    r = await helper("/songalign", {
      url, title: mediaTitle || "", artist: song.artist || song.channel || "",
      song: song.songTitle || song.videoTitle || "", lyrics,
      duration: song.duration || 0,
      exclude: (song.analysis && Array.isArray(song.analysis.nonMusicIntervals)) ? song.analysis.nonMusicIntervals : []
    }, 900000);
  } finally { clearInterval(tick); }
  const cues = (r && Array.isArray(r.cues) ? r.cues : []).map(c => ({
    start: Math.max(0, Math.round(+c.start || 0)),
    end: Math.max(0, Math.round(+c.end || 0)),
    text: String(c.text || "").trim(),
    tag: !!c.tag
  })).filter(c => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
  if (!cues.length) throw new Error("MMS/CTC boş nəticə verdi");
  return cues;
}

// ---- Mahnı klipi aşkarlanması + internetdən rəsmi sözlər ----
// Yalnız YouTube musiqi videolarında işləyir. Sözlər tapılmasa tərcümə adi qaydada davam edir.
const songInfoCache = new Map();
const SONG_CACHE_MAX = 80;
function ytVideoIdFromUrl(u) {
  try {
    const x = new URL(u || "");
    if (/(?:^|\.)youtu\.be$/i.test(x.hostname)) return x.pathname.split("/").filter(Boolean).pop() || "";
    if (!/(?:^|\.)(?:youtube\.com|youtube-nocookie\.com)$/i.test(x.hostname)) return "";
    if (/\/shorts\//i.test(x.pathname)) return x.pathname.split("/").filter(Boolean).pop() || "";
    return x.searchParams.get("v") || "";
  } catch { return ""; }
}
function htmlDecode(s) {
  return String(s || "").replace(/\\u([0-9a-f]{4})/gi, (_, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch { return ""; } })
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}
function ytHtmlField(html, name) {
  const re = new RegExp('"' + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"', "i");
  const m = re.exec(html || "");
  return m ? htmlDecode(m[1]) : "";
}
function cleanSongPart(s) {
  const tech = /\b(?:official|audio|video|videos|music|musiqi|rəsmi|resmi|lyrics?|lyric|visuali[sz]er|live|akustik|acoustic|acustic|remix|cover|piano|piyano|gitar|gitara|guitar|jazz|versiya|version|full|hd|hq|uhd|fhd|hdr|hdr10|4k|8k|144p|240p|360p|480p|720p|1080p|1440p|2160p|60fps|30fps|slowed|reverb|sped\s*up|nightcore|instrumental|karaoke|remaster(?:ed)?|explicit|clip|mahn[ıi]|klip|quality|keyfiyyət)\b/gi;
  return htmlDecode(s)
    // (), [], <>, {}, fullwidth parentheses and lenticular brackets
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|<[^>]*>|[（][^）]*[）]|[【][^】]*[】]/g, " ")
    .replace(/\bvol(?:ume)?\.?\s*\d+\b/gi, " ")
    .replace(tech, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/[|•].*$/, " ")
    .replace(/\b(?:feat|ft)\.?\s+.*$/i, " ")
    .replace(/[+*]+/g, " ")
    .replace(/\s+/g, " ").replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
}
function parseSongMeta(videoTitle, channel) {
  let raw = String(videoTitle || "").replace(/\s*[-–—|]\s*YouTube\s*$/i, "").trim();
  let artist = String(channel || "").replace(/\s*-\s*Topic\s*$/i, " ").replace(/VEVO\s*$/i, " ").trim();
  let song = raw;
  const parts = raw.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    const left = cleanSongPart(parts.shift()), right = cleanSongPart(parts.join(" - "));
    if (left) artist = left;
    if (right) song = right;
  } else {
    song = cleanSongPart(raw);
  }
  artist = cleanSongPart(artist);
  if (!song) song = cleanSongPart(raw);
  return { artist, song };
}
function songTitleVariants(song) {
  const base = String(song || "").trim();
  if (!base) return [];
  const noTail = base.replace(/[!?.,;:…]+$/g, "").trim();
  const oneBang = base.replace(/[!?]+$/g, "!").trim();
  const oneQ = base.replace(/[!?]+$/g, "?").trim();
  const plain = base.replace(/[!?.,;:…]+/g, "").trim();
  // ASCII yazılmış Azərbaycan adları: "Sen Olsaydin" → "Sən Olsaydın".
  let diacritics = [];
  try { diacritics = azDiacriticVariants(base).slice(0, 4); } catch {}
  return [...new Set([base, noTail, oneBang, oneQ, plain, ...diacritics].filter(Boolean))];
}
async function fetchLyricsOvh(artist, song) {
  if (!artist || !song) return "";
  for (const title of songTitleVariants(song).slice(0, 2)) {
    const url = "https://api.lyrics.ovh/v1/" + encodeURIComponent(artist) + "/" + encodeURIComponent(title);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      const text = String(j && j.lyrics || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
      if (text.length >= 40) return text.slice(0, 24000);
    } catch {}
  }
  return "";
}
async function fetchLyricsOvhSuggest(song) {
  if (!song) return "";
  try {
    const u = "https://api.lyrics.ovh/suggest/" + encodeURIComponent(song);
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return "";
    const j = await r.json().catch(() => ({}));
    const want = normSearch(song);
    const rows = (j && j.data || []).slice(0, 6);
    for (const x of rows) {
      const a = x && x.artist && x.artist.name;
      const t = x && x.title;
      if (!a || !t) continue;
      const got = normSearch(t);
      if (!got || got !== want) continue;
      const txt = await fetchLyricsOvh(a, t);
      if (txt) return txt;
    }
  } catch {}
  return "";
}

const azBizCache = new Map();
function azBizArtistVariants(artist) {
  const raw = String(artist || "").trim();
  const out = [];
  const add = x => { const v = String(x || "").replace(/\s+/g, " ").trim(); if (v && !out.includes(v)) out.push(v); };
  add(raw);
  add(raw.replace(/\s*(?:&|,|\/|\b(?:ft|feat|vs|and)\.?)\s+.*$/i, ""));
  add(raw.replace(/\s+[x×]\s+.*$/i, ""));
  add(raw.replace(/\s*(?:&|,|\/|\b(?:ft|feat|vs|and)\.?)\s+/gi, " "));
  add(raw.replace(/\s+[x×]\s+/gi, " "));
  return out;
}
const mxmCache = new Map();
const lyfCache = new Map();

// Lyricsify slug/arama variantları: ə→e, ı→i, ğ→g, ş→s, ç→c, ö→o, ü→u
function lyfTr(s) {
  return String(s || "").replace(/[əƏ]/g, "e").replace(/[ıİ]/g, "i").replace(/[ğĞ]/g, "g")
    .replace(/[şŞ]/g, "s").replace(/[çÇ]/g, "c").replace(/[öÖ]/g, "o").replace(/[üÜ]/g, "u");
}
function lyfNorm(s) {
  return lyfTr(String(s || "").toLowerCase()).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function lyfHtmlText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:div|p|li|h\d|pre)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}
function lyfLrc(text) {
  const rows = [];
  for (const line of String(text || "").replace(/\r/g, "").split("\n")) {
    const m = line.trim().match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.+)$/);
    if (!m) continue;
    const ms = (+m[1]) * 60000 + (+m[2]) * 1000 + +(String(m[3] || "0").padEnd(3, "0").slice(0, 3));
    const txt = m[4].replace(/\s+/g, " ").trim();
    if (txt) rows.push([ms, txt]);
  }
  if (rows.length < 4) return [];
  return rows.map(([s, t], i) => ({
    start: s,
    end: i + 1 < rows.length ? Math.max(s + 700, Math.min(rows[i + 1][0] - 60, s + 8000)) : s + 4000,
    text: t
  }));
}
// Cloudflare yalnız real tab-da keçilir: görünməyən tab açılır, DOM oxunur, bağlanır.
const lyfTabState = { deadUntil: 0, running: false };

function lyfSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function lyfTabOpen(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  return tab && tab.id;
}

async function lyfTabRead(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        title: String(document.title || ""),
        text: String((document.body && document.body.innerText) || "").slice(0, 200000),
        links: [...document.querySelectorAll('a[href*="/lyric/"]')]
          .map(a => a.getAttribute("href")).filter(Boolean).slice(0, 60)
      })
    });
    return (res && res[0] && res[0].result) || null;
  } catch { return null; }
}

// Səhifə Cloudflare-dən keçənə qədər gözləyib DOM-u oxuyur.
async function lyfTabWait(tabId, ready, timeout = 22000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await lyfSleep(1200);
    const got = await lyfTabRead(tabId);
    if (got && ready(got)) return got;
  }
  return null;
}

async function fetchLyricsifyViaTab(queries, artist, song, opts = {}) {
  const say = t => { try { opts.onStatus && opts.onStatus(t); } catch {} };
  if (lyfTabState.running || Date.now() < lyfTabState.deadUntil) return null;
  lyfTabState.running = true;
  let tabId = null;
  try {
    say("Lyricsify: Cloudflare üçün görünməz tab açılır…");
    tabId = await lyfTabOpen("https://www.lyricsify.com/");
    if (!tabId) return null;
    const want = lyfNorm(artist + " " + song);
    for (const q of queries.slice(0, 2)) {
      say(`Lyricsify (tab): «${q}» axtarılır…`);
      try { await chrome.tabs.update(tabId, { url: `https://www.lyricsify.com/search?q=${encodeURIComponent(q)}` }); } catch { continue; }
      const page = await lyfTabWait(tabId, g => (g.links && g.links.length > 0) || /\[\d{1,2}:\d{2}/.test(g.text),
        q === queries[0] ? 12000 : 8000);
      if (!page) { say("Lyricsify (tab): nəticə görünmədi"); continue; }
      let links = page.links || [];
      if (!links.length) {
        // artıq lyric səhifəsindəyiksə
        const lrc = lyfLrc(page.text);
        if (lrc.length >= 4) {
          say(`Lyricsify (tab): LRC oxundu (${lrc.length} sətir)`);
          return { lyrics: lrc.map(c => c.text).join("\n").slice(0, 24000), lrc, url: "https://www.lyricsify.com/", source: "lyricsify" };
        }
        continue;
      }
      const scored = links.map(ln => {
        const slug = lyfNorm(String(ln).replace("/lyric/", "").split("/")[0].replace(/-/g, " "));
        let sc = 0;
        for (const w of new Set(want.split(" "))) if (w && slug.split(" ").includes(w)) sc++;
        if (lyfNorm(song) && slug.includes(lyfNorm(song))) sc += 2;
        return [sc, ln];
      }).sort((x, y) => y[0] - x[0]);
      say(`Lyricsify (tab): ${links.length} nəticə`);
      for (const [sc, ln] of scored.slice(0, 2)) {
        if (sc <= 0) break;
        const u = "https://www.lyricsify.com" + String(ln).replace("https://www.lyricsify.com", "");
        say(`Lyricsify (tab): səhifə açılır ${ln}`);
        try { await chrome.tabs.update(tabId, { url: u }); } catch { continue; }
        const lp = await lyfTabWait(tabId, g => /\[\d{1,2}:\d{2}/.test(g.text) || lyfLrc(g.text || "").length >= 4, 12000);
        if (!lp) continue;
        const lrc = lyfLrc(lp.text);
        if (lrc.length >= 4) {
          say(`Lyricsify (tab): LRC oxundu (${lrc.length} sətir)`);
          return { lyrics: lrc.map(c => c.text).join("\n").slice(0, 24000), lrc, url: u, source: "lyricsify" };
        }
        const plain = String(lp.text || "").split("\n").map(x => x.replace(/\s+/g, " ").trim())
          .filter(x => x.length >= 3 && !/lyricsify|cookie|privacy|terms|sign in|upload|download lrc|security|verification/i.test(x))
          .join("\n");
        if (plain.trim().length >= 40) {
          say(`Lyricsify (tab): mətn oxundu (${plain.trim().length} simvol)`);
          return { lyrics: plain.slice(0, 24000), lrc: [], url: u, source: "lyricsify" };
        }
      }
    }
    // Axtarış səhifəsi nəticə vermədisə: sənətçi səhifəsindən mahnı linkini tap.
    for (const a2 of [artist, lyfTr(artist)]) {
      const slugA = lyfNorm(a2).replace(/\s+/g, "-");
      if (!slugA) continue;
      say(`Lyricsify (tab): sənətçi səhifəsi /artist/${slugA}`);
      try { await chrome.tabs.update(tabId, { url: `https://www.lyricsify.com/artist/${encodeURIComponent(slugA)}` }); } catch { continue; }
      const ap = await lyfTabWait(tabId, g => (g.links && g.links.length > 0), 10000);
      if (!ap || !ap.links || !ap.links.length) continue;
      const scoredA = ap.links.map(ln => {
        const slug = lyfNorm(String(ln).replace("/lyric/", "").split("/")[0].replace(/-/g, " "));
        let sc = 0;
        for (const w of new Set(want.split(" "))) if (w && slug.split(" ").includes(w)) sc++;
        if (lyfNorm(song) && slug.includes(lyfNorm(song))) sc += 2;
        return [sc, ln];
      }).sort((x, y) => y[0] - x[0]);
      say(`Lyricsify (tab): sənətçi səhifəsində ${ap.links.length} link`);
      for (const [sc, ln] of scoredA.slice(0, 2)) {
        if (sc <= 0) break;
        const u = "https://www.lyricsify.com" + String(ln).replace("https://www.lyricsify.com", "");
        say(`Lyricsify (tab): səhifə açılır ${ln}`);
        try { await chrome.tabs.update(tabId, { url: u }); } catch { continue; }
        const lp = await lyfTabWait(tabId, g => /\[\d{1,2}:\d{2}/.test(g.text) || lyfLrc(g.text || "").length >= 4, 12000);
        if (!lp) continue;
        const lrc = lyfLrc(lp.text);
        if (lrc.length >= 4) {
          say(`Lyricsify (tab): LRC oxundu (${lrc.length} sətir)`);
          return { lyrics: lrc.map(c => c.text).join("\n").slice(0, 24000), lrc, url: u, source: "lyricsify" };
        }
      }
    }
    lyfTabState.deadUntil = Date.now() + 10 * 60 * 1000;   // 10 dəq təkrarlamamaq
    say("Lyricsify (tab): alınmadı");
    return null;
  } catch (e) {
    lyfTabState.deadUntil = Date.now() + 5 * 60 * 1000;
    say("Lyricsify (tab): xəta");
    return null;
  } finally {
    lyfTabState.running = false;
    if (tabId) { try { await chrome.tabs.remove(tabId); } catch {} }
  }
}

async function fetchLyricsifyLyrics(artist, song, opts = {}) {
  const say = t => { try { opts.onStatus && opts.onStatus(t); } catch {} };
  const a = String(artist || "").trim(), sg = String(song || "").trim();
  if (!sg) return null;
  const key = (a + "|" + sg).toLowerCase();
  if (lyfCache.has(key)) return lyfCache.get(key);
  const queries = [];
  for (const [a2, s2] of [[a, sg], [lyfTr(a), sg], [a, lyfTr(sg)], [lyfTr(a), lyfTr(sg)]]) {
    const q = `${a2} ${s2}`.trim();
    if (q && !queries.some(x => x.toLowerCase() === q.toLowerCase())) queries.push(q);
  }
  const want = lyfNorm(a + " " + sg);
  let best = null;
  for (const q of queries.slice(0, 3)) {
    say(`Lyricsify: «${q}» axtarılır…`);
    const urls = [
      `https://www.lyricsify.com/search?q=${encodeURIComponent(q)}`,
      `https://www.lyricsify.com/search/${encodeURIComponent(q.replace(/\s+/g, "+"))}`
    ];
    let links = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { credentials: "include", headers: { "Accept": "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) continue;
        const html = (await r.text()).slice(0, 900_000);
        links = [...new Set([...html.matchAll(/href="(\/lyric\/[^"#?]+)"/g)].map(m => m[1]))];
        say(`Lyricsify: ${r.status} · ${links.length} nəticə`);
        if (links.length) break;
      } catch {}
    }
    const scored = links.slice(0, 25).map(ln => {
      const slug = lyfNorm(ln.replace("/lyric/", "").split("/")[0].replace(/-/g, " "));
      let sc = 0;
      for (const w of new Set(want.split(" "))) if (w && slug.split(" ").includes(w)) sc++;
      if (lyfNorm(sg) && slug.includes(lyfNorm(sg))) sc += 2;
      return [sc, ln];
    }).sort((x, y) => y[0] - x[0]);
    for (const [sc, ln] of scored.slice(0, 2)) {
      if (sc <= 0) break;
      try {
        say(`Lyricsify: səhifə açılır ${ln}`);
        const r2 = await fetch("https://www.lyricsify.com" + ln, { credentials: "include", headers: { "Accept": "text/html" }, signal: AbortSignal.timeout(20000) });
        if (!r2.ok) continue;
        const text = lyfHtmlText((await r2.text()).slice(0, 1_200_000));
        const lrc = lyfLrc(text);
        const lyrics = lrc.length ? lrc.map(c => c.text).join("\n") : text.split("\n").map(x => x.replace(/\s+/g, " ").trim())
          .filter(x => x.length >= 3 && !/lyricsify|cookie|privacy|terms|sign in|upload|download lrc/i.test(x)).join("\n");
        if (lyrics.trim().length >= 40) { best = { lyrics: lyrics.slice(0, 24000), lrc, url: "https://www.lyricsify.com" + ln, source: "lyricsify" }; break; }
      } catch {}
    }
    if (best) break;
  }
  if (!best) best = await fetchLyricsifyViaTab(queries, a, sg, opts);
  if (best) {   // uğursuzluğu keşləmirik: növbəti cəhddə yenidən yoxlanır
    if (lyfCache.size > 60) lyfCache.delete(lyfCache.keys().next().value);
    lyfCache.set(key, best);
  }
  return best;
}

async function fetchMusixmatchLyrics(artist, song) {
  const a = String(artist || "").trim(), sg = String(song || "").trim();
  if (!a || !sg) return null;
  const key = (a + "|" + sg).toLowerCase();
  if (mxmCache.has(key)) return mxmCache.get(key);
  const slug = s => String(s || "").toLowerCase()
    .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
    .replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u").replace(/İ/g, "i")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Musixmatch kanonik slug-ı diakritikləri saxlayır (…/Qara-Derviş/Yorğun);
  // transliterasiya isə 308-lə yönləndirir. Hər ikisini sına.
  const keep = s => String(s || "").toLowerCase().normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  const as = slug(a), ss = slug(sg);
  const ka = keep(a), ks = keep(sg);
  const pairs = [];
  for (const [a2, s2] of [[ka, ks], [ka, ss], [as, ks], [as, ss]]) {
    if (a2 && s2 && !pairs.some(p => p[0] === a2 && p[1] === s2)) pairs.push([a2, s2]);
  }
  if (!pairs.length) return null;
  const cands = [];
  for (const [a2, s2] of pairs) for (const suf of ["", "-1", "-2"]) {
    const u = `https://www.musixmatch.com/lyrics/${encodeURIComponent(a2)}${suf}/${encodeURIComponent(s2)}`;
    if (!cands.includes(u)) cands.push(u);
  }
  for (const u of cands) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(u, { credentials: "include", headers: { "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000) });
        if (r.status === 403 || r.status === 429) {
          if (attempt === 0) { await new Promise(z => setTimeout(z, 1200)); continue; }   // keçici blok
          break;
        }
        if (!r.ok) break;
        const html = (await r.text()).slice(0, 900_000);
        const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!m) break;
        let j; try { j = JSON.parse(m[1]); } catch { break; }
        const lp = j && j.props && j.props.pageProps;
        const body = (((lp.trackInfo || {}).data || {}).lyrics || {}).body ||
                     ((((lp.data || {}).trackInfo || {}).data || {}).lyrics || {}).body || "";
        const text = String(body).trim();
        if (text.length >= 40) {
          const res = { lyrics: text.slice(0, 24000), source: "musixmatch", url: u };
          if (mxmCache.size > 80) mxmCache.delete(mxmCache.keys().next().value);
          mxmCache.set(key, res);
          return res;
        }
        break;
      } catch {
        if (attempt === 0) { await new Promise(z => setTimeout(z, 1000)); continue; }
        break;
      }
    }
  }
  if (mxmCache.size > 80) mxmCache.delete(mxmCache.keys().next().value);
  mxmCache.set(key, null);
  return null;
}

// Ardıcıl (eyni anda YOX) sözlər axtarışı: Genius -> Musixmatch -> lrclib -> lyrics.ovh
// -> azlyrics -> LyricsTranslate -> Gemini. Hər addım barda göstərilir; uğursuzluq
// heç nəyi dayandırmır, növbəti mənbəyə keçilir.
async function lyricsLookup(artist, song, title, opts = {}) {
  const id = opts.id || "", cfg = opts.cfg || {};
  const prog = (text) => { try { if (id) aiProgress(id, 6, text); } catch {} };
  const step = async (name, fn) => {
    const q = [artist, song].filter(Boolean).join(" — ");
    prog(`Sözlər: ${name}${q ? " · «" + q + "»" : ""} axtarılır…`);
    try {
      const r = await fn();
      const text = String((r && (r.lyrics || r)) || "").trim();
      if (text.length >= 40) {
        // Tapılan sözlər həqiqətən bu mahnıdırmı? ASR mətni ilə oxşarlıq yoxlanır.
        const sample = String(opts.sample || "");
        if (sample && sample.length > 40 && self.IDMAI && self.IDMAI.lyricsSimilarity) {
          let sim = 0;
          try { sim = self.IDMAI.lyricsSimilarity(text, sample) || 0; } catch { sim = 0; }
          if (sim < 0.3) { prog(`Sözlər: ${name} ✗ uyğun deyil (${Math.round(sim * 100)}%)`); return null; }
        }
        prog(`Sözlər: ${name} ✓ (${text.length} simvol${r && r.lrc && r.lrc.length ? ", LRC vaxtlı" : ""})`);
        return { lyrics: text.slice(0, 24000), source: name, lrc: (r && Array.isArray(r.lrc) ? r.lrc : []) };
      }
      prog(`Sözlər: ${name} ✗ tapılmadı`);
    } catch (e) {
      prog(`Sözlər: ${name} ✗ ${String(e && e.message || e).slice(0, 60)}`);
    }
    return null;
  };
  const a = String(artist || "").trim(), sg = String(song || "").trim(), ti = String(title || "").trim();
  const chain = [
    ["Genius", async () => {
      try { const r = await helper("/genius", { artist: a, song: sg }, 40000); if (r && r.lyrics) return r; } catch {}
      const g = await fetchGeniusLyrics(a, sg, ti);
      return g && g.lyrics ? g : null;
    }],
    ["Musixmatch", async () => {
      try { const r = await helper("/mxm", { artist: a, song: sg }, 40000); if (r && r.lyrics) return r; } catch {}
      return await fetchMusixmatchLyrics(a, sg);
    }],
    ["Lyricsify", async () => {
      prog("Sözlər: Lyricsify · server axtarışı…");
      try { const r = await helper("/lyricsify", { artist: a, song: sg }, 30000); if (r && r.lyrics) return r; } catch {}
      prog("Sözlər: Lyricsify · brauzer sessiyası ilə axtarılır…");
      return await fetchLyricsifyLyrics(a, sg, { onStatus: s => prog("Sözlər: " + s) });
    }],
    ["lrclib", async () => { const r = await lrclibFor(a, sg); return (r && (r.plain || r.sync)) ? { lyrics: r.plain || r.sync } : null; }],
    ["lyrics.ovh", async () => { for (let i = 0; i < 2; i++) { const x = await fetchLyricsOvh(a, sg); if (x) return { lyrics: x }; await new Promise(r => setTimeout(r, 900)); } return null; }],
    ["azlyrics", async () => { const x = await fetchAzLyricsBiz(a, sg); return x && x.lyrics ? x : null; }],
    ["LyricsTranslate", async () => { const r = await helper("/lyrics", { artist: a, song: sg, title: ti }, 60000); return r && r.lyrics ? r : null; }],
    ["Gemini", async () => {
      if (!cfg.geminiApiKey || !self.IDMAI || !self.IDMAI.findLyrics) return null;
      let x = await self.IDMAI.findLyrics({ artist: a, song: sg, apiKey: cfg.geminiApiKey, model: cfg.geminiModel });
      if (!x) x = await self.IDMAI.findLyrics({ artist: "", song: sg, apiKey: cfg.geminiApiKey, model: cfg.geminiModel });
      return x ? { lyrics: x } : null;
    }]
  ];
  for (const [name, fn] of chain) {
    const hit = await step(name, fn);
    if (hit) return hit;
    await new Promise(r => setTimeout(r, 450));   // mənbələri ardıcıl və nəzakətli sorğula
  }
  prog("Sözlər: heç bir mənbədə tapılmadı");
  return { lyrics: "", source: "" };
}

async function fetchAzLyricsBiz(artist, song) {
  const ar = String(artist || "").trim();
  const sg = String(song || "").trim();
  if (!ar || !sg) return null;
  const key = ar.toLowerCase() + "|" + sg.toLowerCase();
  if (azBizCache.has(key)) return azBizCache.get(key);
  try {
    for (const a of azBizArtistVariants(ar)) {
      const slug = geniusSlug(a);
      if (!slug) continue;
      const base = "https://azlyrics.biz/" + slug[0] + "/" + slug + "-lyrics/";
      let html = "";
      try {
        const r = await fetch(base, { headers: { "Accept-Language": "az,en;q=0.8" }, signal: AbortSignal.timeout(12000) });
        if (!r.ok) continue;
        html = await r.text();
      } catch { continue; }
      const want = songTitleVariants(sg).map(geniusSlug).filter(Boolean);
      const links = [];
      for (const m of html.matchAll(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        let u = htmlDecode(m[1] || "");
        try { u = new URL(u, base).href; } catch { continue; }
        if (!/^https?:\/\/azlyrics\.biz\//i.test(u)) continue;
        if (!/\/[-a-z0-9%]+-lyrics\/$/i.test(u)) continue;
        const path = (() => { try { return decodeURIComponent(new URL(u).pathname); } catch { return ""; } })();
        const norm = geniusSlug(path.split("/").filter(Boolean).pop() || "");
        if (!norm || !want.some(w => norm.includes(w))) continue;
        if (!links.includes(u)) links.push(u);
      }
      for (const u of links.slice(0, 3)) {
        try {
          const rr = await fetch(u, { headers: { "Accept-Language": "az,en;q=0.8" }, signal: AbortSignal.timeout(15000) });
          if (!rr.ok) continue;
          const page = await rr.text();
          const i = page.indexOf('id="konten"');
          if (i < 0) continue;
          let chunk = page.slice(i, i + 60000);
          const end = chunk.search(/<\/article>|<footer\b/i);
          if (end > 0) chunk = chunk.slice(0, end);
          const lines = [];
          for (const m of chunk.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
            const t = htmlDecode(m[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
              .replace(/[ \t]+/g, " ").trim();
            if (t && !/^Loading\.\.\.$/i.test(t)) lines.push(t);
          }
          const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
          if (text.length >= 40) {
            const result = { lyrics: text.slice(0, 24000), url: u, source: "azlyrics.biz" };
            azBizCache.set(key, result);
            return result;
          }
        } catch {}
      }
    }
  } catch {}
  azBizCache.set(key, null);
  return null;
}

const geniusCache = new Map();
function geniusSlug(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
    .replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u").replace(/[’']/g, "")
    .replace(/&/g, " and ").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function geniusCandidates(artist, song) {
  const rawArtist = String(artist || "").trim();
  const artists = [];
  const pushArtist = x => { const s = geniusSlug(x); if (s && !artists.includes(s)) artists.push(s); };
  pushArtist(rawArtist);
  // "Xpert x Paster", "A & B", "A feat. B", "A vs B" → əsas sənətçi variantları
  pushArtist(rawArtist.replace(/\s*(?:&|,|\/|\b(?:ft|feat|vs|and)\.?)\s+.*$/i, ""));
  pushArtist(rawArtist.replace(/\s*(?:&|,|\/|\b(?:ft|feat|vs|and)\.?)\s+/gi, " "));
  pushArtist(rawArtist.replace(/\s+[x×]\s+.*$/i, ""));
  pushArtist(rawArtist.replace(/\s+[x×]\s+/gi, " "));
  const full = geniusSlug(song);
  if (!full) return [];
  const parts = String(song || "").split(/\s*[\/|]\s*/).map(geniusSlug).filter(Boolean);
  const slugs = [];
  const add = x => { if (x && !slugs.includes(x)) slugs.push(x); };
  // Sənətçi versiyası tapılmasa: yalnız mahnı adı ilə.
  add(`${full}-lyrics`);
  add(`${full}-live-lyrics`);
  for (const p of parts) { add(`${p}-lyrics`); add(`${p}-live-lyrics`); }
  for (const a of artists) {
    add(`${a}-${full}-lyrics`);
    add(`${a}-${full}-live-lyrics`);
    for (const p of parts) { add(`${a}-${p}-lyrics`); add(`${a}-${p}-live-lyrics`); }
  }
  return slugs.slice(0, 18).map(x => "https://genius.com/" + x);
}
const geniusSearchCache = new Map();
async function geniusSearchHits(query) {
  if (!query) return [];
  const u = "https://genius.com/api/search/song?q=" + encodeURIComponent(query);
  try {
    const r = await fetch(u, {
      credentials: "include",
      headers: { "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://genius.com/" },
      signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    const sections = (j && j.response && Array.isArray(j.response.sections)) ? j.response.sections : [];
    const hits = [];
    for (const sec of sections) for (const h of (sec && Array.isArray(sec.hits) ? sec.hits : [])) {
      const x = h && h.result;
      if (x && x.path) hits.push(x);
    }
    return hits;
  } catch { return []; }
}
function geniusLyricsFromHtml(html) {
  if (!html || !/data-lyrics-container/i.test(html)) return "";
  const blocks = [];
  // Genius səhifəsində lyrics konteynerinin içində nested div-lər olur.
  // Ona görə ilk </div>-də dayanmırıq; div balansını sayırıq.
  const starts = [...html.matchAll(/<div[^>]*data-lyrics-container="true"[^>]*>/gi)];
  for (const m of starts) {
    const from = m.index + m[0].length;
    let depth = 1, end = -1;
    const tag = /<div\b[^>]*>|<\/div\s*>/gi;
    tag.lastIndex = from;
    let t;
    while ((t = tag.exec(html))) {
      if (/^<\/div/i.test(t[0])) depth--;
      else depth++;
      if (depth === 0) { end = t.index; break; }
    }
    if (end < 0) continue;
    const text = stripHtmlText(html.slice(from, end));
    if (text.length >= 20) blocks.push(text);
  }
  if (!blocks.length) return "";
  const unique = [];
  for (const t of blocks) if (!unique.some(x => x === t) && !unique.some(x => x.includes(t))) unique.push(t);
  return unique.join("\n").replace(/^\s*\d+\s+Contributors?[^\n]*\n/i, "").replace(/^\s*[^\n]*\bLyrics\s*$/gmi, "").trim();
}
function azDiacriticCats() {
  return [
  { ch: "e", from: /e/g, fromUp: /E/g, to: "ə", toUp: "Ə" },
  { ch: "i", from: /i/g, fromUp: /I/g, to: "ı", toUp: "I" },
  { ch: "s", from: /s/g, fromUp: /S/g, to: "ş", toUp: "Ş" },
  { ch: "c", from: /c/g, fromUp: /C/g, to: "ç", toUp: "Ç" },
  { ch: "g", from: /g/g, fromUp: /G/g, to: "ğ", toUp: "Ğ" },
  { ch: "o", from: /o/g, fromUp: /O/g, to: "ö", toUp: "Ö" },
  { ch: "u", from: /u/g, fromUp: /U/g, to: "ü", toUp: "Ü" }
];
}
function azWordForms(word) {
  const lower = String(word || "").toLowerCase();
  const cats = azDiacriticCats().filter(c => lower.includes(c.ch));
  let full = lower;
  for (const c of cats) full = full.replace(c.from, c.to);
  // Ən çox rast gəlinən hal: e→ə, i→ı (Sen Olsaydin → Sən Olsaydın).
  let common = lower.replace(/e/g, "ə").replace(/i/g, "ı");
  let forms = [common, full, lower];
  // Söz daxilində qismən dəyişikliklər (məs. Seher → Şəhər).
  for (const c of cats) {
    const next = [];
    for (const f of forms) {
      next.push(f);
      next.push(f.replace(c.from, c.to));
    }
    forms = next;
  }
  return [...new Set(forms)];
}
function azDiacriticVariants(text) {
  const base = String(text || "").replace(/\s+/g, " ").trim();
  if (!base) return [];
  let combos = [""];
  for (const word of base.split(" ")) {
    const forms = azWordForms(word);
    const next = [];
    for (const pre of combos) for (const f of forms) next.push(pre ? pre + " " + f : f);
    combos = next.slice(0, 64);
  }
  return [...new Set(combos)];
}
function geniusArtistMatches(want, got) {
  const wa = normSearch(want), ga = normSearch(got);
  if (!wa) return true;
  if (!ga) return false;
  if (ga === wa || ga.includes(wa) || wa.includes(ga)) return true;
  const a = new Set(wa.split(" ").filter(Boolean)), b = new Set(ga.split(" ").filter(Boolean));
  let hit = 0; for (const x of a) if (b.has(x)) hit++;
  return hit / Math.max(1, Math.min(a.size, b.size)) >= .5;
}
async function fetchGeniusSearch(artist, song, title = "") {
  const a = String(artist || "").trim();
  const sg = String(song || "").trim();
  if (!sg) return null;
  const key = [a, sg].join("|").toLowerCase();
  if (geniusSearchCache.has(key)) return geniusSearchCache.get(key);
  const queries = [];
  const addQ = (q, requireArtist = false) => {
    q = String(q || "").replace(/\s+/g, " ").trim();
    if (q && !queries.some(x => x.q === q)) queries.push({ q, requireArtist });
  };
  // Sənətçi + mahnı: "Xpert x Paster" kimi birləşmələri və
  // ASCII yazılmış Azərbaycan sözlərini (Sen → Sən, Olsaydin → Olsaydın) yoxla.
  const artists = [];
  const addArtist = x => { x = String(x || "").replace(/\s+/g, " ").trim(); if (x && !artists.some(y => y.toLowerCase() === x.toLowerCase())) artists.push(x); };
  if (a) for (const x of azBizArtistVariants(a)) addArtist(x);
  if (a) for (const x of azDiacriticVariants(a)) addArtist(x);
  const songs = azDiacriticVariants(sg);
  for (const ar of artists.slice(0, 4)) {
    for (const sv of songs.slice(0, 3)) addQ(ar + " " + sv, true);
  }
  for (const sv of songs.slice(0, 3)) addQ(sv, false);
  if (title) addQ(title, false);
  for (const spec of queries.slice(0, 14)) {
    const hits = await geniusSearchHits(spec.q);
    const ranked = hits.map(x => {
      const gotTitle = x.title || x.full_title || "";
      const gotArtist = x.artist_names || x.primary_artist_names || "";
      // Sənətçi verilibsə, yalnız ada görə tapılan başqa ifaçı mahnısını qəbul etmə.
      if (a && !geniusArtistMatches(a, gotArtist)) return null;
      return { x, score: searchScore(sg, a, gotTitle, gotArtist) };
    }).filter(v => v && v.score >= 1).sort((x, y) => y.score - x.score);
    for (const { x } of ranked.slice(0, 8)) {
      let url = String(x.path || "");
      if (!url) continue;
      if (!/^https?:/i.test(url)) url = "https://genius.com/" + url.replace(/^\/+/, "");
      try {
        const r = await fetch(url, {
          credentials: "include",
          headers: { "Accept-Language": "en-US,en;q=0.9", "Referer": "https://genius.com/" },
          signal: AbortSignal.timeout(15000)
        });
        if (!r.ok) continue;
        const html = (await r.text()).slice(0, 1_500_000);
        const lyrics = geniusLyricsFromHtml(html);
        if (lyrics.length < 40) continue;
        const result = {
          lyrics: lyrics.slice(0, 24000), source: "genius-search", url,
          title: x.full_title || x.title || sg,
          artist: x.artist_names || x.primary_artist_names || a
        };
        if (geniusSearchCache.size > 100) geniusSearchCache.delete(geniusSearchCache.keys().next().value);
        geniusSearchCache.set(key, result);
        return result;
      } catch {}
    }
  }
  if (geniusSearchCache.size > 100) geniusSearchCache.delete(geniusSearchCache.keys().next().value);
  geniusSearchCache.set(key, null);
  return null;
}

async function fetchGeniusLyrics(artist, song, title = "") {
  const key = [artist || "", song || "", title || ""].join("|").toLowerCase();
  if (geniusCache.has(key)) return geniusCache.get(key);
  // Əvvəlcə Genius-un öz axtarışı: slug/URL təxmininə ehtiyac yoxdur.
  let found = null;
  try { found = await fetchGeniusSearch(artist, song, title); } catch {}
  if (found) {
    if (geniusCache.size > 100) geniusCache.delete(geniusCache.keys().next().value);
    geniusCache.set(key, found);
    return found;
  }
  // Axtarış nəticə verməsə, köhnə slug variantları ehtiyat kimi qalır.
  const urls = geniusCandidates(artist, song);
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        credentials: "include",
        headers: { "Accept-Language": "en-US,en;q=0.9", "Referer": "https://genius.com/" },
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) continue;
      const html = (await r.text()).slice(0, 1_500_000);
      const text = geniusLyricsFromHtml(html);
      if (text.length < 40) continue;
      const result = { lyrics: text.slice(0, 24000), source: "genius", url, title: title || song, artist };
      if (geniusCache.size > 100) geniusCache.delete(geniusCache.keys().next().value);
      geniusCache.set(key, result);
      return result;
    } catch {}
  }
  const none = { lyrics: "", source: "", url: "", title: "", artist: "" };
  geniusCache.set(key, none);
  return none;
}

// ---- LyricsTranslate dəqiq axtarışı (sözlər tapılmayanda) ----
const ltCache = new Map();
function stripHtmlText(v) {
  return htmlDecode(String(v || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function normSearch(v) {
  return String(v || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
    .replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}
function searchScore(wantTitle, wantArtist, gotTitle, gotArtist) {
  const wt = normSearch(wantTitle), gt = normSearch(gotTitle);
  const wa = normSearch(wantArtist), ga = normSearch(gotArtist);
  if (!gt) return -1;
  let title = 0;
  if (wt && gt) {
    const a = new Set(wt.split(" ").filter(Boolean)), b = new Set(gt.split(" ").filter(Boolean));
    let hit = 0; for (const x of a) if (b.has(x)) hit++;
    title = hit / Math.max(1, Math.min(a.size, b.size));
    if (wt === gt) title += 1;
    if (gt.includes(wt) || wt.includes(gt)) title += .35;
  }
  let artist = 0;
  if (wa && ga) {
    if (ga === wa || ga.includes(wa) || wa.includes(ga)) artist = 1;
    else {
      const a = new Set(wa.split(" ").filter(Boolean)), b = new Set(ga.split(" ").filter(Boolean));
      let hit = 0; for (const x of a) if (b.has(x)) hit++;
      artist = hit / Math.max(1, Math.min(a.size, b.size));
    }
  }
  return title + artist * 1.25;
}
function parseLtResults(html, base = "https://lyricstranslate.com") {
  const out = [];
  const re = /<a href="(\/en\/[^"]+?-lyrics(?:\.html)?)"[^>]*class="block-1-table__title"[^>]*>\s*<h2>(.*?)<\/h2>\s*<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const start = Math.max(0, html.lastIndexOf("block-search-res__item", m.index));
    const end = html.indexOf("block-search-res__item", m.index + m[0].length);
    const block = html.slice(start, end > 0 ? end : m.index + 5000);
    const ym = /i\.ytimg\.com\/vi\/([\w-]+)\//.exec(block);
    const am = /class="block-1-table__author"[\s\S]*?<span class="text">(.*?)<\/span>/.exec(block);
    out.push({ url: new URL(m[1], base).href, title: stripHtmlText(m[2]), artist: stripHtmlText(am ? am[1] : ""), videoId: ym ? ym[1] : "" });
  }
  return out;
}
function extractLtLyrics(html) {
  const at = html.search(/id=["']song-body["']/i);
  if (at < 0) return "";
  const chunk = html.slice(at, at + 260000);
  const lines = [];
  const re = /<div[^>]*class=["'][^"']*\bll-\d+-\d+\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(chunk))) {
    const t = stripHtmlText(m[1]).replace(/\s+/g, " ").trim();
    if (t) lines.push(t);
  }
  return lines.join("\n").trim();
}
async function ddgSearch(query) {
  let html = "";
  try {
    const u = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);
    const r = await fetch(u, { credentials: "omit", headers: { "User-Agent": navigator.userAgent, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(12000) });
    if (r.ok) html = (await r.text()).slice(0, 900_000);
  } catch {}
  if (!html) return [];
  const out = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = htmlDecode(m[1]);
    let title = stripHtmlText(m[2]);
    if (!/lyricstranslate\.com/i.test(href)) continue;
    try {
      if (/duckduckgo\.com\/l\//i.test(href)) {
        const x = new URL(href, "https://duckduckgo.com");
        href = x.searchParams.get("uddg") || href;
      }
    } catch {}
    try { href = decodeURIComponent(href); } catch {}
    if (!/^https?:\/\//i.test(href)) continue;
    if (!/lyricstranslate\.com\/(?:[a-z]{2}\/)?[^?#]+-lyrics(?:\.html)?/i.test(href)) continue;
    out.push({ url: href, title, artist: "", videoId: "" });
  }
  return out;
}
async function lyricsTranslateFind(videoId, videoTitle, channel) {
  const key = String(videoId || "") + "|" + normSearch(videoTitle);
  if (ltCache.has(key)) return ltCache.get(key);
  const meta = parseSongMeta(videoTitle, channel);
  // Cloudflare LyricsTranslate-i birbaşa bloklayır. Helper arxiv nüsxəsini
  // CDX ilə tapır və vaxt məlumatı olmayan rəsmi sözləri qaytarır.
  try {
    const wb = await helper("/lyrics", { artist: meta.artist || channel || "", song: meta.song || videoTitle || "", title: videoTitle || "" }, 120000);
    if (wb && wb.lyrics && String(wb.lyrics).length >= 40) {
      const result = { lyrics: String(wb.lyrics), source: wb.source || "lyricstranslate-wayback", url: wb.url || "", title: wb.title || "", artist: wb.artist || "" };
      if (ltCache.size > 100) ltCache.delete(ltCache.keys().next().value);
      ltCache.set(key, result);
      return result;
    }
  } catch {}
  const queries = [];
  if (meta.artist && meta.song) queries.push(`${meta.artist} ${meta.song}`);
  if (meta.artist && meta.song) queries.push(`${meta.artist} ${meta.song} mahnı sözləri`);
  if (meta.song) queries.push(`${meta.song} lyrics`);
  if (meta.song) queries.push(`${meta.song} mahnı sözləri`);
  if (!queries.length) queries.push(String(videoTitle || ""));
  const seen = new Set();
  let best = null, bestScore = -1;
  for (const q of queries.slice(0, 5)) {
    let html = "";
    try {
      const u = "https://lyricstranslate.com/en/site-search?query=" + encodeURIComponent(q);
      const r = await fetch(u, { credentials: "include", headers: { "User-Agent": navigator.userAgent, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(12000) });
      if (r.ok) html = (await r.text()).slice(0, 1_500_000);
    } catch {}
    if (!html) continue;
    const rows = parseLtResults(html);
    for (const row of rows) {
      if (seen.has(row.url)) continue;
      seen.add(row.url);
      const exactVideo = videoId && row.videoId && row.videoId === videoId;
      const score = (exactVideo ? 10 : 0) + searchScore(meta.song || videoTitle, meta.artist || channel, row.title, row.artist);
      if (score > bestScore) { bestScore = score; best = row; }
    }
  }
  if (!best || bestScore < 0.45) {
    for (const q of queries.slice(0, 4)) {
      const rows = await ddgSearch('site:lyricstranslate.com ' + q);
      for (const row of rows) {
        if (seen.has(row.url)) continue;
        seen.add(row.url);
        const score = searchScore(meta.song || videoTitle, meta.artist || channel, row.title, row.artist);
        if (score > bestScore) { bestScore = score; best = row; }
      }
    }
  }
  if (best && bestScore >= 0.35) {
    try {
      const r = await fetch(best.url, { credentials: "include", headers: { "User-Agent": navigator.userAgent, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const html = (await r.text()).slice(0, 2_000_000);
        const lyrics = extractLtLyrics(html);
        if (lyrics.length >= 40) {
          const result = { lyrics, source: "lyricstranslate", url: best.url, title: best.title, artist: best.artist };
          if (ltCache.size > 100) ltCache.delete(ltCache.keys().next().value);
          ltCache.set(key, result);
          return result;
        }
      }
    } catch {}
  }
  const none = { lyrics: "", source: "", url: "", title: "", artist: "" };
  ltCache.set(key, none);
  return none;
}

const SONG_TIMED_PREFIX = "songTimed:";
function timedCues(info, lyrics) {
  const t = info && info.timed;
  if (!t || !Array.isArray(t.cues) || !t.cues.length) return null;
  if (String(t.lyrics || "").trim() !== String(lyrics || "").trim()) return null;
  return t;
}
async function loadTimedSong(info, id) {
  if (!info || !id || info.timed) return;
  try {
    const key = SONG_TIMED_PREFIX + id;
    const r = await chrome.storage.session.get(key);
    if (r && r[key]) info.timed = r[key];
  } catch {}
}
async function saveTimedSong(info, id, timed) {
  if (!info || !timed) return timed;
  info.timed = timed;
  try { await chrome.storage.session.set({ [SONG_TIMED_PREFIX + id]: timed }); } catch {}
  return timed;
}

async function getSongInfo(pageUrl, fallbackTitle = "", cfg = {}, progId = "") {
  const id = ytVideoIdFromUrl(pageUrl);
  if (!id) return null;
  if (songInfoCache.has(id)) return songInfoCache.get(id);
  const say = t => { try { if (progId) aiProgress(progId, 4, t, { eta: null }); } catch {} };
  say("Mahnı məlumatı: YouTube səhifəsi oxunur…");
  const info = { id, song: false, az: false, videoTitle: String(fallbackTitle || ""), channel: "", category: "", musicVideoType: "", artist: "", songTitle: "", lyrics: "", duration: 0 };
  await loadTimedSong(info, id);
  try {
    const r = await fetch("https://www.youtube.com/watch?v=" + encodeURIComponent(id) + "&hl=en", {
      credentials: "include",
      headers: { "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(10000)
    });
    if (r.ok) {
      const html = (await r.text()).slice(0, 3_500_000);
      const vd = (/"videoDetails":\{(.{0,12000}?)\},(?:"|\})/s.exec(html) || [])[1] || html;
      const title = ytHtmlField(vd, "title") || ytHtmlField(html, "title");
      const channel = ytHtmlField(html, "ownerChannelName") || ytHtmlField(html, "author");
      const category = ytHtmlField(html, "category");
      const mvt = ytHtmlField(html, "musicVideoType");
      const dur = +ytHtmlField(vd, "lengthSeconds") || 0;
      info.duration = dur > 0 ? dur : 0;
      if (title && !/^(?:download unavailable|indirilemiyor|video unavailable)$/i.test(title.trim())) info.videoTitle = title;
      else if (fallbackTitle) info.videoTitle = String(fallbackTitle);
      info.channel = channel || info.channel;
      info.category = category || "";
      info.musicVideoType = mvt || "";
      const hay = [info.videoTitle, info.channel, info.category, info.musicVideoType].join(" ");
      info.song = /(?:^|[\s"'])(?:music)(?:[\s"']|$)/i.test(info.category)
        || /MUSIC_VIDEO_TYPE_/i.test(info.musicVideoType)
        || /\b(?:official\s+)?(?:music\s+)?(?:video|audio)\b|lyrics?\s+video|visuali[sz]er|song|mahn[ıi]|klip\b/i.test(info.videoTitle)
        || /(?:-\s*Topic\s*$|VEVO\s*$)/i.test(info.channel);
      if (info.song) {
        const meta = parseSongMeta(info.videoTitle, info.channel);
        info.artist = meta.artist; info.songTitle = meta.song;
        const tries = [];
        if (meta.artist && meta.song) tries.push([meta.artist, meta.song]);
        if (meta.song && meta.artist) tries.push([meta.song, meta.artist]);
        if (info.channel && meta.song && info.channel !== meta.artist) tries.push([info.channel, meta.song]);
        if (meta.artist && info.videoTitle) tries.push([meta.artist, info.videoTitle]);
        const seen = new Set();
        for (const [a, t] of tries) {
          const k = a + "|" + t; if (seen.has(k)) continue; seen.add(k);
          say(`Mahnı sözləri: lyrics.ovh · «${a} — ${t}»`);
          const lyr = await fetchLyricsOvh(a, t);
          if (lyr) { info.lyrics = lyr; break; }
        }
      }
    }
  } catch {}
  if (!info.song) {
    const hay = String(fallbackTitle || "");
    info.song = /\b(?:official\s+)?(?:music\s+)?(?:video|audio)\b|lyrics?\s+video|visuali[sz]er|mahn[ıi]|klip\b/i.test(hay);
    if (info.song) {
      const meta = parseSongMeta(fallbackTitle, "");
      info.artist = meta.artist; info.songTitle = meta.song;
    }
  }
  // Bəzi musiqi videolarında YouTube kateqoriyası/başlığı "music" demir
  // (məs. "Okaber — Qanqa"). Artist — mahnı formatı + münasib müddət varsa,
  // lyrics axtarışı ilə musiqi olduğunu təsdiqləyirik.
  if (!info.song) {
    const rawTitle = String(info.videoTitle || fallbackTitle || "");
    const meta = parseSongMeta(rawTitle, info.channel);
    const chan = cleanSongPart(info.channel).toLowerCase();
    const art = cleanSongPart(meta.artist).toLowerCase();
    const channelMatch = !!(chan && art && (chan === art || chan.includes(art) || art.includes(chan)));
    const emDash = /\s[—–]\s/.test(rawTitle);
    const separator = emDash || /\s-\s/.test(rawTitle);
    const durOk = !info.duration || (info.duration >= 45 && (emDash || info.duration <= 900 || channelMatch));
    if (separator && meta.artist && meta.song && durOk &&
        (emDash || channelMatch || /\b(?:topic|vevo)\b/i.test(info.channel))) {
      info.song = true;
      info.artist = meta.artist;
      info.songTitle = meta.song;
    }
  }
  if (info.song && !info.lyrics) {
    if (!info.artist || !info.songTitle) {
      const meta = parseSongMeta(info.videoTitle || fallbackTitle, info.channel);
      info.artist = info.artist || meta.artist; info.songTitle = info.songTitle || meta.song;
    }
    const tries = [];
    if (info.artist && info.songTitle) tries.push([info.artist, info.songTitle]);
    if (info.songTitle && info.artist) tries.push([info.songTitle, info.artist]);
    if (info.channel && info.songTitle) tries.push([info.channel, info.songTitle]);
    const seen = new Set();
    for (const [a, t] of tries) {
      const k = a + "|" + t; if (seen.has(k)) continue; seen.add(k);
      say(`Mahnı sözləri: lyrics.ovh · «${a} — ${t}»`);
      const lyr = await fetchLyricsOvh(a, t);
      if (lyr) { info.lyrics = lyr; break; }
    }
    if (!info.lyrics) {
      try {
        say(`Mahnı sözləri: Genius · «${info.artist || info.channel} — ${info.songTitle || info.videoTitle}»`);
        const g = await fetchGeniusLyrics(info.artist || info.channel, info.songTitle || info.videoTitle, info.videoTitle || fallbackTitle);
        if (g && g.lyrics) { info.lyrics = g.lyrics; info.lyricsSource = g.url; }
      } catch {}
    }
    if (!info.lyrics) {
      try {
        say("Mahnı sözləri: LyricsTranslate axtarılır…");
        const lt = await lyricsTranslateFind(id, info.videoTitle || fallbackTitle, info.channel);
        if (lt && lt.lyrics) { info.lyrics = lt.lyrics; info.lyricsSource = lt.url; }
      } catch {}
    }
    if (!info.lyrics) {
      try {
        const az = await fetchAzLyricsBiz(info.artist || info.channel, info.songTitle);
        if (az && az.lyrics) { info.lyrics = az.lyrics; info.lyricsSource = az.url; }
      } catch {}
    }
    // Sənətçi versiyası yoxdursa, yalnız mahnı adı ilə axtar.
    if (!info.lyrics && info.songTitle) {
      try { info.lyrics = await fetchLyricsOvhSuggest(info.songTitle); } catch {}
    }
    if (!info.lyrics && info.songTitle) {
      try {
        const g = await fetchGeniusLyrics("", info.songTitle, info.videoTitle || fallbackTitle);
        if (g && g.lyrics) { info.lyrics = g.lyrics; info.lyricsSource = g.url; }
      } catch {}
    }
  }
  // Naməlum musiqi videoları: internetdə həqiqətən mahnı və az olub-olmadığını yoxla.
  if (!info.song || !info.lyrics) {
    const durOk = !info.duration || (info.duration >= 30 && (info.duration <= 900 || /\s[—–]\s/.test(info.videoTitle || fallbackTitle)));
    if (durOk) {
      const researched = await researchSongInfo(info, fallbackTitle, cfg);
      if (researched && researched.song) {
        info.song = true;
        info.az = !!researched.az;
        info.artist = researched.artist || info.artist;
        info.songTitle = researched.songTitle || info.songTitle;
        if (researched.lyrics) info.lyrics = researched.lyrics;
        info.researchSource = researched.source || "";
      }
    }
  }
  // Gemini multimodal strict validation: music? which language? live intervals?
  if (!info.analysis && cfg && cfg.geminiApiKey && self.IDMAI && self.IDMAI.analyzeMusicMedia &&
      (info.song || info.lyrics || /\s[—–]\s/.test(info.videoTitle || fallbackTitle) ||
       (info.duration && info.duration >= 30 && info.duration <= 900))) {
    const a = await self.IDMAI.analyzeMusicMedia({
      videoUrl: pageUrl || ("https://www.youtube.com/watch?v=" + encodeURIComponent(id)),
      title: info.videoTitle || fallbackTitle,
      artist: info.artist || info.channel,
      song: info.songTitle || "",
      apiKey: cfg.geminiApiKey, model: cfg.geminiModel
    });
    if (a) {
      info.analysis = a;
      if (!a.isMusic) { info.song = false; info.az = false; }
      else if (a.language === "az") { info.song = true; info.az = true; }
      else if (a.language && a.language !== "az") { info.az = false; }
    }
  }
  songInfoCache.set(id, info);
  if (songInfoCache.size > SONG_CACHE_MAX) songInfoCache.delete(songInfoCache.keys().next().value);
  return info;
}

// İki alt yazı trekini üst/alt sətirli tək "İkili dil" faylına birləşdirir.
async function dualSubtitle(msg, tab) {
  const id = "dual-" + Date.now();
  const pageUrl = msg.pageUrl || tab?.url || "";
  if (!self.IDMAI || !self.IDMAI.combineDualCues) throw new Error("AI modulu yüklənmədi");
  const top = msg.top, bottom = msg.bottom;
  if (!top || !bottom || top.kind === bottom.kind && top.id === bottom.id) throw new Error("İki fərqli alt yazı seçin");
  const cuesOf = async d => {
    if (!d) return [];
    if (d.kind === "ai" && d.srt) {
      let cues = self.IDMAI.parseSubtitle(d.srt, "srt", { youtube: false });
      if (self.IDMAI.stripNonSpeech) cues = self.IDMAI.stripNonSpeech(cues);
      if (self.IDMAI.repairSubtitleTimeline) cues = self.IDMAI.repairSubtitleTimeline(cues, { mergeFragments: false, minDuration: 160 });
      return cues;
    }
    if (d.kind === "orig" && d.sub && /^https?:/i.test(d.sub.url || "")) {
      const parsed = await fetchAiSubtitle(d.sub, pageUrl);
      return parsed && parsed.cues || [];
    }
    return [];
  };
  const [topCues, bottomCues] = await Promise.all([cuesOf(top), cuesOf(bottom)]);
  if (!topCues.length) throw new Error("Üst alt yazının mətni oxunmadı");
  if (!bottomCues.length) throw new Error("Aşağı alt yazının mətni oxunmadı");
  let dual = self.IDMAI.combineDualCues(topCues, bottomCues);
  if (!dual.length) throw new Error("İkili alt yazı yaradıla bilmədi");
  const topColor = String(top.color || "#ffffff");
  const bottomColor = String(bottom.color || "#ffffff");
  const topFlag = String(top.flag || "");
  const bottomFlag = String(bottom.flag || "");
  const codeOf = d => String((d && (d.lang || (d.sub && (d.sub.lang || d.sub.dlang)))) || "").trim();
  let subAppearance = null;
  try { subAppearance = (await chrome.storage.local.get("subAppearance")).subAppearance || null; } catch {}
  const srt = self.IDMAI.toSrt(dual);
  const ass = self.IDMAI.toAssDual
    ? self.IDMAI.toAssDual(dual, { topColor, bottomColor, topFlag, bottomFlag, topCode: codeOf(top), bottomCode: codeOf(bottom), appearance: subAppearance })
    : "";
  const baseName = aiSubName(msg) + ".ikili";
  const srtFile = await helper("/aisub/file", {
    text: srt, name: baseName, lang: "dual", label: "İkili dil", ext: "srt", dir: ""
  }, 20000);
  if (!srtFile || !srtFile.url) throw new Error("İkili alt yazı faylı saxlanmadı");
  let assFile = null;
  if (ass) {
    try {
      assFile = await helper("/aisub/file", {
        text: ass, name: baseName, lang: "dual", label: "İkili dil", ext: "ass", dir: ""
      }, 20000);
    } catch {}
  }
  const sub = {
    id, url: (assFile && assFile.url) || srtFile.url, path: (assFile && assFile.path) || srtFile.path,
    srtUrl: srtFile.url, srtPath: srtFile.path, assUrl: assFile && assFile.url || "", assPath: assFile && assFile.path || "",
    srt, lang: "dual", label: "İkili dil", dual: true,
    topId: String(top.id || ""), bottomId: String(bottom.id || ""),
    topLabel: String(top.label || top.lang || ""), bottomLabel: String(bottom.label || bottom.lang || ""),
    topColor, bottomColor, topFlag, bottomFlag,
    referer: pageUrl, pageUrl, prompted: false, integrated: false, time: Date.now()
  };
  aiResultStore(tab?.id, sub);
  return { ok: true, sub };
}

async function aiSubtitleDownload(msg, tab) {
  const id = String(msg.id || ("ai-" + Date.now()));
  try { aiProgress(id, 1, "AI altyazı başladı…"); } catch {}
  let originalFile = null, saved = null, partFiles = [];
  let seedPath = "", seedKind = "";
  try {
    if (!self.IDMAI) throw new Error("AI modulu yüklənmədi");
    const cfg = await chrome.storage.local.get(["geminiApiKey", "geminiModel"]);
    if (!cfg.geminiApiKey || !cfg.geminiModel) throw new Error("Gemini API açarı/modeli yoxdur. AI ayarlarını açın.");
    const target = String(msg.target || "").trim().replace(/_/g, "-") || "az";
    const targetCode = self.IDMAI.baseLang(target);
    const targetName = self.IDMAI.langName(target) || self.IDMAI.langName(targetCode) || target;
    const forcedSource = msg.sourceSub && /^https?:/i.test(msg.sourceSub.url || "") ? msg.sourceSub : null;
    let rawSubs = forcedSource ? [forcedSource] : (msg.subs || []).filter(s => s && !s.subAll && s.url);
    // Heç bir mənbə alt yazısı yoxdursa müqayisə etmə: boş mətnlə 0 uyğunluq
    // çıxıb rəsmi sözləri səhvən rədd edirdi.
    const hadSourceSubs = rawSubs.length > 0;
    const mediaTitle = String(msg.title || tab?.title || "").replace(/\s*[-–—|]\s*YouTube\s*$/i, "");
    if (!rawSubs.length && isYoutubeTab({ url: msg.pageUrl || tab?.url || "" })) {
      const seed = await songSeedSource(msg, tab, id, mediaTitle, cfg);
      rawSubs = [seed.sub]; seedPath = seed.path || ""; seedKind = seed.source || "";
    }
    let titleLang = await detectTitleLang(mediaTitle);
    const subLang = x => self.IDMAI.baseLang(x && (x.dlang || x.lang || x.short || "")) || "";
    const isManualSub = x => !!(x && x.auto !== true && x.src !== "auto");
    const isOrigAuto = x => !!(self.IDMAI.isAutoOriginal && self.IDMAI.isAutoOriginal(x));
    if (!titleLang) {
      const orig = rawSubs.find(isOrigAuto);
      if (orig) titleLang = subLang(orig);
    }
    const sourceList = self.IDMAI.prioritizeSubs(rawSubs, titleLang);
    if (msg.sub && msg.sub.url && !sourceList.some(s => s.url === msg.sub.url)) sourceList.push(msg.sub);
    if (!sourceList.length) throw new Error("Bu axın üçün subtitr tapılmadı");

    // Prioritet qrupları: 0 manual+başlıq dili, 1 başlıq/orijinal avto,
    // 2 başlıq/avto tərcümə, 3 digər orijinal avto, 4 digər manual, 5 digər avto.
    const tierOf = x => {
      const l = subLang(x);
      if (!titleLang) {
        if (isManualSub(x)) return 0;
        return isOrigAuto(x) ? 1 : 2;
      }
      if (isManualSub(x)) return l === titleLang ? 0 : 4;
      if (l === titleLang) return isOrigAuto(x) ? 1 : 2;
      return isOrigAuto(x) ? 3 : 5;
    };
    const tiers = new Map();
    for (const x of sourceList.slice(0, 14)) {
      const t = tierOf(x);
      if (!tiers.has(t)) tiers.set(t, []);
      tiers.get(t).push(x);
    }
    const seedBase = seedPath ? (seedKind === "gemini-audio" ? 10 : 8) : 2;
    aiProgress(id, seedBase, titleLang ? `Subtitr mənbəyi seçilir… ${titleLang}` : "Subtitr mənbəyi seçilir…");
    let picked = null, parsed = null;
    const orderedTiers = [...tiers.keys()].sort((a, b) => a - b);
    let tried = 0;
    const total = Math.min(14, sourceList.length);
    for (const t of orderedTiers) {
      const list = tiers.get(t) || [];
      for (let i = 0; i < list.length && !parsed; i += 3) {
        const batch = list.slice(i, i + 3);
        tried += batch.length;
        aiProgress(id, Math.max(seedBase, seedPath ? (seedKind === "gemini-audio" ? 11 : 9) : 5), `Subtitr yüklənir… ${Math.min(total, tried)}/${total}`);
        const hit = await firstFulfilled(batch.map(async sub => ({
          sub, value: await fetchAiSubtitle(sub, msg.pageUrl || tab?.url || "")
        })));
        if (hit) { picked = hit.sub; parsed = hit.value; }
      }
      if (parsed) break;
    }
    if (!picked || !parsed) throw new Error("Mövcud subtitr mənbələri oxunmadı");

    // YouTube-un avtomatik yaratmadığı Azərbaycanca alt yazı: olduğu kimi saxla.
    const sourceLangForTrack = self.IDMAI.baseLang(picked.lang || picked.dlang || "");
    const sourceIsAuto = picked.auto === true || picked.src === "auto" || /\b(?:auto|avto)\b/i.test(String(picked.label || ""));
    const manualAzSource = sourceLangForTrack === "az" && !sourceIsAuto;

    // Mənbə auto-caption-larında 10 ms-lik dublikatlar və söz-söz parçalar olur.
    // Tərcümədən ƏVVƏL onları təmizlə ki, hər tərcümə sətri düzgün vaxta bağlansın.
    try {
      if (!manualAzSource && self.IDMAI.repairSubtitleTimeline) {
        const fixedSource = self.IDMAI.repairSubtitleTimeline(parsed.cues, { mergeFragments: true, minDuration: 320 });
        if (fixedSource.length) {
          parsed.cues = fixedSource;
          parsed.text = self.IDMAI.toSrt(fixedSource);
          parsed.fmt = "srt";
          aiProgress(id, Math.max(seedBase, seedPath ? (seedKind === "gemini-audio" ? 11 : 9) : 5), "Vaxt xətti təmizlənir…");
        }
      }
    } catch {}

    // Mahnı klipi: yalnız musiqi videosunda rəsmi sözləri götür, mövcud zamanlanmış
    // sətirlərlə uyğunlaşdır və mətni düzəlt. Sətirlərin start/end dəyərləri dəyişmir.
    let lyricsCorrected = false;
    let timestampsExact = !!seedPath;
    let songDetected = false;
    let songIsAz = false;
    let songSourceLang = "";
    let songInfo = null;
    let timedSong = null;
    let officialConfirmed = true;
    let lyricProgress = 0;
    if (manualAzSource) {
      aiProgress(id, 7, "Mövcud Azərbaycanca alt yazı olduğu kimi istifadə olunur…", { eta: 0 });
    } else try {
      aiProgress(id, Math.max(6, lyricProgress), "Mahnı klipi yoxlanılır…");
      const song = await getSongInfo(msg.pageUrl || tab?.url || "", mediaTitle, cfg, id);
      songInfo = song || null;
      if (song && song.song) {
        songDetected = true;
        const azSample = (parsed && parsed.cues ? parsed.cues.map(c => String(c.text || "")).join(" ") : "").slice(0, 4000);
        const azSong = await ensureAzLyrics(song, cfg, mediaTitle, picked, id, azSample);
        songIsAz = !!azSong;
        songSourceLang = azSong ? (picked.lang || picked.dlang || "az") : (picked.lang || picked.dlang || titleLang || "");
        if (song.lyrics && self.IDMAI.cleanLyricsText) song.lyrics = self.IDMAI.cleanLyricsText(song.lyrics);
        // Eyni adlı fərqli mahnı ehtimalı: YouTube auto-az mətni ilə 50%+ oxşarlıq tələb et.
        if (hadSourceSubs && !seedPath && azSong && song.lyrics && sourceIsAuto && parsed.cues.length && self.IDMAI.lyricsSimilarity) {
          const autoText = parsed.cues.map(c => String(c.text || "")).join(" ");
          const sim = self.IDMAI.lyricsSimilarity(song.lyrics, autoText);
          if (sim < 0.3) {   // ASR mətni təhrif olunur: 0.5 həddi düzgün sözləri də rədd edirdi
            officialConfirmed = false;
            aiProgress(id, 7, "Rəsmi sözlər auto-altyazı ilə uyğunlaşmadı · ənənəvi üsul…", { eta: 0 });
          }
        }
        timedSong = (officialConfirmed && azSong && song.lyrics) ? timedCues(song, song.lyrics) : null;
        if (officialConfirmed && azSong && song.lyrics && (!timestampsExact || timedSong)) {
          try {
            let localCues = timedSong && timedSong.cues;
            if (!localCues && Array.isArray(song.lrcCues) && song.lrcCues.length >= 8) {
              localCues = song.lrcCues;
              aiProgress(id, 9, `Sözlər: LRC vaxtları istifadə olunur (${localCues.length} sətir)`, { eta: 0 });
            }
            if (!localCues) {
              // Windows-da yerli MMS/CTC yoxdur: bu addımı atlayırıq (Gemini audio yolu onsuz da var).
              const caps = await helperCaps();
              localCues = caps.songAlign
                ? await alignAzSong({ url: msg.pageUrl || tab?.url || "", song, lyrics: song.lyrics, mediaTitle, id })
                : [];
              if (localCues.length >= 3) {
                await saveTimedSong(song, song.id, { lang: "az", lyrics: song.lyrics, cues: localCues, source: "mms", at: Date.now(), translations: {} });
                timedSong = song.timed;
              }
            }
            if (Array.isArray(localCues) && localCues.length >= 3) {
              parsed.cues = localCues;
              parsed.text = self.IDMAI.toSrt(localCues);
              lyricsCorrected = true;
              lyricProgress = Math.max(lyricProgress, 16);
              aiProgress(id, lyricProgress, timedSong && timedSong.cues === localCues ? "Azərbaycan mahnısı: keşlənmiş timing istifadə olunur…" : "Azərbaycan mahnısı MMS/CTC ilə vaxtlandı…", { eta: 0 });
            }
          } catch (e) {
            const why = String(e && e.message || e).slice(0, 120);
            try { aiProgress(id, 8, `MMS/CTC alınmadı (${why}) · əvvəlki üsul…`, { eta: 0 }); } catch {}
          }
        }
        if (officialConfirmed && !lyricsCorrected && !timestampsExact && song.lyrics) {
          const sourceKey = [picked.url || "", parsed.cues.length, parsed.cues[0] && parsed.cues[0].start, parsed.cues[parsed.cues.length - 1] && parsed.cues[parsed.cues.length - 1].end].join("|");
          song._aligned = song._aligned || new Map();
          let aligned = song._aligned.get(sourceKey);
          if (aligned === undefined) {
            // Əvvəlcə rəsmi söz sətirlərini real cue vaxtlarına yerli LCS ilə bağla.
            // Bu, Gemini olmadan da sətir bütövlüyünü və vaxtı düzəldir.
            try { aligned = self.IDMAI.alignLyricsLinesToCues({ cues: parsed.cues, lyrics: song.lyrics, minCoverage: 0.6 }); } catch { aligned = null; }
            // Yerli uyğunlaşma zəifdirsə, əvvəl Gemini ilə cue mətnlərini düzəlt, sonra yenidən bağla.
            if (!aligned) {
              song._corrected = song._corrected || new Map();
              let fixed = song._corrected.get(sourceKey);
              if (!fixed) {
                fixed = await self.IDMAI.correctWithLyrics({
                  cues: parsed.cues, lyrics: song.lyrics, apiKey: cfg.geminiApiKey, model: cfg.geminiModel,
                  onProgress: (pct, text) => { lyricProgress = Math.max(lyricProgress, Math.max(7, Math.min(16, pct))); aiProgress(id, lyricProgress, text, { eta: 0 }); }
                });
                song._corrected.set(sourceKey, fixed);
              }
              if (Array.isArray(fixed) && fixed.length === parsed.cues.length) {
                parsed.cues = fixed;
                parsed.text = self.IDMAI.toSrt(fixed);
                try { aligned = self.IDMAI.alignLyricsLinesToCues({ cues: fixed, lyrics: song.lyrics, minCoverage: 0.6 }); } catch { aligned = null; }
              }
            }
            song._aligned.set(sourceKey, aligned || null);
          }
          if (Array.isArray(aligned) && aligned.length >= 3) {
            parsed.cues = aligned;
            parsed.text = self.IDMAI.toSrt(aligned);
            lyricsCorrected = true;
            lyricProgress = Math.max(lyricProgress, 16);
            aiProgress(id, lyricProgress, "Mahnı sətirləri vaxtlara bağlandı…", { eta: 0 });
          }
        } else if (!lyricsCorrected && !song.lyrics) {
          aiProgress(id, 7, "Mahnı sözləri tapılmadı · orijinal alt yazı ilə davam…", { eta: 0 });
        }
      }
    } catch (e) {
      // Sözlər tapılmasa/uyğunlaşdırma alınmasa, adi tərcümə axını pozulmur.
      try { lyricProgress = Math.max(lyricProgress, 7); aiProgress(id, lyricProgress, "Mahnı sözləri ilə düzəliş alınmadı · davam…", { eta: 0 }); } catch {}
    }

    // 1) Orijinal subtitri real fayl kimi yaz. Gemini API lokal path oxumur;
    //    AI-yə mətn göndərilir, path isə helper/UI üçün saxlanılır.
    try {
      originalFile = await helper("/aisub/file", {
        text: parsed.text, name: aiSubName(msg), lang: picked.lang || picked.dlang || "",
        ext: aiSubExt(parsed.fmt || picked.fmt || picked.ext), dir: ""
      }, 20000);
      if (originalFile && originalFile.path) aiProgress(id, Math.max(10, lyricProgress), `Orijinal fayl: ${originalFile.path}`, { path: originalFile.path });
    } catch (e) { /* fayl yazılmasa da tərcümə davam edir */ }

    // 2) Orijinalı 3 hissəyə ayır və hər hissəni ayrı iş faylı kimi saxla.
    let parts = null;
    try {
      parts = self.IDMAI.splitCues(parsed.cues, 3);
      if (parts && parts.length) {
        partFiles = await Promise.all(parts.map(async (part, i) => {
          const r = await helper("/aisub/file", {
            text: self.IDMAI.toSrt(part.items),
            name: aiSubName(msg) + ".part" + (i + 1),
            lang: picked.lang || picked.dlang || "", ext: "srt", dir: ""
          }, 20000);
          return r && r.path ? r : null;
        }));
        partFiles = partFiles.filter(Boolean);
        if (partFiles.length) aiProgress(id, Math.max(11, lyricProgress), `${partFiles.length} hissə hazırlandı…`, { eta: null });
      }
    } catch (e) { /* hissə faylı yazılmasa da tərcümə davam edir */ }

    // 3) Üç hissəni paralel tərcümə et; nəticə hissə sırası ilə birləşdirilir.
    const trStart = Math.max(lyricsCorrected ? 18 : 12, lyricProgress || 0);
    const songMode = songDetected || manualAzSource;
    // Rəsmi saytdan gələn sözləri "düzəltmə": istifadəçi saytdakı mətni olduğu
    // kimi istəyir. Proofread yalnız AI/təxmin sözləri üçün qalır.
    const directSongLyrics = !!seedPath || !!(songInfo && /(?:^https?:|azlyrics|genius|lyrics\.ovh)/i.test(String(songInfo.lyricsSource || "")));
    const trParts = songMode ? 1 : (parts && parts.length ? parts.length : 3);
    aiProgress(id, trStart, `Tərcümə… 0/${trParts} hissə · ${targetName}`);

    const style = ["default", "academic", "colloquial", "simplified"].includes(msg.style) ? msg.style : "default";
    const azTarget = self.IDMAI.baseLang(target) === "az";
    const sourceIsAz = self.IDMAI.baseLang(picked.lang || picked.dlang || "") === "az";
    const noTranslateAz = (manualAzSource && azTarget) || (songIsAz && azTarget && (lyricsCorrected || sourceIsAz || !picked.lang && !picked.dlang));
    const cachedTarget = timedSong && timedSong.translations && timedSong.translations[target];
    let translated;
    let cachedTranslationUsed = false;
    if (Array.isArray(cachedTarget) && cachedTarget.length === parsed.cues.length) {
      translated = cachedTarget.map(c => ({ ...c }));
      cachedTranslationUsed = true;
      aiProgress(id, 84, "Keşlənmiş tərcümə istifadə olunur…", { eta: 0 });
    } else {
      translated = noTranslateAz ? parsed.cues.map(c => ({ ...c })) : await self.IDMAI.translateCues({
        cues: parsed.cues, apiKey: cfg.geminiApiKey, model: cfg.geminiModel, target,
        source: (songIsAz && lyricsCorrected ? "az" : (picked.lang || picked.dlang || songSourceLang || titleLang || "az")), parts, style, song: songMode,
        onProgress: (pct, text, eta) => {
          const p = Math.max(trStart, trStart + Math.round((Math.max(12, Math.min(84, pct)) - 12) * (84 - trStart) / 72));
          aiProgress(id, p, text, { eta });
        }
      });
    }
    if (noTranslateAz) {
      aiProgress(id, 84, "Azərbaycan mahnısı: rəsmi sözlər olduğu kimi saxlanıldı…", { eta: 0 });
      if (!cachedTranslationUsed && lyricsCorrected && !directSongLyrics && self.IDMAI.proofreadAzLyrics) {
        try {
          const proof = await self.IDMAI.proofreadAzLyrics({
            cues: translated, apiKey: cfg.geminiApiKey, model: cfg.geminiModel
          });
          if (Array.isArray(proof) && proof.length === translated.length) translated = proof;
        } catch {}
      }
    }
    if (timedSong && songInfo) {
      timedSong.translations = timedSong.translations || {};
      timedSong.translations[target] = translated.map(c => ({ ...c }));
      await saveTimedSong(songInfo, songInfo.id, timedSong);
    }
    aiProgress(id, 87, "SRT faylı hazırlanır…", { eta: 0 });
    // Son təhlükəsizlik: tərcümə nəticəsində dublikat/qısa blok qalmasın.
    // Mahnı/LRC vaxtları dəqiqdirsə yalnız overlap təmizlənir.
    let finalCues = translated;
    if (!manualAzSource) {
      if (!lyricsCorrected && !timestampsExact && self.IDMAI.stripNonSpeech) finalCues = self.IDMAI.stripNonSpeech(finalCues);
      if (self.IDMAI.repairSubtitleTimeline) {
        finalCues = self.IDMAI.repairSubtitleTimeline(finalCues, {
          dedupe: true, mergeFragments: false,
          minDuration: (lyricsCorrected || timestampsExact) ? 0 : 260,
          clamp: true
        });
      }
    }
    if (!finalCues.length) throw new Error("Təmizlənmiş tərcümə SRT boşdur");
    const srt = self.IDMAI.toSrt(finalCues);
    if (!srt.trim()) throw new Error("Tərcümə edilmiş SRT boşdur");
    // 3) Tərcüməni həm SRT (YouTube overlay üçün), həm də seçilmiş stildə ASS
    //    (MPV/muxing üçün) yaz. ASS-i başqa playerlər də olduğu kimi göstərir.
    saved = await helper("/aisub/file", {
      text: srt, name: aiSubName(msg), lang: target, label: targetName, ext: "srt", dir: ""
    }, 20000);
    if (!saved || !saved.url || !saved.path) throw new Error("Tərcümə faylı helper-də saxlanmadı");
    let visualStyle = "default", subAppearance = null;
    try {
      const v = await chrome.storage.local.get(["subVisualStyle", "subAppearance"]);
      visualStyle = ["default", "cinematic", "minimalist", "neon"].includes(v && v.subVisualStyle) ? v.subVisualStyle : "default";
      subAppearance = v && v.subAppearance || null;
    } catch {}
    let assFile = null;
    try {
      assFile = await helper("/aisub/file", {
        text: self.IDMAI.toAss(finalCues, visualStyle, subAppearance), name: aiSubName(msg),
        lang: target, label: targetName, ext: "ass", dir: ""
      }, 20000);
    } catch {}

    // 4) Fayl hazırdır. Burada avtomatik .srt və ya video yükləməsi BAŞLAMIR.
    // Nəticə stream-in lokal yaddaşına qaytarılır; muxing yalnız əsas video düyməsi ilə olacaq.
    // url = ASS (MPV/muxing), srtUrl = SRT (YouTube).
    const sub = {
      id, url: (assFile && assFile.url) || saved.url, path: (assFile && assFile.path) || saved.path,
      srtUrl: saved.url, srtPath: saved.path, assUrl: assFile && assFile.url || "", assPath: assFile && assFile.path || "",
      visualStyle, lang: target, label: targetName,
      referer: msg.pageUrl || tab?.url || "", srt,
      pageUrl: msg.pageUrl || tab?.url || "", prompted: false, integrated: false, time: Date.now()
    };
    aiResultStore(tab?.id, sub);
    aiProgress(id, 100, "✓ Tamamlandı", {
      done: true, eta: 0, path: (assFile && assFile.path) || saved.path, sourcePath: originalFile?.path || ""
    });
    return { ok: true, id, sub };
  } catch (e) {
    const error = String(e && e.message || e).slice(0, 180);
    aiProgress(id, 0, "Xəta: " + error, { error: true, eta: 0 });
    return { ok: false, id, error };
  } finally {
    // İş bitdi: orijinal/aralıq alt yazı faylını sil. Final (inteqrasiya olunacaq) SRT qalır.
    const cleanup = [];
    if (seedPath && (!saved || !saved.path || seedPath !== saved.path)) cleanup.push(seedPath);
    if (originalFile && originalFile.path && (!saved || !saved.path || originalFile.path !== saved.path)) cleanup.push(originalFile.path);
    for (const f of partFiles || []) if (f && f.path && (!saved || !saved.path || f.path !== saved.path)) cleanup.push(f.path);
    if (cleanup.length) {
      try { await helper("/aisub/delete", { paths: cleanup }, 5000); } catch {}
    }
  }
}
// ================= /ALT YAZI =================

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    await ready;
    const tabId = msg.tabId ?? sender.tab?.id;
    // Extension səhifəsindən (ai.html/popup) gələn mesajlarda sender.tab olmur;
    // tabId yoxdursa chrome.tabs.get("No matching signature") atırdı.
    let tab = null;
    if (tabId != null && tabId >= 0) {
      try { tab = await chrome.tabs.get(tabId); } catch { tab = null; }
    }
    if (msg.type === "mediaCount") {
      const all = [...(media.get(tabId)?.values() || [])].filter(i => ["file", "hls", "dash"].includes(i.kind));
      const fus = Array.isArray(msg.focusUrls) ? msg.focusUrls.filter(u => typeof u === "string" && u) : [];
      const sc = stateCount(tabId, tab.url || "");
      let count = 0;
      if (sc >= 0) count = sc;
      else if (fus.length) {
        const exact = new Set(fus), norm = new Set(fus.map(normSrc));
        const matched = all.filter(i => exact.has(i.url) || norm.has(normSrc(i.url)));
        // Eyni axının query/token fərqli dublikatlarını 1 say.
        count = new Set(matched.map(i => normSrc(i.url))).size;
      }
      return send({ ok: true, count, total: all.length, rev: stateRev.get(tabId) || 0 });
    }
    if (msg.type === "getOptions") {
      const auto = !!msg.auto;
      if (msg.fast && !msg.fresh) {
        const c = autoResults.get(tabId);
        if (c && c.url === (tab.url || "") && Date.now() - c.t < 20000) return send({ ...c.r, cached: true });
      }
      const done = out => {
        if (auto && out && out.ok !== false) autoResults.set(tabId, { url: tab.url || "", t: Date.now(), r: out });
        if (auto) notifyState(tabId, "auto");
        return send(out);
      };
      const fd = feed.get(tabId), fv = fd && fd.cur ? fd.videos.get(fd.cur) : null;
      // Instagram: cari (və ya son aktiv) video məlumdursa, həmişə YALNIZ onun qrupu göstərilir.
      // Digər saytlar əvvəlki kimi yalnız fd.active olduqda lent yoluna keçir.
      if (C.feedMode !== false && fv && (fd.active || fv.site === "instagram")) {   // qısa video lenti
        const fr = await feedResponse(tabId, fd), cg = fr.cur;
        const direct = cg.direct || [], opts = cg.options || [], newOnly = FEED_NO_PROBE.has(cg.site);
        const fc = opts.length + direct.length;
        stateCountCache.set(tabId, { url: tab.url || "", count: fc, t: Date.now() });
        // Telegram chat və Instagram: popup heç vaxt bütün tab media-sına fallback etməsin; yalnız cari video qrupu.
        if (cg.site === "telegram" || cg.site === "instagram") return done({ ...fr, count: fc });
        // Yeni platformada heç bir media yoxdursa: köhnə səhifə yolu işləsin. Media varsa: qruplaşdırılmış lent göstərilsin.
        if (cg.protected || (newOnly ? (direct.length || opts.length) : !(cg.weak && !opts.length && !direct.length))) return done({ ...fr, count: fc });
      }
      const pageUrl = tab.url || "";
      const detected = [...(media.get(tabId)?.values() || [])].filter(i => !okcdnSegment(i.url)).sort((a, b) => b.time - a.time);
      const fresh = !!msg.fresh || freshPage.has(tabId);   // rescan/player/full reload: bir dəfə məcburi təzə probe
      if (fresh) freshPage.delete(tabId);
      const pcKey = tabId + "|" + pageUrl;
      const cachedPage = !fresh ? pageProbeCache.get(pcKey) : null;
      const myGen = mediaEpoch.get(tabId) || 0;
      const emptyPage = { title: "", options: [], audios: [], subs: [], caps: {}, warnings: [], error: "" };
      const pageProbe = async (gen = mediaEpoch.get(tabId) || 0) => {
        if (!/^https?:/i.test(pageUrl)) return { ...emptyPage, error: "Bu səhifədən video yüklənə bilməz" };
        if (gen === myGen && cachedPage && Date.now() - cachedPage.t < 180000) return cachedPage.r;
        try {
          const cookies = await getCookies(pageUrl);
          const _loginHost = /(?:^|\.)(?:instagram|threads|facebook)\.com$/i.test(hostOfUrl(pageUrl));
          const h = await helper("/formats", {
            url: pageUrl, cookies, referer: pageUrl, userAgent: navigator.userAgent, cookie: cookieStr(cookies),
            cookiesFromBrowser: (_loginHost && !cookies.length) ? "brave" : undefined, fresh: !!fresh
          }, 25000);
          const r = { title: h.title || "", options: h.options || [], audios: h.audios || [], subs: h.subs || [], aq: h.aq || [], caps: h.caps || {}, warnings: h.warnings || [], strat: h.strat || "", error: "" };
          // Player/rescan zamanı başlamış köhnə probe yeni keşə yazılmasın.
          if (gen !== (mediaEpoch.get(tabId) || 0)) return { ...emptyPage, stale: true };
          if (r.options.length || r.audios.length || r.subs.length) {
            pageProbeCache.set(pcKey, { t: Date.now(), r });
            if (pageProbeCache.size > 80) pageProbeCache.delete(pageProbeCache.keys().next().value);
          }
          return r;
        } catch (e) {
          const err = String(e.message || e);
          // yt-dlp bu səhifəni TANIMIR ("Unsupported URL", Yandex "Unable to extract data_raw"): nəticə həmişə eynidir.
          // Uğursuzluq keşlənməyəndə hər UI yeniləməsi yt-dlp-ni yenidən işə salır (~1 san CPU) və popup
          // "Keyfiyyətlər yoxlanılır..." vəziyyətində ilişib qalır. Qısa müddət (180 san) xatırla.
          if (/YandexVideoPreview|Unable to extract data_raw|Unsupported URL/i.test(err)) pageProbeCache.set(pcKey, { t: Date.now(), r: { ...emptyPage, error: err } });
          return { ...emptyPage, error: err };
        }
      };
      // Paralel: səhifə (YouTube tipli) + tapılmış m3u8/mpd axınları
      const pageP = pageProbe();
      const subsP = enrichSubs([...(subMedia.get(tabId)?.values() || [])].sort((a, b) => b.time - a.time));
      const streams = await probeStreams(detected, pageUrl, tab.title || "", tabId, fresh);
      const goodStreams = streams.some(i => i.options && i.options.length);
      // Əvvəl mövcud HLS/DASH seçimlərini göstər; səhifə probe-u arxa planda tamamlanıb keşlənir.
      // YouTube-da tam səhifə seçimləri gözlənilir; heç bir yerdə boş nəticə məcburi edilmir.
      const isYtPage = /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com)$/i.test(hostOfUrl(pageUrl));
      let r = (!isYtPage && goodStreams && !fresh && cachedPage && Date.now() - cachedPage.t < 180000) ? cachedPage.r : null;
      if (!r && (!isYtPage && goodStreams)) r = await Promise.race([pageP, new Promise(res => setTimeout(() => res(null), 5000))]);
      if (!r) r = isYtPage || !goodStreams ? await pageP : emptyPage;
      if (r && r.stale) r = await pageProbe();   // player dəyişdi: cari nəsil ilə bir dəfə təzə probe
      if (!r) r = emptyPage;
      // filmizlech (DoodStream): səhifə probu zibil "UNKNOWN_VIDEO" variantı qaytarır. O, ilk mənbə kimi
      // pageSubs-u götürürdü və real HLS sətri subtitrsiz qalırdı. Bu saytda həmin zibil variantı at.
      if (/(?:^|\.)filmizlech[a-z0-9-]*\.[a-z]{2,}$/i.test(hostOfUrl(pageUrl)))
        r = { ...r, options: (r.options || []).filter(o => !/^unknown_?video$/i.test(String(o.label || "").trim())) };
      const pageSubs = await Promise.race([subsP, new Promise(res => setTimeout(() => res(null), 1200))])
        || [...(subMedia.get(tabId)?.values() || [])].sort((a, b) => b.time - a.time);
      const N = self.IDMNamer;
      const tgIdx = streams.filter(i => i.kind === "file" && isTgVirtual(i.url, tab)); let tgN = 0;
      const tgBase = (N && N.cleanTitle(tab.title || "", pageUrl)) || "Telegram videosu";
      const shown = N ? streams.map(i => { try {
        if (i.kind === "file" && isTgVirtual(i.url, tab)) return { ...i, name: tgBase + (tgIdx.length > 1 ? " " + (++tgN) : "") + ".mp4" }; const nm = i.kind === "file" && N.nameSync(i, { mime: i.mime, title: i.pTitle || tab.title || "", pageUrl }); return nm ? { ...i, name: nm } : i; } catch { return i; } }) : streams;
      // filmmakinesi.to: səhifə probu saytdakı YouTube treylerini qaytarır; filmin öz VTT-ləri (pageSubs) isə
      // yalnız ilk mənbəyə verildiyi üçün treylerə yapışırdı. Real axın varsa səhifə probunu göstərmirik.
      if (shown.length && /(?:^|\.)filmmakinesi[a-z0-9-]*\.[a-z]{2,}$/i.test(hostOfUrl(pageUrl))) r = { ...r, options: [] };
      const scount = (r.options || []).length + shown.reduce((n, i) => n + ((i.options && i.options.length) ? i.options.length : 1), 0);
      stateCountCache.set(tabId, { url: pageUrl, count: scount, t: Date.now() });
      // Brauzer daxili (mvd-inline://) axınlar helper üçün əlçatan deyil: səhv sətir göstərmə.
      const _inlineBad = x => /^mvd-inline:/i.test(String((x && x.url) || x || ""));
      const _shown = shown.filter(i => !_inlineBad(i.url));
      const _ropts = (r.options || []).filter(o => !_inlineBad(o.url));
      let _r = { ...r, options: _ropts };
      // Instagram/Facebook/Threads: səhifə probu (yt-dlp) giriş tələb edəndə xəta qaytarır, amma
      // axın CDN-də birbaşa mp4 kimi artıq tapılıb. Belə halda yt-dlp xətası gizlədilir ki,
      // popup işlək CDN media-sını göstərsin (format/ölçü/keyfiyyət /meta ilə oxunur).
      const _loginErr = /log in|login|cookies|authentication|rate.?limit|not available|Private|Sign in/i.test(String(_r.error || ""));
      if (_r.error && _loginErr) {
        const _usable = _shown.filter(i => i.kind === "file" && /^https?:/i.test(i.url || ""));
        if (_usable.length || _ropts.length) _r = { ..._r, error: "" };
      }
      if (!_shown.length && !_ropts.length && !(r.subs || []).length) {
        _r.error = "Bu axın brauzer daxilindədir (mvd-inline); manifest tutulmadı. Səhifəni yeniləyin və axını yenidən açın.";
      }
      done({ ok: true, pageUrl, enabled: C.enabled, subsOn: C.subs, ..._r, title: _r.title || tab.title || "", items: _shown, pageSubs, count: scount });
    } else if (msg.type === "mediaMeta") {   // content/popup: birbaşa media URL-i üçün universal FPS
      if (!/^https?:/i.test(msg.url || "")) return send({ ok: false, fps: 0 });
      const m = await probeMediaMeta({ url: msg.url, referer: msg.referer || "", pageUrl: msg.pageUrl || "" });
      send({ ok: true, fps: m.fps || 0, height: m.height || 0 });
    } else if (msg.type === "ctxAction") {
      const action = String(msg.action || "");
      // Qovluq seçimi URL tələb etmir; UI-də əl ilə qovluq yazmaq da mümkündür.
      if (action === "pickDir") {
        try { const h = await helper("/pickdir", {}, 300000); send({ ok: true, path: h.path || "" }); }
        catch (e) { send({ ok: false, error: String(e.message || e) }); }
        return;
      }
      const payload = msg.payload || {}, item = payload.item || {};
      // URL kopyalama üçün info.url dəqiqdir; cut/gif/save üçün page URL + format birlikdə lazımdır.
      const url = String(msg.kind === "s" ? (msg.url || item.url) : (item.url || msg.url) || "");
      if (!/^https?:/i.test(url)) return send({ ok: false, error: "Bu media yalnız səhifə kontekstində mövcuddur" });
      const cookies = await getCookies(url);
      const body = { url, name: String(msg.name || item.name || "media"), format: String(payload.format || ""),
        referer: item.referer || msg.referer || tab.url || "", userAgent: navigator.userAgent, cookie: cookieStr(cookies),
        start: msg.start, end: msg.end, saveAs: !!msg.saveAs, target: String(msg.target || ""),
        filename: String(msg.filename || ""), folderPick: !!msg.folderPick,
        strat: String((payload.extra && payload.extra.strat) || ""),
        direct: !!(!payload.format && ["file", "hls", "dash"].includes(String(msg.kind || ""))) };
      const route = action === "duration" ? "/duration" : action === "share" ? "/share"
        : action === "saveAs" ? "/saveas" : action === "gif" ? "/gif" : action === "cut" ? "/cut" : "";
      if (!route) return send({ ok: false, error: "Naməlum əməliyyat" });
      try {
        const to = action === "duration" ? 45000 : action === "share" ? 300000 : 1800000;
        const h = await helper(route, body, to);
        send({ ok: true, id: h.id || "", name: h.name || "", path: h.path || "", duration: +h.duration || 0,
               canceled: !!h.canceled, method: h.method || "" });
      } catch (e) { send({ ok: false, error: String(e.message || e) }); }
    } else if (msg.type === "rescan") {
      const fd = feed.get(tabId);
      if (fd && fd.active) {   // qısa lent: media map-ni silmə, yalnız cari video formatlarını təzələ
        for (const k of [...feedFormats.keys()]) if (k.startsWith(tabId + "|")) feedFormats.delete(k);
        freshPage.set(tabId, Date.now()); notifyFeed(tabId);
      } else {
        clearTabMedia(tabId, true, "rescan");
        freshPage.set(tabId, Date.now());
      }
      // Bütün frame-lərdə (xüsusən iframe player) DOM/performance yenidən skan olunsun.
      try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        for (const f of frames || []) {
          try { chrome.tabs.sendMessage(tabId, { type: "rescanPage" }, { frameId: f.frameId }).catch(() => {}); } catch {}
        }
      } catch {}
      send({ ok: true });
    } else if (msg.type === "playerChanged") {
      const fd = feed.get(tabId);
      if (fd && fd.active) return send({ ok: true, ignored: "feed" });
      clearTabMedia(tabId, true, "player");
      freshPage.set(tabId, Date.now());
      send({ ok: true });
    } else if (msg.type === "streamFound") {
      if ((msg.kind === "hls" || msg.kind === "dash" || msg.kind === "file") && /^https?:/i.test(msg.url || "")) {
        // MPD mətnini tutmuşuqsa, yerli manifest yaradırıq: brauzer daxili ünvanlar da işləsin.
        if (msg.kind === "dash" && msg.text && String(msg.text).length > 20) {
          try {
            const loc = await helper("/manifest", { kind: "dash", text: String(msg.text), base: msg.url }, 15000);
            if (loc && loc.url) {
              const nm = nameFrom(msg.url) || "manifest.mpd";
              await addMedia(tabId, { url: loc.url, kind: "dash", mime: "application/dash+xml", size: 0, name: nm,
                time: Date.now(), referer: msg.frameUrl || "", origin: "" });
              send({ ok: true }); return;
            }
          } catch {}
        }
        let nm = nameFrom(msg.url); if (msg.kind === "file" && !/\.[a-z0-9]{2,5}$/i.test(nm)) nm += ".mp4";
        await addMedia(tabId, { url: msg.url, kind: msg.kind, mime: "", size: +msg.size || 0, name: nm, time: Date.now(), referer: msg.frameUrl || "", origin: "", jsonSrc: !!msg.json });
        if (msg.kind === "file" && googleDirectUrl(msg.url)) probeGoogleSize(msg.url, { referer: msg.frameUrl || "", origin: originOf(msg.frameUrl) }).catch(() => {});
      }
      send({ ok: true });
    } else if (msg.type === "streamCandidate") {   // content.js: URL-i axına oxşayır (uzantısız /m3u/..., /playlist və s.) -> məzmununa görə yoxla
      if (/^https?:/i.test(msg.url || "")) sniffAndAdd({ url: msg.url, tabId }, { referer: msg.frameUrl || "", origin: "" });
      send({ ok: true });
    } else if (msg.type === "subFound") {   // <track> elementləri (content.js)
      if (/^https?:/i.test(msg.url || "") && (!msg.verify || await looksLikeSub(msg.url)))
        await addSub(tabId, { url: msg.url, lang: String(msg.lang || "").slice(0, 12), label: String(msg.label || "").slice(0, 60), referer: msg.frameUrl || "" });
      send({ ok: true });
    } else if (msg.type === "feedVideo") {   // feed.js: aktiv video (identifikator + permalink + ad)
      if (!C.enabled || C.feedMode === false || !msg.key || !/^https?:/i.test(msg.url || "")) return send({ ok: true });
      let f = feed.get(tabId); if (!f) feed.set(tabId, f = { cur: "", active: true, videos: new Map() });
      const old = f.videos.get(msg.key);
      const v = { key: String(msg.key), site: String(msg.site || "").slice(0, 12), id: String(msg.id || "").slice(0, 40), url: String(msg.url), title: String(msg.title || "").slice(0, 120),
        author: String(msg.author || "").slice(0, 60), weak: !!msg.weak, src: (/^https?:/i.test(msg.src || "") || (["telegram","whatsapp","x"].includes(msg.site) && /^blob:/i.test(msg.src || ""))) ? String(msg.src) : "", fps: Math.max(0, Math.round(+msg.fps || 0)),
        media: msg.media === "audio" ? "audio" : "video", dur: Math.max(0, +msg.duration || 0), size: Math.max(0, +msg.size || 0), sizeEst: !!msg.sizeEst,
        width: Math.max(0, +msg.width || 0), height: Math.max(0, +msg.height || 0),
        hints: Array.isArray(msg.hints) ? msg.hints.filter(x => typeof x === "string" && /^(?:https?:\/\/|\/)/i.test(x)).slice(0, 20) : [],
        activeAt: Math.max(0, +msg.activeAt || Date.now()), protected: msg.site === "telegram" && !!msg.protected, pageUrl: String(msg.pageUrl || ""), time: old ? old.time : Date.now() };
      f.videos.delete(v.key); f.videos.set(v.key, v);   // ən yeni sonda
      const changed = f.cur !== v.key || !f.active || (old && (old.fps !== v.fps || old.src !== v.src || old.media !== v.media || old.dur !== v.dur || old.size !== v.size || old.sizeEst !== v.sizeEst ||
        old.width !== v.width || old.height !== v.height || JSON.stringify(old.hints || []) !== JSON.stringify(v.hints || [])));
      f.cur = v.key; f.active = true;
      if (old && old.url !== v.url) feedFormats.delete(tabId + "|" + v.key);   // permalink dəqiqləşib: yalnız bu video yenidən yoxlanacaq
      while (f.videos.size > FEED_KEEP + 1) { const k = f.videos.keys().next().value; if (k === f.cur) break; f.videos.delete(k); feedFormats.delete(tabId + "|" + k); }
      persist(); if (changed) notifyFeed(tabId);
      send({ ok: true });
    } else if (msg.type === "feedLeave") {
      const f = feed.get(tabId); if (f && f.active) { f.active = false; persist(); notifyFeed(tabId); }
      send({ ok: true });
    } else if (msg.type === "feedGroup") {   // qrup açıldı: yalnız bu video üçün /formats
      const f = feed.get(tabId), v = f && f.videos.get(msg.key);
      if (!v) return send({ ok: false, error: "Qrup tapılmadı" });
      send({ ok: true, group: await feedGroup(tabId, v, await feedProbe(tabId, v)) });
    } else if (msg.type === "feedRefresh") {   // ⟳: yalnız cari videonu yenidən müəyyən et; digər qruplar və yükləmələr toxunulmaz
      try { await chrome.tabs.sendMessage(tabId, { type: "feedIdentify" }); } catch {}
      const f = feed.get(tabId); if (f && f.cur) feedFormats.delete(tabId + "|" + f.cur);
      send({ ok: true });
    } else if (msg.type === "liveSubTranslate") {
      // Yalnız YouTube səhifəsindən gələn canlı caption mətnini tərcümə edir.
      if (!C.enabled || !isYoutubeTab(tab)) return send({ ok: false, error: "Yalnız YouTube" });
      if (!self.IDMAI || !self.IDMAI.translateLive) return send({ ok: false, error: "AI modulu yüklənmədi" });
      const cfg = await chrome.storage.local.get(["geminiApiKey", "geminiModel"]);
      if (!cfg.geminiApiKey || !cfg.geminiModel) return send({ ok: false, error: "Gemini açarı/modeli yoxdur" });
      const text = String(msg.text || "").slice(0, 2500);
      if (!text.trim()) return send({ ok: false, error: "Boş caption" });
      try {
        const translated = await self.IDMAI.translateLive({
          text, apiKey: cfg.geminiApiKey, model: cfg.geminiModel,
          target: self.IDMAI.baseLang(msg.target) || "az"
        });
        send({ ok: true, text: translated });
      } catch (e) {
        send({ ok: false, error: String(e && e.message || e).slice(0, 140) });
      }
    } else if (msg.type === "getSubSettings") {
      try {
        const j = await helper("/subtitle-settings", null, 7000);
        send({ ok: true, settings: j.settings || null, fonts: j.fonts || [], seedNeeded: !!j.seedNeeded });
      } catch (e) { send({ ok: false, error: String(e && e.message || e) }); }
    } else if (msg.type === "mpvStyle") {
      const style = MPV_STYLES.includes(String(msg.style || "").toLowerCase()) ? String(msg.style).toLowerCase() : "default";
      queueMpvStyle(style, msg.appearance);
      send({ ok: true, style, queued: true });
    } else if (msg.type === "aiResults") {
      send({ ok: true, results: aiResults.get(tabId) || [] });
    } else if (msg.type === "aiResultUpdate") {
      send({ ok: !!aiResultUpdate(tabId, String(msg.id || ""), { prompted: !!msg.prompted, integrated: !!msg.integrated }) });
    } else if (msg.type === "aiResultDelete") {
      aiResultDelete(tabId, String(msg.id || ""));
      send({ ok: true });
    } else if (msg.type === "aiResultDrop") {
      aiResultDrop(tabId, String(msg.id || ""));
      send({ ok: true });
    } else if (msg.type === "aiResultClearTab") {
      aiResultClearTab(tabId);
      send({ ok: true });
    } else if (msg.type === "aiSubtitle") {
      // Mesaj portu açıq qalır: uzun Gemini tərcüməsi zamanı service worker erkən dayanmasın.
      send(await aiSubtitleDownload(msg, tab));
    } else if (msg.type === "dualSubtitle") {
      try { send(await dualSubtitle(msg, tab)); }
      catch (e) { send({ ok: false, error: String(e && e.message || e).slice(0, 180) }); }
    } else if (msg.type === "siOpenFeature") {
      // Fallback: hansı kontekstdən gəlsə də AI səhifəsini aç.
      const id = msg.tabId ?? tabId;
      await siOpenPanel(id != null ? id : -1, String(msg.featureId || ""));
      send({ ok: true });
    } else if (msg.type === "siActive") {
      const id = msg.tabId ?? tabId;
      if (id != null) siActiveSel.set(id, { t: Date.now(), pageUrl: msg.pageUrl || "", sel: msg.sel || {}, stream: msg.stream || null });
      send({ ok: true });
    } else if (msg.type === "siActivePatch") {
      const id = msg.tabId ?? tabId;
      const cur = siActiveSel.get(id) || { t: Date.now(), pageUrl: "", sel: {}, stream: null };
      cur.sel = { ...(cur.sel || {}), quality: String(msg.quality || "") };
      if (msg.stream && msg.stream.url) cur.stream = { url: msg.stream.url, kind: msg.stream.kind || "file", name: String(msg.stream.name || "") };
      cur.t = Date.now();
      siActiveSel.set(id, cur);
      send({ ok: true });
    } else if (msg.type === "aiFeatureSources") {
      try { send({ ok: true, ...(await siSourcesFor(tabId)) }); }
      catch (e) { send({ ok: false, error: String(e && e.message || e).slice(0, 200) }); }
    } else if (msg.type === "aiFeatureRun") {
      try { send({ ok: true, ...(await siRunFeature(msg)) }); }
      catch (e) { send({ ok: false, error: String(e && e.message || e).slice(0, 500) }); }
    } else if (msg.type === "aiFeatureExport") {
      try { send(await siExport(msg)); }
      catch (e) { send({ ok: false, error: String(e && e.message || e).slice(0, 200) }); }
    } else if (msg.type === "aiFeatureExpand" || msg.type === "aiFeatureInfo") {
      try {
        const cfg = await chrome.storage.local.get(["geminiApiKey", "geminiModel"]);
        if (!cfg.geminiApiKey) throw new Error("Gemini API açarı yoxdur (Ayarlar → Sİ)");
        const f = self.IDM_AI_FEATURES.byId(msg.featureId);
        const fn = msg.type === "aiFeatureExpand" ? self.IDMAI.expandText : self.IDMAI.researchText;
        const cues = await siCuesFor(msg.tabId, msg.sourceUrl).catch(() => []);
        const context = siContextText(cues, msg.start, msg.end);
        const ui = await chrome.storage.local.get("uiLang").catch(() => ({}));
        const text = await fn({ title: msg.title || "", text: msg.text || "", context, feature: f, apiKey: cfg.geminiApiKey, model: cfg.geminiModel, lang: ["ru", "en"].includes(ui && ui.uiLang) ? ui.uiLang : "az" });
        send({ ok: true, text });
      } catch (e) { send({ ok: false, error: String(e && e.message || e).slice(0, 400) }); }
    } else if (msg.type === "aiFeatureMore") {
      try {
        const cfg = await chrome.storage.local.get(["geminiApiKey", "geminiModel"]);
        if (!cfg.geminiApiKey) throw new Error("Gemini API açarı yoxdur (Ayarlar → Sİ)");
        const info = await siSourcesFor(msg.tabId);
        let src = info.sources.find(s => s.url === msg.sourceUrl) || info.sources.find(s => s.url === info.selected) || info.sources[0];
        if (!src) throw new Error("Alt yazı mənbəyi yoxdur");
        let cues = [];
        if (src.ai && src.srt) cues = self.IDMAI.parseSubtitle(String(src.srt), "srt");
        else cues = (await fetchAiSubtitle(src, (tab && tab.url) || "")).cues;
        const ui = await chrome.storage.local.get("uiLang").catch(() => ({}));
        const items = await self.IDMAI.moreItems({ cues, feature: self.IDM_AI_FEATURES.byId(msg.featureId),
          existing: msg.existing || [], apiKey: cfg.geminiApiKey, model: cfg.geminiModel, count: msg.count || 5, searchMode: msg.searchMode || "",
          lang: ["ru", "en"].includes(ui && ui.uiLang) ? ui.uiLang : "az" });
        send({ ok: true, items });
      } catch (e) { send({ ok: false, error: String(e && e.message || e).slice(0, 400) }); }
    } else if (msg.type === "aiCutStatus") {
      try {
        const j = await helper("/list", null, 8000);
        const it = (j.items || []).find(x => x && x.id === msg.id);
        send({ ok: !!it, item: it || null });
      } catch (e) { send({ ok: false, error: String(e && e.message || e) }); }
    } else if (msg.type === "aiFeatureCut") {
      try { send(await siCut(msg)); }
      catch (e) { send({ ok: false, error: String(e && e.message || e).slice(0, 200) }); }
    } else if (msg.type === "aiChaptersApply") {
      try {
        const chapters = Array.isArray(msg.chapters) ? msg.chapters : [];
        if (!chapters.length) throw new Error("Fəsil yoxdur");
        const native = await siChapters(msg.tabId).catch(() => null);
        if (native && Array.isArray(native.items) && native.items.length) {
          send({ ok: false, native: true, count: native.items.length });
        } else {
          const r = await chrome.tabs.sendMessage(msg.tabId, { type: "ytChaptersApply", chapters })
            .catch(e => ({ ok: false, error: String(e && e.message || e) }));
          send(r && r.ok ? { ok: true, count: r.count || chapters.length } : { ok: false, error: (r && r.error) || "YouTube səhifəsinə çatmadı" });
        }
      } catch (e) { send({ ok: false, error: String(e && e.message || e).slice(0, 300) }); }
    } else if (msg.type === "download") {
      const ex = { ...(msg.extra || {}) };
      if (msg.target) ex.target = msg.target;
      await startDownload(msg.item, tab, msg.format, msg.label, ex);
      send({ ok: true });
    } else if (msg.type === "segmentCut") {
      const r = await helper("/sicut", msg.payload || {}, 30000);
      send({ ok: true, id: r.id || "", name: r.name || "" });
    }
  })().catch(e => send({ ok: false, error: String(e.message || e) }));
  return true;
});

let siMenusReady = false;
function siSetupMenus() {
  if (siMenusReady) return;
  siMenusReady = true;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "idm", title: "JDM ilə yüklə", contexts: ["link", "video", "audio"] });
    // Sİ yalnız alt yazı olan axınlarda görünür (onShown → update).
    chrome.contextMenus.create({ id: "si-root", title: "Sİ", contexts: ["video", "audio", "link", "page"], visible: false });
    for (const f of (self.IDM_AI_FEATURES?.FEATURES || [])) {
      chrome.contextMenus.create({ id: "si:" + f.id, parentId: "si-root", title: f.name, contexts: ["video", "audio", "link", "page"] });
    }
  });
}
chrome.runtime.onInstalled.addListener(siSetupMenus);
try { siSetupMenus(); } catch {}

// Menyu açılmazdan əvvəl alt yazı olub-olmadığını yoxla; varsa Sİ-ni göstər.
if (chrome.contextMenus.onShown) {
  chrome.contextMenus.onShown.addListener(info => {
    const tabId = info && info.tabId;
    if (tabId == null || tabId < 0) return;
    chrome.tabs.get(tabId).then(async tab => {
      const c = siSubs.get(tabId);
      const known = !!(c && c.url === (tab.url || "") && Date.now() - c.t < 600000);
      const has = known ? c.sources.length > 0 : ((subMedia.get(tabId)?.size || 0) > 0);
      if (!known) siWarmSubs(tabId, tab.url || "");
      siSetMenuVisible(has);
      if (chrome.contextMenus.refresh) chrome.contextMenus.refresh();
    }).catch(() => {});
  });
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ready;
  if (!C.enabled) return;
  if (String(info.menuItemId || "").startsWith("si:")) {
    const tabId = info.tabId;
    if (tabId == null || tabId < 0) return;
    const feature = String(info.menuItemId).slice(3);
    // Səhifədə konkret video elementinə sağ klik: həmin axını miras götür.
    if (info.srcUrl && /^https?:/i.test(info.srcUrl)) {
      const cur = siActiveSel.get(tabId) || { t: Date.now(), pageUrl: tab && tab.url || "", sel: {}, stream: null };
      cur.stream = { url: info.srcUrl, kind: classify(info.srcUrl, "") || "file", name: (cur.sel && cur.sel.quality) || "" };
      cur.t = Date.now();
      siActiveSel.set(tabId, cur);
    }
    await siOpenPanel(tabId, feature);
    return;
  }
  const url = info.linkUrl || info.srcUrl;
  if (!url || !/^https?:/i.test(url)) return;
  const kind = classify(url, "") || "file";
  try { await startDownload({ url, kind, name: nameFrom(url) }, tab); } catch (e) { console.warn(e.message); }
});

chrome.downloads.onCreated.addListener(async item => {
  try {
    await ready;
    if (!C.enabled || !C.intercept) return;
    const url = item.finalUrl || item.url;
    if (ownDownloads.has(url) || item.byExtensionId) return;
    // Browser blob/Telegram/WhatsApp page media: native downloader must not handle it.
    // Fetch in the page's own context (cookie/SW/Range) and stream into the helper panel.
    let vtab = null;
    try { if (item.tabId != null && item.tabId >= 0) vtab = await chrome.tabs.get(item.tabId); } catch {}
    if (!vtab) { try { const ts = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); vtab = ts && ts[0]; } catch {} }
    if (String(url || "").startsWith("blob:") || (vtab && isPageVirtual(url, vtab))) {
      if (!vtab || isYoutubeTab(vtab)) return;   // YouTube is isolated from this path
      if (!/^(?:blob:|https?:)/i.test(url)) return;
      await chrome.downloads.cancel(item.id).catch(() => {});
      chrome.downloads.erase({ id: item.id });
      const fn = item.filename ? item.filename.split(/[\\/]/).pop() : "";
      pageUpload({ url, kind: "file", name: fn || "", origin: "" }, vtab, fn).catch(e => console.warn("Page upload:", e && e.message || e));
      return;
    }
    if (!/^https?:/i.test(url)) return;
    if (recent.has(url)) { chrome.downloads.cancel(item.id).catch(() => {}); chrome.downloads.erase({ id: item.id }); return; }
    recent.add(url); setTimeout(() => recent.delete(url), 4000);
    if ((item.mime || "").startsWith("text/html")) return;
    await chrome.downloads.cancel(item.id).catch(() => {});
    chrome.downloads.erase({ id: item.id });
    // JDM snifferi eyni URL üçün request/response başlıqlarını saxlayıbsa, onları da ötür.
    const im = self.IDM_META_BY_URL && (self.IDM_META_BY_URL.get(url) || self.IDM_META_BY_URL.get(item.finalUrl || ""));
    const meta = im && Date.now() - im.t < 180000 ? im.meta : null;
    const filename = (item.filename ? item.filename.split(/[\\/]/).pop() : "") || (meta && meta.name) || "";
    if (googlePicasaUrl(url, item.referrer || (meta && meta.referer))) {
      try {
        await googleUpload({ url, idm: meta || {}, headers: (meta && meta.headers) || {}, referer: item.referrer || (meta && meta.referer) || "",
          name: filename }, { id: -1, url: item.referrer || (meta && meta.referer) || "" }, filename);
        return;
      } catch (e) { console.warn("Google/Picasa browser upload fallback:", e && e.message || e); }
    }
    const cookies = await getCookies(url);
    try {
      await helper("/add", {
        url, referer: (meta && meta.referer) || item.referrer,
        userAgent: (meta && meta.userAgent) || navigator.userAgent,
        cookie: (meta && meta.cookie) || cookieStr(cookies),
        headers: (meta && meta.headers) || {},
        filename, streams: streamsFor(filename || url)
      });
    } catch (e) {
      // Native Chrome yükləyicisinə qaytarmırıq: bütün yükləmələr panelə yönləndirilməlidir.
      console.warn("JDM redirect helper xətası (native download bloklandı):", e && e.message || e);
    }
  } catch {}
});
