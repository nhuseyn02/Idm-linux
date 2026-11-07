// Popup və video üstündəki menyu üçün ORTAQ məntiq: yükləmə rejimləri, subtitr/səs seçimi, helper-ə göndərilən yük.
// DOM-u yalnız renderSource çəkir; qalan funksiyalar təmizdir (node ilə test olunur).
(() => {
  const MODE_NAMES = {
    va: "Video + Səs", vas: "Video + Səs + Subtitr", v: "Yalnız video", a: "Yalnız səs", s: "Yalnız subtitr"
  };
  const MODE_TAG = { a: "Audio", s: "SUB" };
  const SUB_MODES = ["vas", "s"];
  const LOSSY = ["mp3", "m4a", "opus", "vorbis"];
  const BITRATES = [320, 256, 192, 160, 128, 96, 64];
  // Dil kodu -> ölkə bayrağı. Region varsa (en-US, pt-BR, zh-TW) həmin ölkənin bayrağı; yoxdursa dilin ənənəvi ölkəsi;
  // tanınmayan dil üçün bayraq YOXDUR (yanlış ölkə göstərilmir).
  const ISO3 = { eng: "en", tur: "tr", aze: "az", rus: "ru", ara: "ar", fas: "fa", per: "fa", spa: "es", fra: "fr", fre: "fr", deu: "de", ger: "de", ita: "it",
    por: "pt", nld: "nl", dut: "nl", pol: "pl", ukr: "uk", jpn: "ja", kor: "ko", zho: "zh", chi: "zh", hin: "hi", ron: "ro", rum: "ro", ell: "el", gre: "el",
    heb: "he", swe: "sv", ces: "cs", cze: "cs", hun: "hu", bul: "bg", ind: "id", vie: "vi", tha: "th", kat: "ka", geo: "ka", hye: "hy", arm: "hy", kaz: "kk", uzb: "uz" };
  const LANG_COUNTRY = { en: "GB", tr: "TR", az: "AZ", ru: "RU", ar: "SA", fa: "IR", es: "ES", fr: "FR", de: "DE", it: "IT", pt: "PT", nl: "NL", pl: "PL", uk: "UA",
    ja: "JP", ko: "KR", zh: "CN", hi: "IN", ro: "RO", el: "GR", he: "IL", sv: "SE", cs: "CZ", hu: "HU", bg: "BG", id: "ID", vi: "VN", th: "TH", ka: "GE",
    hy: "AM", kk: "KZ", uz: "UZ",
    // Sİ dil siyahısındakı qalan dillər (hər dil üçün ənənəvi/əsas ölkə).
    ab: "GE", af: "ZA", sq: "AL", am: "ET", av: "RU", ba: "RU", eu: "ES", be: "BY", bn: "BD", my: "MM",
    bs: "BA", ce: "RU", cv: "RU", da: "DK", et: "EE", fi: "FI", fy: "NL", gag: "MD", gl: "ES", ky: "KG",
    gu: "IN", ha: "NG", hr: "HR", ig: "NG", ga: "IE", is: "IS", kn: "IN", yue: "HK", ca: "ES", ku: "TR",
    km: "KH", lo: "LA", la: "VA", lv: "LV", lez: "RU", lt: "LT", lb: "LU", mk: "MK", mg: "MG", ms: "MY",
    ml: "IN", mt: "MT", mr: "IN", mn: "MN", ne: "NP", no: "NO", pa: "IN", ps: "AF", sa: "IN", sr: "RS",
    si: "LK", sk: "SK", sl: "SI", so: "SO", sw: "KE", su: "ID", sn: "ZW", tg: "TJ", ta: "IN", tl: "PH",
    tt: "RU", te: "IN", tyv: "RU", tk: "TM", ur: "PK", ug: "CN", cy: "GB", xh: "ZA", jv: "ID", yo: "NG",
    zu: "ZA" };
  const flagOf = cc => String.fromCodePoint(...cc.split("").map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  function langTag(code) {   // "tr" -> "TR 🇹🇷"; dil kodu olmayan mətn üçün ""
    const c = String(code || "").trim().toLowerCase().replace(/-orig$/, "").replace(/_/g, "-");
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(c)) return "";
    const [b, r] = c.split("-"), base = ISO3[b] || b;
    if (!/^[a-z]{2}$/.test(base)) return "";
    const cc = /^[a-z]{2}$/.test(r || "") ? r.toUpperCase() : (LANG_COUNTRY[base] || "");
    return base.toUpperCase() + (cc ? " " + flagOf(cc) : "");
  }

  function langName(code) {   // "tr" -> "Türkcə" (brauzerin öz dil adları); tanınmayan kod üçün ""
    const c = String(code || "").trim().replace(/_/g, "-");
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(c)) return "";
    try { const n = new Intl.DisplayNames(["az"], { type: "language" }).of(c); return n && n.toLowerCase() !== c.toLowerCase() ? n.charAt(0).toLocaleUpperCase("az") + n.slice(1) : ""; } catch { return ""; }
  }
  const baseLang = c => String(c || "").trim().toLowerCase().replace(/_/g, "-").replace(/-orig$/, "").split("-")[0];
  // Səs treki üçün insan oxuya bilən təsvir: "TR 🇹🇷 · Türkcə · AAC · 128k" (dil bilinmirsə sayt adı / "dil məlum deyil")
  function audioDesc(lang, name, detail) {
    const tag = langTag(lang), ln = langName(lang);
    const parts = [tag, ln && !tag.startsWith(ln.slice(0, 2).toUpperCase() + " ") ? ln : (tag ? ln : ""), (!tag && name && name.toLowerCase() !== String(lang || "").toLowerCase()) ? name : "", detail].filter(Boolean);
    return parts.length ? [...new Set(parts)].join(" · ") : "ən yaxşı mövcud səs (dil məlum deyil)";
  }
  // "Yalnız səs" üçün: seçilmiş səs dilinə uyğun real axınlar (başqa dilin axını görünmür)
  function audioRows(src, cur) {
    const aq = src.aq || [];
    if (!cur) return aq;
    const byLang = baseLang(cur.lang) ? aq.filter(x => baseLang(x.lang) === baseLang(cur.lang)) : [];
    return byLang.length ? byLang : aq.filter(x => x.id === cur.id);
  }

  // ==== Vahid metadata dizaynı: sağda "FORMAT  ÖLÇÜ" (video/audio/subtitr/fayl eyni qaydada) + üzərinə gələndə qrafik məlumat pəncərəsi ====
  const fmtSize = n => !(n > 0) ? "" : n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB";
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const FMT_EXT = /^(?:MP4|M4V|M4A|M4B|WEBM|MKV|MOV|TS|M2TS|MTS|MPG|MPEG|FLV|F4V|3GP|3G2|AVI|WMV|WMA|ASF|OGV|OGA|OGM|MP3|OGG|OPUS|AAC|AC3|EAC3|ALAC|AIFF|FLAC|WAV|MKA|WEBA|VTT|SRT|ASS|SSA|TTML|DFXP|LRC|SBV|HLS|DASH)$/;
  const MIME_FMT = { "audio/mp4": "MP4", "video/mp4": "MP4", "audio/x-m4a": "M4A", "audio/m4a": "M4A", "audio/mpeg": "MP3", "audio/mp3": "MP3", "audio/aac": "AAC", "audio/ogg": "OGG", "audio/opus": "OPUS",
    "audio/webm": "WEBM", "video/webm": "WEBM", "video/x-matroska": "MKV", "audio/x-matroska": "MKA", "video/quicktime": "MOV", "audio/flac": "FLAC", "audio/x-flac": "FLAC", "audio/wav": "WAV", "audio/x-wav": "WAV",
    "video/mp2t": "TS", "video/x-flv": "FLV", "video/3gpp": "3GP", "video/ogg": "OGV", "text/vtt": "VTT", "application/x-subrip": "SRT" };
  const CODEC_FMT = /^(?:AAC|OPUS|FLAC|MP3|AC3|EAC3|ALAC)$/i;   // həm kodek, həm fayl formatı ola bilən adlar
  const isFmtTok = t => FMT_EXT.test(String(t || "").trim().toUpperCase());
  // Format: namizədlərdən (etiket tokenləri, MIME, "ad.mp4") ilk tanınan; həmişə BÖYÜK hərflə, tanınmırsa ""
  function fmtOf(...cands) {
    for (const c of cands) {
      const s = String(c || "").trim(); if (!s) continue;
      const m = MIME_FMT[s.toLowerCase().split(";")[0]]; if (m) return m;
      for (const tok of s.split(/[\s·•|,()]+/)) {
        if (isFmtTok(tok)) return tok.toUpperCase();
        const e = /\.([a-z0-9]{2,5})$/i.exec(tok); if (e && isFmtTok(e[1])) return e[1].toUpperCase();
      }
    }
    return "";
  }
  // "H.264 • MP4" / "MP4 • H.264" / "MP4" -> {name:"H.264"|"H.264"|"", fmt:"MP4"}; format tanınmırsa fmt boş, ad olduğu kimi
  function splitLabel(label) {
    const parts = String(label || "").split(" • "), i = parts.findIndex(isFmtTok);
    return i >= 0 ? { name: parts.filter((_, k) => k !== i).join(" • "), fmt: parts[i].trim().toUpperCase() } : { name: String(label || ""), fmt: "" };
  }
  // Format sağda çip kimi göstərilirkən başlıqdan çıxarılır: "TR · MP4 · 1:28:28" -> "TR · 1:28:28"; "film.mp4" -> "film"
  function stripFmt(text, fmt) {
    const f = String(fmt || "").toUpperCase(); let s = String(text || "").trim(); if (!f) return s;
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp("(?:^|\\s[·•|]\\s)" + esc + "(?=\\s[·•|]\\s|$)", "gi"), m => /^\s/.test(m) ? "" : "").replace(/^\s[·•|]\s/, "");
    return s.replace(new RegExp("\\." + esc + "$", "i"), "").trim();
  }
  const extFmt = n => { const m = /\.([a-z0-9]{2,5})$/i.exec(String(n || "").trim()); return m && FMT_EXT.test(m[1].toUpperCase()) ? m[1].toUpperCase() : ""; };
  // Uzun başlıq: əsas hissəni saxla (söz sərhədində kəs, saytın adı/boş artıqları at), sonuna "..."
  function smartTitle(s, max = 40) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    s = s.replace(/\s*[|\-–—·•]\s*(?:youtube|facebook|instagram|tiktok|telegram(?: web)?)\s*$/i, "").trim();
    if (s.length <= max) return s;
    let cut = s.slice(0, max - 3);
    const i = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("-"), cut.lastIndexOf("|"), cut.lastIndexOf(":"), cut.lastIndexOf(","));
    if (i >= (max - 3) * 0.6) cut = cut.slice(0, i);
    return cut.replace(/[\s\-–—|:,.·•(\[]+$/, "") + "...";
  }
  const rowTitle = (name, meta, max) => smartTitle(meta && meta.fmt ? stripFmt(name, meta.fmt) : name, max);   // meta sətirləri: format sağda çipdədir, başlıqda yox
  const KCOL = { v: "#5ab0ff", a: "#f0b84a", s: "#b58cf0", f: "#9a9aa2" };
  const KICON = {
    v: '<svg viewBox="0 0 16 16"><rect x="1" y="3.5" width="9" height="9" rx="1.6" fill="currentColor"/><path d="M11 7.2 15 5v6l-4-2.2z" fill="currentColor"/></svg>',
    a: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3.2v10.4L5 10H2z" fill="currentColor"/><path d="M11.2 5.4a3.6 3.6 0 0 1 0 5.2M13 3.6a6 6 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    s: '<svg viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="10" rx="2" fill="currentColor"/><path d="M4 7.2h3M9 7.2h3M4 9.8h5M10.5 9.8H12" stroke="#1c1c1e" stroke-width="1.3" stroke-linecap="round"/></svg>',
    f: '<svg viewBox="0 0 16 16"><path d="M3.5 1.5h6l3 4.5v8.5h-9z" fill="currentColor"/></svg>'
  };
  // Sağ sütun: sabit enli format çipi + ölçü (bilinmirsə "—"): bütün sətirlərdə eyni düzülür
  function metaEl(meta) {
    const w = document.createElement("span"); w.style.cssText = "display:flex;flex:none;align-items:center;gap:6px;font-size:11px;color:#999;font-variant-numeric:tabular-nums";
    const c = document.createElement("span"); c.textContent = String(meta.fmt || "").toUpperCase(); meta.fmt = c.textContent; c.style.cssText = "min-width:42px;text-align:center;box-sizing:border-box;padding:1px 5px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.3px;" + (meta.fmt ? "background:#2c2c2e;color:#cfcfd4;border:1px solid #3a3a3d" : "");
    const z = document.createElement("span"); z.textContent = (meta.est && meta.size > 0 ? "~" : "") + (fmtSize(meta.size) || "—"); z.style.cssText = "min-width:62px;text-align:right;" + (meta.size > 0 ? "" : "opacity:.5");
    if (!(meta.size > 0)) z.title = "həcm bilinmir"; else if (meta.est) z.title = "təxmini həcm";
    w.append(c, z); return w;
  }
  // Qrafik məlumat pəncərəsi (Windows tooltip kimi): rəngli ikon, tam başlıq, açar–dəyər cədvəli. Hər kök üçün tək element; siçan üstündən gedəndə gizlənir.
  const TIPS = new WeakMap();
  function tipBox(root) {
    let t = TIPS.get(root); if (t && t.isConnected) return t;
    t = document.createElement("div");
    t.style.cssText = "position:fixed;z-index:2147483647;display:none;pointer-events:none;box-sizing:border-box;width:min(330px,calc(100vw - 16px));max-height:calc(100vh - 12px);overflow:auto;padding:10px 12px;border-radius:9px;background:#26262a;color:#eee;border:1px solid #3d3d42;box-shadow:0 8px 28px #000c;font:12px/1.35 system-ui,sans-serif";
    root.appendChild(t); TIPS.set(root, t); return t;
  }
  function fillTip(t, info) {
    t.replaceChildren();
    const col = KCOL[info.kind] || KCOL.f, head = document.createElement("div"); head.style.cssText = "display:flex;gap:9px;align-items:flex-start";
    const ic = document.createElement("span"); ic.innerHTML = KICON[info.kind] || KICON.f; ic.style.cssText = "flex:none;width:30px;height:30px;border-radius:7px;background:" + col + "26;color:" + col + ";display:flex;align-items:center;justify-content:center";
    const sv = ic.firstChild; if (sv) sv.style.cssText = "width:17px;height:17px";
    const ti = document.createElement("div"); ti.textContent = info.title || ""; ti.style.cssText = "flex:1;font-weight:600;font-size:13px;word-break:break-word;max-height:7.2em;overflow:hidden";
    head.append(ic, ti); t.append(head);
    const rows = (info.fields || []).filter(f => f && f[1] !== "" && f[1] != null);
    if (rows.length) {
      const g = document.createElement("div"); g.style.cssText = "display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin-top:9px;padding-top:8px;border-top:1px solid #3a3a3f";
      for (const [k, v] of rows) {
        const a = document.createElement("span"), b = document.createElement("span");
        a.textContent = k; a.style.color = "#8d8d95"; b.textContent = v; b.style.cssText = "word-break:break-word;color:#e8e8ec";
        g.append(a, b);
      }
      t.append(g);
    }
  }
  function attachTip(el, getInfo, root, delay) {
    const wait = Math.max(0, +delay || 380);
    let timer = 0;
    const hide = () => { clearTimeout(timer); const t = TIPS.get(root); if (t) t.style.display = "none"; };
    el.addEventListener("mouseenter", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        let info; try { info = typeof getInfo === "function" ? getInfo() : getInfo; } catch { return; }
        if (!info) return;
        const t = tipBox(root); fillTip(t, info); t.style.visibility = "hidden"; t.style.display = "block";
        const r = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, w = t.offsetWidth, h = t.offsetHeight;
        let top = r.bottom + 6; if (top + h > vh - 4) top = Math.max(4, r.top - h - 6);
        top = Math.max(4, Math.min(top, vh - h - 4));
        t.style.left = Math.max(8, Math.min(vw - w - 8, r.left + 12)) + "px"; t.style.top = top + "px"; t.style.visibility = "visible";
      }, wait);
    });
    el.addEventListener("mouseleave", hide); el.addEventListener("click", hide);
    return hide;
  }

  // Səhifə subtitri üçün ad: helper faylın İÇİNƏ baxıb dili və növü (tam / forced / SDH) müəyyən edib (p.dlang, p.kind, p.cues); olmasa köhnə ad.
  const KIND = { full: "Tam", sdh: "SDH", forced: "Forced", partial: "Qismən", tiny: "Qısa" };
  const fmtBytes = n => !(n > 0) ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1).replace(".", ",") + " KB" : (n / 1048576).toFixed(2).replace(".", ",") + " MB";
  const fmtNum = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  function fmtDur(s) {   // saniyəyə qədər dəqiq: 1:42:08 / 42:08; bilinmirsə ""
    s = Math.round(+s || 0); if (!(s > 0)) return "";
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = v => String(v).padStart(2, "0");
    return h ? h + ":" + p(m) + ":" + p(x) : m + ":" + p(x);
  }
  // Səs seçimlərində də video kimi həcm və müddət: "low · AAC · 48k · 1,8 MB · 5:00"
  function audioMetaLabel(a) {
    const base = String((a && a.label) || "");
    const bits = [];
    if (a && a.size > 0) bits.push((a.est ? "~" : "") + fmtSize(a.size));
    const d = fmtDur(a && a.dur); if (d) bits.push(d);
    return [base, ...bits].filter(Boolean).join(" · ");
  }
  // Alt yazı formatı (vtt/srt/ass/ttml…): helper-in faylı oxuyub tapdığı, yoxsa yt-dlp trekinin/URL-in uzantısı
  const SUBX = /^(?:vtt|srt|ass|ssa|ttml|dfxp|lrc|sbv|srv\d|json3)$/i;
  const urlExt = u => { try { const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(u).pathname); return m && SUBX.test(m[1]) ? m[1].toLowerCase() : ""; } catch { return ""; } };
  const subFmt = x => String((x && x.fmt) || "").toUpperCase();
  const subText = x => x.label.replace(/ · (avto)$/, " ($1)") + (subFmt(x) ? " · " + subFmt(x) : "");
  const langFlag = code => { const t = langTag(code); const m = t.match(/([\u{1F1E6}-\u{1F1FF}]{2})/u); return m ? m[1] : ""; };
  const AZ_LANG = { "ab": 'Abxaz dili', "af": 'Afrikaans', "sq": 'Albaniya dili', "de": 'Alman dili', "am": 'Amhar dili', "av": 'Avar dili', "az": 'Azərbaycan dili', "ba": 'Başqırd dili', "eu": 'Bask dili', "be": 'Belarus dili', "bn": 'Benqal dili', "my": 'Birman dili', "bg": 'Bolqar dili', "bs": 'Bosniya dili', "ce": 'Çeçen dili', "cs": 'Çex dili', "zh-CN": 'Çin dili - Mandarin / Sadələşdirilmiş', "zh-TW": 'Çin dili - Ənənəvi', "zh-cn": 'Çin dili - Mandarin / Sadələşdirilmiş', "zh-tw": 'Çin dili - Ənənəvi', "cv": 'Çuvaş dili', "da": 'Danimarka dili', "hy": 'Erməni dili', "ar": 'Ərəb dili', "eo": 'Esperanto', "et": 'Eston dili', "fa": 'Fars dili', "fi": 'Fin dili', "fr": 'Fransız dili', "fy": 'Friz dili', "gag": 'Qaqauz dili', "gl": 'Qalisian dili', "kk": 'Qazax dili', "ky": 'Qırğız dili', "gu": 'Qucarat dili', "ka": 'Gürcü dili', "ha": 'Hausa', "hi": 'Hindi dili', "nl": 'Holland dili', "hr": 'Xorvat dili', "ig": 'İqbo dili', "id": 'İndoneziya dili', "en": 'İngilis dili', "ga": 'İrland dili', "is": 'İsland dili', "es": 'İspan dili', "sv": 'İsveç dili', "it": 'İtalyan dili', "he": 'İvrit dili', "kn": 'Kannada dili', "yue": 'Kanton dili', "ca": 'Katalan dili', "ko": 'Koreya dili', "ku": 'Kurd dili', "km": 'Kxmer dili', "lo": 'Laos dili', "la": 'Latın dili', "lv": 'Latış dili', "lez": 'Ləzgi dili', "lt": 'Litva dili', "lb": 'Lüksemburq dili', "hu": 'Macar dili', "mk": 'Makedon dili', "mg": 'Malaqas dili', "ms": 'Malay dili', "ml": 'Malayalam dili', "mt": 'Malta dili', "mr": 'Marathi dili', "mn": 'Monqol dili', "ne": 'Nepal dili', "no": 'Norveç dili', "uz": 'Özbək dili', "pa": 'Pəncab dili', "pl": 'Polyak dili', "pt": 'Portuqal dili', "ps": 'Puştu dili', "ro": 'Rumın dili', "ru": 'Rus dili', "sa": 'Sanskrit', "sr": 'Serb dili', "si": 'Sinhala dili', "sk": 'Slovak dili', "sl": 'Sloven dili', "so": 'Somali dili', "sw": 'Suahili', "su": 'Sundan dili', "sn": 'Şona dili', "tg": 'Tacik dili', "ta": 'Tamil dili', "tl": 'Taqaloq / Filippin dili', "tt": 'Tatar dili', "th": 'Tay dili', "te": 'Teluqu dili', "tyv": 'Tuvaca', "tr": 'Türk dili', "tk": 'Türkman dili', "uk": 'Ukrayna dili', "ur": 'Urdu', "ug": 'Uyğur dili', "cy": 'Valliy dili', "vi": 'Vyetnam dili', "xh": 'Xosa dili', "ja": 'Yapon dili', "jv": 'Yava dili', "yo": 'Yoruba dili', "el": 'Yunan dili', "zu": 'Zulu dili', "fil": 'Filippin dili', "zh": 'Çin dili' };
  const langOnly = code => { const c = String(code || "").trim().toLowerCase().replace(/_/g, "-").replace(/-orig$/, ""); const key = baseLang(c); return [langFlag(c), AZ_LANG[c] || AZ_LANG[key] || langName(c) || c].filter(Boolean).join(" ").trim(); };
  const subLangOnly = x => {
    const code = x && (x.dlang || x.lang);
    const cc = String(code || "").trim().toLowerCase().replace(/_/g, "-").replace(/-orig$/, "");
    if (cc && (langTag(cc) || AZ_LANG[cc] || AZ_LANG[baseLang(cc)] || langName(cc))) return langOnly(cc);
    const label = String((x && (x.short || x.label)) || "").split(" · ")[0];
    return label || "Alt yazı";
  };
  const subTypeSuffix = x => {
    if (!x) return "";
    const lab = String(x.label || "");
    if (x.translated || /avto tərcümə/i.test(lab)) return " · avto tərcümə";
    if (x.auto) return " · avto";
    return " · manual";
  };
  const KIND_RANK = { full: 0, sdh: 1, partial: 2, forced: 3, tiny: 4 };
  const isBlob = s => { s = String(s || "").trim(); return !!s && !/\s/.test(s) && /^[\w.-]{6,}$/.test(s) && /\d/.test(s); };   // "k9Xz81Qa" kimi kod yığını
  function pageSub(p) {   // qısa ad: "TR 🇹🇷 · Türkcə · Tam · 1 245 sətir · 84,3 KB" (sətir/ölçü yalnız helper faylı oxuya bildikdə)
    const dl = p.dlang || "", conf = p.dconf || 0;
    let lang = p.lang || "", note = "";
    if (!langTag(lang) && dl && conf >= 0.35) lang = dl;
    else if (langTag(lang) && dl && conf >= 0.6 && baseLang(lang) !== baseLang(dl)) { note = "saytda " + lang.toUpperCase(); lang = dl; }
    const tag = langTag(lang), nm = langName(lang);
    const human = p.label && !isBlob(p.label) && ![nm, lang].some(x => x && x.toLowerCase() === p.label.toLowerCase()) ? p.label : "";
    const showHuman = human && (!tag || /forced|sdh|\bcc\b|hearing|commentary|closed|signs|songs|karaoke/i.test(human));
    const first = tag ? [tag, nm] : [showHuman ? human : "Alt yazı"];
    const parts = [...first, tag && showHuman ? human : "", KIND[p.kind] || "", p.cues ? fmtNum(p.cues) + " sətir" : "", note].filter(Boolean);
    const short = [nm || (showHuman ? human : "") || (tag ? tag : "subtitr"), p.kind === "sdh" ? "SDH" : p.kind === "forced" ? "forced" : ""].filter(Boolean).join(" ");
    return { lang, short, label: [...new Set(parts)].join(" · ") };
  }

  // Helper-in real subtitr trekləri + səhifədən aşkarlananlar (<track>, .vtt/.srt sorğuları) -> vahid siyahı.
  // Heç bir "saxta" seçim əlavə olunmur; toplu "hamısı" seçimi YOXDUR — yalnız real treklər göstərilir.
  function subEntries(src, pageSubs) {
    const yt = (src.subs || []).map(x => typeof x === "string" ? { id: "m:" + x, lang: x, auto: false, label: x } : x)
      .map(x => {
        const raw = String(x.label || x.lang || x.id || "Alt yazı");
        const extra = [x.cues ? fmtNum(x.cues) + " sətir" : "", fmtBytes(x.size)].filter(Boolean).join(" · "), m = / · avto(?: tərcümə)?$/.exec(raw);
        const lb = extra ? (m ? raw.slice(0, -m[0].length) + " · " + extra + m[0] : raw + " · " + extra) : raw;
        return { ...x, fmt: String(x.ext || "").toLowerCase(), label: (langTag(x.dlang || x.lang) ? langTag(x.dlang || x.lang) + " · " : "") + lb };
      });
    let list = [];
    list.push(...yt);
    let ps = (pageSubs || []).map((p, i) => ({ p, i, v: pageSub(p) }));
    if (ps.some(x => x.p.kind)) ps.sort((a, b) => baseLang(a.v.lang).localeCompare(baseLang(b.v.lang)) || (KIND_RANK[a.p.kind] ?? 9) - (KIND_RANK[b.p.kind] ?? 9) || (b.p.cues || 0) - (a.p.cues || 0) || a.i - b.i);   // dil -> növ (tam əvvəl) -> sətir sayı
    const seen = {};
    for (const x of ps) seen[x.v.label] = (seen[x.v.label] || 0) + 1;
    const nth = {};
    ps.forEach(({ p, i, v }) => list.push({
      id: "p:" + i, src: "page", url: p.url, lang: v.lang, kind: p.kind || "", referer: p.referer || "", cookie: p.cookie || "", short: v.short, cues: p.cues || 0, dur: p.dur || 0, size: p.size || 0, fmt: String(p.fmt || urlExt(p.url) || "").toLowerCase(),
      label: seen[v.label] > 1 ? v.label + " #" + (nth[v.label] = (nth[v.label] || 0) + 1) : v.label
    }));
    // Sərt prioritet: manual/original -> en>ru>de>fr>tr -> auto (əvvəl en auto).
    if (typeof IDMAI !== "undefined" && IDMAI.prioritizeSubs) list = IDMAI.prioritizeSubs(list);
    return list;
  }

  // Yalnız texniki cəhətdən mümkün rejimlər
  function availableModes(src, subs) {
    const opts = src.options || [], caps = src.caps || {}, m = [];
    if (opts.length) m.push("va");
    if (opts.length && subs.length) m.push("vas");
    // yalnız video: ayrıca video-only axın varsa birbaşa; yoxsa birləşmiş axından ffmpeg ilə audio çıxarılır
    if (opts.length && (opts.some(o => o.vsel) || caps.ffmpeg)) m.push("v");
    if (opts.length && caps.audioOnly) m.push("a");
    if (subs.length) m.push("s");
    return m;
  }

  // Keyfiyyət siyahısı olmayan tək axın: həmin axın bir "keyfiyyət" kimi təqdim olunur ki,
  // "Rejim" menyusu (Video + Səs / Yalnız video / Yalnız səs) görünsün. Səs ayrıca sətir kimi göstərilmir —
  // yalnız "Yalnız səs" seçiləndə çıxarılır.
  function directSource(it, tag, fmt) {
    const name = it.name || "Video";
    return {
      options: [{ id: "file", tag: tag || "Video", label: name + (fmt ? " • " + fmt : ""), selector: "", vsel: "",
        size: +(it.size || 0), est: !!it.est, height: +(it.height || 0) || 0, fps: +(it.fps || 0), dur: +(it.dur || 0), vid: "" }],
      audios: [], subs: [], aq: [],
      caps: { ffmpeg: true, audioOnly: true, audioSeparate: false, videoOnly: false },
      url: it.url, kind: it.kind || "file", name, size: +(it.size || 0), est: !!it.est, dur: +(it.dur || 0), referer: it.referer
    };
  }

  // Seçilmiş BÜTÜN subtitrlər (orijinal + Sİ + ikili): həm adi, həm seqment yükləməsi üçün.
  function subExtras(st, subs, ctx) {
    // Seçim SIRASI ilə (Set-in daxil etmə sırası) — playerdə treklər bu ardıcıllıqla görünür.
    const byId = new Map((subs || []).map(x => [x.id, x]));
    const selectedOrig = st.origSel
      ? [...st.origSel].map(id => byId.get(id)).filter(Boolean)
      : (subs || []).filter(x => x.id === st.sub);
    const ext = [];
    let needSubAll = false, legacy = null;
    for (const sub of selectedOrig) {
      if (!sub) continue;
      if (sub.subAll) { needSubAll = true; continue; }
      if (sub.url) {
        ext.push({ url: sub.url, lang: sub.lang || "", label: sub.short || sub.label || "",
          referer: sub.referer, cookie: sub.cookie, fmt: sub.fmt || sub.ext || "" });
      } else if (!legacy) legacy = sub;
    }
    const aiLangs = st.aiSel ? [...st.aiSel] : [];
    const aiDone = aiLangs.map(l => st.aiSubs && st.aiSubs[l]).filter(Boolean);
    const aiForPayload = st.aiSel ? aiDone : (st.aiSub ? [st.aiSub] : []);
    for (const r of aiForPayload) {
      if (!r || !r.url) continue;
      ext.push({ url: r.url, fmt: r.assUrl ? "ass" : "srt", lang: r.lang || "", label: "Sİ · " + (r.label || r.lang || ""),
        referer: r.referer || (ctx && ctx.pageUrl) || "", keepAss: !!r.assUrl });
    }
    if (st.dualSub && st.dualOn && st.dualSub.url) {
      const dualUrl = st.dualSub.assUrl || st.dualSub.url;
      ext.push({ url: dualUrl, fmt: st.dualSub.assUrl ? "ass" : "srt", lang: "dual", label: "İkili dil",
        referer: st.dualSub.referer || (ctx && ctx.pageUrl) || "", keepAss: !!st.dualSub.assUrl });
    }
    const seen = new Set();
    const extSubs = ext.filter(x => { const k = x.url; if (seen.has(k)) return false; seen.add(k); return true; });
    const out = { extSubs, subLang: "", subAuto: false, subAll: needSubAll };
    if (!extSubs.length && legacy) { out.subLang = legacy.lang; out.subAuto = !!legacy.auto; }
    return out;
  }

  // st: { mode, audio, sub, keep, afmt }; o: seçilmiş keyfiyyət (a və s rejmlərində null)
  function payloadFor(src, o, st, ctx, subs, aqe) {
    const mode = st.mode;
    const p = {
      item: { url: src.url || ctx.pageUrl, kind: src.kind || "page", name: src.name || ctx.title || "video", size: o ? o.size : 0, referer: src.referer, orig: src.orig, pageUrl: src.pageUrl },
      mode, format: "", label: o ? o.tag : MODE_TAG[mode] || "", extra: { mode, subAppearance: { ...SUB_APP } }
    };
    const strat = (o && o.strat) || src.strat;   // YouTube: keyfiyyəti tapan yoxlama strategiyası eyni ilə yükləmədə də işlənir
    if (strat) p.extra.strat = strat;
    const audlist = src.audios || [];
    const audioSel = (Array.isArray(st.audioSel) ? st.audioSel : (st.audio ? [st.audio] : []))
      .filter(id => audlist.some(a => a.id === id));
    const trackOf = id => { const a = audlist.find(x => x.id === id) || {}; return { id, url: a.url || "", lang: a.lang || "", size: +a.size || 0, est: !!a.est }; };
    const origA = audlist.find(a => a.role === "orijinal") || audlist.find(a => a.auto) || audlist[0];
    const origId = origA ? origA.id : "";
    const defaultOnly = audioSel.length === 1 && audioSel[0] === origId;
    if (mode === "va" || mode === "vas") {
      const muxedAV = !!(src.caps && src.caps.audioSeparate === false);   // səs videonun içindədir
      if (!audlist.length) {                 // düz fayl: audio treki siyahısı yoxdur → köhnə davranış
        p.format = o.selector;
        p.extra.audioAuto = true;
      } else if (!audioSel.length) {         // istifadəçi bütün səsləri işarədən götürüb
        p.format = o.vsel || "bv*/b";
        p.extra.audioTracks = [];
        p.extra.audioNone = true;
      } else if (defaultOnly && muxedAV) {   // yalnız "Orijinal" və səs video içindədir: köhnə sürətli yol
        p.format = o.selector;
        p.extra.audioAuto = true;
      } else {                               // seçilmiş trek(lər): helper ayrıca endirib birləşdirir
        p.format = o.vid || "bv*/b";
        p.extra.audioTracks = audioSel.map(trackOf);
      }
    }
    else if (mode === "v") { p.format = o.vsel || o.selector; if (!o.vsel) p.extra.stripAudio = true; }
    else if (mode === "a") {
      p.format = aqe ? aqe.id : st.aa ? st.aa : "";   // dəqiq axın id-si (başqa dilə sakitcə keçmə yoxdur; tapılmasa helper bildirir)
      p.extra.audioFormat = st.afmt;
      if (LOSSY.includes(st.afmt) && st.aq) p.extra.audioQuality = st.aq;
    }
    if (SUB_MODES.includes(mode)) {
      const se = subExtras(st, subs, ctx);
      if (se.extSubs.length) {
        p.extra.extSubs = se.extSubs;
        delete p.extra.subLang; delete p.extra.subAuto; delete p.extra.subAll;
      } else if (se.subLang) {
        p.extra.subLang = se.subLang; p.extra.subAuto = se.subAuto;
      }
      if (se.subAll) p.extra.subAll = true;
      if (mode === "vas") p.extra.keepSubs = !!st.keep;
    }
    return p;
  }

  // Universal FPS: oynayan <video> elementindən real kadr tezliyi (captureStream → settings.frameRate;
  // alınmasa requestVideoFrameCallback ilə ~0.7 san ölçmə). blob/MSE də daxil olmaqla işləyir.
  const FPS_MEM = new WeakMap();
  function videoFps(v) {
    if (!v) return Promise.resolve(0);
    if (FPS_MEM.has(v)) return FPS_MEM.get(v);
    const p = (async () => {
      let f = 0;
      try {
        const s = v.captureStream ? v.captureStream() : null, tr = s && s.getVideoTracks && s.getVideoTracks()[0];
        if (tr) { const st = tr.getSettings ? tr.getSettings() : {}; f = Math.round(+(st.frameRate || 0)); }
        if (s) for (const t of s.getTracks()) t.stop();
      } catch {}
      if (f > 0) return f;
      if (v.requestVideoFrameCallback && !v.paused && !v.ended) {
        f = await new Promise(res => {
          let n = 0, t0 = 0, done = false;
          const end = () => { if (done) return; done = true; const d = t0 ? performance.now() - t0 : 0; res(d > 250 ? Math.round(n * 1000 / d) : 0); };
          const cb = now => { if (!t0) t0 = now; n++; if (now - t0 >= 650) end(); else { try { v.requestVideoFrameCallback(cb); } catch { end(); } } };
          try { v.requestVideoFrameCallback(cb); } catch { end(); }
          setTimeout(end, 1000);
        });
      }
      return f > 0 ? f : 0;
    })();
    p.then(f => { if (!(f > 0)) FPS_MEM.delete(v); });   // 0 nəticəni keşləmə: video sonra oynaya bilər
    FPS_MEM.set(v, p); return p;
  }

  // ui: { line(parent,text,title), ctl(parent)->el, addRow(parent,tag,name,size,title,getPayload) }
  // ---- Alt yazıların öz vizual stilləri (Default / Kinematoqrafik / Minimalist / Neon) ----
  const VISUAL_STYLES = [
    { key: "default", name: "Default" },
    { key: "cinematic", name: "Kinematoqrafik" },
    { key: "minimalist", name: "Minimalist" },
    { key: "neon", name: "Neon" }
  ];
  const VISUAL_KEYS = VISUAL_STYLES.map(x => x.key);
  const VISUAL_KEY_LS = "idmSubVisualStyle";
  const VISUAL_KEY_CS = "subVisualStyle";
  // ---- Alt yazı görünüşü (ölçü / qalın / kursiv / altdan xətt / fon qaralması) ----
  // Ayarlar → Alt yazı bölməsindən idarə olunur; yükləmə payload-una da əlavə olunur.
  const SUB_STYLE_KEYS = ["default", "academic", "colloquial", "simplified"];
  const SUB_APP_DEF = { size: 16, bold: false, italic: false, underline: false, bg: 10, style: "default", font: "Default", fontResolved: "", fontMissing: false, fontFallback: "" };
  function normSubApp(v) {
    v = v && typeof v === "object" ? v : {};
    const cl = (n, a, b, d) => { n = Math.round(+n); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
    const sty = v.style || v.aiStyle;
    return { size: cl(v.size, 2, 200, 16), bold: !!v.bold, italic: !!v.italic, underline: !!v.underline,
      bg: cl(v.bg, 0, 100, 10), style: SUB_STYLE_KEYS.includes(sty) ? sty : "default",
      font: String(v.font || "Default").slice(0, 120) || "Default",
      fontResolved: String(v.fontResolved || "").slice(0, 120),
      fontMissing: !!v.fontMissing, fontFallback: String(v.fontFallback || "").slice(0, 120) };
  }
  let SUB_APP = { ...SUB_APP_DEF };
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get("subAppearance").then(v => { SUB_APP = normSubApp(v && v.subAppearance); }).catch(() => {});
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area === "local" && ch.subAppearance) SUB_APP = normSubApp(ch.subAppearance.newValue);
      });
    }
  } catch {}
  function subVisualGet() {
    try { const v = localStorage.getItem(VISUAL_KEY_LS); if (VISUAL_KEYS.includes(v)) return v; } catch {}
    return "default";
  }
  function subVisualSave(key) {
    if (!VISUAL_KEYS.includes(key)) key = "default";
    try { localStorage.setItem(VISUAL_KEY_LS, key); } catch {}
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) chrome.storage.local.set({ [VISUAL_KEY_CS]: key });
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        try { const pr = chrome.runtime.sendMessage({ type: "mpvStyle", style: key, appearance: { ...SUB_APP } }); if (pr && pr.catch) pr.catch(() => {}); } catch {}
      }
    } catch {}
  }
  // ---- Alt yazı üçün iki səviyyəli custom menyu (Orjinal / Sİ tərəfindən yaradılmış) ----
  let SUBPANEL = null;
  function closeSubPanel() {
    if (!SUBPANEL) return;
    try { if (SUBPANEL._out) document.removeEventListener("pointerdown", SUBPANEL._out, true); } catch {}
    try { if (SUBPANEL._key) document.removeEventListener("keydown", SUBPANEL._key); } catch {}
    try { if (SUBPANEL._ro) SUBPANEL._ro.disconnect(); } catch {}
    try { if (SUBPANEL._winResize) window.removeEventListener("resize", SUBPANEL._winResize); } catch {}
    try { SUBPANEL.remove(); } catch {}
    SUBPANEL = null;
  }
  function openSubPanel(anchor, build, backFn) {
    closeSubPanel();
    if (!document.body) return;
    const m = document.createElement("div");
    m.className = "ai-sub-pop";
    m.style.cssText = "position:fixed;z-index:2147483647;width:min(300px,calc(100vw - 12px));max-height:min(66vh,420px);overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:#666 #1c1c1e;scroll-padding-bottom:22px;box-sizing:border-box;background:#1c1c1e;color:#eee;border:1px solid #3a3a3f;border-radius:7px;padding:4px 4px 20px;box-shadow:0 8px 30px #000a;font:12px system-ui,sans-serif";
    const head = document.createElement("div");
    head.style.cssText = "position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:4px;padding:2px 2px 6px;background:#1c1c1e;border-bottom:1px solid #333;margin-bottom:3px;box-shadow:0 3px 8px #0004";
    const back = document.createElement("button"); back.type = "button"; back.textContent = "<"; back.title = "Geri";
    back.style.cssText = "background:transparent;color:#eee;border:1px solid #4a4a4f;border-radius:4px;width:24px;height:22px;line-height:18px;cursor:pointer;font:700 14px system-ui,sans-serif;padding:0;flex:none";
    back.onclick = e => { e.stopPropagation(); closeSubPanel(); if (backFn) try { backFn(); } catch {} };
    const headRight = document.createElement("div");
    headRight.style.cssText = "margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:4px;min-width:0";
    m._headRight = headRight;
    head.append(back, headRight);
    m.append(head);
    document.body.append(m);
    build(m);
    // Paneli hər dəfə yenidən ölçürük: kateqoriya açılanda hündürlük artır və
    // əvvəlki aşağı mövqe sonuncu dilləri ekranın altından kənara çıxara bilər.
    const placePanel = () => {
      const vh = Math.max(320, window.innerHeight || 0);
      m.style.maxHeight = Math.max(180, Math.min(420, vh - 24)) + "px";
      const r = anchor.getBoundingClientRect(), pr = m.getBoundingClientRect();
      const left = Math.max(6, Math.min(innerWidth - pr.width - 6, r.left));
      let top = r.bottom + 4;
      if (top + pr.height > vh - 12) top = r.top - pr.height - 4;
      top = Math.max(10, Math.min(top, vh - pr.height - 14));
      m.style.left = left + "px";
      m.style.top = top + "px";
    };
    m._place = placePanel;
    placePanel();
    if (typeof ResizeObserver !== "undefined") {
      try {
        m._ro = new ResizeObserver(() => { if (SUBPANEL === m) placePanel(); });
        m._ro.observe(m);
      } catch {}
    }
    m._winResize = () => { if (SUBPANEL === m) placePanel(); };
    window.addEventListener("resize", m._winResize);
    SUBPANEL = m;
    const out = e => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeSubPanel(); };
    m._out = out;
    setTimeout(() => document.addEventListener("pointerdown", out, true), 0);
    const key = e => { if (e.key === "Escape") closeSubPanel(); };
    m._key = key;
    setTimeout(() => document.addEventListener("keydown", key), 0);
  }

  // ui: { line(parent,text,title), ctl(parent)->el, addRow(parent,tag,name,size,title,getPayload) }
  let AI_SEQ = 0;
  function renderSource(parent, src, header, ctx, ui, pageSubs) {
    const subs = ctx.subsOn === false ? [] : subEntries(src, pageSubs);
    const modes = availableModes(src, subs);
    // YouTube musiqisində heç bir subtitr yoxdursa da AI ilə video+səs+subtitr
    // (və yalnız subtitr) rejimləri təklif olunur; mənbə audiodan hazırlanacaq.
    const noSubAi = !subs.length && !!ctx.youtube && !!ctx.ai;
    if (noSubAi) {
      if (!modes.includes("vas")) modes.push("vas");
      if (!modes.includes("s")) modes.push("s");
    }
    if (!modes.length) return false;
    const wrap = document.createElement("div"); parent.append(wrap);
    const defaultSub = (subs.find(x => !x.subAll && x.kind !== "forced" && x.kind !== "tiny") || subs.find(x => !x.subAll) || subs[0] || {}).id || "";
    const selKey = "subSel:" + [ctx.pageUrl || "", src.url || src.name || src.pageUrl || ""].join("|");
    // Seçimlərin saxlanması: popup ctx.loadSel/saveSel verir; overlay-də localStorage fallback.
    const selLoad = k => { try { if (ctx.loadSel) return ctx.loadSel(k) || {}; } catch {} try { return JSON.parse(localStorage.getItem("idm:" + k) || "null") || {}; } catch { return {}; } };
    const selSave = (k, v) => { try { if (ctx.saveSel) { ctx.saveSel(k, v); return; } } catch {} try { localStorage.setItem("idm:" + k, JSON.stringify(v || {})); } catch {} };
    let savedSel = {};
    try { savedSel = selLoad(selKey) || {}; } catch {}
    const st = { mode: (savedSel.mode && modes.includes(savedSel.mode)) ? savedSel.mode : (noSubAi ? "vas" : modes[0]),
      audio: savedSel.audio || "", aa: savedSel.aa || "", sub: defaultSub, keep: !!savedSel.keep,
      afmt: savedSel.afmt || "best", aq: savedSel.aq || "", vf: savedSel.vf || "all",
      audioSel: Array.isArray(savedSel.audioSel) ? savedSel.audioSel.slice() : null,
      origSel: new Set(), aiSel: new Set(), aiSubs: {}, style: "default", visualStyle: "default", aiRunId: "", aiBatch: false, ytStatus: "",
      sourceId: "", dualSub: null, dualOn: false, dualTopId: "", dualBottomId: "",
      dualTopColor: "#ffffff", dualBottomColor: "#ffffff" };
    // Bu səhifə üçün tamamlanmış bütün AI dillərini bərpa et (tək son nəticə yox).
    const pageAi = (ctx.aiResults || []).filter(x => x && x.pageUrl === (ctx.pageUrl || ""));
    const aiKey = c => String(c || "").trim().toLowerCase().replace(/_/g, "-");
    for (const r of pageAi) {
      if (r && r.dual) {
        st.dualSub = { ...r }; st.dualOn = true;
        st.dualTopId = String(r.topId || ""); st.dualBottomId = String(r.bottomId || "");
        st.dualTopColor = r.topColor || "#ffffff"; st.dualBottomColor = r.bottomColor || "#ffffff";
        continue;
      }
      const l = aiKey(r.lang);
      if (l) st.aiSubs[l] = { ...r };
    }
    const pageAiSingle = pageAi.filter(r => r && !r.dual);
    st.aiSub = pageAiSingle.slice(-1)[0] ? { ...pageAiSingle.slice(-1)[0] } : null;
    if (Array.isArray(savedSel.orig)) st.origSel = new Set(savedSel.orig.filter(id => subs.some(x => x.id === id)));
    else if (defaultSub) st.origSel.add(defaultSub);
    st.sub = (savedSel.sub && subs.some(x => x.id === savedSel.sub)) ? savedSel.sub : ([...st.origSel][0] || "");
    if (Array.isArray(savedSel.ai)) st.aiSel = new Set(savedSel.ai.map(aiKey).filter(Boolean));
    else if (Object.keys(st.aiSubs).length) st.aiSel = new Set(Object.keys(st.aiSubs));
    st.sourceId = savedSel.source && subs.some(x => x.id === savedSel.source) ? savedSel.source : "";
    if (!st.dualTopId && savedSel.dualTop) st.dualTopId = String(savedSel.dualTop);
    if (!st.dualBottomId && savedSel.dualBottom) st.dualBottomId = String(savedSel.dualBottom);
    if (savedSel.dualTopColor) st.dualTopColor = String(savedSel.dualTopColor);
    if (savedSel.dualBottomColor) st.dualBottomColor = String(savedSel.dualBottomColor);
    st.style = SUB_STYLE_KEYS.includes(SUB_APP.style) ? SUB_APP.style : "default";
    st.visualStyle = VISUAL_KEYS.includes(savedSel.visual) ? savedSel.visual : subVisualGet();
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["subVisualStyle", "subAppearance"]).then(v => {
          if (v && VISUAL_KEYS.includes(v.subVisualStyle)) st.visualStyle = v.subVisualStyle;
          if (v && v.subAppearance && SUB_STYLE_KEYS.includes(v.subAppearance.style)) st.style = v.subAppearance.style;
        }).catch(() => {});
      }
    } catch {}
    st.aiBatch = st.aiSel.size > 1;
    const integratedLangs = new Set(pageAi.filter(a => a && a.integrated).map(a => aiKey(a.lang)));
    st.ytStatus = st.aiSel.size && [...st.aiSel].every(l => integratedLangs.has(l)) ? "ok" : "";
    const saveSel = () => {
      try { selSave(selKey, {
        orig: [...st.origSel], ai: [...st.aiSel], style: st.style, visual: st.visualStyle,
        source: st.sourceId || "", dualTop: st.dualTopId || "", dualBottom: st.dualBottomId || "", dual: !!st.dualSub,
        dualTopColor: st.dualTopColor || "#ffffff", dualBottomColor: st.dualBottomColor || "#ffffff",
        mode: st.mode, audio: st.audio || "", aa: st.aa || "", sub: st.sub || "", keep: !!st.keep,
        audioSel: Array.isArray(st.audioSel) ? [...st.audioSel] : [],
        afmt: st.afmt, aq: st.aq || "", vf: st.vf || "all"
      }); } catch {}
      // Sİ (AI) üçün aktiv seçimləri background-a ötür: kontekst menyusundan
      // gələn AI işi keyfiyyət/format/audio/subs seçimini yenidən soruşmasın.
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          const subObj = (subs || []).find(x => x && x.id === st.sub) || null;
          // Seçilmiş BÜTÜN səslər və BÜTÜN subtitrlər (seqment kəsmə də onları işlədir).
          const rawAudios = (src && src.audios) || [];
          const audioSel = (Array.isArray(st.audioSel) ? st.audioSel : (st.audio ? [st.audio] : []))
            .filter(id => rawAudios.some(a => a.id === id));
          const audioTracks = audioSel.map(id => { const a = rawAudios.find(x => x.id === id) || {}; return { id, url: a.url || "", lang: a.lang || "", size: +a.size || 0, est: !!a.est }; });
          const origA = rawAudios.find(a => a.role === "orijinal") || rawAudios.find(a => a.auto) || rawAudios[0];
          const muxedAV = !!(src && src.caps && src.caps.audioSeparate === false);
          const audioDefault = audioSel.length === 1 && origA && audioSel[0] === origA.id && muxedAV;
          const audioNone = audioSel.length === 0 && rawAudios.length > 0;
          const se = subExtras(st, subs, ctx);
          chrome.runtime.sendMessage({
            type: "siActive",
            tabId: (ctx && ctx.tabId) || undefined,
            pageUrl: ctx.pageUrl || "",
            sel: {
              mode: st.mode, audio: st.audio || "", aa: st.aa || "", afmt: st.afmt, aq: st.aq || "", vf: st.vf || "all",
              audioUrl: st.audioUrl || "", aaUrl: st.aaUrl || "", audioSel, audioTracks, audioDefault, audioNone,
              extSubs: se.extSubs, subAll: se.subAll,
              sub: st.sub || "", subUrl: subObj ? subObj.url : "", subLang: subObj ? (subObj.lang || subObj.dlang || "") : "",
              subLabel: subObj ? (subObj.label || "") : "", subAuto: !!(subObj && (subObj.auto || /auto|avto/i.test(subObj.label || ""))),
              quality: st.lastRowLabel || ""
            },
            stream: src ? { url: src.url || "", kind: src.kind || "", name: src.name || src.label || "", pageUrl: src.pageUrl || "" } : null
          }).catch(() => {});
        }
      } catch {}
    };
    const aiId = "ai-" + (++AI_SEQ);
    st.aiRunId = aiId;
    const aiState = { running: false, target: ctx.aiTarget || "az", pct: pageAi.length ? 100 : 0, text: pageAi.length ? "✓ Tamamlandı" : "", eta: null,
      queueTotal: 0, queueIndex: 0, queueDone: 0, queueStarted: 0, count: "", overallPct: 0,
      displayPct: 0, animTarget: 0, animRaf: 0 };
    aiState.view = (pct, text, eta) => {
      const total = Math.max(0, +aiState.queueTotal || 0);
      const n = Math.max(0, Math.min(100, +pct || 0));
      if (total <= 1) return { pct: n, text: String(text || ""), eta: (+eta > 0 ? +eta : 0), count: "" };
      const idx = Math.max(0, Math.min(total - 1, +aiState.queueIndex || 0));
      const raw = Math.min(100, ((idx + n / 100) / total) * 100);
      const overall = Math.max(+aiState.overallPct || 0, raw);
      aiState.overallPct = overall;
      const elapsed = aiState.queueStarted ? (Date.now() - aiState.queueStarted) / 1000 : 0;
      let rem = +eta > 0 ? +eta : 0;
      if (overall > 2 && elapsed > 2) rem = Math.max(1, Math.round(elapsed / (overall / 100) - elapsed));
      return { pct: overall, text: String(text || ""), eta: overall >= 100 ? 0 : rem,
        count: Math.min(total, idx + 1) + "/" + total };
    };
    const aiEtaText = value => {
      const s = +value;
      if (!(s > 0) || !isFinite(s)) return "";
      const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60);
      return "qalıb ~ " + (h ? `${h} saat ${m} dəq` : m ? `${m} dəq ${t % 60} san` : `${t} san`);
    };
    // Vahid proqres: hədəf faiz dəyişsə də, ekranda göstərilən faiz yumşaq və yalnız irəli hərəkət edir.
    aiState.resetAnim = () => {
      if (aiState.animRaf) { try { cancelAnimationFrame(aiState.animRaf); } catch {} aiState.animRaf = 0; }
      aiState.displayPct = 0; aiState.animTarget = 0;
    };
    aiState.animateTo = (target, getNodes) => {
      const t = Math.max(0, Math.min(100, +target || 0));
      aiState.animTarget = Math.max(aiState.animTarget, t);
      const tick = () => {
        const goal = aiState.animTarget;
        const d = goal - aiState.displayPct;
        if (d <= 0.06) aiState.displayPct = goal;
        else aiState.displayPct += Math.max(0.18, d * 0.11);
        if (aiState.displayPct > goal) aiState.displayPct = goal;
        const n = (typeof getNodes === "function" ? getNodes() : getNodes) || {};
        if (n.bar) n.bar.style.width = aiState.displayPct.toFixed(2) + "%";
        if (n.pct) n.pct.textContent = (aiState.count ? aiState.count + " · " : "") + Math.round(aiState.displayPct) + "%";
        if (aiState.displayPct < goal - 0.04) aiState.animRaf = requestAnimationFrame(tick);
        else aiState.animRaf = 0;
      };
      if (!aiState.animRaf) aiState.animRaf = requestAnimationFrame(tick);
    };
    // Heç bir AI mənbəsi seçilmir və ya yüklənmir. İstifadəçi "Sİ alt yazı" bölməsindən dil seçəndə
    // fallback mənbə seçimi və tərcümə yalnız o anda başlayır.
    const aiCandidates = (subs || []).filter(x => x && !x.subAll && x.url);
    const aiHasSub = aiCandidates.length > 0;
    const aiCanGenerate = !!noSubAi && !!ctx.ai;
    const aiSubReq = s => s && s.url ? ({ url: s.url, lang: s.lang || "", dlang: s.dlang || "", fmt: s.fmt || s.ext || "", auto: !!s.auto, kind: s.kind || "", label: s.label || "", referer: s.referer || "", cookie: s.cookie || "" }) : null;

    const aiProgressNodes = () => {
      const holder = wrap.querySelector(`[data-ai-id="${st.aiRunId || aiId}"]`);
      if (!holder) return {};
      return { holder, prog: holder.querySelector(".ai-prog"), bar: holder.querySelector(".ai-bar i"), pct: holder.querySelector(".ai-pct"), eta: holder.querySelector(".ai-eta"), msg: holder.querySelector(".ai-msg"), trigger: holder.querySelector(".ai-sub-trigger") };
    };
    const setAiProgress = (pct, text, error = false, done = false, eta = null) => {
      const v = aiState.view(pct, text, eta);
      aiState.pct = v.pct; aiState.text = v.text;
      aiState.eta = (error || done || v.pct >= 100) ? null : (v.eta > 0 ? v.eta : null);
      aiState.count = v.count || "";
      const n = aiProgressNodes();
      if (n.prog) n.prog.style.display = "block";
      if (n.eta) n.eta.textContent = aiEtaText(aiState.eta);
      if (n.msg) n.msg.textContent = aiState.text;
      if (n.holder) { n.holder.classList.toggle("err", !!error); n.holder.classList.toggle("done", !!done || aiState.pct >= 100); }
      aiState.animateTo(aiState.pct, aiProgressNodes);
    };
    const runAiQueue = async targets => {
      if (aiState.running || (!aiHasSub && !aiCanGenerate) || !ctx.ai) return;
      const list = (Array.isArray(targets) ? targets : []).filter(Boolean);
      if (!list.length) return;
      const selectedSource = st.sourceId ? (subs || []).find(x => x.id === st.sourceId) : null;
      const sourceReq = selectedSource ? aiSubReq(selectedSource) : null;
      st.aiBatch = list.length > 1;
      st.ytStatus = "";
      if (ytPromptEl) { ytPromptEl.remove(); ytPromptEl = null; }
      const rowEl = wrap.querySelector(".ai-sub-row");
      aiState.queueTotal = list.length; aiState.queueIndex = 0; aiState.queueDone = 0; aiState.queueStarted = Date.now(); aiState.count = ""; aiState.overallPct = 0;
      aiState.resetAnim();
      aiState.running = true; aiState.pct = 0; aiState.text = "Subtitr mənbəyi axtarılır…"; aiState.eta = null;
      if (st.refreshLabel) st.refreshLabel();
      try { const d = wrap.querySelector(".ai-sub-del"); if (d && !Object.keys(st.aiSubs).length && !st.dualSub) d.style.display = "none"; } catch {}
      let done = 0;
      const errors = [];
      for (let i = 0; i < list.length; i++) {
        const target = list[i];
        const runId = aiId + "-" + String(target).replace(/[^\w-]/g, "");
        st.aiRunId = runId;
        if (rowEl) rowEl.dataset.aiId = runId;
        aiState.queueIndex = i; aiState.queueDone = i;
        aiState.target = target; aiState.pct = 0;
        aiState.text = `Tərcümə… ${i + 1}/${list.length} · ${(typeof IDMAI !== "undefined" && IDMAI.langName ? IDMAI.langName(target) : target)}`;
        aiState.eta = null;
        setAiProgress(0, aiState.text);
        const n0 = aiProgressNodes();
        if (n0.holder) n0.holder.classList.remove("err", "done");
        if (st.refreshLabel) st.refreshLabel();
        try {
          const res = await ctx.ai({
            id: runId, target, pageUrl: ctx.pageUrl, title: ctx.title, style: SUB_APP.style || st.style,
            sourceSub: sourceReq, subs: aiCandidates.map(aiSubReq).filter(Boolean)
          });
          if (!res || res.ok === false || !res.sub) throw new Error((res && res.error) || "AI subtitr yaradılmadı");
          st.aiSubs[target] = res.sub;
          st.aiSub = res.sub;
          done++;
          if (ctx.aiResults) {
            const k = ctx.aiResults.findIndex(x => x && x.id === res.sub.id);
            if (k >= 0) ctx.aiResults.splice(k, 1);
            ctx.aiResults.push({ ...res.sub, prompted: st.aiBatch, integrated: false });
          }
          aiState.pct = 100;
          aiState.text = "✓ " + (typeof IDMAI !== "undefined" && IDMAI.langName ? IDMAI.langName(target) : target);
          setAiProgress(100, aiState.text, false, true);
        } catch (e) {
          errors.push((typeof IDMAI !== "undefined" && IDMAI.langName ? IDMAI.langName(target) : target) + ": " + String(e && e.message || e));
          setAiProgress(0, "Xəta: " + String(e && e.message || e), true);
        }
      }
      aiState.running = false;
      aiState.queueDone = done;
      aiState.queueIndex = done ? done - 1 : 0;
      aiState.text = errors.length
        ? `✓ ${done}/${list.length} · Xəta: ${errors[0]}` : `✓ Tamamlandı · ${done} dil`;
      setAiProgress(done ? 100 : 0, aiState.text, errors.length > 0, done > 0);
      const nEnd = aiProgressNodes();
      if (st.refreshLabel) st.refreshLabel();
      if (done) { try { const d = wrap.querySelector(".ai-sub-del"); if (d) d.style.display = "inline"; } catch {} }
      saveSel();
      if (list.length === 1 && done && !errors.length) showYtPrompt();
      // Sonrakı progress mesajları üçün kanonik id-yə qaytar (mesajlar artıq bitib).
      st.aiRunId = aiId;
      if (rowEl) rowEl.dataset.aiId = aiId;
    };

    // YouTube-dan başqa saytlarda "Tərcümə et" basanda mənbə alt yazı seçimi.
    const sourceCandidates = () => {
      const seen = new Set();
      const list = [...(Array.isArray(ctx.dualSubs) ? ctx.dualSubs : []), ...(subs || [])].filter(x => {
        if (!x || !x.url || x.subAll) return false;
        const k = [x.url, x.lang || x.dlang || "", x.kind || ""].join("|");
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
      return { list, fallback: false };
    };
    const openSourcePicker = (targets, anchor) => {
      const pick = sourceCandidates();
      if (!pick.list.length) { runAiQueue(targets); return; }
      openSubPanel(anchor, panel => {
        const h = document.createElement("div");
        h.textContent = "Mənbə alt yazı";
        h.style.cssText = "color:#cfe0ff;font-weight:700;padding:2px 6px 3px";
        const sub = document.createElement("div");
        sub.textContent = "Tərcümə üçün mənbə seç";
        sub.style.cssText = "color:#9aa0a6;font-size:11px;padding:0 6px 6px";
        panel.append(h, sub);
        const box = document.createElement("div");
        box.style.cssText = "max-height:230px;overflow:auto;padding:1px 0";
        for (const x of pick.list) {
          const b = document.createElement("button"); b.type = "button";
          const on = st.sourceId === x.id;
          b.textContent = (on ? "✓ " : "") + subLangOnly(x) + subTypeSuffix(x);
          b.title = x.label || subLangOnly(x);
          b.style.cssText = "display:block;width:100%;text-align:left;border:0;margin:2px 0;padding:8px 9px;border-radius:4px;cursor:pointer;font:12px system-ui,sans-serif;background:" +
            (on ? "#2c3e55" : "#242426") + ";color:" + (on ? "#dcecff" : "#eee") + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
          b.onmouseenter = () => { if (!on) b.style.background = "#2c2c2e"; };
          b.onmouseleave = () => { if (!on) b.style.background = "#242426"; };
          b.onclick = ev => {
            ev.stopPropagation();
            st.sourceId = x.id;
            saveSel();
            closeSubPanel();
            runAiQueue(targets);
          };
          box.append(b);
        }
        panel.append(box);
      });
    };

    // İki alt yazı trekini üst/alt sətirli "İkili dil" kimi yaratma pəncərəsi.
    let dualModal = null;
    const dualItems = () => {
      const out = [], seen = new Set();
      const sourcePool = [...(Array.isArray(ctx.dualSubs) ? ctx.dualSubs : []), ...(subs || [])];
      for (const x of sourcePool) {
        if (!x || x.subAll || !x.url) continue;
        const k = [x.url, x.lang || x.dlang || "", x.kind || ""].join("|");
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ id: "o:" + x.id, kind: "orig", title: subLangOnly(x) + subTypeSuffix(x),
          flag: langFlag(x.dlang || x.lang),
          meta: KIND[x.kind] || (x.translated ? "Avtomatik tərcümə" : (x.auto ? "Avtomatik" : "Manual")), sub: x });
      }
      // Bütün tamamlanmış Sİ nəticələri (yalnız srt-i olanlar), ən son nəticə üstünlük təşkil edir.
      const aiMap = new Map();
      for (const r of (ctx.aiResults || [])) {
        if (!r || r.dual || !r.srt || (r.pageUrl && ctx.pageUrl && r.pageUrl !== ctx.pageUrl)) continue;
        const code = aiKey(r.lang || r.label || "");
        if (!code) continue;
        const prev = aiMap.get(code);
        if (!prev || (+r.time || 0) >= (+prev.time || 0)) aiMap.set(code, r);
      }
      for (const [code, r] of Object.entries(st.aiSubs || {})) {
        if (!r || !r.srt || aiMap.has(code)) continue;
        aiMap.set(code, r);
      }
      for (const [code, r] of aiMap) {
        out.push({ id: "a:" + code, kind: "ai", title: langOnly(code), flag: langFlag(code),
          meta: "Sİ · Hazır", srt: r.srt, lang: r.lang || code, label: r.label || langOnly(code), code });
      }
      return out;
    };
    const closeDualModal = () => {
      if (!dualModal) return;
      try { dualModal.remove(); } catch {}
      dualModal = null;
    };
    const openDualDialog = anchor => {
      closeSubPanel();
      closeDualModal();
      const items = dualItems();
      const find = id => items.find(x => x.id === id);
      const overlay = document.createElement("div");
      overlay.className = "idm-dual-overlay";
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:10px;box-sizing:border-box";
      const dlg = document.createElement("div");
      dlg.style.cssText = "width:min(560px,94vw);max-height:86vh;overflow:auto;background:#202024;border:1px solid #4a4a4f;border-radius:9px;box-shadow:0 12px 40px #000b;padding:10px;color:#eee;font:12px system-ui,sans-serif;box-sizing:border-box";
      const head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:8px;padding:1px 2px 8px";
      const title = document.createElement("b"); title.textContent = "İkili dil"; title.style.cssText = "color:#cfe0ff;font-size:14px";
      const hint = document.createElement("span"); hint.textContent = "Üst / aşağı sətir"; hint.style.cssText = "color:#8d8d95;font-size:10.5px";
      const spacer = document.createElement("div"); spacer.style.cssText = "flex:1";
      const create = document.createElement("button"); create.type = "button"; create.textContent = "Yarat";
      create.style.cssText = "border:1px solid #5ab0ff;border-radius:5px;padding:4px 10px;cursor:pointer;background:#1f5f9d;color:#fff;font:700 11px system-ui,sans-serif";
      const close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.title = "Bağla";
      close.style.cssText = "border:0;background:transparent;color:#bbb;font:18px system-ui,sans-serif;cursor:pointer;padding:0 3px;line-height:1";
      head.append(title, hint, spacer, create, close);
      dlg.append(head);
      const cols = document.createElement("div");
      cols.style.cssText = "display:flex;gap:8px;align-items:flex-start";
      // Hər sütun üçün ayrı rəng paleti. Default: ağ.
      const openColorPalette = (side, repaint) => {
        const getC = () => side === "top" ? st.dualTopColor : st.dualBottomColor;
        let pending = getC() || "#ffffff";
        const pal = document.createElement("div");
        pal.className = "idm-color-palette";
        pal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:10px;box-sizing:border-box";
        const box = document.createElement("div");
        box.style.cssText = "width:min(420px,94vw);max-height:86vh;overflow:auto;background:#202024;border:1px solid #4a4a4f;border-radius:9px;box-shadow:0 12px 40px #000b;padding:10px;color:#eee;font:12px system-ui,sans-serif;box-sizing:border-box";
        const head = document.createElement("div"); head.style.cssText = "display:flex;align-items:center;gap:8px;padding:1px 2px 8px";
        const back = document.createElement("button"); back.type = "button"; back.textContent = "<"; back.title = "Geri";
        back.style.cssText = "border:0;background:transparent;color:#cfe0ff;font:24px/1 system-ui,sans-serif;cursor:pointer;padding:0 3px";
        const title = document.createElement("b"); title.textContent = "Rəng"; title.style.cssText = "color:#cfe0ff;font-size:14px";
        const spacer = document.createElement("div"); spacer.style.cssText = "flex:1";
        const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Tətbiq et";
        apply.style.cssText = "border:1px solid #5ab0ff;border-radius:5px;padding:4px 10px;cursor:pointer;background:#1f5f9d;color:#fff;font:700 11px system-ui,sans-serif";
        head.append(back, title, spacer, apply); box.append(head);
        const preview = document.createElement("div");
        preview.style.cssText = "height:22px;border:1px solid #4a4a4f;border-radius:4px;margin:0 2px 8px;background:" + pending;
        box.append(preview);
        const solid = document.createElement("div");
        solid.style.cssText = "display:grid;grid-template-columns:repeat(8,1fr);gap:4px;padding:0 2px 8px";
        const colors = ["#ffffff","#000000","#8d8d95","#ff3b30","#ff9500","#ffcc00","#34c759","#00c7be","#32ade6","#007aff","#5856d6","#af52de","#ff2d55","#ff6b81","#f6e6c4","#23e6ff"];
        const setPending = v => { pending = v; preview.style.background = v; };
        for (const col of colors) {
          const b = document.createElement("button"); b.type = "button"; b.title = col;
          b.style.cssText = "height:20px;border:1px solid #555;border-radius:4px;cursor:pointer;background:" + col;
          b.onclick = ev => { ev.stopPropagation(); setPending(col); };
          solid.append(b);
        }
        box.append(solid);
        const colorLine = document.createElement("div");
        colorLine.style.cssText = "display:flex;gap:6px;align-items:center;padding:0 2px 8px";
        const native = document.createElement("input"); native.type = "color"; native.value = /^#[0-9a-f]{6}$/i.test(pending) ? pending : "#ffffff";
        native.style.cssText = "width:44px;height:26px;border:1px solid #555;border-radius:4px;background:#242426;cursor:pointer";
        native.oninput = () => setPending(native.value);
        const nativeLabel = document.createElement("span"); nativeLabel.textContent = "Bütün rənglər"; nativeLabel.style.cssText = "color:#aaa;font-size:11px";
        colorLine.append(native, nativeLabel); box.append(colorLine);
        const gradTitle = document.createElement("div"); gradTitle.textContent = "Qradientlər"; gradTitle.style.cssText = "color:#9aa0a6;font-size:10px;padding:0 2px 4px";
        box.append(gradTitle);
        const grads = [
          "linear-gradient(90deg,#ff416c,#ff4b2b)",
          "linear-gradient(90deg,#00c6ff,#0072ff)",
          "linear-gradient(90deg,#f7971e,#ffd200)",
          "linear-gradient(90deg,#8e2de2,#4a00e0)",
          "linear-gradient(90deg,#00f5a0,#00d9f5)",
          "linear-gradient(90deg,#ff0080,#ff8c00,#40e0d0,#8a2be2)"
        ];
        const grid = document.createElement("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:0 2px 8px";
        for (const g of grads) {
          const b = document.createElement("button"); b.type = "button"; b.title = g;
          b.style.cssText = "height:24px;border:1px solid #555;border-radius:4px;cursor:pointer;background:" + g;
          b.onclick = ev => { ev.stopPropagation(); setPending(g); };
          grid.append(b);
        }
        box.append(grid);
        const custom = document.createElement("input"); custom.type = "text";
        custom.placeholder = "CSS rəng və ya linear-gradient(...)";
        custom.value = /^linear-gradient/i.test(pending) ? pending : "";
        custom.style.cssText = "width:100%;box-sizing:border-box;border:1px solid #4a4a4f;border-radius:4px;padding:5px 7px;background:#242426;color:#eee;font:11px system-ui,sans-serif;margin:0 2px 2px";
        custom.oninput = () => { const v = custom.value.trim(); if (v) setPending(v); };
        box.append(custom);
        back.onclick = ev => { ev.stopPropagation(); try { pal.remove(); } catch {} };
        apply.onclick = ev => {
          ev.stopPropagation();
          const v = String(pending || "").trim();
          if (!v) return;
          if (side === "top") st.dualTopColor = v; else st.dualBottomColor = v;
          saveSel(); repaint(); try { pal.remove(); } catch {}
        };
        pal.onclick = ev => { if (ev.target === pal) { try { pal.remove(); } catch {} } };
        box.onclick = ev => ev.stopPropagation();
        pal.append(box); document.body.append(pal); pal.tabIndex = -1; try { pal.focus(); } catch {}
      };
      const wrapCol = side => {
        const col = document.createElement("div"); col.style.cssText = "flex:1;min-width:0";
        const lab = document.createElement("div");
        lab.textContent = side === "top" ? "Üst sətir" : "Aşağı sətir";
        lab.style.cssText = "color:#9aa0a6;font-size:10px;padding:0 2px 3px";
        const box = document.createElement("button"); box.type = "button";
        box.style.cssText = "display:block;width:100%;min-height:58px;text-align:left;border:1px dashed #555;border-radius:5px;padding:7px 8px;background:#242426;color:#eee;font:12px system-ui,sans-serif;cursor:pointer;box-sizing:border-box;overflow:hidden";
        const list = document.createElement("div");
        list.style.cssText = "display:none;max-height:190px;overflow:auto;margin-top:4px;border:1px solid #3a3a3f;border-radius:5px;background:#1b1b1e;padding:2px";
        const getSel = () => side === "top" ? find(st.dualTopId) : find(st.dualBottomId);
        const paint = () => {
          const sel = getSel();
          box.textContent = sel ? (sel.kind === "ai" ? "Sİ · " : "") + sel.title : "Alt yazı seç…";
          box.style.color = sel ? "#dcecff" : "#999";
        };
        const buildList = () => {
          list.replaceChildren();
          if (!items.length) {
            const n = document.createElement("div"); n.textContent = "Alt yazı yoxdur"; n.style.cssText = "padding:8px;color:#888"; list.append(n); return;
          }
          for (const it of items) {
            const b = document.createElement("button"); b.type = "button";
            const on = (side === "top" ? st.dualTopId : st.dualBottomId) === it.id;
            b.textContent = (on ? "✓ " : "") + it.title;
            b.title = [it.title, it.meta].filter(Boolean).join(" · ");
            b.style.cssText = "display:block;width:100%;text-align:left;border:0;border-radius:4px;margin:1px 0;padding:6px 7px;background:" + (on ? "#2c3e55" : "transparent") + ";color:" + (on ? "#dcecff" : "#eee") + ";font:12px system-ui,sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
            b.onmouseenter = () => { if (!on) b.style.background = "#2c2c2e"; };
            b.onmouseleave = () => { if (!on) b.style.background = "transparent"; };
            b.onclick = ev => {
              ev.stopPropagation();
              if (side === "top") st.dualTopId = it.id; else st.dualBottomId = it.id;
              saveSel(); paint(); list.style.display = "none"; updateCreate();
            };
            list.append(b);
          }
        };
        box.onclick = ev => {
          ev.stopPropagation();
          const open = list.style.display === "block";
          list.style.display = open ? "none" : "block";
          if (!open) buildList();
          dlg._place && dlg._place();
        };
        const colorRow = document.createElement("button"); colorRow.type = "button";
        colorRow.style.cssText = "display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;margin-top:5px;border:1px solid #3a3a3f;border-radius:4px;padding:4px 6px;background:#242426;color:#eee;cursor:pointer;font:11px system-ui,sans-serif;text-align:left";
        const colorTxt = document.createElement("span"); colorTxt.textContent = "Rəng"; colorTxt.style.cssText = "flex:1;color:#aaa";
        const colorSq = document.createElement("span"); colorSq.style.cssText = "flex:none;width:14px;height:14px;border:1px solid #666;border-radius:3px;background:#ffffff";
        const paintColor = () => { colorSq.style.background = side === "top" ? (st.dualTopColor || "#ffffff") : (st.dualBottomColor || "#ffffff"); };
        paintColor();
        colorRow.append(colorTxt, colorSq);
        colorRow.onclick = ev => { ev.stopPropagation(); openColorPalette(side, paintColor); };
        col.append(lab, box, list, colorRow);
        return { col, box, list, paint, paintColor };
      };
      const topCol = wrapCol("top"), bottomCol = wrapCol("bottom");
      cols.append(topCol.col, bottomCol.col);
      dlg.append(cols);
      const err = document.createElement("div");
      err.style.cssText = "color:#ff9a9a;font-size:11px;min-height:15px;padding:5px 2px 0";
      dlg.append(err);
      const closeAll = () => { closeDualModal(); };
      close.onclick = ev => { ev.stopPropagation(); closeAll(); };
      overlay.onclick = ev => { if (ev.target === overlay) closeAll(); };
      dlg.onclick = ev => ev.stopPropagation();
      const updateCreate = () => {
        const ok = !!(find(st.dualTopId) && find(st.dualBottomId));
        create.disabled = !ok;
        create.style.opacity = ok ? "1" : ".5";
        create.style.cursor = ok ? "pointer" : "not-allowed";
      };
      topCol.paint(); bottomCol.paint(); updateCreate();
      create.onclick = async ev => {
        ev.stopPropagation();
        const top = find(st.dualTopId), bottom = find(st.dualBottomId);
        if (!top || !bottom || create.disabled) return;
        if (!ctx.dual) { err.textContent = "İkili alt yazı modulu mövcud deyil"; create.textContent = "✕"; create.style.background = "#6b2424"; return; }
        const oldDual = st.dualSub;
        create.disabled = true; create.textContent = "…"; create.style.background = "#1f5f9d";
        err.textContent = "";
        aiState.queueTotal = 1; aiState.queueIndex = 0; aiState.queueDone = 0; aiState.overallPct = 0; aiState.running = true; aiState.resetAnim();
        setAiProgress(8, "İkili alt yazı hazırlanır…");
        if (st.refreshLabel) st.refreshLabel();
        try {
          await new Promise(r => setTimeout(r, 140));
          setAiProgress(35, "Mənbə alt yazılar oxunur…");
          const topReq = top.kind === "ai"
            ? { kind: "ai", id: top.id, srt: top.srt, lang: top.lang, label: top.label, flag: top.flag || "", color: st.dualTopColor }
            : { kind: "orig", id: "o:" + top.sub.id, flag: top.flag || "", color: st.dualTopColor, sub: { ...aiSubReq(top.sub), id: top.sub.id } };
          const bottomReq = bottom.kind === "ai"
            ? { kind: "ai", id: bottom.id, srt: bottom.srt, lang: bottom.lang, label: bottom.label, flag: bottom.flag || "", color: st.dualBottomColor }
            : { kind: "orig", id: "o:" + bottom.sub.id, flag: bottom.flag || "", color: st.dualBottomColor, sub: { ...aiSubReq(bottom.sub), id: bottom.sub.id } };
          const res = await ctx.dual({ top: topReq, bottom: bottomReq, pageUrl: ctx.pageUrl, title: ctx.title });
          if (!res || res.ok === false || !res.sub) throw new Error((res && res.error) || "İkili alt yazı yaradılmadı");
          setAiProgress(88, "Vaxtlar uyğunlaşdırılır…");
          st.dualSub = { ...res.sub };
          st.dualOn = true; st.dualTopId = top.id; st.dualBottomId = bottom.id;
          st.dualTopColor = res.sub.topColor || st.dualTopColor;
          st.dualBottomColor = res.sub.bottomColor || st.dualBottomColor;
          if (Array.isArray(ctx.aiResults)) {
            const oldIdx = ctx.aiResults.findIndex(x => x && x.dual);
            if (oldIdx >= 0) ctx.aiResults.splice(oldIdx, 1);
            ctx.aiResults.push({ ...res.sub, dual: true });
          }
          if (oldDual && oldDual.id !== res.sub.id && ctx.removeAiResult) ctx.removeAiResult(oldDual);
          saveSel();
          try { const d = wrap.querySelector(".ai-sub-del"); if (d) d.style.display = "inline"; } catch {}
          setAiProgress(100, "✓ İkili alt yazı hazır", false, true);
          aiState.displayPct = 100; aiState.animTarget = 100;
          try { const n = aiProgressNodes(); if (n.pct) n.pct.textContent = "100%"; if (n.bar) n.bar.style.width = "100%"; } catch {}
          create.textContent = "✓"; create.style.background = "#1f7a46"; create.style.borderColor = "#49d17d";
          if (st.refreshLabel) st.refreshLabel();
          aiState.running = false;
          setTimeout(closeAll, 700);
        } catch (e) {
          aiState.running = false;
          create.disabled = false; create.textContent = "✕"; create.style.background = "#6b2424"; create.style.borderColor = "#d16a6a";
          err.textContent = String(e && e.message || e).slice(0, 180);
          setAiProgress(0, "Xəta: " + err.textContent, true, false);
          if (st.refreshLabel) st.refreshLabel();
        }
      };
      const key = ev => { if (ev.key === "Escape") closeAll(); };
      overlay.addEventListener("keydown", key);
      overlay.tabIndex = -1;
      overlay.append(dlg);
      document.body.append(overlay);
      dualModal = overlay;
      setTimeout(() => { try { overlay.focus(); } catch {} }, 0);
      dlg._place = () => {};
      return overlay;
    };

    let ytPromptEl = null;
    const showYtPrompt = () => {
      return;   // YouTube inteqrasiyası yalnız sağ klik menyusundakı "YouTube seçimi" ilə olur.
      if (st.aiBatch) return;
      if (!ctx.youtube || !ctx.integrateYoutube || !st.aiSub || st.aiSub.integrated || st.aiSub.prompted) return;
      if (ytPromptEl && ytPromptEl.isConnected) return;
      const p = document.createElement("div");
      p.style.cssText = "flex-basis:100%;margin-top:5px;padding:7px 8px;border:1px solid #3a3a3f;border-radius:6px;background:#232326;color:#ddd;font:11px system-ui,sans-serif";
      const q = document.createElement("div"); q.textContent = "Bu alt yazı YouTube-a inteqrasiya edilsin?"; q.style.cssText = "margin-bottom:6px;color:#cfe0ff;font-weight:600";
      const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:6px";
      const mk = (t, primary, fn) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = t;
        b.style.cssText = "border:1px solid #555;border-radius:4px;padding:3px 9px;cursor:pointer;color:#eee;background:" + (primary ? "#1f9d55" : "#2b2b2f") + ";font:11px system-ui,sans-serif";
        b.onclick = ev => { ev.stopPropagation(); try { fn(); } finally { p.remove(); ytPromptEl = null; } };
        return b;
      };
      bar.append(
        mk("Hə", true, () => {
          st.aiSub.integrated = true; st.aiSub.prompted = true;
          if (ctx.integrateYoutube) ctx.integrateYoutube(st.aiSub);
          if (ctx.aiResults) { const it = ctx.aiResults.find(x => x && x.id === st.aiSub.id); if (it) { it.integrated = true; it.prompted = true; } }
          if (ctx.updateAiResult) ctx.updateAiResult(st.aiSub.id, { prompted: true, integrated: true });
        }),
        mk("Yox", false, () => {
          st.aiSub.prompted = true; st.aiSub.integrated = false;
          if (ctx.aiResults) { const it = ctx.aiResults.find(x => x && x.id === st.aiSub.id); if (it) { it.prompted = true; it.integrated = false; } }
          if (ctx.updateAiResult) ctx.updateAiResult(st.aiSub.id, { prompted: true, integrated: false });
        })
      );
      p.append(q, bar); wrap.append(p); ytPromptEl = p;
    };

    const subSelect = (label, cur, onOriginal, allowNone = true) => {
      const row = ui.ctl(wrap); row.className = "row meta ai-sub-row"; row.dataset.aiId = st.aiRunId || aiId; row._aiState = aiState;
      const lb = document.createElement("span"); lb.textContent = label + " ";
      const aiName = code => (typeof IDMAI !== "undefined" && IDMAI.langName ? IDMAI.langName(code) : String(code || ""));
      const STYLE_LABELS = { default: "Default", academic: "Akademik", colloquial: "Danışıq", simplified: "Sadələşdirilmiş" };
      const styleLabel = () => STYLE_LABELS[st.style] || "Default";

      const selCounts = () => {
        const ai = st.aiSel ? [...st.aiSel] : [];
        const orig = [...st.origSel].map(id => (subs || []).find(x => x.id === id)).filter(Boolean);
        const ready = ai.filter(c => st.aiSubs && st.aiSubs[c]).length;
        return { ai, orig, ready };
      };
      const currentLabel = () => {
        const { ai, orig, ready } = selCounts();
        const parts = [];
        if (orig.length) parts.push("Orjinal: " + orig.map((x, i) => (i + 1) + "." + langOnly(x.dlang || x.lang)).join(" "));
        if (ai.length) {
          const mark = ready >= ai.length ? " ✓" : ready ? ` (${ready}/${ai.length})` : "";
          parts.push("Sİ: " + ai.map((c, i) => (i + 1) + "." + langOnly(c)).join(" ") + mark);
        }
        if (st.dualSub && st.dualOn) parts.push("İkili: " + (orig.length + ai.length + 1) + ".");
        if (parts.length) return parts.join(" · ");
        if (st.aiSub && String(st.sub || "").startsWith("ai:")) return langOnly(st.aiSub.lang) + " ✓";
        return "Subtitr yoxdur";
      };

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "ai-sub-trigger";
      trigger.title = "Alt yazı seçimi";
      trigger.textContent = currentLabel();
      trigger.style.cssText = "flex:1;min-width:0;text-align:left;background:#2c2c2e;color:#eee;border:1px solid #4a4a4f;border-radius:4px;padding:3px 6px;cursor:pointer;font:11.5px/1.3 system-ui,sans-serif;overflow:hidden;white-space:normal;word-break:break-word";
      const refreshTrigger = () => { trigger.textContent = currentLabel(); trigger.disabled = aiState.running; };
      st.refreshLabel = refreshTrigger;
      try {
        attachTip(trigger, () => {
          const aiCodes = st.aiSel ? [...st.aiSel] : [];
          const orig = [...st.origSel].map(id => (subs || []).find(x => x.id === id)).filter(Boolean);
          const fields = [
            ["Orjinal", orig.map(subLangOnly).join(", ")],
            ["Sİ dilləri", aiCodes.map(langOnly).join(", ")],
            ["Üslub", styleLabel()],
            ["Sİ hazır", aiCodes.filter(c => st.aiSubs && st.aiSubs[c]).map(langOnly).join(", ")],
            ["İkili", st.dualSub ? "Hazır" : ""],
            ["Mənbə", st.sourceId ? (subs.find(x => x.id === st.sourceId) ? subLangOnly(subs.find(x => x.id === st.sourceId)) : "") : ""]
          ];
          return { kind: "s", title: currentLabel(), fields };
        }, document.body, 3000);
      } catch {}

      // Sağ klik menyusu: yalnız Sİ-yə aid "YouTube seçimi" qalır.
      // "Üslub" və "Stil" artıq Ayarlar → Alt yazı bölməsindədir.
      const styleMenu = (anchor, withYoutube = false) => {
        closeSubPanel();
        openSubPanel(anchor, panel => {
          if (!withYoutube) return;
          const y = document.createElement("button"); y.type = "button";
          const icon = () => st.ytStatus === "ok" ? " ✓" : st.ytStatus === "fail" ? " ✕" : "";
          y.textContent = "YouTube seçimi" + icon();
          y.style.cssText = "display:block;width:100%;text-align:left;border:0;background:transparent;color:#eee;padding:8px 10px;border-radius:4px;cursor:pointer;font:12px system-ui,sans-serif";
          y.onmouseenter = () => y.style.background = "#2c2c2e";
          y.onmouseleave = () => y.style.background = "transparent";
          y.onclick = async ev => {
            ev.stopPropagation();
            const list = [...st.aiSel].map(l => st.aiSubs && st.aiSubs[l]).filter(s => s && s.url);
            if (st.dualSub && st.dualSub.srt && st.dualOn) list.push(st.dualSub);
            if (!list.length || list.length !== st.aiSel.size + (st.dualSub && st.dualOn ? 1 : 0) || !ctx.integrateYoutubeAll) {
              st.ytStatus = "fail"; y.textContent = "YouTube seçimi ✕"; return;
            }
            let ok = false;
            try {
              const r = await ctx.integrateYoutubeAll(list);
              ok = !!(r && r.ok);
            } catch { ok = false; }
            st.ytStatus = ok ? "ok" : "fail";
            y.textContent = "YouTube seçimi" + (ok ? " ✓" : " ✕");
            if (ctx.updateAiResult) for (const s of list) ctx.updateAiResult(s.id, { prompted: true, integrated: ok });
          };
          panel.append(y);
        });
      };

      const mkCheck = (text, checked, disabled, onToggle, anchor, done, meta) => {
        const lab = document.createElement("label");
        lab.style.cssText = "display:flex;align-items:flex-start;gap:6px;padding:5px 7px;border-radius:4px;cursor:" + (disabled ? "not-allowed" : "pointer") + ";font:12px system-ui,sans-serif;color:" + (disabled ? "#777" : "#eee") + ";opacity:" + (disabled ? ".6" : "1");
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!checked; cb.disabled = !!disabled;
        cb.style.cssText = "margin:2px 0 0;flex:none;accent-color:#5ab0ff";
        const sp = document.createElement("span"); sp.textContent = text + (done ? " ✓" : "");
        sp.style.cssText = "flex:1;min-width:0;white-space:normal;word-break:break-word";
        lab.append(cb, sp);
        if (!disabled) {
          cb.addEventListener("change", () => { onToggle(cb.checked); refreshTrigger(); });
          lab.onmouseenter = () => lab.style.background = "#2c2c2e";
          lab.onmouseleave = () => lab.style.background = "transparent";
        }
        lab.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); });
        if (meta) { try { attachTip(lab, meta, document.body, 3000); } catch {} }
        return lab;
      };

      trigger.onclick = e => {
        e.stopPropagation();
        if (trigger.disabled) return;
        openSubPanel(trigger, panel => {
          const mkCat = (title, items) => {
            const b = document.createElement("button"); b.type = "button";
            b.style.cssText = "display:flex;width:100%;align-items:center;gap:6px;border:0;background:transparent;color:#eee;padding:7px 9px;border-radius:4px;cursor:pointer;font:12px system-ui,sans-serif;text-align:left";
            const txt = document.createElement("span"); txt.textContent = title; txt.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
            const arrow = document.createElement("span"); arrow.textContent = "▸"; arrow.style.cssText = "color:#999;flex:none";
            b.append(txt, arrow);
            b.onmouseenter = () => b.style.background = "#2c2c2e";
            b.onmouseleave = () => b.style.background = "transparent";
            const list = document.createElement("div");
            list.style.cssText = "display:none;margin:1px 0 4px 10px;padding-left:6px;border-left:1px solid #3a3a3f";
            b.onclick = ev => {
              ev.stopPropagation();
              const open = list.style.display === "block";
              list.style.display = open ? "none" : "block";
              arrow.textContent = open ? "▸" : "▾";
              if (panel._place) setTimeout(panel._place, 0);
            };
            for (const it of items) list.append(it);
            panel.append(b, list);
            return { b, list, arrow };
          };

          const origItems = [];
          if (!subs.length) origItems.push(mkCheck("Subtitr yoxdur", false, true, () => {}, trigger));
          for (const x of subs) {
            const meta = () => ({
              kind: "s", title: x.label || subLangOnly(x),
              fields: [
                ["Dil", langOnly(x.dlang || x.lang)],
                ["Növ", KIND[x.kind] || (x.translated ? "Avtomatik tərcümə" : (x.auto ? "Avtomatik" : "Manual"))],
                ["Sətir", x.cues ? fmtNum(x.cues) : ""],
                ["Format", subFmt(x)],
                ["Həcm", fmtSize(x.size)],
                ["Mənbə", x.translated ? "YouTube avto tərcümə" : (x.auto ? "YouTube avtomatik" : "Manual")],
                ["Tam etiket", x.label || ""]
              ]
            });
            origItems.push(mkCheck(subLangOnly(x) + subTypeSuffix(x), st.origSel.has(x.id), false, checked => {
              if (checked) st.origSel.add(x.id); else st.origSel.delete(x.id);
              st.sub = [...st.origSel][0] || "";
              st.ytStatus = "";
              saveSel();
            }, trigger, false, meta));
          }
          if (!noSubAi || subs.length) mkCat("Orjinal", origItems);

          const aiItems = [];
          let aiCat = null;
          const trBtn = document.createElement("button"); trBtn.type = "button";
          trBtn.style.cssText = "display:none;border:1px solid #5ab0ff;border-radius:4px;padding:2px 7px;cursor:pointer;background:#1f5f9d;color:#fff;font:700 11px system-ui,sans-serif;white-space:nowrap;flex:none";
          if (panel._headRight) panel._headRight.append(trBtn);
          const updateTranslate = () => {
            const open = !!(aiCat && aiCat.list.style.display === "block");
            trBtn.style.display = (open && st.aiSel.size > 0) ? "inline-flex" : "none";
            trBtn.textContent = "Tərcümə et" + (st.aiSel.size ? " (" + st.aiSel.size + ")" : "");
            trBtn.disabled = !st.aiSel.size || (!aiHasSub && !aiCanGenerate) || aiState.running || !ctx.ai;
            trBtn.style.opacity = trBtn.disabled ? ".55" : "1";
            trBtn.style.cursor = trBtn.disabled ? "not-allowed" : "pointer";
          };
          trBtn.onclick = ev => {
            ev.stopPropagation();
            if (trBtn.disabled) return;
            const targets = [...st.aiSel];
            if (!ctx.youtube && sourceCandidates().list.length) {
              closeSubPanel();
              openSourcePicker(targets, trigger);
              return;
            }
            closeSubPanel();
            runAiQueue(targets);
          };
          panel.addEventListener("click", () => setTimeout(updateTranslate, 0));
          if (ctx.ai && typeof IDMAI !== "undefined" && IDMAI.LANGUAGES) {
            for (const l of IDMAI.LANGUAGES) {
              const code = String(l.code || "").toLowerCase();
              const done = !!(st.aiSubs && st.aiSubs[code]);
              const meta = () => ({
                kind: "s", title: langOnly(code),
                fields: [
                  ["Dil", langOnly(code)],
                  ["Mənbə", "Sİ"],
                  ["Vəziyyət", done ? "Hazır" : "Tərcümə olunmayıb"],
                  ["Üslub", styleLabel()],
                  ["Kod", l.code]
                ]
              });
              aiItems.push(mkCheck(langOnly(code), st.aiSel.has(code), !aiHasSub && !aiCanGenerate, checked => {
                if (checked) st.aiSel.add(code); else st.aiSel.delete(code);
                st.aiBatch = st.aiSel.size > 1;
                st.ytStatus = "";
                saveSel();
                updateTranslate();
              }, trigger, done, meta));
            }
          } else {
            aiItems.push(mkCheck("AI modulu mövcud deyil", false, true, () => {}, trigger));
          }
          aiCat = mkCat("Sİ tərəfindən yaradılmış", aiItems);
          const dualRow = document.createElement("button");
          dualRow.type = "button";
          dualRow.textContent = "İkili dil" + (st.dualSub ? " ✓" : "");
          dualRow.title = "İki alt yazını üst və aşağı sətir kimi birləşdir";
          dualRow.style.cssText = "display:flex;width:100%;align-items:center;gap:6px;border:0;background:transparent;color:#eee;padding:7px 9px;border-radius:4px;cursor:pointer;font:12px system-ui,sans-serif;text-align:left";
          const dualSp = document.createElement("span"); dualSp.style.cssText = "flex:1"; dualSp.textContent = dualRow.textContent;
          const dualAr = document.createElement("span"); dualAr.textContent = "▸"; dualAr.style.cssText = "color:#999;flex:none";
          dualRow.textContent = ""; dualRow.append(dualSp, dualAr);
          dualRow.onmouseenter = () => dualRow.style.background = "#2c2c2e";
          dualRow.onmouseleave = () => dualRow.style.background = "transparent";
          dualRow.onclick = ev => { ev.stopPropagation(); closeSubPanel(); openDualDialog(trigger); };
          if (ctx.dual) panel.append(dualRow);
          updateTranslate();
        });
      };
      trigger.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); styleMenu(trigger, true); });

      const del = document.createElement("button");
      del.type = "button"; del.className = "ai-sub-del"; del.textContent = "×"; del.title = "Bütün AI alt yazılarını sil";
      const aiCount = () => Object.keys(st.aiSubs || {}).length + (st.dualSub ? 1 : 0);
      del.style.cssText = "flex:none;border:0;background:transparent;color:#ff8a8a;font:15px system-ui,sans-serif;cursor:pointer;padding:0 2px;display:" + (aiCount() ? "inline" : "none");
      del.onclick = ev => {
        ev.stopPropagation();
        const all = Object.values(st.aiSubs || {});
        const dual = st.dualSub;
        st.aiSubs = {}; st.aiSub = null; st.aiSel.clear(); st.aiBatch = false;
        st.dualSub = null; st.dualOn = false; st.dualTopId = ""; st.dualBottomId = "";
        st.sub = [...st.origSel][0] || "";
        if (ytPromptEl) { ytPromptEl.remove(); ytPromptEl = null; }
        if (dual && Array.isArray(ctx.aiResults)) {
          const di = ctx.aiResults.findIndex(x => x && x.id === dual.id);
          if (di >= 0) ctx.aiResults.splice(di, 1);
        }
        if (dual && ctx.removeAiResult) ctx.removeAiResult(dual);
        for (const sub of all) {
          if (ctx.aiResults) {
            const k = ctx.aiResults.findIndex(x => x && x.id === sub.id);
            if (k >= 0) ctx.aiResults.splice(k, 1);
          }
          if (ctx.removeAiResult) ctx.removeAiResult(sub);
        }
        saveSel();
        draw();
      };
      const prog = document.createElement("div"); prog.className = "ai-prog";
      const bar = document.createElement("div"); bar.className = "ai-bar"; const fill = document.createElement("i"); bar.append(fill);
      const foot = document.createElement("div"); foot.className = "ai-foot";
      const pct = document.createElement("span"); pct.className = "ai-pct"; pct.textContent = (aiState.count ? aiState.count + " · " : "") + Math.round(aiState.pct) + "%";
      const eta = document.createElement("span"); eta.className = "ai-eta"; eta.textContent = aiEtaText(aiState.eta);
      const msg = document.createElement("span"); msg.className = "ai-msg"; msg.textContent = aiState.text;
      foot.append(pct, eta, msg); prog.append(bar, foot);
      row.append(lb, trigger, del, prog);
      if (aiState.running || aiState.pct > 0) {
        prog.style.display = "block"; fill.style.width = Math.max(0, Math.min(100, aiState.pct)) + "%";
        pct.textContent = (aiState.count ? aiState.count + " · " : "") + Math.round(aiState.pct) + "%"; eta.textContent = aiEtaText(aiState.eta); msg.textContent = aiState.text;
        if (aiState.running) trigger.disabled = true;
      }
    };

    const audios = (src.audios || []).map(a => {
      const t = /^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(a.lang || "") ? langTag(a.lang) : "";
      const rest = String(a.label || "").replace(new RegExp("^" + String(a.lang || "").replace(/[^\w]/g, "\\$&") + "(\\s•\\s?|$)", "i"), "");
      return t ? { ...a, label: audioDesc(a.lang, a.name, rest) } : { ...a, label: a.label || audioDesc("", a.name, "") };
    });
    const aq = src.aq || [], afmts = (src.caps && src.caps.audioFormats) || [["best", "Orijinal"]];
    // Bərpa olunmuş seçimlər bu mənbədə hələ də mövcuddurmu? Yalnız itmiş seçim sıfırlanır.
    if (!modes.includes(st.mode)) st.mode = modes[0];
    if (st.audio && !audios.some(a => a.id === st.audio)) st.audio = "";
    if (st.aa && !audios.some(a => a.id === st.aa)) st.aa = "";
    // Çoxsəsli seçim: yalnız bu mənbədə mövcud id-lər qalır. İlk dəfə → "Orijinal" defolt seçilir.
    if (!Array.isArray(st.audioSel)) {
      const origA = audios.find(a => a.role === "orijinal") || audios.find(a => a.auto) || audios[0];
      st.audioSel = origA ? [origA.id] : [];
    } else {
      const before = st.audioSel.length;
      st.audioSel = st.audioSel.filter(id => audios.some(a => a.id === id));
      // Əvvəlki seçim bu mənbədə yoxdursa (başqa film) → yenə "Orijinal" defolt.
      if (before > 0 && !st.audioSel.length) {
        const origA = audios.find(a => a.role === "orijinal") || audios.find(a => a.auto) || audios[0];
        if (origA) st.audioSel = [origA.id];
      }
    }
    st.audio = st.audioSel[0] || "";
    st.audioUrl = (audios.find(a => a.id === st.audio) || {}).url || "";
    st.aaUrl = (audios.find(a => a.id === st.aa) || {}).url || "";
    if (!afmts.some(([v]) => v === st.afmt)) st.afmt = "best";
    if (st.aq && !BITRATES.includes(+st.aq)) st.aq = "";
    if (!["all", "60", "hdr", "60hdr"].includes(st.vf)) st.vf = "all";
    if (SUB_MODES.includes(st.mode) && st.mode !== "s" && !subs.length && modes.includes("va")) st.mode = "va";
    if (SUB_MODES.includes(st.mode) && st.sub && !subs.some(x => x.id === st.sub)) st.sub = defaultSub;
    const ffOn = !!(src.caps && src.caps.ffmpeg);
    const savedFmt = (sub, mode) => { const f = subFmt(sub); if (!f || !src.caps) return f; return mode === "s" ? (ffOn ? "SRT" : f) : (sub.src === "page" && ffOn ? "SRT" : f); };
    // Səs növü: orijinal rejimdə axının real kodek/konteyneri (+rol), seçilmiş formata çevriləndə hədəf format
    const tgt = () => String(st.afmt).toUpperCase() + (LOSSY.includes(st.afmt) ? (st.aq ? " " + st.aq + "k" : "") : "");
    const cvt = () => st.afmt === "best" ? "" : "çevrilir" + (LOSSY.includes(st.afmt) && st.aq ? " · " + st.aq + "k" : "");   // hədəf format sağ çipdədir
    const audType = q => st.afmt === "best" ? q.label : [q.role, tgt() + " (çevrilir)"].filter(Boolean).join(" • ");
    const select = (label, opts, cur, onChange) => {
      const row = ui.ctl(wrap), lb = document.createElement("span"), s = document.createElement("select");
      lb.textContent = label + " ";
      for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === cur) o.selected = true; s.append(o); }
      s.addEventListener("change", () => { onChange(s.value); saveSel(); });
      row.append(lb, s);
    };
    // Keyfiyyət filtri: real FPS/HDR məlumatı olan bütün mənbələr (YouTube + digər saytlar).
    // Dəqiq qaydalar: 60FPS və HDR bir-birini istisna edir; yalnız "60FPS+HDR" hər ikisini göstərir.
    const hdrOn = o => o.hdr === true || (!!o.hdr && !/^SDR$/i.test(String(o.hdr)));
    const fpsOf = o => (o.fps | 0) || (+(/(\d+(?:\.\d+)?)\s*FPS/i.exec(o.tag || "") || [])[1] || 0);
    const hasQ = (src.options || []).some(o => fpsOf(o) > 0 || hdrOn(o));
    const QFILTERS = [["all", "Bütün"], ["60", "Ancaq 60FPS"], ["hdr", "Ancaq HDR"], ["60hdr", "Ancaq 60FPS+HDR"]];
    const qok = o => {
      const f = fpsOf(o), hf = f >= 55 && f < 100, hd = hdrOn(o);
      if (st.vf === "60") return hf && !hd;
      if (st.vf === "hdr") return hd && !hf;
      if (st.vf === "60hdr") return hf && hd;
      return true;
    };
    const full = src.name || ctx.title || "", mkTip = (kind, fields) => ({ kind, title: full, fields: [...fields, ["Mənbə", hostOf(src.url || ctx.pageUrl)]] });
    const draw = () => {
      closeSubPanel();
      wrap.replaceChildren();
      if (header) ui.line(wrap, header.text, header.title, header.tip);
      // Mövcud audio və subtitr trekləri ayrıca göstərilir (heç biri uydurulmur)
      if (audios.length && st.mode !== "s") ui.line(wrap, "🔊 Audio (" + audios.length + "): " + audios.slice(0, 6).map(audioMetaLabel).join("  |  ") + (audios.length > 6 ? "  |  +" + (audios.length - 6) + " dil (Səs siyahısında)" : ""));
      if (modes.length > 1) select("Rejim:", modes.map(m => [m, MODE_NAMES[m]]), st.mode, v => { st.mode = v; draw(); });
      if (hasQ && ["va", "vas", "v"].includes(st.mode))
        select("Filtr:", QFILTERS, st.vf, v => { st.vf = v; draw(); });   // digər menyular kimi açılan dropdown
      if (["va", "vas"].includes(st.mode) && audios.length > 0) {
        // Kompakt "Səs" menyusu (rejim menyusu kimi açılır), içində çoxseçim + sıra nömrələri.
        const row = ui.ctl(wrap);
        row.style.cssText = "display:flex;align-items:center;gap:6px;min-width:0";
        const lb = document.createElement("span"); lb.textContent = "Səs:"; lb.style.cssText = "font:12px system-ui,sans-serif;color:#bbb;flex:none";
        const btn = document.createElement("button"); btn.type = "button";
        btn.style.cssText = "flex:1;min-width:0;text-align:left;background:#2a2a2e;color:#eee;border:1px solid #3a3a3f;border-radius:5px;padding:4px 8px;font:12px system-ui,sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        const ordSel = () => (Array.isArray(st.audioSel) ? st.audioSel : []).filter(id => audios.some(a => a.id === id));
        // Qısa etiket: yalnız bayraq + dil (subtitrlərdəki kimi). Tam meta hover-də göstərilir.
        const audioShort = a => {
          const lg = String((a && a.lang) || "").trim();
          if (lg && (langTag(lg) || AZ_LANG[lg.toLowerCase()] || langName(lg))) return langOnly(lg);
          const nm = String((a && (a.name || a.label)) || "").split(" · ")[0].trim();
          return nm || (a && a.role) || "Səs";
        };
        const audioTip = a => ({
          kind: "a", title: String((a && a.label) || audioShort(a)),
          fields: [
            ["Dil", (a && (langName(a.lang) || a.lang)) || ""],
            ["Rol", (a && a.role) || ""],
            ["Format", (a && a.type) || ""],
            ["Bitrate", a && a.abr ? a.abr + " kbps" : ""],
            ["Müddət", fmtDur(a && a.dur)],
            ["Həcm", a && a.size ? (a.est ? "~" : "") + fmtSize(a.size) : "bilinmir"]
          ]
        });
        const summary = () => {
          const sel = ordSel();
          if (!sel.length) return "Seçilməyib";
          return sel.map((id, i) => (i + 1) + ". " + audioShort(audios.find(a => a.id === id))).join("   ");
        };
        const paint = () => { btn.textContent = summary() + "  ▾"; btn.title = summary(); };
        paint();
        const setSel = () => {
          st.audio = st.audioSel[0] || "";
          st.audioUrl = (audios.find(x => x.id === st.audio) || {}).url || "";
        };
        btn.onclick = e => {
          e.stopPropagation();
          openSubPanel(btn, panel => {
            const hd = document.createElement("div");
            hd.textContent = "Səsi seç — seçim sırası ilə inteqrasiya olunur";
            hd.style.cssText = "padding:3px 6px 7px;color:#9a9aa2;font:11.5px system-ui,sans-serif";
            panel.append(hd);
            const body = document.createElement("div"); panel.append(body);
            const renderRows = () => {
              body.replaceChildren();
              const sel = ordSel();
              for (const a of audios) {
                const idx = sel.indexOf(a.id);
                const lab = document.createElement("label");
                lab.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:5px;cursor:pointer;font:12px system-ui,sans-serif;color:#eee";
                lab.onmouseenter = () => lab.style.background = "#2c2c2e";
                lab.onmouseleave = () => lab.style.background = "transparent";
                const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = idx >= 0;
                cb.style.cssText = "margin:0;flex:none;accent-color:#5ab0ff";
                const num = document.createElement("span");
                num.textContent = idx >= 0 ? String(idx + 1) : "";
                num.style.cssText = "flex:none;min-width:16px;height:16px;line-height:16px;text-align:center;border-radius:8px;font:700 10.5px system-ui,sans-serif;" + (idx >= 0 ? "background:#5ab0ff;color:#0b1220" : "");
                const sp = document.createElement("span"); sp.textContent = audioShort(a);
                sp.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
                try { attachTip(lab, audioTip(a), document.body, 2000); } catch {}
                cb.addEventListener("change", () => {
                  if (cb.checked) { if (!st.audioSel.includes(a.id)) st.audioSel.push(a.id); }
                  else st.audioSel = st.audioSel.filter(x => x !== a.id);
                  setSel(); saveSel(); paint(); renderRows();
                });
                lab.append(cb, num, sp); body.append(lab);
              }
            };
            renderRows();
          });
        };
        row.append(lb, btn);
      }
      if (st.mode === "a") {   // yalnız səs: ayrıca seçim, "Avto" yoxdur (hansı dilin yüklənəcəyi həmişə aydındır); dəyişəndə siyahı yenilənir
        if (!audios.some(a => a.id === st.aa)) st.aa = (audios[0] || {}).id || "";
        if (audios.length > 1) select("Səs dili:", audios.map(a => [a.id, audioMetaLabel(a)]), st.aa, v => { st.aa = v; st.aaUrl = (audios.find(a => a.id === v) || {}).url || ""; draw(); });
      }
      const showSubMenu = ctx.subsOn !== false && SUB_MODES.includes(st.mode) && (subs.length > 0 || !!ctx.ai);
      if (showSubMenu) {
        subSelect("Sub:", SUB_MODES.includes(st.mode) ? st.sub : "", v => {
          st.sub = v;
          if (v && !SUB_MODES.includes(st.mode)) st.mode = "vas";
          else if (!v && st.mode === "vas") st.mode = "va";
          aiState.running = false; aiState.pct = 0; aiState.text = ""; aiState.eta = null; saveSel(); draw();
        }, !!ctx.ai && st.mode !== "s");
        if (st.aiSub) showYtPrompt();
      }
      if (st.mode === "a") {
        select("Format:", afmts, st.afmt, v => { st.afmt = v; st.aq = ""; draw(); });
        if (LOSSY.includes(st.afmt)) {   // bitrate: mənbənin real bitrate-indən yüksək təklif olunmur
          const top = Math.max(0, ...aq.map(x => x.abr));
          const br = BITRATES.filter(b => !top || b <= top * 1.25);
          select("Keyfiyyət:", [["", "Ən yaxşı"], ...br.map(b => [String(b), b + " kbps"])], st.aq, v => { st.aq = v; });
        }
      }
      if (st.mode === "vas") {
        const row = ui.ctl(wrap), cb = document.createElement("input"), lb = document.createElement("label");
        cb.type = "checkbox"; cb.checked = st.keep; cb.addEventListener("change", () => { st.keep = cb.checked; saveSel(); });
        const cs = subs.find(x => x.id === st.sub), sf = cs ? savedFmt(cs, "vas") : "";
        lb.append(cb, " Subtitri ayrıca " + (sf ? sf + " " : "") + "faylı kimi də saxla"); lb.style.cssText = "display:flex;gap:4px;align-items:center;cursor:pointer";
        row.append(lb);
      }
      const get = (o, q) => () => payloadFor(src, o, st, ctx, subs, q);
      if (st.mode === "a" && src.caps && src.caps.audioSeparate === false) {   // səs videonun içindədir: ayrıca axın yoxdur
        const sizes = (src.options || []).map(o => o.size).filter(Boolean), mn = sizes.length ? Math.min(...sizes) : 0;
        ui.line(wrap, "⚠ Bu mənbədə ayrıca səs axını yoxdur: səs videonun içindədir. Ən kiçik keyfiyyətli video yüklənib ondan səs çıxarılacaq" +
          (mn ? " (~" + (mn > 1e9 ? (mn / 1e9).toFixed(2) + " GB" : Math.round(mn / 1e6) + " MB") + ")" : "") + ". Səs keyfiyyəti dəyişmir.");
      }
      if (st.mode === "a") {
        // seçilmiş səs diline uyğun real axınlar (başqa dilin axını göstərilmir); ayrıca axın siyahısı yoxdursa seçilmiş trek özü
        const cur = audios.find(x => x.id === st.aa);
        const list = audioRows(src, cur);
        if (!list.length) {
          const dd = fmtDur(cur && cur.dur);
          const szv = (src.caps && src.caps.audioSeparate === false) ? Math.min(Infinity, ...(src.options || []).map(o => o.size).filter(Boolean)) : (+(cur && cur.size) || 0);
          const sz = isFinite(szv) ? szv : 0;
          const fm = st.afmt !== "best" ? st.afmt.toUpperCase() : fmtOf(cur && cur.label, cur && cur.type);
          ui.addRow(wrap, "Audio", stripFmt((cur ? cur.label : audioDesc("", "", "")) + (cvt() ? " · " + cvt() : "") + (dd ? " · " + dd : ""), fm), sz, "", get(null, null),
            { fmt: fm, size: sz, est: cur && cur.est, url: (cur && cur.url) || src.url || ctx.pageUrl || "", kind: "a", name: cur ? cur.label : "", dur: cur && cur.dur, tip: mkTip("a", [["Format", fm], ["Müddət", dd], ["Həcm", ((cur && cur.est && sz) ? "~" : "") + (fmtSize(sz) || "bilinmir")]]) });
        }
        for (const q of list) {   // sol: dil/rol/bitrate; sağ: format + həcm (bütün növlərdə eyni)
          const conv = st.afmt !== "best", toks = String(q.label || "").split(" • ").filter(Boolean), cont = toks.find(t => isFmtTok(t) && !CODEC_FMT.test(t));   // cont: konteyner (MP4/M4A/WEBM) -> sağ çipə; AAC/OPUS kimi kodek başlıqda qalır
          const fm = conv ? st.afmt.toUpperCase() : (cont ? cont.toUpperCase() : fmtOf(q.type) || (toks.find(isFmtTok) || "").toUpperCase()), rest = toks.filter(x => x !== q.type && x !== cont && x.toUpperCase() !== fm).join(" • ");
          const qd = fmtDur(q.dur);
          ui.addRow(wrap, "Audio", stripFmt(audioDesc(q.lang, q.name, [rest, cvt()].filter(Boolean).join(" · ")) + (qd ? " · " + qd : ""), fm), q.size, "", get(null, q),
            { fmt: fm, size: q.size, est: q.est, url: q.url || src.url || ctx.pageUrl || "", kind: "a", name: q.label, dur: q.dur, tip: mkTip("a", [["Dil", langName(q.lang) || q.lang], ["Rol", q.role], ["Format", fm], ["Kodek", String(q.type || "").split("/")[0]], ["Bitrate", q.abr ? q.abr + " kbps" : ""], ["Müddət", fmtDur(q.dur)], ["Həcm", (q.est && q.size ? "~" : "") + (fmtSize(q.size) || "bilinmir")]]) });
        }
      } else if (st.mode === "s") {
        const sub = subs.find(x => x.id === st.sub);
        const sf = sub ? savedFmt(sub, "s") : "";
        const sz = sub ? sub.size || 0 : 0;   // sağ: format + ölçü (video/audio ilə eyni)
        const sd = sub ? fmtDur(sub.dur) : "";
        ui.addRow(wrap, "SUB", (sub ? stripFmt(sub.label, subFmt(sub) || fmtOf(sub.label)) : "subtitr") + (sd ? " · " + sd : ""), sz, sf ? "Saxlanma formatı: " + sf : "", get(null),
          { fmt: sub ? (subFmt(sub) || fmtOf(sub.label)) : "", size: sz, url: sub ? sub.url : (src.url || ctx.pageUrl || ""), kind: "s", name: sub ? sub.label : "subtitr", dur: sub && sub.dur, tip: mkTip("s", sub ? [["Dil", langName(sub.lang) || sub.lang], ["Növ", KIND[sub.kind] || ""], ["Sətir", sub.cues ? fmtNum(sub.cues) : ""], ["Format", subFmt(sub)], ["Müddət", fmtDur(sub.dur)], ["Saxlanma formatı", sf], ["Həcm", fmtSize(sz) || "bilinmir"]] : []) });
      } else {
        const qopts = (hasQ && st.vf !== "all") ? (src.options || []).filter(qok) : src.options;
        for (const o of qopts) {
          const sl = splitLabel(o.label), du = fmtDur(o.dur);
          sl.fmt = sl.fmt || (src.kind === "hls" || src.kind === "dash" ? src.kind.toUpperCase() : "");
          // FPS hər mənbədə etiketin yanında: helper tag-da yoxsa da o.fps-dən əlavə et
          const qf = fpsOf(o);
          const qtag = (qf && !/(?:^|\s)\d+(?:\.\d+)?\s*FPS\b/i.test(o.tag || ""))
            ? String(o.tag || "") + " " + Math.round(qf) + "FPS" : o.tag;
          ui.addRow(wrap, qtag, (sl.name || (sl.fmt && isFmtTok(o.label) ? "Video" : o.label)) + (du ? " · " + du : ""), o.size, src.url || o.label, get(o),
            { fmt: sl.fmt, size: o.size, est: o.est, url: o.url || src.url || ctx.pageUrl || "", kind: "v", name: qtag || o.label, dur: o.dur, tip: mkTip("v", [["Keyfiyyət", qtag], ["Format", sl.fmt], ["Kodek", sl.name !== o.label || !sl.fmt ? sl.name : ""],
              ["FPS", qf ? qf + " FPS" : ""], ["HDR", o.hdr ? (o.hdrLabel || "HDR") : ""], ["Müddət", du], ["Həcm", (o.est && o.size ? "~" : "") + (fmtSize(o.size) || "bilinmir")]]) });
        }
        if (hasQ && st.vf !== "all" && !qopts.length) ui.line(wrap, "⚠ Bu filtrə uyğun keyfiyyət yoxdur.");
      }
    };
    draw();
    return true;
  }


  // Qısa video lenti: "▶ Hazırda oxudulur" + "Əvvəl oxudulanlar" (bağlı; açılanda həmin video üçün api.group çağırılır, bağlıykən heç nə sorğulanmır)
  // res: {cur, prev}; api: { state, group(key), refresh() }; ui: renderSource ilə eyni adapter
  function renderFeed(parent, res, ctx, ui, api) {
    const st = api.state || (api.state = { open: new Set(), loaded: new Map() });
    const mk = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
    const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + " san əvvəl" : s < 3600 ? Math.round(s / 60) + " dəq əvvəl" : Math.round(s / 3600) + " saat əvvəl"; };
    const fill = (box, g) => {
      for (const w of g.warnings || []) ui.line(box, "⚠ " + w);
      const src = { options: g.options || [], audios: g.audios, subs: g.subs, aq: g.aq, caps: g.caps, strat: g.strat, url: g.url, kind: "page", name: g.name, referer: g.url, pageUrl: g.url };
      const ok = (g.options || []).length && renderSource(box, src, null, { pageUrl: g.url, title: g.name, subsOn: ctx.subsOn }, ui, []);
      for (const d of g.direct || []) {
        const fm = extFmt(d.name), au = /^(?:MP3|M4A|AAC|OGG|OPUS|FLAC|WAV|MKA)$/.test(fm);
        const fpsTag = (g.site === "telegram" || g.site === "whatsapp") ? "" : (d.fps ? " " + Math.round(d.fps) + "FPS" : "");
        const tg = (au ? "Audio" : "Video") + fpsTag;
        const dd = fmtDur(d.dur);
        // Tək axın (keyfiyyət siyahısı yoxdur): rejim menyusu (Video + Səs / Yalnız video / Yalnız səs) görünsün.
        // Səs yalnız "Yalnız səs" seçiləndə ayrıca sətir kimi çıxır (renderSource özü çəkir).
        if (!au && renderSource(box, directSource(d, tg, fm), null, { pageUrl: g.url, title: g.name, subsOn: ctx.subsOn }, ui, [])) continue;
        ui.addRow(box, tg, (rowTitle(d.name, { fmt: fm }, 34) || "Video") + (dd ? " · " + dd : ""), d.size, d.url, () => ({ item: { url: d.url, kind: d.kind || "file", name: d.name, size: d.size, est: d.est, referer: d.referer } }),
          { fmt: fm, size: d.size, est: d.est, url: d.url, kind: au ? "a" : "v", name: d.name, dur: d.dur, tip: { kind: au ? "a" : "v", title: g.name, fields: [["Fayl", d.name], ["Format", fm], ["FPS", d.fps ? Math.round(d.fps) + " FPS" : ""], ["Müddət", dd], ["Həcm", (d.est && d.size ? "~" : "") + (fmtSize(d.size) || "bilinmir")], ["Mənbə", hostOf(d.url)]] } });
      }
      if (!ok && !(g.direct || []).length) ui.line(box, "✗ " + (g.error || "Yüklənə bilən keyfiyyət tapılmadı"));
    };
    const cur = res.cur, head = mk("div", "display:flex;align-items:center;gap:6px;padding:6px 8px;font-weight:700;font-size:12px");
    const rb = mk("button", "background:#333;color:#eee;border:0;border-radius:4px;padding:2px 7px;cursor:pointer", "⟳");
    rb.title = "Cari videonu yenidən müəyyən et"; rb.dataset.role = "feed-refresh";
    rb.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); rb.disabled = true; api.refresh(); });
    head.append(mk("span", "flex:1", "▶ Hazırda oxudulur"), rb); parent.append(head);
    const nm = mk("div", "padding:2px 8px 4px;font-weight:600;font-size:12px", smartTitle(cur.name, 52)); parent.append(nm);
    attachTip(nm, { kind: "v", title: cur.name, fields: [["Sayt", cur.site], ["Mənbə", hostOf(cur.url)]] }, ui.tipRoot || document.body);
    const cbox = mk("div", ""); parent.append(cbox); fill(cbox, cur);
    if (!(res.prev || []).length) return true;
    parent.append(mk("div", "padding:8px 8px 2px;color:#999;font-size:11px;text-transform:uppercase", "Əvvəl oxudulanlar (" + res.prev.length + ")"));
    for (const p of res.prev) {
      const row = mk("div", "display:flex;gap:6px;align-items:center;padding:6px 8px;cursor:pointer;border-radius:6px"), arrow = mk("span", "flex:none;width:12px", st.open.has(p.key) ? "▾" : "▸");
      const name = mk("span", "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", smartTitle(p.name, 34)), body = mk("div", "padding-left:10px");
      row.dataset.key = p.key; row.append(arrow, name, mk("span", "flex:none;color:#999;font-size:11px", ago(p.time)));
      attachTip(name, { kind: "v", title: p.name, fields: [["Sayt", p.site], ["Oxudulub", ago(p.time)]] }, ui.tipRoot || document.body);
      body.style.display = st.open.has(p.key) ? "block" : "none";
      let busy = false, done = false;
      const load = async () => {
        if (done || busy) return; busy = true; body.replaceChildren(); ui.line(body, "Keyfiyyətlər yoxlanılır…");
        let g = st.loaded.get(p.key), err = "";
        if (!g) { const r = await Promise.resolve(api.group(p.key)).catch(() => null); g = r && r.ok !== false ? r.group : null; err = (r && r.error) || "xəta"; if (g && !g.error) st.loaded.set(p.key, g); }
        body.replaceChildren(); if (g) { fill(body, g); done = !g.error; } else ui.line(body, "✗ " + err);
        busy = false;
      };
      row.addEventListener("click", () => {
        const open = !st.open.has(p.key); open ? st.open.add(p.key) : st.open.delete(p.key);
        arrow.textContent = open ? "▾" : "▸"; body.style.display = open ? "block" : "none"; if (open) load();
      });
      parent.append(row, body);
      if (st.open.has(p.key)) load();
    }
    return true;
  }

  // ---- Sağ klik menyusu, URL əməliyyatları, GIF / kəsmə pəncərəsi
  const ctxCopy = async t => {
    try { if (navigator.clipboard && navigator.clipboard.writeText) return await navigator.clipboard.writeText(t); } catch {}
    try { const a = document.createElement("textarea"); a.value = t; a.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); } catch {}
  };
  const clock = s => { s = Math.max(0, Math.round(+s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0"); };
  let ROWMENU = null;
  let OUTSIDE_HD = null;
  const dropOutside = () => {
    if (OUTSIDE_HD) { try { document.removeEventListener("pointerdown", OUTSIDE_HD, true); } catch {} OUTSIDE_HD = null; }
  };
  const closeRowMenu = () => {
    dropOutside();
    if (ROWMENU) { try { ROWMENU.remove(); } catch {} ROWMENU = null; }
  };
  // Kənara klik: yalnız həqiqətən menyudan kənardırsa bağla. Köhnə menyunun
  // listener-i qalmır (əvvəl Sİ alt menyusunu vaxtından əvvəl bağlayırdı).
  const attachOutside = m => {
    dropOutside();
    OUTSIDE_HD = e => {
      try {
        if (!m.isConnected) { closeRowMenu(); return; }
        const tg = e.target;
        if (m.contains(tg)) return;
        if (tg && tg.closest && tg.closest(".idm-row-menu, .idm-si-menu")) return;
        closeRowMenu();
      } catch {}
    };
    setTimeout(() => document.addEventListener("pointerdown", OUTSIDE_HD, true), 0);
  };
  // ---- Menyular: yalnız data atributları + mərkəzi delegasiya (dinamik DOM üçün) ----
  function openRowMenu(x, y, info, handlers, reopen) {
    closeRowMenu();
    const m = document.createElement("div");
    m.className = "idm-row-menu";
    m.style.cssText = "position:fixed;z-index:2147483647;min-width:205px;background:#1c1c1e;color:#eee;border:1px solid #3a3a3f;border-radius:7px;padding:4px;box-shadow:0 8px 30px #000a;font:12px system-ui,sans-serif";
    m.__ctx = { info: info || {}, handlers: handlers || {}, x, y, reopen };
    const add = (act, label, danger) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "row-menu-item"; b.dataset.act = act; b.textContent = label;
      b.style.cssText = "display:block;width:100%;text-align:left;border:0;background:transparent;color:" + (danger ? "#ff8a8a" : "#eee") + ";padding:7px 10px;border-radius:4px;cursor:pointer;font:12px system-ui,sans-serif";
      b.onmouseenter = () => b.style.background = "#2c2c2e";
      b.onmouseleave = () => b.style.background = "transparent";
      m.append(b);
    };
    add("copy", "🔗 URL Kopyala");
    add("share", "📤 URL Paylaş");
    add("saveAs", "💾 Fərqli Saxla");
    const _iu = String((info && info.url) || ""), _ik = String((info && info.kind) || "");
    if (/^https?:/i.test(_iu) && !/^s$/.test(_ik) && !/^a$/.test(_ik) && !/\.(?:vtt|srt|ass|ssa|ttml|dfxp)(?:[?#]|$)/i.test(_iu))
      add("audioOnly", "🎵 Yalnız səs");
    if (handlers && (handlers.siFeature || handlers.si)) add("si", "🧠 Sİ (AI) ›");
    add("cut", "✂ Kəs", true);
    document.body.append(m);
    const vw = innerWidth, vh = innerHeight, r = m.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(vw - r.width - 6, x)) + "px";
    m.style.top = Math.max(6, Math.min(vh - r.height - 6, y)) + "px";
    ROWMENU = m;
    attachOutside(m);
    setTimeout(() => document.addEventListener("keydown", e => { if (e.key === "Escape") closeRowMenu(); }, { once: true }), 0);
  }

  // Sİ alt menyusu — extension-un öz menyu dizaynı (mode/audio panelləri ilə eyni üslub).
  function openSiSubmenu(x, y, info, handlers) {
    closeRowMenu();
    const m = document.createElement("div");
    m.className = "idm-si-menu";
    m.style.cssText = "position:fixed;z-index:2147483647;width:290px;max-height:62vh;overflow:auto;background:#1c1c1e;color:#eee;border:1px solid #3a3a3f;border-radius:7px;padding:4px;box-shadow:0 8px 30px #000a;font:12px system-ui,sans-serif";
    m.__ctx = { info: info || {}, handlers: handlers || {}, x, y };
    const head = document.createElement("div");
    head.textContent = "Sİ — AI xüsusiyyətləri";
    head.style.cssText = "color:#cfe0ff;font-weight:700;font-size:11px;padding:6px 10px 5px;letter-spacing:.02em";
    m.append(head);
    const F = (typeof window !== "undefined" && window.IDM_AI_FEATURES) || null;
    const feats = (F && F.FEATURES) || [];
    feats.forEach((f, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "si-menu-item ai-submenu-item";
      b.dataset.feature = f.id;
      b.dataset.featureId = String(idx + 1);
      b.title = f.desc || "";
      b.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;color:#eee;padding:7px 10px;border-radius:4px;cursor:pointer;font:12px system-ui,sans-serif";
      const nm = document.createElement("span"); nm.textContent = f.name;
      nm.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      const tag = document.createElement("span"); tag.textContent = f.mode;
      tag.style.cssText = "flex:none;font-size:9.5px;font-weight:700;color:#cfe0ff;background:" + (f.mode === "B" ? "#3a2f46" : "#33405c") + ";border-radius:3px;padding:1px 5px";
      b.append(nm, tag);
      b.onmouseenter = () => b.style.background = "#2c2c2e";
      b.onmouseleave = () => b.style.background = "transparent";
      m.append(b);
    });
    document.body.append(m);
    const vw = innerWidth, vh = innerHeight, r = m.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(vw - r.width - 6, x)) + "px";
    m.style.top = Math.max(6, Math.min(vh - r.height - 6, y)) + "px";
    ROWMENU = m;
    attachOutside(m);
    setTimeout(() => document.addEventListener("keydown", e => { if (e.key === "Escape") closeRowMenu(); }, { once: true }), 0);
  }

  function bindRowMenu(row, infoFn, handlers) {
    if (!row) return;
    row.__menu = { infoFn, handlers };
    row.setAttribute("data-idm-row", "");
  }

  // Diaqnostika: son hadisələr (panel göstərir, konsolda da var).
  window.__SI_BUILD = "2026-11-05.9";
  window.__SI_LOG = window.__SI_LOG || [];
  const siLog = (msg) => {
    try { window.__SI_LOG.push(new Date().toISOString().slice(11, 19) + " " + msg); if (window.__SI_LOG.length > 30) window.__SI_LOG.shift(); } catch {}
  };
  siLog("delegation init");

  // Tək (bir dəfə) qurulan mərkəzi delegasiya: dinamik yaradılan bütün menyular üçün.
  function installMenuDelegation() {
    if (typeof document === "undefined" || window.__idmMenuDelegation) return;
    window.__idmMenuDelegation = true;
    document.addEventListener("contextmenu", e => {
      const row = e.target && e.target.closest ? e.target.closest("[data-idm-row]") : null;
      if (!row || !row.__menu) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const ctx = row.__menu;
        const info = ctx.infoFn ? (ctx.infoFn() || {}) : {};
        const reopen = () => openRowMenu(e.clientX, e.clientY, info, ctx.handlers, reopen);
        openRowMenu(e.clientX, e.clientY, info, ctx.handlers, reopen);
      } catch (err) {
        console.error("[AI-Extension Error]: row context menu failed", err);
      }
    }, true);

    // Alt menyu bəndi klikini "kənara klik" bağlayıcısından ƏVVƏL tut (pointerdown
    // capture) — element silinsə belə feature işə düşür.
    const runFeatureClick = (ctx, id) => {
      closeRowMenu();
      try {
        if (!id) { console.error("[AI-Extension Error]: feature id boşdur"); return; }
        if (ctx.handlers && typeof ctx.handlers.siFeature === "function") ctx.handlers.siFeature(ctx.info || {}, id);
        else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: "siOpenFeature", featureId: id }).catch(() => {});
        } else {
          console.error("[AI-Extension Error]: Sİ feature handler yoxdur:", id);
        }
      } catch (err) {
        console.error("[AI-Extension Error]: Sİ feature klik xətası", err);
      }
      (function watch(n) {
        setTimeout(() => {
          try {
            const host = document.getElementById("siHost");
            if (document.querySelector(".si-root") || (host && !host.hidden)) return;
            if (n > 0) return watch(n - 1);
            console.error("[AI-Extension Error]: panel görünmədi — AI tabı açılır");
            if (chrome && chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage({ type: "siOpenFeature", featureId: id }).catch(() => {});
          } catch {}
        }, 350);
      })(8);
    };

    document.addEventListener("pointerdown", e => {
      const tgt = e.target;
      if (!tgt || !tgt.closest) return;
      const el = tgt.closest(".ai-submenu-item, .idm-si-menu .si-menu-item");
      if (!el || !el.closest(".idm-si-menu")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const menu = el.closest(".idm-si-menu");
      const ctx = (menu && menu.__ctx) || {};
      const id = el.getAttribute("data-feature") || "";
      siLog("feature pointerdown: " + id + " (#" + (el.dataset.featureId || "?") + ")");
      runFeatureClick(ctx, id);
    }, true);

    document.addEventListener("click", e => {
      const tgt = e.target;
      if (!tgt || !tgt.closest) return;
      const feat = tgt.closest(".idm-si-menu .si-menu-item");
      if (feat) {
        e.preventDefault(); e.stopPropagation();
        const menu = feat.closest(".idm-si-menu");
        const ctx = (menu && menu.__ctx) || {};
        const id = feat.getAttribute("data-feature");
        siLog("feature klik: " + id);
        runFeatureClick(ctx, id);
        return;
      }
      const act = tgt.closest(".idm-row-menu .row-menu-item");
      if (act) {
        e.preventDefault(); e.stopPropagation();
        const menu = act.closest(".idm-row-menu");
        const ctx = (menu && menu.__ctx) || {};
        const name = act.getAttribute("data-act");
        const info = ctx.info || {};
        const handlers = ctx.handlers || {};
        closeRowMenu();
        try {
          if (name === "copy") {
            ctxCopy(info.url || "").then(() => handlers.notify && handlers.notify("URL kopyalandı"));
          } else if (name === "share") {
            if (handlers.share) handlers.share(info);
            else ctxCopy(info.url || "").then(() => handlers.notify && handlers.notify("URL kopyalandı"));
          } else if (name === "si") {
            siLog("row: Sİ klik");
            openSiSubmenu(ctx.x, ctx.y, info, handlers);
            // Alt menyu sinxron yaradılır: dərhal yoxla, timer qurma (popup bağlanmasın).
            try {
              if (!document.querySelector(".idm-si-menu")) {
                siLog("Sİ alt menyusu açılmadı → AI tabı");
                if (chrome && chrome.runtime) chrome.runtime.sendMessage({ type: "siOpenFeature", featureId: "" }).catch(() => {});
              }
            } catch {}
          } else if (typeof handlers[name] === "function") {
            handlers[name](info, ctx.reopen);
          } else {
            console.error("[AI-Extension Error]: row action handler yoxdur:", name);
          }
        } catch (err) {
          console.error("[AI-Extension Error]: row action xətası", name, err);
        }
      }
    }, true);
  }
  installMenuDelegation();

  function openCutDialog(o) {
    const old = document.getElementById("idm-cut-dialog"); if (old) old.remove();
    const total = +o.duration || 0;
    const wrap = document.createElement("div"); wrap.id = "idm-cut-dialog";
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#0008;display:flex;align-items:center;justify-content:center;font:13px system-ui,sans-serif";
    const box = document.createElement("div");
    box.style.cssText = "width:min(500px,94vw);background:#1c1c1e;color:#eee;border:1px solid #444;border-radius:10px;padding:14px;box-shadow:0 12px 50px #000b";
    const h = document.createElement("div"); h.textContent = "✂ Kəs — " + (o.name || "media"); h.style.cssText = "font-weight:700;margin-bottom:5px;word-break:break-word";
    const sub = document.createElement("div"); sub.textContent = "Ümumi müddət: " + (total > 0 ? clock(total) : "bilinmir") + " · Rəqəmsal dəqiqə/saniyə daxil edin";
    sub.style.cssText = "color:#aaa;margin-bottom:10px;font-size:11px";
    const fields = document.createElement("div"); fields.style.cssText = "display:grid;grid-template-columns:60px 70px 60px 70px;gap:6px;align-items:center;margin-bottom:8px";
    const mk = (lab, val, max) => {
      const w = document.createElement("label"); w.style.cssText = "display:flex;flex-direction:column;gap:3px;color:#bbb;font-size:11px";
      const span = document.createElement("span"); span.textContent = lab;
      const i = document.createElement("input"); i.type = "number"; i.min = "0"; i.step = "1"; i.value = String(Math.max(0, Math.floor(val || 0)));
      i.style.cssText = "background:#2c2c2e;color:#eee;border:1px solid #555;border-radius:4px;padding:5px;width:100%;font:13px system-ui";
      i.addEventListener("input", () => { i.value = i.value.replace(/[^0-9]/g, ""); if (max != null && i.value && +i.value > max) i.value = String(max); validate(); });
      w.append(span, i); return { w, i };
    };
    const sm = mk("Baş. dəq", 0), ss = mk("Baş. san", 0, 59), em = mk("Son dəq", Math.floor(total / 60)), es = mk("Son san", Math.floor(total % 60), 59);
    fields.append(sm.w, ss.w, em.w, es.w); 
    const err = document.createElement("div"); err.style.cssText = "color:#ff8a8a;font-size:11px;min-height:16px;margin:4px 0";
    const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:7px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px";
    const btn = (t, fn, primary) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.style.cssText = "border:1px solid #555;border-radius:5px;padding:6px 10px;cursor:pointer;color:#eee;background:" + (primary ? "#1f9d55" : "#2b2b2f") + ";font:12px system-ui"; b.onclick = fn; return b; };
    const read = () => {
      const a = (+sm.i.value || 0) * 60 + (+ss.i.value || 0), b = (+em.i.value || 0) * 60 + (+es.i.value || 0);
      return { start: a, end: b };
    };
    const validate = () => {
      const { start, end } = read(); let msg = "";
      if (!(total > 0)) msg = "Medianın ümumi müddəti bilinmir; kəsmək mümkün deyil.";
      else if ((+ss.i.value || 0) > 59 || (+es.i.value || 0) > 59) msg = "Saniyə 0–59 aralığında olmalıdır.";
      else if (!(end > start)) msg = "Son nöqtə başlanğıcdan böyük olmalıdır.";
      else if (end > total + 0.001) msg = "Son nöqtə medianın ümumi müddətindən böyük ola bilməz (" + clock(total) + ").";
      err.textContent = msg;
      for (const b of actions) b.disabled = !!msg;
      return !msg ? { start, end } : null;
    };
    // Yüklə = default qovluğa lossless kəsilmiş hissə; Fərqli Saxla = ad/qovluq seçimi ilə eyni lossless cut.
    const run = saveAs => () => { const r = validate(); if (!r) return; wrap.remove(); (saveAs ? o.onSaveAs : o.onDownload)({ ...r, saveAs }); };
    const actions = [btn("Yüklə", run(false), true), btn("Fərqli Saxla", run(true)), btn("Ləğv et", () => { wrap.remove(); o.onCancel && o.onCancel(); })];
    bar.append(actions[2], actions[1], actions[0]);
    box.append(h, sub, fields, err, bar); wrap.append(box); document.body.append(wrap);
    validate();
  }
  function openSaveTarget(o) {
    const old = document.getElementById("idm-save-dialog"); if (old) old.remove();
    const ext = String(o.ext || "").replace(/^\./, "");
    const wrap = document.createElement("div"); wrap.id = "idm-save-dialog";
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#0008;display:flex;align-items:center;justify-content:center;font:13px system-ui,sans-serif";
    const box = document.createElement("div"); box.style.cssText = "width:min(500px,94vw);background:#1c1c1e;color:#eee;border:1px solid #444;border-radius:10px;padding:14px;box-shadow:0 12px 50px #000b";
    const h = document.createElement("div"); h.textContent = "💾 Fərqli Saxla — " + (o.name || "media"); h.style.cssText = "font-weight:700;margin-bottom:8px;word-break:break-word";
    const fname = document.createElement("input"); fname.type = "text"; fname.value = o.name || "media";
    fname.style.cssText = "width:100%;background:#2c2c2e;color:#eee;border:1px solid #555;border-radius:5px;padding:7px;font:13px system-ui";
    const folder = document.createElement("input"); folder.type = "text"; folder.placeholder = "Qovluq (boş = standart yükləmə qovluğu)"; folder.value = o.folder || "";
    folder.style.cssText = fname.style.cssText + ";margin-top:7px";
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:7px;align-items:center;margin-top:8px";
    const err = document.createElement("div"); err.style.cssText = "color:#ff8a8a;font-size:11px;min-height:16px;margin:6px 0";
    const cleanName = () => {
      let name = fname.value.trim(); if (!name) { err.textContent = "Fayl adı boşdur"; return ""; }
      if (ext && !new RegExp("\\." + ext + "$", "i").test(name)) name += "." + ext;
      return name;
    };
    const pick = btn(o.onPickSave ? "📁 Qovluq seç və başla" : "📁 Qovluq seç", async () => {
      // Popup native dialoq açılanda bağlana bilər. Ona görə qovluq seçimi + işə salma
      // tək background→helper sorğusunda gedir; popup bağlansa da yükləmə davam edir.
      if (o.onPickSave) {
        const name = cleanName(); if (!name) return;
        wrap.remove(); o.onPickSave(name); return;
      }
      pick.disabled = true;
      try { const r = await o.pick(); if (r && r.ok && r.path) folder.value = r.path; else if (r && r.error) err.textContent = r.error; }
      catch (e) { err.textContent = String(e.message || e); }
      pick.disabled = false;
    });
    const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:7px;justify-content:flex-end;margin-top:6px";
    const save = btn("Saxla və yüklə", () => {
      const name = cleanName(); if (!name) return;
      const dir = folder.value.trim().replace(/\/+$/, "");
      const target = dir ? dir + "/" + name : name;
      wrap.remove(); o.onSave(target);
    }, true);
    const cancel = btn("Ləğv et", () => { wrap.remove(); o.onCancel && o.onCancel(); });
    function btn(t, fn, primary) { const b = document.createElement("button"); b.type="button"; b.textContent=t; b.style.cssText="border:1px solid #555;border-radius:5px;padding:6px 10px;cursor:pointer;color:#eee;background:"+(primary?"#1f9d55":"#2b2b2f")+";font:12px system-ui"; b.onclick=fn; return b; }
    row.append(folder, pick); bar.append(cancel, save);
    box.append(h, fname, row, err, bar); wrap.append(box); document.body.append(wrap);
    setTimeout(() => { try { fname.focus(); } catch {} }, 20);
  }

  function makeContextHandlers(send, notify) {
    const call = (action, info, extra) => {
      const payload = info.payload || { item: { url: info.url, kind: info.kind || "file", name: info.name || "video" } };
      return Promise.resolve(send({ type: "ctxAction", action, url: info.url, name: info.name, kind: info.kind, payload, ...(extra || {}) })).catch(e => ({ ok: false, error: String(e.message || e) }));
    };
    const extFor = info => {
      const k = info.kind || "", nm = info.name || "", u = info.url || "";
      if (/gif/i.test(nm)) return "gif";
      if (k === "s" || /\.(?:vtt|srt|ass|ssa|ttml|dfxp)(?:[?#]|$)/i.test(u)) return "vtt";
      if (k === "a" || /\.(?:m4a|mp3|opus|flac|wav|ogg|aac)(?:[?#]|$)/i.test(u)) return "m4a";
      const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(u || nm); return m ? m[1].toLowerCase() : "mp4";
    };
    const saveTarget = (info, onSave, extOverride, onPickSave) => openSaveTarget({
      name: info.name || "media", ext: extOverride || extFor(info), pick: () => call("pickDir", info),
      onSave: t => onSave(t), onPickSave: onPickSave || null, onCancel: () => notify("Ləğv edildi")
    });
    const share = info => {
      const url = String(info.url || "");
      if (!/^https?:/i.test(url)) return Promise.resolve(notify("✗ URL mövcud deyil"));
      let native;
      try {
        native = (typeof navigator !== "undefined" && typeof navigator.share === "function")
          ? Promise.resolve(navigator.share({ title: info.name || "Media", url })).then(() => ({ ok: true, nav: true }))
          : Promise.reject({ name: "NotSupported" });
      } catch (e) { native = Promise.reject(e); }
      return native.catch(e => {
        if (e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")))) return { ok: true, canceled: true };
        return call("share", info);
      }).then(r => {
        if (r && r.ok && r.canceled) return notify("Ləğv edildi");
        if (r && r.ok) return notify(r.nav ? "✓ Sistem paylaşma menyusu açıldı" : "✓ Sistem paylaşma menyusu açıldı");
        return ctxCopy(url).then(() => notify("✗ " + ((r && r.error) || "Paylaşma menyusu açılmadı") + " · URL kopyalandı"));
      }).catch(e => ctxCopy(url).then(() => notify("✗ Paylaşma alınmadı · URL kopyalandı")));
    };
    const basePayload = info => {
      const p = info.payload || {};
      const it = p.item || {};
      return {
        ...p,
        item: { ...it, url: it.url || info.url || "", kind: it.kind || info.kind || "file", name: it.name || info.name || "media" },
        extra: { ...(p.extra || {}) }
      };
    };
    const doDownload = (info, extra) => {
      const p = basePayload(info);
      return send({ type: "download", ...p, ...(extra || {}) })
        .then(r => notify(r && r.ok ? "✓ Yükləmə panelinə əlavə edildi" : "✗ " + ((r && r.error) || "xəta")))
        .catch(e => notify("✗ " + String(e && e.message || e)));
    };
    return {
      notify,
      share,
      saveAs: info => saveTarget(info,
        t => doDownload(info, { target: t }),
        null, null),
      audioOnly: info => {
        const p = basePayload(info);
        return doDownload(info, { format: "", label: "Audio", extra: { ...p.extra, mode: "a", audioFormat: p.extra.audioFormat || "best" } });
      },
      cut: async (info, reopen) => {
        let d = +info.duration || 0;
        if (!(d > 0)) { notify("Müddət yoxlanılır…"); const r = await call("duration", info); d = +(r && r.duration) || 0; }
        if (!(d > 0)) { notify("✗ Medianın müddəti bilinmir"); return; }
        const make = (start, end, target) => {
          const p = basePayload(info), ex = p.extra || {};
          const base = String(info.name || p.item.name || "klip").replace(/\.[a-z0-9]{2,5}$/i, "");
          const body = {
            url: p.item.url, kind: p.item.kind || info.kind || "file", name: base + " (kəsilmiş)",
            pageUrl: p.item.pageUrl || "",
            mode: p.mode || "va", format: p.format || "", label: p.label || "",
            audioTracks: ex.audioTracks || [], audioNone: !!ex.audioNone, audioDefault: !!ex.audioDefault,
            subLang: ex.subLang || "", subAuto: !!ex.subAuto, subAll: !!ex.subAll,
            extSubs: ex.extSubs || [], aiSubs: ex.aiSubs || [], audioFormat: ex.audioFormat || "best",
            audioQuality: ex.audioQuality || "", strat: ex.strat || "",
            subs: /s/.test(p.mode || "") || (ex.extSubs || []).length > 0,
            segments: [{ start, end }]
          };
          if (target) body.target = target;
          return send({ type: "segmentCut", payload: body })
            .then(r => notify(r && r.ok ? "✓ Kəsmə yükləmə panelinə əlavə edildi" : "✗ " + ((r && r.error) || "xəta")))
            .catch(e => notify("✗ " + String(e && e.message || e)));
        };
        openCutDialog({ name: info.name, duration: d, onCancel: reopen,
          onDownload: r => make(r.start, r.end, ""),
          onSaveAs: r => saveTarget(info, t => make(r.start, r.end, t), "mkv", null) });
      }
    };
  }
  // Media state-in "görünüş imzası": yalnız seçimləri dəyişən sahələr (ölçü/est daxil deyil).
  // UI bununla eyni məzmunu təkrar çəkmir -> menyu "gedib-gəlmir", seçimlər itmir.
  function sigOf(r) {
    if (!r || r.ok === false) return "err:" + ((r && r.error) || "");
    const o = (r.options || []).map(x => [x.id || "", x.selector || "", x.tag || ""].join("|")).join(";");
    const a = (r.audios || []).map(x => x.id).join(",");
    const s = (r.subs || []).map(x => x.url || x.lang || x.id).join(",");
    const ps = (r.pageSubs || []).map(x => x.url || x.lang).join(",");
    const it = (r.items || []).map(x => (x.options || []).map(y => y.selector || y.id).join(",")).join(";");
    return [r.pageUrl || "", r.feed ? "feed:" + (r.cur || "") : "", o, a, s, ps, it].join("#");
  }
  const subPanelOpen = () => !!SUBPANEL;   // istifadəçi alt yazı panelindədirsə UI yenilənməsini təxirə salmaq üçün
  const api = { sigOf, subPanelOpen, langTag, langName, langOnly, langFlag, audioDesc, audioRows, audioMetaLabel, MODE_NAMES, SUB_MODES, subEntries, availableModes, payloadFor, directSource, renderSource, renderFeed, fmtDur, fmtBytes, pageSub, fmtSize, hostOf, splitLabel, extFmt, fmtOf, stripFmt, rowTitle, smartTitle, metaEl, attachTip, videoFps, bindRowMenu, makeContextHandlers, openCutDialog, openSaveTarget };
  if (typeof module !== "undefined") module.exports = api;
  else window.IDMShared = api;
})();
