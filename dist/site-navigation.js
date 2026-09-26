(() => {
  const TRAVEL_HASHES = new Set(["", "#top", "#next", "#flights", "#route", "#itinerary", "#drive", "#onboard", "#reminders", "#attractions", "#bookings", "#prep"]);
  const travelTarget = (hash) => hash === "#attractions" ? "itinerary" : TRAVEL_HASHES.has(hash) ? hash.slice(1) : "";
  const isLedgerHash = (hash) => hash === "#ledger" || hash.startsWith("#ledger-");
  const ledgerEnabled = () => !document.querySelector("#ledger-navigation-link")?.hidden;
  const viewForHash = (hash) => isLedgerHash(hash) && ledgerEnabled() ? "ledger" : "travel";

  let activeView = "travel";
  const scrollPositions = { travel: 0, ledger: 0 };
  let scrollFrame = 0;
  let browserRouteFrame = 0;
  let pendingBrowserRestore = false;

  function elements() {
    return {
      travelView: document.querySelector('[data-site-view="travel"]'),
      ledgerView: document.querySelector('[data-site-view="ledger"]'),
      travelTrigger: document.querySelector("#travel-navigation-trigger"),
      ledgerLink: document.querySelector("#ledger-navigation-link"),
      skipLink: document.querySelector("#skip-link")
    };
  }

  function setVisibleView(nextView, options = {}) {
    const { travelView, ledgerView, travelTrigger, ledgerLink, skipLink } = elements();
    if (!travelView || !ledgerView) return;

    const viewChanged = activeView !== nextView;
    if (viewChanged) scrollPositions[activeView] = window.scrollY;
    activeView = nextView;
    const ledgerActive = nextView === "ledger";

    travelView.hidden = ledgerActive;
    ledgerView.hidden = !ledgerActive;
    travelView.toggleAttribute("inert", ledgerActive);
    ledgerView.toggleAttribute("inert", !ledgerActive);
    document.body.dataset.activeView = nextView;
    if (travelTrigger) {
      if (ledgerActive) travelTrigger.removeAttribute("aria-current");
      else travelTrigger.setAttribute("aria-current", "page");
    }
    if (ledgerLink) {
      if (ledgerActive) ledgerLink.setAttribute("aria-current", "page");
      else ledgerLink.removeAttribute("aria-current");
    }
    if (skipLink) skipLink.href = ledgerActive ? "#public-wallet" : "#main";

    if (ledgerActive) {
      if (location.hash === "#ledger-stats") document.querySelector("#pretrip-ledger").open = true;
      const tab = location.hash === "#ledger-stats" ? "stats" : location.hash === "#ledger" ? "entry" : "";
      if (tab) window.TravelLedger?.setActiveTab?.(tab, { updateHash: false });
    }

    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!ledgerActive && viewChanged) window.dispatchEvent(new Event("travel-view:shown"));
      if (options.targetId && nextView === "travel") {
        window.TravelSections?.open?.(options.targetId);
        document.getElementById(options.targetId)?.scrollIntoView({ block: "start" });
      } else if ((viewChanged || options.forceScroll) && options.restore) {
        window.scrollTo({ top: scrollPositions[nextView] || 0 });
      } else if (viewChanged || options.forceScroll) {
        window.scrollTo({ top: 0 });
      }
    });
  }

  function routeFromLocation(options = {}) {
    const hash = location.hash;
    const nextView = viewForHash(hash);
    const targetId = nextView === "travel" ? travelTarget(hash) : "";
    setVisibleView(nextView, { ...options, targetId });
  }

  function navigate(hash) {
    const nextView = viewForHash(hash);
    scrollPositions[activeView] = window.scrollY;
    if (location.hash === hash) {
      setVisibleView(nextView, { targetId: nextView === "travel" ? travelTarget(hash) : "" });
      return;
    }
    history.pushState({ view: nextView }, "", hash);
    setVisibleView(nextView, { targetId: nextView === "travel" ? travelTarget(hash) : "" });
  }

  function scheduleBrowserRoute({ restore = false } = {}) {
    pendingBrowserRestore ||= restore;
    if (browserRouteFrame) return;
    browserRouteFrame = requestAnimationFrame(() => {
      browserRouteFrame = 0;
      const shouldRestore = pendingBrowserRestore;
      pendingBrowserRestore = false;
      routeFromLocation({ restore: shouldRestore });
    });
  }

  function setup() {
    history.scrollRestoration = "manual";
    activeView = viewForHash(location.hash);
    routeFromLocation({ restore: false, forceScroll: true });

    document.addEventListener("click", (event) => {
      const ledgerLink = event.target.closest("#ledger-navigation-link");
      if (ledgerLink) {
        event.preventDefault();
        navigate("#ledger");
        return;
      }

      const travelLink = event.target.closest("#travel-navigation-trigger, #wordmark");
      if (travelLink) {
        event.preventDefault();
        navigate(travelLink.getAttribute("href") || "#top");
        return;
      }
    });

    window.addEventListener("popstate", () => scheduleBrowserRoute({ restore: true }));
    window.addEventListener("hashchange", () => scheduleBrowserRoute());
    window.addEventListener("travel-config:ready", () => {
      activeView = viewForHash(location.hash);
      routeFromLocation({ forceScroll: false });
    });
    window.addEventListener("travel-ledger:navigate", (event) => {
      const hash = event.detail?.tab === "stats" ? "#ledger-stats" : "#ledger";
      if (location.hash !== hash) history.pushState({ view: "ledger" }, "", hash);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
