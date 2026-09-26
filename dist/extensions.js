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

  function renderNext(data) {
    const item = data.nextItem || {};
    const host = document.querySelector("#next-action");
    if (!host) return;
    document.querySelector("#next-date").textContent = item.dateLabel || "待补充";
    const preferenceKey = `travel-plan:next-complete:${data.metadata.tripId}`;
    const completed = localStorage.getItem(preferenceKey) === "true";
    const place = placeById(data, item.placeId);
    host.innerHTML = `
      <div class="next-action__time">${escapeHtml(item.time || "时间待补充")}</div>
      <h3>${escapeHtml(item.title || "下一事项待补充")}</h3>
      <p>${escapeHtml(item.detail || "具体信息待补充。")}</p>
      <div class="next-action__buttons">
        ${place ? mapButton(place, place.nameZh || place.name, "action-button action-button--light") : ""}
        <button class="action-button action-button--accent" id="next-complete" type="button">${completed ? "已完成" : "标记完成"}</button>
      </div>`;
    const button = document.querySelector("#next-complete");
    button?.addEventListener("click", () => {
      const isComplete = button.textContent === "已完成";
      localStorage.setItem(preferenceKey, String(!isComplete));
      button.textContent = isComplete ? "标记完成" : "已完成";
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
    const items = [...(data.bookingsAndTickets || [])].sort((first, second) =>
      (first.date || "9999-12-31").localeCompare(second.date || "9999-12-31")
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
    renderNext(data);
    renderOnboardLife(data);
    renderReminders(data);
    renderBookings(data);
    const caption = document.querySelector("#route-caption");
    if (caption) caption.textContent = `${data.mapLinks?.note || "路线为行程示意。"} 地点可点按查看地图。`;
    setupShopping(data).catch(console.error);
  });
})();
