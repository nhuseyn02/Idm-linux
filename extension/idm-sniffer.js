// JDM-style request/response metadata sniffer.
// YouTube is deliberately excluded here: YouTube parsing/HLS/quality logic is handled by the
// existing extension engine and must not be touched by this module.
(() => {
  if (self.__IDM_SNIFF_ENGINE) return;
  self.__IDM_SNIFF_ENGINE = true;

  const REQ = new Map();                       // requestId -> live request record
  const PENDING = self.IDM_PENDING = new Map(); // "tabId|url" -> metadata until addMedia creates the row
  const BY_URL = self.IDM_META_BY_URL = new Map(); // url -> {meta,t}, for chrome.downloads redirection

  const TYPES = ["main_frame", "sub_frame", "object", "image", "xmlhttprequest", "media", "other"];
  const MEDIA_EXT = /\.(?:mp4|m4v|webm|mov|mkv|flv|3gp|ts|m4s|m4a|mp3|aac|ogg|oga|opus|flac|wav|m3u8|mpd|vtt|srt|ass|ssa)(?:[?#]|$)/i;
  const MANIFEST = /(?:mpegurl|dash\+xml|vnd\.apple\.mpegurl|x-mpegurl)/i;
  const DROP_REQ = new Set(["host", "content-length", "connection", "accept-encoding", "range", "if-range",
    "if-none-match", "if-modified-since", "cookie", "user-agent", "referer", "sec-fetch-site", "sec-fetch-mode",
    "sec-fetch-dest", "te", "upgrade-insecure-requests", "proxy-connection", "keep-alive", "transfer-encoding"]);
  const DROP_RESP = new Set(["set-cookie", "set-cookie2", "content-encoding", "transfer-encoding", "connection", "keep-alive"]);

  const host = u => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
  const ytHost = u => { const h = host(u); return /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(h); };
  const googHost = u => { const h = host(u); return /(?:^|\.)googlevideo\.com$/i.test(h); };
  const tabUrl = id => { try { return self.IDM_TAB_URL ? self.IDM_TAB_URL(id) : ""; } catch { return ""; } };

  function skip(d) {
    if (!d || !/^https?:/i.test(d.url || "")) return true;
    const page = tabUrl(d.tabId);
    // YouTube page/iframe: leave everything to the existing YouTube engine.
    if (ytHost(d.url) || ytHost(d.initiator) || ytHost(page)) return true;
    // googlevideo can also be Google Photos/Picasa. Only skip it when it belongs to YouTube.
    if (googHost(d.url) && (ytHost(d.initiator) || ytHost(page))) return true;
    // Sosial şəbəkələr: Ayarlar → Endirmələr-də söndürülübsə, həmin saytdan tutma.
    if (page && self.IDM_SITE_ALLOWED && !self.IDM_SITE_ALLOWED(page)) return true;
    return false;
  }

  function hdrObject(arr) {
    const o = {};
    for (const h of arr || []) {
      if (!h || !h.name) continue;
      o[String(h.name).toLowerCase()] = String(h.value == null ? "" : h.value);
    }
    return o;
  }
  function safe(o, drop) {
    const r = {};
    for (const [k, v] of Object.entries(o || {})) {
      if (drop.has(k) || !v || /^:/.test(k)) continue;
      r[k] = String(v).slice(0, 8192);
    }
    return r;
  }
  function cdName(v) {
    if (!v) return "";
    let m = /filename\*\s*=\s*(?:utf-8)?'[^']*'([^;]+)/i.exec(v);
    if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, "")); } catch {} }
    m = /filename\s*=\s*"?([^";]+)"?/i.exec(v);
    return m ? m[1].trim() : "";
  }
  function sizeOf(resp) {
    const cl = parseInt(resp["content-length"] || "0", 10) || 0;
    const cr = /\/(\d+)\s*$/.exec(resp["content-range"] || "");
    return cr ? parseInt(cr[1], 10) : cl;
  }
  function looksMedia(d, rec) {
    const mime = String((rec.resp || {})["content-type"] || "").toLowerCase();
    const cd = String((rec.resp || {})["content-disposition"] || "");
    if (/^(?:video|audio)\//i.test(mime)) return true;
    if (MANIFEST.test(mime)) return true;
    if (MEDIA_EXT.test(d.url || "")) return true;
    if (cd && MEDIA_EXT.test(cd)) return true;
    if (/(?:m3u8|mpd|mpegurl|\/hls\b|\/dash\b|playlist|manifest)/i.test(d.url || "")
        && /^(?:text\/|application\/(?:json|octet-stream|xml|vnd\.))/i.test(mime)) return true;
    return false;
  }
  function makeMeta(d, rec) {
    const req = rec.req || {}, resp = rec.resp || {};
    const headers = safe(req, DROP_REQ);
    const meta = {
      t: Date.now(), url: d.url, finalUrl: rec.finalUrl || d.url, tabId: d.tabId,
      method: rec.method || "GET", type: rec.type || d.type || "",
      reqHeaders: req, respHeaders: resp,
      headers,
      cookie: req.cookie || "",
      userAgent: req["user-agent"] || "",
      referer: req.referer || "",
      origin: req.origin || "",
      status: rec.status || 0, ip: rec.ip || "", fromCache: !!rec.fromCache,
      mime: String(resp["content-type"] || "").split(";")[0].trim(),
      size: sizeOf(resp),
      disposition: resp["content-disposition"] || "",
      name: cdName(resp["content-disposition"] || ""),
      requestAt: rec.t || Date.now()
    };
    return meta;
  }
  function remember(d, rec) {
    if (skip(d)) return;
    const meta = makeMeta(d, rec);
    const now = Date.now();
    BY_URL.set(d.url, { meta, t: now });
    if (meta.finalUrl && meta.finalUrl !== d.url) BY_URL.set(meta.finalUrl, { meta, t: now });
    if (BY_URL.size > 800) { const k = BY_URL.keys().next().value; BY_URL.delete(k); }
    if (!looksMedia(d, rec)) return;
    const key = `${d.tabId}|${d.url}`;
    PENDING.set(key, meta);
    if (PENDING.size > 800) { const k = PENDING.keys().next().value; PENDING.delete(k); }
    if (d.tabId >= 0 && self.IDM_ATTACH) { try { self.IDM_ATTACH(d.tabId, d.url, meta); } catch {} }
  }

  const onReq = d => {
    if (skip(d)) return;
    REQ.set(d.requestId, { id: d.requestId, tabId: d.tabId, url: d.url, type: d.type,
      method: d.method, t: d.timeStamp || Date.now(), body: !!d.requestBody });
    if (REQ.size > 900) { const k = REQ.keys().next().value; REQ.delete(k); }
  };
  const onSend = d => {
    if (skip(d)) return;
    const r = REQ.get(d.requestId) || { id: d.requestId, tabId: d.tabId, url: d.url, type: d.type, method: d.method, t: d.timeStamp || Date.now() };
    r.req = hdrObject(d.requestHeaders);
    r.requestAt = d.timeStamp || r.t;
    REQ.set(d.requestId, r);
  };
  const onHeaders = d => {
    if (skip(d)) return;
    const r = REQ.get(d.requestId) || { id: d.requestId, tabId: d.tabId, url: d.url, type: d.type, method: "GET", t: d.timeStamp || Date.now() };
    r.resp = hdrObject(d.responseHeaders);
    r.status = d.statusCode || 0;
    r.ip = d.ip || "";
    r.fromCache = !!d.fromCache;
    r.finalUrl = d.url;
    REQ.set(d.requestId, r);
    if (r.status === 200 || r.status === 206) remember(d, r);
  };
  const onStarted = d => {
    const r = REQ.get(d.requestId); if (!r) return;
    r.status = d.statusCode || r.status;
    r.ip = d.ip || r.ip;
    r.fromCache = !!d.fromCache;
  };
  const onDone = d => {
    const r = REQ.get(d.requestId); if (!r) return;
    if (d.ip) r.ip = d.ip;
    if (!r.resp) { r.status = d.statusCode || r.status; r.resp = {}; }
    if (!r.status || r.status === 200 || r.status === 206) remember(d, r);
    REQ.delete(d.requestId);
  };
  const onErr = d => { REQ.delete(d.requestId); };
  const onRedirect = d => {
    const r = REQ.get(d.requestId); if (!r) return;
    r.finalUrl = d.redirectUrl || r.finalUrl;
    if (d.redirectUrl) BY_URL.set(d.redirectUrl, { meta: makeMeta(d, r), t: Date.now() });
  };

  function add(ev, fn, filter, specs) {
    try { ev.addListener(fn, filter, specs); }
    catch (e) {
      try { ev.addListener(fn, filter, (specs || []).filter(x => x !== "extraHeaders")); }
      catch { try { ev.addListener(fn, filter, []); } catch {} }
    }
  }
  add(chrome.webRequest.onBeforeRequest, onReq, { urls: ["<all_urls>"], types: TYPES }, ["requestBody"]);
  add(chrome.webRequest.onBeforeSendHeaders, onSend, { urls: ["<all_urls>"], types: TYPES }, ["requestHeaders", "extraHeaders"]);
  add(chrome.webRequest.onHeadersReceived, onHeaders, { urls: ["<all_urls>"], types: TYPES }, ["responseHeaders", "extraHeaders"]);
  add(chrome.webRequest.onResponseStarted, onStarted, { urls: ["<all_urls>"], types: TYPES }, []);
  add(chrome.webRequest.onCompleted, onDone, { urls: ["<all_urls>"], types: TYPES }, []);
  add(chrome.webRequest.onErrorOccurred, onErr, { urls: ["<all_urls>"], types: TYPES }, []);
  add(chrome.webRequest.onBeforeRedirect, onRedirect, { urls: ["<all_urls>"], types: TYPES }, []);
})();
