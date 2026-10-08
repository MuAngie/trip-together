const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const trip = JSON.parse(fs.readFileSync(path.join(__dirname, "../../dist/trip-data.json"), "utf8"));
const source = fs.readFileSync(path.join(__dirname, "../../dist/app.js"), "utf8");

function harness(time) {
  let now = Date.parse(time);
  const events = new Map();
  const frames = [];
  const dots = [];
  const counter = {};
  const carousel = {
    clientWidth: 320, scrollLeft: 0, cards: [], scrolls: 0,
    set innerHTML(markup) {
      this.cards = [...markup.matchAll(/data-id="([^"]+)"/g)].map((match, index) => ({
        id: match[1], offsetLeft: index * 314, offsetWidth: 300,
        getBoundingClientRect: () => ({ left: index * 314 - carousel.scrollLeft })
      }));
    },
    querySelectorAll() { return this.cards; },
    getBoundingClientRect() { return { left: 0 }; },
    addEventListener(type, callback) { events.set(type, callback); },
    scrollTo({ left }) { this.scrollLeft = left; this.scrolls++; }
  };
  const dotHost = {
    set innerHTML(markup) {
      dots.push(...[...markup.matchAll(/<span/g)].map(() => ({ classList: { toggle() {} } })));
    },
    querySelectorAll() { return dots; }
  };
  const nodes = new Map([["#flight-carousel", carousel], ["#flight-dots", dotHost], ["#flight-index", counter]]);
  const document = {
    visibilityState: "visible",
    querySelector: (selector) => nodes.get(selector),
    addEventListener(type, callback) { events.set(type, callback); }
  };
  const context = vm.createContext({
    document,
    window: { addEventListener(type, callback) { events.set(type, callback); } },
    requestAnimationFrame: (callback) => frames.push(callback),
    Date: class extends Date { static now() { return now; } }
  });
  vm.runInContext(source, context);
  context.trip = trip;
  vm.runInContext(`
    state.data = trip;
    flightCard = carTransferCard = transitPassCard = hotelStayCard = diningCard =
      (item) => '<article data-id="' + item.id + '"></article>';
    const chooseCard = currentTravelCardIndex;
    currentTravelCardIndex = (cards, time) => {
      globalThis.renderedCards = cards;
      return chooseCard(cards, time);
    };
    renderFlights();
  `, context);
  function flush() { while (frames.length) frames.shift()(); }
  flush();
  return {
    context, carousel, counter, document, flush,
    setTime(time) { now = Date.parse(time); },
    fire(type, detail) { events.get(type)({ detail }); flush(); },
    currentId() { return carousel.cards[Number(counter.textContent.split(" / ")[0]) - 1].id; }
  };
}

test("travel carousel uses local time without changing the existing card order", () => {
  const h = harness("2026-10-08T10:00:00+09:00");
  const order = h.carousel.cards.map((card) => card.id);
  assert.equal(h.currentId(), "kyoto-sightseeing-car");
  for (const [time, expected] of [
    ["2026-10-01T10:00:00+09:00", "kyoto-stay"],
    ["2026-10-07T17:29:00+09:00", "kyoto-stay"],
    ["2026-10-07T17:30:00+09:00", "restaurant-kanegura"],
    ["2026-10-08T18:30:00+09:00", "restaurant-honke-1008"],
    ["2026-10-09T00:10:00+09:00", "restaurant-fujimura"],
    ["2026-10-10T14:00:00+09:00", "kyoto-kobe-osaka-car"],
    ["2026-10-10T18:00:00+09:00", "restaurant-wakko-shinkobe"],
    ["2026-10-11T14:00:00+09:00", "osaka-metro-day-pass"],
    ["2026-10-11T18:00:00+09:00", "restaurant-osaka-manpukudo"],
    ["2026-10-13T13:00:00+09:00", "osaka-hotel-kix-car"],
    ["2026-10-13T16:45:00+09:00", "return-flight"],
    ["2026-10-14T10:00:00+09:00", "return-flight"]
  ]) {
    h.setTime(time);
    h.fire("pageshow");
    assert.equal(h.currentId(), expected, time);
    assert.deepEqual(h.carousel.cards.map((card) => card.id), order);
  }
});

test("manual browsing stays in place until returning to or reopening the section", () => {
  const h = harness("2026-10-08T10:00:00+09:00");
  h.carousel.scrollLeft = 0;
  h.setTime("2026-10-08T18:30:00+09:00");
  h.fire("scroll");
  assert.equal(h.currentId(), "kyoto-stay");
  h.document.visibilityState = "hidden";
  h.fire("visibilitychange");
  assert.equal(h.currentId(), "kyoto-stay");
  h.document.visibilityState = "visible";
  h.fire("visibilitychange");
  assert.equal(h.currentId(), "restaurant-honke-1008");
  h.carousel.clientWidth = 0;
  h.setTime("2026-10-11T10:00:00+09:00");
  const scrolls = h.carousel.scrolls;
  h.fire("pageshow");
  assert.equal(h.carousel.scrolls, scrolls);
  h.carousel.clientWidth = 320;
  h.fire("travel-section-open", "itinerary");
  assert.equal(h.carousel.scrolls, scrolls);
  h.fire("travel-section-open", "flights");
  assert.equal(h.currentId(), "osaka-metro-day-pass");
});
