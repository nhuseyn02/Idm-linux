// ai.html açılışında paneli quraşdırır (inline script CSP-yə görə ayrıca fayldadır).
(() => {
  const q = new URLSearchParams(location.search);
  const tabId = Number(q.get("tab")) || null;
  const feature = String(q.get("f") || "");
  const root = document.getElementById("si-root");
  if (!root || !self.IDMAI_PANEL) return;
  self.IDMAI_PANEL.mount(root, {
    tabId,
    feature,
    onClose: () => { try { window.close(); } catch {} }
  });
})();
