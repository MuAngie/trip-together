const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const trip = JSON.parse(fs.readFileSync(path.join(__dirname, "../../dist/trip-data.json"), "utf8"));
const source = fs.readFileSync(path.join(__dirname, "../../dist/extensions.js"), "utf8")
  .replace("  function renderReminders(data) {", "  globalThis.nextItems = nextItems; globalThis.currentNextIndex = currentNextIndex;\n  function renderReminders(data) {");

function harness(time) {
  let now = Date.parse(time);
  const storage = new Map();
  const events = new Map();
  const timers = new Map();
  let timerId = 0;
  const date = {};
  const host = {
    markup: "", writes: 0, buttons: new Map(),
    set innerHTML(value) {
      this.markup = value;
      this.writes++;
      this.buttons.clear();
      for (const match of value.matchAll(/id="(next-[^"]+)"/g)) {
        this.buttons.set(`#${match[1]}`, { addEventListener(_type, callback) { this.click = callback; } });
      }
    },
    querySelector(selector) { return this.buttons.get(selector); }
  };
  const nodes = new Map([["#next-action", host], ["#next-date", date], ["#reminder-list", {}], ["#booking-list", {}]]);
  const document = {
    visibilityState: "visible",
    querySelector(selector) { return nodes.get(selector); },
    addEventListener(type, callback) { events.set(type, callback); }
  };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    document,
    console,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    window: {
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, due: now + delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(type, callback) { events.set(type, callback); }
    }
  });
  vm.runInContext(source, context);
  const items = context.nextItems(trip);
  return {
    context, items, storage, timers, host, date, document,
    setTime(time) { now = Date.parse(time); },
    currentId(time) { return items[context.currentNextIndex(items, Date.parse(time))].id; },
    start() { events.get("travel-data-ready")({ detail: trip }); },
    tick() {
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) { timers.delete(id); timer.callback(); }
      }
    },
    visibility() { events.get("visibilitychange")(); },
    show() { events.get("pageshow")(); },
    click(id) { const button = host.buttons.get(`#${id}`); assert.ok(button, `missing button ${id}`); button.click(); }
  };
}

test("clock selects itinerary starts in each day's local timezone", () => {
  const h = harness("2026-09-28T12:00:00+08:00");
  const cases = [
    ["2026-10-03T23:59:00+08:00", "cruise-board"],
    ["2026-10-04T12:00:00+08:00", "cruise-board"],
    ["2026-10-05T00:00:00+08:00", "cruise-at-sea"],
    ["2026-10-06T14:00:00+08:00", "cruise-at-sea"],
    ["2026-10-07T05:30:00+09:00", "cruise-arrive"],
    ["2026-10-07T07:29:59+09:00", "cruise-arrive"],
    ["2026-10-07T07:30:00+09:00", "taxi-to-shinagawa"],
    ["2026-10-07T17:30:00+09:00", "dinner-kanegura"],
    ["2026-10-08T08:30:00+09:00", "kyoto-sightseeing-car"],
    ["2026-10-08T09:00:00+09:00", "visit-kinkakuji"],
    ["2026-10-08T11:00:00+09:00", "kinkakuji-to-arashiyama"],
    ["2026-10-08T12:30:00+09:00", "arashiyama-lunch"],
    ["2026-10-08T16:00:00+09:00", "arashiyama-return-car"],
    ["2026-10-08T18:30:00+09:00", "dinner-honke-1008"],
    ["2026-10-09T09:00:00+09:00", "kyoto-hotel-to-inari-1009"],
    ["2026-10-09T11:00:00+09:00", "taxi-inari-to-kiyomizu-1009"],
    ["2026-10-09T18:30:00+09:00", "kyoto-dinner-1009"],
    ["2026-10-10T17:30:00+09:00", "dinner-wakko-shinkobe"]
  ];
  for (const [time, id] of cases) assert.equal(h.currentId(time), id, time);
});

test("Osaka keeps one daytime item and switches to the booked dinner at 18:00", () => {
  const h = harness("2026-10-11T10:00:00+09:00");
  assert.equal(h.items.filter((item) => ["2026-10-05", "2026-10-06"].includes(item.date)).length, 1);
  assert.equal(h.items.find((item) => item.id === "cruise-at-sea").dateLabel, "10月5–6日");
  assert.ok(h.items.every((item) => item.type !== "breakfast-options"), "breakfast suggestions stay in the daily itinerary");
  for (const date of ["2026-10-11", "2026-10-12"]) {
    const items = h.items.filter((item) => item.date === date);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, "大阪购物／游览");
    assert.equal(h.currentId(`${date}T12:00:00+09:00`), `osaka-free-${date}`);
    assert.equal(h.currentId(`${date}T17:59:59+09:00`), `osaka-free-${date}`);
    assert.equal(h.currentId(`${date}T18:00:00+09:00`), items[1].id);
  }
  assert.equal(h.currentId("2026-10-11T23:59:59+09:00"), "dinner-osaka-manpukudo");
  assert.equal(h.currentId("2026-10-12T00:00:00+09:00"), "osaka-free-2026-10-12");
});

test("return flight uses Japan departure time and Shanghai arrival time", () => {
  const h = harness("2026-10-13T12:00:00+09:00");
  assert.equal(h.currentId("2026-10-13T16:45:00+09:00"), "flight-depart");
  assert.equal(h.currentId("2026-10-13T18:30:00+09:00"), "flight-depart");
  assert.equal(h.currentId("2026-10-13T18:29:59+08:00"), "flight-depart");
  assert.equal(h.currentId("2026-10-13T18:30:00+08:00"), "flight-arrive");
});

test("relative times and visit end times are not treated as starts; completing advances in order", () => {
  const h = harness("2026-10-09T09:30:00+09:00");
  for (const id of ["visit-fushimi-inari-1009", "visit-kiyomizu-dera", "visit-heian-shrine"]) {
    assert.equal(h.items.find((item) => item.id === id).triggerAt, null);
  }
  h.start();
  assert.match(h.host.markup, /地铁＋JR 去伏见稻荷/);
  h.click("next-complete");
  assert.match(h.host.markup, /伏见稻荷大社/);
  h.click("next-skip");
  assert.match(h.host.markup, /<h3>打车<\/h3>/);
  assert.match(h.host.markup, /30—45分钟/);
});

test("clock sleeps until the next itinerary time and pauses while the page is hidden", () => {
  const h = harness("2026-10-08T18:00:00+09:00");
  h.start();
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 30 * 60 * 1000);
  assert.match(h.host.markup, /包车返城/);
  const writes = h.host.writes;
  h.setTime("2026-10-08T18:29:59+09:00");
  h.tick();
  assert.equal(h.host.writes, writes);
  h.setTime("2026-10-08T18:30:00+09:00");
  h.tick();
  assert.match(h.host.markup, /天婦羅処京林泉/);
  assert.equal([...h.timers.values()][0].delay, 5.5 * 60 * 60 * 1000);
  h.document.visibilityState = "hidden";
  h.visibility();
  assert.equal(h.timers.size, 0);
  h.setTime("2026-10-09T11:00:00+09:00");
  h.tick();
  assert.match(h.host.markup, /天婦羅処京林泉/);
  h.document.visibilityState = "visible";
  h.visibility();
  assert.match(h.host.markup, /<h3>打车<\/h3>/);
  assert.equal([...h.timers.values()][0].delay, 30 * 60 * 1000);
  h.start();
  assert.equal(h.timers.size, 1, "reloading trip data replaces its timer");
});

test("restoring a cached page catches up immediately without duplicate timers", () => {
  const h = harness("2026-10-07T07:00:00+09:00");
  h.start();
  h.setTime("2026-10-08T19:30:00+09:00");
  h.show();
  assert.match(h.host.markup, /天婦羅処京林泉/);
  assert.equal(h.timers.size, 1);
});

test("Osaka timers wait for dinner and then the next date transition", () => {
  const h = harness("2026-10-11T12:00:00+09:00");
  h.start();
  assert.equal([...h.timers.values()][0].delay, 6 * 60 * 60 * 1000);
  h.setTime("2026-10-11T18:00:00+09:00");
  h.tick();
  assert.match(h.host.markup, /大阪まんぷく堂/);
  assert.equal([...h.timers.values()][0].delay, 6 * 60 * 60 * 1000);
  h.setTime("2026-10-12T00:00:00+09:00");
  h.tick();
  assert.equal(h.date.textContent, "10月12日");
  assert.match(h.host.markup, /大阪购物／游览/);
  assert.equal([...h.timers.values()][0].delay, 18 * 60 * 60 * 1000);
});

test("manual browsing stays put through a clock change and can return to the current item", () => {
  const h = harness("2026-10-07T07:00:00+09:00");
  h.start();
  h.click("next-forward");
  assert.match(h.host.markup, /品川/);
  h.click("next-previous");
  assert.match(h.host.markup, /荣耀号抵达东京码头/);
  h.setTime("2026-10-07T07:30:00+09:00");
  h.tick();
  assert.match(h.host.markup, /荣耀号抵达东京码头/);
  assert.match(h.host.markup, /回到当前/);
  h.click("next-current");
  assert.match(h.host.markup, /品川/);
  assert.doesNotMatch(h.host.markup, /回到当前/);
  assert.equal(h.storage.size, 0, "browsing and clock changes do not alter completion or skip state");
});

test("completion and skipping persist locally and skipped items remain available to review", () => {
  const h = harness("2026-10-07T06:00:00+09:00");
  h.start();
  h.click("next-complete");
  assert.match(h.host.markup, /品川/);
  h.click("next-skip");
  assert.match(h.host.markup, /新干线/);
  h.click("next-previous");
  assert.match(h.host.markup, /此事项已跳过/);
  assert.ok(!h.host.buttons.has("#next-skip"));
  const prefix = `travel-plan:next-status:${trip.metadata.tripId}:`;
  assert.equal(h.storage.get(`${prefix}cruise-arrive`), "complete");
  assert.equal(h.storage.get(`${prefix}taxi-to-shinagawa`), "skipped");
  h.click("next-current");
  assert.match(h.host.markup, /新干线/);
});

test("old trial cursors are ignored and unchanged timer ticks do not rebuild the card", () => {
  const h = harness("2026-10-08T19:00:00+09:00");
  h.storage.set(`travel-plan:next-cursor:${trip.metadata.tripId}`, "taxi-to-shinagawa");
  h.start();
  assert.match(h.host.markup, /天婦羅処京林泉/);
  const writes = h.host.writes;
  h.tick();
  h.tick();
  assert.equal(h.host.writes, writes);
  assert.equal(h.storage.size, 1);
});

test("after the trip the final item stays available even when completed", () => {
  const h = harness("2026-10-14T12:00:00+08:00");
  h.start();
  assert.match(h.host.markup, /上海浦东/);
  h.click("next-complete");
  assert.match(h.host.markup, /已完成/);
  assert.ok(!h.host.buttons.has("#next-forward"));
  assert.equal(h.timers.size, 0, "no further clock checks after the trip ends");
});
