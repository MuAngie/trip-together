(() => {
  "use strict";

  const providers = ["google", "amap", "baidu"];
  let opener = null;
  let previousOverflow = "";

  function searchText(value) {
    const raw = String(value || "").trim();
    if (!/^https?:\/\//i.test(raw)) return raw;
    try {
      const url = new URL(raw);
      return url.searchParams.get("query") || url.searchParams.get("q") || url.searchParams.get("keyword") || "";
    } catch {
      return "";
    }
  }

  function matchingDirectUrl(value, provider) {
    try {
      const url = new URL(String(value || ""));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:") return "";
      if (provider === "google" && (host === "google.com" || host.endsWith(".google.com"))) return url.href;
      if (provider === "amap" && (host === "amap.com" || host.endsWith(".amap.com"))) return url.href;
      if (provider === "baidu" && (host === "baidu.com" || host.endsWith(".baidu.com"))) return url.href;
    } catch {}
    return "";
  }

  function linksFor({ query, queryZh, url } = {}) {
    const googleQuery = searchText(query) || searchText(queryZh);
    const chineseQuery = searchText(queryZh) || googleQuery;
    if (!googleQuery) return null;
    return {
      google: matchingDirectUrl(url, "google") || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleQuery)}`,
      amap: matchingDirectUrl(url, "amap") || `https://uri.amap.com/search?keyword=${encodeURIComponent(chineseQuery)}&view=map&src=trip-together&callnative=1`,
      baidu: matchingDirectUrl(url, "baidu") || `https://api.map.baidu.com/place/search?query=${encodeURIComponent(chineseQuery)}&output=html&src=webapp.trip.together`
    };
  }

  function close() {
    const panel = document.querySelector("#place-map");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.body.style.overflow = previousOverflow;
    opener?.focus({ preventScroll: true });
    opener = null;
  }

  function open(place, trigger = document.activeElement) {
    const panel = document.querySelector("#place-map");
    const links = linksFor(place);
    if (!panel || !links) return false;
    if (panel.hidden) previousOverflow = document.body.style.overflow;
    opener = trigger?.closest?.(".route-popover")
      ? document.querySelector('[data-place-id][aria-expanded="true"]') || trigger
      : trigger;
    panel.querySelector("#place-map-title").textContent = place.label || searchText(place.query);
    providers.forEach((provider) => {
      panel.querySelector(`[data-map-provider="${provider}"]`).href = links[provider];
    });
    document.body.style.overflow = "hidden";
    panel.hidden = false;
    panel.querySelector("#place-map-close").focus();
    return true;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.querySelector("#place-map");
    if (!panel) return;
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("button[data-map-query]");
      if (!trigger) return;
      event.preventDefault();
      open({
        label: trigger.dataset.mapLabel,
        query: trigger.dataset.mapQuery,
        queryZh: trigger.dataset.mapQueryZh,
        url: trigger.dataset.mapUrl
      }, trigger);
    });
    panel.querySelector("#place-map-close").addEventListener("click", close);
    panel.addEventListener("click", (event) => { if (event.target === panel) close(); });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const first = panel.querySelector("#place-map-close");
      const last = panel.querySelector('[data-map-provider="baidu"]');
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  });

  window.TravelMapPicker = Object.freeze({ open, linksFor });
})();
