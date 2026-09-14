(() => {
  "use strict";

  const SECTION_SELECTOR = "#main > .section:not(.next-section)";
  const sectionById = new Map();
  let storageKey = "";
  let openSectionIds = new Set();

  function readOpenSections() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  }

  function saveOpenSections() {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...openSectionIds]));
    } catch {}
  }

  function setExpanded(section, expanded, { persist = true } = {}) {
    const toggle = section.querySelector(":scope > .section-heading .section-collapse-toggle");
    const hint = section.querySelector(":scope > .section-heading .section-collapse-hint");
    const content = section.querySelector(":scope > .section-collapse-content");
    const title = section.querySelector(":scope > .section-heading h2")?.textContent?.trim() || "此板块";
    if (!toggle || !content) return;

    section.classList.toggle("is-expanded", expanded);
    section.classList.toggle("is-collapsed", !expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${expanded ? "收起" : "展开"}${title}`);
    if (hint) hint.textContent = expanded ? "收起" : "展开";
    content.hidden = !expanded;

    if (expanded) openSectionIds.add(section.id);
    else openSectionIds.delete(section.id);
    if (persist) saveOpenSections();
  }

  function enhanceSection(section) {
    const heading = section.querySelector(":scope > .section-heading");
    if (!heading || !section.id || section.classList.contains("is-collapsible")) return;

    const content = document.createElement("div");
    content.className = "section-collapse-content";
    content.id = `${section.id}-content`;
    while (heading.nextSibling) content.append(heading.nextSibling);
    section.append(content);

    const hint = document.createElement("span");
    hint.className = "section-collapse-hint";
    hint.setAttribute("aria-hidden", "true");
    heading.append(hint);

    const toggle = document.createElement("button");
    toggle.className = "section-collapse-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-controls", content.id);
    heading.append(toggle);

    section.classList.add("is-collapsible");
    heading.classList.add("section-heading--collapsible");
    sectionById.set(section.id, section);
    setExpanded(section, openSectionIds.has(section.id), { persist: false });

    toggle.addEventListener("click", () => {
      setExpanded(section, toggle.getAttribute("aria-expanded") !== "true");
    });
  }

  function open(id, options = {}) {
    const section = sectionById.get(String(id || "").replace(/^#/, ""));
    if (!section) return false;
    setExpanded(section, true, options);
    return true;
  }

  function setup(data) {
    if (sectionById.size) return;
    const tripId = data?.metadata?.tripId || "default-trip";
    storageKey = `travel-plan:open-sections:${tripId}`;
    openSectionIds = readOpenSections();
    document.querySelectorAll(SECTION_SELECTOR).forEach(enhanceSection);
    open(location.hash, { persist: false });
  }

  window.TravelSections = Object.freeze({ open });
  document.addEventListener("travel-data-ready", (event) => setup(event.detail));
  if (window.TRAVEL_PLAN_DATA) setup(window.TRAVEL_PLAN_DATA);
})();
