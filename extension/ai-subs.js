// AI subtitle core: language/priority selection, subtitle parsing, chunked Gemini translation.
// Kept independent of the download and sniffing engines. Never stores or logs API keys.
(() => {
  const API = "https://generativelanguage.googleapis.com/v1beta";
  const PRIORITY = ["en", "ru", "de", "fr", "tr"];
  // Bütün ikili alt yazıların ölçüsü: yalnız bu rəqəmi dəyişin.
  const DUAL_FONT_SIZE = 48;
  const STYLE_RULES = {
    default: "",
    academic: "Use a formal academic register. Ensure impeccable grammar and orthography, precise terminology and official-style wording. Do not change meaning.",
    colloquial: "Use natural, fluent conversational language like a native speaker. Preserve idioms and lively spoken-style expressions. Do not change meaning.",
    simplified: "Explain complex topics like a teacher speaking to a general audience. Replace difficult terms and complex sentences with simple, universally understandable language. Do not change meaning."
  };

  // Target languages for the per-stream AI Subtitle menu. Keep the code order stable.
  const LANGUAGES = [
    ["ab", 'Abkhaz'],     ["af", 'Afrikaans'],     ["sq", 'Albanian'],     ["de", 'German'],
    ["am", 'Amharic'],     ["av", 'Avar'],     ["az", 'Azerbaijani'],     ["ba", 'Bashkir'],
    ["eu", 'Basque'],     ["be", 'Belarusian'],     ["bn", 'Bengali'],     ["my", 'Burmese'],
    ["bg", 'Bulgarian'],     ["bs", 'Bosnian'],     ["ce", 'Chechen'],     ["cs", 'Czech'],
    ["zh-CN", 'Simplified Chinese (Mandarin)'],     ["zh-TW", 'Traditional Chinese'],     ["cv", 'Chuvash'],     ["da", 'Danish'],
    ["hy", 'Armenian'],     ["ar", 'Arabic'],     ["eo", 'Esperanto'],     ["et", 'Estonian'],
    ["fa", 'Persian'],     ["fi", 'Finnish'],     ["fr", 'French'],     ["fy", 'Frisian'],
    ["gag", 'Gagauz'],     ["gl", 'Galician'],     ["kk", 'Kazakh'],     ["ky", 'Kyrgyz'],
    ["gu", 'Gujarati'],     ["ka", 'Georgian'],     ["ha", 'Hausa'],     ["hi", 'Hindi'],
    ["nl", 'Dutch'],     ["hr", 'Croatian'],     ["ig", 'Igbo'],     ["id", 'Indonesian'],
    ["en", 'English'],     ["ga", 'Irish'],     ["is", 'Icelandic'],     ["es", 'Spanish'],
    ["sv", 'Swedish'],     ["it", 'Italian'],     ["he", 'Hebrew'],     ["kn", 'Kannada'],
    ["yue", 'Cantonese'],     ["ca", 'Catalan'],     ["ko", 'Korean'],     ["ku", 'Kurdish'],
    ["km", 'Khmer'],     ["lo", 'Lao'],     ["la", 'Latin'],     ["lv", 'Latvian'],
    ["lez", 'Lezgian'],     ["lt", 'Lithuanian'],     ["lb", 'Luxembourgish'],     ["hu", 'Hungarian'],
    ["mk", 'Macedonian'],     ["mg", 'Malagasy'],     ["ms", 'Malay'],     ["ml", 'Malayalam'],
    ["mt", 'Maltese'],     ["mr", 'Marathi'],     ["mn", 'Mongolian'],     ["ne", 'Nepali'],
    ["no", 'Norwegian'],     ["uz", 'Uzbek'],     ["pa", 'Punjabi'],     ["pl", 'Polish'],
    ["pt", 'Portuguese'],     ["ps", 'Pashto'],     ["ro", 'Romanian'],     ["ru", 'Russian'],
    ["sa", 'Sanskrit'],     ["sr", 'Serbian'],     ["si", 'Sinhala'],     ["sk", 'Slovak'],
    ["sl", 'Slovenian'],     ["so", 'Somali'],     ["sw", 'Swahili'],     ["su", 'Sundanese'],
    ["sn", 'Shona'],     ["tg", 'Tajik'],     ["ta", 'Tamil'],     ["tl", 'Tagalog / Filipino'],
    ["tt", 'Tatar'],     ["th", 'Thai'],     ["te", 'Telugu'],     ["tyv", 'Tuvan'],
    ["tr", 'Turkish'],     ["tk", 'Turkmen'],     ["uk", 'Ukrainian'],     ["ur", 'Urdu'],
    ["ug", 'Uyghur'],     ["cy", 'Welsh'],     ["vi", 'Vietnamese'],     ["xh", 'Xhosa'],
    ["ja", 'Japanese'],     ["jv", 'Javanese'],     ["yo", 'Yoruba'],     ["el", 'Greek'],
    ["zu", 'Zulu'], 
  ].map(([code, name]) => ({ code, name }));

  const baseLang = v => String(v || "").trim().toLowerCase().replace(/_/g, "-").split("-")[0];
  const normCode = v => String(v || "").trim().toLowerCase().replace(/_/g, "-");
  const LANG_ALIAS = { fil: "tl", zho: "zh", chi: "zh", fre: "fr", ger: "de", per: "fa", alb: "sq", arm: "hy", geo: "ka", ice: "is", mac: "mk", may: "ms", bur: "my", cze: "cs", dut: "nl", gre: "el", rum: "ro", slo: "sk", wel: "cy", ire: "ga" };
  const langByCode = code => {
    const c = normCode(code), b = baseLang(c);
    return LANGUAGES.find(x => normCode(x.code) === c)
      || LANGUAGES.find(x => normCode(x.code) === (LANG_ALIAS[b] || b))
      || LANGUAGES.find(x => baseLang(x.code) === b) || null;
  };
  const langName = code => (langByCode(code) || {}).name || String(code || "");

  function priorityRank(code) {
    const b = baseLang(code);
    if (!b) return 100;
    const i = PRIORITY.indexOf(b);
    return i >= 0 ? i : 50;
  }

  function isManual(s) {
    return !!s && s.subAll !== true && s.auto !== true && s.src !== "auto";
  }

  function subtitleLang(s) {
    return baseLang((s && (s.dlang || s.lang || s.short || "")) || "");
  }

  // YouTube auto tərcümə trekləri " · avto tərcümə" kimi işarələnir; orijinal avto trek deyil.
  function isAutoOriginal(s) {
    if (!s || !s.auto || isManual(s)) return false;
    const id = String(s.id || ""), label = String(s.label || "");
    if (/-orig\b/i.test(id) || /-orig\b/i.test(label)) return true;
    return !/avto\s*tərcümə|auto[-\s]*translat|translated|tərcümə/i.test(label);
  }

  // Manual/original first. Sonra başlıq dilinə uyğun avto trek, sonra orijinal avto,
  // yalnız ondan sonra maşın tərcüməsi olan avto treklər.
  function prioritizeSubs(list, titleLang = "") {
    const arr = Array.isArray(list) ? list.slice() : [];
    const all = arr.filter(s => s && s.subAll === true);
    const rest = arr.filter(s => !s || s.subAll !== true);
    const tl = baseLang(titleLang);
    // 0 manual+başlıq dili, 1 başlıq dilində orijinal avto, 2 başlıq dilində avto tərcümə,
    // 3 digər orijinal avto, 4 digər manual (tərcümə ola bilər), 5 digər avto tərcümə.
    const catOf = s => {
      const l = subtitleLang(s);
      if (!tl) return isManual(s) ? 0 : (isAutoOriginal(s) ? 1 : 2);
      if (isManual(s)) return l === tl ? 0 : 4;
      if (l === tl) return isAutoOriginal(s) ? 1 : 2;
      return isAutoOriginal(s) ? 3 : 5;
    };
    rest.sort((a, b) => {
      const ac = catOf(a), bc = catOf(b);
      if (ac !== bc) return ac - bc;
      const al = subtitleLang(a), bl = subtitleLang(b);
      if ((al === "en") !== (bl === "en")) return al === "en" ? -1 : 1;
      const ar = priorityRank(al), br = priorityRank(bl);
      if (ar !== br) return ar - br;
      const af = a && (a.kind === "forced" || a.kind === "tiny") ? 1 : 0;
      const bf = b && (b.kind === "forced" || b.kind === "tiny") ? 1 : 0;
      return af - bf;
    });
    return [...all, ...rest];
  }

  function chooseSubtitle(list, titleLang = "") {
    const usable = (Array.isArray(list) ? list : []).filter(s => s && !s.subAll && s.url);
    return prioritizeSubs(usable, titleLang)[0] || null;
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } });
  }

  function cleanCueText(s) {
    return decodeEntities(String(s || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .replace(/\\N/g, "\n"))
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // Rəsmi lyrics mənbələrində olan "Vol.1", "Official Video", [Chorus] kimi
  // mahnıya aid olmayan sətirləri təmizləyir; real sözlərə toxunmur.
  function cleanLyricsText(text) {
    const out = [];
    const section = /^\[?\s*(?:intro|verse|pre[- ]?chorus|chorus|bridge|hook|refrain|outro|instrumental|music|interlude|post[- ]?chorus|bənd|beyt|nəqərat|keçid|giriş|çıxış|körpü|təkrar)(?:\s*\d+)?(?:\s*[:\-–—].*)?\s*\]?$/i;
    const metaOnly = /^\s*(?:vol(?:ume)?\.?\s*\d+|album|ep|single|mixtape|soundtrack|ost)\s*[:.\-–—]?\s*$/i;
    const metaLine = /^\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visualizer)|^\s*(?:produced|written|composed|arranged|mixed|mastered)\s+by\b|^\s*(?:producer|director|composer|lyricist|arranger|studio|label)\s*[:\-–—]|^\s*(?:listen|stream|download|follow|subscribe|buy)\b|^\s*(?:©|℗)\b|^\s*(?:https?:\/\/|www\.)/i;
    for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
      let line = raw.replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (section.test(line)) continue;
      if (metaOnly.test(line)) continue;
      if (metaLine.test(line) && line.length < 180) continue;
      line = line.replace(/^\s*(?:vol(?:ume)?\.?\s*\d+)\s*[:\-–—]\s*/i, "").trim();
      if (!line) continue;
      out.push(line);
    }
    return out.join("\n").trim();
  }
  // [Music], [Applause], (laughs), ♪ və bütün dillərdəki analoji qeyri-nitq işarələrini silir.
  const SOUND_WORDS = [
    "music", "musiqi", "müzik", "muzik", "musique", "musica", "música", "musik",
    "музыка", "музык", "аплодисменты", "аплод", "applause", "applaus", "aplaus", "aplausos",
    "alqış", "alkış", "clap", "clapping", "laugh", "laughs", "laughter", "gülüş", "gülüşmə",
    "risas", "rire", "gelächter", "смех", "silence", "səssizlik", "sessizlik", "silenzio",
    "stille", "noise", "səs-küy", "sound", "inaudible", "indistinct", "foreign", "speaking",
    "background", "sfx", "applauding", "cheering", "whistl", "sigh", "sighs", "gasp", "gasps",
    "cough", "coughs", "sneeze", "thunder", "rain", "phone", "dog", "bark", "door", "knock",
    "footstep", "footsteps", "whisper", "whispers", "murmur", "shouting", "screams", "screaming",
    "crying", "cries", "chuckles", "laughing", "breathing", "exhales", "inhales", "wind",
    "explosion", "gunshot", "siren", "alarm", "bell", "ringing", "beep", "static", "crowd",
    "audience", "applaudissements", "applausi", "risate", "risadas", "aplausos", "music playing", "applause playing",
    "音乐", "掌声", "笑声", "拍手", "音楽", "笑い", "음악", "박수", "웃음",
    "موسيقى", "تصفيق", "ضحك", "موسیقی", "تشویق", "خنده", "संगीत", "तालियाँ", "हँसी"
  ];
  const SOUND_RE = new RegExp("(?<![\\p{L}])(" + SOUND_WORDS.join("|") + ")(?![\\p{L}])", "iu");
  const SOUND_LINE_RE = new RegExp("^(?:" + SOUND_WORDS.join("|") + ")(?:\\s+(?:playing|starts|ends|continues|in\\s+the\\s+background|fades?\\s+(?:in|out)))?$", "iu");
  function stripNonSpeechText(text) {
    let s = String(text || "").replace(/\r/g, "");
    // Mötərizəli qeyri-nitq etiketləri: [Music], [Applause], (laughs), 【音乐】, （拍手）
    s = s.replace(/([\[\(（【「])([^\]\)）】」]{1,120})([\]\)）】」])/g, (m, _o, inner) => {
      const t = String(inner || "").trim();
      if (!t) return m;
      if (SOUND_RE.test(t) || /^[\s♪♫♬♩.\-–—]+$/.test(t)) return " ";
      return m;
    });
    s = s.replace(/[♪♫♬♩]+/g, " ");
    const out = [];
    for (const raw of s.split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (!/[\p{L}\p{N}]/u.test(line)) continue;
      if (SOUND_LINE_RE.test(line)) continue;
      out.push(line);
    }
    return out.join("\n").trim();
  }
  function stripNonSpeech(cues) {
    return (Array.isArray(cues) ? cues : []).map(c => ({ ...c, text: stripNonSpeechText(c && c.text) }))
      .filter(c => c && c.text && c.end >= c.start);
  }

  function parseTime(v) {
    const m = String(v || "").trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
    if (!m) return 0;
    return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 + (+m[4]) * (m[4].length === 1 ? 100 : m[4].length === 2 ? 10 : 1);
  }

  function srtTime(ms) {
    ms = Math.max(0, Math.round(+ms || 0));
    const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000), f = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(f).padStart(3, "0")}`;
  }

  function parseJsonCues(text) {
    const j = JSON.parse(text), out = [];
    for (const e of (j.events || [])) {
      const start = +e.tStartMs || 0, dur = +e.dDurationMs || 0;
      const body = (e.segs || []).map(x => x && x.utf8 || "").join("");
      const txt = cleanCueText(body);
      if (txt) out.push({ start, end: start + Math.max(0, dur), text: txt });
    }
    return out;
  }

  function parseTimedText(text) {
    const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const out = [];
    const blocks = raw.split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split("\n").filter((x, i) => i === 0 || x !== "");
      const ti = lines.findIndex(x => /-->/.test(x));
      if (ti < 0) continue;
      const tm = lines[ti].match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/);
      if (!tm) continue;
      const txt = cleanCueText(lines.slice(ti + 1).join("\n"));
      if (txt) out.push({ start: parseTime(tm[1]), end: parseTime(tm[2]), text: txt });
    }
    return out;
  }

  function parseAss(text) {
    const out = [];
    for (const line of String(text || "").replace(/\r/g, "").split("\n")) {
      if (!/^\s*Dialogue\s*:/i.test(line)) continue;
      const p = line.slice(line.indexOf(":") + 1).split(",");
      if (p.length < 10) continue;
      const txt = cleanCueText(p.slice(9).join(","));
      if (txt) out.push({ start: parseTime(p[1]), end: parseTime(p[2]), text: txt });
    }
    return out;
  }

  function parseTtml(text) {
    const out = [];
    const src = String(text || "");
    const re = /<p\b[^>]*\bbegin="([^"]+)"[^>]*\bend="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = re.exec(src))) {
      const txt = cleanCueText(m[3]);
      if (txt) out.push({ start: parseTime(m[1]), end: parseTime(m[2]), text: txt });
    }
    return out;
  }

  function cueTextNorm(text) {
    return cleanCueText(text).replace(/\s+/g, " ").trim();
  }
  function cueKey(text) {
    return cueTextNorm(text).toLowerCase()
      .replace(/^[\s\-–—•*]+/, "")
      .replace(/[.!?,;:…]+$/, "")
      .trim();
  }

  // YouTube auto-caption blokları köhnə mətni təkrar gətirir:
  // "Hello" -> "Hello world" -> "Hello world again". Yalnız delta hissəsini saxla.
  function cumulativeDelta(prev, cur) {
    const p = cueKey(prev);
    if (!p) return cueTextNorm(cur);
    const boundary = after => !after || /^[\s,.;:!?…\-–—]/.test(after);
    // Əvvəlki mətn ayrı sətir kimi təkrar gələ bilər (YouTube bəzən 2 sətir saxlayır).
    const curLines = cleanCueText(cur).split("\n").map(cueTextNorm).filter(Boolean);
    if (curLines.length > 1) {
      const prevLines = cleanCueText(prev).split("\n").map(cueKey).filter(Boolean);
      const kept = [];
      for (const line of curLines) {
        const lk = cueKey(line);
        if (!lk) continue;
        const old = prevLines.find(k => lk === k || (lk.startsWith(k) && boundary(line.slice(k.length))));
        if (old) {
          const after = line.slice(old.length);
          const rest = after.replace(/^[\s,.;:!?…\-–—]+/, "").trim();
          if (rest) kept.push(rest);
          continue;
        }
        if (lk.startsWith(p) && boundary(line.slice(p.length))) {
          const rest = line.slice(p.length).replace(/^[\s,.;:!?…\-–—]+/, "").trim();
          if (rest) kept.push(rest);
          continue;
        }
        kept.push(line);
      }
      if (kept.length && kept.length < curLines.length) return kept.join(" ");
    }

    const cn = cueTextNorm(cur);
    const c = cueKey(cur);
    if (!c) return "";
    if (c === p) return "";                       // tam eyni blok: təkrar göstərmə
    if (c.startsWith(p)) {
      const after = cn.slice(p.length);
      if (boundary(after)) return after.replace(/^[\s,.;:!?…\-–—]+/, "").trim();
    }
    const at = c.indexOf(p);
    if (at > 0 && !/[a-z0-9]/i.test(c.slice(0, at))) {
      const after = c.slice(at + p.length);
      if (boundary(after)) return after.replace(/^[\s,.;:!?…\-–—]+/, "").trim();
    }
    return cn;
  }

  // mpv/ffmpeg üçün təmiz timeline: təkrar mətni sil, end time-ı növbəti bloka qədər kəs,
  // heç bir cue növbəti cue ilə üst-üstə düşməsin.
  function normalizeSubtitleCues(cues, opts = {}) {
    const dedupe = opts.dedupe !== false;
    const clamp = opts.clamp !== false;
    let out = (Array.isArray(cues) ? cues : []).map(c => ({
      ...c,
      start: Math.max(0, Math.round(+c.start || 0)),
      end: Math.max(0, Math.round(+c.end || 0)),
      text: cleanCueText(c.text)
    })).filter(c => c.text && c.end >= c.start);
    out.sort((a, b) => a.start - b.start || a.end - b.end);

    if (dedupe) {
      const clean = [];
      let prevRaw = "";
      for (const c of out) {
        const raw = cueTextNorm(c.text);
        if (!raw) continue;
        const text = prevRaw ? cumulativeDelta(prevRaw, raw) : raw;
        if (!text) {
          // Tam təkrar blok: əvvəlki cue-nun müddətini uzat, yenisini yaratma.
          if (clean.length) clean[clean.length - 1].end = Math.max(clean[clean.length - 1].end, c.end);
          prevRaw = raw;
          continue;
        }
        clean.push({ ...c, text });
        prevRaw = raw;
      }
      out = clean;
    }

    if (clamp) {
      for (let i = 0; i < out.length; i++) {
        const c = out[i], n = out[i + 1];
        const ns = n ? Math.max(0, Math.round(+n.start || 0)) : Infinity;
        if (n && c.end > ns) c.end = ns;          // növbəti bloka girmə
        if (c.end <= c.start) {
          if (n && ns > c.start) c.end = Math.min(c.start + 100, ns);
          else { out.splice(i, 1); i--; continue; }
        }
      }
    }
    return out;
  }

  // ---- Zaman xəttinin ağıllı təmiri ----
  // YouTube avtomatik alt yazıları çox vaxt söz-söz və təkrarlanan bloklarla gəlir.
  // Bu funksiya 10 ms-lik dublikatları, sıfıra yaxın müddətləri və söz parçalarını
  // məna bütövlüyü saxlayaraq birləşdirir; start/end mənbədən götürülür.
  const STRONG_END_RE = /[.!?…。！？][\]"'»”’)]*$/u;
  const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
  function joinCueText(a, b) {
    const left = String(a || "").trim();
    const right = String(b || "").trim();
    if (!left) return right;
    if (!right) return left;
    if (CJK_RE.test(left.slice(-1)) || CJK_RE.test(right.charAt(0))) return left + right;
    if (/[–—]$/.test(left) && /^[a-zà-ÿəğıöşüç]/i.test(right)) return left + right;
    return left + " " + right;
  }
  function medianOf(values) {
    const a = (values || []).filter(x => isFinite(x)).sort((x, y) => x - y);
    if (!a.length) return 0;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function repairSubtitleTimeline(cues, opts = {}) {
    const minDur = opts.minDuration == null ? 320 : Math.max(0, +opts.minDuration || 0);
    const maxCueDuration = opts.maxCueDuration == null ? 7000 : Math.max(400, +opts.maxCueDuration || 7000);
    const maxChars = opts.maxChars == null ? 160 : Math.max(30, +opts.maxChars || 160);
    const dedupe = opts.dedupe !== false;
    const mergeFragments = opts.mergeFragments !== false;
    const clamp = opts.clamp !== false;

    let list = (Array.isArray(cues) ? cues : []).map(c => {
      const raw = cleanCueText(c && c.text);
      const speaker = /^\s*>>/.test(raw);
      return {
        ...c,
        start: Math.max(0, Math.round(+c.start || 0)),
        end: Math.max(0, Math.round(+c.end || 0)),
        text: raw.replace(/^(?:\s*>>\s*)+/, "").trim(),
        _speaker: speaker
      };
    }).filter(c => c.text && c.end >= c.start);
    list.sort((a, b) => a.start - b.start || a.end - b.end);

    // 1) Eyni mətnin yaxın təkrarlarını və 10 ms-lik blokları birləşdir.
    if (dedupe) {
      const out = [];
      for (const c of list) {
        const prev = out[out.length - 1];
        const ck = cueKey(c.text), pk = prev ? cueKey(prev.text) : "";
        const near = prev && (c.start <= prev.end + 250 || c.end - c.start < Math.max(80, minDur) || c.start - prev.start < 400);
        if (prev && ck && ck === pk && near) {
          prev.end = Math.max(prev.end, c.end);
          prev._speaker = prev._speaker || c._speaker;
          continue;
        }
        out.push(c);
      }
      list = out;
    }

    // 2) Söz-söz gələn avtomatik alt yazını cümləyə yaxın bloklara yığ.
    const durations = list.map(c => c.end - c.start);
    const lens = list.map(c => c.text.length);
    const shortFrac = list.length ? durations.filter(d => d < 1200).length / list.length : 0;
    const fragmented = opts.fragmented == null
      ? (shortFrac >= 0.15 || medianOf(durations) < 1700 || medianOf(lens) < 22)
      : !!opts.fragmented;
    if (mergeFragments && fragmented && list.length > 1) {
      const out = [];
      for (const c of list) {
        const g = out[out.length - 1];
        if (!g) { out.push({ ...c }); continue; }
        const gap = c.start - g.end;
        const joined = joinCueText(g.text, c.text);
        const can = !g._speaker && !c._speaker && !STRONG_END_RE.test(g.text) &&
          gap <= 700 && (c.end - g.start) <= maxCueDuration && joined.length <= maxChars;
        if (can) {
          g.text = joined;
          g.end = Math.max(g.end, c.end);
        } else {
          out.push({ ...c });
        }
      }
      list = out;
    }

    // 3) Çox qısa və tək qalan parçaları qonşu sətrə qoş; mümkünsə müddəti uzat.
    if (minDur > 0) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.end - c.start >= minDur) continue;
        const next = list[i + 1], prev = list[i - 1];
        const limit = next ? next.start - 20 : Infinity;
        if (limit > c.end && limit - c.start >= minDur) c.end = Math.min(c.start + minDur, limit);
        if (c.end - c.start >= minDur) continue;
        if (prev && (c.start - prev.end <= 350 || cueKey(prev.text) === cueKey(c.text))) {
          prev.text = joinCueText(prev.text, c.text);
          prev.end = Math.max(prev.end, c.end);
          list.splice(i, 1); i--; continue;
        }
        if (next) {
          next.start = Math.min(next.start, c.start);
          next.text = joinCueText(c.text, next.text);
          next._speaker = c._speaker || next._speaker;
          list.splice(i, 1); i--; continue;
        }
        c.end = c.start + Math.max(minDur, 250);
      }
    }

    // 4) Üst-üstə düşməni kəs; qalan sıfır-müddətli bloku qonşuya birləşdir.
    if (clamp) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i], next = list[i + 1];
        if (next && c.end > next.start - 10) c.end = next.start - 10;
        if (c.end > c.start) continue;
        if (next) {
          next.start = Math.min(next.start, c.start);
          next.text = joinCueText(c.text, next.text);
          list.splice(i, 1); i--; continue;
        }
        c.end = c.start + 200;
      }
    }

    // 5) Son təmizlik: boş mətn, təkrarlanan qonşu və sıra.
    const out = [];
    for (const c of list) {
      const text = cleanCueText(c.text);
      if (!text || c.end < c.start) continue;
      const prev = out[out.length - 1];
      if (prev && cueKey(prev.text) === cueKey(text) && c.start <= prev.end + 500) {
        prev.end = Math.max(prev.end, c.end);
        continue;
      }
      out.push({ start: c.start, end: c.end, text });
    }
    return out;
  }

  // MPV/ffmpeg üçün seçilmiş stilin ASS-ə yazılması. Bu fayl script/config
  // olmayan playerdə belə seçilmiş görünüşü saxlayır.
  const ASS_STYLES = {
    default: { font: "Arial", size: 48, color: "&H00FFFFFF", bold: 0, spacing: 0, shadow: 2, back: "&H80000000", margin: 35 },
    cinematic: { font: "Georgia", size: 48, color: "&H00C4E6F6", bold: -1, spacing: 0.4, shadow: 2, back: "&H80000000", margin: 34 },
    minimalist: { font: "Inter", size: 48, color: "&H00FFFFFF", bold: 0, spacing: 0.2, shadow: 2, back: "&H80000000", margin: 34 },
    neon: { font: "Inter", size: 48, color: "&H00FFFFE8", bold: -1, spacing: 1, shadow: 3, back: "&H80FFE623", margin: 34 }
  };
  function assTime(ms) {
    ms = Math.max(0, Math.round(+ms || 0));
    const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000), cs = Math.floor(ms % 1000 / 10);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }
  function assEscape(text) {
    return String(text || "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
  }
  function subAppRatio(app) {
    if (!app || typeof app !== "object") return 1;
    return Math.max(2, Math.min(200, Math.round(+app.size || 16))) / 16;
  }
  function subAppBack(app) {
    const bg = app && app.bg != null ? Math.max(0, Math.min(100, Math.round(+app.bg))) : 10;
    const alpha = 255 - Math.round(bg * 2.55);
    return "&H" + alpha.toString(16).toUpperCase().padStart(2, "0") + "000000";
  }
  function toAss(cues, style = "default", appearance = null) {
    const key = ASS_STYLES[style] ? style : "default";
    const v = ASS_STYLES[key];
    const app = appearance && typeof appearance === "object" ? appearance : null;
    const ratio = subAppRatio(app);
    const fontSize = Math.max(1, Math.round(v.size * ratio));
    const bold = app ? (app.bold ? -1 : 0) : v.bold;
    const italic = app ? (app.italic ? -1 : 0) : 0;
    const underline = app ? (app.underline ? -1 : 0) : 0;
    const back = app ? subAppBack(app) : v.back;
    const borderStyle = app ? 4 : 1;
    const outline = app ? 1 : 0;
    let fontName = v.font;
    if (app && app.font && app.font !== "Default") fontName = app.fontResolved || app.font;
    fontName = String(fontName || "Arial").replace(/[,\r\n]/g, " ");
    const list = (Array.isArray(cues) ? cues : []).filter(c => c && c.text && +c.end > +c.start);
    const header = [
      "[Script Info]",
      "ScriptType: v4.00+",
      "PlayResX: 1920",
      "PlayResY: 1080",
      "WrapStyle: 2",
      "ScaledBorderAndShadow: yes",
      "YCbCr Matrix: TV.709",
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      `Style: JDM,${fontName},${fontSize},${v.color},&H000000FF,&HFF000000,${back},${bold},${italic},${underline},0,100,100,${v.spacing},0,${borderStyle},${outline},${v.shadow},2,20,20,${v.margin},1`,
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    ];
    const events = list.map(c => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},JDM,,0,0,0,,${assEscape(cleanCueText(c.text))}`);
    return header.concat(events).join("\n") + "\n";
  }

  // İki alt yazı trekini eyni timeline-da üst/alt sətir kimi birləşdirir.
  // Heç bir mətn itmir: hər segmentdə həmin anda aktiv olan üst və alt mətn götürülür.
  function combineDualCues(topCues, bottomCues) {
    const norm = list => (Array.isArray(list) ? list : []).map(c => ({
      start: Math.max(0, Math.round(+c.start || 0)),
      end: Math.max(0, Math.round(+c.end || 0)),
      text: cleanCueText(c && c.text).replace(/\s*\n+\s*/g, " ").trim()
    })).filter(c => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
    const top = norm(topCues), bottom = norm(bottomCues);
    if (!top.length || !bottom.length) return [];
    const bounds = new Set();
    for (const c of top.concat(bottom)) { bounds.add(c.start); bounds.add(c.end); }
    const times = [...bounds].filter(t => t >= 0).sort((a, b) => a - b);
    const activeText = (list, t) => {
      const seen = new Set(), out = [];
      for (const c of list) {
        if (c.start <= t && c.end > t) {
          const key = cueKey(c.text);
          if (key && !seen.has(key)) { seen.add(key); out.push(c.text); }
        }
      }
      return out.join(" ");
    };
    let out = [];
    for (let i = 0; i + 1 < times.length; i++) {
      const start = times[i], end = times[i + 1];
      if (end - start < 30) continue;
      const probe = start + Math.min(20, Math.max(1, (end - start) / 4));
      const a = activeText(top, probe), b = activeText(bottom, probe);
      // İkili sətir yalnız hər iki trek aktiv olanda göstərilir; beləliklə
      // üst sətrin rəngi/bayrağı ilə aşağı sətrinki qarışmır.
      if (!a || !b) continue;
      const text = a + "\n" + b;
      const prev = out[out.length - 1];
      if (prev && prev.text === text && start <= prev.end + 20) prev.end = Math.max(prev.end, end);
      else out.push({ start, end, text });
    }
    if (!out.length) return [];
    // Çox qısa sərhəd parçalarını təmizlə, lakin iki sətri birləşdirmə.
    return repairSubtitleTimeline(out, { dedupe: true, mergeFragments: false, minDuration: 80, clamp: true });
  }

  // İkili alt yazı üçün ASS: üst və aşağı sətir ayrı stillər, ayrı rənglər,
  // bayraqlar və (lazım olsa) üfüqi qradient layları.
  function assColor(hex) {
    let h = String(hex || "").trim();
    if (/^#[0-9a-f]{3}$/i.test(h)) h = "#" + h.slice(1).split("").map(x => x + x).join("");
    const m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(h);
    if (!m) return "&H00FFFFFF";
    const r = m[1].slice(0, 2), g = m[1].slice(2, 4), b = m[1].slice(4, 6);
    return "&H00" + b + g + r;
  }
  function gradientStops(css) {
    const raw = String(css || "");
    if (!/gradient\(/i.test(raw)) return [];
    const out = [];
    const re = /#([0-9a-f]{3,8})\b|rgba?\(([^)]+)\)/gi;
    let m;
    while ((m = re.exec(raw))) {
      if (m[1]) {
        let h = m[1];
        if (h.length === 3) h = h.split("").map(x => x + x).join("");
        if (h.length >= 6) out.push("#" + h.slice(0, 6));
      } else if (m[2]) {
        const p = m[2].split(",").map(x => x.trim());
        if (p.length >= 3) {
          const c = p.slice(0, 3).map(x => Math.max(0, Math.min(255, Math.round(parseFloat(x)))));
          out.push("#" + c.map(x => x.toString(16).padStart(2, "0")).join(""));
        }
      }
    }
    return out.slice(0, 8);
  }
  function mixHex(a, b, t) {
    const pa = (String(a).match(/^#([0-9a-f]{6})$/i) || [])[1] || "ffffff";
    const pb = (String(b).match(/^#([0-9a-f]{6})$/i) || [])[1] || "ffffff";
    const c = (h, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return "#" + [0,1,2].map(i => Math.round(c(pa,i) + (c(pb,i) - c(pa,i)) * t).toString(16).padStart(2,"0")).join("");
  }
  function toAssDual(cues, opts = {}) {
    const topColor = opts.topColor || "#ffffff";
    const bottomColor = opts.bottomColor || "#ffffff";
    const topCode = String(opts.topCode || "").trim().toUpperCase().split("-")[0].slice(0, 8);
    const bottomCode = String(opts.bottomCode || "").trim().toUpperCase().split("-")[0].slice(0, 8);
    const app = opts.appearance && typeof opts.appearance === "object" ? opts.appearance : null;
    const appRatio = subAppRatio(app);
    const bold = app ? (app.bold ? -1 : 0) : -1;
    const italic = app ? (app.italic ? -1 : 0) : 0;
    const underline = app ? (app.underline ? -1 : 0) : 0;
    const back = app ? subAppBack(app) : "&HE6000000";
    const fontSize = Math.round(DUAL_FONT_SIZE * appRatio);
    const dualFont = String((app && app.font && app.font !== "Default") ? (app.fontResolved || app.font) : "Arial").replace(/[,\r\n]/g, " ");
    const topFlag = String(opts.topFlag || "").trim();
    const bottomFlag = String(opts.bottomFlag || "").trim();
    const flagSize = fontSize * 0.98;
    const flagAdvance = fontSize * 1.30;
    const flagGap = fontSize * 0.02;
    const flagData = (typeof self !== "undefined" && self.IDM_FLAG_ASS) || {};
    let measureCtx = null;
    const measureCache = new Map();
    const scaledFlagCache = new Map();
    const measureText = text => {
      const key = text + "\u0000" + fontSize;
      if (measureCache.has(key)) return measureCache.get(key);
      let w = 0;
      try {
        if (!measureCtx) measureCtx = new OffscreenCanvas(8, 8).getContext("2d");
        measureCtx.font = `${app && app.italic ? "italic " : ""}${app && app.bold ? "bold " : ""}${fontSize}px "${dualFont}", Arial`;
        w = measureCtx.measureText(text).width;
      } catch { w = text.length * fontSize * 0.56; }
      w *= 1.02;
      if (!(w > 0)) w = 1;
      measureCache.set(key, w);
      return w;
    };
    const scaleFlagPath = (d, k) => d.replace(/-?\d+(?:\.\d+)?/g, n => (parseFloat(n) * k).toFixed(2));
    const scaledFlagPaths = (flag, data) => {
      const key = flag + "|" + flagSize;
      if (scaledFlagCache.has(key)) return scaledFlagCache.get(key);
      const list = (data.paths || []).map(([c, d]) => [c, scaleFlagPath(d, flagSize)]);
      scaledFlagCache.set(key, list);
      return list;
    };
    const stopsFor = c => {
      const st = gradientStops(c);
      return st.length >= 2 ? st : [String(c || "#ffffff")];
    };
    const topStops = stopsFor(topColor), bottomStops = stopsFor(bottomColor);
    const firstColor = c => gradientStops(c)[0] || (String(c).match(/^#[0-9a-f]{6}$/i) ? c : "#ffffff");
    const header = [
      "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080",
      "WrapStyle: 2", "ScaledBorderAndShadow: yes", "YCbCr Matrix: TV.709", "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      `Style: Dual,${dualFont},${fontSize},${assColor(firstColor(topColor))},&H000000FF,&HE6000000,${back},${bold},${italic},${underline},0,100,100,0,0,4,1,0,5,20,20,0,1`, "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    ];
    const events = [];
    const part = (color, flag, text, flagPaths) => {
      let lead = "";
      if (flagPaths) lead = flagPaths + `{\\c${assColor(color)}\\fn${dualFont}}` + "\u2003";
      else if (flag) lead = `{\\fnBabelStone Flags}${assEscape(flag)}{\\fn${dualFont}}` + "\u2003";
      return `{\\c${assColor(color)}}` + lead + assEscape(text);
    };
    const bandColor = (stops, t) => {
      if (stops.length < 2) return stops[0] || "#ffffff";
      const pos = t * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(pos));
      return mixHex(stops[k], stops[k + 1], pos - k);
    };
    for (const c of (Array.isArray(cues) ? cues : [])) {
      if (!c || !c.text || !(+c.end > +c.start)) continue;
      const lines = String(c.text).replace(/\r/g, "").split("\n");
      const top = cleanCueText(lines[0] || "").replace(/\s+/g, " ").trim();
      const bottom = cleanCueText(lines[1] || "").replace(/\s+/g, " ").trim();
      if (!top || !bottom) continue;
      const emit = (text, stops, color, flag, y) => {
        const fd = flag && flagData[flag];
        const vector = !!(fd && Array.isArray(fd.paths) && fd.paths.length);
        const solid = stops.length < 2;
        const textW = vector ? measureText(text) : 0;
        // Mətn sol tərəfə anchor olunur: bayraq həmişə mətnin sol başlanğıcından
        // sabit məsafədə durur, ölçmə fərqi onları ayırmır.
        const textX = vector ? (960 - (textW + flagAdvance + flagGap) / 2 + flagAdvance + flagGap) : 960;
        const align = vector ? "\\an4" : "\\an5";
        if (vector) {
          const flagX = textX - flagAdvance - flagGap;
          const flagY = y - flagSize / 2;
          for (const [fc, fpath] of scaledFlagPaths(flag, fd)) {
            events.push(`Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Dual,,0,0,0,,{\\an7\\pos(${flagX.toFixed(2)},${flagY.toFixed(2)})\\p1\\bord0\\shad0\\c${assColor(fc)}}${fpath}{\\p0}`);
          }
        }
        if (solid) {
          events.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Dual,,0,0,0,,{${align}\\pos(${textX.toFixed(2)},${y})\\q2}` + part(color, vector ? "" : flag, text, ""));
          return;
        }
        const n = 16;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const col = bandColor(stops, t);
          const x1 = Math.round(1920 * i / n), x2 = Math.round(1920 * (i + 1) / n);
          events.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Dual,,0,0,0,,{${align}\\pos(${textX.toFixed(2)},${y})\\q2\\clip(${x1},0,${x2},1080)}` + part(col, vector ? "" : flag, text, ""));
        }
      };
      const lineGap = fontSize * 1.45;
      const bottomY = 1080 - 150 * (fontSize / 52);
      emit(top, topStops, topColor, topFlag, bottomY - lineGap);
      emit(bottom, bottomStops, bottomColor, bottomFlag, bottomY);
    }
    return header.concat(events).join("\n") + "\n";
  }

  function parseSubtitle(text, fmt = "", opts = {}) {
    const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const f = String(fmt || "").toLowerCase();
    let cues = [];
    try {
      if (f.includes("json") || (/^\s*\{/.test(raw) && /"events"\s*:/.test(raw))) cues = parseJsonCues(raw);
      else if (f.includes("ass") || /\[Script Info\]/i.test(raw)) cues = parseAss(raw);
      else if (f.includes("ttml") || /^\s*(?:<\?xml[^>]*>\s*)?<tt[\s>]/i.test(raw)) cues = parseTtml(raw);
      else cues = parseTimedText(raw);
    } catch { cues = []; }
    if (!cues.length && /-->/.test(raw)) cues = parseTimedText(raw);
    const sorted = cues.filter(c => c.text && c.end >= c.start).sort((a, b) => a.start - b.start);
    return opts && opts.youtube ? normalizeSubtitleCues(sorted, { dedupe: true, clamp: true }) : sorted;
  }

  function toSrt(cues, opts = {}) {
    const list = opts && opts.normalize ? normalizeSubtitleCues(cues, opts) : (cues || []);
    return list.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${cleanCueText(c.text) || " "}\n`).join("\n");
  }

  function chunkCues(cues, maxChars = 2400, maxCues = 28) {
    const out = [];
    let start = 0, items = [], n = 0;
    for (let i = 0; i < cues.length; i++) {
      const len = String(cues[i].text || "").length;
      if (items.length && (items.length >= maxCues || n + len > maxChars)) {
        out.push({ start, items });
        start = i; items = []; n = 0;
      }
      items.push(cues[i]); n += len;
    }
    if (items.length) out.push({ start, items });
    return out;
  }

  const CHUNK_MAX_CHARS = 3200;       // daha az API sorğusu: 28→42 sətir
  const CHUNK_MAX_CUES = 42;
  const TRANSLATE_CONCURRENCY = 5;    // paralel chunklər; 429 zamanı ağıllı gözləmə
  const TRANSLATE_CACHE_MAX = 240;
  const translationCache = new Map();
  let rateGateUntil = 0;
  // Gemini 503/overload halları üçün ehtiyat model zənciri və soyutma.
  const GEMINI_FALLBACKS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite", "gemini-flash-latest", "gemini-1.5-flash"];
  const modelCooldown = new Map();
  const MODEL_COOLDOWN_MS = 120000;

  async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitRateGate() {
    const wait = rateGateUntil - Date.now();
    if (wait > 0) await sleep(wait);
  }

  function retryDelayMs(response, attempt) {
    let ms = 0;
    try {
      const raw = response && response.headers && response.headers.get("retry-after");
      if (raw) {
        const sec = +raw;
        if (Number.isFinite(sec)) ms = sec * 1000;
        else {
          const at = Date.parse(raw);
          if (Number.isFinite(at)) ms = at - Date.now();
        }
      }
    } catch {}
    if (!(ms > 0)) ms = Math.min(12000, 800 * Math.pow(2, attempt));
    return Math.max(500, Math.min(30000, ms));
  }

  function hashText(text) {
    let h = 2166136261;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function cacheGet(key) {
    const v = translationCache.get(key);
    if (v) { translationCache.delete(key); translationCache.set(key, v); }
    return v;
  }

  function cacheSet(key, value) {
    translationCache.delete(key);
    translationCache.set(key, value);
    while (translationCache.size > TRANSLATE_CACHE_MAX) translationCache.delete(translationCache.keys().next().value);
  }

  function geminiFriendlyError(status, detail, modelName) {
    const text = String(detail || "").replace(/\s+/g, " ").trim();
    const tail = text ? " — " + text.slice(0, 180) : "";
    if (status === 503) {
      if (/overload|high demand|capacity|try again later/i.test(text))
        return "Google modeli müvəqqəti yüklənib (HTTP 503) — Google tərəfindəki güc çatışmazlığıdır, açarınızla bağlı deyil.";
      if (/<html|cloudflare|nginx|proxy|gateway|blocked|firewall|unavailable/i.test(text))
        return "Gemini API-yə çıxış bloklanır və ya proxy/şəbəkə xətası (HTTP 503). VPN/proxy/firewall ayarlarını yoxlayın.";
      return "Gemini xidməti müvəqqəti əlçatmazdır (HTTP 503) — Google serverləri cavab vermir.";
    }
    if (status === 429) return `Gemini sorğu limiti aşıldı (HTTP 429)${tail}. Bir az gözləyib yenidən cəhd edin.`;
    if (status === 403) return `Gemini API açarı bu modelə icazə vermir (HTTP 403)${tail}.`;
    if (status === 404) return `Gemini modeli tapılmadı: ${modelName || "—"} (HTTP 404)${tail}.`;
    if (status === 400) return `Gemini sorğunu qəbul etmədi (HTTP 400)${tail}.`;
    return `Gemini HTTP ${status}${tail}`;
  }

  const API_V1 = "https://generativelanguage.googleapis.com/v1";
  let geminiModelsCache = { key: "", t: 0, list: [] };

  // Açar üçün həqiqətən mövcud olan generateContent modellərini alır (503 fallback üçün).
  async function geminiAvailableModels(apiKey) {
    const now = Date.now();
    if (geminiModelsCache.key === apiKey && now - geminiModelsCache.t < 600000) return geminiModelsCache.list;
    try {
      const r = await fetch(`${API}/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const j = await r.json();
        const list = (j.models || [])
          .filter(x => !Array.isArray(x.supportedGenerationMethods) || x.supportedGenerationMethods.includes("generateContent"))
          .map(x => String(x.name || "").replace(/^models\//, ""))
          .filter(Boolean);
        geminiModelsCache = { key: apiKey, t: now, list };
        return list;
      }
    } catch {}
    return [];
  }

  function geminiFallbackChain(primary, available) {
    const names = [...new Set([...(available && available.length ? available : []), ...GEMINI_FALLBACKS])];
    const score = name => {
      const n = String(name).toLowerCase();
      let s = 0;
      if (/flash/.test(n)) s += 10;
      if (/lite/.test(n)) s -= 3;
      if (/pro/.test(n)) s += 4;
      const ver = n.match(/gemini-(\d+)\.(\d+)/);
      if (ver) s += (+ver[1]) * 10 + (+ver[2]);
      if (/preview|exp\b|experimental/.test(n)) s -= 12;
      if (/image|tts|audio|embedding|live|vision/.test(n)) s -= 20;
      return s;
    };
    const rest = names.filter(x => x !== primary).sort((a, b) => score(b) - score(a) || a.localeCompare(b));
    return [primary, ...rest.slice(0, 3)];
  }

  async function geminiCall(apiKey, model, prompt, maxTokens = 4096, opts = {}) {
    const m = String(model || "").replace(/^models\//, "");
    if (!apiKey || !m) throw new Error("Gemini API açarı və model seçilməyib");
    return geminiCallInner(apiKey, m, prompt, maxTokens, opts);
  }

  async function geminiCallInner(apiKey, m, prompt, maxTokens, opts) {
    const timeout = Math.max(2000, +opts.timeout || 60000);
    const temperature = Number.isFinite(+opts.temperature) ? +opts.temperature : 0.15;
    const body = JSON.stringify({
      contents: [{ parts: (() => {
        if (opts.audio) return [{ text: prompt }, { inline_data: { mime_type: opts.audio.mimeType || "audio/mp3", data: opts.audio.data } }];
        if (opts.videoUri) return [{ text: prompt }, { file_data: { file_uri: opts.videoUri, mime_type: opts.videoMime || "video/mp4" } }];
        return [{ text: prompt }];
      })() }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
      ...(opts.tools ? { tools: opts.tools } : {})
    });

    let lastDetail = "";
    let saw503 = false;
    let last = null;

    const attempt = async (name, base) => {
      await waitRateGate();
      let r;
      try {
        r = await fetch(`${base}/models/${encodeURIComponent(name)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body,
          signal: AbortSignal.timeout(timeout)
        });
      } catch (e) { last = e; return { kind: "net" }; }

      if (r.status === 429) {
        const delay = retryDelayMs(r, 0);
        rateGateUntil = Math.max(rateGateUntil, Date.now() + delay);
        lastDetail = "";
        try { lastDetail = (await r.text()).slice(0, 200); } catch {}
        last = new Error(geminiFriendlyError(429, lastDetail, name));
        return { kind: "rate", delay };
      }
      if (r.status === 408 || r.status === 500 || r.status === 502 || r.status === 503 || r.status === 504) {
        if (r.status === 503) saw503 = true;
        // Cavabı mütləq oxu: HTTP/2 stream-i boşalt və Google-un səbəbini götür.
        let detail = "";
        try {
          const j = await r.json().catch(() => null);
          detail = (j && j.error && (j.error.message || j.error.status)) || "";
        } catch {}
        if (!detail) { try { detail = (await r.text()).slice(0, 160); } catch {} }
        lastDetail = detail || lastDetail;
        last = new Error(geminiFriendlyError(r.status, detail, name));
        return { kind: "retry", status: r.status };
      }
      if (r.status === 404) {
        last = new Error(geminiFriendlyError(404, "", name));
        return { kind: "missing" };
      }
      if (!r.ok) {
        let detail = "";
        try { detail = (await r.text()).slice(0, 200); } catch {}
        throw new Error(geminiFriendlyError(r.status, detail, name));
      }

      const j = await r.json().catch(() => null);
      const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
      const txt = Array.isArray(parts) ? parts.map(p => p && p.text || "").join("") : "";
      if (!txt.trim()) { last = new Error("Gemini boş cavab qaytardı"); return { kind: "empty" }; }
      modelCooldown.delete(name);
      return { kind: "ok", text: txt };
    };

    // Mərhələ 1: əsas model, sonra açar üçün mövcud olan 2 ehtiyat model.
    let res = await attempt(m, API);
    if (res.kind === "ok") return res.text;
    if (res.kind === "rate") {
      await sleep(res.delay || 2000);
      const again = await attempt(m, API);
      if (again.kind === "ok") return again.text;
      throw again.kind === "rate" ? last : (last || new Error("Gemini 429"));
    }
    // v1beta 5xx verdisə, eyni modeli sabit v1 endpoint-i ilə də yoxla.
    if (res.kind === "retry") {
      const stable = await attempt(m, API_V1);
      if (stable.kind === "ok") return stable.text;
      if (stable.kind !== "net" && stable.kind !== "retry" && stable.kind !== "empty") res = stable;
    }

    const available = await geminiAvailableModels(apiKey);
    const chain = geminiFallbackChain(m, available);
    if (res.kind !== "ok") {
      for (const name of chain.slice(1)) {
        const x = await attempt(name, API);
        if (x.kind === "ok") return x.text;
        if (x.kind === "rate") { await sleep(x.delay || 2000); const y = await attempt(name, API); if (y.kind === "ok") return y.text; throw last || new Error("Gemini 429"); }
      }
    }

    // Mərhələ 2: Google-un qısa yüklənmə pəncərəsini gözlə, sonra ən yaxşı modeli təkrar yoxla.
    if (saw503) {
      await sleep(4000);
      const x = await attempt(chain[0], API);
      if (x.kind === "ok") return x.text;
      await sleep(9000);
      // Son cəhd: v1 sabit endpoint + əsas model.
      const y = await attempt(chain[0], API_V1);
      if (y.kind === "ok") return y.text;
      const third = await attempt(chain[1] || chain[0], API);
      if (third.kind === "ok") return third.text;
      rateGateUntil = Math.max(rateGateUntil, Date.now() + 15000);
      throw new Error(geminiFriendlyError(503, lastDetail, chain[0]) + " 20–30 saniyə sonra «Yenidən cəhd et» basın.");
    }

    throw last || new Error("Gemini sorğusu alınmadı");
  }

  function parseNumbered(text, first, count) {
    const map = new Map();
    for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
      const line = raw.replace(/^\s*[-*•]\s*/, "").replace(/^\s*`+|`+\s*$/g, "");
      const m = line.match(/^\s*(\d+)\s*[|:.)\-]\s*(.*?)\s*$/);
      if (!m) continue;
      const n = +m[1];
      if (n >= first && n < first + count && m[2]) map.set(n, m[2]);
    }
    return map;
  }

  async function translateChunk({ ch, apiKey, model, target, targetName, maxTokens = 0, strict = false, style = "default", complete = false }) {
    const first = ch.start + 1;
    const sourceLines = ch.items.map((c, i) => `${first + i}|${String(c.text || "").replace(/\s+/g, " ").trim()}`).join("\n");
    const styleKey = STYLE_RULES[style] ? style : "default";
    const key = [normCode(target), String(model || ""), styleKey, complete ? "full" : "line", hashText(sourceLines)].join("|");
    const cached = cacheGet(key);
    if (cached) return cached;

    const prompt = [
      `You are a professional subtitle translator and a meticulous native ${targetName} proofreader. Translate every numbered subtitle line into ${targetName} (${target || "target"}).`,
      "Write natural, fluent lines with correct grammar, spelling, punctuation, capitalization, and diacritics in the target language. Silently proofread every translated line and fix every error before returning it.",
      "Use the standard script and orthography of the target language. Do not transliterate. Do not leave source-language words unless they are proper names or untranslatable technical terms.",
      "Keep the exact numbering and the same number of lines. Preserve names, numbers and meaning. Do not change timestamps or timing. Do not add or omit information.",
      STYLE_RULES[styleKey] || "",
      "Do not translate or output non-speech annotations such as [Music], [Applause], (laughs), ♪ and sound effects. Omit them completely.",
      complete ? "IMPORTANT: This is a complete song-lyrics translation. Every returned line must be 100% in the target language. Never copy the source sentence, never mix source and target languages, and never leave source-language words except proper names. Translate every input line from scratch; do not omit, summarize or shorten lines." : "",
      "Return ONLY the final corrected lines in the format `N|translated text`, one line per input. Do not show the pre-correction version or add timestamps, notes or commentary.",
      "", sourceLines
    ].filter(Boolean).join("\n");
    const out = await geminiCall(apiKey, model, prompt,
      maxTokens || Math.min(8192, 1200 + ch.items.length * 150), { attempts: 3, timeout: 180000, temperature: 0.1 });
    const map = parseNumbered(out, first, ch.items.length);
    // 1:1 xəritə bütöv olmalıdır: təkrar nömrə, itmiş sətir və ya sürüşmüş
    // nömrələmə varsa, daha kiçik hissələrlə yenidən tərcüməyə keç.
    if ((strict || complete) && map.size !== ch.items.length) {
      throw new Error("Gemini sətir xəritəsi 1:1 deyil");
    }
    let missing = 0;
    const values = ch.items.map((c, i) => {
      const val = map.get(first + i);
      if (val && val.trim()) return cleanCueText(val);
      missing++;
      return c.text;
    });
    if (missing) {
      if (strict || complete) throw new Error("Gemini bütün subtitle sətirlərini qaytarmadı");
      if (missing === ch.items.length) throw new Error("Gemini cavabı numbered subtitle formatında deyil");
    }
    if (!missing) cacheSet(key, values);
    return values;
  }

  function splitCues(cues, n = 3) {
    const list = Array.isArray(cues) ? cues : [];
    const count = Math.max(1, Math.min(+n || 3, list.length || 1));
    if (!list.length) return [];
    const out = [];
    for (let i = 0; i < count; i++) {
      const start = Math.floor(list.length * i / count);
      const end = Math.floor(list.length * (i + 1) / count);
      if (end > start) out.push({ start, items: list.slice(start, end) });
    }
    return out;
  }

  async function translatePart({ part, apiKey, model, target, targetName, style = "default", complete = false }) {
    // Əvvəl bütün hissəni tək sorğu ilə tərcümə et.
    try {
      return await translateChunk({
        ch: part, apiKey, model, target, targetName, style, complete,
        maxTokens: 32768, strict: true
      });
    } catch (e) {
      // 429/kvota: daha çox sorğu vəziyyəti pisləşdirir.
      if (/429|too many requests|quota|rate limit|resource_exhausted/i.test(String(e && e.message || e))) throw e;
      // Cavab limitə düşübsə: yalnız bu hissəni böyük ardıcıl bloklara böl.
    }
    const chunks = chunkCues(part.items, CHUNK_MAX_CHARS, CHUNK_MAX_CUES);
    const values = part.items.map(c => c.text);
    for (const ch of chunks) {
      try {
        const got = await translateChunk({
          ch: { start: 0, items: ch.items }, apiKey, model, target, targetName, style,
          strict: complete, complete
        });
        for (let i = 0; i < ch.items.length; i++) values[ch.start + i] = got[i];
      } catch (e) {
        // Mahnı rejimində heç bir sətir mənbə dilində qalmamalıdır: problemi
        // daha kiçik (tək sətirlik) sorğularla həll etməyə çalışırıq.
        if (/429|too many requests|quota|rate limit|resource_exhausted/i.test(String(e && e.message || e))) throw e;
        if (!complete) throw e;
        for (let j = 0; j < ch.items.length; j++) {
          const one = await translateChunk({
            ch: { start: 0, items: [ch.items[j]] }, apiKey, model, target, targetName, style,
            strict: true, complete: true
          });
          values[ch.start + j] = one[0];
        }
      }
    }
    return values;
  }

  // Mahnı klipi: internetdən götürülmüş rəsmi sözləri mövcud zamanlanmış sətirlərlə
  // uyğunlaşdırır. Sətir sayı, sıra və start/end dəyişmir; yalnız mətn düzəldilir.
  // Mahnı sözlərindəki sətirləri mənbə cue-larının real vaxtlarına bağlayır.
  // Mətn rəsmi sözlərdən, start/end isə video-dakı real cue-lardan götürülür.
  function lyricTokenize(text) {
    return String(text || "").normalize("NFKC").toLowerCase()
      .replace(/\[[^\]]*\]/g, " ")
      .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }
  function alignLyricsLinesToCues({ cues, lyrics, minCoverage = 0.32 } = {}) {
    const list = (Array.isArray(cues) ? cues : []).map(c => ({
      start: Math.max(0, Math.round(+c.start || 0)),
      end: Math.max(0, Math.round(+c.end || 0)),
      text: cleanCueText(c && c.text)
    })).filter(c => c.text && c.end >= c.start).sort((a, b) => a.start - b.start);
    if (list.length < 2) return null;

    const lines = [];
    for (const raw of cleanLyricsText(lyrics).split("\n")) {
      const line = raw.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (/^(?:verse|chorus|bridge|intro|outro|hook|pre[- ]?chorus|refrain|instrumental|music)(?:\s*\d+)?(?:\s*[:\-–—].*)?$/i.test(line)) continue;
      lines.push(line);
    }
    if (lines.length < 2) return null;

    const lineTokens = lines.map(lyricTokenize);
    const flat = [], lineOf = [];
    lineTokens.forEach((tokens, li) => tokens.forEach(t => { flat.push(t); lineOf.push(li); }));
    const src = [], cueOf = [], posOf = [], cueTokCount = [];
    list.forEach((c, ci) => {
      const tokens = lyricTokenize(c.text);
      cueTokCount[ci] = tokens.length;
      tokens.forEach((t, p) => { src.push(t); cueOf.push(ci); posOf.push(p); });
    });
    const n = flat.length, m = src.length;
    if (n < 6 || m < 6 || n > 4000 || m > 4000) return null;

    // LCS: sözlərin sırasını qoruyaraq sətir sözlərini cue sözlərinə bağlayır.
    const W = m + 1;
    const dp = new Uint16Array((n + 1) * W);
    for (let i = 1; i <= n; i++) {
      const a = flat[i - 1], row = i * W, prev = (i - 1) * W;
      for (let j = 1; j <= m; j++) {
        dp[row + j] = a === src[j - 1]
          ? dp[prev + j - 1] + 1
          : Math.max(dp[prev + j], dp[row + j - 1]);
      }
    }
    const matches = [];
    let i = n, j = m;
    while (i > 0 && j > 0) {
      if (flat[i - 1] === src[j - 1]) { matches.push([i - 1, j - 1]); i--; j--; }
      else if (dp[(i - 1) * W + j] >= dp[i * W + j - 1]) i--;
      else j--;
    }
    matches.reverse();
    const coverage = n ? matches.length / n : 0;
    const matchedLines = new Set(matches.map(([li]) => lineOf[li]));
    if (matches.length < 8 || coverage < minCoverage || matchedLines.size < 3) return null;

    // Hər cue-nun real start/end-i onun əhatə etdiyi lyric sətirləri arasında
    // cue-dəki uyğun söz sayına və söz sırasına görə bölünür. Beləliklə bir neçə
    // sətir bir cue-ya düşsə də, hər sətir real danışıq sırasını alır.
    const cueLine = new Map();
    for (const [li, si] of matches) {
      const ci = cueOf[si], line = lineOf[li], pos = posOf[si] || 0;
      if (!cueLine.has(ci)) cueLine.set(ci, new Map());
      const item = cueLine.get(ci).get(line) || { count: 0, first: pos };
      item.count++;
      item.first = Math.min(item.first, pos);
      cueLine.get(ci).set(line, item);
    }
    const segments = new Map();
    for (const [ci, lineMap] of cueLine) {
      const c = list[ci];
      const arr = [...lineMap.entries()].sort((a, b) => a[1].first - b[1].first || a[0] - b[0]);
      if (!arr.length) continue;
      const total = arr.reduce((n, x) => n + Math.max(1, x[1].count), 0) || arr.length;
      let at = c.start;
      for (let z = 0; z < arr.length; z++) {
        const line = arr[z][0], weight = Math.max(1, arr[z][1].count);
        const end = z === arr.length - 1 ? c.end : at + (c.end - c.start) * weight / total;
        if (!segments.has(line)) segments.set(line, []);
        segments.get(line).push({ start: Math.round(at), end: Math.max(Math.round(at) + 60, Math.round(end)) });
        at = end;
      }
    }

    let out = [];
    for (const [line, segs] of segments) {
      const text = lines[line];
      if (!text || !segs.length) continue;
      const start = Math.min(...segs.map(x => x.start));
      const end = Math.max(...segs.map(x => x.end));
      if (end > start) out.push({ start, end, text });
    }
    out.sort((a, b) => a.start - b.start || a.end - b.end);
    if (out.length < 3) return null;

    // Sətirlər arasında üst-üstə düşməni kəs və boşluğu tarazlaşdır.
    for (let k = 0; k < out.length; k++) {
      const c = out[k], next = out[k + 1];
      if (next && c.end >= next.start) {
        const mid = Math.round((c.end + next.start) / 2);
        c.end = Math.max(c.start + 60, mid - 20);
        if (next.start <= c.end) next.start = Math.min(next.end - 60, mid + 20);
      }
      if (c.end <= c.start) c.end = c.start + 120;
    }
    out = out.filter(c => c.text && c.end > c.start);
    return out.length >= 3 ? out : null;
  }

  async function correctWithLyrics({ cues, lyrics, apiKey, model, onProgress }) {
    const list = Array.isArray(cues) ? cues : [];
    const ref = cleanLyricsText(lyrics).slice(0, 24000);
    if (!list.length || ref.length < 30) return list;
    const sourceLines = list.map((c, i) => `${i + 1}|${String(c.text || "").replace(/\s+/g, " ").trim()}`).join("\n");
    const prompt = [
      "You align official song lyrics with timed caption cues.",
      "The timed cues below may come from automatic speech recognition and can contain wrong words, homophones, missing words, or duplicated lines. Use the reference lyrics as the authority.",
      "For every cue, replace its text with the exact lyric words that are sung during that cue. Keep the same cue numbers, order, line count and line boundaries. Do not add, remove, split, merge or reorder cues. Do not change timing.",
      "If a cue is instrumental, has no sung words, or cannot be matched, return an empty text after the pipe for that cue.",
      "Preserve the original language of the song; do not translate. Do not add timestamps, labels, notes, explanations or metadata.",
      "Return ONLY lines in the format N|corrected lyric text, one line for every input cue.",
      "", "REFERENCE LYRICS:", ref, "", "TIMED CUES:", sourceLines
    ].join("\n");
    const maxTokens = Math.min(32768, Math.max(4096, 2200 + list.length * 90));
    if (onProgress) onProgress(12, "Mahnı sözləri uyğunlaşdırılır…", 0);
    const out = await geminiCall(apiKey, model, prompt, maxTokens, { attempts: 2, timeout: 180000, temperature: 0.05 });
    const map = parseNumbered(out, 1, list.length);
    let changed = 0;
    const result = list.map((c, i) => {
      const v = map.get(i + 1);
      const text = v ? cleanCueText(v) : "";
      if (text) { changed++; return { ...c, text }; }
      return { ...c };
    });
    if (changed < Math.max(2, Math.ceil(list.length * 0.8))) throw new Error("Mahnı sözləri ilə uyğunlaşdırma alınmadı");
    if (onProgress) onProgress(16, "Mahnı sözləri düzəldildi…", 0);
    return result;
  }

  function audioTimeMs(v) {
    if (typeof v === "number" && isFinite(v)) return v * 1000;
    const t = String(v || "").trim();
    if (!t) return NaN;
    const m = t.match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/);
    if (m) return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 + (+m[4] || 0) * (m[4] && m[4].length === 1 ? 100 : m[4] && m[4].length === 2 ? 10 : 1);
    const n = Number(t.replace(",", "."));
    return isFinite(n) ? n * 1000 : NaN;
  }

  async function analyzeMusicMedia({ videoUrl = "", title = "", artist = "", song = "", apiKey, model }) {
    if (!videoUrl || !apiKey || !model) return null;
    const prompt = [
      "Strictly analyze this YouTube video/audio as a music validator.",
      "Return ONLY valid JSON with this schema:",
      "{\"isMusic\":true|false,\"language\":\"az\",\"performance\":\"studio\"|\"live\"|\"acoustic\"|\"other\",\"nonMusicIntervals\":[{\"start\":0,\"end\":0,\"label\":\"\"}],\"confidence\":0.0}",
      "isMusic must be true only if the main content is an actual song/music track with singing. False for podcast, interview, vlog, speech, film scene, dialogue, or instrumental-only.",
      "language is the language of the sung lyrics (ISO 639-1), not the title language.",
      "If performance is live/concert/acoustic: list every interval where there is talking, shouting, audience applause, band introduction, silence, or no singing. Use seconds with decimal precision. Write each label in Azerbaijani. Otherwise return an empty array.",
      "Do not invent intervals; keep each interval tight. Do not translate lyrics. Confidence 0..1.",
      "Title: " + String(title || ""),
      "Artist: " + String(artist || ""),
      "Song: " + String(song || "")
    ].join("\n");
    let out = "";
    try {
      out = await geminiCall(apiKey, model, prompt, 1600, {
        videoUri: videoUrl, videoMime: "video/mp4", temperature: 0, attempts: 2, timeout: 70000
      });
    } catch { return null; }
    let t = String(out || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    try {
      const j = JSON.parse(t);
      const intervals = (Array.isArray(j.nonMusicIntervals) ? j.nonMusicIntervals : [])
        .map(x => ({ start: Math.max(0, +x.start || 0), end: Math.max(0, +x.end || 0), label: String(x.label || "").trim() }))
        .filter(x => x.end > x.start + 0.4 && x.label)
        .sort((a, b) => a.start - b.start);
      const rawLang = String(j.language || "").toLowerCase().split("-")[0];
      const language = ({ aze: "az", azerbaijani: "az", azeri: "az", tur: "tr", turkish: "tr", eng: "en", english: "en", rus: "ru", russian: "ru", spa: "es", fra: "fr", deu: "de", ger: "de" })[rawLang] || rawLang;
      const performance = String(j.performance || "other").toLowerCase();
      return { isMusic: !!j.isMusic, language, performance, nonMusicIntervals: intervals, confidence: +j.confidence || 0 };
    } catch { return null; }
  }

  function lyricsSimilarity(a, b) {
    const tok = v => new Set(String(v || "").toLowerCase()
      .replace(/\[[^\]]*\]/g, " ")
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
      .replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u")
      .split(/[^a-z0-9]+/).filter(Boolean));
    const A = tok(a), B = tok(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const x of A) if (B.has(x)) hit++;
    return hit / Math.max(1, Math.min(A.size, B.size));
  }

  async function classifySong({ title = "", channel = "", apiKey, model }) {
    if (!title || !apiKey || !model) return null;
    const prompt = [
      "Use web search to determine whether this YouTube video is a song/music track.",
      "Be conservative: if the evidence is weak, return isSong=false.",
      "Also determine the original language of the sung lyrics (ISO 639-1, e.g. az, tr, en, ru).",
      "Return ONLY valid JSON: {\"isSong\":true|false,\"language\":\"xx\",\"artist\":\"\",\"song\":\"\",\"confidence\":0.0}",
      "Do not add markdown or commentary.",
      "Title: " + String(title),
      "Channel: " + String(channel)
    ].join("\n");
    let out = "";
    try {
      out = await geminiCall(apiKey, model, prompt, 700, {
        tools: [{ google_search: {} }], temperature: 0, attempts: 2, timeout: 45000
      });
    } catch { return null; }
    let t = String(out || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    try {
      const j = JSON.parse(t);
      const rawLang = String(j.language || "").toLowerCase().split("-")[0];
      const lang = ({ aze: "az", azerbaijani: "az", azeri: "az", tur: "tr", turkish: "tr", eng: "en", english: "en", rus: "ru", russian: "ru", spa: "es", fra: "fr", deu: "de", ger: "de" })[rawLang] || rawLang;
      return { isSong: !!j.isSong && String(j.confidence ?? 1) !== "0", language: lang, artist: String(j.artist || ""), song: String(j.song || ""), confidence: +j.confidence || 0 };
    } catch { return null; }
  }

  async function proofreadAzLyrics({ cues, apiKey, model, onProgress }) {
    const list = Array.isArray(cues) ? cues : [];
    if (!list.length || !apiKey || !model) return list;
    const sourceLines = list.map((c, i) => `${i + 1}|${String(c.text || "").replace(/\s+/g, " ").trim()}`).join("\n");
    const prompt = [
      "You are a meticulous Azerbaijani orthography, grammar and punctuation proofreader.",
      "Correct ONLY spelling, diacritics, punctuation and grammar in the numbered lyric lines.",
      "Do not translate, rewrite, paraphrase, shorten, expand, merge, split or reorder lines. Keep every word, slang expression, name and the original meaning exactly.",
      "Return exactly one line for every input line in the format N|corrected text. Do not add timestamps, labels, notes or commentary.",
      "", "LINES:", sourceLines
    ].join("\n");
    let out = "";
    try {
      out = await geminiCall(apiKey, model, prompt, 32768, { temperature: 0, attempts: 2, timeout: 60000 });
    } catch { return list; }
    const map = parseNumbered(out, 1, list.length);
    if (!map.size) return list;
    return list.map((c, i) => (c.tag || /^\[\d{1,2}:\d{2} - \d{1,2}:\d{2}\]/.test(String(c.text || ""))) ? { ...c } : ({ ...c, text: map.get(i + 1) || c.text }));
  }

  async function findLyrics({ artist = "", song = "", apiKey, model }) {
    const a = String(artist || "").trim();
    const t = String(song || "").trim();
    if (!a && !t) return "";
    const prompt = [
      "Search the web for the complete official lyrics of the requested song.",
      "Return ONLY the lyrics in the original language, with the original line breaks.",
      "Do not translate, transliterate, summarize, label sections, explain, or add sources/URLs/commentary.",
      "If you cannot verify the lyrics, return exactly EMPTY.",
      "Artist: " + a,
      "Song: " + t
    ].join("\n");
    let out = "";
    try {
      out = await geminiCall(apiKey, model, prompt, 4096, {
        tools: [{ google_search: {} }], temperature: 0, attempts: 2, timeout: 45000
      });
    } catch { return ""; }
    let text = String(out || "").replace(/\r/g, "").replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/i, "").trim();
    // Remove common model wrappers/citations, keep the lyrics themselves.
    text = text.replace(/^(?:here (?:are|is) (?:the )?(?:official )?lyrics[^\n]*|lyrics)\s*:?\s*/i, "").trim();
    text = text.split("\n").filter(l => !/^\s*(?:source|mənbə|url)\s*:/i.test(l)).join("\n").trim();
    if (/^EMPTY$/i.test(text) || text.length < 40) return "";
    return cleanLyricsText(text).slice(0, 24000);
  }

  async function alignLyricsWithAudio({ audio, lyrics = "", apiKey, model, duration = 0, onProgress }) {
    if (!audio || !audio.data) throw new Error("Audio məlumatı yoxdur");
    const ref = cleanLyricsText(lyrics).slice(0, 24000);
    if (onProgress) onProgress(12, ref ? "Audio Gemini-yə göndərilir · sözlər uyğunlaşdırılır…" : "Audio Gemini-yə göndərilir · mahnı sözləri çıxarılır…", 0);
    const prompt = [
      "You are a precise audio-to-subtitle aligner for a song.",
      "Listen to the provided audio carefully.",
      ref ? "The official lyrics are provided below. Use them as the authoritative text; correct ASR errors and align every lyric line to the moment it is sung." : "Transcribe the sung lyrics and produce timed subtitle cues.",
      "Return ONLY a valid JSON array with objects: {\"start\": <seconds>, \"end\": <seconds>, \"text\": \"<lyrics>\"}.",
      "start and end must be numeric seconds, monotonic, non-overlapping, and within the audio duration. Do not invent long gaps or merge unrelated lines.",
      "Write the lyrics in the original language of the song. Do NOT translate. Do NOT add timestamps, notes, labels, markdown or commentary outside the JSON.",
      duration > 0 ? `Audio duration is about ${Math.round(duration)} seconds.` : "",
      ref ? "\nOFFICIAL LYRICS:\n" + ref : ""
    ].filter(Boolean).join("\n");
    const out = await geminiCall(apiKey, model, prompt, 32768, {
      audio: { mimeType: audio.mimeType || "audio/mp3", data: audio.data },
      attempts: 2, timeout: 300000, temperature: 0.05
    });
    let arr = null;
    const raw = String(out || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      const j = JSON.parse(raw);
      arr = Array.isArray(j) ? j : (Array.isArray(j.cues) ? j.cues : null);
    } catch {
      const a = raw.indexOf("["), b = raw.lastIndexOf("]");
      if (a >= 0 && b > a) { try { const j = JSON.parse(raw.slice(a, b + 1)); arr = Array.isArray(j) ? j : null; } catch {} }
    }
    if (!Array.isArray(arr) || !arr.length) {
      // Bəzən model JSON yerinə SRT qaytarır; onu da qəbul et.
      try {
        const srtCues = parseSubtitle(raw, "srt", { youtube: false });
        if (srtCues && srtCues.length) arr = srtCues.map(c => ({ start: c.start / 1000, end: c.end / 1000, text: c.text }));
      } catch {}
    }
    if (!Array.isArray(arr) || !arr.length) throw new Error("Gemini audio cavabında vaxtlı sətirlər tapılmadı");
    const maxRaw = Math.max(...arr.map(x => +audioTimeMs(x && (x.start ?? x.begin ?? x.from)) || 0));
    const scale = duration > 0 && maxRaw > duration * 2000 ? 0.001 : 1;
    const cues = [];
    for (const x of arr) {
      if (!x || typeof x !== "object") continue;
      let st = audioTimeMs(x.start ?? x.begin ?? x.from) * scale;
      let en = audioTimeMs(x.end ?? x.finish ?? x.to) * scale;
      const tx = cleanCueText(x.text ?? x.lyrics ?? x.line ?? "").trim();
      if (!tx || !isFinite(st) || !isFinite(en)) continue;
      st = Math.max(0, st); en = Math.max(st + 80, en);
      if (duration > 0) en = Math.min(en, duration * 1000 + 500);
      cues.push({ start: st, end: en, text: tx });
    }
    cues.sort((a, b) => a.start - b.start);
    for (let i = 0; i < cues.length; i++) {
      const next = cues[i + 1];
      if (next && cues[i].end >= next.start) cues[i].end = Math.max(cues[i].start + 80, next.start - 40);
    }
    if (!cues.length) throw new Error("Gemini audio cavabı etibarsızdır");
    if (onProgress) onProgress(16, "Audio vaxtları hazırdır…", 0);
    return { cues, source: "gemini-audio" };
  }

  async function translateCues({ cues, apiKey, model, target, source, onProgress, parts, style = "default", song = false }) {
    if (!Array.isArray(cues) || !cues.length) throw new Error("Tərcümə üçün subtitr sətri yoxdur");
    const targetCode = baseLang(target);
    const targetName = langName(target) || langName(targetCode);
    const result = cues.map(c => ({ ...c }));

    // Mənbə dili artıq hədəf dildirsə, Gemini-yə heç müraciət etmə.
    const sourceCode = normCode(source), targetCodeFull = normCode(target);
    if (sourceCode && targetCodeFull && sourceCode === targetCodeFull && (!style || style === "default")) {
      if (onProgress) onProgress(84, `Tərcümə lazım deyil · ${targetName}`, 0);
      return result;
    }

    // Mahnı rejimində bütün mətni bir kontekstdə tərcümə etməyə çalışırıq; bu,
    // hissələr arasında yarımçıq/qarışıq dil yaranmasının qarşısını alır.
    const work = song ? [{ start: 0, items: cues }] : ((Array.isArray(parts) && parts.length === 3) ? parts : splitCues(cues, 3));
    const total = work.length;
    const totalChars = cues.reduce((n, c) => n + String(c.text || "").length, 0);
    const initialEta = Math.max(5, Math.ceil(totalChars / 7000 * 1.7));
    const started = Date.now();
    let done = 0;
    if (onProgress) onProgress(12, `Tərcümə (Gemini): ${cues.length} sətir · 0/${total} hissə · ${targetName}`, initialEta);

    const tick = setInterval(() => {
      if (done >= total) return;
      const elapsed = (Date.now() - started) / 1000;
      const frac = Math.min(0.9, elapsed / Math.max(1, initialEta));
      const pct = Math.min(84, Math.round(12 + 72 * ((done + frac) / total)));
      const perPart = done ? elapsed / done : initialEta / total;
      const remaining = total - done;
      const eta = remaining ? Math.max(1, Math.ceil(perPart * Math.ceil(remaining / Math.min(3, total)))) : 0;
      if (onProgress) onProgress(pct, `Tərcümə (Gemini): ${cues.length} sətir · ${done}/${total} hissə · ${Math.round(elapsed)} s`, eta);
    }, 1000);

    let settled;
    try {
      settled = await Promise.allSettled(work.map(part => translatePart({
        part, apiKey, model, target, targetName, style, complete: song
      })));
    } finally {
      clearInterval(tick);
    }

    const valuesByPart = new Array(total);
    for (let i = 0; i < total; i++) {
      if (settled[i].status === "fulfilled") valuesByPart[i] = settled[i].value;
    }
    // Bir hissə 429/xəta ilə düşərsə, digərləri bitdikdən sonra yalnız həmin hissəni
    // təkrar yoxla (paralel retry storm yaratmır).
    for (let i = 0; i < total; i++) {
      if (valuesByPart[i]) continue;
      try {
        valuesByPart[i] = await translatePart({
          part: work[i], apiKey, model, target, targetName, style, complete: song
        });
      } catch (e) {
        throw (settled[i] && settled[i].reason) || e;
      }
    }

    for (let pi = 0; pi < total; pi++) {
      const part = work[pi], values = valuesByPart[pi];
      for (let i = 0; i < part.items.length; i++) {
        const srcCue = cues[part.start + i];
        const keepTag = !!(srcCue && (srcCue.tag || /^\[\d{1,2}:\d{2} - \d{1,2}:\d{2}\]/.test(String(srcCue.text || ""))));
        result[part.start + i].text = keepTag ? srcCue.text : values[i];
      }
      done = pi + 1;
      const elapsed = (Date.now() - started) / 1000;
      const perPart = elapsed / done;
      const remaining = total - done;
      const eta = remaining ? Math.max(1, Math.ceil(perPart * Math.ceil(remaining / Math.min(3, total)))) : 0;
      const pct = Math.round(12 + 72 * done / total);
      if (onProgress) onProgress(pct, `Tərcümə (Gemini): ${cues.length} sətir · ${done}/${total} hissə · ${Math.round(elapsed)} s`, eta);
    }
    if (onProgress) onProgress(84, `Tərcümə (Gemini): ${cues.length} sətir · ${total}/${total} hissə hazır`, 0);
    return result;
  }

  // ---- YouTube canlı (caption-by-caption) tərcüməsi ----
  const liveCache = new Map();
  const LIVE_CACHE_MAX = 240;
  function liveLines(text) {
    const out = [];
    for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (!out.some(x => x.toLowerCase() === line.toLowerCase())) out.push(line);
    }
    return out;
  }
  function liveClean(text) {
    let s = String(text || "").trim();
    s = s.replace(/^```(?:[a-z0-9_-]+)?\s*/i, "").replace(/\s*```$/i, "").trim();
    s = s.replace(/^(?:translation|tərcümə|çeviri)\s*:\s*/i, "").trim();
    return liveLines(s).slice(-2).join("\n");
  }
  function liveCacheGet(key) {
    const v = liveCache.get(key);
    if (v) { liveCache.delete(key); liveCache.set(key, v); }
    return v;
  }
  function liveCacheSet(key, value) {
    liveCache.delete(key); liveCache.set(key, value);
    while (liveCache.size > LIVE_CACHE_MAX) liveCache.delete(liveCache.keys().next().value);
  }
  async function translateLive({ text, apiKey, model, target }) {
    const source = liveLines(text).join("\n");
    if (!source) return "";
    const code = baseLang(target) || "az";
    const targetName = langName(target) || langName(code);
    const key = [code, String(model || ""), hashText(source)].join("|");
    const cached = liveCacheGet(key);
    if (cached) return cached;
    const prompt = [
      `Translate this YouTube caption into ${targetName}. Preserve line breaks and natural spoken style.`,
      `Use correct ${targetName} grammar, spelling, punctuation, capitalization, and diacritics. Silently proofread the result and correct every error. Use the standard script; do not transliterate.`,
      "Return ONLY the final translated caption. Do not include the original, quotes, notes, numbering, or a translation label.",
      "Omit non-speech annotations such as [Music], [Applause], (laughs), ♪ and sound effects completely.",
      "Do not repeat a line that is already present in the caption.", "", source
    ].join("\n");
    const out = await geminiCall(apiKey, model, prompt, 700, { timeout: 15000, attempts: 2 });
    const value = liveClean(out);
    if (!value) throw new Error("Gemini canlı alt yazı üçün boş cavab qaytardı");
    liveCacheSet(key, value);
    return value;
  }

  // ---- Sİ: 23 AI xüsusiyyəti üçün ümumi icraçı (yalnız transkript mətni) ----
  const FEATURE_FORMATS = {
    sections: "Hər hissə ayrı element olsun: «Giriş», «Əsas mövzular», «Yekun nəticə».",
    index: "Hər element açar sözün keçdiyi BİR yerdir: text = həmin dəqiq cümlə (snippet), title = açar söz + 2–4 sözlük kontekst.",
    dict: "Hər element BİR sözdür: title = sözün altyazıda yazıldığı TAM forması, text = hərfi (sözbəsöz) Azərbaycan tərcüməsi, fields MÜTLƏQ: «Tərcümə».",
    qa: "Hər element BİR kartdır. fields MÜTLƏQ: «Ön üz» və «Arxa üz».",
    cheatsheet: "Hər element bir bölmədir; text daxilində «• » ilə maddələr yaz.",
    quiz: "Hər element BİR sualdır: question = sual mətni (variantlar OLMADAN), options = 4 variantdan ibarət massiv, correctIndex = düzgün variantın 0–3 indeksi, explanation = 2 cümləlik izah.",
    idioms: "Hər element BİR ifadədir: title = idiom/frazeologizm, fields MÜTLƏQ: «Məcazi mənası», «Videodakı cümlə».",
    metrics: "items = bloklar üzrə statistika. `metrics` obyekti MÜTLƏQ yalnız Azərbaycan dilindəki açarlarla olsun: «Ümumi söz sayı», «Unikal söz sayı», «Leksik sıxlıq», «Qabaqcıl nisbət», «CEFR səviyyəsi».",
    quotes: "Hər element BİR sitat və ya tezisdir: text = canlı sitat (dəyişmədən) və ya əsas analitik tezis; fields MÜTLƏQ: «Növ» (Sitat/Tezis), «Danışan» (yalnız real spiker; Sistem/AI/Müəllif yazma). Sitat videodan kənar oxunduqda öz-özlüyündə məna kəsb etməlidir. Titr, müəllif hüququ, 'Sten Li tərəfindən uyğunlaşdırılmışdır', 'S.O.S...', tək sözlü qışqırıq, 1080p/fps/URL və rejissor-prodüser qeydləri sitat/tezis deyil. Tezis = videonun əsas ideyası/müəllifin ana arqumenti və birbaşa iddia kimi yazılmalıdır ('Kapital olmadan artım mümkün deyil'); 'Əsərin/videonun əsas ideyası...' kimi meta cümlə QADAĞANDIR. Başlıq manşet üslubunda və BÖYÜK HƏRFLƏRLƏ OLMASIN.",
    tone: "items = ardıcıl zaman blokları (üz-üzə); fields MÜTLƏQ: «Ton» (Neytral/Gərgin/Həyəcanlı/Kədərli/Mübahisəli).",
    filter: "YALNIZ açar sözlərə uyğun seqmentlər; uyğun olmayan heç nə qaytarma.",
    links: "Hər element BİR resursdur: title = ad, fields MÜTLƏQ: «Növ» (kitab/məqalə/sayt/alət).",
    claims: "Hər element BİR iddiadır: text = iddia, fields MÜTLƏQ: «Qərar» (Təsdiqlənib/Şübhəli/Kontekst tələb edir), «İzah» (maksimum 2 cümlə).",
    matrix: "Hər element BİR əsas fikirdir: text = fikir, fields MÜTLƏQ: «Zəif nöqtə», «Əks-arqument».",
    risk: "Hər element videonun BİR dəqiqəsi/seqmentidir (heç bir dəqiqəni atlama): text = həmin hissənin qısa təsviri, fields MÜTLƏQ: «Risk növü», «Risk %» (0–100 arası rəqəm, faiz işarəsi ilə), «Səbəb».",
    difficulty: "metrics MÜTLƏQ yalnız bu açarlarla: «Nitq sürəti (söz/dəq)», «Məlumat sıxlığı», «Çətinlik indeksi», «Orta cümlə uzunluğu». items = bloklar üzrə eyni göstəricilər.",
    stance: "items = danışan-münasibət cütləri; fields MÜTLƏQ: «Danışan» (kim), «Münasibət» (neytral/tənqidi/tərəfdaş/müttəfiq), «Kimə qarşı» (hədəf). Bütün danışanları ayrı-ayrı göstər.",
    fallacies: "Hər element BİR fallasiyadır: title = fallasiya adı (məs. Ad hominem), fields MÜTLƏQ: «Nümunə».",
    entities: "Hər element BİR varlıqdır: title = ad, fields MÜTLƏQ: «Növ» (şəxs/təşkilat/şirkət), «Əlaqə».",
    recipe: "items = addımlar (hər biri vaxt ilə). fields: «Tərkib» yalnız inqrediyent addımında.",
    contradictions: "Hər element BİR ziddiyyətdir: fields MÜTLƏQ: «Birinci ifadə», «İkinci ifadə» (hər ikisi vaxtı ilə).",
    acronyms: "Hər element BİR qısaltmadır: title = qısaltma, fields MÜTLƏQ: «Açılışı», «Kontekst»."
  };

  // Video məzmununa görə dinamik hissə sayı (minimum 20, məzmun artdıqca artır).
  function segmentTarget(feature, cues) {
    const first = +((cues[0] || {}).start || 0);
    const last = +((cues[cues.length - 1] || {}).end || 0);
    const minutes = Math.max(1, (last - first) / 60000);
    const words = cues.reduce((n, c) => n + String(c.text || "").split(/\s+/).filter(Boolean).length, 0);
    let n;
    if (feature && feature.format === "risk") n = Math.ceil(minutes);          // hər dəqiqə
    else n = Math.max(Math.ceil(minutes / 1.5), Math.ceil(words / 90));       // vaxt + söz sıxlığı
    return Math.max(20, Math.min(200, n));
  }

  // Lüğət: altyazıdakı bütün sözləri yazıldığı kimi toplayır (təkrar yox).
  function collectWords(cues) {
    const map = new Map();
    for (const c of cues) {
      for (const raw of String(c.text || "").split(/\s+/)) {
        const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        if (!w || !/\p{L}/u.test(w)) continue;
        if (!map.has(w)) map.set(w, { word: w, start: +c.start || 0, freq: 0 });
        map.get(w).freq++;
      }
    }
    return [...map.values()];
  }

  async function translateWords(words, { apiKey, model, onProgress, lang = "az" }) {
    const out = new Map();
    const CHUNK = 120;
    for (let pass = 0; pass < 2; pass++) {
      const pending = words.filter(x => !out.has(x.word));
      if (!pending.length) break;
      const total = Math.max(1, Math.ceil(pending.length / CHUNK));
      for (let i = 0; i < pending.length; i += CHUNK) {
        const part = pending.slice(i, i + CHUNK);
        const target = lang === "ru" ? "Russian" : lang === "en" ? "English" : "Azerbaijani";
        const prompt = [
          `Translate the following words ONLY into ${target}, literally, word by word.`,
          "Do not change the spelling, case or order. Give exactly one translation per word.",
          "Return ONLY JSON: {\"translations\":[{\"word\":\"...\",\"translation\":\"...\"}]}",
          "WORDS: " + JSON.stringify(part.map(x => x.word))
        ].join("\n");
        try {
          const raw = await geminiCall(apiKey, model, prompt, 8192, { attempts: 2, timeout: 180000, temperature: 0.1 });
          const parsed = self.IDM_AI_FEATURES.extractJson(raw);
          const rows = (parsed && (parsed.translations || parsed.items)) || [];
          for (const r of rows) {
            const w = String((r && (r.word || r.title)) || "").trim();
            const tr = String((r && (r.translation || r.text || r.value)) || "").trim();
            if (!w || !tr) continue;
            const exact = part.find(x => x.word === w) || part.find(x => x.word.toLowerCase() === w.toLowerCase());
            if (exact && !out.has(exact.word)) out.set(exact.word, tr);
          }
        } catch (e) { console.warn("lüğət tərcümə:", e); }
        if (onProgress) onProgress(10 + Math.round(70 * (i + part.length) / Math.max(1, pending.length)), `Lüğət tərcüməsi: ${Math.min(total, Math.floor(i / CHUNK) + 1)}/${total}`);
      }
    }
    return out;
  }

  async function runGlossary({ cues, apiKey, model, onProgress, lang = "az" }) {
    const F = self.IDM_AI_FEATURES;
    const words = collectWords(cues);
    if (!words.length) throw new Error("Altyazıda söz tapılmadı");
    if (onProgress) onProgress(8, `${words.length} söz çıxarıldı — tərcümə başlayır…`);
    const tr = await translateWords(words, { apiKey, model, onProgress, lang });
    const items = words
      .slice()
      .sort((a, b) => a.start - b.start)
      .map(w => {
        const translation = tr.get(w.word) || "";
        return {
          start: w.start, end: w.start + 1200, title: w.word, text: translation || "—",
          freq: w.freq,
          fields: [
            { label: "Tərcümə", value: translation || "—" },
            { label: "Tezlik", value: String(w.freq) }
          ]
        };
      });
    if (onProgress) onProgress(90, `${items.length} söz hazırdır`);
    return { items, metrics: null, summary: "", note: `${items.length} unikal söz` };
  }

  const wordsOf = s => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(w => w.length >= 3);
  const FILLER_RE = /^(salam|salamlar|necəsən|necəsiz|sağ ol|sağ olun|hə|yəni|tamam|bəli|xeyr|buyur|buyurun|görüşənədək|xoş gəldiniz|xoş gəldin|təşəkkür|çox sağ ol)/i;

  const SPEAKER_BAD = /^(sistem|system|ai|süni intellekt|avtomatik|naməlum|unknown|bot|müəllif|spiker|redaktor|redaksiya|author|speaker)$/i;

  function upperRatio(s) {
    const letters = String(s || "").replace(/[^\p{L}]/gu, "");
    if (!letters) return 0;
    const up = letters.replace(/[^\p{Lu}]/gu, "").length;
    return up / letters.length;
  }

  const NOISE_RE = /^[\[\(（]?\s*(s\s*\.?\s*o\s*\.?\s*s|sos|musiqi|music|səs|noise|applause|alqış|gülüş|laughter|telefon|phone|zəng|sirena|kamera|efekt|sfx|fon musiqisi)\b/i;
  const CREDIT_RE = /(tərəfindən\s+(uyğunlaşdır|hazırlan|tərcümə|səsləndir|yazıl|rejissorluq)|müəllif hüquq|copyright|all rights reserved|©|®|™|subtitr.*(hazırla|tərcümə)|(rejissor|prodüser|ssenarist|operator|montaj|dublyaj|studiya|kanal)\s*[:：])/i;
  const TECH_RE = /\b(\d{3,4}p|\d+\s?fps|\d+\s?k\b|uhd|hdr|web-?dl|blu-?ray|bdrip|webrip|x264|x265|hevc|aac|imdb|tt\d{5,})\b|https?:\/\/|@[\w.-]+\.[a-z]{2,}/i;

  function isJunkText(s) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (!t) return true;
    if (NOISE_RE.test(t)) return true;
    if (CREDIT_RE.test(t)) return true;
    if (TECH_RE.test(t)) return true;
    if (/^[\W_]+$/.test(t)) return true;
    if (wordsOf(t).length < 2) return true;
    return false;
  }

  // Videodan kənar oxunduqda öz-özlüyündə məna kəsb edən, yarımçıq olmayan cümlə.
  function isStandaloneQuote(s) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (!t) return false;
    if (/^[a-zəğıöşüç]/.test(t)) return false;                 // cümlə ortasından başlayır
    if (/[,;:–—-]\s*$/.test(t)) return false;                 // yarımçıq kəsilmiş
    if (/^(və|çünki|həmçinin|buna görə|bu səbəbdən|yəni|hansı ki)\b/i.test(t)) return false;
    if (/\b(və|və ya|ilə|üçün|görə|kimi)\s*[.!?…]?$/i.test(t)) return false;
    if (wordsOf(t).length < 4) return false;
    return true;
  }

  function isThesisMeta(s) {
    return /^(videonun|videoda|bu videoda|bu əsərdə|əsərin|filmin|serialın|müəllif(in)?\s|müəllifin əsas)/i.test(String(s || "").trim());
  }

  // Qəzet manşeti / BÖYÜK HƏRFLİ başlıq / mexaniki "Danışan: Sistem" yoxlaması.
  function isHeadlineLike(s) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (!t) return false;
    if (upperRatio(t) >= 0.65 && t.replace(/[^\p{L}]/gu, "").length >= 8) return true;
    if (/^(son dəqiqə|təcili|xəbər|açıqlama|şok|sensasiya|böyük həqiqət|diqqət|manşet|dünya|ölkə)\b/i.test(t)) return true;
    if (/^(danışan|müəllif|sistem|ai|süni intellekt)\s*[:：]/i.test(t)) return true;
    if (/[:：]\s*(sistem|ai|süni intellekt|avtomatik)\s*$/i.test(t)) return true;
    return false;
  }

  function stripMechanical(text) {
    return String(text || "")
      .replace(/\b(danışan|spiker|müəllif|sistem|ai|süni intellekt)\s*[:：]\s*(sistem|ai|süni intellekt|avtomatik|naməlum)?\s*/gi, "")
      .replace(/\s+/g, " ").trim();
  }

  // Sitat/tezis keyfiyyəti: real alt yazıya əsaslanan, manşetsiz, canlı cümlə.
  function cleanQuoteItem(it, cues) {
    if (!it) return null;
    let text = stripMechanical(it.text);
    let title = stripMechanical(it.title);
    if (!text) return null;
    if (isJunkText(text)) return null;
    if (isHeadlineLike(title) || isJunkText(title)) title = "";
    if (isHeadlineLike(text)) return null;
    if (!isStandaloneQuote(text)) return null;
    const qw = wordsOf(text);
    if (text.length < 20 || qw.length < 4) return null;
    if (FILLER_RE.test(text)) return null;

    const fields = Array.isArray(it.fields) ? it.fields.slice() : [];
    const kindField = fields.find(f => /növ|tip|type/i.test(String(f.label || "")));
    const rawKind = String((kindField && kindField.value) || "").toLowerCase();
    let kind = /tez|thes/.test(rawKind) ? "Tezis" : "Sitat";

    let speaker = "";
    const kept = [];
    for (const f of fields) {
      if (!f || (!f.label && !f.value)) continue;
      if (/növ|tip|type/i.test(String(f.label || ""))) continue;
      if (/danışan|spiker|speaker|müəllif/i.test(String(f.label || ""))) {
        const v = String(f.value || "").trim();
        if (v && !SPEAKER_BAD.test(v) && !isHeadlineLike(v)) speaker = v;
        continue;
      }
      kept.push(f);
    }
    kept.unshift({ label: "Növ", value: kind });
    if (speaker) kept.push({ label: "Danışan", value: speaker });

    const span = (cues || []).filter(c => +c.end > it.start && +c.start < it.end);
    const segmentText = span.map(c => String(c.text || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ").trim().slice(0, 900);
    if (!segmentText) return null;                       // alt yazıda qarşılığı yoxdursa uydurma sayılır
    const corpus = new Set(wordsOf(segmentText));
    let ratio = 0;
    if (corpus.size && qw.length) {
      let hit = 0;
      for (const w of qw) if (corpus.has(w)) hit++;
      ratio = hit / qw.length;
    }
    if (kind === "Tezis") {
      if (isThesisMeta(text)) return null;
      if (qw.length < 5 || text.length < 30) return null;
      if (ratio < 0.15) return null;
    } else {
      if (ratio >= 0.4) kind = "Sitat";
      else if (ratio >= 0.2) kind = "Tezis";
      else return null;
    }
    if (kind === "Tezis" && !title) title = "";
    kept.push({ label: "Seqment mətni", value: segmentText });

    return { ...it, title, text, quoteKind: kind, speaker, segmentText, fields: kept };
  }

  // Səthi, videoya baxmağı tələb edən və variantsız sualları çıxarır.
  function quizQuality(it) {
    const q = String((it && (it.text || it.title)) || "").replace(/\s+/g, " ").trim();
    if (q.length < 25) return false;
    if (/\b(videoda|videonu|videoya|müəllif deyir|mühazirədə|bu videoda)\b/i.test(q)) return false;
    if (/^(nə|necə|hansı|kim|harada|nə vaxt)\b.{0,30}\b(edilir|olunur|deyilir|baş verir|görünür)\?$/i.test(q)) return false;
    if (/^(bu|o|bunlar|orada)\s+nədir\?$/i.test(q)) return false;
    const opts = Array.isArray(it.options) ? it.options.map(x => String(x).trim()).filter(Boolean) : [];
    if (opts.length < 3) return false;
    if (new Set(opts.map(x => x.toLowerCase())).size < opts.length) return false;
    if (opts.some(x => x.length < 2)) return false;
    return true;
  }

  async function runFeature({ cues, feature, keyword = "", searchMode = "", apiKey, model, onProgress, lang = "az" }) {
    const F = self.IDM_AI_FEATURES;
    if (!F) throw new Error("AI kataloqu (ai-features.js) yüklənmədi");
    if (!feature || !feature.task) throw new Error("AI xüsusiyyəti seçilməyib");
    if (!Array.isArray(cues) || !cues.length) throw new Error("Subtitr mətni tapılmadı");
    if (feature.id === "glossary") return runGlossary({ cues, apiKey, model, onProgress, lang });

    const sentences = F.sentenceRows(cues);
    const lines = (sentences.length ? sentences : cues).map(c => {
      const txt = String(c.text || "").replace(/\s+/g, " ").trim();
      return txt ? `[${F.mmss(c.start)}-${F.mmss(c.end)}] ${txt}` : "";
    }).filter(Boolean);
    let transcript = lines.join("\n");
    if (transcript.length > 150000) transcript = transcript.slice(0, 150000) + "\n…";
    const isB = String(feature.mode || "B").toUpperCase() === "B";
    const fmt = String(feature.format || "");
    const target = segmentTarget(feature, cues);

    const makePrompt = (want, existing = []) => [
      "Sən video transkripti üzrə dərin analitik assistentsən. Yalnız aşağıdakı transkriptə əsaslan.",
      "QAYDALAR:",
      "1) Transkripti ƏVVƏLDƏN AXIRA qədər diqqətlə oxu və təhlil et; heç bir hissəni atlama.",
      "2) Hər tapıntı/seqment üçün MÜTLƏQ vaxt aralığı ver. Vaxtı YALNIZ verilmiş cümlə bloklarının [başlanğıc-bitiş] sərhədlərindən götür; cümləni ortadan kəsmə, seqmenti başqa mövzuya keçirmə. Aralığın məzmunu həmin alt yazıya tam uyğun olmalıdır.",
      "3) `title` çox qısa olmalıdır (maksimum 44 simvol), dırnaqsız, bir baxışda oxunan başlıq.",
      "3a) Yalnız transkriptdəki faktlara əsaslan. Ad, şəxs, hadisə, nəticə və ya başlıq UYDURMA. Transkriptdə olmayan nəticə çıxarma (məsələn, mətndə olmayan 'Hörümçək-Adam tapıldı' kimi nəticə qadağandır).",
      "3b) Meta-təsvir və şablon ifadələr YAZMA: 'bu funksiya', 'bu xüsusiyyət', 'süni intellekt vasitəsilə', 'ağıllı ... budur', 'qeyd edək ki, bu bölmə' kimi cümlələr olmasın. Birbaşa məzmunu təhlil et.",
      isB
        ? "4) `text` MÜTLƏQ maksimum 2 cümlə olsun: qısa, konkret və dəqiq. Uzun paraqraf, çoxcümləli bloklar YAZMA."
        : "4) `text` qısa və konkret olsun (1–2 cümlə) — bu rejim seqment seçimi üçündür.",
      `4a) Hissə sayı: MÜTLƏQ ${want} element ver. Az sayda element qaytarma; hər element ayrı tapıntı olsun, təkrarlama.`,
      feature.searchMode
        ? (String(searchMode).toLowerCase().includes("hərfi")
            ? "AXTARIŞ REJİMİ: HƏRFİ. Açar sözü transkriptdə YALNIZ hərfi (eyni hərflərlə) uyğunluqla axtar. Sinonim, məna variantı, təxmin və ya uydurma QADAĞANDIR. Yalnız həqiqətən keçən yerləri qaytar."
            : "AXTARIŞ REJİMİ: MƏNA. Açar sözün məna, sinonim və kontekstual variantlarını da nəzərə alaraq axtar.")
        : "",
      feature.quiz
        ? "TEST QAYDALARI: Hər sual MÜSTƏQİL olmalıdır — videonu izləməyən şəxs yalnız sual mətnindəki məlumatla cavabı tapa bilməlidir; zəruri premisa/kontekst sualın daxilində verilsin. 'Nə edilir?', 'Skan nəticəsi nədir?', 'Bu nədir?' kimi səthi suallar QADAĞANDIR. Əsas arqument, səbəb-nəticə, termin, müqayisə və nəticəyə fokuslan. 4 variant bir-birindən fərqli, inandırıcı və eyni qrammatik formada olsun; yalnız biri düzgün olsun."
        : "",
      feature.id === "quotes"
        ? "SİTAT QAYDALARI: Hər sitat/tezis MÜTLƏQ həmin seqmentin alt yazı mətninə əsaslanmalıdır; alt yazıda olmayan tezis və ya sitat yazma. Yalnız fəlsəfi, motivasiyaedici, dərin analitik və ya ideya baxımından bitkin CANLI cümlələri seç. Sitat videodan kənar oxunduqda öz-özlüyündə məna kəsb etməlidir; yarımçıq cümlə və 'və/çünki/yəni' ilə başlayan davam cümləsi sitat deyil. Titrlər, müəllif hüququ qeydləri ('Sten Li tərəfindən uyğunlaşdırılmışdır'), arxaplan səsləri ('S.O.S...'), tək sözdən ibarət qışqırıqlar, texniki məlumatlar (1080p, fps, URL, rejissor/prodüser/ssenarist) QƏTİYYƏN sitat/tezis deyil. Tezis yalnız videonun əsas ideyası/müəllifin ana arqumentidir və birbaşa iddia kimi yazılmalıdır; 'Əsərin/videonun əsas ideyası...' kimi meta cümlə və 'əsər məlumatı' tezis sayılmaz. Qəzet manşeti, BÖYÜK HƏRFLİ başlıq, xəbər başlığı, clickbait, 'Danışan: Sistem' QADAĞANDIR. Salamlaşma, gündəlik söhbət, reklam, emoji və doldurucu cümlələr YOX. Mənalı sitat yoxdursa, uydurma sitat yazma — ən vacib analitik tezisi «Növ: Tezis» kimi ver. Sitat alt yazıda keçdiyi KİMİ verilsin."
        : "",
      fmt && FEATURE_FORMATS[fmt] ? "STRUKTUR (mütləq): " + FEATURE_FORMATS[fmt] : "",
      feature.fields && feature.fields.length
        ? "`fields` obyekti MÜTLƏQ bu açarlarla doldurulmalıdır: " + feature.fields.map(x => "«" + x + "»").join(", ") + "."
        : "",
      feature.metrics ? "Cavabda `metrics` obyekti də olsun (yuxarıdakı açarlarla)." : "",
      isB
        ? "5) Elementlər arasında məntiqi ardıcıllıq qur; lazım olduqda alt-bəndlər və siyahılardan istifadə et."
        : "5) Elementləri vaxta görə artan sıra ilə ver.",
      "6) Cavab dili: YALNIZ " + (lang === "ru" ? "rus dili" : lang === "en" ? "ingilis dili" : "Azərbaycan dili") + ". Mənbə (transkript) başqa dildə olsa belə, bütün başlıqlar, suallar, variantlar, izahlar və nəticələr təmiz və təbii " + (lang === "ru" ? "rus" : lang === "en" ? "ingilis" : "Azərbaycan") + " dilinə çevrilməlidir. Başqa dildə söz və ya cümlə yazma.",
      feature.quiz
        ? "7) YALNIZ minimal JSON qaytar: {\"items\":[{\"start\":\"mm:ss\",\"end\":\"mm:ss\",\"question\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"correctIndex\":0,\"explanation\":\"...\"}]}"
        : "7) YALNIZ minimal JSON qaytar: {\"items\":[{\"start\":\"mm:ss\",\"end\":\"mm:ss\",\"title\":\"...\",\"text\":\"...\",\"fields\":{\"...\":\"...\"}}]" + (feature.metrics ? ",\"metrics\":{...}" : "") + "}",
      "8) Heç nə tapmasan: {\"items\":[]}",
      "",
      "TAPŞIRIQ: " + String(feature.task || "").replace(/\{SEGMENT_COUNT\}/g, String(want)),
      keyword ? "AÇAR SÖZ(LƏR): " + String(keyword).trim() : "",
      existing.length ? "ARTIQ VERİLMİŞ BƏNDLƏR (TƏKRARLAMA, onları yenidən yazma):\n" + existing.join("\n") : "",
      "",
      "TRANSKRIPT:",
      transcript
    ].filter(Boolean).join("\n");

    if (onProgress) onProgress(10, `Gemini ${target} hissə üçün analiz edir…`);
    const raw = await geminiCall(apiKey, model, makePrompt(target), isB ? 16384 : 8192, { attempts: 3, timeout: 240000, temperature: 0.2 });
    const parsed = F.extractJson(raw);
    if (!parsed) throw new Error("Gemini cavabı JSON formatında deyil");
    const snapOpts = { snap: feature.format !== "risk" };
    const quality = list => feature.quiz ? list.filter(quizQuality)
      : feature.id === "quotes" ? list.map(it => cleanQuoteItem(it, cues)).filter(Boolean) : list;
    let items = quality(F.normalizeItems(parsed, cues, 1000, snapOpts));

    // Qoruyucu: hesablanmış saydan az nəticə gələrsə, çatışmayanı tamamla.
    if (!feature.searchMode && items.length < target) {
      for (let pass = 0; pass < 2 && items.length < target; pass++) {
        const need = target - items.length;
        const have = items.map(x => "- " + String(x.title || x.text || "").slice(0, 90));
        try {
          if (onProgress) onProgress(55 + pass * 12, `Çatışmayan ${need} hissə tamamlanır…`);
          const raw2 = await geminiCall(apiKey, model, makePrompt(need, have), isB ? 16384 : 8192, { attempts: 2, timeout: 240000, temperature: 0.3 });
          const p2 = F.extractJson(raw2);
          const extra = quality(F.normalizeItems(p2 || [], cues, Math.max(60, need * 4), snapOpts));
          const seen = new Set(items.map(x => (String(x.title || "") + "|" + x.start).toLowerCase()));
          for (const it of extra) {
            const k = (String(it.title || "") + "|" + it.start).toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k); items.push(it);
          }
          items.sort((a, b) => a.start - b.start || a.end - b.end);
        } catch (e) { console.warn("hissə tamamlama:", e); break; }
      }
    }
    if (!items.length) throw new Error("AI nəticəsi boşdur");
    // Azərbaycan dili seçilibsə, çıxışı son dəfə Azərbaycan dilinə salırıq.
    // RU/EN üçün cavab artıq prompt-da həmin dildə tələb olunur.
    if (lang === "az") {
      if (onProgress) onProgress(75, "Mətn Azərbaycan dilinə uyğunlaşdırılır…");
      try { items = await ensureAzerbaijani(items, apiKey, model); } catch (e) { console.warn("az pass:", e); }
      if (feature.quiz) {
        try { items = await ensureQuizAzerbaijani(items, apiKey, model); } catch (e) { console.warn("quiz az pass:", e); }
      }
    }
    if (onProgress) onProgress(88, `${items.length} hissə hazırdır`);
    return { items, metrics: (parsed && parsed.metrics) || null,
             summary: String(parsed.summary || parsed.overview || "").slice(0, 2000) };
  }

  // Mode B çıxışını məcburi Azərbaycan dilinə çevirir (mənbə dilindən asılı olmayaraq).
  async function ensureAzerbaijani(items, apiKey, model) {
    if (!items.length) return items;
    const lines = items.map((it, i) => `${i + 1}|${it.title || ""}||${it.text || ""}`).join("\n");
    const prompt = [
      "Aşağıdakı sətirləri YALNIZ Azərbaycan dilinə çevir. Mətn artıq Azərbaycan dilindədirsə, olduğu kimi saxla.",
      "Məna, təfsilat və uzunluq qorunmalıdır; heç nə qısaltma, əlavə etmə və ya buraxma.",
      "Heç bir başqa dildə söz/cümlə qoyma. Formatı dəyişmə.",
      "Yalnız `N|başlıq||mətn` formatında cavab ver, hər sətir bir element.",
      "",
      lines
    ].join("\n");
    const out = await geminiCall(apiKey, model, prompt, Math.min(16384, 2000 + items.length * 400), { attempts: 2, timeout: 180000, temperature: 0.1 });
    const map = new Map();
    for (const raw of String(out || "").replace(/\r/g, "").split("\n")) {
      const m = raw.match(/^\s*(\d+)\s*\|\s*(.*?)\s*\|\|\s*(.*)$/);
      if (m) map.set(+m[1], { title: m[2].trim(), text: m[3].trim() });
    }
    if (!map.size) return items;
    return items.map((it, i) => {
      const v = map.get(i + 1);
      return v ? { ...it, title: (v.title || it.title).slice(0, 80), text: v.text || it.text } : it;
    });
  }

  // Quiz: sual, variantlar və izah məcburi Azərbaycan dilinə salınır.
  async function ensureQuizAzerbaijani(items, apiKey, model) {
    const quiz = items.filter(it => Array.isArray(it.options) && it.options.length);
    if (!quiz.length) return items;
    const lines = quiz.map((it, i) => `${i + 1}|${it.text || it.title || ""}||${it.options.join("\t")}||${it.explanation || ""}`).join("\n");
    const prompt = [
      "Aşağıdakı quiz sətirlərini YALNIZ Azərbaycan dilinə çevir. Başqa dildə söz qoyma.",
      "Sualı, hər variantı və izahı tərcümə et; variantların sayını və sırasını DƏYİŞMƏ.",
      "Yalnız `N|sual||variant1<TAB>variant2<TAB>variant3<TAB>variant4||izah` formatında cavab ver.",
      "",
      lines
    ].join("\n");
    const out = await geminiCall(apiKey, model, prompt, Math.min(16384, 1500 + quiz.length * 500), { attempts: 2, timeout: 180000, temperature: 0.1 });
    const map = new Map();
    for (const raw of String(out || "").replace(/\r/g, "").split("\n")) {
      const m = raw.match(/^\s*(\d+)\s*\|\s*(.*?)\s*\|\|\s*(.*?)\s*\|\|\s*(.*)$/);
      if (!m) continue;
      const opts = m[3].split("\t").map(x => x.trim()).filter(Boolean);
      if (opts.length >= 2) map.set(+m[1], { q: m[2].trim(), opts, exp: m[4].trim() });
    }
    if (!map.size) return items;
    let k = 0;
    return items.map(it => {
      if (!(Array.isArray(it.options) && it.options.length)) return it;
      const v = map.get(++k);
      if (!v) return it;
      const options = v.opts.slice(0, it.options.length);
      const ci = Math.max(0, Math.min(options.length - 1, Number(it.correctIndex) || 0));
      const fields = options.map((x, i) => ({ label: "ABCDEF"[i] || String(i + 1), value: x }));
      fields.push({ label: "Düzgün cavab", value: "ABCDEF"[ci] || String(ci + 1) });
      if (v.exp) fields.push({ label: "İzah", value: v.exp });
      return { ...it, title: (v.q || it.title).slice(0, 90), text: v.q || it.text, options, correctIndex: ci, explanation: v.exp || it.explanation || "", fields };
    });
  }

  // ---- Sİ: Genişləndir / i (araşdırma) / Daha çox ----
  // Modelin meta-təsvir/şablon cümlələrini çıxarır.
  function cleanMeta(input) {
    const txt = String(input || "").replace(/\s+/g, " ").trim();
    if (!txt) return "";
    const parts = (txt.match(/[^.!?…]+[.!?…]?/g) || [txt]).map(x => x.trim()).filter(Boolean);
    const bad = /^(bu funksiya|bu xüsusiyyət|bu alət|bu modul|bu bölmə|bu seqmentdə deyilir ki|süni intellekt|ağıllı .{0,45}(budur|belədir)|fakt yoxlaması budur|qeyd edək ki, bu|xahiş olunur|bu,?\s+(süni intellekt|ağıllı|ai\b)|burada\s+(söhbət|məqsəd))/i;
    return parts.filter(x => !bad.test(x)).join(" ").trim();
  }

  async function expandText({ title, text, context = "", feature, apiKey, model, lang = "az" }) {
    const source = context
      ? "ALT YAZI KONTEKSTİ:\n" + String(context).slice(0, 5000)
      : "MÖVCUD MƏTN:\n" + String(text || "");
    const tgt = lang === "ru" ? "Russian" : lang === "en" ? "English" : "Azerbaijani";
    const prompt = [
      "Sən analitik assistentsən.",
      "Verilmiş seqmentin ALT YAZI mətninə əsaslanaraq REAL, DƏRİN və KONKRET təhlil/genişləndirmə yaz.",
      "Meta-təsvir və şablon cümlələr QADAĞANDIR: 'bu funksiya', 'bu xüsusiyyət', 'süni intellekt vasitəsilə', 'ağıllı ... budur', 'qeyd edək ki, bu bölmə' kimi ifadələr yazma.",
      "Yalnız bu seqmentə aid YENİ məlumat əlavə et; əvvəlki mətni təkrarlama, onu silmə və dəyişmə.",
      "3–6 cümləlik, konkret, dəqiq və dərin izah yaz: səbəb-nəticə, kontekst, real nümunə. Alt yazıda olmayan fakt uydurma.",
      "Yalnız əlavə mətni qaytar (başlıq, dırnaq, meta qeyd olmadan).",
      `Write ALL output ONLY in ${tgt}.`,
      "", "BÖLMƏ: " + String(feature && feature.name || ""),
      "BAŞLIQ: " + String(title || ""),
      source
    ].join("\n");
    const out = await geminiCall(apiKey, model, prompt, 2048, { attempts: 2, timeout: 120000, temperature: 0.3 });
    return cleanMeta(String(out || ""));
  }

  async function researchText({ title, text, context = "", feature, apiKey, model, lang = "az" }) {
    const source = context
      ? "ALT YAZI KONTEKSTİ:\n" + String(context).slice(0, 5000)
      : "MƏTN:\n" + String(text || "");
    const tgt = lang === "ru" ? "Russian" : lang === "en" ? "English" : "Azerbaijani";
    const prompt = [
      "Sən araşdırma assistentsən. İnternetdə mövcud ümumi biliklərə əsaslan.",
      "Verilmiş konkret kadr, cümlə və ya termin haqqında REAL, FAKTİKİ və DƏRİN kontekstual izah ver: nədir, niyə vacibdir, hansı faktla bağlıdır.",
      "Meta-təsvir QADAĞANDIR: 'bu funksiya', 'bu xüsusiyyət', 'süni intellekt', 'ağıllı ... budur', 'fakt yoxlaması budur' kimi şablon cümlələr yazma. Funksiyanı deyil, MÖVZUNU izah et.",
      "Termindirsə dəqiq tərifini, şəxs/hadisədirsə faktiki kontekstini ver. Uydurma fakt yazma.",
      "MAKSİMUM 1–2 QISA CÜMLƏ yaz. Mötərizə işarələrini özün yazma (mötərizəni UI əlavə edir).",
      `Write ALL output ONLY in ${tgt}.`,
      "Yalnız mətni qaytar.",
      "", "BÖLMƏ: " + String(feature && feature.name || ""),
      "BAŞLIQ: " + String(title || ""),
      source
    ].join("\n");
    let out;
    try {
      // "i" real internet araşdırması: Google Search grounding.
      out = await geminiCall(apiKey, model, prompt, 2048, { attempts: 2, timeout: 120000, temperature: 0.2, tools: [{ google_search: {} }] });
    } catch (e) {
      if (!/\b400\b|tool|google_search|not supported|invalid argument/i.test(String(e && e.message || e))) throw e;
      out = await geminiCall(apiKey, model, prompt, 2048, { attempts: 2, timeout: 120000, temperature: 0.2 });
    }
    return cleanMeta(String(out || ""));
  }

  async function moreItems({ cues, feature, existing, apiKey, model, count = 5, lang = "az" }) {
    const F = self.IDM_AI_FEATURES;
    const lines = (cues || []).map(c => `[${F.mmss(c.start)}] ${String(c.text || "").replace(/\s+/g, " ").trim()}`).filter(Boolean).join("\n").slice(0, 120000);
    const have = (existing || []).map(x => "- " + String(x.title || "") + ": " + String(x.text || "").slice(0, 80)).join("\n");
    const tgt = lang === "ru" ? "Russian" : lang === "en" ? "English" : "Azerbaijani";
    const prompt = [
      "Sən analitik assistentsən. Transkriptə əsaslan.",
      `Əvvəlki nəticələrdə OLMAYAN ${count} yeni bənd yarat (təkrar etmə).`,
      "Hər bənddə dəqiq vaxt aralığı (transkriptdən), qısa başlıq (≤44 simvol) və mətn olsun.",
      feature && feature.quiz
        ? "Yalnız JSON qaytar: {\"items\":[{\"start\":\"mm:ss\",\"end\":\"mm:ss\",\"question\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"correctIndex\":0,\"explanation\":\"...\"}]}"
        : "Yalnız JSON qaytar: {\"items\":[{\"start\":\"mm:ss\",\"end\":\"mm:ss\",\"title\":\"...\",\"text\":\"...\"}]}",
      `Write ALL output ONLY in ${tgt}.`,
      "", "TAPŞIRIQ: " + String(feature && feature.task || "").replace(/\{SEGMENT_COUNT\}/g, String(count)),
      "", "MÖVCUD NƏTİCƏLƏR:", have || "—",
      "", "TRANSKRIPT:", lines
    ].join("\n");
    const raw = await geminiCall(apiKey, model, prompt, 8192, { attempts: 2, timeout: 180000, temperature: 0.4 });
    const parsed = F.extractJson(raw);
    let items = F.normalizeItems(parsed || [], cues, 1000, { snap: !(feature && feature.format === "risk") });
    if (feature && feature.quiz) items = items.filter(quizQuality);
    else if (feature && feature.id === "quotes") items = items.map(it => cleanQuoteItem(it, cues)).filter(Boolean);
    return items;
  }

  const api = {
    API, PRIORITY, LANGUAGES, langByCode, langName, baseLang, normCode, priorityRank,
    isAutoOriginal, prioritizeSubs, chooseSubtitle, stripNonSpeechText, stripNonSpeech,
    parseSubtitle, normalizeSubtitleCues, repairSubtitleTimeline, alignLyricsLinesToCues, combineDualCues, toSrt, toAss, toAssDual, chunkCues, splitCues, translateCues, translateLive, correctWithLyrics, findLyrics, classifySong, analyzeMusicMedia, lyricsSimilarity, cleanLyricsText, proofreadAzLyrics, alignLyricsWithAudio, runFeature, expandText, researchText, moreItems
  };
  self.IDMAI = api;
})();
