const HELPER = "http://127.0.0.1:6811";
const $ = id => document.getElementById(id);
const api = async (p, b) => {
  const r = await fetch(HELPER + p, {
    method: b ? "POST" : "GET", headers: b ? { "Content-Type": "application/json" } : {},
    body: b ? JSON.stringify(b) : undefined, signal: AbortSignal.timeout(3000)
  });
  return r.json();
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = n => !n ? "0" : n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB";
const fmtEta = s => { if (s == null || !isFinite(s)) return ""; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}s ${m}d` : m ? `${m}d ${s % 60}san` : `${s}san`; };
const STATUS = { active: "Yüklənir", waiting: "Növbədə", paused: "Dayandırılıb", complete: "Tamamlandı", error: "Xəta" };

const CAPS = ["capTikTok", "capInstagram", "capWhatsApp", "capX", "capFacebook", "capTelegram"];
const DEFAULTS = { enabled: true, intercept: true, overlay: true, subs: true, feedMode: true,
  capTikTok: true, capInstagram: true, capWhatsApp: true, capX: true, capFacebook: true, capTelegram: true };
chrome.storage.local.get(Object.keys(DEFAULTS)).then(s => {
  const v = { ...DEFAULTS, ...s };
  for (const k of ["enabled", "intercept", "overlay", "subs", "feedMode", ...CAPS]) {
    $(k).checked = v[k];$(k).onchange = e => { chrome.storage.local.set({ [k]: e.target.checked }); if (k === "enabled") applyOn(e.target.checked); };
  }
  applyOn(v.enabled);
});
// Paralel axın sayı (video / audio): boş = standart; 1..16
for (const k of ["vstreams", "astreams"]) {
  chrome.storage.local.get(k).then(s => { if (s[k]) $(k).value = s[k]; });
  $(k).onchange = e => {
    const n = Math.min(16, Math.max(0, parseInt(e.target.value, 10) || 0));
    e.target.value = n || ""; chrome.storage.local.set({ [k]: n });
  };
}
function applyOn(on) {
  document.body.classList.toggle("off", !on);
  $("onl").textContent = on ? "Aktiv" : "Söndürülüb";
}
// Alt yazı ayarları helper-in JSON faylından oxunur (aşağıda loadSubSettingsFromHelper).
// ---- AI Subtitr: hədəf dil + progress
let aiTarget = "az";
chrome.storage.local.get("aiTargetLang").then(s => { if (s.aiTargetLang) aiTarget = String(s.aiTargetLang); }).catch(() => {});
// ---- Sİ (AI) paneli: kontekst menyusundan gələn sorğu ----
async function openSiPanel(feature) {
  const host = $("siHost");
  if (!host || !self.IDMAI_PANEL) {
    console.error("[AI-Extension Error]: #siHost və ya IDMAI_PANEL yoxdur — AI tabı açılır");
    try { chrome.runtime.sendMessage({ type: "siOpenFeature", featureId: feature || "" }).catch(() => {}); } catch {}
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  host.hidden = false;
  try {
    self.IDMAI_PANEL.mount(host, {
      tabId: tab.id,
      feature: feature || "",
      onClose: () => { host.hidden = true; host.replaceChildren(); }
    });
  } catch (e) {
    // Panel qurulmadı: AI tabını aç ki istifadəçi nəticəni görsün.
    console.error("[AI-Extension Error]: overlay mount xətası", e);
    host.hidden = true;
    try { chrome.runtime.sendMessage({ type: "siOpenFeature", tabId: tab.id, featureId: feature || "" }).catch(() => {}); } catch {}
  }
}
chrome.storage.session.get("siPending").then(s => {
  const p = s && s.siPending;
  if (p && Date.now() - (+p.t || 0) < 60000) {
    chrome.storage.session.remove("siPending").catch(() => {});
    openSiPanel(p.feature);
  }
}).catch(() => {});

// ---- Ayarlar görünüşü (çarx ikonu) ----
const setEl = $("settings");
function showSection(sec) {
  closeSubMenu();
  for (const b of setEl.querySelectorAll(".set-nav button")) b.classList.toggle("on", b.dataset.sec === sec);
  for (const p of setEl.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== sec;
}
function openSettings(sec = "ai") { setEl.hidden = false; document.body.classList.add("set-open"); showSection(sec); }
function closeSettings() { closeSubMenu(); setEl.hidden = true; document.body.classList.remove("set-open"); }
$("gear").onclick = () => openSettings("ai");
$("setClose").onclick = closeSettings;
for (const b of setEl.querySelectorAll(".set-nav button")) b.onclick = () => showSection(b.dataset.sec);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !setEl.hidden) closeSettings(); });

// ---- Ayarlar → İnterfeys: dil və tema ----
const uiLangEl = $("uiLang"), uiThemeEl = $("uiTheme");
if (uiLangEl || uiThemeEl) {
  chrome.storage.local.get(["uiLang", "uiTheme"]).then(v => {
    if (uiLangEl) uiLangEl.value = ["az", "ru", "en"].includes(v && v.uiLang) ? v.uiLang : "az";
    if (uiThemeEl) uiThemeEl.value = v && v.uiTheme === "light" ? "light" : "dark";
  }).catch(() => {});
  if (uiLangEl) uiLangEl.onchange = () => { try { window.IDM_I18N && IDM_I18N.setLang(uiLangEl.value); } catch {} };
  if (uiThemeEl) uiThemeEl.onchange = () => { try { window.IDM_I18N && IDM_I18N.setTheme(uiThemeEl.value); } catch {} };
}

// ---- Ayarlar → Alt yazı: ölçü, stil, fon qaralması (dərhal tətbiq, saxlama yoxdur) ----
const SUB_APP_DEF = { size: 16, bold: false, italic: false, underline: false, bg: 10, style: "default", font: "Default", fontResolved: "", fontMissing: false, fontFallback: "" };
const SUB_STYLE_OPTS = [["default", "Default"], ["academic", "Akademik"], ["colloquial", "Danışıq"], ["simplified", "Sadələşdirilmiş"]];
const SUB_VISUAL_OPTS = [["default", "Default"], ["cinematic", "Kinematoqrafik"], ["minimalist", "Minimalist"], ["neon", "Neon"]];
const SUB_FONT_FALLBACKS = ["Default", "Roboto", "Noto Sans", "Arial", "Inter", "Georgia", "Times New Roman", "Verdana", "Tahoma", "Trebuchet MS", "DejaVu Sans", "Liberation Sans"];
let subFonts = SUB_FONT_FALLBACKS.slice();
const subClamp = (n, a, b, d) => { n = Math.round(+n); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
const subNorm = v => {
  v = v && typeof v === "object" ? v : {};
  const sty = v.style || v.aiStyle;
  return {
    size: subClamp(v.size, 2, 200, SUB_APP_DEF.size),
    bold: !!v.bold, italic: !!v.italic, underline: !!v.underline,
    bg: subClamp(v.bg, 0, 100, SUB_APP_DEF.bg),
    style: SUB_STYLE_OPTS.some(([k]) => k === sty) ? sty : SUB_APP_DEF.style,
    font: String(v.font || "Default").slice(0, 120) || "Default",
    fontResolved: String(v.fontResolved || "").slice(0, 120),
    fontMissing: !!v.fontMissing,
    fontFallback: String(v.fontFallback || "").slice(0, 120)
  };
};
let subApp = { ...SUB_APP_DEF };
let subVisual = "default";
const subLabel = (opts, key) => (opts.find(([k]) => k === key) || opts[0])[1];
let subMenu = null;
function closeSubMenu() {
  if (!subMenu) return;
  try { document.removeEventListener("pointerdown", subMenu._out, true); } catch {}
  try { document.removeEventListener("keydown", subMenu._key, true); } catch {}
  try { window.removeEventListener("resize", subMenu._close); } catch {}
  try { window.removeEventListener("scroll", subMenu._close, true); } catch {}
  try { subMenu.remove(); } catch {}
  subMenu = null;
}
function openSubMenu(btn, opts, cur, onPick) {
  closeSubMenu();
  const m = el("div", "sub-menu");
  for (const [key, name] of opts) {
    const b = el("button", key === cur ? "on" : "");
    b.type = "button";
    const chk = el("span", "chk", key === cur ? "✓" : "");
    const tx = el("span", "", name); tx.style.cssText = "flex:1;min-width:0";
    b.append(chk, tx);
    b.onclick = ev => { ev.stopPropagation(); closeSubMenu(); onPick(key); };
    m.append(b);
  }
  m._out = ev => { if (!m.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) closeSubMenu(); };
  m._key = ev => { if (ev.key === "Escape") { ev.stopPropagation(); closeSubMenu(); } };
  m._close = ev => { if (ev && ev.target && ev.target.nodeType && m.contains(ev.target)) return; closeSubMenu(); };
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  m.style.minWidth = Math.max(134, r.width) + "px";
  m.style.left = Math.max(6, Math.min(window.innerWidth - m.offsetWidth - 6, r.left)) + "px";
  const below = r.bottom + 4, above = r.top - m.offsetHeight - 4;
  m.style.top = ((below + m.offsetHeight <= window.innerHeight - 6 || above < 6) ? below : above) + "px";
  const on = m.querySelector("button.on");
  if (on) { try { on.scrollIntoView({ block: "nearest" }); } catch {} }
  document.addEventListener("pointerdown", m._out, true);
  document.addEventListener("keydown", m._key, true);
  window.addEventListener("resize", m._close);
  window.addEventListener("scroll", m._close, true);
  subMenu = m;
}
function subPaint() {
  const sBtn = $("subStyleBtn"), vBtn = $("subVisualBtn"), zBtn = $("subSizeBtn"), fBtn = $("subFontBtn");
  if (sBtn) sBtn.querySelector(".v").textContent = subLabel(SUB_STYLE_OPTS, subApp.style);
  if (vBtn) vBtn.querySelector(".v").textContent = subLabel(SUB_VISUAL_OPTS, subVisual);
  if (zBtn) zBtn.querySelector(".v").textContent = String(subApp.size);
  if (fBtn) fBtn.querySelector(".v").textContent = subApp.font || "Default";
  const note = $("subFontNote");
  if (note) {
    if (subApp.font && subApp.font !== "Default" && subApp.fontMissing) {
      note.hidden = false;
      note.textContent = "⚠ “" + subApp.font + "” sistemdə tapılmadı — " + (subApp.fontResolved || subApp.fontFallback || "fallback") + " istifadə olunur.";
    } else if (subApp.font && subApp.font !== "Default" && subApp.fontResolved && subApp.fontResolved.toLowerCase() !== subApp.font.toLowerCase()) {
      note.hidden = false;
      note.textContent = "MPV/YouTube üçün: " + subApp.fontResolved;
    } else {
      note.hidden = true; note.textContent = "";
    }
  }
  for (const b of setEl.querySelectorAll(".sub-tg")) b.classList.toggle("on", !!subApp[b.dataset.t]);
  const bg = $("subBg"), bgv = $("subBgVal");
  if (bg) bg.value = subApp.bg;
  if (bgv) bgv.textContent = subApp.bg + "%";
  const pv = $("subPreviewText");
  if (pv) {
    const ratio = subApp.size / 16;
    const fs = Math.max(10, Math.min(34, 11 + Math.log2(ratio + 1) * 9));
    const alpha = Math.round(subApp.bg * 2.55);
    pv.style.fontSize = fs.toFixed(1) + "px";
    const fams = subApp.font && subApp.font !== "Default"
      ? [...new Set([subApp.font, subApp.fontResolved, "sans-serif"].filter(Boolean).map(x => String(x).replace(/"/g, "")))]
      : [];
    pv.style.fontFamily = fams.length ? fams.map(x => x === "sans-serif" ? x : '"' + x + '"').join(", ") : "";
    pv.style.fontWeight = subApp.bold ? "700" : "400";
    pv.style.fontStyle = subApp.italic ? "italic" : "normal";
    pv.style.textDecoration = subApp.underline ? "underline" : "none";
    pv.style.background = alpha > 0 ? "rgba(0,0,0," + (alpha / 255).toFixed(3) + ")" : "transparent";
    pv.style.padding = alpha > 0 ? "2px 7px" : "2px 0";
    pv.style.borderRadius = alpha > 0 ? "3px" : "0";
  }
}
function subPersist() {
  const payload = {
    size: subApp.size, bold: !!subApp.bold, italic: !!subApp.italic, underline: !!subApp.underline,
    bg: subApp.bg, font: subApp.font || "Default", visualStyle: subVisual, aiStyle: subApp.style
  };
  chrome.storage.local.set({ subAppearance: { ...subApp }, subVisualStyle: subVisual }).catch(() => {});
  // Əsas mənbə helper-in JSON faylıdır; MPV Lua onu izləyir.
  try {
    fetch(HELPER + "/subtitle-settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(6000)
    }).then(r => r.json()).then(j => {
      if (j && j.ok && j.settings) {
        const s = subNorm({ ...j.settings, style: j.settings.aiStyle });
        subApp.font = s.font; subApp.fontResolved = s.fontResolved;
        subApp.fontMissing = s.fontMissing; subApp.fontFallback = s.fontFallback;
        chrome.storage.local.set({ subAppearance: { ...subApp } }).catch(() => {});
        subPaint();
      }
      if (j && Array.isArray(j.fonts) && j.fonts.length) subFonts = j.fonts.slice();
    }).catch(() => {});
  } catch {}
}
function subBind() {
  const sBtn = $("subStyleBtn"), vBtn = $("subVisualBtn"), zBtn = $("subSizeBtn"), fBtn = $("subFontBtn");
  if (sBtn) sBtn.onclick = () => openSubMenu(sBtn, SUB_STYLE_OPTS, subApp.style, v => { subApp.style = v; subPaint(); subPersist(); });
  if (vBtn) vBtn.onclick = () => openSubMenu(vBtn, SUB_VISUAL_OPTS, subVisual, v => {
    subVisual = v; subPaint(); chrome.storage.local.set({ subVisualStyle: v }).catch(() => {}); subPersist();
  });
  if (fBtn) fBtn.onclick = () => {
    const seen = new Set(), opts = [];
    for (const f of ["Default", ...(subFonts || [])]) {
      const k = String(f || "").trim(); if (!k || seen.has(k)) continue;
      seen.add(k); opts.push([k, k]);
    }
    opts.sort((a, b) => a[0] === "Default" ? -1 : b[0] === "Default" ? 1 : a[1].localeCompare(b[1]));
    openSubMenu(fBtn, opts, subApp.font || "Default", v => { subApp.font = v; subPaint(); subPersist(); });
  };
  if (zBtn) zBtn.onclick = () => {
    const opts = []; for (let n = 2; n <= 200; n++) opts.push([String(n), String(n)]);
    openSubMenu(zBtn, opts, String(subApp.size), v => { subApp.size = subClamp(v, 2, 200, 16); subPaint(); subPersist(); });
  };
  for (const b of setEl.querySelectorAll(".sub-tg")) b.onclick = () => {
    const k = b.dataset.t; if (!["bold", "italic", "underline"].includes(k)) return;
    subApp[k] = !subApp[k]; subPaint(); subPersist();
  };
  const bg = $("subBg");
  if (bg) bg.oninput = () => {
    subApp.bg = subClamp(bg.value, 0, 100, 10);
    subPaint();
    clearTimeout(bg._t); bg._t = setTimeout(subPersist, 120);   // sürüşdürmə zamanı yazmaları yığcamlaşdır
  };
}
subBind();
subPaint();
chrome.storage.local.get(["subAppearance", "subVisualStyle"]).then(s => {
  subApp = subNorm(s && s.subAppearance);
  subVisual = SUB_VISUAL_OPTS.some(([k]) => k === (s && s.subVisualStyle)) ? s.subVisualStyle : "default";
  subPaint();
}).catch(() => {});

// Helper JSON əsas mənbədir: açılışda oradan oxu, UI + storage + YouTube CSS-i bərpa et.
async function loadSubSettingsFromHelper() {
  try {
    const r = await fetch(HELPER + "/subtitle-settings", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (!j || !j.ok || !j.settings) return;
    if (Array.isArray(j.fonts) && j.fonts.length) subFonts = j.fonts.slice();
    const h = subNorm({ ...j.settings, style: j.settings.aiStyle });
    const s = await chrome.storage.local.get(["subAppearance", "subVisualStyle"]).catch(() => ({}));
    const storeApp = subNorm(s && s.subAppearance);
    const storeNonDefault = storeApp.size !== 16 || storeApp.bold || storeApp.italic || storeApp.underline ||
      storeApp.bg !== 10 || storeApp.font !== "Default" || storeApp.style !== "default" ||
      ((s && s.subVisualStyle) || "default") !== "default";
    if (j.seedNeeded && storeNonDefault) {
      // Köhnə chrome.storage ayarlarını helper-ə bir dəfəlik köçür.
      subApp = storeApp;
      subVisual = SUB_VISUAL_OPTS.some(([k]) => k === (s && s.subVisualStyle)) ? s.subVisualStyle : "default";
      subPaint(); subPersist();
      return;
    }
    subApp = h;
    subVisual = SUB_VISUAL_OPTS.some(([k]) => k === j.settings.visualStyle) ? j.settings.visualStyle : "default";
    await chrome.storage.local.set({ subAppearance: { ...subApp }, subVisualStyle: subVisual }).catch(() => {});
    subPaint();
  } catch {}
}
loadSubSettingsFromHelper();
chrome.storage.onChanged.addListener(ch => {
  if (ch.subAppearance) { subApp = subNorm(ch.subAppearance.newValue); subPaint(); }
  if (ch.subVisualStyle) {
    subVisual = SUB_VISUAL_OPTS.some(([k]) => k === ch.subVisualStyle.newValue) ? ch.subVisualStyle.newValue : "default";
    subPaint();
  }
});

// ---- Sİ: Gemini açarı + model (options.html-dən köçürülüb) ----
const AI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const aiKeyEl = $("key"), aiModelEl = $("model"), aiStatusEl = $("status"), aiNowEl = $("modelNow");
let aiModels = [];
const aiStatus = (text, cls) => { aiStatusEl.textContent = text; aiStatusEl.className = cls || ""; };
const aiNow = name => { aiNowEl.textContent = name || "—"; };
function aiFillModels(list, selected) {
  aiModelEl.replaceChildren();
  for (const name of list) {
    const o = document.createElement("option");
    o.value = name; o.textContent = name;
    aiModelEl.append(o);
  }
  if (selected && list.includes(selected)) aiModelEl.value = selected;
  aiModelEl.disabled = !list.length;
  if (!list.length) { const o = document.createElement("option"); o.value = ""; o.textContent = "— model yoxdur —"; aiModelEl.append(o); }
}
async function aiFetchModels(key) {
  const r = await fetch(`${AI_API}?key=${encodeURIComponent(key)}`, { method: "GET", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const list = (j.models || [])
    .filter(m => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes("generateContent"))
    .map(m => String(m.name || "").replace(/^models\//, ""))
    .filter(Boolean);
  return [...new Set(list)];
}
async function aiVerify(auto = false) {
  const key = String(aiKeyEl.value || "").trim();
  if (!key) { aiStatus("✕ API açarı yazın", "bad"); aiFillModels([]); return false; }
  aiStatus(auto ? "Yaddaşdakı açar yoxlanılır…" : "Yoxlanılır…", "wait");
  try {
    const list = await aiFetchModels(key);
    if (!list.length) throw new Error("generateContent modeli yoxdur");
    aiModels = list;
    const old = await chrome.storage.local.get("geminiModel");
    const want = String(old.geminiModel || "");
    const selected = list.includes(want) ? want : list[0];
    aiFillModels(list, selected);
    await chrome.storage.local.set({ geminiApiKey: key, geminiModel: selected });
    aiNow(selected);
    aiStatus("✓ Açar etibarlıdır", "ok");
    return true;
  } catch (e) {
    aiModels = [];
    aiFillModels([]);
    aiStatus("✕ Açar etibarsızdır", "bad");
    return false;
  }
}
$("verify").onclick = () => aiVerify(false);
aiKeyEl.addEventListener("input", () => { if (aiStatusEl.className === "ok") aiStatus("Açar dəyişdi — yenidən yoxlayın", "wait"); });
aiModelEl.addEventListener("change", async () => {
  const key = String(aiKeyEl.value || "").trim();
  const model = aiModelEl.value;
  if (!key || !model) return;
  await chrome.storage.local.set({ geminiApiKey: key, geminiModel: model });
  aiNow(model);
  aiStatus("✓ Açar etibarlıdır", "ok");
});
chrome.storage.local.get(["geminiApiKey", "geminiModel"]).then(s => {
  if (s.geminiApiKey) aiKeyEl.value = s.geminiApiKey;
  aiNow(s.geminiModel);
  if (s.geminiModel) {
    const o = document.createElement("option");
    o.value = s.geminiModel; o.textContent = s.geminiModel;
    aiModelEl.append(o);
  }
  if (!aiModelEl.options.length) {
    const o = document.createElement("option");
    o.value = ""; o.textContent = "— model seçilməyib —";
    aiModelEl.append(o);
  }
  aiStatus(s.geminiApiKey ? "Yaddaşdakı açar — modelləri yeniləmək üçün “Yoxla”" : "API açarı təyin edilməyib", "");
}).catch(() => aiStatus("Yaddaş oxunmadı", "bad"));
chrome.storage.onChanged.addListener(ch => { if (ch.geminiModel) aiNow(ch.geminiModel.newValue); });
chrome.runtime.onMessage.addListener(m => {
  if (!m || m.type !== "aiProgress" || !m.id) return;
  const card = document.querySelector(`[data-ai-id="${String(m.id).replace(/[^\w-]/g, "")}"]`);
  if (!card) return;
  const prog = card.querySelector(".ai-prog"), bar = card.querySelector(".ai-bar i"), pct = card.querySelector(".ai-pct"), eta = card.querySelector(".ai-eta"), msg = card.querySelector(".ai-msg");
  if (prog) prog.style.display = "block";
  const n = Math.max(0, Math.min(100, +m.pct || 0));
  const etaSec = +m.eta;
  const s = card._aiState;
  const v = (s && s.view) ? s.view(n, String(m.text || m.status || ""), etaSec) : { pct: n, text: String(m.text || m.status || ""), eta: etaSec, count: "" };
  if (s && s.animateTo) s.animateTo(v.pct, () => ({ bar, pct }));
  else { if (bar) bar.style.width = v.pct + "%"; if (pct) pct.textContent = (v.count ? v.count + " · " : "") + Math.round(v.pct) + "%"; }
  if (eta) eta.textContent = (!m.error && !m.done && v.pct < 100 && v.eta > 0) ? "qalıb ~ " + fmtEta(v.eta) : "";
  if (msg) {
    msg.textContent = v.text;
    const paths = [];
    if (m.sourcePath) paths.push("Orijinal: " + m.sourcePath);
    if (m.path) paths.push("Tərcümə: " + m.path);
    msg.title = paths.join("\n");
  }
  card.classList.toggle("err", !!m.error);
  card.classList.toggle("done", !!m.done || v.pct >= 100);
  if (s) { s.pct = v.pct; s.text = v.text; s.count = v.count || ""; s.eta = (v.eta > 0 && !m.error && !m.done && v.pct < 100) ? v.eta : null; s.path = String(m.path || ""); if (m.error || m.done) s.running = false; }
  if (m.error || m.done) { const tr = card.querySelector(".ai-sub-trigger"); if (tr) tr.disabled = false; }
});

let loadSeq = 0, feedT = 0;
const feedState = { open: new Set(), loaded: new Map() };
const feedApi = tabId => ({
  state: feedState,
  group: key => chrome.runtime.sendMessage({ type: "feedGroup", tabId, key }),
  refresh: async () => { await chrome.runtime.sendMessage({ type: "feedRefresh", tabId }).catch(() => {}); loadMedia(); }
});
let stateT = 0;
const scheduleMedia = (delay = 220) => { clearTimeout(stateT); stateT = setTimeout(() => loadMedia(), delay); };
chrome.runtime.onMessage.addListener(m => {
  if (!m || !(m.type === "feedChanged" || m.type === "mediaReset" || m.type === "mediaStateChanged")) return;
  const delay = m.type === "feedChanged" ? 300 : 180;
  if (m.tabId == null) { scheduleMedia(delay); return; }
  chrome.tabs.query({ active: true, currentWindow: true }).then(ts => { if (ts[0] && ts[0].id === m.tabId) scheduleMedia(delay); }).catch(() => {});
});   // media map / feed / player / yeni axın dəyişəndə cari siyahı DƏRHAL yenilənir
try {
  chrome.tabs.onUpdated.addListener((id, ch, tab) => {
    if (ch.url === undefined && ch.status === undefined) return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(ts => { if (ts[0] && ts[0].id === id) scheduleMedia(120); }).catch(() => {});
  });
  chrome.tabs.onActivated.addListener(() => scheduleMedia(120));
} catch {}
// Sİ: yuxarı paneldə son kliklənən keyfiyyət sətrini yadda saxla (miras üçün).
document.addEventListener("click", ev => {
  try {
    const row = ev.target && ev.target.closest ? ev.target.closest("#media .row") : null;
    if (!row) return;
    const name = row.querySelector(".name");
    const label = name ? String(name.textContent || "").trim() : "";
    if (!label) return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab || tab.id == null) return;
      chrome.runtime.sendMessage({ type: "siActivePatch", tabId: tab.id, quality: label }).catch(() => {});
    }).catch(() => {});
  } catch {}
}, true);

const ctxNote = t => { try { const b = $("media"); const d = el("div", "row meta", t); b.prepend(d); setTimeout(() => d.remove(), 6000); } catch {} };
$("rescan").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  $("rescan").disabled = true;
  try { await chrome.runtime.sendMessage({ type: "rescan", tabId: tab.id }); } catch {}
  try { await chrome.tabs.sendMessage(tab.id, { type: "rescanPage" }); } catch {}
  await new Promise(r => setTimeout(r, 900));
  $("rescan").disabled = false;
  loadMedia(true);
};
let lastSig = "";
async function loadMedia(force = false) {
  const seq = ++loadSeq;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ctxHandlers = IDMShared.makeContextHandlers(m => chrome.runtime.sendMessage({ tabId: tab.id, ...m }), ctxNote);
  // Sağ klik → Sİ alt menyusu → xüsusiyyət: sətrin axınını miras verib paneli aç.
  ctxHandlers.siFeature = async (info, featureId) => {
    if (!featureId) { console.error("[AI-Extension Error]: siFeature üçün featureId yoxdur"); return; }
    try {
      const [t0] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (t0 && t0.id != null) {
        await chrome.runtime.sendMessage({
          type: "siActivePatch", tabId: t0.id, quality: info && info.name || "",
          stream: info ? { url: info.url || "", kind: info.kind || "file", name: info.name || "" } : null
        }).catch(() => {});
      }
    } catch (e) { console.error("[AI-Extension Error]: miras ötürülmədi", e); }
    // Hər halda panel açılsın.
    try { await openSiPanel(featureId); }
    catch (e) {
      console.error("[AI-Extension Error]: panel açılmadı", e);
      try { chrome.runtime.sendMessage({ type: "siOpenFeature", featureId }).catch(() => {}); } catch {}
    }
  };
  ctxHandlers.si = async info => {
    const [t0] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t0 || t0.id == null) return;
    try {
      await chrome.runtime.sendMessage({
        type: "siActivePatch", tabId: t0.id, quality: info && info.name || "",
        stream: info ? { url: info.url || "", kind: info.kind || "file", name: info.name || "" } : null
      });
    } catch {}
    openSiPanel("");
  };
  const box = $("media");
  // İstifadəçi alt yazı panelindədirsə: DOM-u dəyişmə (seçim etməyə mane olmasın).
  if (!force && box.children.length && IDMShared.subPanelOpen && IDMShared.subPanelOpen()) return;
  // Yalnız ilk açılışda "yoxlanılır" göstər: hər state yeniləməsində mətn yanıb-sönməsin.
  if (!box.children.length || force) box.replaceChildren(el("div", "row meta", "Keyfiyyətlər yoxlanılır..."));
  const [r, aiState] = await Promise.all([
    chrome.runtime.sendMessage({ type: "getOptions", tabId: tab.id, fast: true }).catch(() => null),
    chrome.runtime.sendMessage({ type: "aiResults", tabId: tab.id }).catch(() => null)
  ]);
  if (seq !== loadSeq) return;   // köhnə cavab yenisini əvəz etməsin
  const sig = IDMShared.sigOf ? IDMShared.sigOf(r) : "";
  if (!force && sig && sig === lastSig && box.children.length && !box.querySelector(".row.meta")?.textContent?.includes("yoxlanılır")) {
    return;   // məzmun dəyişməyib: DOM-a toxunma
  }
  lastSig = sig;
  box.replaceChildren();
  if (!r || r.ok === false) { box.append(el("div", "row meta", "✗ " + ((r && r.error) || "xəta"))); return; }
  const addRow = (parent, tag, name, size, title, getPayload, meta) => {
    const row = el("div", "row");
    // meta verilibsə: vahid dizayn (sağda format + həcm, üzərinə gələndə məlumat pəncərəsi); verilməyibsə əvvəlki görünüş
    row.append(el("span", "tag", tag), el("span", "name", meta ? (IDMShared.rowTitle(name, meta, 38) || tag) : name), meta ? IDMShared.metaEl(meta) : el("span", "meta", size ? fmt(size) : ""));
    if (meta && meta.tip) IDMShared.attachTip(row, meta.tip, document.body, 2000);
    const b = el("button", "", "⬇"); b.title = meta ? "Yüklə" : (title || name);
    b.onclick = async () => {
      b.disabled = true; b.textContent = "…";
      const x = await chrome.runtime.sendMessage({ type: "download", tabId: tab.id, ...getPayload() }).catch(() => null);
      b.textContent = x && x.ok ? "✓" : "✗";
      if (!(x && x.ok)) { b.disabled = false; b.title = (x && x.error) || "xəta"; }
      refresh();
    };
    row.append(b); parent.append(row);
    IDMShared.bindRowMenu(row, () => ({ url: (meta && meta.url) || title, name: (meta && meta.name) || name, kind: (meta && meta.kind) || (/^(?:HLS|DASH)$/i.test(tag) ? "hls" : "file"), payload: (meta && meta.payload) || null, duration: meta && meta.dur }), ctxHandlers);
  };
  // renderSource (shared.js) üçün UI adapteri
  const ui = {
    line: (p, text, title, tip) => {
      if (/^🔊\s*Audio/i.test(String(text || ""))) return;   // audio xülasəsi göstərilmir
      const d = el("div", "row meta", text); if (tip) IDMShared.attachTip(d, tip, document.body, 2000); else if (title) d.title = title; p.append(d);
    },
    ctl: p => { const d = el("div", "row meta"); p.append(d); return d; },
    addRow: (p, tag, name, size, title, getPayload, meta) => {
      let payload = null; try { payload = getPayload ? getPayload() : null; } catch {}
      const m = { ...(meta || {}), payload, url: (meta && meta.url) || title };
      return addRow(p, tag, name, size, title, () => getPayload(), m);
    }, tipRoot: document.body
  };
  if (r.feed) { IDMShared.renderFeed(box, r, { pageUrl: r.pageUrl, title: r.title, subsOn: r.subsOn !== false }, ui, feedApi(tab.id)); return; }
  // Başlıq / xəbərdarlıq / audio xülasəsi göstərilmir (təmiz görünüş).
  // Hər mənbə üçün (səhifə / HLS / DASH): rejim, keyfiyyət, səs, subtitr — ortaq məntiq shared.js-dədir
  const ytPage = (() => { try { return /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(r.pageUrl || tab.url || "").hostname); } catch { return false; } })();
  const ctx = { tabId: tab.id, pageUrl: r.pageUrl, title: r.title, subsOn: r.subsOn !== false, aiTarget,
    ai: req => chrome.runtime.sendMessage({ type: "aiSubtitle", tabId: tab.id, ...req }),
    dual: req => chrome.runtime.sendMessage({ type: "dualSubtitle", tabId: tab.id, pageUrl: r.pageUrl, title: r.title, ...req }),
    aiResults: (aiState && aiState.results) || [],
    youtube: ytPage,
    saveAiTarget: v => { aiTarget = String(v || "az"); chrome.storage.local.set({ aiTargetLang: aiTarget }); },
    loadSel: key => { try { return JSON.parse(localStorage.getItem(key) || "null") || {}; } catch { return {}; } },
    saveSel: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val || {})); } catch {} },
    updateAiResult: (id, patch) => chrome.runtime.sendMessage({ type: "aiResultUpdate", tabId: tab.id, id, ...patch }).catch(() => {}),
    removeAiResult: sub => {
      if (!sub) return;
      chrome.runtime.sendMessage({ type: "aiResultDelete", tabId: tab.id, id: sub.id }).catch(() => {});
      try { chrome.tabs.sendMessage(tab.id, { type: "ytAiRemove", id: sub.id }).catch(() => {}); } catch {}
    },
    integrateYoutube: sub => {
      if (!sub || !tab) return;
      try {
        chrome.tabs.sendMessage(tab.id, { type: "ytAiAdd", sub }).catch(() => {});
        chrome.runtime.sendMessage({ type: "aiResultUpdate", tabId: tab.id, id: sub.id, prompted: true, integrated: true }).catch(() => {});
      } catch {}
    },
    integrateYoutubeAll: subs => {
      if (!tab || !Array.isArray(subs) || !subs.length) return Promise.resolve({ ok: false, error: "Seçilmiş AI alt yazısı yoxdur" });
      return chrome.tabs.sendMessage(tab.id, { type: "ytAiSync", subs }).catch(e => ({ ok: false, error: String(e && e.message || e) }));
    },
    // Yalnız YouTube: canlı tərcümə overlay-i. Digər saytlarda bu obyekt yoxdur.
    live: (ytPage && r.subsOn !== false) ? {
      start: target => chrome.tabs.sendMessage(tab.id, { type: "liveSubStart", target }).catch(() => {}),
      stop: () => chrome.tabs.sendMessage(tab.id, { type: "liveSubStop" }).catch(() => {})
    } : null };
  // Popup bağlanıb açılanda YouTube inteqrasiyasını bərpa et.
  if (ytPage && tab && Array.isArray(ctx.aiResults)) {
    const integrated = ctx.aiResults.filter(a => a && a.integrated && a.pageUrl === ctx.pageUrl && a.url && a.srt);
    if (integrated.length) try { chrome.tabs.sendMessage(tab.id, { type: "ytAiSync", subs: integrated }).catch(() => {}); } catch {}
  }
  const pageSubs = r.pageSubs || [];
  // İkili dil pəncərəsi üçün bütün mənbələrin orijinal alt yazıları + səhifə trekləri.
  const dualSourceSubs = [];
  for (const x of (r.subs || [])) if (x && x.url) dualSourceSubs.push(x);
  for (const it of (r.items || [])) for (const x of (it.subs || [])) if (x && x.url) dualSourceSubs.push(x);
  const dualSeen = new Set();
  ctx.dualSubs = IDMShared.subEntries({ subs: dualSourceSubs }, pageSubs).filter(x => {
    if (!x || x.subAll || !x.url) return false;
    const k = [x.url, x.lang || x.dlang || "", x.kind || ""].join("|");
    if (dualSeen.has(k)) return false;
    dualSeen.add(k); return true;
  });
  let subsTaken = false;
  const takeSubs = () => { if (subsTaken) return []; subsTaken = true; return pageSubs; };
  // mənbə xəbərdarlıqları göstərilmir (təmiz görünüş)
  if (r.options.length) IDMShared.renderSource(box, { options: r.options, audios: r.audios, subs: r.subs, aq: r.aq, caps: r.caps, strat: r.strat }, (r.items || []).length ? { text: "Səhifə videosu (yt-dlp)" } : null, ctx, ui, takeSubs());
  for (const it of r.items || []) {
    if (it.options && it.options.length) IDMShared.renderSource(box, it, { text: it.kind.toUpperCase() + " · " + IDMShared.smartTitle(it.name, 46), title: it.url, tip: { kind: "v", title: it.name, fields: [["Növ", it.kind.toUpperCase()], ["Mənbə", IDMShared.hostOf(it.url)]] } }, ctx, ui, takeSubs());
    else {
      const fm = it.kind === "hls" || it.kind === "dash" ? it.kind.toUpperCase() : IDMShared.extFmt(it.name);
      // Birbaşa faylda height məlumdursa (ffprobe /meta) keyfiyyət etiketi göstər: "1080p 30FPS".
      const qTag = it.height > 0 ? (Math.round(it.height) + "p") : "";
      const tag = (qTag || it.kind.toUpperCase()) + (it.fps ? " " + Math.round(it.fps) + "FPS" : "");
      // Tək axın (keyfiyyət siyahısı yoxdur): rejim menyusu (Video + Səs / Yalnız video / Yalnız səs) görünsün.
      const au = /^(?:MP3|M4A|AAC|OGG|OPUS|FLAC|WAV|MKA)$/.test(fm);
      if (!au && IDMShared.renderSource(box, IDMShared.directSource(it, tag, fm), null, ctx, ui, [])) {
        if (it.probeError) box.append(el("div", "row meta", "⚠ " + it.probeError));
        continue;
      }
      addRow(box, tag, it.name, it.size, it.url, () => ({ item: { url: it.url, kind: it.kind, name: it.name, size: it.size, referer: it.referer } }),
        { fmt: fm, size: it.size, est: it.est, tip: { kind: "v", title: it.name, fields: [["Format", fm], ["Keyfiyyət", it.height > 0 ? Math.round(it.height) + "p" : ""], ["FPS", it.fps ? Math.round(it.fps) + " FPS" : ""], ["Həcm", (it.est && it.size ? "~" : "") + (IDMShared.fmtSize(it.size) || "bilinmir")], ["Mənbə", IDMShared.hostOf(it.url)]] } });
      if (it.probeError) box.append(el("div", "row meta", "⚠ " + it.probeError));
    }
  }
  // Video tanınmadı, amma səhifə öz subtitr faylını verir: yalnız subtitr yüklənə bilər
  if (!subsTaken && pageSubs.length)
    IDMShared.renderSource(box, { options: [], audios: [], subs: [], url: r.pageUrl, kind: "page", name: r.title }, { text: "Aşkarlanan subtitrlər" }, ctx, ui, takeSubs());
  if (!box.children.length) box.append(el("div", "row meta", "✗ " + (r.error || "Yüklənə bilən keyfiyyət tapılmadı")));
}

// ==== ikonlar ====
const ICON = {
  v: '<svg viewBox="0 0 16 16"><rect x="1" y="3.5" width="9" height="9" rx="1.6" fill="#5ab0ff"/><path d="M11 7.2 15 5v6l-4-2.2z" fill="#5ab0ff"/></svg>',
  a: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3.2v10.4L5 10H2z" fill="#f0b84a"/><path d="M11.2 5.4a3.6 3.6 0 0 1 0 5.2M13 3.6a6 6 0 0 1 0 8.8" fill="none" stroke="#f0b84a" stroke-width="1.3" stroke-linecap="round"/></svg>',
  s: '<svg viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="10" rx="2" fill="#b58cf0"/><path d="M4 7.2h3M9 7.2h3M4 9.8h5M10.5 9.8H12" stroke="#1c1c1e" stroke-width="1.3" stroke-linecap="round"/></svg>',
  f: '<svg viewBox="0 0 16 16"><path d="M3.5 1.5h6l3 3v10h-9z" fill="#8a8a90"/></svg>',
  gif: '<svg viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="10" rx="2" fill="#42d392"/><text x="8" y="10.2" text-anchor="middle" font-size="6" font-weight="700" font-family="system-ui,sans-serif" fill="#123">GIF</text></svg>'
};
const KIND_NAME = { v: "Video", a: "Səs", s: "Subtitr", f: "Fayl", gif: "GIF" };
const EXT_A = /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|flac|mka|weba)$/i, EXT_S = /\.(?:srt|vtt|ass|ssa|ttml|lrc|sbv|dfxp)$/i, EXT_V = /\.(?:mp4|m4v|webm|mkv|mov|flv|avi|ts|3gp|wmv|ogv)$/i;
// Tərkib: helper-in rejimindən (va, vas, v, vs, a, s … hər kombinasiya) və ya birbaşa fayllar üçün uzantıdan; hərflər həmişə v→a→s sırasında
function kindOf(d) {
  if (d.mode === "gif" || /\.gif$/i.test(d.name || "")) return "gif";
  if (d.mode && /^[vas]+$/.test(d.mode)) return [..."vas"].filter(c => d.mode.includes(c)).join("");
  const n = d.name || "";
  return EXT_S.test(n) ? "s" : EXT_A.test(n) ? "a" : EXT_V.test(n) ? "va" : "f";
}
function setIcon(r, k) {
  if (r.kind === k) return;
  r.kind = k; r.ico.innerHTML = ICON[k] || [...k].map(c => ICON[c]).join(""); r.ico.title = KIND_NAME[k] || [...k].map(c => KIND_NAME[c]).join(" + ");
}
// ==== /ikonlar ====
const rows = new Map();
const seenAt = new Map();   // aktiv yükləmələrin ilk görünmə vaxtı (ən təzə birinci)
// Siyahıdan silinən (fayl saxlanılan) tamamlanmış/xətalı yükləmələr — 20 saxlanılır.
let dlHistory = [];
const HKEY = "dlHistory";
chrome.storage.local.get(HKEY).then(s => { if (Array.isArray(s && s[HKEY])) { dlHistory = s[HKEY]; doneDirty = true; } }).catch(() => {});
const saveHistory = () => chrome.storage.local.set({ [HKEY]: dlHistory }).catch(() => {});
const historyKey = d => d.path ? "p:" + d.path : (d.source || "") + ":" + (d.id || "") + ":" + (d.name || "");
const timeStr = t => { try { const x = new Date(t || 0); return x.toLocaleDateString([], { day: "2-digit", month: "2-digit" }) + " " + x.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const ICO = {
  folder: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 4.2c0-.7.6-1.2 1.2-1.2h3.1l1.3 1.5h6.2c.7 0 1.2.6 1.2 1.2v6.1c0 .7-.6 1.2-1.2 1.2H2.7c-.7 0-1.2-.6-1.2-1.2z"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.2" y="2.5" width="3.3" height="11" rx="1"/><rect x="9.5" y="2.5" width="3.3" height="11" rx="1"/></svg>',
  retry: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.5V5.6H9.9"/></svg>',
  file: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 1.5h5.6l3.4 3.4v9.6h-9zM9 2.7v2.6h2.6z"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/></svg>'
};
const ACT = { pause: ICO.pause, resume: ICO.play, retry: ICO.retry, open: ICO.file, folder: ICO.folder, x: ICO.x };
function mergeHistory(items) {
  let changed = false;
  for (const d of items) {
    if (d.status !== "complete" && d.status !== "error") continue;
    const k = historyKey(d);
    const cur = dlHistory.find(x => x.key === k);
    if (cur) {
      const patch = { status: d.status, name: d.name || cur.name, path: d.path || cur.path, size: d.size || cur.size, mode: d.mode || cur.mode, error: d.error || "", id: d.id, source: d.source };
      if (Object.keys(patch).some(f => cur[f] !== patch[f])) { Object.assign(cur, patch); changed = true; }
    } else {
      dlHistory.push({ key: k, id: d.id, source: d.source, name: d.name || "", path: d.path || "", size: d.size || 0, mode: d.mode || "", status: d.status, error: d.error || "", t: Date.now() });
      changed = true;
    }
  }
  if (changed) {
    dlHistory.sort((a, b) => b.t - a.t);
    dlHistory = dlHistory.slice(0, 20);
    saveHistory();
  }
  return changed;
}
let doneDirty = true;
function renderDone() {
  const box = $("done"); if (!box) return;
  box.replaceChildren();
  const list = dlHistory.slice().sort((a, b) => b.t - a.t);
  if (!list.length) { box.append(el("div", "row meta", "Boşdur")); return; }
  for (const d of list) {
    const row = el("div", "drow");
    const ic = el("span", "ico"); const k = kindOf(d);
    ic.innerHTML = ICON[k] || [...k].map(c => ICON[c]).join(""); ic.title = KIND_NAME[k] || "";
    const c = el("div", "c");
    const name = el("div", "name", IDMShared.smartTitle(d.name || (d.path || "").split("/").pop() || "fayl", 42));
    const meta = el("div", "meta");
    const st = el("span", "st " + (d.status === "complete" ? "ok" : "err"), d.status === "complete" ? "Tamamlandı" : "Xəta");
    meta.append(st, document.createTextNode("  " + (d.size ? fmt(d.size) + " · " : "") + timeStr(d.t)));
    if (d.error) meta.title = d.error;
    c.append(name, meta);
    row.title = [d.name || d.path, d.error].filter(Boolean).join(" — ");
    const bFolder = el("button", "ib"); bFolder.title = "Qovluqda göstər"; bFolder.innerHTML = ICO.folder;
    bFolder.onclick = () => revealPath(d.path);
    const bPlay = el("button", "ib"); bPlay.title = "Oynat / Aç"; bPlay.innerHTML = ICO.play;
    bPlay.onclick = () => openPath(d.path);
    const bDel = el("button", "ib"); bDel.title = "Siyahıdan sil (fayl silinmir)"; bDel.innerHTML = ICO.x;
    bDel.onclick = () => { dlHistory = dlHistory.filter(x => x.key !== d.key); saveHistory(); renderDone(); };
    row.append(ic, c, bFolder, bPlay, bDel);
    box.append(row);
  }
}
async function revealPath(path) {
  if (!path) return;
  const r = await api("/reveal", { path }).catch(() => null);
  if (r && r.ok === false) ctxNote(r.error || "Qovluq açılmadı");
}
async function openPath(path) {
  if (!path) return;
  const r = await api("/openfile", { path }).catch(() => null);
  if (r && r.ok === false) ctxNote(r.error || "Fayl açılmadı");
}
// ---- Bölmələr (tab) ----
const tabsEls = Array.from(document.querySelectorAll("#tabs .tab"));
const panes = { streams: $("pane-streams"), done: $("pane-done") };
function showTab(name) {
  for (const b of tabsEls) b.classList.toggle("on", b.dataset.tab === name);
  for (const [k, p] of Object.entries(panes)) if (p) p.hidden = k !== name;
  if (name === "done") { doneDirty = true; renderDone(); }
}
for (const b of tabsEls) b.onclick = () => showTab(b.dataset.tab);
const act = (d, a, icon, title) => {
  const b = el("button", "ib"); b.title = title || a;
  b.innerHTML = ACT[icon] || icon;
  b.onclick = async () => { await api("/action", { id: d.id, source: d.source, action: a }).catch(() => {}); refresh(); };
  return b;
};
function buttons(r, d) {
  r.btns.replaceChildren();
  if (d.status === "active" || d.status === "waiting") r.btns.append(act(d, "pause", "pause", "Dayandır"));
  if (d.status === "paused") r.btns.append(act(d, "resume", "resume", "Davam et"));
  if (d.status === "error" && d.source !== "ctx") r.btns.append(act(d, "retry", "retry", "Yenidən cəhd"));
  if (d.status === "complete") { r.btns.append(act(d, "open", "open", "Faylı aç"), act(d, "folder", "folder", "Qovluğu aç")); }
  const live = d.status !== "complete";
  r.btns.append(act(d, live ? "delete" : "remove", "x", live ? "Ləğv et və qalıqları sil" : "Siyahıdan sil"));
}
function updateRow(r, d) {
  setIcon(r, kindOf(d));
  r.d = d; r.name.textContent = IDMShared.smartTitle(d.name, 40); r.name.removeAttribute("title");
  r.pct.textContent = d.status === "waiting" ? "0.0%" : d.progress.toFixed(1) + "%";
  r.fill.style.width = d.progress + "%";
  const ind = d.status === "active" && ((d.progress < 0.1 && !d.size && !d.phase) || d.progress >= 99);
  r.bar.className = "bar" + (ind ? " ind" : "") + (d.status === "paused" ? " paused" : d.status === "error" ? " error" : "");
  const parts = [d.phase || STATUS[d.status] || d.status];
  if (d.status === "active" && !d.phase) {
    if (d.speed) parts.push(fmt(d.speed) + "/s");
    const eta = fmtEta(d.eta); if (eta) parts.push(eta);
  }
  if (d.size) parts.push(d.status === "complete" ? fmt(d.size) : `${fmt(d.done)} / ${fmt(d.size)}`);
  if (d.error) parts.push(d.error);
  if (d.note) parts.push(d.note);
  r.meta.textContent = parts.join(" · "); r.meta.title = d.error || "";
  // Xəta/qeyd tam görünsün (əvvəl "..." ilə kəsilirdi və səbəbi görmək mümkün deyildi)
  const wrap = !!(d.error || d.note);
  r.meta.style.whiteSpace = wrap ? "normal" : ""; r.meta.style.overflow = wrap ? "visible" : ""; r.meta.style.wordBreak = wrap ? "break-word" : "";
  if (r.status !== d.status) { r.status = d.status; buttons(r, d); }
}
function renderList(items) {
  const list = $("active"), seen = new Set();
  const now = Date.now();
  const orderOf = d => { const k = d.source + ":" + d.id; return (+d.t > 0 ? +d.t : (seenAt.get(k) || 0)); };
  // Ən təzə başlayan yükləmə birinci.
  const ordered = items.slice().sort((a, b) => orderOf(b) - orderOf(a));
  ordered.forEach((d, idx) => {
    const key = d.source + ":" + d.id; seen.add(key);
    if (!seenAt.has(key)) seenAt.set(key, now);
    let r = rows.get(key);
    if (!r) {
      const e = el("div", "row"), c = el("div", "c"), top = el("div", "top");
      r = { d: null, el: e, name: el("div", "name"), pct: el("div", "pct"), bar: el("div", "bar"), fill: el("i"), meta: el("div", "meta"), btns: el("div"), status: null, ico: el("span", "ico"), kind: "" };
      r.btns.style.cssText = "display:flex;gap:4px";
      top.append(r.ico, r.name, r.pct); r.bar.append(r.fill); c.append(top, r.bar, r.meta); e.append(c, r.btns);
      rows.set(key, r);
      IDMShared.attachTip(e, () => { const x = r.d; if (!x) return null; const k = kindOf(x), fm = IDMShared.extFmt(x.path || x.name);
        return { kind: k.includes("v") ? "v" : k.includes("a") ? "a" : k.includes("s") ? "s" : "f", title: x.name, fields: [["Vəziyyət", STATUS[x.status] || x.status], ["Format", fm], ["Həcm", x.size ? fmt(x.size) : ""], ["Yüklənib", x.size && x.done ? fmt(x.done) + " (" + x.progress.toFixed(1) + "%)" : ""], ["Sürət", x.status === "active" && x.speed ? fmt(x.speed) + "/s" : ""], ["Qalan", x.status === "active" ? fmtEta(x.eta) : ""], ["Qovluq", x.path ? x.path.replace(/[\\/][^\\/]*$/, "") : ""]] }; }, document.body);
    }
    updateRow(r, d);
    if (list.children[idx] !== r.el) list.insertBefore(r.el, list.children[idx] || null);
  });
  for (const [k, r] of rows) if (!seen.has(k)) { r.el.remove(); rows.delete(k); }
  for (const k of [...seenAt.keys()]) if (!seen.has(k)) seenAt.delete(k);
}
let busy = false;
async function refresh() {
  if (busy) return; busy = true;
  try {
    const j = await api("/list");
    $("dot").className = "dot ok"; $("warn").style.display = "none";
    const items = Array.isArray(j && j.items) ? j.items : [];
    const changed = mergeHistory(items);
    const active = items.filter(d => d && (d.status === "active" || d.status === "waiting" || d.status === "paused"));
    const ac = $("activeCount"); if (ac) ac.textContent = active.length ? active.length + " yüklənir" : "";
    const aw = $("activeWrap"); if (aw) aw.hidden = !active.length;
    renderList(active);
    if (changed || doneDirty) { renderDone(); doneDirty = false; }
  } catch {
    $("dot").className = "dot";
    rows.clear(); $("active").replaceChildren(el("div", "row meta empty", "Helper işləmir: systemctl --user status idm-linux-v3"));
  }
  busy = false;
}
async function checkDeps() {
  try {
    const p = await api("/ping");
    const miss = Object.entries(p.deps || {}).filter(([, v]) => !v).map(([k]) => k);
    if ((p.ver || 0) < 6) { $("warn").textContent = "Helper köhnədir (rejimlər/subtitr işləməz). Yeni helper.py-ni işləyən yerə köçürüb restart edin."; $("warn").style.display = "block"; return; }
    const msgs = [];
    if (miss.length) msgs.push("Quraşdırılmayıb: " + miss.join(", "));
    // yt-dlp köhnəliyi / JavaScript runtime (YouTube keyfiyyətləri üçün) — yavaş ola bilər, ona görə ayrıca sorğu
    try {
      const hl = await fetch(HELPER + "/health", { signal: AbortSignal.timeout(15000) }).then(r => r.json());
      msgs.push(...(hl.warnings || []));
      if (!hl.aria2c) $("parhint").textContent += " ⚠ aria2c yoxdur: düz (parçasız) axınlar həmişə tək bağlantı ilə yüklənəcək.";
      if (!hl.ffmpeg) $("parhint").textContent += " ⚠ ffmpeg yoxdur: video/audio fərqli say və audio çevirmə işləməyəcək.";
    } catch {}
    if (msgs.length) { $("warn").textContent = msgs.join("  •  "); $("warn").style.display = "block"; }
  } catch {}
}
$("pa").onclick = () => api("/action", { action: "pauseall" }).then(refresh).catch(() => {});
$("ra").onclick = () => api("/action", { action: "resumeall" }).then(refresh).catch(() => {});

loadMedia(); refresh(); checkDeps();
setInterval(refresh, 500);
