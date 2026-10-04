(() => {
  "use strict";

  const providers = ["google", "amap", "baidu"];
  let opener = null;
  let previousOverflow = "";
  let press = null;
  let copiedTrigger = null;
  let copyStatusTimer = null;

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

  function linksFor({ query, queryZh, url } = {}, device = globalThis.navigator || {}) {
    const googleQuery = searchText(query) || searchText(queryZh);
    const chineseQuery = searchText(queryZh) || googleQuery;
    if (!googleQuery) return null;
    const encodedGoogleQuery = encodeURIComponent(googleQuery);
    const encodedChineseQuery = encodeURIComponent(chineseQuery);
    const ios = /iPhone|iPad|iPod/i.test(device.userAgent || "") || (device.platform === "MacIntel" && device.maxTouchPoints > 1);
    if (ios) return {
      google: `comgooglemaps://?q=${encodedGoogleQuery}`,
      amap: `iosamap://poi?sourceApplication=trip-together&name=${encodedChineseQuery}`,
      baidu: `baidumap://map/place/search?query=${encodedChineseQuery}&src=ios.trip.together`
    };
    if (/Android/i.test(device.userAgent || "")) return {
      google: `intent://www.google.com/maps/search/?api=1&query=${encodedGoogleQuery}#Intent;scheme=https;package=com.google.android.apps.maps;end`,
      amap: `intent://poi?sourceApplication=trip-together&keywords=${encodedChineseQuery}#Intent;scheme=androidamap;package=com.autonavi.minimap;end`,
      baidu: `intent://map/place/search?query=${encodedChineseQuery}&src=andr.trip.together#Intent;scheme=baidumap;package=com.baidu.BaiduMap;end`
    };
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

  function legacyCopy(text) {
    const field = document.createElement("textarea");
    const focused = document.activeElement;
    field.value = text;
    field.readOnly = true;
    field.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(field);
    try {
      field.select();
      field.setSelectionRange(0, text.length);
      return Boolean(document.execCommand?.("copy"));
    } catch {
      return false;
    } finally {
      field.remove();
      focused?.focus({ preventScroll: true });
    }
  }

  async function copyLocation(trigger) {
    const text = searchText(trigger.dataset.mapAddress) || searchText(trigger.dataset.mapQuery) || trigger.dataset.mapLabel;
    if (!text) return;
    let copied = false;
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      } else copied = legacyCopy(text);
    } catch {
      copied = legacyCopy(text);
    }
    const status = document.querySelector("#map-copy-status");
    status.textContent = copied ? "已复制地点" : "复制失败，请检查浏览器的剪贴板权限。";
    status.hidden = false;
    clearTimeout(copyStatusTimer);
    copyStatusTimer = setTimeout(() => { status.hidden = true; }, 2400);
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
    panel.querySelector(".place-map-sheet__intro").textContent = links.google.startsWith("https:") ? "选择地图查看地点" : "选择地图 App 查看地点";
    providers.forEach((provider) => {
      const link = panel.querySelector(`[data-map-provider="${provider}"]`);
      link.href = links[provider];
      link.target = links[provider].startsWith("https:") ? "_blank" : "_self";
    });
    document.body.style.overflow = "hidden";
    panel.hidden = false;
    panel.querySelector("#place-map-close").focus();
    return true;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.querySelector("#place-map");
    if (!panel) return;
    document.addEventListener("pointerdown", (event) => {
      copiedTrigger = null;
      const trigger = event.target.closest("button[data-map-query]");
      press = trigger && event.button === 0 && event.isPrimary !== false
        ? { trigger, pointerId: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp }
        : null;
    });
    document.addEventListener("pointermove", (event) => {
      if (press && event.pointerId === press.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) press = null;
    });
    document.addEventListener("pointercancel", () => { press = null; });
    document.addEventListener("contextmenu", (event) => {
      if (press && event.target.closest("button[data-map-query]") === press.trigger) event.preventDefault();
    });
    document.addEventListener("pointerup", (event) => {
      const held = press;
      press = null;
      if (!held || event.pointerId !== held.pointerId || event.timeStamp - held.time < 600
        || event.target.closest("button[data-map-query]") !== held.trigger
        || Math.hypot(event.clientX - held.x, event.clientY - held.y) > 10) return;
      event.preventDefault();
      copiedTrigger = held.trigger;
      void copyLocation(held.trigger);
    });
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("button[data-map-query]");
      if (!trigger) return;
      if (trigger === copiedTrigger && event.detail !== 0) {
        copiedTrigger = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      open({
        label: trigger.dataset.mapLabel,
        query: trigger.dataset.mapQuery,
        queryZh: trigger.dataset.mapQueryZh,
        url: trigger.dataset.mapUrl
      }, trigger);
    }, true);
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
