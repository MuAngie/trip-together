(() => {
  "use strict";

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);

  function placeById(data, id) {
    return (data.places || []).find((place) => place.id === id) || null;
  }

  function mapButton(place, label = place?.nameZh || place?.name || "地点", className = "map-place-action", text = "查看地图") {
    const query = place?.navigation?.query || place?.googleMapsQuery || place?.nameJa || place?.nameZh || place?.name;
    if (!query) return "";
    const queryZh = [place?.nameZh || label, place?.cityOrArea].filter(Boolean).join(" ");
    return `<button type="button" class="${className}" data-map-label="${escapeHtml(label)}" data-map-query="${escapeHtml(query)}" data-map-query-zh="${escapeHtml(queryZh)}" data-map-url="${escapeHtml(place?.navigation?.url || place?.googleMapsUrl || "")}" aria-haspopup="dialog" aria-controls="place-map" aria-label="选择地图查看${escapeHtml(label)}">${escapeHtml(text)}</button>`;
  }

  let nextBrowseId = null;
  let nextCardKey = "";
  let nextClockTimer = null;
  let nextPlan = null;

  function nextItems(data) {
    const freeDates = ["2026-10-11", "2026-10-12"];
    const scheduled = (data.days || []).flatMap((day) => (freeDates.includes(day.date)
      ? [{ id: `osaka-free-${day.date}`, time: "自由安排", text: "大阪购物／游览" }]
      : day.date === "2026-10-05" ? [{ id: "cruise-at-sea", time: "全天", text: day.title, endDate: "2026-10-06" }]
      : day.date === "2026-10-06" ? []
      : (day.schedule || []))
      .filter((entry) => entry.type !== "note")
      .map((entry) => {
        const offset = day.utcOffset || "+08:00";
        const time = String(entry.time || "").match(/^(?:约)?(\d{1,2})[:：](\d{2})/);
        return {
          ...entry,
          date: day.date,
          dateLabel: entry.endDate ? "10月5–6日" : `${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8, 10))}日`,
          dayEnd: Date.parse(`${entry.endDate || day.date}T00:00:00${offset}`) + 86400000,
          triggerAt: time ? Date.parse(`${day.date}T${time[1].padStart(2, "0")}:${time[2]}:00${entry.utcOffset || offset}`) : null,
          title: entry.nextTitle || String(entry.text || "").split(/[；。]/)[0].trim(),
          detail: entry.nextDetail || ""
        };
      }));
    const firstIndex = scheduled.findIndex((entry) => entry.id === data.nextItem?.id);
    const items = firstIndex < 0 ? [data.nextItem || {}] : scheduled.slice(firstIndex);
    if (firstIndex >= 0) items[0] = { ...items[0], ...data.nextItem };
    return items;
  }

  function currentNextIndex(items, now = Date.now()) {
    let index = items.findIndex((item) => item.dayEnd > now);
    if (index < 0) return items.length - 1;
    const date = items[index].date;
    items.forEach((item, position) => {
      if (item.date === date && item.triggerAt !== null && item.triggerAt <= now) index = position;
    });
    return index;
  }

  function nextItemStatus(data, item, index) {
    return localStorage.getItem(`travel-plan:next-status:${data.metadata.tripId}:${item.id}`)
      || (index === 0 && localStorage.getItem(`travel-plan:next-complete:${data.metadata.tripId}`) === "true" ? "complete" : "");
  }

  function refreshNextClock(data) {
    if (nextClockTimer !== null) window.clearTimeout(nextClockTimer);
    nextClockTimer = null;
    if (document.visibilityState === "hidden") return;
    renderNext(data);
    const now = Date.now();
    const nextTime = Math.min(...nextItems(data).flatMap((item) => [item.triggerAt, item.dayEnd]).filter((time) => time > now));
    if (Number.isFinite(nextTime)) nextClockTimer = window.setTimeout(() => refreshNextClock(data), Math.min(nextTime - now, 2147483647));
  }

  function renderNext(data) {
    const host = document.querySelector("#next-action");
    if (!host) return;
    const items = nextItems(data);
    let automaticIndex = currentNextIndex(items);
    while (automaticIndex < items.length - 1 && ["complete", "skipped"].includes(nextItemStatus(data, items[automaticIndex], automaticIndex))) automaticIndex++;
    const browseIndex = items.findIndex((entry) => entry.id === nextBrowseId);
    const browsing = browseIndex >= 0;
    const index = browsing ? browseIndex : automaticIndex;
    const item = items[index];
    const tripId = data.metadata.tripId;
    const statusKey = `travel-plan:next-status:${tripId}:${item.id}`;
    const legacyCompleteKey = `travel-plan:next-complete:${tripId}`;
    const status = nextItemStatus(data, item, index);
    const cardKey = JSON.stringify([tripId, item, index, status, browsing, automaticIndex]);
    if (cardKey === nextCardKey) return;
    nextCardKey = cardKey;
    document.querySelector("#next-date").textContent = item.dateLabel || "待补充";
    const place = placeById(data, item.placeId);
    host.innerHTML = `
      <div class="next-action__time">${escapeHtml(item.time || "时间待补充")}</div>
      <h3>${escapeHtml(item.title || "下一事项待补充")}</h3>
      ${item.detail ? `<p>${escapeHtml(item.detail).replace(/\n/g, "<br>")}</p>` : ""}
      ${status === "skipped" ? '<p class="next-action__status">此事项已跳过</p>' : ""}
      <div class="next-action__footer">
      <div class="next-action__buttons">
        ${place ? mapButton(place, place.nameZh || place.name, "action-button action-button--light") : ""}
        <button class="action-button action-button--accent" id="next-complete" type="button">${status === "complete" ? "已完成" : "标记完成"}</button>
        ${status !== "skipped" ? '<button class="action-button action-button--outline" id="next-skip" type="button">跳过</button>' : ""}
      </div>
      ${index > 0 || index < items.length - 1 || browsing ? `<div class="next-action__navigation">${index > 0 ? '<button class="action-button action-button--outline" id="next-previous" type="button">上一条</button>' : ""}${index < items.length - 1 ? '<button class="action-button action-button--outline" id="next-forward" type="button">下一条</button>' : ""}${browsing ? '<button class="action-button action-button--outline" id="next-current" type="button">回到当前</button>' : ""}</div>` : ""}
      </div>`;
    host.querySelector("#next-complete")?.addEventListener("click", () => {
      const completed = status !== "complete";
      if (completed) localStorage.setItem(statusKey, "complete");
      else localStorage.removeItem(statusKey);
      if (index === 0) localStorage.setItem(legacyCompleteKey, String(completed));
      renderNext(data);
    });
    host.querySelector("#next-skip")?.addEventListener("click", () => {
      localStorage.setItem(statusKey, "skipped");
      if (index === 0) localStorage.setItem(legacyCompleteKey, "false");
      if (index < items.length - 1) {
        if (browsing) nextBrowseId = items[index + 1].id;
      }
      renderNext(data);
    });
    host.querySelector("#next-previous")?.addEventListener("click", () => {
      nextBrowseId = items[index - 1].id;
      renderNext(data);
    });
    host.querySelector("#next-forward")?.addEventListener("click", () => {
      nextBrowseId = items[index + 1].id;
      renderNext(data);
    });
    host.querySelector("#next-current")?.addEventListener("click", () => {
      nextBrowseId = null;
      renderNext(data);
    });
  }

  function renderReminders(data) {
    const host = document.querySelector("#reminder-list");
    const items = data.reminders || [];
    host.innerHTML = items.length ? items.map((item) => `
      <article class="notice-item notice-item--${escapeHtml(item.tone || "info")}">
        <strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p>
      </article>`).join("") : '<p class="empty-panel">实用提醒待补充。</p>';
  }

  function renderOnboardLife(data) {
    const host = document.querySelector("#onboard-list");
    if (!host) return;
    const items = data.onboardLife || [];
    host.innerHTML = items.length ? items.map((item, index) => `
      <details class="onboard-topic" data-index="${String(index + 1).padStart(2, "0")}" ${index === 0 ? "open" : ""}>
        <summary>${escapeHtml(item.title)}</summary>
        <div class="onboard-topic__body">
          ${(item.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
          ${(item.items || []).length ? `<ul>${item.items.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>` : ""}
          ${(item.sections || []).map((section) => `
            <div class="onboard-subsection">
              <strong>${escapeHtml(section.title)}</strong>
              ${section.text ? `<p>${escapeHtml(section.text)}</p>` : ""}
              ${(section.items || []).length ? `<ul>${section.items.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>` : ""}
            </div>`).join("")}
        </div>
      </details>`).join("") : '<p class="empty-panel">船上生活资料待补充。</p>';
  }

  function renderBookings(data) {
    const host = document.querySelector("#booking-list");
    const priority = (item) => item.displayPriority ?? (item.type === "transport" ? 0 : item.type === "restaurant" ? 2 : 1);
    const items = [...(data.bookingsAndTickets || [])].sort((first, second) =>
      (first.date || "9999-12-31").localeCompare(second.date || "9999-12-31") || priority(first) - priority(second)
    );
    const locations = (item) => {
      if (item.type === "restaurant") return [{ nameZh: item.title, nameJa: item.titleJa }];
      const hotel = (data.accommodations || []).find((place) => place.type === "hotel" && place.name === item.title);
      if (hotel) return [{ ...hotel, nameZh: hotel.name, navigation: { query: hotel.addressJa || hotel.nameJa || hotel.name } }];
      if (item.id === "cruise-order") return [placeById(data, data.nextItem?.placeId)].filter(Boolean);
      if (item.id === "flight-order") {
        const flight = (data.flights || []).find((entry) => item.title.includes(entry.flightNumber));
        return [flight?.departure, flight?.arrival].map((airport) => placeById(data, airport?.airportCode?.toLowerCase())).filter(Boolean);
      }
      if (item.type === "transport") return ["kyoto", "kobe-sanda-outlets", "osaka"].map((id) => placeById(data, id)).filter(Boolean);
      return [];
    };
    host.innerHTML = items.length ? items.map((item) => {
      const mapButtons = locations(item).map((place) => mapButton(place, place.nameZh || place.name, "map-place-action", `📍 ${place.nameZh || place.name}`)).join("");
      return `
      <article class="booking-row">
        <div class="booking-row__head"><h3>${escapeHtml(item.title)}${item.titleJa ? `<small lang="ja">${escapeHtml(item.titleJa)}</small>` : item.type === "restaurant" ? "<small>日文店名待补充</small>" : ""}${item.titleEn ? `<small>${escapeHtml(item.titleEn)}</small>` : ""}</h3><span>${escapeHtml(item.status || "状态待补充")}</span></div>
        <p>${escapeHtml(item.detail || "")}</p>
        ${item.detailJa ? `<p lang="ja">${escapeHtml(item.detailJa)}</p>` : ""}
        <p>${escapeHtml(item.schedule || "")}</p>
        ${item.checkIn ? `<p>${escapeHtml(item.checkIn)}</p>` : ""}
        ${item.checkInJa ? `<p lang="ja">${escapeHtml(item.checkInJa)}</p>` : ""}
        <dl><div><dt>${escapeHtml(item.orderLabel || "订单号")}</dt><dd>${escapeHtml(item.orderNo || "待补充")}</dd></div>${item.reservationPhone ? `<div><dt>登记电话</dt><dd>${escapeHtml(item.reservationPhone)}</dd></div>` : ""}${item.bookedAt ? `<div><dt>预订时间</dt><dd>${escapeHtml(item.bookedAt)}</dd></div>` : ""}</dl>
        ${mapButtons ? `<div class="booking-row__maps">${mapButtons}</div>` : ""}
      </article>`;
    }).join("") : '<p class="empty-panel">尚未提供预订资料。</p>';
  }

  async function setupShopping(data) {
    const storage = window.TravelRuntimeStorage;
    if (!storage?.createAdapter) return;
    const persistence = window.TRAVEL_PLAN_CONFIG?.persistence || { mode: "local" };
    const sharedCollections = new Set(Array.isArray(persistence.sharedCollections) ? persistence.sharedCollections : []);
    const mode = persistence.mode === "d1" && sharedCollections.has("shopping") ? "d1" : "local";
    const adapter = storage.createAdapter({
      mode,
      tripId: data.metadata.tripId,
      apiBase: persistence.apiBase || "/api/trip",
      collections: ["shopping"]
    });
    let snapshot = await adapter.load();
    let items = Array.isArray(snapshot.shopping) ? snapshot.shopping : [];
    const authored = data.preTrip?.shoppingItems || [];
    if (!items.length && authored.length) {
      items = authored.map((item, index) => ({
        id: String(item.id || `shopping-initial-${index + 1}`),
        text: String(item.text || item.title || "").trim(),
        completed: Boolean(item.completed)
      })).filter((item) => item.text);
      await Promise.all(items.map((item) => adapter.applyChange("shopping", item)));
    }
    const host = document.querySelector("#shopping-list");
    const form = document.querySelector("#shopping-form");
    const render = () => {
      host.innerHTML = items.length ? items.map((item) => `
        <div class="todo-item${item.completed ? " is-complete" : ""}" data-shopping-id="${escapeHtml(item.id)}">
          <label><input type="checkbox" ${item.completed ? "checked" : ""} aria-label="完成：${escapeHtml(item.text)}"><span class="todo-check" aria-hidden="true">✓</span><span class="todo-text">${escapeHtml(item.text)}</span></label>
          <button type="button" class="todo-delete" aria-label="删除：${escapeHtml(item.text)}">删除</button>
        </div>`).join("") : '<p class="todo-empty">购物清单为空，等你补充。</p>';
    };
    render();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.querySelector("#shopping-input");
      const text = input.value.trim();
      if (!text) return;
      const item = { id: `shopping-${Date.now()}`, text, completed: false };
      items.push(item);
      input.value = "";
      await adapter.applyChange("shopping", item);
      render();
    });
    host.addEventListener("change", async (event) => {
      const row = event.target.closest("[data-shopping-id]");
      if (!row || !event.target.matches('input[type="checkbox"]')) return;
      const item = items.find((entry) => entry.id === row.dataset.shoppingId);
      if (!item) return;
      item.completed = event.target.checked;
      await adapter.applyChange("shopping", item);
      render();
    });
    host.addEventListener("click", async (event) => {
      const button = event.target.closest(".todo-delete");
      const row = button?.closest("[data-shopping-id]");
      if (!row) return;
      items = items.filter((item) => item.id !== row.dataset.shoppingId);
      await adapter.applyChange("shopping", { id: row.dataset.shoppingId }, "delete");
      render();
    });

    const context = navigator.modelContext;
    if (context?.registerTool) {
      try {
        await context.registerTool({
          name: "add_shopping_item",
          title: "添加购物项目",
          description: `向当前旅行的购物清单添加一项内容并保存在${mode === "d1" ? "共享数据库" : "本机"}。`,
          inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          execute: async ({ text }) => {
            const clean = String(text || "").trim();
            if (!clean) throw new Error("购物内容不能为空");
            const item = { id: `shopping-${Date.now()}`, text: clean, completed: false };
            items.push(item);
            await adapter.applyChange("shopping", item);
            render();
            return { content: [{ type: "text", text: `已添加：${clean}` }] };
          }
        });
      } catch {}
    }
  }

  document.addEventListener("travel-data-ready", (event) => {
    const data = event.detail;
    nextPlan = data;
    refreshNextClock(data);
    renderOnboardLife(data);
    renderReminders(data);
    renderBookings(data);
    const caption = document.querySelector("#route-caption");
    if (caption) caption.textContent = `${data.mapLinks?.note || "路线为行程示意。"} 地点可点按查看地图。`;
    setupShopping(data).catch(console.error);
  });
  document.addEventListener("visibilitychange", () => {
    if (nextPlan) refreshNextClock(nextPlan);
  });
  window.addEventListener("pageshow", () => {
    if (nextPlan) refreshNextClock(nextPlan);
  });
})();
