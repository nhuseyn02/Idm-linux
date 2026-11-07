// Sİ (AI) — 23 xüsusiyyətin kataloqu, cavabın validasiyası və ixrac formatları.
// Yalnız mətn (subtitr/transkript) üzərində işləyir; video kadr analizi yoxdur.
(function () {
  const FEATURES = [
    { id: "chapters", name: "YouTube Native", mode: "A", native: true, onlyA: true,
      desc: "YouTube-un öz fəsil markerləri" },
    { id: "summary", name: "Ağıllı video məzmun xülasəsi", mode: "A", format: "topics", expand: true, aTitleOnly: true,
      desc: "Mövzular üzrə bölgü (YouTube Native kimi)",
      task: "Transkripti MÖVZULAR üzrə böl (YouTube fəsilləri kimi), giriş/əsas/yekun bölgüsü YOX. Hər mövzu ayrı seqment olsun; başlıq qısa olsun." },
    { id: "keywordJump", name: "Smart keyword jump", mode: "A", input: "Açar söz", format: "index", expand: true, aTitleOnly: true, searchMode: true,
      desc: "Açar sözün keçdiyi yerlər (geniş pəncərə)",
      task: "Açar sözün keçdiyi hər yeri tap. Seqment pəncərəsini bir az GENİŞ götür ki, söz yarımçıq kəsilməsin və cümlə tam anlaşılsın." },
    { id: "glossary", name: "Ağıllı lüğət", mode: "B", onlyB: true, format: "dict", sortable: true, fields: ["Tərcümə"],
      desc: "Bütün sözlər — yazıldığı kimi, hərfi tərcümə ilə",
      task: "Subtitrdəki BÜTÜN sözləri, yazıldığı kimi (orfoqrafiya, hal, böyük/kiçik hərf dəyişdirilmədən) çıxar və hər biri üçün hərfi (sözbəsöz) Azərbaycan tərcüməsini ver." },
    { id: "anki", name: "Anki/flashcards", mode: "B", format: "qa", fields: ["Ön üz", "Arxa üz"], more: true,
      desc: "Ən zəruri kartlar",
      task: "Yalnız zəruri Anki kartları yarat (əlavə izah/xülasə yox). {SEGMENT_COUNT} kart ver: Ön üz (sual/söz/termin), Arxa üz (cavab/tərif + qısa kontekst)." },
    { id: "quiz", name: "Quiz", mode: "B", format: "quiz", quiz: true, more: true,
      desc: "İnteraktiv test",
      task: "Yalnız yüksək keyfiyyətli test sualları yarat (xülasə və əlavələr yox). Hər sual MÜSTƏQİL olmalıdır: videonu izləməyən şəxs yalnız sual mətnindəki məlumatla cavabı tapa bilməlidir. Ümumi 'Nə edilir?', 'Skan nəticəsi nədir?', 'Bu nədir?' tipli səthi suallar QADAĞANDIR. Əsas arqument, səbəb-nəticə, termin, müqayisə və nəticəyə fokuslan; sualın daxilində zəruri kontekst/premisanı ver. Hər sual üçün JSON: question, options (4 fərqli, inandırıcı variant), correctIndex (0–3), explanation (2 cümləlik dəqiq izah). Variantları sual mətninin içinə YAZMA." },
    { id: "cheatsheet", name: "Ağıllı konspekt generatoru", mode: "B", format: "cheatsheet", expand: true,
      desc: "Qısa qeydlər",
      task: "Qısa konspekt qeydləri yarat — {SEGMENT_COUNT} qeyd. Hər qeyd 1–2 cümlə, dəqiq və konkret olsun." },
    { id: "vocab", name: "Vocabulary level test parameters", mode: "B", format: "metrics", metrics: true,
      desc: "Unikal söz sayı, leksik sıxlıq və s.",
      task: "Yalnız bu parametrləri hesabla: unikal söz sayı, ümumi söz sayı, leksik sıxlıq (%), CEFR səviyyəsi, qabaqcıl/əsas lüğət nisbəti." },
    { id: "quotes", name: "Sitatlar və tezislər", mode: "A", format: "quotes", fields: ["Növ", "Danışan"], more: true,
      desc: "Sitatlar və analitik tezislər",
      task: "Yalnız real spikerin dediyi, fəlsəfi, motivasiyaedici, dərin analitik və ya ideya baxımından bitkin CANLI cümlələri sitat seç. Sitat videodan kənar oxunduqda öz-özlüyündə məna kəsb etməlidir; yarımçıq cümlə, əvvəlki cümləyə bağlı 'və/çünki/yəni' ilə başlayan cümlə sitat deyil. Titrlər, müəllif hüququ qeydləri ('Sten Li tərəfindən uyğunlaşdırılmışdır'), arxaplan səsləri ('S.O.S...'), tək sözdən ibarət qışqırıqlar, texniki məlumatlar (1080p, fps, URL, rejissor/prodüser/ssenarist qeydləri) QƏTİYYƏN sitat və ya tezis deyil. Tezis yalnız həmin seqmentin alt yazısındakı əsas fikirdən çıxarılmalıdır; alt yazıda olmayan tezis yazmaq QADAĞANDIR. Tezis videonun əsas ideyası/müəllifin ana arqumenti ola bilər və birbaşa iddia şəklində yazılmalıdır ('Kapital olmadan artım mümkün deyil'); 'Əsərin/videonun əsas ideyası...' kimi meta cümlə ilə başlamasın. 'Əsər məlumatı' və texniki qeyd tezis sayılmaz. Qəzet manşeti, BÖYÜK HƏRFLİ başlıq, xəbər başlığı, clickbait və 'Danışan: Sistem' QADAĞANDIR. Mənalı sitat yoxdursa, uydurma sitat yazma — həmin yerdə ən vacib analitik tezisi «Növ: Tezis» kimi ver. Sitat alt yazıda keçdiyi KİMİ verilsin." },
    { id: "tone", name: "Tonlama", mode: "B", format: "tone", fields: ["Ton"],
      desc: "Daha incə emosional xəritə",
      task: "Ton və emosiyanı DAHA İNCƏ və DƏQİQ təhlil et: qısa bloklar, hər blokda ton və səbəb." },
    { id: "links", name: "Resurs və istinadlar", mode: "A", format: "links", fields: ["Növ"], info: true,
      desc: "Kitab/məqalə/sayt/alət siyahısı",
      task: "Yalnız mətndə çəkilən kitab, məqalə, sayt, proqram/alət adlarını siyahıya al; növünü göstər." },
    { id: "factcheck", name: "Ağıllı fakt yoxlamaları", mode: "B", format: "claims", info: true, fields: ["Qərar", "İzah"],
      desc: "İddiaların yoxlanması",
      task: "{SEGMENT_COUNT} iddia çıxar. Hər iddia üçün qərar (Təsdiqlənib / Şübhəli / Kontekst tələb edir) və 2 cümləlik izah ver." },
    { id: "risk", name: "Müəllif hüquqları", mode: "B", format: "risk", fields: ["Risk növü", "Risk %", "Səbəb"],
      desc: "Hər dəqiqə/seqment üçün risk faizi",
      task: "Videonun HƏR dəqiqəsi/seqmenti üçün müəllif hüququ pozuntusu və claim riskini dərin təhlil et. Hər seqment üçün risk faizi (%) ver və səbəbini yaz. Heç bir dəqiqəni atlama." },
    { id: "difficulty", name: "Sürət və çətinlik indeksi", mode: "B", format: "difficulty", metrics: true,
      desc: "Yalnız göstərilən parametrlər",
      task: "Yalnız bu parametrləri hesabla: nitq sürəti (söz/dəqiqə), məlumat sıxlığı, koqnitiv mürəkkəblik indeksi, orta cümlə uzunluğu." },
    { id: "sentiment", name: "Yanaşma", mode: "B", format: "stance", expand: true, fields: ["Danışan", "Münasibət", "Kimə qarşı"],
      desc: "Danışanların yanaşması və qarşılıqlı münasibətləri",
      task: "Danışanları (bir neçədirsə hamısını) müəyyən et və hər birinin yanaşmasını xəritələ: kim neytral, kim tənqidi, kim tərəfdaş/müttəfiqdir; kim kimə qarşı tənqidi danışır. Strukturlaşdırılmış şəkildə göstər." },
    { id: "rhetoric", name: "Ritorika və manipulyasiya", mode: "B", format: "fallacies", expand: true, fields: ["Nümunə"],
      desc: "Fallasiya və manipulyasiya (2 cümlə)",
      task: "Məntiqi fallasiya və manipulyasiya nümunələrini tap; hər biri 2 cümləlik izahla." },
    { id: "entities", name: "Obyektlər və əlaqələr qrafiki", mode: "B", format: "entities", info: true, fields: ["Növ", "Əlaqə"],
      desc: "Şəxslər, dövlətlər, təşkilatlar",
      task: "Əvvəlcə yalnız subtitrdəki obyektləri çıxar: şəxslər, dövlətlər, qurumlar, təşkilatlar. Əlaqələrini yaz." },
    { id: "recipe", name: "Ağıllı resept və tərkib siyahısı", mode: "A", format: "recipe", expand: true, fields: ["Tərkib"],
      desc: "Addım-addım resept",
      task: "Resept addımlarını DƏQİQ və addım-addım çıxar; hər addımın vaxtını göstər. Resept deyilsə boş qaytar." },
    { id: "contradictions", name: "Avtomatik ziddiyyət və səhv axtaran", mode: "B", format: "contradictions",
      fields: ["Birinci ifadə", "İkinci ifadə"],
      desc: "Ziddiyyətlər (2 cümləlik izah)",
      task: "Transkripti əvvəldən axıra yoxla; danışanın öz-özlüyündə ziddiyyətlərini tap. İzah 2 cümlə olsun, hər iki vaxtı göstər." },
    { id: "acronyms", name: "Akronimlər və qısaltmalar lüğəti", mode: "B", format: "acronyms", expand: true, fields: ["Açılışı", "Kontekst"],
      desc: "Uzun siyahı, 2 cümləlik izah",
      task: "Bütün akronim və qısaltmaları topla; hər biri üçün açılış və 2 cümləlik izah ver." }
  ];

  const byId = id => FEATURES.find(f => f.id === id) || null;

  const pad = n => String(n).padStart(2, "0");
  function mmss(ms) {
    const s = Math.max(0, Math.round((+ms || 0) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
  }
  function toMs(v) {
    if (typeof v === "number" && isFinite(v)) return Math.max(0, Math.round(v < 10000 ? v * 1000 : v));
    const s = String(v || "").trim();
    if (/^\d+(?:\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const a = +m[1], b = +m[2], c = m[3] != null ? +m[3] : null;
    return (c == null ? a * 60 + b : a * 3600 + b * 60 + c) * 1000;
  }
  const range = (a, b) => `${mmss(a)} - ${mmss(b)}`;

  function shortTitle(s, max = 44) {
    let t = String(s || "").replace(/\s+/g, " ").replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, "").trim();
    if (!t) return "";
    if (t.length <= max) return t;
    const cut = t.slice(0, max + 1);
    const sp = cut.lastIndexOf(" ");
    t = (sp > max * 0.5 ? cut.slice(0, sp) : t.slice(0, max)).replace(/[,;:.!?\-–—]+$/, "");
    return t + "…";
  }

  function extractJson(text) {
    const s = String(text || "").replace(/```json|```/gi, "").trim();
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch {}
    }
    const arr = s.match(/\[[\s\S]*\]/);
    if (arr) { try { return JSON.parse(arr[0]); } catch {} }
    return null;
  }

  // Sual mətninə qarışmış "A) ... B) ..." variant qalıqlarını təmizləyir.
  function stripOptionTail(s) {
    const str = String(s || "");
    const re = /(^|[\s;,])([A-D])[\).:\-]\s+/g;
    let m, first = -1, n = 0;
    while ((m = re.exec(str))) {
      if (first < 0) first = m.index + m[1].length;
      n++;
    }
    if (n >= 2 && first > 0) return str.slice(0, first).replace(/[\s;,:.\-–—]+$/, "").trim();
    return str.trim();
  }

  // Altyazı cue-larını cümlə bloklarına birləşdirir: [başlanğıc-bitiş] mətn.
  // Cümlə nöqtələmə ilə, uzun pauza ilə və ya həddindən uzun blokla bitir.
  function sentenceRows(cues) {
    const rows = [];
    let cur = null;
    const MAX = 220;
    for (const c of (Array.isArray(cues) ? cues : [])) {
      const txt = String((c && c.text) || "").replace(/\s+/g, " ").trim();
      if (!txt) continue;
      const start = Math.max(0, +((c && c.start) || 0));
      const end = Math.max(start + 200, +((c && c.end) || start + 1200));
      if (!cur) { cur = { start, end, text: txt }; continue; }
      const gap = start - cur.end;
      const ended = /[.!?…]["'”»)]?\s*$/.test(cur.text);
      if (gap > 1200 || ended || cur.text.length >= MAX) {
        rows.push(cur);
        cur = { start, end, text: txt };
      } else {
        cur.text = (cur.text + " " + txt).replace(/\s+/g, " ").trim();
        cur.end = end;
      }
    }
    if (cur) rows.push(cur);
    return rows;
  }

  function snapRange(start, end, rows) {
    if (!rows || !rows.length) return { start, end };
    const hits = rows.filter(r => r.end > start && r.start < end);
    if (hits.length) return { start: hits[0].start, end: hits[hits.length - 1].end };
    let best = rows[0], bd = Infinity;
    for (const r of rows) {
      const d = Math.min(Math.abs(r.start - start), Math.abs(r.end - start));
      if (d < bd) { bd = d; best = r; }
    }
    return { start: best.start, end: best.end };
  }

  // Modelin cavabını təhlükəsiz formata salır: vaxtlar transkriptə sıxılır,
  // başlıqlar qısaldılır, sıra düzülür, boş/yanlış sətirlər atılır.
  function normalizeItems(raw, cues, maxItems = 1000, opts = {}) {
    let list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
    if (!list.length && raw && Array.isArray(raw.segments)) list = raw.segments;
    const last = cues && cues.length ? (+cues[cues.length - 1].end || 0) : 0;
    const rows = opts.snap === false ? [] : sentenceRows(cues);
    const out = [];
    for (const it of list) {
      if (!it || typeof it !== "object") continue;
      let start = toMs(it.start ?? it.from ?? it.t0 ?? it.time);
      let end = toMs(it.end ?? it.to ?? it.t1);
      let title = shortTitle(it.title ?? it.name ?? it.topic ?? it.label);
      let text = String(it.text ?? it.detail ?? it.description ?? it.summary ?? it.body ?? "").replace(/\s+/g, " ").trim();
      // Quiz: variantlar ayrıca massivdə gəlir; sual mətnində təkrar olunmamalıdır.
      let options = null, correctIndex = null, explanation = "";
      const rawOpts = it.options ?? it.variants ?? it.choices;
      if (Array.isArray(rawOpts) && rawOpts.length) {
        options = rawOpts.map(x => String(x && typeof x === "object" ? (x.text ?? x.value ?? x.label ?? "") : x ?? "")).map(x => x.trim()).filter(Boolean).slice(0, 6);
        if (options.length) {
          title = stripOptionTail(title);
          text = stripOptionTail(text);
          const q = String(it.question ?? it.sual ?? "").trim();
          if (q) text = stripOptionTail(q.replace(/\s+/g, " "));
          explanation = String(it.explanation ?? it.izah ?? it.reason ?? "").replace(/\s+/g, " ").trim();
          let ci = Number(it.correctIndex);
          if (!Number.isInteger(ci)) {
            const cl = String(it.correctAnswer ?? it.correct ?? it.answer ?? "").trim();
            const lm = cl.match(/^([A-D])\b/i);
            ci = lm ? "ABCD".indexOf(lm[1].toUpperCase()) : (parseInt(cl, 10) - (parseInt(cl, 10) > 0 ? 1 : 0));
          }
          if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) ci = 0;
          correctIndex = ci;
        }
      }
      if (start == null) continue;
      if (end == null || end <= start) end = start + 12000;
      if (last) {
        start = Math.min(start, last);
        end = Math.min(end, last + 2000);
      }
      if (end <= start) end = start + 4000;
      if (rows.length) {
        const sn = snapRange(start, end, rows);
        start = sn.start;
        end = Math.max(sn.end, start + 1000);
      }
      if (!title && !text) continue;
      let fields = it.fields || it.meta || it.extra || null;
      if (options && options.length) {
        fields = options.map((v, i) => ({ label: "ABCDEF"[i] || String(i + 1), value: v }));
        fields.push({ label: "Düzgün cavab", value: "ABCDEF"[correctIndex] || String(correctIndex + 1) });
        if (explanation) fields.push({ label: "İzah", value: explanation });
      } else if (fields && !Array.isArray(fields) && typeof fields === "object") {
        fields = Object.entries(fields).map(([k, v]) => ({ label: String(k), value: String(v == null ? "" : v) }));
      } else if (Array.isArray(fields)) {
        fields = fields.map(x => ({ label: String((x && (x.label || x.name)) || ""), value: String((x && (x.value ?? x.text)) ?? "") })).filter(x => x.label || x.value);
      } else fields = [];
      const freq = Number(it.freq ?? it.frequency ?? it.count);
      const item = { start, end, title: title || shortTitle(text, 40), text, fields };
      if (options && options.length) { item.options = options; item.correctIndex = correctIndex; item.explanation = explanation; }
      if (Number.isFinite(freq) && freq > 0) item.freq = freq;
      out.push(item);
      if (out.length >= maxItems) break;
    }
    out.sort((a, b) => a.start - b.start || a.end - b.end);
    return out;
  }

  function serialize(items, format = "txt", meta = {}) {
    const rows = Array.isArray(items) ? items : [];
    const name = String(meta.name || "SI").replace(/\s+/g, " ").trim();
    const line = it => `${range(it.start, it.end)} | ${it.title}${it.text ? " — " + it.text : ""}`;
    if (format === "json") {
      return JSON.stringify({ title: name, generated: new Date().toISOString(), items: rows }, null, 2);
    }
    if (format === "csv") {
      const q = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
      return ["start,end,title,text", ...rows.map(it => [mmss(it.start), mmss(it.end), q(it.title), q(it.text)].join(","))].join("\n");
    }
    if (format === "srt" || format === "vtt") {
      const ts = (ms, vtt) => {
        const s = Math.max(0, Math.round(ms / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
        return `${pad(h)}:${pad(m)}:${pad(ss)}${vtt ? ".000" : ",000"}`;
      };
      const body = rows.map((it, i) =>
        `${i + 1}\n${ts(it.start, format === "vtt")} --> ${ts(it.end, format === "vtt")}\n${[it.title, it.text].filter(Boolean).join(" — ")}\n`
      ).join("\n");
      return format === "vtt" ? `WEBVTT\n\n${body}` : body;
    }
    if (format === "md") {
      return rows.map(it => `## ${range(it.start, it.end)} — ${it.title}\n\n${it.text || ""}\n`).join("\n");
    }
    return rows.map(it => `${line(it)}\n`).join("\n");
  }

  self.IDM_AI_FEATURES = { FEATURES, byId, mmss, range, toMs, shortTitle, sentenceRows, snapRange, normalizeItems, serialize, extractJson };
})();
