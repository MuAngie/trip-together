(() => {
  "use strict";

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);

  function placeById(data, id) {
    return (data.places || []).find((place) => place.id === id) || null;
  }

  function mapUrl(place) {
    if (!place) return "";
    if (place.navigation?.url) return place.navigation.url;
    const query = place.navigation?.query || place.googleMapsQuery || place.nameZh || place.name;
    return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : "";
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
        <a class="action-button action-button--light${mapUrl(place) ? "" : " is-disabled"}" ${mapUrl(place) ? `href="${escapeHtml(mapUrl(place))}" target="_blank" rel="noopener noreferrer"` : "aria-disabled=\"true\""}>地点地图</a>
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

  function renderAttractions(data) {
    const host = document.querySelector("#attraction-list");
    const items = data.attractions || [];
    if (!items.length) {
      host.innerHTML = '<p class="empty-panel">尚未提供景点资料。</p>';
      return;
    }

    const groups = new Map();
    items.forEach((item) => {
      (item.dates?.length ? item.dates : [""]).forEach((date) => {
        if (!groups.has(date)) groups.set(date, []);
        groups.get(date).push(item);
      });
    });

    const dateLabel = (value) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      return match ? `${Number(match[2])}月${Number(match[3])}日` : "日期待补充";
    };

    host.innerHTML = [...groups.entries()].map(([date, groupItems], groupIndex) => `
      <details class="attraction-day" ${groupIndex === 0 ? "open" : ""}>
        <summary><span>${escapeHtml(dateLabel(date))}</span><small>${groupItems.length} 个地点</small></summary>
        <div class="attraction-day__list">
          ${groupItems.map((item) => {
            const place = item.placeId ? placeById(data, item.placeId) : item;
            const name = item.name || item.title || place?.nameZh || "地点待补充";
            const nameJa = item.nameJa || place?.nameJa || "";
            return `<article class="attraction-row">
              <div class="attraction-row__content">
                <h3>${escapeHtml(name)}${nameJa ? `<small lang="ja">${escapeHtml(nameJa)}</small>` : ""}</h3>
                <p>${escapeHtml(item.detail || item.note || "介绍待补充。")}</p>
              </div>
              ${mapUrl(place) ? `<a href="${escapeHtml(mapUrl(place))}" target="_blank" rel="noopener noreferrer" aria-label="在地图中查看${escapeHtml(name)}">查看地图</a>` : ""}
            </article>`;
          }).join("")}
        </div>
      </details>`).join("");
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
    const items = data.bookingsAndTickets || [];
    host.innerHTML = items.length ? items.map((item) => `
      <article class="booking-row">
        <div class="booking-row__head"><h3>${escapeHtml(item.title)}${item.titleEn ? `<small>${escapeHtml(item.titleEn)}</small>` : ""}</h3><span>${escapeHtml(item.status || "状态待补充")}</span></div>
        <p>${escapeHtml(item.detail || "")}</p>
        <p>${escapeHtml(item.schedule || "")}</p>
        <dl><div><dt>订单号</dt><dd>${escapeHtml(item.orderNo || "待补充")}</dd></div>${item.bookedAt ? `<div><dt>预订时间</dt><dd>${escapeHtml(item.bookedAt)}</dd></div>` : ""}</dl>
      </article>`).join("") : '<p class="empty-panel">尚未提供预订资料。</p>';
  }

  async function setupShopping(data) {
    const storage = window.TravelRuntimeStorage;
    if (!storage?.createAdapter) return;
    const adapter = storage.createAdapter({
      mode: "local",
      tripId: data.metadata.tripId,
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
          description: "向当前旅行的购物清单添加一项内容并保存在本机。",
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
    renderAttractions(data);
    renderBookings(data);
    const caption = document.querySelector("#route-caption");
    if (caption) caption.textContent = `${data.mapLinks?.note || "路线为行程示意。"} 地点可点按查看地图。`;
    setupShopping(data).catch(console.error);
  });
})();
