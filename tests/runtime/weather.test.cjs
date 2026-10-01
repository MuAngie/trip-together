const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (name) => fs.readFileSync(path.join(__dirname, "../../dist", name), "utf8");
const trip = JSON.parse(source("trip-data.json"));

function harness(fetch) {
  let now = Date.parse("2026-10-01T12:00:00+08:00");
  const events = new Map();
  const badges = new Map(trip.days.map((day) => [day.date, { textContent: "", hidden: true, title: "" }]));
  const nextBadge = { textContent: "", hidden: true, title: "", dataset: {} };
  const context = vm.createContext({
    fetch,
    Date: class extends Date { static now() { return now; } },
    URLSearchParams,
    document: {
      visibilityState: "visible",
      addEventListener(type, callback) { events.set(type, callback); },
      querySelector(selector) {
        if (selector === "#next-weather") return nextBadge;
        const date = selector.match(/data-weather-date="([^"]+)"/)?.[1];
        return badges.get(date) || null;
      }
    },
    window: {}
  });
  vm.runInContext(source("weather.js"), context);
  return {
    badges,
    nextBadge,
    load: () => context.window.TravelWeather.load(trip),
    showNext: (date) => context.window.TravelWeather.showNext(date),
    resume(time) { now = Date.parse(time); events.get("visibilitychange")(); }
  };
}

test("daily forecast shows the main city, local temperature range, and weather without sea-day badges", async () => {
  const requests = [];
  const byCity = {
    "上海": ["2026-10-04"],
    "京都": ["2026-10-07", "2026-10-08", "2026-10-09"],
    "神户": ["2026-10-10"],
    "大阪": ["2026-10-11", "2026-10-12", "2026-10-13"]
  };
  const places = {
    "上海": trip.places.find((place) => place.id === "wusong-cruise-terminal"),
    "京都": trip.places.find((place) => place.id === "kyoto"),
    "神户": trip.places.find((place) => place.id === "kobe-sanda-outlets"),
    "大阪": trip.places.find((place) => place.id === "osaka")
  };
  const h = harness(async (url) => {
    const parsed = new URL(url);
    const city = Object.keys(places).find((name) => String(places[name].geo.lat) === parsed.searchParams.get("latitude"));
    assert.ok(city);
    requests.push({ city, parsed });
    return { ok: true, json: async () => ({ daily: {
      time: byCity[city],
      weather_code: byCity[city].map(() => city === "京都" ? 61 : 1),
      temperature_2m_min: byCity[city].map(() => 14.2),
      temperature_2m_max: byCity[city].map(() => 22.6)
    } }) };
  });
  await h.load();
  assert.equal(requests.length, 4, "one request per city");
  for (const { city, parsed } of requests) {
    assert.equal(parsed.hostname, "api.open-meteo.com");
    assert.equal(parsed.searchParams.get("longitude"), String(places[city].geo.lng));
    assert.equal(parsed.searchParams.get("timezone"), city === "上海" ? "Asia/Shanghai" : "Asia/Tokyo");
    assert.equal(parsed.searchParams.get("forecast_days"), "16");
  }
  assert.match(h.badges.get("2026-10-04").textContent, /上海.*多云.*14–23℃/);
  assert.match(h.badges.get("2026-10-08").textContent, /京都.*雨.*14–23℃/);
  assert.match(h.badges.get("2026-10-10").textContent, /神户.*多云.*14–23℃/);
  assert.match(h.badges.get("2026-10-13").textContent, /大阪.*多云.*14–23℃/);
  assert.equal(h.badges.get("2026-10-05").hidden, true);
  assert.equal(h.badges.get("2026-10-06").hidden, true);
  assert.match(h.badges.get("2026-10-07").title, /Open-Meteo/);
});

test("dates outside forecast range and network failures show distinct honest states", async () => {
  const limited = harness(async () => ({ ok: true, json: async () => ({ daily: { time: [], weather_code: [], temperature_2m_min: [], temperature_2m_max: [] } }) }));
  await limited.load();
  assert.equal(limited.badges.get("2026-10-13").textContent, "大阪 · 暂无预报");
  const failed = harness(async () => { throw new Error("offline"); });
  await failed.load();
  assert.equal(failed.badges.get("2026-10-04").textContent, "上海 · 天气暂不可用");
  assert.equal(failed.badges.get("2026-10-05").hidden, true);
});

test("next item reuses its itinerary date's weather and hides on sea days", async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ daily: {
    time: ["2026-10-04", "2026-10-08"],
    weather_code: [1, 61],
    temperature_2m_min: [14, 16],
    temperature_2m_max: [22, 24]
  } }) }));
  h.showNext("2026-10-08");
  assert.equal(h.nextBadge.hidden, true, "forecast has not loaded yet");
  await h.load();
  assert.equal(h.nextBadge.textContent, h.badges.get("2026-10-08").textContent);
  assert.equal(h.nextBadge.title, h.badges.get("2026-10-08").title);
  assert.equal(h.nextBadge.hidden, false);
  h.showNext("2026-10-04");
  assert.equal(h.nextBadge.textContent, h.badges.get("2026-10-04").textContent);
  h.showNext("2026-10-05");
  assert.equal(h.nextBadge.hidden, true);
  assert.equal(h.nextBadge.textContent, "");
});

test("returning to the page refreshes old forecasts without polling", async () => {
  let requests = 0;
  const h = harness(async () => {
    requests++;
    return { ok: true, json: async () => ({ daily: { time: [], weather_code: [], temperature_2m_min: [], temperature_2m_max: [] } }) };
  });
  await h.load();
  assert.equal(requests, 4);
  h.resume("2026-10-01T14:00:00+08:00");
  assert.equal(requests, 4);
  h.resume("2026-10-01T16:00:00+08:00");
  assert.equal(requests, 8);
});

test("weather is loaded after itinerary rendering and has a visible source credit", () => {
  assert.match(source("app.js"), /renderTimeline\(\);\s*window\.TravelWeather\?\.load\(state\.data\)/);
  assert.match(source("app.js"), /class="day-weather" data-weather-date="\$\{escapeHtml\(day\.date\)\}" hidden/);
  assert.match(source("index.html"), /天气数据：Open-Meteo/);
  assert.match(source("index.html"), /id="next-weather" hidden/);
  assert.match(source("extensions.js"), /TravelWeather\?\.showNext\(item\.date\)/);
});
