// Sİ (AI) paneli — həm popup overlay-i, həm də ai.html pəncərəsi üçün.
// 23 xüsusiyyət: seçim siyahısı → nəticə (Mode A seqmentlər / Mode B mətn) → ixrac.
(function () {
  const F = self.IDM_AI_FEATURES;
  const send = m => chrome.runtime.sendMessage(m);
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const CSS = `
.si-root{position:fixed;inset:0;background:#1c1c1e;color:#eee;z-index:200;display:flex;flex-direction:column;font:12.5px system-ui,-apple-system,Segoe UI,sans-serif}
.si-head{display:flex;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid #333;flex:none}
.si-head b{font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.si-head .si-note{white-space:nowrap;font-size:9.5px;opacity:.65;flex:none}
@media (max-width:520px){ .si-head .si-note{display:none} }
.si-ic{background:transparent;border:0;color:#bbb;border-radius:6px;padding:4px 7px;cursor:pointer;font:13px system-ui}
.si-ic:hover{background:#2c2c2e;color:#eee}
.si-sp{flex:1}
.si-btn{background:#2f6fed;color:#fff;border:0;border-radius:6px;padding:6px 10px;font-weight:600;cursor:pointer;font:12px system-ui}
.si-btn:hover{background:#3d7bf5}
.si-btn:disabled{opacity:.45;cursor:default}
.si-btn.ghost{background:#2b2b2f;color:#ddd}
.si-body{flex:1;overflow:auto;padding:10px}
.si-list{display:grid;grid-template-columns:1fr;gap:6px}
.si-feat{display:flex;align-items:center;gap:8px;background:#232326;border:1px solid #333;border-radius:8px;padding:8px 10px;cursor:pointer;color:#ddd;text-align:left;font:12.5px system-ui}
.si-feat:hover{border-color:#2f6fed;background:#26262a}
.si-feat .n{flex:1;min-width:0}
.si-tag{flex:none;font-size:10px;font-weight:700;letter-spacing:.03em;padding:2px 6px;border-radius:4px;background:#33405c;color:#cfe0ff}
.si-tag.b{background:#3a2f46;color:#e6ccff}
.si-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px}
.si-toolbar select,.si-toolbar input[type="text"]{background:#2f2f32;color:#eee;border:1px solid #46464a;border-radius:6px;padding:5px 6px;font:12px system-ui;max-width:100%}
.si-toolbar input[type="text"]{flex:1;min-width:120px}
.si-src{flex-basis:100%;display:block;background:#202024;border:1px solid #3a3a40;border-radius:6px;padding:4px 7px}
.si-src-head{display:flex;align-items:center;gap:8px}
.si-src-l{flex:none;color:#9aa0a6;font-size:11px;white-space:nowrap}
.si-src-btn{flex:1;min-width:0;text-align:left;background:#2f2f32;color:#eee;border:1px solid #46464a;border-radius:5px;padding:5px 8px;font:11.5px system-ui;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.si-src-btn:hover{border-color:#2f6fed}
.si-src-menu{display:none;margin-top:5px;border:1px solid #46464a;border-radius:6px;background:#242428;max-height:280px;overflow:auto;padding:3px}
.si-src-menu.on{display:block}
.si-src-group{color:#8f8f96;font-size:10px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;padding:6px 7px 3px}
.si-src-item{display:block;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-radius:5px;color:#e6e6ea;padding:5px 7px;font:11.5px system-ui;cursor:pointer}
.si-src-item:hover{background:#2d2d33;border-color:#3d3d44}
.si-src-item.on{background:#20283a;border-color:#2f6fed}
.si-src-meta{display:none;margin-top:4px;padding-top:4px;border-top:1px dashed #3a3a40;color:#9fb0c8;font:10.5px/1.45 ui-monospace,monospace;white-space:pre-line;word-break:break-all}
.si-src-meta.on{display:block}
.si-toolbar input[type="checkbox"]{flex:none;min-width:0;width:13px;height:13px;margin:0;accent-color:#2f6fed}
.si-note{color:#9a9a9a;font-size:11.5px;line-height:1.45;margin:6px 0}
.si-err{color:#ff7b7b;background:#3a2020;border:1px solid #6b2b2b;border-radius:6px;padding:7px 9px;font-size:12px;margin:6px 0}
.si-item{display:flex;gap:8px;align-items:flex-start;background:#232326;border:1px solid #313135;border-radius:8px;padding:8px 9px;margin-bottom:6px}
.si-item:hover{border-color:#3d3d44}
.si-item input[type=checkbox]{margin-top:3px;accent-color:#2f6fed;width:14px;height:14px;flex:none}
.si-seq{flex:none;min-width:18px;height:18px;border-radius:9px;background:#2f6fed;color:#fff;font-size:10.5px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 4px}
.si-seq.on{display:inline-flex}
.si-it-body{flex:1;min-width:0}
.si-time{color:#8fb6ff;font-variant-numeric:tabular-nums;font-size:11px;font-weight:650;white-space:nowrap}
.si-title{color:#eee;font-weight:650;margin-top:1px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
.si-text{color:#a9a9b0;font-size:11.5px;line-height:1.4;margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.si-b{background:#232326;border:1px solid #313135;border-radius:8px;padding:9px 10px;margin-bottom:8px}
.si-b .si-title{white-space:normal;display:block}
.si-b .si-text{display:block;-webkit-line-clamp:unset;color:#c9c9cf;font-size:12px;margin-top:4px}
.si-freq{color:#8f8f96;font-size:10.5px;font-weight:500;margin-left:6px}
.si-qkind{display:inline-block;margin:2px 0 1px;padding:1px 7px;border-radius:9px;background:#20283a;border:1px solid #2f3d57;color:#9fc0ff;font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase}
.si-qkind.thesis{background:#2d2a20;border-color:#5a4c2a;color:#e8cf94}
.si-qtitle{color:#9fb0c8;font-size:10.5px;line-height:1.35;margin-top:2px}
.si-quote{color:#ececf2;font-size:12.5px;line-height:1.5;margin-top:4px;padding-left:8px;border-left:2px solid #2f6fed;font-style:italic}
.si-qspeaker{color:#8fb6ff;font-size:10.5px;margin-top:3px}
.si-segtext{margin-top:6px;padding:5px 7px;border-left:2px solid #3a3a40;background:#1f1f23;color:#9a9aa2;font-size:10.5px;line-height:1.45;white-space:pre-wrap}
.si-foot{display:flex;gap:8px;align-items:center;padding:8px 10px;border-top:1px solid #333;flex:none}
.si-menu{position:absolute;right:10px;top:44px;background:#2a2a2e;border:1px solid #45454b;border-radius:8px;padding:4px;z-index:5;display:none;box-shadow:0 8px 24px #0008}
.si-menu.on{display:block}
.si-menu button{display:block;width:100%;text-align:left;background:transparent;border:0;color:#eee;padding:6px 10px;border-radius:5px;cursor:pointer;font:12px system-ui}
.si-menu button:hover{background:#3a3a40}
.si-menu button.on{background:#2f6fed;color:#fff}
.si-prog{display:none;margin:6px 0;color:#cfe0ff;font-size:11.5px}
.si-prog.on{display:block}
.si-diag{flex-basis:100%;color:#8f8f96;background:#202022;border:1px solid #333;border-radius:6px;padding:6px 8px;font:11px/1.45 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
.si-jobbar{flex:none;border-top:1px solid #333;padding:7px 10px 8px;background:#18181a}
.si-jobbar .r1{display:flex;align-items:center;gap:8px;font-size:11px;color:#cfe0ff}
.si-jobbar .r1 .p{font-weight:700;font-variant-numeric:tabular-nums}
.si-jobbar .r1 .sp{flex:1}
.si-jobbar .r1 .m{color:#9a9aa2;font-variant-numeric:tabular-nums;white-space:nowrap}
.si-jobbar .bar{height:5px;background:#2c2c30;border-radius:3px;overflow:hidden;margin-top:4px}
.si-jobbar .bar i{display:block;height:100%;width:0;background:#1f9d55;border-radius:3px;transition:width .25s linear}
.si-jobbar.err .bar i{background:#c0392b}
.si-jobbar.done .bar i{background:#2ecc71}
.si-jobbar .ph{margin-top:3px;color:#8f8f96;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.si-risk{display:inline-block;margin:2px 0 4px;padding:3px 9px;border-radius:10px;font-size:11.5px;font-weight:700;letter-spacing:.02em}
.si-risk.low{background:#16301f;border:1px solid #2b6b41;color:#7ddfa5}
.si-risk.mid{background:#33290f;border:1px solid #6b552b;color:#ffd37d}
.si-risk.high{background:#3a1a1a;border:1px solid #7a2f2f;color:#ff9b9b}
.si-mini{background:#2b2b30;color:#cfe0ff;border:1px solid #3a3a44;border-radius:5px;padding:3px 8px;font:11px system-ui;cursor:pointer;margin-right:6px}
.si-mini:hover{background:#34343b}
.si-mini.i{width:20px;height:20px;border-radius:50%;padding:0;font-weight:700;font-style:italic}
.si-item-btns{margin-top:6px;display:flex;align-items:center}
.si-info{margin-top:6px;padding:6px 8px;border-left:2px solid #2f6fed;background:#1f2430;color:#c9d6ea;font-size:11.5px;line-height:1.45;white-space:pre-wrap}
.si-exp{margin-top:5px;padding-top:4px;border-top:1px dashed #333;color:#b9c9e6;white-space:pre-wrap}
.si-quiz{margin-top:6px;display:flex;flex-direction:column;gap:3px}
.si-opt{display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #333;border-radius:5px;cursor:pointer;font-size:11.5px}
.si-opt.sel{border-color:#2f6fed;background:#20283a}
.si-ans{margin-top:6px;font-size:11.5px;color:#8f8f96}
.si-ans.ok{color:#2ecc71}.si-ans.bad{color:#ff7b7b}
.si-more{display:flex;justify-content:center;padding:6px 0 10px}
.si-kv{display:flex;gap:4px;font-size:11.5px;line-height:1.45;margin-top:2px}
.si-kv .k{color:#8fb6ff;flex:none;font-weight:600}
.si-kv .v{color:#c9c9cf;min-width:0;word-break:break-word}
.si-fields{margin-top:5px;padding-top:4px;border-top:1px dashed #333}
.si-metrics .si-title{margin-bottom:2px}
.si-inh{flex-basis:100%;color:#8fb6ff;background:#20283a;border:1px solid #2f3d57;border-radius:6px;padding:4px 8px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.si-mode{display:flex;border:1px solid #3a3a40;border-radius:6px;overflow:hidden}
.si-mode button{background:transparent;color:#aaa;border:0;padding:4px 8px;font:11px system-ui;cursor:pointer}
.si-mode button.on{background:#2f6fed;color:#fff}
`;

  let st = null;

  function ensureStyle() {
    if (document.getElementById("si-style")) return;
    const s = document.createElement("style");
    s.id = "si-style";
    s.textContent = CSS;
    document.head.append(s);
  }

  function mount(root, opts = {}) {
    if (!root) { console.error("[AI-Extension Error]: panel kökü (root) tapılmadı"); return; }
    ensureStyle();
    st = {
      root, tabId: opts.tabId != null ? opts.tabId : null, onClose: opts.onClose || null,
      feature: opts.feature || "", mode: "", items: [], sel: [], sources: [], sourceUrl: "", hasSubs: false, sourceCount: 0, inherited: null, debug: null, metrics: null,
      expanded: new Map(), info: new Map(), sortMode: "order", quizSel: new Map(), quizChecked: false, moreBusy: false,
      keyword: "", searchMode: "Məna axtarışı", preserveScroll: false,
      running: false, error: "", note: "", summary: "", exportOpen: false, job: null, jobItem: null
    };
    try {
      root.classList.add("si-root");
      root.replaceChildren();
      if (st.feature) openFeature(st.feature, true); else renderFeatureList();
    } catch (err) {
      console.error("[AI-Extension Error]: panel qurulmadı", err);
      try { root.textContent = "AI paneli açılmadı: " + (err && err.message || err); } catch {}
    }
  }

  function header(title, withBack) {
    const bar = h("div", "si-head");
    if (withBack) {
      const b = h("button", "si-ic", "‹");
      b.title = "Xüsusiyyətlər";
      b.onclick = () => { st.feature = ""; renderFeatureList(); };
      bar.append(b);
    }
    bar.append(h("b", "", title));
    bar.append(h("span", "", (self.__SI_BUILD || "") ? " " : ""));
    bar.append(h("span", "si-sp"));
    if (self.__SI_BUILD) bar.append(h("span", "si-note", self.__SI_BUILD));
    const featH = st.feature ? F.byId(st.feature) : null;
    if (st.feature && featH && featH.sortable) {
      const sb = h("button", "si-btn ghost", "Sırala");
      sb.onclick = ev => { ev.stopPropagation(); openSortMenu(sb); };
      bar.append(sb);
    }
    if (st.feature && featH && featH.quiz) {
      const cb = h("button", "si-btn ghost", "Nəticəni yoxla");
      cb.onclick = () => {
        st.quizChecked = true;
        let ok = 0, bad = 0, empty = 0;
        st.items.forEach((it, idx) => {
          const sel = st.quizSel.get(idx) || "";
          if (!sel) { empty++; return; }
          const correct = quizCorrectLetter(it);
          if (correct && sel === correct) ok++; else bad++;
        });
        st.note = `Nəticə: ${ok} düzgün · ${bad} səhv · ${empty} cavabsız`;
        render();
      };
      bar.append(cb);
    }
    if (st.feature && !(featH && (featH.onlyA || featH.onlyB))) {
      const m = h("div", "si-mode");
      for (const k of ["A", "B"]) {
        const b = h("button", st.mode === k ? "on" : "", k === "A" ? "Rejim A" : "Rejim B");
        b.onclick = () => { st.mode = k; render(); };
        m.append(b);
      }
      bar.append(m);
    }
    // Sİ fəsillərini YouTube-a tətbiq: yalnız xülasə (mövzular/fəsillər) xüsusiyyətində.
    if (st.feature && st.items.length && featH && (featH.id === "summary" || featH.format === "topics")) {
      const yb = h("button", "si-btn ghost", "YouTube");
      yb.title = "Sİ fəsillərini YouTube-a tətbiq et";
      yb.onclick = async ev => {
        ev.stopPropagation();
        yb.disabled = true; const old = yb.textContent; yb.textContent = "Tətbiq…";
        try {
          const chapters = st.items.map(it => ({
            start: Math.max(0, +it.start || 0), end: Math.max(0, +it.end || 0),
            title: String(it.title || it.text || "").replace(/\s+/g, " ").trim()
          })).filter(x => x.title).sort((a, b) => a.start - b.start);
          const r = await send({ type: "aiChaptersApply", tabId: st.tabId, chapters });
          if (r && r.ok) st.note = `✓ ${r.count || chapters.length} fəsil YouTube-a tətbiq olundu`;
          else if (r && r.native) st.note = `Bu videoda native fəsillər artıq mövcuddur${r.count ? " (" + r.count + ")" : ""}. Tətbiq olunmadı.`;
          else st.note = "✗ " + ((r && r.error) || "tətbiq olunmadı");
        } catch (e) { st.note = "✗ " + (e && e.message || e); }
        yb.disabled = false; yb.textContent = old;
        render();
      };
      bar.append(yb);
    }
    if (st.feature) {
      const ex = h("button", "si-btn", "İxrac et");
      ex.disabled = !st.items.length;
      ex.onclick = ev => { ev.stopPropagation(); toggleExport(ex); };
      bar.append(ex);
    }
    if (st.onClose) {
      const c = h("button", "si-ic", "✕");
      c.title = "Bağla";
      c.onclick = () => st.onClose();
      bar.append(c);
    }
    return bar;
  }

  function toggleExport(btn) {
    let menu = st.root.querySelector(".si-menu");
    if (!menu) {
      menu = h("div", "si-menu");
      for (const [f, label] of [["pdf", "PDF"], ["md", "MD"], ["docx", "docx"], ["xlsx", "xlsx"], ["txt", "txt"], ["copy", "Kopyala"]]) {
        const b = h("button", "", label);
        b.onclick = async () => {
          menu.classList.remove("on");
          if (f === "copy") {
            try {
              const txt = exportItems().map(it => `${F.range(it.start, it.end)} | ${it.title}\n${it.text || ""}`).join("\n\n");
              await navigator.clipboard.writeText(txt);
              st.note = "✓ Kopyalandı";
            } catch (e) { st.note = "✗ Kopyalama alınmadı"; }
            render();
            return;
          }
          await doExport(f);
        };
        menu.append(b);
      }
      st.root.append(menu);
    }
    menu.classList.toggle("on");
    const off = ev => { if (!menu.contains(ev.target) && ev.target !== btn) { menu.classList.remove("on"); document.removeEventListener("click", off, true); } };
    setTimeout(() => document.addEventListener("click", off, true), 0);
  }

  function exportItems() {
    return st.items.map((it, idx) => {
      const add = st.expanded.get(idx);
      if (!add) return it;
      return { ...it, text: [String(it.text || "").trim(), String(add).trim()].filter(Boolean).join("\n") };
    });
  }

  async function doExport(format) {
    if (!st.items.length) return;
    try {
      const name = `Sİ — ${(F.byId(st.feature) || {}).name || "AI"}`;
      const r = await send({ type: "aiFeatureExport", tabId: st.tabId, items: exportItems(), format, name });
      st.note = r && r.ok ? `✓ İxrac edildi: ${r.path}` : ("✗ " + ((r && r.error) || "ixrac alınmadı"));
    } catch (e) {
      st.note = "✗ " + (e.message || e);
    }
    render();
  }

  function renderFeatureList() {
    const root = st.root;
    root.replaceChildren(header("Sİ — AI xüsusiyyətləri", false));
    const body = h("div", "si-body");
    const grid = h("div", "si-list");
    for (const f of F.FEATURES) {
      const b = h("button", "si-feat");
      b.append(h("span", "n", f.name));
      b.append(h("span", "si-tag " + (f.mode === "B" ? "b" : ""), f.mode));
      b.onclick = () => openFeature(f.id, false);
      grid.append(b);
    }
    body.append(grid);
    root.append(body);
  }

  async function openFeature(id, auto) {
    const f = F.byId(id);
    if (!f) return;
    st.feature = id;
    st.mode = f.onlyB ? "B" : f.mode;
    st.items = []; st.sel = []; st.error = ""; st.note = ""; st.keyword = "";
    render();
    if (f.native) { if (auto) run(); return; }
    await loadSources();
    // Heç bir xüsusiyyət avtomatik başlamır — istifadəçi "Analiz et" basmalıdır.
    // (Təsadüfi Gemini çağırışı və gözlənilməz xərc olmasın.)
  }

  async function loadSources() {
    if (st.tabId == null) { st.note = "Tab tapılmadı"; console.error("[AI-Extension Error]: tabId yoxdur"); render(); return; }
    st.note = "Alt yazı mənbələri yoxlanılır…";
    render();
    try {
      st.loading = send({ type: "aiFeatureSources", tabId: st.tabId });
      const r = await st.loading;
      if (r && r.ok) {
        st.sources = Array.isArray(r.sources) ? r.sources.slice() : [];
        st.sourceCount = st.sources.length;
        st.hasSubs = st.sourceCount > 0;
        st.inherited = r.inherited || null;
        st.debug = r.debug || null;
        const keep = st.sourceUrl && st.sources.some(s => s.url === st.sourceUrl);
        st.sourceUrl = keep ? st.sourceUrl : (r.selected || (st.sources[0] && st.sources[0].url) || "");
        st.note = st.hasSubs ? "" : "Bu videoda alt yazı tapılmadı. Alt yazı olan videoda yenidən cəhd edin.";
      } else {
        st.sources = []; st.sourceUrl = ""; st.hasSubs = false; st.sourceCount = 0;
        st.note = "Alt yazı yoxlanılmadı: " + ((r && r.error) || "naməlum xəta");
      }
    } catch (e) {
      console.error("[AI-Extension Error]: sources alınmadı", e);
      st.note = "Alt yazı mənbələri alınmadı: " + (e.message || e);
    } finally {
      st.loading = null;
    }
    render();
  }

  function langOnlyLocal(code) {
    const S = self.IDMShared;
    if (S && typeof S.langOnly === "function") return S.langOnly(code);
    const c = String(code || "").trim().toLowerCase().replace(/_/g, "-").replace(/-orig$/, "");
    if (!c) return "";
    try {
      const n = new Intl.DisplayNames(["az"], { type: "language" }).of(c);
      return n ? n.charAt(0).toLocaleUpperCase("az") + n.slice(1) : c;
    } catch { return c; }
  }
  function sourceLangCode(s) {
    const raw = String((s && (s.lang || s.dlang)) || "").trim();
    if (raw) return raw;
    const m = String((s && s.label) || "").match(/(?:^|[-_.])([a-z]{2,3})[-_](?:os|sd|full|forced|cc|\d)/i);
    return m ? m[1] : "";
  }
  function isBlobLabel(label) {
    const t = String(label || "").trim();
    return !t || /\.(?:vtt|srt|ass|ssa|ttml|dfxp|json3|lrc)$/i.test(t) || (!/\s/.test(t) && t.length > 32);
  }
  function sourceTitle(s) {
    const code = sourceLangCode(s);
    const nm = code ? langOnlyLocal(code) : (isBlobLabel(s && s.label) ? "Alt yazı" : String(s.label || "Alt yazı"));
    return (s && s.ai ? "Sİ · " : "") + nm + (s && s.auto ? " (avto)" : "");
  }
  function shortSourceUrl(u) {
    const raw = String(u || "");
    try {
      const x = new URL(raw);
      const path = x.pathname.length > 48 ? x.pathname.slice(0, 45) + "…" : x.pathname;
      return x.hostname + path;
    } catch { return raw.length > 64 ? raw.slice(0, 61) + "…" : raw; }
  }
  function sourceMeta(s) {
    const code = sourceLangCode(s);
    const m = String((s && s.url) || "").match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
    return [
      "Dil: " + (code ? langOnlyLocal(code) + " (" + code + ")" : "bilinmir"),
      "Etiket: " + (String((s && s.label) || "").trim() || "—"),
      "Mənbə: " + (s && s.ai ? "Sİ tərəfindən hazırlanmış" : "Platforma / sayt"),
      "Növ: " + (s && s.auto ? "Avtomatik" : "Əl ilə"),
      m ? "Format: " + m[1].toUpperCase() : "",
      "Ünvan: " + shortSourceUrl(s && s.url)
    ].filter(Boolean).join("\n");
  }

  function toolbar() {
    const bar = h("div", "si-toolbar");
    // Paneldən miras alınan aktiv seçimlər (keyfiyyət/axın/alt yazı) — təkrar soruşulmur.
    if (st.inherited) {
      const sel = st.inherited.sel || {}, stream = st.inherited.stream || {};
      const bits = [sel.quality, stream.name].filter(Boolean);
      if (bits.length) bar.append(h("div", "si-inh", "Miras: " + [...new Set(bits)].join(" · ")));
    }
    // Alt yazı mənbəyi menyusu — ana səhifə ilə eyni dil adı + bayraq, 2 saniyəlik meta ipucu.
    if (st.sources.length) {
      const wrap = h("div", "si-src");
      const head = h("div", "si-src-head");
      head.append(h("span", "si-src-l", "Alt yazı mənbəyi:"));
      const cur = st.sources.find(s => s.url === st.sourceUrl) || st.sources[0];
      const btn = h("button", "si-src-btn", sourceTitle(cur));
      btn.title = sourceMeta(cur);
      head.append(btn);
      wrap.append(head);

      const menu = h("div", "si-src-menu");
      const groups = { orig: false, ai: false };
      for (const s of st.sources) {
        const g = s.ai ? "ai" : "orig";
        if (!groups[g]) {
          groups[g] = true;
          menu.append(h("div", "si-src-group", s.ai ? "Sİ tərəfindən hazırlanmış" : "Orijinal"));
        }
        const meta = sourceMeta(s);
        const item = h("button", "si-src-item" + (s.url === st.sourceUrl ? " on" : ""));
        item.append(h("span", "si-src-name", sourceTitle(s)));
        const metaEl = h("div", "si-src-meta");
        metaEl.textContent = meta;
        item.append(metaEl);
        let hoverTimer = null;
        item.onmouseenter = () => {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => metaEl.classList.add("on"), 2000);
        };
        item.onmouseleave = () => { clearTimeout(hoverTimer); metaEl.classList.remove("on"); };
        item.onclick = () => { st.sourceUrl = s.url; render(); };
        menu.append(item);
      }
      wrap.append(menu);
      btn.onclick = ev => {
        ev.stopPropagation();
        const open = menu.classList.toggle("on");
        if (open) {
          const off = e => {
            if (!wrap.contains(e.target)) { menu.classList.remove("on"); document.removeEventListener("click", off, true); }
          };
          setTimeout(() => document.addEventListener("click", off, true), 0);
        }
      };
      bar.append(wrap);
    }
    const f = F.byId(st.feature);
    if (f && f.input) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.placeholder = f.input;
      inp.value = st.keyword;
      inp.oninput = () => { st.keyword = inp.value; try { go.disabled = st.running || !inp.value.trim(); } catch {} };
      bar.append(inp);
    }
    if (f && f.searchMode) {
      const sel = document.createElement("select");
      sel.title = "Axtarış metodu";
      for (const mode of ["Hərfi axtarış", "Məna axtarışı"]) {
        const o = document.createElement("option");
        o.value = mode; o.textContent = mode; sel.append(o);
      }
      sel.value = st.searchMode;
      sel.onchange = () => { st.searchMode = sel.value; };
      bar.append(sel);
    }
    if (!st.running) {
      const rl = h("button", "si-btn ghost", "⟳ Alt yazını yenilə");
      rl.title = "Alt yazının mövcudluğunu yenidən yoxla";
      rl.onclick = () => loadSources();
      bar.append(rl);
    }
    const go = h("button", "si-btn", st.running ? "İşlənir…" : (st.error ? "Yenidən cəhd et" : (st.items.length ? "Yenidən" : "Analiz et")));
    go.disabled = st.running || !!(f && f.input && !f.optional && !st.keyword.trim());
    go.onclick = () => run();
    bar.append(go);
    return bar;
  }

  async function run() {
    if (st.running) return;
    const f = F.byId(st.feature);
    if (!f) { st.error = "Xüsusiyyət seçilməyib — siyahıdan birini seçin."; render(); return; }
    st.running = true; st.error = ""; st.note = ""; st.items = []; st.sel = [];
    st.expanded = new Map(); st.info = new Map(); st.quizSel = new Map(); st.quizChecked = false; st.origItems = [];
    render();
    try {
      // Mənbə promisi hələ davam edirsə gözlə; boşdursa bir dəfə yenidən yoxla.
      if (st.loading) { try { await st.loading; } catch {} }
      if (!f.native && !st.hasSubs) {
        await loadSources();
        if (!st.hasSubs) {
          throw new Error("Bu videoda alt yazı tapılmadı. Alt yazı olduğundan əmin olun və «⟳ Alt yazını yenilə» basın.");
        }
      }
      const r = await send({
        type: "aiFeatureRun", tabId: st.tabId, featureId: st.feature, sourceUrl: st.sourceUrl || "",
        keyword: st.keyword, searchMode: st.searchMode
      });
      if (!r || !r.ok) throw new Error((r && r.error) || "AI işləmədi");
      st.items = r.items || [];
      st.origItems = st.items.slice();
      if (f.sortable && st.items.length) applySort();
      st.metrics = r.metrics || null;
      st.summary = r.summary || "";
      if (r.note) st.note = r.note;
      if (!st.items.length) st.note = st.note || "Nəticə tapılmadı.";
    } catch (e) {
      st.error = String(e && e.message || e);
    }
    st.running = false;
    render();
  }

  function selectionNumbers() {
    return new Map(st.sel.map((idx, i) => [idx, i + 1]));
  }

  function toggleSel(idx) {
    const at = st.sel.indexOf(idx);
    if (at >= 0) st.sel.splice(at, 1); else st.sel.push(idx);
    render();
  }

  function itemsA() {
    const nums = selectionNumbers();
    const box = h("div", "si-list");
    st.items.forEach((it, idx) => {
      const row = h("div", "si-item");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = st.sel.includes(idx);
      cb.onchange = () => toggleSel(idx);
      const seq = h("span", "si-seq" + (nums.has(idx) ? " on" : ""), nums.has(idx) ? String(nums.get(idx)) : "");
      const body = h("div", "si-it-body");
      const t = h("div");
      t.append(h("span", "si-time", F.range(it.start, it.end)));
      body.append(t);
      if (st.feature === "quotes") {
        if (it.quoteKind) body.append(h("span", "si-qkind" + (it.quoteKind === "Tezis" ? " thesis" : ""), it.quoteKind));
        if (it.title) body.append(h("div", "si-qtitle", it.title));
        if (it.text) body.append(h("div", it.quoteKind === "Tezis" ? "si-text" : "si-quote", it.text));
        if (it.speaker) body.append(h("div", "si-qspeaker", it.speaker));
      } else {
        if (it.title) body.append(h("div", "si-title", it.title));
        const fA = F.byId(st.feature) || {};
        if (it.text && !fA.aTitleOnly) body.append(h("div", "si-text", it.text));
      }
      row.append(cb, seq, body);
      box.append(row);
    });
    return box;
  }

  // Lüğət sıralaması — tək seçim, dərhal tətbiq.
  const SORT_MODES = [
    { id: "order", label: "Altyazıda görünmə sırası" },
    { id: "az", label: "Əlifba A→Z" },
    { id: "za", label: "Əlifba Z→A" },
    { id: "freqDesc", label: "Tezliyə görə (çoxdan aza)" },
    { id: "freqAsc", label: "Tezliyə görə (azdan çoxa)" },
    { id: "time", label: "İlk görünmə vaxtına görə" }
  ];
  const sortLabel = id => (SORT_MODES.find(x => x.id === id) || SORT_MODES[0]).label;

  function openSortMenu(anchor) {
    let menu = st.root.querySelector(".si-menu.si-sort");
    if (menu) { menu.remove(); return; }
    menu = h("div", "si-menu si-sort on");
    for (const mode of SORT_MODES) {
      const b = h("button", st.sortMode === mode.id ? "on" : "", mode.label + (st.sortMode === mode.id ? " ✓" : ""));
      b.onclick = () => {
        st.sortMode = mode.id;
        applySort();
        menu.remove();
        st.preserveScroll = true;
        render();
      };
      menu.append(b);
    }
    st.root.append(menu);
  }

  const itemFreq = it => {
    const n = Number(it && it.freq);
    if (Number.isFinite(n) && n > 0) return n;
    const f = ((it && it.fields) || []).find(x => /tezlik/i.test(x.label || ""));
    return f ? (parseInt(f.value, 10) || 0) : 0;
  };
  const itemStart = it => Number(it && it.start) || 0;
  const azCmp = (a, b) => String(a || "").localeCompare(String(b || ""), "az");

  function applySort() {
    const orig = (st.origItems && st.origItems.length ? st.origItems : st.items).slice();
    if (st.sortMode === "az") reorder(orig, (a, b) => azCmp(a.title, b.title));
    else if (st.sortMode === "za") reorder(orig, (a, b) => azCmp(b.title, a.title));
    else if (st.sortMode === "freqDesc") reorder(orig, (a, b) => itemFreq(b) - itemFreq(a) || azCmp(a.title, b.title));
    else if (st.sortMode === "freqAsc") reorder(orig, (a, b) => itemFreq(a) - itemFreq(b) || azCmp(a.title, b.title));
    else if (st.sortMode === "time") reorder(orig, (a, b) => itemStart(a) - itemStart(b));
    else reorder(orig, (a, b) => itemStart(a) - itemStart(b));
  }
  function reorder(list, cmp) {
    // Sabit sıra: eyni dəyərlər üçün ilkin görünmə sırası qorunur.
    st.items = list.map((it, i) => ({ it, i })).sort((a, b) => cmp(a.it, b.it) || a.i - b.i).map(x => x.it);
  }

  async function doExpand(idx, it) {
    if (st.running) return;
    st.note = "Genişləndirilir…"; st.preserveScroll = true; render();
    try {
      const r = await send({ type: "aiFeatureExpand", featureId: st.feature, title: it.title, text: it.text,
        tabId: st.tabId, sourceUrl: st.sourceUrl || "", start: it.start, end: it.end });
      if (r && r.ok && r.text) {
        const prev = st.expanded.get(idx) || "";
        st.expanded.set(idx, prev ? prev + "\n" + r.text : r.text);
        st.note = "";
      } else st.note = "✗ " + ((r && r.error) || "alınmadı");
    } catch (e) { console.error("[AI-Extension Error]: expand", e); st.note = "✗ " + (e.message || e); }
    st.preserveScroll = true; render();
  }
  function shortInfo(s) {
    const txt = String(s || "").replace(/\s+/g, " ").trim();
    if (!txt) return "";
    const parts = (txt.match(/[^.!?…]+[.!?…]?/g) || [txt]).map(x => x.trim()).filter(Boolean);
    return parts.slice(0, 2).join(" ").slice(0, 320);
  }
  async function doInfo(idx, it) {
    if (st.info.has(idx)) { st.note = ""; render(); return; }   // bir dəfə
    st.note = "Araşdırılır…"; st.preserveScroll = true; render();
    try {
      const r = await send({ type: "aiFeatureInfo", featureId: st.feature, title: it.title, text: it.text,
        tabId: st.tabId, sourceUrl: st.sourceUrl || "", start: it.start, end: it.end });
      if (r && r.ok && r.text) { st.info.set(idx, shortInfo(r.text)); st.note = ""; }
      else st.note = "✗ " + ((r && r.error) || "alınmadı");
    } catch (e) { console.error("[AI-Extension Error]: info", e); st.note = "✗ " + (e.message || e); }
    st.preserveScroll = true; render();
  }
  async function doMore() {
    if (st.moreBusy) return;
    st.moreBusy = true; st.preserveScroll = true; st.note = "Daha çox kart hazırlanır…"; render();
    try {
      const r = await send({ type: "aiFeatureMore", tabId: st.tabId, featureId: st.feature,
        sourceUrl: st.sourceUrl || "", existing: st.items, count: F.byId(st.feature).quiz ? 5 : 10 });
      if (r && r.ok && Array.isArray(r.items) && r.items.length) {
        st.items = st.items.concat(r.items);
        st.origItems = st.items.slice();
        st.note = "";
      } else st.note = "✗ " + ((r && r.error) || "əlavə nəticə yoxdur");
    } catch (e) { console.error("[AI-Extension Error]: more", e); st.note = "✗ " + (e.message || e); }
    st.moreBusy = false; st.preserveScroll = true; render();
  }

  // Metrik açarları — UI-da heç vaxt xam ingilis açarı göstərilmir.
  const METRIC_LABELS = {
    totalWords: "Ümumi söz sayı",
    uniqueWords: "Unikal söz sayı",
    lexicalDensity: "Leksik sıxlıq",
    advancedRatio: "Qabaqcıl nisbət",
    cefr: "Avropa dil səviyyəsi",
    level: "Dil səviyyəsi",
    wpm: "Nitq sürəti (söz/dəqiqə)",
    density: "Məlumat sıxlığı",
    index: "Çətinlik indeksi",
    avgSentenceLength: "Orta cümlə uzunluğu",
    sentenceCount: "Cümlə sayı",
    totalSentences: "Ümumi cümlə sayı",
    wordCount: "Söz sayı",
    advancedWords: "Qabaqcıl sözlər",
    basicWords: "Əsas sözlər",
    vocabularyRichness: "Lüğət zənginliyi",
    typeTokenRatio: "Tip-token nisbəti",
    stopwordRatio: "Köməkçi söz nisbəti",
    avgWordLength: "Orta söz uzunluğu",
    longWordRatio: "Uzun söz nisbəti",
    readingTime: "Oxuma vaxtı",
    speechRate: "Nitq sürəti",
    complexity: "Mürəkkəblik",
    overall: "Ümumi qiymət",
    duration: "Müddət",
    durationMinutes: "Müddət (dəqiqə)",
    wordsPerMinute: "Söz/dəqiqə"
  };
  const AZ_CHARS = /[əğıöşüç]/i;
  function metricLabel(key) {
    const k = String(key == null ? "" : key).trim();
    if (!k) return "Göstərici";
    if (METRIC_LABELS[k]) return METRIC_LABELS[k];
    if (AZ_CHARS.test(k)) return k;                    // artıq Azərbaycan dilindədir
    const words = k.replace(/([a-zəğıöşüç])([A-ZƏĞIÖŞÜÇ])/g, "$1 $2").split(/[\s_]+/).filter(Boolean);
    const map = {
      total: "Ümumi", words: "söz sayı", unique: "Unikal", lexical: "Leksik", density: "sıxlıq",
      advanced: "Qabaqcıl", ratio: "nisbət", sentence: "cümlə", length: "uzunluq", count: "say",
      average: "orta", avg: "orta", word: "söz", reading: "oxuma", time: "vaxt", speech: "nitq",
      rate: "sürət", complexity: "mürəkkəblik", overall: "ümumi qiymət", score: "bal",
      basic: "əsas", vocabulary: "lüğət", richness: "zənginlik", stopword: "köməkçi söz"
    };
    const out = words.map(w => map[w.toLowerCase()] || "").filter(Boolean);
    return out.length ? out.join(" ") : "Əlavə göstərici";
  }

  function stripOptionTail(s) {
    const str = String(s || "");
    const re = /(^|[\s;,])([A-D])[\).:\-]\s+/g;
    let m, first = -1, n = 0;
    while ((m = re.exec(str))) { if (first < 0) first = m.index + m[1].length; n++; }
    if (n >= 2 && first > 0) return str.slice(0, first).replace(/[\s;,:.\-–—]+$/, "").trim();
    return str.trim();
  }

  function quizOptions(it) {
    if (Array.isArray(it.options) && it.options.length) {
      return it.options.map((v, i) => ({ k: "ABCDEF"[i] || String(i + 1), v: String(v == null ? "" : v) }));
    }
    const out = [];
    for (const k of ["A", "B", "C", "D"]) {
      const f = (it.fields || []).find(x => x.label === k);
      if (f && f.value) out.push({ k, v: f.value });
    }
    return out;
  }
  function quizCorrectLetter(it) {
    const opts = quizOptions(it);
    const ci = Number(it.correctIndex);
    if (Number.isInteger(ci) && ci >= 0 && ci < opts.length) return opts[ci].k;
    const f = (it.fields || []).find(x => x.label === "Düzgün cavab");
    const m = String((f && f.value) || "").trim().toUpperCase().match(/^([A-F])/);
    return m ? m[1] : "";
  }

  function itemsB() {
    const box = h("div");
    if (st.metrics && typeof st.metrics === "object") {
      const m = h("div", "si-b si-metrics");
      m.append(h("div", "si-title", "Metriklər"));
      for (const [k, v] of Object.entries(st.metrics)) {
        const row = h("div", "si-kv");
        row.append(h("span", "k", metricLabel(k) + ": "), h("span", "v", String(v == null ? "" : v)));
        m.append(row);
      }
      box.append(m);
    }
    if (st.summary) box.append(h("div", "si-note", st.summary));
    const feat = F.byId(st.feature) || {};
    const isQuiz = !!feat.quiz;
    const isRisk = st.feature === "risk";
    const isGloss = st.feature === "glossary";
    const isQuote = st.feature === "quotes";
    st.items.forEach((it, idx) => {
      const b = h("div", "si-b");
      if (isRisk) {
        // Yalnız bir təmiz badge: "12:00 • 45%" + qısa təsvir.
        const rf = (it.fields || []).find(x => /risk\s*%/i.test(x.label || ""));
        const raw = rf ? String(rf.value).replace(/[^0-9.,]/g, "").replace(",", ".") : "";
        const pct = Math.max(0, Math.min(100, parseFloat(raw) || 0));
        const lvl = pct >= 70 ? "high" : pct >= 40 ? "mid" : "low";
        b.append(h("div", "si-risk " + lvl, F.mmss(it.start) + " • " + Math.round(pct) + "%"));
        if (it.title && !/%/.test(it.title) && !/^\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}$/.test(it.title.trim())) b.append(h("div", "si-title", it.title));
        if (it.text) b.append(h("div", "si-text", it.text));
        if (st.expanded.get(idx)) b.append(h("div", "si-text si-exp", st.expanded.get(idx)));
      } else {
        b.append(h("div", "si-time", F.range(it.start, it.end)));
        if (isQuiz) {
          // Sual yalnız bir dəfə — variantlar ayrıca interaktiv elementlərdir.
          const q = stripOptionTail(it.text || it.title || "");
          if (q) b.append(h("div", "si-title", q));
        } else if (isGloss) {
          if (it.title) {
            const tt = h("div", "si-title", it.title);
            const n = itemFreq(it);
            if (n > 1) tt.append(h("span", "si-freq", " ×" + n));
            b.append(tt);
          }
          if (it.text) b.append(h("div", "si-text", it.text));
        } else if (isQuote) {
          if (it.quoteKind) b.append(h("span", "si-qkind" + (it.quoteKind === "Tezis" ? " thesis" : ""), it.quoteKind));
          if (it.title) b.append(h("div", "si-qtitle", it.title));
          if (it.text) b.append(h("div", it.quoteKind === "Tezis" ? "si-text" : "si-quote", it.text));
          if (it.speaker) b.append(h("div", "si-qspeaker", it.speaker));
          if (it.segmentText) b.append(h("div", "si-segtext", "Seqment mətni: " + it.segmentText));
          if (st.expanded.get(idx)) b.append(h("div", "si-text si-exp", st.expanded.get(idx)));
        } else {
          if (it.title) b.append(h("div", "si-title", it.title));
          if (it.text) b.append(h("div", "si-text", it.text));
          if (st.expanded.get(idx)) b.append(h("div", "si-text si-exp", st.expanded.get(idx)));
          if (Array.isArray(it.fields) && it.fields.length) {
            const fl = h("div", "si-fields");
            for (const f of it.fields) {
              if (!f || (!f.label && !f.value)) continue;
              const row = h("div", "si-kv");
              if (f.label) row.append(h("span", "k", f.label + ": "));
              if (f.value) row.append(h("span", "v", f.value));
              fl.append(row);
            }
            b.append(fl);
          }
        }
      }
      if (isQuiz) {
        const opts = quizOptions(it);
        if (opts.length) {
          const qb = h("div", "si-quiz");
          for (const o of opts) {
            const lb = h("label", "si-opt" + (st.quizSel.get(idx) === o.k ? " sel" : ""));
            const r = document.createElement("input");
            r.type = "radio"; r.name = "q" + idx; r.checked = st.quizSel.get(idx) === o.k;
            r.onchange = () => { st.quizSel.set(idx, o.k); if (st.quizChecked) st.quizChecked = false; render(); };
            lb.append(r, h("span", "n", o.k + ") " + o.v));
            qb.append(lb);
          }
          b.append(qb);
        }
        if (st.quizChecked) {
          const correct = quizCorrectLetter(it);
          const sel = st.quizSel.get(idx) || "";
          const ok = !!correct && sel === correct;
          const ctext = opts.find(o => o.k === correct);
          const ex = it.explanation || ((it.fields || []).find(x => x.label === "İzah") || {}).value || "";
          b.append(h("div", "si-ans" + (ok ? " ok" : " bad"), "Düzgün cavab: " + (correct ? correct + ") " + (ctext ? ctext.v : "") : "—")));
          if (ex) b.append(h("div", "si-text", ex));
        }
      }
      if (feat.expand || feat.info) {
        const bar2 = h("div", "si-item-btns");
        if (feat.expand) {
          const eb = h("button", "si-mini", "Genişləndir");
          eb.onclick = () => doExpand(idx, it);
          bar2.append(eb);
        }
        if (feat.info) {
          const ib = h("button", "si-mini i", "i");
          ib.title = "Qısa izah";
          ib.onclick = () => doInfo(idx, it);
          bar2.append(ib);
        }
        b.append(bar2);
      }
      const inf = String(st.info.get(idx) || "").trim();
      if (inf) b.append(h("div", "si-info", /^\(.*\)$/.test(inf) ? inf : "(" + inf + ")"));
      box.append(b);
    });
    return box;
  }

  const fmtBytes = n => {
    const v = +n || 0;
    if (!v) return "0 MB";
    return v > 1e9 ? (v / 1e9).toFixed(2) + " GB" : v > 1e6 ? (v / 1e6).toFixed(1) + " MB" : Math.round(v / 1e3) + " KB";
  };
  const fmtSpeed = n => {
    const v = +n || 0;
    if (!v) return "—";
    return v > 1e6 ? (v / 1e6).toFixed(1) + " MB/s" : Math.round(v / 1e3) + " KB/s";
  };

  function jobBar() {
    const it = st.jobItem || {};
    const pct = Math.max(0, Math.min(100, +it.progress || 0));
    const done = fmtBytes(it.done || 0);
    const size = it.size ? fmtBytes(it.size) : "";
    const bar = h("div", "si-jobbar" + (it.status === "error" ? " err" : it.status === "complete" ? " done" : ""));
    const r1 = h("div", "r1");
    r1.append(h("span", "p", Math.round(pct) + "%"));
    r1.append(h("span", "sp"));
    r1.append(h("span", "m", (it.status === "complete" ? "✓ Tamamlandı" : fmtSpeed(it.speed)) + (size ? " · " + done + " / " + size : done !== "0 MB" ? " · " + done : "")));
    bar.append(r1);
    const b = h("div", "bar"); const fill = h("i"); fill.style.width = pct + "%"; b.append(fill); bar.append(b);
    bar.append(h("div", "ph", it.phase || (st.job ? "Yükləmə başladılır…" : "")));
    return bar;
  }

  let jobMisses = 0;
  async function pollCutJob() {
    const job = st.job;
    if (!job) return;
    try {
      const r = await send({ type: "aiCutStatus", id: job.id });
      jobMisses = (r && r.ok && r.item) ? 0 : jobMisses + 1;
      if (jobMisses >= 3) {
        st.job = null;
        st.note = "✗ Kəsmə işi tapılmadı (helper yenidən başladı?) — yenidən cəhd edin";
        st.jobItem = null;
        render();
        return;
      }
      if (r && r.ok && r.item) {
        st.jobItem = r.item;
        render();
        if (r.item.status === "complete" || r.item.status === "error") {
          st.job = null;
          st.note = r.item.status === "complete"
            ? "✓ Hazırdır: " + (r.item.path || r.item.name || "")
            : "✗ " + (r.item.error || "kəsmə alınmadı");
          render();
          return;
        }
      }
    } catch (e) { console.error("[AI-Extension Error]: job status alınmadı", e); }
    setTimeout(pollCutJob, 800);
  }

  function render() {
    try { renderInner(); } catch (err) { console.error("[AI-Extension Error]: render xətası", err); }
  }
  function renderInner() {
    const root = st.root;
    if (!root) { console.error("[AI-Extension Error]: render üçün root yoxdur"); return; }
    const oldBody = root.querySelector(".si-body");
    const keepTop = st.preserveScroll && oldBody ? oldBody.scrollTop : 0;
    const f = F.byId(st.feature);
    root.replaceChildren(header(f ? f.name : "Sİ", true));
    const body = h("div", "si-body");
    body.append(toolbar());
    if (st.note) body.append(h("div", "si-note", st.note));
    const curF = F.byId(st.feature);
    if (!st.running && curF && !curF.native && !st.hasSubs && st.debug) {
      const d = st.debug;
      body.append(h("div", "si-diag", [
        "build: " + (self.__SI_BUILD || "—"),
        "tab: " + st.tabId,
        "səhifə: " + (d.pageUrl || "—"),
        "keş: " + (d.cached ? "var" : "yox") + " · səhifə trekləri: " + (d.subMedia || 0) + " · captionTracks: " + (d.captions || 0),
        "yt-dlp probe: " + (d.probe || "—") + (d.error ? " · " + d.error : ""),
        "nəticə: " + (d.total || 0)
      ].join("\n")));
    }
    if (st.error) body.append(h("div", "si-err", st.error));
    if (st.running) {
      const p = h("div", "si-prog on", "Gemini transkripti analiz edir… (bu 10–40 saniyə çəkə bilər)");
      body.append(p);
    }
    if (st.items.length || st.metrics) {
      if (st.items.length) body.append(h("div", "si-note", `${st.items.length} ${st.mode === "A" ? "seqment" : "hissə"}`));
      body.append(st.mode === "A" && st.items.length ? itemsA() : itemsB());
    }
    root.append(body);
    if (st.preserveScroll) {
      st.preserveScroll = false;
      body.scrollTop = keepTop;
      body.getBoundingClientRect();
      setTimeout(() => { body.scrollTop = keepTop; }, 0);
    }
    const featM = st.feature ? F.byId(st.feature) : null;
    if (featM && featM.more && st.items.length) {
      const mb = h("div", "si-more");
      const b = h("button", "si-btn ghost", st.moreBusy ? "Hazırlanır…" : "Daha çox");
      b.disabled = !!st.moreBusy;
      b.onclick = () => doMore();
      mb.append(b);
      body.append(mb);
    }
    if (st.mode === "A" && st.items.length) {
      const foot = h("div", "si-foot");
      const info = h("span", "si-note", st.sel.length ? `${st.sel.length} seqment seçildi` : "Seqment seçin");
      foot.append(info, h("span", "si-sp"));
      const dl = h("button", "si-btn", st.sel.length ? `Endir (${st.sel.length})` : "Endir");
      dl.disabled = !st.sel.length;
      dl.onclick = async () => {
        const items = st.sel.map(i => st.items[i]).filter(Boolean);
        dl.disabled = true; dl.textContent = "Başladılır…";
        try {
          const r = await send({ type: "aiFeatureCut", tabId: st.tabId, items, subUrls: st.sourceUrl ? [st.sourceUrl] : [] });
          if (r && r.ok) {
            st.job = { id: r.id || "", name: r.name || "" };
            st.jobItem = { progress: 0, phase: "Yükləmə başladılır…", status: "active" };
            st.note = `✓ ${r.count || items.length} seqment: əvvəl tam yükləmə, sonra itkisiz kəsmə`;
            pollCutJob();
          } else {
            st.note = "✗ " + ((r && r.error) || "klip yaradılmadı");
          }
        } catch (e) { st.note = "✗ " + (e.message || e); }
        render();
      };
      foot.append(dl);
      root.append(foot);
    }
    if (st.job || st.jobItem) {
      try { root.append(jobBar()); } catch (e) { console.error("[AI-Extension Error]: job bar", e); }
    }
  }

  self.IDMAI_PANEL = { mount };
})();
