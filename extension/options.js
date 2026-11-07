(() => {
  const $ = id => document.getElementById(id);
  const API = "https://generativelanguage.googleapis.com/v1beta/models";
  const STORE = ["geminiApiKey", "geminiModel"];
  const keyEl = $("key"), modelEl = $("model"), statusEl = $("status"), wrap = $("modelsWrap");
  let models = [];

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = cls || "";
  }

  function fillModels(list, selected) {
    modelEl.replaceChildren();
    for (const name of list) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      modelEl.append(o);
    }
    if (selected && list.includes(selected)) modelEl.value = selected;
    wrap.style.display = list.length ? "block" : "none";
  }

  async function fetchModels(key) {
    const r = await fetch(`${API}?key=${encodeURIComponent(key)}`, {
      method: "GET",
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const list = (j.models || [])
      .filter(m => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes("generateContent"))
      .map(m => String(m.name || "").replace(/^models\//, ""))
      .filter(Boolean);
    return [...new Set(list)];
  }

  async function verify(auto = false) {
    const key = String(keyEl.value || "").trim();
    if (!key) {
      setStatus("✕ Enter a Gemini API key", "bad");
      wrap.style.display = "none";
      return false;
    }
    setStatus(auto ? "Checking saved key…" : "Verifying…", "wait");
    try {
      const list = await fetchModels(key);
      if (!list.length) throw new Error("No generateContent models available");
      models = list;
      const old = await chrome.storage.local.get("geminiModel");
      const want = String(old.geminiModel || "");
      const selected = list.includes(want) ? want : list[0];
      fillModels(list, selected);
      // Only save a key after it has been successfully verified.
      await chrome.storage.local.set({ geminiApiKey: key, geminiModel: selected });
      setStatus("✓ Valid API Key", "ok");
      return true;
    } catch (e) {
      models = [];
      wrap.style.display = "none";
      setStatus("✕ Invalid Key", "bad");
      return false;
    }
  }

  $("verify").addEventListener("click", () => verify(false));
  keyEl.addEventListener("input", () => {
    if (statusEl.className === "ok") setStatus("Key changed — verify again", "wait");
  });
  modelEl.addEventListener("change", async () => {
    const key = String(keyEl.value || "").trim();
    const model = modelEl.value;
    if (!key || !model) return;
    await chrome.storage.local.set({ geminiApiKey: key, geminiModel: model });
    setStatus("✓ Valid API Key", "ok");
  });

  chrome.storage.local.get(STORE).then(s => {
    if (s.geminiApiKey) keyEl.value = s.geminiApiKey;
    if (s.geminiModel) {
      const o = document.createElement("option");
      o.value = s.geminiModel; o.textContent = s.geminiModel;
      modelEl.append(o);
    }
    // No automatic network request on page load: the user must press Verify explicitly.
    if (s.geminiApiKey) setStatus("Saved key — press Verify to refresh models", "");
    else setStatus("No API key configured", "");
  }).catch(() => setStatus("Could not read extension storage", "bad"));
})();
