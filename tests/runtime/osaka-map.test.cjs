const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("both Osaka dates initialize all optional places without a fixed route and survive day switching", () => {
  const trip = JSON.parse(fs.readFileSync(path.join(__dirname, "../../dist/trip-data.json"), "utf8"));
  const frames = [];
  const maps = [];
  const nodes = new Map([["#day-count", {}]]);
  const days = trip.days.filter((day) => ["2026-10-11", "2026-10-12"].includes(day.date));
  const buttons = days.map((day) => ({
    expanded: day.day === 8,
    getAttribute() { return String(this.expanded); },
    setAttribute(_name, value) { this.expanded = value === "true"; },
    closest() { return { dataset: { day: String(day.day) } }; },
    getBoundingClientRect() { return { top: 100 }; }
  }));
  const details = days.map((day) => {
    const detail = { hidden: day.day !== 8 };
    nodes.set(`#day-detail-${day.day}`, detail);
    nodes.set(`#day-map-${day.date}`, { closest: () => detail });
    return detail;
  });
  const timeline = {
    innerHTML: "",
    querySelectorAll: (selector) => selector === ".day-toggle" ? buttons : details
  };
  nodes.set("#timeline", timeline);
  const context = vm.createContext({
    trip,
    document: { querySelector: (selector) => nodes.get(selector), addEventListener() {} },
    requestAnimationFrame: (callback) => frames.push(callback),
    window: { L: {
      map(canvas) {
        const map = {
          canvas, markers: [], removed: false, invalidations: 0,
          fitBounds(points) { this.points = points; return this; },
          getContainer() { return canvas; },
          remove() { this.removed = true; },
          invalidateSize() { this.invalidations++; }
        };
        maps.push(map);
        return map;
      },
      tileLayer: () => ({ addTo() {} }),
      polyline() { assert.fail("free-form Osaka maps must not draw route lines"); },
      divIcon: (options) => options,
      marker(point, options) {
        return {
          bindPopup(popup) { this.popup = popup; return this; },
          addTo(map) { map.markers.push({ point, options, popup: this.popup }); }
        };
      }
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../dist/app.js"), "utf8"), context);
  vm.runInContext("state.data = trip; currentTripDay = () => 8; renderTimeline();", context);
  const flush = () => { while (frames.length) frames.shift()(); };
  const click = (button) => {
    timeline.onclick({ target: { closest: (selector) => selector === ".day-toggle" ? button : null } });
    flush();
  };
  flush();
  assert.match(timeline.innerHTML, /id="day-map-2026-10-11"/);
  assert.match(timeline.innerHTML, /id="day-map-2026-10-12"/);
  click(buttons[1]);
  assert.equal(maps[0].removed, true);
  for (const [index, map] of maps.entries()) {
    assert.equal(map.canvas, nodes.get(`#day-map-${days[index].date}`));
    assert.equal(map.points.length, 16);
    assert.equal(map.markers.length, 16);
    const hotels = map.markers.filter((marker) => marker.options.icon.className.includes("daily-map__marker--hotel"));
    assert.equal(hotels.length, 1);
    assert.match(hotels[0].popup, /大阪东急卓越酒店/);
    assert.deepEqual(Array.from(hotels[0].point), [34.6805454, 135.5001614]);
    assert.equal(map.markers.filter((marker) => marker.options.icon.html === "<span>游</span>").length, 6);
    assert.equal(map.markers.filter((marker) => marker.options.icon.html === "<span>购</span>").length, 9);
    assert.ok(map.points.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 34.66 && lat < 34.71 && lng > 135.49 && lng < 135.54));
  }
  click(buttons[1]);
  click(buttons[1]);
  assert.equal(maps.length, 2);
  assert.equal(maps[1].invalidations, 1);
  click(buttons[0]);
  assert.equal(maps[1].removed, true);
  assert.equal(maps[2].markers.length, 16);
});
