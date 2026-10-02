const state = {
  data: null,
  config: null,
  runtimeAdapters: {},
  expandedDay: null,
  countdownTimer: null,
  purchasedTickets: new Set(),
  todos: []
};

const MODULE_NAMES = Object.freeze(["flights", "overview", "itinerary", "todo", "driving", "ledger"]);
const SHARED_COLLECTIONS = Object.freeze(["todos", "tickets", "ledger", "shopping"]);

function normalizeTripConfig(raw = {}) {
  if (!raw || typeof raw !== "object" || raw.schemaVersion !== "1.0.0") throw new Error("trip-data.json config.schemaVersion must be 1.0.0");
  if (!raw.modules || typeof raw.modules !== "object") throw new Error("trip-data.json config must contain confirmed module switches");
  const modules = Object.fromEntries(MODULE_NAMES.map((name) => {
    if (typeof raw.modules[name] !== "boolean") throw new Error(`trip-data.json config.modules.${name} must be boolean`);
    return [name, raw.modules[name]];
  }));
  const mode = raw?.persistence?.mode;
  if (mode !== "local" && mode !== "d1") throw new Error("trip-data.json config.persistence.mode must be local or d1");
  const sharedCollections = mode === "d1" ? [...new Set(raw.persistence.sharedCollections || [])] : [];
  if (mode === "d1" && (!sharedCollections.length || sharedCollections.some((name) => !SHARED_COLLECTIONS.includes(name)))) {
    throw new Error("D1 mode requires an explicit sharedCollections allowlist");
  }
  const apiBase = raw.persistence.apiBase || "/api/trip";
  if (mode === "d1" && (!/^\/(?!\/)/.test(apiBase) || apiBase.includes("\\") || /[?#]/.test(apiBase))) {
    throw new Error("D1 apiBase must be a same-origin path");
  }
  return {
    ...raw,
    modules,
    persistence: {
      ...(raw.persistence || {}),
      mode,
      ...(mode === "d1" ? { apiBase, sharedCollections } : {})
    }
  };
}

function moduleEnabled(name) {
  return Boolean(state.config && state.config.modules?.[name] === true);
}

function applyModuleConfig() {
  document.querySelectorAll("[data-module]").forEach((element) => {
    element.hidden = !moduleEnabled(element.dataset.module);
  });
  document.documentElement.dataset.persistence = state.config.persistence.mode;

  const hashModules = {
    "#flights": "flights", "#route": "overview", "#itinerary": "itinerary",
    "#drive": "driving", "#prep": "todo", "#ledger": "ledger", "#ledger-stats": "ledger"
  };
  const requestedModule = hashModules[location.hash];
  if (requestedModule && !moduleEnabled(requestedModule)) {
    history.replaceState({ view: "travel" }, "", "#top");
  }
  window.dispatchEvent(new CustomEvent("travel-config:ready", { detail: { config: state.config } }));
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
})[character]);

const airportCity = (airport) => airport.city || airport.airportCode;

function localDateTime(date, time, _airportCode, utcOffset = "") {
  return new Date(`${date}T${time}:00${utcOffset || "+00:00"}`);
}

function countdownParts(target, now = new Date()) {
  const difference = target.getTime() - now.getTime();
  if (difference <= 0) return { difference, days: 0, hours: 0, minutes: 0 };
  const totalMinutes = Math.floor(difference / 60000);
  return {
    difference,
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60
  };
}

function countdownText(target, completionText = "已出发") {
  const value = countdownParts(target);
  if (value.difference <= 0) return completionText;
  if (value.days > 0) return `${value.days}天 ${String(value.hours).padStart(2, "0")}小时`;
  if (value.hours > 0) return `${value.hours}小时 ${String(value.minutes).padStart(2, "0")}分`;
  return `${Math.max(1, value.minutes)}分钟`;
}

function preciseCountdownText(target, completionText = "已出发") {
  const difference = target.getTime() - Date.now();
  if (difference <= 0) return completionText;
  const totalSeconds = Math.floor(difference / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `${days}天 ${clock}` : clock;
}

function formatDate(dateString, includeYear = false) {
  const date = new Date(`${dateString}T12:00:00`);
  const options = includeYear
    ? { year: "numeric", month: "long", day: "numeric" }
    : { month: "long", day: "numeric" };
  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

function formatCompactDate(dateString) {
  const [, month, day] = dateString.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function todayForTrip() {
  const timeZone = state.data?.metadata?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}

function mapButton(label, query, queryZh = label, url = "", className = "map-place-action", text = "查看地图") {
  if (!String(query || "").trim()) return "";
  return `<button type="button" class="${className}" data-map-label="${escapeHtml(label)}" data-map-query="${escapeHtml(query)}" data-map-query-zh="${escapeHtml(queryZh)}" data-map-url="${escapeHtml(url)}" aria-haspopup="dialog" aria-controls="place-map" aria-label="选择地图查看${escapeHtml(label)}">${escapeHtml(text)}</button>`;
}

function mapButtonForNamedPlace(name, placeId = "", showLabel = false) {
  const place = (state.data.places || []).find((item) => item.id === placeId || item.nameZh === name || item.nameJa === name);
  const label = place?.nameZh || String(name || "").replace(/（[^）]*待补充[^）]*）/g, "").trim();
  const query = place?.navigation?.query || place?.googleMapsQuery || place?.nameJa || label;
  return mapButton(label, query, [place?.nameZh, place?.cityOrArea].filter(Boolean).join(" ") || label, place?.navigation?.url || place?.googleMapsUrl || "", "map-place-action", showLabel ? `📍 ${label}` : "查看地图");
}

function heroDestinationFor(trip) {
  const destinations = (trip.countries || []).filter((country) => (trip.primaryDestinationCountries || []).includes(country.code));
  const isDomestic = destinations.length > 0 && destinations.every((country) => country.code === "CN");
  const customTitle = String(trip.heroTitle || "").trim();
  if (customTitle) {
    return { title: customTitle, eyebrow: String(trip.heroEyebrow || "").trim(), destinations, isDomestic };
  }
  if (isDomestic) {
    const destination = String(trip.primaryDestinationName || trip.primaryDestinationCity || trip.citiesAndAreas?.[0] || "目的地待补充").trim();
    return {
      title: destination,
      eyebrow: String(trip.primaryDestinationNameEn || trip.primaryDestinationCityEn || "DOMESTIC JOURNEY").trim(),
      destinations,
      isDomestic
    };
  }
  return {
    title: destinations.map((country) => country.nameZh || country.name).join(" × ") || "目的地待补充",
    eyebrow: destinations.map((country) => country.nameEn || country.name).filter(Boolean).join(" × "),
    destinations,
    isDomestic
  };
}

function renderHero() {
  const { trip } = state.data;
  if (trip.status === "uninitialized") {
    document.title = state.data.metadata.title;
    $("#trip-title").textContent = "旅行计划待生成";
    $("#trip-eyebrow").textContent = "READY FOR YOUR JOURNEY";
    $("#wordmark").innerHTML = "TRIP <span>· READY</span>";
    $("#footer-mark").textContent = "TRIP · READY";
    $("#route-day-count").textContent = "0 DAYS";
    $("#trip-date").textContent = "等待旅行资料";
    return;
  }
  const hero = heroDestinationFor(trip);
  const { destinations } = hero;
  const shortMark = destinations.map((country) => country.code).join(" / ");
  const year = trip.startDate.slice(0, 4);
  document.title = state.data.metadata.title;
  $("#trip-title").textContent = hero.title;
  $("#trip-eyebrow").textContent = hero.eyebrow;
  $("#wordmark").innerHTML = `${escapeHtml(shortMark)} <span>· ${escapeHtml(year)}</span>`;
  $("#footer-mark").textContent = `${shortMark} · ${year}`;
  $("#route-day-count").textContent = `${trip.dayCount} DAYS`;
  $("#trip-date").textContent = `${formatCompactDate(trip.startDate)} — ${formatCompactDate(trip.endDate)} · ${trip.dayCount}天`;
}

function journeyFlights(journeyId) {
  return state.data.flights
    .filter((flight) => flight.journeyId === journeyId)
    .sort((first, second) => first.sequence - second.sequence);
}

function journeyStatusAndTarget(flights) {
  const now = new Date();
  for (const flight of flights) {
    const departure = localDateTime(flight.departure.date, flight.departure.time, flight.departure.airportCode, flight.departure.utcOffset);
    const arrival = localDateTime(flight.arrival.date, flight.arrival.time, flight.arrival.airportCode, flight.arrival.utcOffset);
    if (now < departure) return { target: departure, label: flight === flights[0] ? "距离起飞还剩" : "距离下一程起飞还剩", complete: false };
    if (now < arrival) return { target: arrival, label: "飞行中 · 距抵达", complete: false };
  }
  return { target: null, label: "已抵达", complete: true };
}

function relativeFlightDate(date, journeyStartDate) {
  if (date === journeyStartDate) return formatCompactDate(date);
  const difference = Math.round((new Date(`${date}T12:00:00`) - new Date(`${journeyStartDate}T12:00:00`)) / 86400000);
  return difference === 1 ? "次日" : formatCompactDate(date);
}

function flightStopMarkup(stop, position, journeyStartDate) {
  let timing;
  if (position === 0) {
    timing = `<span>${escapeHtml(relativeFlightDate(stop.departure.date, journeyStartDate))}</span><b>${escapeHtml(stop.departure.time)} 出发</b>`;
  } else if (position === stop.totalStops - 1) {
    timing = `<span>${escapeHtml(relativeFlightDate(stop.arrival.date, journeyStartDate))}</span><b>${escapeHtml(stop.arrival.time)} 抵达</b>`;
  } else {
    const nextFlight = stop.nextFlight;
    const connection = nextFlight.connectionFromPrevious || {};
    const duration = connection.calculatedFromSchedule || connection.durationUsingTicketTimes || connection.plannedDurationText || "中转";
    timing = `
      <span>${escapeHtml(stop.arrival.time)} 抵达</span>
      <em>${escapeHtml(duration)}</em>
      <b>${escapeHtml(relativeFlightDate(nextFlight.departure.date, journeyStartDate))} ${escapeHtml(nextFlight.departure.time)}</b>
      <span>起飞</span>
    `;
  }
  return `
    <div class="flight-stop${position > 0 && position < stop.totalStops - 1 ? " is-transfer" : ""}">
      <span class="flight-stop__code">${escapeHtml(stop.airport.airportCode)}</span>
      <span class="flight-stop__city">${escapeHtml(airportCity(stop.airport))}</span>
      <span class="flight-stop__dot" aria-hidden="true"></span>
      <div class="flight-stop__timing">${timing}</div>
    </div>
  `;
}

function flightMissingFieldLabel(field) {
  return ({
    carrierId: "航空公司",
    flightNumber: "航班号",
    departure: "起飞信息",
    arrival: "抵达信息",
    departurePlace: "出发机场",
    arrivalPlace: "抵达机场",
    departureTime: "起飞时间",
    arrivalTime: "抵达时间",
    timeZone: "当地时区"
  })[field] || String(field || "待补充信息");
}

function flightPlaceholderCard(journey, index) {
  const missingFields = [...new Set(journey.missingFields || [])].map(flightMissingFieldLabel);
  return `
    <article class="flight-card flight-card--placeholder" data-journey="${escapeHtml(journey.id)}">
      <div class="flight-card__top">
        <span>FLIGHT ${String(index + 1).padStart(2, "0")} / ${String(state.data.flightJourneys.length).padStart(2, "0")}</span>
      </div>
      <div class="flight-placeholder">
        <span class="flight-placeholder__eyebrow">资料待补充</span>
        <h3>${escapeHtml(journey.title || "航班信息待补充")}</h3>
        <p>已按第二轮确认继续生成标准预览；系统没有猜测或伪造缺失的航班事实。</p>
        ${missingFields.length ? `<ul>${missingFields.map((field) => `<li>${escapeHtml(field)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="flight-card__countdown-row">
        <div class="flight-countdown" data-countdown-journey="${escapeHtml(journey.id)}" data-placeholder="true">
          <span>当前状态</span>
          <strong>待补充</strong>
        </div>
      </div>
    </article>
  `;
}

function flightCard(journey, index) {
  const flights = journeyFlights(journey.id);
  if (journey.placeholder || journey.status === "missing" || journey.status === "pending" || !flights.length || flights.some((flight) => flight.placeholder)) {
    return flightPlaceholderCard(journey, index);
  }
  const first = flights[0];
  const last = flights[flights.length - 1];
  const status = journeyStatusAndTarget(flights);
  const countdown = status.complete ? "已完成" : preciseCountdownText(status.target, "即将出发");
  const stops = [
    { airport: first.departure, departure: first.departure },
    ...flights.map((flight, flightIndex) => ({
      airport: flight.arrival,
      arrival: flight.arrival,
      nextFlight: flights[flightIndex + 1]
    }))
  ];
  const routeItems = [];
  stops.forEach((stop, stopIndex) => {
    routeItems.push(flightStopMarkup({ ...stop, totalStops: stops.length }, stopIndex, first.departure.date));
    if (stopIndex < flights.length) {
      const flight = flights[stopIndex];
      routeItems.push(`
        <div class="flight-segment">
          <span>${escapeHtml(flight.flightNumber)}</span>
          <i aria-hidden="true">→</i>
        </div>
      `);
    }
  });
  return `
    <article class="flight-card" data-journey="${escapeHtml(journey.id)}">
      <div class="flight-card__top">
        <span>FLIGHT ${String(index + 1).padStart(2, "0")} / ${String(state.data.flightJourneys.length).padStart(2, "0")}</span>
      </div>
      <div class="flight-card__airlines">${escapeHtml([...new Set(flights.map((flight) => flight.airline.nameZh || flight.airline.name))].join(" · "))}</div>
      <div class="flight-flow" style="--route-columns: ${stops.map((_, stopIndex) => stopIndex < stops.length - 1 ? "minmax(0,1fr) minmax(34px,.5fr)" : "minmax(0,1fr)").join(" ")}">
        ${routeItems.join("")}
      </div>
      <div class="flight-airport-maps">${stops.map((stop) => mapButtonForNamedPlace(stop.airport.airportCode, stop.airport.airportCode.toLowerCase(), true)).join("")}</div>
      <div class="flight-card__countdown-row">
        <div class="flight-countdown" data-countdown-journey="${escapeHtml(journey.id)}">
          <span>${escapeHtml(status.label)}</span>
          <strong>${escapeHtml(countdown)}</strong>
        </div>
      </div>
    </article>
  `;
}

function carTransferCard(transfer, index, total) {
  const date = transfer.date ? formatCompactDate(transfer.date) : "日期待补充";
  const time = transfer.time || "时间待补充";
  const via = (transfer.via || []).map((place) => `<li><span>途经</span><div><strong>${escapeHtml(place)}</strong></div></li>`).join("");
  return `
    <article class="flight-card car-transfer-card" data-transfer="${escapeHtml(transfer.id)}">
      <div class="flight-card__top car-transfer-card__top">
        <span>用车 ${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span>
        <b>${transfer.status === "deposit-paid" ? "定金已付" : "信息待补充"}</b>
      </div>
      <div class="car-transfer-card__time"><span>${escapeHtml(date)}</span><strong>${escapeHtml(time)}</strong></div>
      <h3>${escapeHtml(transfer.title || "用车行程")}</h3>
      <div class="car-transfer-card__provider">${escapeHtml(transfer.provider || "服务商待补充")}</div>
      <ol class="car-transfer-route">
        <li><span>上车</span><div><strong>${escapeHtml(transfer.origin || "地点待补充")}</strong></div></li>
        ${via}
        <li><span>到达</span><div><strong>${escapeHtml(transfer.destination || "地点待补充")}</strong></div></li>
      </ol>
      <p class="car-transfer-card__note">${escapeHtml(transfer.note || "具体信息待补充。")}</p>
    </article>`;
}

function transitPassCard(pass, index, total) {
  return `
    <article class="flight-card transit-pass-card" data-transit-pass="${escapeHtml(pass.id)}">
      <div class="flight-card__top transit-pass-card__top">
        <span>交通 ${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span>
        <b>购票参考</b>
      </div>
      <div class="transit-pass-card__dates">${escapeHtml(formatCompactDate(pass.date))}—${escapeHtml(formatCompactDate(pass.endDate))}</div>
      <h3>${escapeHtml(pass.title)}</h3>
      <p class="transit-pass-card__name-ja" lang="ja">${escapeHtml(pass.nameJa)}</p>
      <p class="transit-pass-card__price">${escapeHtml(pass.price)}日元 <span>每人／每天</span></p>
      <dl class="transit-pass-card__facts">
        <div><dt>购买</dt><dd>${escapeHtml(pass.purchase)}</dd></div>
        <div><dt>使用</dt><dd>${escapeHtml(pass.usage)}</dd></div>
        <div><dt>范围</dt><dd>${escapeHtml(pass.coverage)}</dd></div>
      </dl>
      <p class="transit-pass-card__tip">${escapeHtml(pass.tip)}</p>
      <a class="transit-pass-card__link" href="${escapeHtml(pass.officialUrl)}" target="_blank" rel="noopener noreferrer">查看大阪 Metro 官方说明 ↗</a>
    </article>`;
}

function hotelStayCard(hotel, index, total) {
  return `
    <article class="flight-card hotel-stay-card" data-accommodation="${escapeHtml(hotel.id)}">
      <div class="flight-card__top hotel-stay-card__top">
        <span>酒店 ${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span>
        <b>已确定</b>
      </div>
      <div class="hotel-stay-card__dates">${escapeHtml(formatCompactDate(hotel.checkInDate))} 入住 · ${escapeHtml(formatCompactDate(hotel.checkOutDate))} 退房</div>
      <h3>${escapeHtml(hotel.name)}</h3>
      <p class="hotel-stay-card__ja" lang="ja">${escapeHtml(hotel.nameJa || "日文名称待补充")}</p>
      <p class="hotel-stay-card__en" lang="en">${escapeHtml(hotel.nameEn || "")}</p>
      <dl class="hotel-stay-location">
        <div><dt>位置</dt><dd>${escapeHtml(hotel.addressZh || "待补充")}</dd></div>
        <div lang="ja"><dt>所在地</dt><dd>${escapeHtml(hotel.addressJa || "待補充")}</dd></div>
        <div><dt>交通</dt><dd>${escapeHtml(hotel.locationZh || "待补充")}</dd></div>
        <div lang="ja"><dt>アクセス</dt><dd>${escapeHtml(hotel.locationJa || "待補充")}</dd></div>
      </dl>
      <div class="hotel-stay-card__footer">
        ${mapButton(hotel.name, hotel.addressJa || hotel.nameJa || hotel.name, hotel.addressZh || hotel.name)}
      </div>
    </article>`;
}

function diningCard(booking, index, total) {
  return `
    <article class="flight-card dining-card" data-booking="${escapeHtml(booking.id)}">
      <div class="flight-card__top dining-card__top">
        <span>餐饮 ${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span>
        <b>${escapeHtml(booking.status || "状态待补充")}</b>
      </div>
      <div class="dining-card__date">${escapeHtml(formatCompactDate(booking.date))} · 晚餐 / <span lang="ja">夕食</span> · ${escapeHtml(booking.time || "时间待补充 / 時間未確認")}</div>
      <h3>${escapeHtml(booking.title)}</h3>
      <p class="dining-card__ja"${booking.titleJa ? ' lang="ja"' : ""}>${escapeHtml(booking.titleJa || "日文店名待补充")}</p>
      <p class="dining-card__detail">${escapeHtml(booking.detail || "")}</p>
      ${booking.detailJa ? `<p class="dining-card__detail dining-card__detail--ja" lang="ja">${escapeHtml(booking.detailJa)}</p>` : ""}
      <dl class="dining-card__facts">
        <div><dt>预约编号 <span lang="ja">/ 予約番号</span></dt><dd>${escapeHtml(booking.orderNo || "待补充")}</dd></div>
        ${booking.reservationPhone ? `<div><dt>登记电话 <span lang="ja">/ 登録電話番号</span></dt><dd>${escapeHtml(booking.reservationPhone)}</dd></div>` : ""}
      </dl>
      ${booking.checkIn ? `<p class="dining-card__check-in">${escapeHtml(booking.checkIn)}</p>` : ""}
      ${booking.checkInJa ? `<p class="dining-card__check-in dining-card__check-in--ja" lang="ja">${escapeHtml(booking.checkInJa)}</p>` : ""}
      <div class="dining-card__map">${mapButton(booking.title, booking.titleJa || booking.title, booking.title)}</div>
    </article>`;
}

function renderFlights() {
  const journeys = state.data.flightJourneys;
  const carTransfers = state.data.groundTransport?.carTransfers || [];
  const transitPasses = state.data.groundTransport?.publicTransitAndRail || [];
  const hotels = (state.data.accommodations || []).filter((item) => item.type === "hotel");
  const diningBookings = (state.data.bookingsAndTickets || []).filter((item) => item.type === "restaurant");
  const cards = [
    ...journeys.map((journey, index) => {
      const firstFlight = journeyFlights(journey.id)[0];
      return { date: firstFlight?.departure?.date || "9999-12-31", priority: 0, time: firstFlight?.departure?.time || "23:59", markup: flightCard(journey, index) };
    }),
    ...carTransfers.map((transfer, index) => ({
      date: transfer.date || "9999-12-31",
      priority: 0,
      time: transfer.time || "12:00",
      markup: carTransferCard(transfer, index, carTransfers.length)
    })),
    ...transitPasses.map((pass, index) => ({
      date: pass.date,
      priority: 0,
      time: "12:00",
      markup: transitPassCard(pass, index, transitPasses.length)
    })),
    ...hotels.map((hotel, index) => ({
      date: hotel.checkInDate || "9999-12-31",
      priority: 1,
      time: "23:59",
      markup: hotelStayCard(hotel, index, hotels.length)
    })),
    ...diningBookings.map((booking, index) => ({
      date: booking.date || "9999-12-31",
      priority: booking.displayPriority ?? 2,
      time: booking.time || "23:59",
      markup: diningCard(booking, index, diningBookings.length)
    }))
  ].sort((first, second) => first.date.localeCompare(second.date) || first.priority - second.priority || first.time.localeCompare(second.time));
  $("#flight-carousel").innerHTML = cards.map((card) => card.markup).join("");
  $("#flight-dots").innerHTML = cards.map((_, index) => `<span class="carousel-dot${index === 0 ? " is-active" : ""}"></span>`).join("");
  $("#flight-index").textContent = `1 / ${cards.length}`;

  const carousel = $("#flight-carousel");
  let scheduled = false;
  carousel.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      const cards = $$(".flight-card", carousel);
      const center = carousel.scrollLeft + carousel.clientWidth / 2;
      let activeIndex = 0;
      let distance = Infinity;
      cards.forEach((card, index) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        if (Math.abs(cardCenter - center) < distance) {
          distance = Math.abs(cardCenter - center);
          activeIndex = index;
        }
      });
      $$(".carousel-dot", $("#flight-dots")).forEach((dot, index) => dot.classList.toggle("is-active", index === activeIndex));
      $("#flight-index").textContent = `${activeIndex + 1} / ${cards.length}`;
      scheduled = false;
    });
  }, { passive: true });
}

function updateFlightCountdowns() {
  state.data.flightJourneys.forEach((journey) => {
    const target = $(`[data-countdown-journey="${journey.id}"]`);
    if (!target || target.dataset.placeholder === "true" || journey.placeholder) return;
    const status = journeyStatusAndTarget(journeyFlights(journey.id));
    $("strong", target).textContent = status.complete ? "已完成" : preciseCountdownText(status.target, "即将出发");
    $("span", target).textContent = status.label;
  });
}

function ticketsForDay(day) {
  if (!moduleEnabled("itinerary")) return [];
  return (state.data.ticketPlanning?.items || []).filter((ticket) =>
    ticket.dayId ? ticket.dayId === day.id : ticket.day === day.day
  );
}

function ticketsForSchedule(day, item) {
  if (!moduleEnabled("itinerary")) return [];
  const tickets = ticketsForDay(day);
  if (Array.isArray(item.ticketIds)) return tickets.filter((ticket) => item.ticketIds.includes(ticket.id));
  if (item.id) {
    const explicit = tickets.filter((ticket) => (ticket.scheduleItemIds || ticket.itemIds || []).includes(item.id));
    if (explicit.length) return explicit;
  }
  const lowerText = String(item.text || item.title || "").toLocaleLowerCase();
  return tickets.filter((ticket) => (ticket.scheduleMatchTerms || []).some((term) => lowerText.includes(term.toLocaleLowerCase())));
}

function isTicketPurchased(ticket) {
  return ticket.purchaseStatus === "purchased" || state.purchasedTickets.has(ticket.id);
}

function ticketRequirement(ticket) {
  return ({
    "advance-required": "需提前购票",
    "advance-recommended": "建议预约",
    "needs-confirmation": "购票方式待确认"
  })[ticket.requirement] || "门票信息";
}

function ticketTitle(ticket) {
  return ticket.name || ticket.attraction?.nameZh || ticket.attraction?.name || "门票详情";
}

function ticketGuidance(ticket) {
  const guidance = ticket.guidance || ticket.notes || [];
  return Array.isArray(guidance) ? guidance.join("·") : String(guidance || "");
}

function ticketDocument(ticket) {
  const document = ticket.document || ticket.booking?.document;
  if (document && typeof document === "object") {
    return { url: document.url || document.path || "", type: document.type || "", label: document.label || "查看票据" };
  }
  const url = ticket.documentUrl || ticket.booking?.documentUrl || "";
  return url ? { url, type: "", label: ticket.documentLabel || "查看票据" } : null;
}

function inlineTicketMarkup(ticket) {
  const purchased = isTicketPurchased(ticket);
  const title = ticketTitle(ticket);
  return `
    <div class="schedule-ticket ${purchased ? "is-purchased" : `is-${escapeHtml(ticket.requirement)}`}" data-inline-ticket="${escapeHtml(ticket.id)}">
      <label class="schedule-ticket__toggle">
        <input type="checkbox" value="${escapeHtml(ticket.id)}" ${purchased ? "checked" : ""} aria-label="${purchased ? "取消已购票" : "标记为已购票"}：${escapeHtml(title)}">
        <span class="schedule-ticket__check" aria-hidden="true">✓</span>
        <span class="schedule-ticket__content">
          <span class="schedule-ticket__status">${purchased ? "已购票" : escapeHtml(ticketRequirement(ticket))}</span>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(ticketGuidance(ticket))}</small>
        </span>
      </label>
      <button type="button" class="schedule-ticket__open" data-ticket-open="${escapeHtml(ticket.id)}" aria-haspopup="dialog" aria-controls="ticket-dialog">查看</button>
    </div>`;
}

function itineraryDisplayText(value = "") {
  return String(value)
    .replace(/[^。；，]*(?:待补充|待安排|待确认|待定|未定|未确认|尚未预订)[^。；，]*[。；，]?/gu, "")
    .replace(/[；，]+$/u, "。")
    .trim();
}

function dayCard(day) {
  const today = todayForTrip();
  const isToday = day.date <= today && today <= (day.endDate || day.date);
  const expanded = state.expandedDay === day.day;
  const isFreeDay = ["2026-10-11", "2026-10-12"].includes(day.date);
  const scheduleItems = day.schedule.map((item) => {
    const text = itineraryDisplayText(item.text);
    const time = itineraryDisplayText(item.time);
    if (!text) return "";
    const destinations = item.type === "transfer" || ["cruise-arrive", "taxi-to-shinagawa"].includes(item.id) ? [] : navigationDestinations(item);
    const mapLinks = destinations.map((destination) => `
      <button type="button" class="schedule-map-link" data-map-query="${escapeHtml(destination.query)}" data-map-query-zh="${escapeHtml(destination.label)}" data-map-url="${escapeHtml(destination.url || "")}" data-map-label="${escapeHtml(destination.label)}" aria-haspopup="dialog" aria-controls="place-map" aria-label="选择地图查看${escapeHtml(destination.label)}">📍 ${escapeHtml(destination.label)}</button>
    `).join("");
    const scheduleTickets = ticketsForSchedule(day, item).map(inlineTicketMarkup).join("");
    const attraction = item.type === "attraction"
      ? (state.data.attractions || []).find((entry) => entry.placeId === item.placeId && entry.dates?.includes(day.date))
      : null;
    if (isFreeDay) return `
      <li class="optional-place">
        <details>
          <summary>${escapeHtml(text)}</summary>
          <div class="optional-place__detail">
            ${attraction?.nameJa ? `<span lang="ja">${escapeHtml(attraction.nameJa)}</span>` : ""}
            ${attraction?.detail ? `<p>${escapeHtml(itineraryDisplayText(attraction.detail))}</p>` : ""}
            ${mapLinks ? `<div class="schedule-map-links">${mapLinks}</div>` : ""}
          </div>
        </details>
      </li>`;
    const scheduleText = attraction
      ? `<details class="schedule-attraction">
          <summary class="schedule-text">${escapeHtml(text)}</summary>
          <div class="schedule-attraction__detail">
            ${attraction.nameJa ? `<span lang="ja">${escapeHtml(attraction.nameJa)}</span>` : ""}
            <p>${escapeHtml(itineraryDisplayText(attraction.detail || ""))}</p>
          </div>
        </details>`
      : `<div class="schedule-text">${escapeHtml(text)}</div>`;
    return `
      <li class="schedule-item">
        ${time ? `<span class="schedule-time">${escapeHtml(time)}</span>` : ""}
        <div class="schedule-content">
          ${scheduleText}
          ${attraction?.admission ? `<span class="schedule-admission">${escapeHtml(attraction.admission)}</span>` : ""}
          ${item.walkingEstimate ? `<p class="schedule-walk">步行参考 · ${escapeHtml(item.walkingEstimate)}</p>` : ""}
          ${scheduleTickets}
          ${mapLinks ? `<div class="schedule-map-links">${mapLinks}</div>` : ""}
        </div>
      </li>
    `;
  });
  const schedule = isFreeDay
    ? [{ category: "游览可选", title: "游览地点" }, { category: "采购可选", title: "采购地点" }].map((group) => {
        const items = scheduleItems.filter((markup, index) => markup && day.schedule[index].time === group.category);
        return `<details class="optional-place-group">
          <summary>${group.title}<span>${items.length}处</span></summary>
          <ul class="optional-place-list">${items.join("")}</ul>
        </details>`;
      }).join("")
    : `<ol class="schedule">${scheduleItems.join("")}</ol>`;
  const notes = [...(day.notes || []), ...(day.sourceDateLabelConflict ? [day.sourceDateLabelConflict] : [])].map(itineraryDisplayText).filter(Boolean);
  const dayTickets = ticketsForDay(day);
  const pendingTicketCount = dayTickets.filter((ticket) => !isTicketPurchased(ticket)).length;
  const ticketSummary = dayTickets.length
    ? `<span class="day-ticket-summary ${pendingTicketCount ? "has-pending" : "is-complete"}">${pendingTicketCount ? `${pendingTicketCount} 项待购票` : "门票已准备"}</span>`
    : "";
  const dailyMap = day.date === "2026-10-07" ? `
    <section class="daily-map" aria-label="10月7日京都市内地图">
      <h3>10月7日 · 京都市内地图</h3>
      <p>编号标记为京都段行程，连线仅表示先后；橙色“午”为午餐建议、“歇”为鸭川后的休憩建议，均不加入连线。紫色为晚餐后可选的祇园白川、花见小路和八坂神社，不加入额外连线。各段步行参考见下方行程，按地点坐标与街区距离、约 3.5 公里/小时估算，非导航实测；午餐另选时距离会变化。</p>
      <div class="daily-map__canvas" id="day-map-2026-10-07" role="region" aria-label="京都段行程、午餐与休憩建议、晚餐后可选夜游地点的位置地图"></div>
    </section>` : day.date === "2026-10-08" ? `
    <section class="daily-map" aria-label="10月8日金阁寺与岚山地图">
      <h3>10月8日 · 金阁寺与岚山地图</h3>
      <p>编号标记为酒店出发、金阁寺、岚山景点及晚餐地点；酒店标记也代表返程。连线仅表示先后，不代表实际行车或步行道路。紫色“选”为常寂光寺和三十三间堂备选，不加入连线。放大地图可查看岚山各点。</p>
      <div class="daily-map__canvas" id="day-map-2026-10-08" role="region" aria-label="10月8日金阁寺、岚山、大河内山庄庭院、酒店、晚餐与常寂光寺、三十三间堂备选地点的位置地图"></div>
    </section>` : day.date === "2026-10-09" ? `
    <section class="daily-map" aria-label="10月9日伏见稻荷与东山地图">
      <h3>10月9日 · 伏见稻荷与东山地图</h3>
      <p>编号标记为酒店、伏见稻荷、清水坂午餐区域、清水寺、三年坂和二年坂；连线仅表示行程先后，不代表实际车行或步行道路。清水坂是街区参考位置，不是已选餐厅；紫色“选”为可继续散步的八坂塔，橙色“餐”为自由晚餐区域，均不加入连线。放大地图可查看东山相邻地点；平安神宫与京都御所仍为备选，可通过下方地点按钮查看。</p>
      <div class="daily-map__canvas" id="day-map-2026-10-09" role="region" aria-label="10月9日酒店、伏见稻荷、清水坂、清水寺、三年坂、二年坂与可选地点的位置地图"></div>
    </section>` : isFreeDay ? `
    <section class="daily-map" aria-label="大阪游览与采购地图">
      <h3>${escapeHtml(formatCompactDate(day.date))} · 大阪地图</h3>
      <p class="daily-map__legend"><span>游览</span><span class="daily-map__legend--shopping">采购</span><span class="daily-map__legend--hotel">酒店</span></p>
      <div class="daily-map__canvas" id="day-map-${day.date}" role="region" aria-label="大阪酒店、可选游览及采购地点的位置地图"></div>
    </section>` : "";
  return `
    <article class="day-card${isToday ? " is-today" : ""}" data-day="${day.day}">
      <span class="day-dot" aria-hidden="true"></span>
      <button class="day-toggle" type="button" aria-expanded="${expanded}" aria-controls="day-detail-${day.day}">
        <span>
          <span class="day-meta">DAY ${String(day.day).padStart(2, "0")}${day.endDay ? `–${String(day.endDay).padStart(2, "0")}` : ""}<br>${escapeHtml(day.dateLabel || formatCompactDate(day.date))}${isToday ? " · 今天" : ""}</span>
          <span class="day-title">${escapeHtml(day.title)}</span>
          <span class="day-locations">${escapeHtml(day.locations.join(" → "))}</span>
          <span class="day-weather" data-weather-date="${escapeHtml(day.date)}" hidden></span>
          ${ticketSummary}
        </span>
        <span class="day-chevron" aria-hidden="true">+</span>
      </button>
      <div class="day-detail" id="day-detail-${day.day}" ${expanded ? "" : "hidden"}>
        ${dailyMap}
        ${schedule}
        ${notes.map((note) => `<p class="detail-note">${escapeHtml(note)}</p>`).join("")}
      </div>
    </article>
  `;
}

let sampleDayMap = null;

function showSampleDayMap() {
  const maps = {
    4: {
      date: "2026-10-07",
      routeIds: ["kyoto-station", "kyoto-hotel", "nishiki-market", "shijo-kamo-river", "restaurant-kanegura"],
      highlightedIds: [],
      extras: [
        { id: "kyoto-shirakawa", label: "夜", kind: "evening", caption: "饭后可选" },
        { id: "hanamikoji-street", label: "夜", kind: "evening", caption: "饭后可选" },
        { id: "yasaka-shrine", label: "夜", kind: "evening", caption: "饭后可选" },
        { id: "restaurant-sukiyaki-kimura", label: "午", kind: "suggested", caption: "午餐建议" },
        { id: "the-terminal-kyoto", label: "歇", kind: "suggested", caption: "休憩建议" }
      ]
    },
    5: {
      date: "2026-10-08",
      routeIds: ["kyoto-hotel", "kinkakuji", "arashiyama", "tenryuji", "arashiyama-bamboo", "okochi-sanso-garden", "nonomiya-shrine", "togetsukyo", "kyoto-hotel", "restaurant-kyorinsen"],
      highlightedIds: [],
      extras: [
        { id: "jojakkoji", label: "选", kind: "evening", caption: "体力允许时备选" },
        { id: "sanjusangendo", label: "选", kind: "evening", caption: "晚餐前备选；16:30停止入场" }
      ]
    },
    6: {
      date: "2026-10-09",
      routeIds: ["kyoto-hotel", "fushimi-inari", "kiyomizuzaka", "kiyomizu-dera", "sannenzaka", "ninenzaka"],
      highlightedIds: [],
      extras: [
        { id: "yasaka-pagoda", label: "选", kind: "evening", caption: "体力允许时可选" },
        { id: "gion", label: "餐", kind: "suggested", caption: "自由晚餐区域" },
        { id: "shijo", label: "餐", kind: "suggested", caption: "自由晚餐区域" }
      ]
    }
  };
  const day = state.data.days.find((entry) => entry.day === state.expandedDay);
  const config = maps[state.expandedDay] || (["2026-10-11", "2026-10-12"].includes(day?.date) ? {
    date: day.date,
    routeIds: [],
    highlightedIds: [],
    extras: [{ id: "osaka-hotel", label: "宿", kind: "hotel", caption: "酒店" }, ...day.schedule.map((item) => ({
      id: item.placeId,
      label: item.time === "采购可选" ? "购" : "游",
      kind: item.time === "采购可选" ? "suggested" : "visit",
      caption: item.time === "采购可选" ? "采购" : "游览"
    }))]
  } : null);
  if (!config) return;
  const canvas = $(`#day-map-${config.date}`);
  if (!canvas || canvas.closest(".day-detail").hidden) return;
  if (!window.L) {
    canvas.textContent = "地图暂无法载入，请使用下方地点按钮查看。";
    return;
  }
  if (sampleDayMap && sampleDayMap.getContainer() !== canvas) {
    sampleDayMap.remove();
    sampleDayMap = null;
  }
  if (sampleDayMap) {
    sampleDayMap.invalidateSize();
    return;
  }
  const places = config.routeIds.map((id) => state.data.places.find((place) => place.id === id)).filter((place) => place?.geo);
  const points = places.map((place) => [place.geo.lat, place.geo.lng]);
  const extras = config.extras.map((extra) => ({ ...extra, place: state.data.places.find((place) => place.id === extra.id) }))
    .filter((extra) => extra.place?.geo);
  const extraPoints = extras.map((extra) => [extra.place.geo.lat, extra.place.geo.lng]);
  sampleDayMap = window.L.map(canvas, { scrollWheelZoom: false }).fitBounds([...points, ...extraPoints], { padding: [32, 32] });
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(sampleDayMap);
  if (points.length > 1) window.L.polyline(points, { color: "#187f8b", weight: 3, opacity: 0.7, dashArray: "5 7" }).addTo(sampleDayMap);
  const marked = new Set();
  places.forEach((place) => {
    if (marked.has(place.id)) return;
    marked.add(place.id);
    const number = marked.size;
    const icon = window.L.divIcon({
      className: `daily-map__marker${config.highlightedIds.includes(place.id) ? " daily-map__marker--evening" : ""}`,
      html: `<span>${number}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    const label = place.id === "kyoto-hotel" && config.date === "2026-10-08" ? `${place.nameZh}（出发／返回）` : place.nameZh;
    window.L.marker([place.geo.lat, place.geo.lng], { icon, title: label }).bindPopup(`${number}. ${escapeHtml(label)}`).addTo(sampleDayMap);
  });
  extras.forEach(({ place, label, kind, caption }) => {
    const icon = window.L.divIcon({
      className: `daily-map__marker daily-map__marker--${kind}`,
      html: `<span>${label}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    window.L.marker([place.geo.lat, place.geo.lng], { icon, title: `${place.nameZh}（${caption}）` })
      .bindPopup(`${caption}：${escapeHtml(place.nameZh)}`)
      .addTo(sampleDayMap);
  });
}

function navigationDestinations(item) {
  const policy = state.data.mapLinks?.navigationPolicy || { noNavigationTypes: [], selfNavigationTypes: [] };
  if (policy.noNavigationTypes.includes(item.type)) return [];
  const referencedPlaceIds = [...new Set([
    ...(Array.isArray(item.placeIds) ? item.placeIds : []),
    ...(item.placeId ? [item.placeId] : [])
  ])];
  if (referencedPlaceIds.length) {
    return referencedPlaceIds.map((placeId) => state.data.places.find((place) => place.id === placeId)).filter(Boolean).map((place) => ({
      id: place.id,
      label: place.nameZh || place.name,
      query: place.navigation?.query || place.googleMapsQuery || place.address || `${place.nameZh || place.name}${place.cityOrArea ? `, ${place.cityOrArea}` : ""}`,
      directUrl: Boolean(place.navigation?.url || place.googleMapsUrl),
      url: place.navigation?.url || place.googleMapsUrl || ""
    }));
  }
  const text = String(item.text || item.title || "");
  const lowerText = text.toLocaleLowerCase();
  const explicit = (state.data.mapLinks?.navigationPlaces || [])
    .filter((place) => place.matchTerms.some((term) => lowerText.includes(term.toLocaleLowerCase())))
    .map((place) => ({
      id: place.id,
      label: place.label,
      query: place.query,
      priority: place.priority || 1,
      matchIndex: Math.max(...place.matchTerms.map((term) => lowerText.lastIndexOf(term.toLocaleLowerCase())))
    }));
  const highestExplicitPriority = explicit.reduce((highest, place) => Math.max(highest, place.priority), 0);
  const selectedExplicit = highestExplicitPriority > 1
    ? explicit.filter((place) => place.priority === highestExplicitPriority)
    : explicit;

  const catalogPlaces = state.data.places
    .filter((place) => [place.name, place.nameZh].filter(Boolean).some((name) => lowerText.includes(name.toLocaleLowerCase())))
    .map((place) => ({
      id: place.id,
      label: place.nameZh || place.name,
      query: place.googleMapsUrl || [place.name, place.cityOrArea].filter(Boolean).join(", "),
      directUrl: Boolean(place.googleMapsUrl),
      matchIndex: Math.max(...[place.name, place.nameZh].filter(Boolean).map((name) => lowerText.lastIndexOf(name.toLocaleLowerCase())))
    }));

  const restaurants = state.data.restaurants
    .filter((restaurant) => lowerText.includes(restaurant.name.toLocaleLowerCase()))
    .map((restaurant) => ({
      id: `restaurant-${restaurant.name}`,
      label: restaurant.name,
      query: restaurant.googleMapsUrl || `${restaurant.name}, ${restaurant.city}`,
      directUrl: Boolean(restaurant.googleMapsUrl),
      matchIndex: lowerText.lastIndexOf(restaurant.name.toLocaleLowerCase())
    }));

  const specificExplicit = selectedExplicit.filter((place) => place.priority > 1);
  let destinations = specificExplicit.length
    ? [...specificExplicit, ...restaurants]
    : catalogPlaces.length
      ? [...catalogPlaces, ...restaurants]
      : [...selectedExplicit, ...restaurants];
  destinations = destinations.filter((place, index, all) => all.findIndex((candidate) => candidate.id === place.id) === index);

  if (policy.selfNavigationTypes.includes(item.type) && destinations.length > 1 && !specificExplicit.length) {
    destinations.sort((first, second) => second.matchIndex - first.matchIndex);
    return [destinations[0]];
  }
  return destinations;
}

function itineraryDays() {
  const first = state.data.days.find((day) => day.date === "2026-10-05");
  const second = state.data.days.find((day) => day.date === "2026-10-06");
  if (!first || !second) return state.data.days;
  return state.data.days.filter((day) => day !== second).map((day) => day !== first ? day : {
    ...first,
    endDate: second.date,
    endDay: second.day,
    dateLabel: "10月5–6日",
    locations: [...new Set([...first.locations, ...second.locations])],
    schedule: [...first.schedule, ...second.schedule],
    notes: [...new Set([...(first.notes || []), ...(second.notes || [])])]
  });
}

function currentTripDay() {
  const today = todayForTrip();
  return itineraryDays().find((day) => day.date <= today && today <= (day.endDate || day.date))?.day || null;
}

function renderTimeline() {
  const today = currentTripDay();
  state.expandedDay = today;
  $("#day-count").textContent = `${state.data.days.length} DAYS`;
  $("#timeline").innerHTML = itineraryDays().map(dayCard).join("");
  $("#timeline").onclick = (event) => {
    const ticketButton = event.target.closest("[data-ticket-open]");
    if (ticketButton) {
      openTicketDialog(ticketButton.dataset.ticketOpen, ticketButton);
      return;
    }
    const toggle = event.target.closest(".day-toggle");
    if (!toggle) return;
    const card = toggle.closest(".day-card");
    const dayNumber = Number(card.dataset.day);
    const wasExpanded = toggle.getAttribute("aria-expanded") === "true";
    const toggleTop = toggle.getBoundingClientRect().top;
    $$(".day-toggle", $("#timeline")).forEach((button) => button.setAttribute("aria-expanded", "false"));
    $$(".day-detail", $("#timeline")).forEach((detail) => { detail.hidden = true; });
    if (!wasExpanded) {
      toggle.setAttribute("aria-expanded", "true");
      $(`#day-detail-${dayNumber}`).hidden = false;
      state.expandedDay = dayNumber;
      if ([4, 5, 6, 8, 9].includes(dayNumber)) requestAnimationFrame(showSampleDayMap);
    } else {
      state.expandedDay = null;
    }
    if (event.isTrusted) requestAnimationFrame(() => {
      const pageStyle = document.documentElement.style;
      const scrollBehavior = pageStyle.scrollBehavior;
      pageStyle.scrollBehavior = "auto";
      window.scrollBy(0, toggle.getBoundingClientRect().top - toggleTop);
      pageStyle.scrollBehavior = scrollBehavior;
    });
  };
  $("#timeline").onchange = (event) => {
    const checkbox = event.target.closest(".schedule-ticket input[type='checkbox']");
    if (!checkbox) return;
    if (checkbox.checked) state.purchasedTickets.add(checkbox.value);
    else state.purchasedTickets.delete(checkbox.value);
    saveTicketState(checkbox.value, checkbox.checked);
    updateInlineTicketState(checkbox.value, checkbox.checked);
  };
  if ([4, 5, 6, 8, 9].includes(state.expandedDay)) requestAnimationFrame(showSampleDayMap);
}

function updateInlineTicketState(ticketId, purchased) {
  const ticketData = state.data.ticketPlanning.items.find((item) => item.id === ticketId);
  if (!ticketData) return;
  $$(`[data-inline-ticket="${ticketId}"]`).forEach((ticket) => {
    ticket.classList.toggle("is-purchased", purchased);
    ticket.querySelector("input").checked = purchased;
    ticket.querySelector("input").setAttribute("aria-label", `${purchased ? "取消已购票" : "标记为已购票"}：${ticketTitle(ticketData)}`);
    ticket.querySelector(".schedule-ticket__status").textContent = purchased ? "已购票" : ticketRequirement(ticketData);
  });
  const day = state.data.days.find((item) => ticketData.dayId ? item.id === ticketData.dayId : item.day === ticketData.day);
  const dayCardElement = day ? $(`[data-day="${day.day}"]`) : null;
  const badge = dayCardElement ? $(".day-ticket-summary", dayCardElement) : null;
  const dayTickets = day ? ticketsForDay(day) : [];
  const pending = dayTickets.filter((ticket) => !isTicketPurchased(ticket)).length;
  if (!badge) return;
  badge.textContent = pending ? `${pending} 项待购票` : "门票已准备";
  badge.classList.toggle("has-pending", pending > 0);
  badge.classList.toggle("is-complete", pending === 0);
}

async function loadTicketState() {
  state.purchasedTickets = new Set();
}

function saveTicketState(ticketId, completed) {
  return saveSharedChange("tickets", { id: ticketId, completed }, completed ? "upsert" : "delete").catch(console.error);
}

function rentalStatus(rental) {
  const pickup = new Date(`${rental.pickup.date}T${rental.pickup.time}:00${rental.pickup.utcOffset || "+00:00"}`);
  const dropoff = new Date(`${rental.dropoff.date}T${rental.dropoff.time}:00${rental.dropoff.utcOffset || "+00:00"}`);
  const now = new Date();
  if (now < pickup) return { label: "距取车", target: pickup, complete: false };
  if (now < dropoff) return { label: "距还车", target: dropoff, complete: false };
  return { label: "已超过预约还车时间", target: dropoff, complete: true };
}

function renderRental() {
  const transport = state.data.groundTransport;
  const rental = transport.rentalCar;
  $("#rental-provider-label").textContent = rental.company;
  const status = rentalStatus(rental);
  const vehicle = rental.vehicle || {};
  $("#rental-card").innerHTML = `
    <article class="rental-panel">
      <div class="return-deadline">
        <span class="return-deadline__label">重要 · 还车截止时间</span>
        <strong>${escapeHtml(formatCompactDate(rental.dropoff.date))} <time>${escapeHtml(rental.dropoff.time)}</time> 前</strong>
        <span>${escapeHtml(rental.dropoff.timeZoneLabel)}</span>
        <p>${escapeHtml(rental.dropoff.vehicleReturnPoint)}</p>
        <div class="return-deadline__timer" id="return-deadline-timer"></div>
        <p class="return-deadline__warning">${escapeHtml(rental.dropoff.deadlineWarning)}</p>
        <small>建议 ${escapeHtml(rental.dropoff.recommendedArrivalTime)} 抵达机场区域，预留还车及值机时间。</small>
      </div>
      <div class="rental-countdown" id="rental-countdown">
        <span>${escapeHtml(status.label)}</span>
        <strong>${status.complete ? `请立即联系 ${escapeHtml(rental.company)}` : escapeHtml(countdownText(status.target))}</strong>
        <small>${formatCompactDate(rental.dropoff.date)} ${escapeHtml(rental.dropoff.time)} 前 · ${escapeHtml(rental.dropoff.vehicleReturnPoint)}</small>
      </div>
      <div class="rental-details">
        <div class="rental-car">${escapeHtml(rental.company)} · ${escapeHtml(vehicle.example)}</div>
        <div class="rental-sub">${escapeHtml(vehicle.class)} · ${rental.unlimitedKilometers ? "无限里程" : "里程条款见订单"}</div>
        <div class="rental-stops">
          <div class="rental-stop">
            <span class="rental-stop__label">PICK UP</span>
            <div><b>${formatCompactDate(rental.pickup.date)} ${escapeHtml(rental.pickup.time)}</b><span>${escapeHtml(rental.pickup.location)}<br>${escapeHtml(rental.pickup.address)}</span></div>
          </div>
          <div class="rental-stop">
            <span class="rental-stop__label">RETURN</span>
            <div><b>${formatCompactDate(rental.dropoff.date)} ${escapeHtml(rental.dropoff.time)}</b><span>${escapeHtml(rental.dropoff.vehicleReturnPoint)}<br>建议 ${escapeHtml(rental.dropoff.recommendedArrivalTime)} 抵达机场区域</span></div>
          </div>
        </div>
      </div>
    </article>
  `;
  const insurance = (rental.insurance || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const panels = {
    checklist: transport.rentalChecklist.map((rule) => `<li>${escapeHtml(rule)}</li>`).join(""),
    insurance,
    driving: `${(transport.drivingNotes || []).map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}${(transport.drivingReferenceLinks || []).map((link) => `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} ↗</a></li>`).join("")}`
  };
  const notes = $("#drive-notes");
  notes.innerHTML = `
    <div class="drive-note-tabs" role="group" aria-label="自驾注意事项">
      <button type="button" aria-expanded="true" aria-controls="drive-note-content" data-drive-note="checklist">取还车检查</button>
      <button type="button" aria-expanded="false" aria-controls="drive-note-content" data-drive-note="insurance">订单保障</button>
      <button type="button" aria-expanded="false" aria-controls="drive-note-content" data-drive-note="driving">驾驶提醒</button>
    </div>
    <div class="drive-note-panel" id="drive-note-content"><ul>${panels.checklist}</ul></div>`;
  notes.onclick = (event) => {
    const button = event.target.closest("button[data-drive-note]");
    if (!button) return;
    const collapse = button.getAttribute("aria-expanded") === "true";
    $$("button[data-drive-note]", notes).forEach((item) => item.setAttribute("aria-expanded", String(item === button && !collapse)));
    const panel = $(".drive-note-panel", notes);
    panel.hidden = collapse;
    if (!collapse) panel.innerHTML = `<ul>${panels[button.dataset.driveNote]}</ul>`;
  };
}

function updateRentalCountdown() {
  const dropoff = state.data.groundTransport.rentalCar.dropoff;
  const deadline = new Date(`${dropoff.date}T${dropoff.time}:00${dropoff.utcOffset}`);
  const remaining = deadline.getTime() - Date.now();
  $("#return-deadline-timer").textContent = remaining > 0
    ? `距还车截止 ${preciseCountdownText(deadline)}`
    : "预约还车时间已过 · 如尚未还车，请立即联系租车公司";
  $(".return-deadline").classList.toggle("is-urgent", remaining <= 86400000);
  const panel = $("#rental-countdown");
  if (!panel) return;
  const status = rentalStatus(state.data.groundTransport.rentalCar);
  $("span", panel).textContent = status.label;
  $("strong", panel).textContent = status.complete ? `请立即联系 ${state.data.groundTransport.rentalCar.company}` : countdownText(status.target);
}

function loadTodoState() { state.todos = []; }

function createRuntimeAdapters() {
  const storage = window.TravelRuntimeStorage;
  if (!storage?.createAdapter) throw new Error("runtime-storage.js is required");
  const persistence = state.config.persistence || { mode: "local" };
  const sharedCollections = new Set(Array.isArray(persistence.sharedCollections)
    ? persistence.sharedCollections
    : ["todos", "tickets", "ledger"]);
  const tripId = state.data.metadata.tripId;
  const enabledCollections = [
    ...(moduleEnabled("todo") ? ["todos"] : []),
    ...(moduleEnabled("itinerary") ? ["tickets"] : [])
  ];
  const localCollections = enabledCollections.filter((collection) => persistence.mode !== "d1" || !sharedCollections.has(collection));
  const d1Collections = enabledCollections.filter((collection) => persistence.mode === "d1" && sharedCollections.has(collection));
  const localAdapter = localCollections.length ? storage.createAdapter({ mode: "local", tripId, collections: localCollections }) : null;
  const d1Adapter = d1Collections.length ? storage.createAdapter({
    mode: "d1",
    tripId,
    apiBase: persistence.apiBase || "/api/trip",
    collections: d1Collections
  }) : null;
  state.runtimeAdapters = {};
  localCollections.forEach((collection) => { state.runtimeAdapters[collection] = localAdapter; });
  d1Collections.forEach((collection) => { state.runtimeAdapters[collection] = d1Adapter; });
}

async function loadSharedState() {
  const adapters = [...new Set(Object.values(state.runtimeAdapters).filter(Boolean))];
  const todoAdapter = state.runtimeAdapters.todos;
  const snapshots = await Promise.all(adapters.map(async (adapter) => [adapter, await adapter.load()]));
  const snapshotFor = (collection) => snapshots.find(([adapter]) => adapter === state.runtimeAdapters[collection])?.[1] || {};
  const todoSnapshot = snapshotFor("todos");
  const ticketSnapshot = snapshotFor("tickets");
  state.todos = Array.isArray(todoSnapshot.todos) ? todoSnapshot.todos : [];
  state.purchasedTickets = new Set((Array.isArray(ticketSnapshot.tickets) ? ticketSnapshot.tickets : []).filter((item) => item.completed).map((item) => item.id));
  const authoredTodos = state.data.preTrip?.todoItems || state.data.preTrip?.packingItems || [];
  const seedVersion = state.data.metadata?.dataVersion || "initial";
  const seedKey = `travel-plan:todo-seed:${state.data.metadata.tripId}:${seedVersion}`;
  let shouldSeed = todoAdapter?.mode === "local" && authoredTodos.length > 0;
  try { shouldSeed &&= localStorage.getItem(seedKey) !== "complete"; } catch {}
  if (shouldSeed) {
    const existingIds = new Set(state.todos.map((todo) => todo.id));
    const additions = authoredTodos.map((item, index) => ({
      id: String(item.id || `todo-initial-${index + 1}`),
      text: String(item.text || item.title || "").trim(),
      completed: Boolean(item.completed)
    })).filter((item) => item.text && !existingIds.has(item.id));
    state.todos.push(...additions);
    await Promise.all(additions.map((todo) => todoAdapter.applyChange("todos", todo, "upsert")));
    try { localStorage.setItem(seedKey, "complete"); } catch {}
  }
}

async function saveSharedChange(collection, value, op = "upsert") {
  const adapter = state.runtimeAdapters[collection];
  if (!adapter) return null;
  return adapter.applyChange(collection, value, op);
}

function saveTodoState() { return Promise.all(state.todos.map((todo) => saveSharedChange("todos", todo))); }

function renderTodoList() {
  const completed = state.todos.filter((todo) => todo.completed).length;
  $("#todo-progress").textContent = `${completed} / ${state.todos.length}`;
  $("#todo-list").innerHTML = state.todos.length ? state.todos.map((todo) => `
    <div class="todo-item${todo.completed ? " is-complete" : ""}" data-todo-id="${escapeHtml(todo.id)}">
      <label>
        <input type="checkbox" ${todo.completed ? "checked" : ""} aria-label="完成：${escapeHtml(todo.text)}">
        <span class="todo-check" aria-hidden="true">✓</span>
        <span class="todo-text">${escapeHtml(todo.text)}</span>
      </label>
      <button type="button" class="todo-delete" aria-label="删除：${escapeHtml(todo.text)}">删除</button>
    </div>`).join("") : `<p class="todo-empty">还没有准备事项，添加第一项吧。</p>`;
}

function renderTravelPrep() {
  renderTodoList();
  $("#todo-form").onsubmit = (event) => {
    event.preventDefault();
    const input = $("#todo-input");
    const text = input.value.trim();
    if (!text) return;
    state.todos.push({ id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, completed: false });
    input.value = "";
    saveSharedChange("todos", state.todos.at(-1)).catch(console.error);
    renderTodoList();
  };
  $("#todo-list").onchange = (event) => {
    const item = event.target.closest("[data-todo-id]");
    if (!item || !event.target.matches("input[type='checkbox']")) return;
    const todo = state.todos.find((entry) => entry.id === item.dataset.todoId);
    todo.completed = event.target.checked;
    saveSharedChange("todos", todo).catch(console.error);
    renderTodoList();
  };
  $("#todo-list").onclick = (event) => {
    const button = event.target.closest(".todo-delete");
    if (!button) return;
    const item = button.closest("[data-todo-id]");
    state.todos = state.todos.filter((todo) => todo.id !== item.dataset.todoId);
    saveSharedChange("todos", { id: item.dataset.todoId }, "delete").catch(console.error);
    renderTodoList();
  };
}

function safeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function localAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return "";
  try {
    const url = new URL(raw, location.href);
    return url.origin === location.origin ? url.href : "";
  } catch {
    return "";
  }
}

let ticketDialogOpener = null;

function openTicketDialog(ticketId, opener) {
  const ticket = state.data.ticketPlanning?.items?.find((item) => item.id === ticketId);
  const dialog = $("#ticket-dialog");
  if (!ticket || !dialog) return;
  ticketDialogOpener = opener || null;
  $("#ticket-dialog-title").textContent = ticketTitle(ticket);
  const document = ticketDocument(ticket);
  const localDocument = localAssetUrl(document?.url);
  const externalDocument = !localDocument ? safeExternalUrl(document?.url) : "";
  const officialUrl = safeExternalUrl(ticket.officialUrl || ticket.booking?.officialUrl || ticket.booking?.purchaseUrl);
  const extension = localDocument.split(/[?#]/)[0].split(".").at(-1)?.toLocaleLowerCase();
  let preview = "";
  if (localDocument && ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension)) {
    preview = `<img class="ticket-dialog__preview" src="${escapeHtml(localDocument)}" alt="${escapeHtml(ticketTitle(ticket))}">`;
  } else if (localDocument) {
    preview = `<iframe class="ticket-dialog__preview" src="${escapeHtml(localDocument)}" title="${escapeHtml(ticketTitle(ticket))}" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe>`;
  }
  const links = [
    localDocument ? `<a href="${escapeHtml(localDocument)}" target="_blank" rel="noopener noreferrer">在新窗口打开票据 ↗</a>` : "",
    externalDocument ? `<a href="${escapeHtml(externalDocument)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document?.label || "查看票据")} ↗</a>` : "",
    officialUrl ? `<a href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer">打开官方页面 ↗</a>` : ""
  ].filter(Boolean).join("");
  $("#ticket-dialog-body").innerHTML = `
    <p class="ticket-dialog__status">${escapeHtml(isTicketPurchased(ticket) ? "已标记购票" : ticketRequirement(ticket))}</p>
    ${ticketGuidance(ticket) ? `<p class="ticket-dialog__guidance">${escapeHtml(ticketGuidance(ticket))}</p>` : ""}
    ${preview || (!links ? `<p class="ticket-dialog__empty">当前没有可预览的票据文件或官方链接。</p>` : "")}
    ${links ? `<div class="ticket-dialog__links">${links}</div>` : ""}`;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  $("#ticket-dialog-close").focus();
}

function setupTicketDialog() {
  const dialog = $("#ticket-dialog");
  if (!dialog) return;
  const close = () => {
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  };
  $("#ticket-dialog-close").onclick = close;
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("close", () => {
    const body = $("#ticket-dialog-body");
    if (!body.querySelector(".ticket-dialog__preview--pdf")) body.replaceChildren();
    ticketDialogOpener?.focus({ preventScroll: true });
    ticketDialogOpener = null;
  });
}

function startCountdowns() {
  if (moduleEnabled("flights")) updateFlightCountdowns();
  if (moduleEnabled("driving")) updateRentalCountdown();
  if (!moduleEnabled("flights") && !moduleEnabled("driving")) return;
  state.countdownTimer = window.setInterval(() => {
    if (moduleEnabled("flights")) updateFlightCountdowns();
    if (moduleEnabled("driving")) updateRentalCountdown();
  }, 1000);
}

function preloadDefaultRouteMap() {
  const routeMap = state.data?.routeMap;
  const source = travelMapSource(routeMap, routeMap?.defaultRegionId);
  if (!source?.baseImage) return;
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "high";
  image.src = source.baseImage;
  state.routeMapPreload = image;
}

async function init() {
  if (window.location.protocol === "file:") {
    const error = $("#loading-error");
    error.querySelector("strong").textContent = "请使用本地预览打开";
    const detail = error.querySelector("span");
    detail.textContent = "直接打开 HTML 文件无法读取行程。请在项目目录运行 npm run preview，然后打开 ";
    const link = document.createElement("a");
    link.href = `http://127.0.0.1:4173/${window.location.hash || "#top"}`;
    link.textContent = "本地预览页面";
    detail.append(link);
    error.hidden = false;
    return;
  }
  try {
    const dataUrl = new URL("/trip-data.json", window.location.origin);
    const response = await fetch(dataUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    state.config = normalizeTripConfig(state.data.config);
    window.TRAVEL_PLAN_CONFIG = state.config;
    window.TRAVEL_PLAN_DATA = state.data;
    document.dispatchEvent(new CustomEvent("travel-data-ready", { detail: state.data }));
    applyModuleConfig();
    if (moduleEnabled("overview")) preloadDefaultRouteMap();
    renderHero();
    if (moduleEnabled("flights")) renderFlights();
    if (moduleEnabled("overview")) setupRouteExplorer();
    if (moduleEnabled("itinerary")) {
      setupTicketDialog();
    }
    if (moduleEnabled("todo") || moduleEnabled("itinerary")) {
      createRuntimeAdapters();
      try {
        await loadSharedState();
      } catch (error) {
        console.error(`${state.config.persistence.mode === "d1" ? "Shared" : "Local"} runtime data could not be loaded`, error);
        state.todos = [];
        state.purchasedTickets = new Set();
      }
    }
    if (moduleEnabled("itinerary")) {
      renderTimeline();
      window.TravelWeather?.load(state.data);
    }
    if (moduleEnabled("driving")) renderRental();
    if (moduleEnabled("todo")) renderTravelPrep();
    if (moduleEnabled("ledger")) {
      try {
        await window.TravelWallet?.init?.({ data: state.data, config: state.config });
      } catch (error) {
        console.error("Public wallet could not be loaded", error);
        $("#wallet-root").textContent = "公共钱包暂时无法载入，请刷新页面重试。";
      }
      try {
        await window.TravelLedger?.init?.({ tripId: state.data.metadata.tripId, config: state.config });
      } catch (error) {
        console.error("Pre-trip ledger could not be loaded", error);
        $("#ledger-root").textContent = "行前费用暂时无法载入，请刷新页面重试。";
        $("#ledger-root").removeAttribute("aria-busy");
      }
    }
    startCountdowns();
  } catch (error) {
    console.error("Travel data could not be loaded", error);
    $("#loading-error").hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", init);
