// JDM — qısa video lentləri (TikTok, Instagram, YouTube Shorts, Facebook, fb.watch).
// Yalnız bu saytlarda yüklənir (manifest). Cari videonu tanıyır (permalink + ağıllı ad) və background-a bildirir; yükləməyə toxunmur.
(function (root) {
  "use strict";
  const N = () => root.IDMNamer;
  const HOSTS = { tiktok: /(?:^|\.)tiktok\.com$/, instagram: /(?:^|\.)instagram\.com$/, youtube: /(?:^|\.)youtube\.com$/, facebook: /(?:^|\.)facebook\.com$/, fbwatch: /^fb\.watch$/, telegram: /^(?:(?:web|webk|webz)\.telegram\.org|t\.me|telegram\.me|telegram\.dog)$/,
    whatsapp: /^web\.whatsapp\.com$/, x: /^(?:www\.)?(?:x|twitter)\.com$/, threads: /^(?:www\.)?threads\.(?:net|com)$/, reddit: /^(?:www\.)?reddit\.com$/,
    vimeo: /^(?:www\.)?vimeo\.com$/, dailymotion: /^(?:www\.)?dailymotion\.com$/, twitch: /^(?:www\.)?twitch\.tv$/, soundcloud: /^(?:www\.)?soundcloud\.com$/,
    pinterest: /^(?:www\.)?pinterest\.[a-z.]+$/, linkedin: /^(?:www\.)?linkedin\.com$/ };
  const NEW_SITES = { whatsapp: 1, x: 1, threads: 1, reddit: 1, vimeo: 1, dailymotion: 1, twitch: 1, soundcloud: 1, pinterest: 1, linkedin: 1 };
  const siteOf = h => { for (const k in HOSTS) if (HOSTS[k].test(h || "")) return k; return ""; };
  // YouTube: yalnız /shorts (adi izləmə səhifələrinə toxunulmur)
  const activeOn = (site, loc) => !!site && (site !== "youtube" || /^\/shorts(?:\/|$)/.test(loc.pathname || ""));

  // URL -> sabit məzmun identifikatoru + kanonik permalink (yt-dlp-nin başa düşdüyü forma)
  function permalinkOf(site, href) {
    let u; try { u = new URL(href, "https://x.invalid/"); } catch { return null; }
    const p = u.pathname, q = u.searchParams; let m;
    if (site === "tiktok" && (m = /\/@([\w.\-]+)\/video\/(\d{8,})/.exec(p))) return { id: m[2], author: m[1], url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}` };
    if (site === "instagram" && (m = /\/(reels?|p|tv)\/([\w-]{5,})/.exec(p))) return { id: m[2], url: `https://www.instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/` };
    if (site === "youtube" && (m = /^\/shorts\/([\w-]{6,})/.exec(p))) return { id: m[1], url: `https://www.youtube.com/shorts/${m[1]}` };
    if (site === "facebook") {
      if ((m = /\/reel\/(\d+)/.exec(p))) return { id: m[1], url: `https://www.facebook.com/reel/${m[1]}` };
      if (/^\/watch\/?$/.test(p) && /^\d+$/.test(q.get("v") || "")) return { id: q.get("v"), url: `https://www.facebook.com/watch/?v=${q.get("v")}` };
      if ((m = /\/videos\/(?:[\w.\-%]+\/)?(\d{6,})/.exec(p))) return { id: m[1], url: `https://www.facebook.com/watch/?v=${m[1]}` };
    }
    if (site === "fbwatch" && (m = /^\/([\w-]{5,})\/?$/.exec(p))) return { id: m[1], url: `https://fb.watch/${m[1]}/` };
    if (site === "x" && (m = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,})/.exec(p))) return { id: m[2], author: m[1], url: `https://x.com/${m[1]}/status/${m[2]}` };
    if (site === "instagram" && (m = /^\/stories\/([\w.\-]+)\/(\d{5,})/.exec(p))) return { id: m[2], author: m[1], url: `https://www.instagram.com/stories/${m[1]}/${m[2]}/` };
    if (site === "reddit" && (m = /^\/r\/[^/]+\/comments\/([a-z0-9]{4,})/i.exec(p))) return { id: m[1], url: `https://www.reddit.com${p.replace(/\?.*$/, "")}` };
    if (site === "vimeo" && (m = /^\/(\d{6,})(?:\/|$)/.exec(p))) return { id: m[1], url: `https://vimeo.com/${m[1]}` };
    if (site === "dailymotion" && (m = /^\/video\/([a-z0-9]{5,})/i.exec(p))) return { id: m[1], url: `https://www.dailymotion.com/video/${m[1]}` };
    if (site === "twitch" && (m = /^\/(?:videos|clip)\/([A-Za-z0-9_-]{4,})/.exec(p))) return { id: m[1], url: `https://www.twitch.tv${p}` };
    if (site === "pinterest" && (m = /^\/pin\/(\d{5,})/.exec(p))) return { id: m[1], url: `https://www.pinterest.com/pin/${m[1]}/` };
    if (site === "threads" && (m = /^\/@([\w.\-]+)\/post\/([A-Za-z0-9_-]{5,})/.exec(p))) return { id: m[2], author: m[1], url: `https://www.threads.net/@${m[1]}/post/${m[2]}` };
    return null;
  }

  // Ad namizədi: interfeys sözləri, kod yığınları, saytın ümumi başlığı, yalnız hashtag -> rədd
  const UI_WORDS = /^(?:follow(?:ing)?|like[sd]?|share|comments?|for you|sound|original sound|more|see more|log ?in|sign ?up|reels?|shorts?|watch|home|explore|search|message|save|send|copy link|subscribe[d]?|sponsored|suggested|add comment|mute|unmute|play|pause|settings|report|embed|video(?: player)?|media(?: player)?|play video|\d+(?:[.,]\d+)?\s?[kmb]?)$/i;
  function cleanCandidate(t, pageUrl) {
    let s = String(t || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    const n = N(); if (n) s = n.cleanTitle(s, pageUrl);
    s = s.replace(/(?:\s*#[^\s#]+)+\s*$/, "").trim();
    if (s.length < 3 || UI_WORDS.test(s) || (n && n.weakStem(s)) || (/^[#@]\S*$/.test(s))) return "";
    return s.slice(0, 120);
  }
  const pickName = (cands, href) => { for (const c of cands) { const s = cleanCandidate(c, href); if (s) return s; } return ""; };

  // Aktiv video: görünən sahəsi ≥50% olan; oxudulan olanlar üstündür, sonra ən böyük görünən sahə
  function pickActive(list) {
    const vis = list.filter(x => x.ratio >= 0.5);
    const playing = vis.filter(x => x.playing);
    const pool = playing.length ? playing : vis.filter(x => x.ratio >= 0.6);
    return pool.reduce((b, x) => (!b || x.area > b.area ? x : b), null);
  }

  const take = (l, n) => Array.prototype.slice.call(l || [], 0, n);

  // Universal FPS (feed videoları, blob/MSE daxil): captureStream → frameRate; alınmasa rVFC ilə ölçmə
  const FPS_MEM = new WeakMap();
  function fpsOf(v) {
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

  // Elementin real müddəti: video/audio.duration; canlı/DVR-də buffered sonu fallback.
  function mediaDur(el) {
    try {
      let d = +el.duration;
      if (!(d > 0) || !isFinite(d)) {
        const b = el.buffered;
        if (b && b.length) d = +b.end(b.length - 1);
      }
      return d > 0 && isFinite(d) ? d : 0;
    } catch { return 0; }
  }
  const parseBytes = t => {
    const m = /(\d+(?:[.,]\d+)?)\s*(KB|MB|GB|B)\b/i.exec(String(t || ""));
    if (!m) return 0;
    const n = parseFloat(m[1].replace(",", ""));
    return Math.round(n * ({ B: 1, KB: 1024, MB: 1048576, GB: 1073741824 }[m[2].toUpperCase()] || 1));
  };
  function mediaSize(el) {   // əvvəl DOM data-size / görünən ölçü, sonra PerformanceResourceTiming (təxmini ola bilər)
    let exact = 0, est = 0, node = el;
    for (let i = 0; i < 9 && node && node.getAttribute; i++, node = node.parentElement) {
      for (const a of ["data-size", "data-file-size", "data-media-size", "data-size-bytes"]) {
        const v = node.getAttribute(a); if (!v) continue;
        const n = /^\d+$/.test(v.trim()) ? parseInt(v, 10) : parseBytes(v);
        if (n > 0) { exact = Math.max(exact, n); break; }
      }
      for (const t of [node.getAttribute("aria-label"), node.getAttribute("title")]) {
        const n = parseBytes(t); if (n > 0) exact = Math.max(exact, n);
      }
      if (exact) break;
    }
    try {
      const src = el.currentSrc || el.src || "", base = src.split("?")[0];
      if (/^https?:/i.test(src)) for (const e of performance.getEntriesByType("resource")) {
        if (!e || !e.name) continue;
        const name = e.name.split("?")[0];
        if (src && (e.name === src || (base.length > 12 && name === base) || (base.length > 12 && name.endsWith(base)))) {
          const n = Math.max(+e.encodedBodySize || 0, +e.decodedBodySize || 0, +e.transferSize || 0);
          if (n > 0) est = Math.max(est, n);
        }
      }
    } catch {}
    return { size: exact || est, sizeEst: !exact && !!est };
  }
  const mediaKind = el => (el && el.tagName && el.tagName.toLowerCase() === "audio") ? "audio" : "video";

  // ---- Yeni: MAIN dünyadakı hook.js-in topladığı lent indeksi (video mənbəyinin yolu -> id/müəllif/təsvir)
  const IDX = { byPath: new Map(), byKey: new Map() };
  const pathOfSrc = u => { try { return new URL(u, "https://x.invalid/").pathname; } catch { return ""; } };
  function indexAdd(d) {
    if (!d || !(d.id || d.code)) return;
    // Eyni videonun bütün real media yolları: aktiv videonu fon/keş axınlarından ayırmaq üçün
    const paths = [...new Set((d.paths || []).filter(p => typeof p === "string" && p.length > 8))].slice(0, 24);
    const it = { site: d.site, id: String(d.id || d.code), user: d.user || "", desc: d.desc || "", paths };
    IDX.byKey.set(it.site + ":" + it.id, it);
    for (const p of paths) IDX.byPath.set(p, it);
    if (IDX.byPath.size > 3000) { IDX.byPath.clear(); IDX.byKey.clear(); }
  }
  const metaPermalink = m => m.site === "tiktok" ? { id: m.id, author: m.user, url: `https://www.tiktok.com/@${m.user || ""}/video/${m.id}` }
    : m.site === "instagram" ? { id: m.id, url: `https://www.instagram.com/reel/${m.id}/` } : null;
  const fromIndex = v => {
    const srcs = [v.currentSrc, v.src, ...take(v.querySelectorAll ? v.querySelectorAll("source") : [], 3).map(s => s.src)];
    for (const s of srcs) { const p = pathOfSrc(s || ""); const m = p && IDX.byPath.get(p); if (m) return m; }
    return null;
  };
  // yalnız GÖRÜNƏN (ölçülü) videolar sayılır: TikTok/IG gizli/önyüklənmiş video elementləri əhatəni daraltmasın
  const isBig = v => { const r = v.getBoundingClientRect(); return r.width >= 150 && r.height >= 90; };
  const bigCount = el => { let n = 0; for (const x of take(el.querySelectorAll("video"), 20)) if (isBig(x)) n++; return n; };
  const wideScopeOf = v => {
    let el = v, scope = v;
    for (let i = 0; i < 25 && el.parentElement; i++) { el = el.parentElement; if (bigCount(el) > 1) break; scope = el; }
    return scope;
  };
  // TikTok: video qabı id-si "xgwrapper-<n>-<aweme id>"; digər atributlar (data-*) 17-20 rəqəmli id ola bilər
  function attrId(v) {
    let el = v;
    for (let i = 0; i < 20 && el && el.getAttribute; i++, el = el.parentElement) {
      let m = /xgwrapper-\d+-(\d{17,20})/.exec(el.id || "");
      if (m) return m[1];
      for (const n of take(el.getAttributeNames ? el.getAttributeNames() : [], 30)) {
        if (!/^(?:id|data-(?:e2e-)?(?:video-?id|aweme-?id|item-?id|vid|id))$/i.test(n)) continue;
        m = /(?:^|[^\d])(\d{17,20})(?:[^\d]|$)/.exec(el.getAttribute(n) || "");
        if (m) return m[1];
      }
    }
    return "";
  }
  const fbCache = new WeakMap();   // zəif nəticə hər mutasiyada yenidən hesablanmasın (≤700 ms)
  const hash36 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const scopeOf = v => {   // bu videonu ehtiva edən, yalnız bir <video> olan ən xarici ata (≤10 səviyyə)
    let el = v, scope = v;
    for (let i = 0; i < 10 && el.parentElement; i++) { el = el.parentElement; if (el.querySelectorAll("video").length > 1) break; scope = el; }
    return scope;
  };
  // ---- Telegram Web: permalink yoxdur; video öz mənbəyinə (SW axını / blob) görə tanınır, ad mesajın mətni + göndərənə görə qurulur
  const TG_ROOT = ".bubble, .Message, .message-list-item, .tgme_widget_message, .tgme_widget_message_video_player, .tgme_widget_message_video, .tgme_widget_message_photo_wrap, .tgme_widget_message_wrap, #stories-viewer, .stories-viewer, #StoryViewer, .StoryViewer, .media-viewer-whole, #MediaViewer, .MediaViewer";
  const TG_PEER = [".tgme_widget_message_owner_name", ".tgme_widget_message_author", ".tgme_widget_message_from_author", ".tgme_widget_message_author_name", ".media-viewer-name .peer-title", ".stories-viewer .peer-title", ".StoryViewer .title", ".MediaViewerSlide .sender-title", ".bubble .name .peer-title", ".peer-title", ".message-title-name", ".sender-name", ".chat-info .peer-title", ".ChatInfo .fullName", ".chat-info .title"];
  const TG_CAP = [".tgme_widget_message_text", ".tgme_widget_message_caption", ".tgme_widget_message_text.js-message_text", ".media-viewer-caption", ".stories-caption", ".StoryCaption .text-content", ".translatable-message", ".text-content", ".caption", ".message"];
  const TG_PROT = /(?:^|[\s_-])(?:no-?forwards?|is-protected|protected)(?:$|[\s_-])/i;
  const txt = n => n ? String(n.textContent || "").replace(/\s+/g, " ").trim() : "";
  function tgProtected(v) {   // Telegram "məzmunu qoru" (saxlamaq/yönləndirmək qadağan): bu halda yükləmə təklif olunmur
    let el = v;
    for (let i = 0; i < 16 && el; i++, el = el.parentElement) { const c = el.className; if (TG_PROT.test(String(c && c.baseVal !== undefined ? c.baseVal : c || ""))) return true; }
    return false;
  }
  const TG_VID = new WeakMap(); let tgVidSeq = 0;
  function identifyTg(v, loc) {
    const cs = v.currentSrc || v.src || "";
    let k = "";
    // Telegram-da eyni path, fərqli media (query/token) ola bilər: açar tam URL-dir, yalnız path deyil.
    if (/^https?:/i.test(cs)) { try { k = new URL(cs, loc.href).href; } catch { k = cs; } }
    else if (/^blob:/i.test(cs)) k = cs;
    if (!k) {   // mənbə hələ görünmür: yenə də cari <video> üçün sabit pending açarı göndər
      let id = TG_VID.get(v); if (!id) { id = "v" + (++tgVidSeq); TG_VID.set(v, id); }
      return { site: "telegram", key: "telegram:pending:" + id, id: "", tg: true, weak: true, url: loc.href, scope: v };
    }
    return { site: "telegram", key: "telegram:" + hash36(k), id: "", url: loc.href, weak: true, tg: true, scope: v.closest ? v.closest(TG_ROOT) || v : v };
  }
  function tgCaptionScan(scope, peer, pageUrl) {
    if (!scope) return "";
    let best = "", bestScore = -1;
    const els = take(scope.querySelectorAll("div,span,p,[dir='auto']"), 600);
    for (const el of els) {
      try {
        if (el.matches && el.matches("button,a,[role='button'],[role='link']")) continue;
        if (el.closest && el.closest("button,a,[role='button'],[role='link']")) continue;
        const t = txt(el).replace(/(?:\s+(?:edited|[\d.,]+[KkMm]?))*\s*\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?\s*$/, "").trim();
        if (!t || t.length > 180 || (peer && t === peer)) continue;
        if (/^(?:reply|send|forward|share|copy|edit|delete|mute|unmute|view|views|seen|story|stories|more|next|previous|close|like|comment|save|download|public|private|just now|\d+[smhd]\s*ago)$/i.test(t)) continue;
        if (/^[\d.,]+\s?[KkMmBb]?$/.test(t)) continue;
        const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || "");
        const sig = [el.id || "", cls, el.getAttribute && (el.getAttribute("aria-label") || ""), el.getAttribute && (el.getAttribute("data-testid") || "")].join(" ");
        let score = 0;
        if (/caption/i.test(sig)) score += 30;
        else if (/stor/i.test(sig)) score += 10;
        else if (/text|message|description|subtitle/i.test(sig)) score += 6;
        if (el.closest && el.closest("[class*='stories'],[class*='story'],[class*='Story']")) score += 4;
        if (el.querySelector && el.querySelector("video,audio,img,button,a")) score -= 5;
        if (t.length < 3) score -= 2;
        if (score > bestScore) { bestScore = score; best = t; }
      } catch {}
    }
    return bestScore >= 0 ? cleanCandidate(best, pageUrl) || (best.length <= 120 ? best : "") : "";
  }
  function tgTitle(v, pageUrl) {
    const root = v.closest ? v.closest(TG_ROOT) : null;
    const dd = v.ownerDocument;
    const rootSig = root ? ((root.id || "") + " " + String(root.className && root.className.baseVal !== undefined ? root.className.baseVal : root.className || "")) : "";
    const story = /stor/i.test(rootSig) || /(?:^|[\/\#?])(?:stories?|story)(?:[\/\#?=&]|$)/i.test(String(pageUrl || ""))
      || !!(dd && dd.querySelector(".stories-caption, .StoryCaption, .stories-viewer, .StoryViewer"));
    const capSel = story
      ? [".stories-caption .text-content", ".stories-caption", ".StoryCaption .text-content", ".StoryCaption", ".story-caption",
         "[class*='stories'] [class*='caption']", "[class*='story'] [class*='caption']", ".media-viewer-caption", ".text-content"]
      : TG_CAP;
    const peerSel = story
      ? [".stories-viewer .peer-title", ".StoryViewer .peer-title", ".StoryViewer .title", ".stories-viewer .title",
         ".stories-viewer .sender-title", ".media-viewer-name .peer-title", ".MediaViewerSlide .sender-title",
         "[class*='stories'] [class*='peer-title']", "[class*='stories'] [class*='name']", "[class*='story'] [class*='name']"]
      : TG_PEER;
    let cap = "", peer = "";
    const capScope = root || (story ? dd : null);
    if (capScope) for (const sel of capSel) {
      for (const n of take(capScope.querySelectorAll(sel), 4)) {
        const t = txt(n).replace(/(?:\s+(?:edited|[\d.,]+[KkMm]?))*\s*\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?\s*$/, "");
        cap = cleanCandidate(t, pageUrl) || (story && t && t.length <= 120 ? t : "");
        if (cap) break;
      }
      if (cap) break;
    }
    if (!cap) {   // Telegram status caption-u bəzən viewer root-undan kənarda olur
      const storyCap = [".stories-caption", ".stories-caption .text-content", ".StoryCaption", ".StoryCaption .text-content",
        ".story-caption", "[class*='stories'] [class*='caption']", "[class*='story'] [class*='caption']"];
      for (const sel of storyCap) {
        for (const n of take(dd.querySelectorAll(sel), 4)) {
          const t = txt(n).replace(/(?:\s+(?:edited|[\d.,]+[KkMm]?))*\s*\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?\s*$/, "");
          cap = cleanCandidate(t, pageUrl) || (t && t.length <= 120 ? t : "");
          if (cap) break;
        }
        if (cap) break;
      }
    }
    // Story-də sağ/sol paneldəki öz adımızı götürmürük. Yalnız story-yə aid owner
    // selektorları; root yoxsa belə generic .peer-title fallback etmirik.
    for (const sel of peerSel) {
      let n = root ? root.querySelector(sel) : null;
      if (!n && (story || !root)) n = dd ? dd.querySelector(sel) : null;
      const t = txt(n); if (t && t.length <= 60 && !/^telegram/i.test(t)) { peer = t; break; }
    }
    if (story && !peer && root) {
      for (const a of ["data-peer-title", "data-title", "data-name"]) {
        const t = txt(root.getAttribute && root.getAttribute(a)); if (t && t.length <= 60) { peer = t; break; }
      }
    }
    if (!cap && (story || (root && /(?:media-viewer|stories|story)/i.test(rootSig)))) {
      const sr = (root && /stor/i.test(rootSig)) ? root : (dd && (dd.querySelector(".stories-viewer,.StoryViewer,[class*='stories-viewer'],[class*='StoryViewer']"))) || root;
      cap = tgCaptionScan(sr || (story ? dd : null), peer, pageUrl);
      if (!cap && root && root.parentElement) cap = tgCaptionScan(root.parentElement, peer, pageUrl);
    }
    if (story) {
      const r = [peer, cap].filter(Boolean).join(" · ");
      return (r || "Telegram status").slice(0, 120);
    }
    const r = cap && peer ? cap + " · " + peer : cap || (peer ? peer + " · Telegram" : "");
    return r.slice(0, 120);
  }
  // ---- WhatsApp Web: video mesajının mətni (caption); yoxdursa göndərənin adı
  function waScope(v) {
    let el = v, best = null;
    for (let i = 0; i < 20 && el; i++, el = el.parentElement) {
      if (el.querySelector && (el.querySelector('[data-pre-plain-text]') || el.querySelector('.copyable-text') || el.querySelector('[data-testid="media-caption"]') || el.querySelector('.media-viewer-caption') || el.querySelector('[data-testid="status-caption"],.status-caption,.status-text'))) best = el;
      if (el.matches && el.matches('.message-in,.message-out,[data-id],.media-viewer,.MediaViewer,.status-viewer,#status-viewer,[data-testid="status-viewer"]')) { best = best || el; break; }
    }
    return best || (v.closest && v.closest('.message-in,.message-out,[data-id]')) || v.parentElement || v;
  }
  function waStatusScope(v, root) {
    const dd = v.ownerDocument;
    if (!dd) return null;
    const sel = ['#status-viewer','[data-testid="status-viewer"]','[data-testid="status-viewer-modal"]',
      '[data-testid*="status-viewer"]','.status-viewer','.status-viewer-modal','.status-viewer-container',
      '[class*="status-viewer" i]','[class*="StatusViewer"]','[aria-label*="status" i]'];
    const hasMediaOrCap = n => !!(n && n.querySelector && (n.querySelector('video,canvas,[data-testid="status-caption"],.status-caption,.status-text,[data-testid*="status"]')));
    try {
      let sr = root && root.closest && root.closest(sel.join(','));
      if (sr) return sr;
      for (const s of sel) {
        for (const n of take(dd.querySelectorAll(s), 30)) if (hasMediaOrCap(n)) return n;
      }
      // caption portal-da status root xaricində ola bilər: caption-un video ilə ortaq atasını tap
      for (const s of ['[data-testid="status-caption"]','.status-caption','.status-text']) {
        let el = dd.querySelector(s);
        for (let i = 0; el && i < 14; i++, el = el.parentElement) {
          if (el.querySelector && el.querySelector('video,canvas')) return el;
        }
      }
      const dlg = (root && root.closest && root.closest('[role="dialog"]')) || dd.querySelector('[role="dialog"]');
      if (dlg && dlg.querySelector && dlg.querySelector('[data-testid="status-caption"],.status-caption,.status-text')) return dlg;
      if (root && root !== dd.body && root.querySelector && root.querySelector('[data-testid="status-caption"],.status-caption,.status-text')) return root;
    } catch {}
    return null;
  }
  function waOwnerScan(sroot, dd, pageUrl) {
    const vals = [];
    const add = (t, score) => { t = String(t || '').replace(/\s+/g, ' ').trim(); if (t && t.length <= 60 && !/^(?:status|stories|story|reply|send|view|views|online|typing|whatsapp|menu|close|back|forward|download|share)$/i.test(t)) vals.push([t, score]); };
    const ownerSel = ['[data-testid="status-profile-name"]','.status-profile-name','[data-testid="status-viewer-header"] [title]',
      '.status-viewer-header [title]','[data-testid="status-viewer-header"] [data-testid="author"]',
      '[data-testid="status-viewer"] [data-testid="profile-name"]','[data-testid="status-viewer"] [title]',
      '[data-testid*="status"] [title]','[data-testid*="profile"] [title]','header [title]','[role="banner"] [title]'];
    for (const sel of ownerSel) {
      try { const n = sroot.querySelector(sel); if (n) add(txt(n), 20); } catch {}
    }
    // Başlıq/profile bölgəsindəki title/aria/avatar alt-ları
    try {
      for (const n of take(sroot.querySelectorAll('[title],[aria-label],img[alt]'), 80)) {
        const cls = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || '';
        if (/caption|status-text/i.test(String(cls))) continue;
        add(n.getAttribute('title') || n.getAttribute('aria-label') || n.getAttribute('alt'), 6);
      }
    } catch {}
    try {
      for (const n of take(sroot.querySelectorAll('header span[dir="auto"],[role="banner"] span[dir="auto"],[data-testid*="header"] span[dir="auto"],[data-testid*="profile"] span[dir="auto"],span[dir="auto"]'), 60)) {
        const cls = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || '';
        if (/caption|status-text/i.test(String(cls))) continue;
        add(txt(n), 4);
      }
    } catch {}
    vals.sort((a, b) => b[1] - a[1]);
    for (const [t] of vals) { const s = cleanCandidate(t, pageUrl) || t; if (s) return s; }
    return '';
  }
  function waCaptionScan(sroot, owner, pageUrl) {
    const vals = [];
    const add = (t, score) => {
      t = String(t || '').replace(/^\s*\[[^\]]{1,60}\]\s*[^:]{1,60}:\s*/, '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 180 || (owner && (t === owner || t === owner + ' ·'))) return;
      if (/^(?:reply|send|forward|share|copy|edit|delete|mute|unmute|view|views|seen|story|stories|more|next|previous|close|like|comment|save|download|status|public|private|just now|\d+[smhd]\s*ago)$/i.test(t)) return;
      if (/^[\d.,]+\s?[KkMmBb]?$/.test(t)) return;
      vals.push([t, score]);
    };
    const capSel = ['[data-testid="status-caption"]','.status-caption','.status-text','[data-testid="media-caption"]','.media-viewer-caption','.caption','[class*="caption" i]','[class*="Caption"]','[data-testid*="caption"]'];
    for (const sel of capSel) {
      try { for (const n of take(sroot.querySelectorAll(sel), 8)) add(txt(n), 20); } catch {}
    }
    try {
      for (const n of take(sroot.querySelectorAll('div,span,p,[dir="auto"]'), 700)) {
        if (n.matches && n.matches('button,a,[role="button"],[role="link"]')) continue;
        if (n.closest && n.closest('button,a,[role="button"],[role="link"]')) continue;
        const cls = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || '';
        const sig = [n.id || '', cls, n.getAttribute && (n.getAttribute('aria-label') || ''), n.getAttribute && (n.getAttribute('data-testid') || '')].join(' ');
        let score = 0;
        if (/caption/i.test(sig)) score += 25;
        else if (/status-text|status.*text/i.test(sig)) score += 18;
        else if (/status|stor|text|message|description/i.test(sig)) score += 8;
        if (n.querySelector && n.querySelector('video,audio,canvas,img,button,a')) score -= 6;
        const t = txt(n);
        if (t && t.length >= 2) add(t, score);
      }
    } catch {}
    vals.sort((a, b) => b[1] - a[1]);
    for (const [t] of vals) { const s = cleanCandidate(t, pageUrl) || (t.length <= 120 ? t : ''); if (s) return s; }
    return '';
  }
  function waTitle(v, pageUrl) {
    const root = waScope(v);
    const dd = v.ownerDocument;
    const sroot = waStatusScope(v, root);
    let cap = '', peer = '';
    if (sroot) {
      // WhatsApp status: owner + caption (Telegram status ilə eyni başlıq modeli).
      peer = waOwnerScan(sroot, dd, pageUrl);
      cap = waCaptionScan(sroot, peer, pageUrl);
      if (!cap && dd) {   // caption portal-da sroot xaricində / fərqli class-la ola bilər
        for (const sel of ['[data-testid="status-caption"]','.status-caption','.status-text',
          '[class*="caption" i]','[data-testid*="caption" i]','[class*="status-text" i]','[data-testid*="status"] [dir="auto"]']) {
          for (const n of take(dd.querySelectorAll(sel), 20)) {
            const t = txt(n).replace(/^\s*\[[^\]]{1,60}\]\s*[^:]{1,60}:\s*/, '').trim();
            if (t && (!peer || t !== peer) && t.length <= 120) { cap = cleanCandidate(t, pageUrl) || t; if (cap) break; }
          }
          if (cap) break;
        }
      }
      if (!cap && dd) {
        // Son ağıllı fallback: status açıq olduğu üçün görünən overlay mətnlərini yoxla;
        // chat siyahısı/naviqasiya və düymələr istisna edilir.
        try {
          let low = "", lowY = -Infinity;
          for (const n of take(dd.querySelectorAll('div,span,p,[dir="auto"]'), 900)) {
            if (n.closest && n.closest('#pane-side,[data-testid="chat-list"],nav,header,footer,button,a')) continue;
            const t = txt(n).replace(/^\s*\[[^\]]{1,60}\]\s*[^:]{1,60}:\s*/, '').trim();
            if (!t || t.length > 150 || (peer && t === peer)) continue;
            if (/^(?:reply|send|view|views|seen|status|stories|story|online|typing|close|menu|more|\d+[smhd]\s*ago)$/i.test(t)) continue;
            const cls = String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || '');
            if (/caption/i.test(cls)) { cap = cleanCandidate(t, pageUrl) || t; break; }
            try {
              const r = n.getBoundingClientRect && n.getBoundingClientRect();
              if (r && r.width > 0 && r.height > 0 && r.top >= 0 && r.top < (n.ownerDocument?.defaultView?.innerHeight || 2000) && r.top > lowY) { lowY = r.top; low = t; }
            } catch {}
          }
          if (!cap && low) cap = cleanCandidate(low, pageUrl) || low;
        } catch {}
      }
      return ([peer, cap].filter(Boolean).join(' · ') || 'WhatsApp status').slice(0, 120);
    }
    // Normal WhatsApp chat/video message: caption; yoxdursa göndərən.
    const capSel = ['[data-testid="media-caption"]', '[data-testid="status-caption"]', '.media-viewer-caption', '.status-caption', '.status-text', '.copyable-text span.selectable-text', '.copyable-text', '.caption'];
    for (const sel of capSel) {
      for (const n of take(root.querySelectorAll(sel), 5)) {
        let t = txt(n).replace(/^\s*\[[^\]]{1,60}\]\s*[^:]{1,60}:\s*/, '').trim();
        if (!t) continue;
        const s = cleanCandidate(t, pageUrl) || (t.length <= 120 ? t : '');
        if (s) { cap = s; break; }
      }
      if (cap) break;
    }
    for (const n of [root, ...take(root.querySelectorAll('[data-pre-plain-text]'), 8)]) {
      const p = n && n.getAttribute && (n.getAttribute('data-pre-plain-text') || '');
      const m = /\]\s*([^:]{1,60}):\s*$/.exec(p);
      if (m) { const t = String(m[1]).trim(); peer = cleanCandidate(t, pageUrl) || t; if (peer) break; }
    }
    if (!peer) for (const n of take(root.querySelectorAll('[data-testid="author"], .message-in span[dir="auto"]'), 8)) {
      const t = cleanCandidate(txt(n), pageUrl); if (t && t.length <= 40) { peer = t; break; }
    }
    if (!peer) for (const sel of ['[data-testid="status-profile-name"]', '.status-profile-name', '.status-viewer-header [title]', '[data-testid="status-viewer-header"] [title]', '.media-viewer-name .peer-title', '[data-testid="conversation-info-header-chat-title"]', 'header [title]']) {
      const n = root.querySelector(sel) || (dd && dd.querySelector(sel));
      const t = txt(n); if (t && t.length <= 60) { peer = cleanCandidate(t, pageUrl) || t; break; }
    }
    return (cap || peer).slice(0, 120);
  }
  // ---- X/Twitter: tvit mətni; yoxdursa müəllifin göstərilən adı
  function xScope(v) {
    let el = v, best = null;
    for (let i = 0; i < 22 && el; i++, el = el.parentElement) {
      if (el.querySelector && (el.querySelector('[data-testid="tweetText"]') || el.querySelector('[data-testid="User-Name"]'))) best = el;
      if (el.matches && el.matches("article")) { best = el; break; }
    }
    return best || (v.closest && v.closest("article")) || v.parentElement || v;
  }
  function xTitle(v, pageUrl) {
    let root = xScope(v), cap = "", peer = "", un = root.querySelector('[data-testid="User-Name"]');
    for (const n of take(root.querySelectorAll('[data-testid="tweetText"]'), 4)) { const t = txt(n).trim(), s = cleanCandidate(t, pageUrl) || (t && t.length <= 120 ? t : ""); if (s) { cap = s; break; } }
    if ((!un || !cap) && typeof document !== "undefined" && /\/status\/\d+/.test(pageUrl)) {   // media modal: status id ilə tviti tap
      const id = (/\/status\/(\d+)/.exec(pageUrl) || [])[1];
      if (id) for (const a of take(document.querySelectorAll('a[href*="/status/"]'), 250)) {
        if ((a.href || "").includes("/status/" + id)) {
          const art = a.closest && a.closest("article");
          if (art) {
            root = art; un = art.querySelector('[data-testid="User-Name"]');
            if (!cap) cap = cleanCandidate(txt(art.querySelector('[data-testid="tweetText"]')), pageUrl) || cap;
            break;
          }
        }
      }
    }
    if (un) {
      const links = [...un.querySelectorAll("a")].map(a => txt(a)).filter(Boolean);
      peer = links.find(t => t && !/^@/.test(t) && t.length <= 60) || "";
      if (!peer) peer = txt(un).replace(/@[\w]+/g, "").replace(/[·•].*$/, "").trim();
    }
    return (cap || peer).slice(0, 120);
  }

  // Instagram HEKAYƏ üçün ad: hekayə müəllifinin istifadəçi adı (@user) + varsa başlıq/caption.
  // Hekayə səhifəsinin <title>-u sadəcə "Stories"/"Instagram" olduğundan ad həmişə eyni düşür və
  // yüklənən fayl "Stories (7).mp4" kimi mənasız ad alırdı. Müəllif adı həmişə fərqlidir.
  function igStoryTitle(v, info, env) {
    const d = env.doc;
    const author = String(info && info.author || "").replace(/^@/, "").trim();
    let cap = "";
    const scope = (info && info.scope) || (v && v.parentElement) || d;
    const scopes = [scope, d].filter(Boolean);
    const capSel = [".stories-caption", ".stories-caption .text-content", ".StoryCaption", ".StoryCaption .text-content",
      ".story-caption", "[class*='stories'] [class*='caption']", "[class*='story'] [class*='caption']"];
    for (const sc of scopes) {
      if (!sc || !sc.querySelector) continue;
      for (const sel of capSel) {
        const n = sc.querySelector(sel);
        const t = n && txt(n).trim();
        if (t && t.length >= 2 && t.length <= 90) { cap = cleanCandidate(t, env.loc.href) || t; break; }
      }
      if (cap) break;
    }
    if (!cap) {
      // Başlıq yoxdursa, hekayə başlığındakı göstərilən adı (username) götür.
      const hdr = d && d.querySelector('header a[href^="/"] span, [data-testid="stories-viewer"] header span, header a[role="link"] span');
      const t = hdr && txt(hdr).trim();
      if (t && t.length <= 40) cap = cleanCandidate(t, env.loc.href) || t;
    }
    // Caption varsa: "@user — başlıq". Yoxdursa: "@user <hekayə id-sinin sonu>" ki, eyni müəllifin
    // ardıcıl hekayələri fərqli ad alsın (əvvəl hamısı "Stories (N).mp4" olurdu).
    if (cap) return [author, cap].filter(Boolean).join(" — ").slice(0, 120);
    const id = String((info && info.id) || "").trim();
    return [author, id ? id.slice(-4) : ""].filter(Boolean).join(" ").trim() || author || "";
  }
  function genericTitle(env) {   // yeni platformalarda permalink olmasa da mənalı ad: og:title / h1 / səhifə başlığı
    const d = env.doc; if (!d) return "";
    const cands = [];
    for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]', '[data-testid="conversation-info-header-chat-title"]', "h1"])
      for (const n of take(d.querySelectorAll(sel), 2)) cands.push(n.content || n.textContent || "");
    if (d.title) cands.push(d.title);
    for (const t of cands) {
      const s = cleanCandidate(t, env.loc.href);
      if (s && !/^(?:whatsapp|x|twitter|threads|reddit|vimeo|twitch|soundcloud|pinterest|linkedin|telegram|home|explore)$/i.test(s)) return s;
    }
    return "";
  }
  function identify(site, v, loc) {
    if (site === "telegram") return identifyTg(v, loc);
    const scope = scopeOf(v);
    const knownHints = id => { const k = IDX.byKey.get(site + ":" + id); return k && Array.isArray(k.paths) ? k.paths : []; };
    // Instagram HEKAYƏ: DOM-dakı qonşu hekayə tray-lərinin <a href="/stories/…"> linkləri aktiv hekayədən ƏVVƏL
    // tapıla bilər və yanlış pk verər. Ona görə əvvəlcə cari SƏHİFƏ ÜNVANINI (aktiv hekayə) üstün tuturuq.
    if (site === "instagram") {
      const sp = permalinkOf(site, loc.href);
      if (sp && /^\/stories\//.test(String(loc.pathname || ""))) return { site, key: site + ":" + sp.id, ...sp, scope, hints: knownHints(sp.id) };
    }
    for (const a of take(scope.querySelectorAll("a[href]"), 60)) { const p = permalinkOf(site, a.href || ""); if (p) return { site, key: site + ":" + p.id, ...p, scope, hints: knownHints(p.id) }; }
    const lp = permalinkOf(site, loc.href);
    if (lp) return { site, key: site + ":" + lp.id, ...lp, scope, hints: knownHints(lp.id) };
    // ---- Yeni ağıllı pillələr: yalnız yuxarıdakılar tapmayanda (işləyən saytların davranışı dəyişmir)
    const c = fbCache.get(v), now = Date.now();
    if (c && now - c.t < 700) return c.info;
    const keep = info => { fbCache.set(v, { t: now, info }); return info; };
    const wide = wideScopeOf(v);
    if (wide !== scope) for (const a of take(wide.querySelectorAll("a[href]"), 120)) { const p = permalinkOf(site, a.href || ""); if (p) return keep({ site, key: site + ":" + p.id, ...p, scope: wide }); }
    const ix = fromIndex(v);
    if (ix) { const p = metaPermalink(ix); if (p) return keep({ site, key: site + ":" + p.id, ...p, scope: wide, hint: ix.desc, hints: ix.paths }); }
    if (site === "tiktok") {
      const id = attrId(v);
      if (id) {
        const names = new Set();   // əhatədə YALNIZ bir müəllif varsa etibarlıdır (qonşu videoların müəllifi qarışmasın)
        for (const a of take(wide.querySelectorAll('a[href*="/@"]'), 60)) { const m = /\/@([\w.\-]+)(?:[/?#]|$)/.exec(a.getAttribute("href") || ""); if (m) names.add(m[1]); }
        let author = names.size === 1 ? [...names][0] : "";
        const known = IDX.byKey.get("tiktok:" + id);
        if (known && known.user) author = known.user;
        return keep({ site, key: site + ":" + id, id, author, url: `https://www.tiktok.com/@${author}/video/${id}`, scope: wide, hint: known ? known.desc : "", hints: known ? known.paths : [] });
      }
    }
    return keep(identifyWeak(site, v, loc, scope));
  }
  function identifyWeak(site, v, loc, scope) {
    let els = take(v.ownerDocument ? v.ownerDocument.querySelectorAll("video") : [], 500);
    if (site === "telegram" || site === "whatsapp") els = [...els, ...take(v.ownerDocument ? v.ownerDocument.querySelectorAll("audio") : [], 100)];
    const idx = els.indexOf(v);
    const src = v.currentSrc || v.src || "";
    const sk = src ? pathOfSrc(src) : "";   // blob/HLS mənbəyi: eyni səhifədə fərqli videolar ayrı qruplaşsın
    return { site, key: site + ":w:" + hash36(loc.href + "#" + idx + (sk ? "#" + sk : "")), id: "", url: loc.href, weak: true, scope };   // permalink tapılmadı: /formats sorğusu göndərilmir
  }
  function titleCands(env, v, info) {
    const out = [], add = t => { if (t) out.push(t); }, d = env.doc;
    add(info.hint);   // hook.js indeksindən gələn dəqiq təsvir (varsa)
    let el = v;
    for (let i = 0; i < 10 && el; i++) { add(el.getAttribute && el.getAttribute("aria-label")); if (el === info.scope) break; el = el.parentElement; }
    for (const sel of ['[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]', '[data-e2e="new-desc-span"]', "h1", "h2", "figcaption"])
      for (const n of take(info.scope.querySelectorAll(sel), 3)) add((n.textContent || "").slice(0, 300));
    for (const n of take(info.scope.querySelectorAll("img[alt]"), 5)) add(n.getAttribute("alt"));
    const lp = permalinkOf(info.site, env.loc.href);
    if (lp && lp.id === info.id) {   // yalnız bu video öz səhifəsindədirsə, səhifə səviyyəli metadata etibarlıdır
      for (const s of ['meta[property="og:title"]', 'meta[property="og:description"]', 'meta[name="twitter:title"]']) { const m = d.querySelector(s); if (m) add(m.content || (m.getAttribute && m.getAttribute("content"))); }
      for (const sc of take(d.querySelectorAll('script[type="application/ld+json"]'), 3)) {
        try { const j = JSON.parse(sc.textContent || ""); for (const o of [].concat(j)) add(o && (o.name || o.caption || o.headline || o.description)); } catch {}
      }
      add(d.title);
    }
    return out;
  }

  let S = null;
  function start(envIn) {
    if (S) return S;   // təkrar başlatma: ikinci observer/interval yaranmır
    const g = typeof window !== "undefined" ? window : {};
    const e = Object.assign({
      doc: typeof document !== "undefined" ? document : null, loc: typeof location !== "undefined" ? location : null, win: g,
      chrome: typeof chrome !== "undefined" ? chrome : null, IO: g.IntersectionObserver, MO: g.MutationObserver,
      setTimeout: (f, t) => setTimeout(f, t), clearTimeout: t => clearTimeout(t), setInterval: (f, t) => setInterval(f, t), clearInterval: t => clearInterval(t), now: () => Date.now()
    }, envIn || {});
    S = { e, io: null, mo: null, attached: false, seen: new WeakSet(), tick: 0, sched: 0, leaveT: 0, retryT: 0, retryPending: false, retries: 0, noVideoSince: 0,
      curSig: "", curKey: "", wasActive: false, lastHref: e.loc.href, nIO: 0 };
    const send = m => { try { return Promise.resolve(e.chrome.runtime.sendMessage(m)).catch(() => {}); } catch { return Promise.resolve(); } };
    const mediaEls = site => {
      const vs = take(e.doc.querySelectorAll("video"), 200);
      // WhatsApp status/voice və Telegram voice/audio ayrı <audio> elementindədir.
      return (site === "telegram" || site === "whatsapp") ? [...vs, ...take(e.doc.querySelectorAll("audio"), 100)] : vs;
    };
    const schedule = () => { if (!S || S.sched) return; S.sched = e.setTimeout(() => { if (S) { S.sched = 0; evaluate(); } }, 120); };
    const observeAll = () => { const site = siteOf(e.loc.hostname); for (const v of mediaEls(site)) if (!S.seen.has(v)) { S.seen.add(v); if (S.io) S.io.observe(v); } };
    const onPlaying = () => schedule(), onPop = () => schedule();
    const attach = () => {
      if (S.attached) return; S.attached = true;
      if (e.IO) { S.io = new e.IO(schedule, { threshold: [0, 0.5, 1] }); S.nIO++; }
      if (e.MO) { S.mo = new e.MO(schedule); S.mo.observe(e.doc.documentElement, { childList: true, subtree: true }); }
      e.doc.addEventListener("playing", onPlaying, true);
      const site = siteOf(e.loc.hostname);
      if (site === "telegram" || site === "whatsapp") {
        e.doc.addEventListener("loadedmetadata", onPlaying, true);
        e.doc.addEventListener("durationchange", onPlaying, true);
        e.doc.addEventListener("canplay", onPlaying, true);
      }
      e.win.addEventListener && e.win.addEventListener("popstate", onPop);
      S.seen = new WeakSet();
    };
    const detach = () => {
      if (!S.attached) return; S.attached = false;
      if (S.io) { S.io.disconnect(); S.io = null; } if (S.mo) { S.mo.disconnect(); S.mo = null; }
      e.doc.removeEventListener("playing", onPlaying, true);
      const site = siteOf(e.loc.hostname);
      if (site === "telegram" || site === "whatsapp") {
        e.doc.removeEventListener("loadedmetadata", onPlaying, true);
        e.doc.removeEventListener("durationchange", onPlaying, true);
        e.doc.removeEventListener("canplay", onPlaying, true);
      }
      e.win.removeEventListener && e.win.removeEventListener("popstate", onPop);
    };
    const leaveNow = () => {
      if (S.leaveT) { e.clearTimeout(S.leaveT); S.leaveT = 0; }
      if (!S.wasActive) return Promise.resolve();
      S.wasActive = false; S.curSig = ""; S.curKey = ""; return send({ type: "feedLeave" });
    };
    const vis = (v, vw, vh) => {
      const r = v.getBoundingClientRect(), w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)), h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)), a = r.width * r.height;
      return { area: w * h, ratio: a > 0 ? (w * h) / a : 0, big: r.width >= 150 && r.height >= 90 };
    };
    async function evaluate() {
      if (!S) return Promise.resolve();
      const site = siteOf(e.loc.hostname);
      if (!activeOn(site, e.loc)) { detach(); return leaveNow(); }
      attach(); observeAll();
      const list = mediaEls(site).map(el => ({ el, ...vis(el, e.win.innerWidth, e.win.innerHeight), playing: !el.paused && !el.ended && el.readyState >= 2, media: mediaKind(el) }))
        .filter(x => x.big || ((site === "x" || site === "whatsapp" || site === "telegram") && x.playing))   // X/WhatsApp: layout gizlətə bilər, oxuyan video yenə seçilir
        .map(x => (site === "x" || site === "whatsapp" || site === "telegram") && x.playing ? { ...x, ratio: Math.max(x.ratio, 0.6), big: true } : x);
      const a = pickActive(list);
      if (!a) {   // görünən video yoxdur: 3 san-dən sonra lentdən çıxmış sayılır (keçid zamanı müvəqqəti boşluq saxlanılır)
        const now = e.now(); if (!S.noVideoSince) S.noVideoSince = now;
        if (now - S.noVideoSince >= 3000) return leaveNow();
        if (!S.leaveT) S.leaveT = e.setTimeout(() => { S.leaveT = 0; evaluate(); }, 3100);
        return Promise.resolve();
      }
      S.noVideoSince = 0; if (S.leaveT) { e.clearTimeout(S.leaveT); S.leaveT = 0; }
      const info = identify(site, a.el, e.loc);
      if (info.tg && !info.key) return Promise.resolve();   // Telegram: video mənbəyi yüklənəndə "playing"/mutasiya yenidən çağıracaq
      const generic = !!NEW_SITES[site];
      const title = info.tg ? tgTitle(a.el, e.loc.href)
        : site === "whatsapp" ? (waTitle(a.el, e.loc.href) || genericTitle(e))
        : site === "x" ? (xTitle(a.el, e.loc.href) || genericTitle(e))
        : site === "instagram" ? (igStoryTitle(a.el, info, e) || ((info.weak && !generic) ? "" : (pickName(titleCands(e, a.el, info), e.loc.href) || (generic ? genericTitle(e) : ""))))
        : (info.weak && !generic) ? "" : (pickName(titleCands(e, a.el, info), e.loc.href) || (generic ? genericTitle(e) : ""));
      const cs = a.el.currentSrc || a.el.src || "";
      const src = /^https?:/i.test(cs) || ((info.tg || site === "whatsapp" || site === "x") && /^blob:/i.test(cs)) ? cs : "";   // blob: TG/WhatsApp/X səhifə daxilindən yüklənir
      // Smart Active Stream: aktiv <video> elementinin öz mənbələri + hook feed indeksindəki yollar.
      // Bunlar background-da media map ilə dəqiq eşləşdirilir; başqa (keş/preload) videonun axını seçilmir.
      const rawHints = [cs, a.el.src, ...take(a.el.querySelectorAll ? a.el.querySelectorAll("source") : [], 5).map(x => x.src), ...(info.hints || [])];
      const hints = [...new Set(rawHints.filter(u => /^(?:https?:\/\/|\/)/i.test(u)).map(u => {
        try { const x = new URL(u, e.loc.href); return x.pathname + x.search; } catch { return String(u).split("#")[0]; }
      }).filter(p => p.length > 12))].slice(0, 20);
      const media = mediaKind(a.el);
      const duration = mediaDur(a.el);
      const ms = mediaSize(a.el);
      const fps = media === "audio" ? 0 : await fpsOf(a.el);
      const payload = { type: "feedVideo", key: info.key, id: info.id || "", site, url: info.url, title: title || (info.tg ? "Telegram videosu" : ""), author: info.author || "", weak: !!info.weak,
        src, fps, media, duration, size: ms.size, sizeEst: ms.sizeEst, width: +(a.el.videoWidth || 0), height: +(a.el.videoHeight || 0), hints, activeAt: e.now(), pageUrl: e.loc.href };
      if (info.tg && tgProtected(a.el)) payload.protected = true;
      if (payload.key !== S.curKey) { S.retries = 0; S.retryPending = false; if (S.retryT) e.clearTimeout(S.retryT); }
      if (!title) {   // gec yüklənən başlıq: ən çox 4 yenidən yoxlama (600/1800/4000/8000 ms)
        if (S.retries < 4 && !S.retryPending) { S.retryPending = true; S.retryT = e.setTimeout(() => { if (S) { S.retryPending = false; S.retries++; evaluate(); } }, [600, 1800, 4000, 8000][S.retries]); }
      }
      const sig = JSON.stringify([payload.key, payload.url, payload.title, payload.src, payload.fps, payload.media, payload.duration, payload.size, payload.sizeEst, payload.width, payload.height, payload.hints]);
      if (sig === S.curSig) return Promise.resolve();   // təkrar hadisələr dublikat göndərmir
      S.curSig = sig; S.curKey = payload.key; S.wasActive = true;
      return send(payload);
    }
    const activeInfo = () => {
      const site = siteOf(e.loc.hostname);
      const list = mediaEls(site).map(el => ({ el, ...vis(el, e.win.innerWidth, e.win.innerHeight), playing: !el.paused && !el.ended && el.readyState >= 2, media: mediaKind(el) }))
        .filter(x => x.big || ((site === "x" || site === "whatsapp" || site === "telegram") && x.playing))
        .map(x => (site === "x" || site === "whatsapp" || site === "telegram") && x.playing ? { ...x, ratio: Math.max(x.ratio, 0.6), big: true } : x);
      const a = pickActive(list);
      if (!a) return { ok: false };
      const info = identify(site, a.el, e.loc);
      const cs = a.el.currentSrc || a.el.src || "";
      const title = info.tg ? tgTitle(a.el, e.loc.href) : site === "whatsapp" ? (waTitle(a.el, e.loc.href) || genericTitle(e)) : (genericTitle(e) || "");
      const ms = mediaSize(a.el), mk = mediaKind(a.el);
      return { ok: true, site, key: info.key, src: cs, title, url: info.url, media: mk, duration: mediaDur(a.el),
        size: ms.size, sizeEst: ms.sizeEst, width: +(a.el.videoWidth || 0), height: +(a.el.videoHeight || 0), fps: 0 };
    };
    S.evaluate = evaluate;
    S.activeInfo = activeInfo;
    S.onMsg = (m, _s, reply) => {
      if (m && m.type === "feedIdentify") { S.curSig = ""; evaluate().then(() => reply({ ok: true, key: S && S.curKey })); return true; }
      if (m && m.type === "feedInfo") { Promise.resolve(evaluate()).then(() => { try { reply(S && S.activeInfo ? S.activeInfo() : { ok: false }); } catch { reply({ ok: false }); } }); return true; }
    };
    if (e.chrome && e.chrome.runtime && e.chrome.runtime.onMessage) e.chrome.runtime.onMessage.addListener(S.onMsg);
    S.idxT = 0;
    S.tick = e.setInterval(() => { if (S && e.loc.href !== S.lastHref) { S.lastHref = e.loc.href; schedule(); } }, 800);   // tək interval: SPA URL dəyişikliyi
    S.stop = () => {
      const s = S; e.clearInterval(s.tick); [s.sched, s.leaveT, s.retryT].forEach(t => t && e.clearTimeout(t));
      detach(); try { e.chrome.runtime.onMessage.removeListener(s.onMsg); } catch {}
      const was = s.wasActive; S = null; if (was) send({ type: "feedLeave" });
    };
    schedule();
    return S;
  }
  const stop = () => { if (S) S.stop(); };

  const api = { siteOf, activeOn, permalinkOf, cleanCandidate, pickName, pickActive, start, stop, state: () => S, indexAdd, fromIndex, attrId, tgTitle, tgProtected, identifyTg, waTitle, xTitle, mediaDur, mediaKind, mediaSize };
  root.IDMFeed = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  // Brauzerdə: bayraq (feedMode, defolt açıq) əsasında başla/dayandır
  if (typeof document !== "undefined" && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && !root.__idmFeedBooted) {
    root.__idmFeedBooted = true;
    try {
      document.addEventListener("__idm_ev", ev => {   // hook.js: lent indeksi (video yolu -> id/müəllif/təsvir)
        try {
          const d = JSON.parse(ev.detail);
          if (d && d.type === "feeditem") { indexAdd(d); if (S && S.evaluate) { clearTimeout(S.idxT); S.idxT = setTimeout(() => { if (S) { S.curSig = ""; S.evaluate(); } }, 250); } }
        } catch {}
      });
      document.dispatchEvent(new CustomEvent("__idm_req"));   // hook-un artıq topladıqlarını istə
      chrome.storage.local.get("feedMode").then(s => { if (s.feedMode !== false) start(); });
      chrome.storage.onChanged.addListener((ch, a) => { if (a === "local" && ch.feedMode) (ch.feedMode.newValue !== false ? start() : stop()); });
    } catch {}
  }
})(typeof self !== "undefined" ? self : globalThis);
