(() => {
  "use strict";
  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const dateLabel = (date) => date.replaceAll("-", ".");

  function card(trip, index) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const status = today > trip.endDate ? "已收藏 · 旅行回忆" : today < trip.startDate ? "即将出发" : "旅途中";
    const id = escapeHtml(trip.id);
    return `<details class="journey-card" id="trip-${id}">
      <summary>
        <div class="journey-visual">
          <img class="journey-cover" src="${escapeHtml(trip.cover)}" alt="${escapeHtml(trip.coverAlt || trip.title)}" width="960" height="440" ${index ? 'loading="lazy"' : 'fetchpriority="high"'}>
          ${trip.coverNote ? `<small class="journey-cover-note">${escapeHtml(trip.coverNote)}</small>` : ""}
        </div>
        <div class="journey-summary">
          <div class="journey-meta"><span class="journey-number">旅程 / ${String(index + 1).padStart(2, "0")}</span><span class="journey-status">${status}</span></div>
          <h3>${escapeHtml(trip.title)}</h3><p class="journey-route">${escapeHtml(trip.route)}</p>
          <p class="journey-dates">${escapeHtml(dateLabel(trip.startDate))}<span>至</span>${escapeHtml(dateLabel(trip.endDate))}</p>
          <div class="journey-bottom"><span>${escapeHtml(trip.days)} 天${trip.travelers ? ` · ${escapeHtml(trip.travelers)} 人同行` : ""}</span><span class="journey-links"><a class="journey-itinerary" href="/trip.html?trip=${id}#itinerary" aria-label="查看${escapeHtml(trip.title)}的完整行程">查看行程 <span aria-hidden="true">↗</span></a><span class="journey-toggle">展开照片</span></span></div>
        </div>
      </summary>
      <div class="journey-details">
        <section class="trip-album" id="photos-${id}" data-trip-id="${id}" aria-label="${escapeHtml(trip.title)}的照片">
          <div class="album-heading"><h4>旅行照片<span class="album-count"></span></h4><div class="album-controls"><button class="collection-button album-refresh" type="button">刷新相册</button><button class="collection-button album-add" type="button" disabled>＋ 选择照片</button></div></div>
          <input class="album-input" type="file" accept="image/*" multiple hidden aria-label="选择旅行照片，可多选">
          <p class="album-note">正在确认相册保存位置…</p>
          <div class="album-pending" hidden>
            <h5 class="album-pending-title"></h5>
            <p>可以继续选择照片，确认后一起上传。刷新或离开页面会清空待上传列表。</p>
            <ul class="album-pending-list"></ul>
            <div class="album-controls"><button class="collection-button album-upload" type="button" disabled>上传照片</button><button class="collection-button album-clear" type="button">清空选择</button></div>
          </div>
          <p class="album-message" role="status" aria-live="polite"></p>
          <div class="album-empty"><p>还没有放入照片</p><p>选几张喜欢的，留住这次同行。</p></div>
          <div class="album-grid"></div>
          <button class="collection-button album-more" type="button" hidden>加载更多照片</button>
        </section>
      </div>
    </details>`;
  }

  function openFromHash() {
    const target = document.getElementById(location.hash.slice(1));
    const details = target?.closest(".journey-card");
    if (!details) return;
    details.open = true;
    requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
  }

  async function init() {
    // Existing section links continue to open the original trip.
    const legacyHashes = ["#next", "#flights", "#route", "#itinerary", "#drive", "#onboard", "#reminders", "#attractions", "#bookings", "#prep", "#ledger", "#ledger-stats"];
    if (legacyHashes.includes(location.hash)) {
      location.replace(`/trip.html?trip=shanghai-japan-2026${location.hash}`);
      return;
    }
    const list = document.querySelector("#journeys");
    try {
      const trips = await window.TravelCatalog.load();
      let year = "";
      list.innerHTML = trips.map((trip, index) => {
        const nextYear = trip.startDate.slice(0, 4);
        const heading = nextYear !== year ? `<h2 class="collection-year">${escapeHtml(nextYear)}<span></span><small>${trips.filter((item) => item.startDate.startsWith(nextYear)).length} 次旅行</small></h2>` : "";
        year = nextYear;
        return heading + card(trip, index);
      }).join("") || "<p>还没有旅行记录，第一段旅程将从这里开始。</p>";
      document.querySelectorAll(".journey-card").forEach((details) => {
        details.addEventListener("toggle", () => {
          details.querySelector(".journey-toggle").textContent = details.open ? "收起照片" : "展开照片";
        });
      });
      document.querySelectorAll(".trip-album").forEach((album) => window.TripPhotos.mount(album));
      openFromHash();
      window.addEventListener("hashchange", openFromHash);
    } catch (error) {
      list.replaceChildren();
      document.querySelector("#collection-error").hidden = false;
      console.error(error);
    } finally {
      list.setAttribute("aria-busy", "false");
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
