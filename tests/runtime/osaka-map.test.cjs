const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Kyoto maps mark dinner once and keep breakfast outside the sightseeing route", () => {
  const trip = JSON.parse(fs.readFileSync(path.join(__dirname, "../../dist/trip-data.json"), "utf8"));
  for (const day of trip.days.filter((day) => ["2026-10-07", "2026-10-08", "2026-10-09"].includes(day.date))) {
    const markers = [];
    let route;
    const canvas = { closest: () => ({ hidden: false }) };
    const context = vm.createContext({
      trip, day,
      document: { querySelector: () => canvas, addEventListener() {} },
      window: { L: {
        map: () => ({ fitBounds() { return this; } }),
        tileLayer: () => ({ addTo() {} }),
        polyline(points) { route = points; return { addTo() {} }; },
        divIcon: (options) => options,
        marker(point, options) {
          return { bindPopup(popup) { this.popup = popup; return this; }, addTo() { markers.push({ point, options, popup: this.popup }); } };
        }
      } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../dist/app.js"), "utf8"), context);
    vm.runInContext("state.data = trip; state.expandedDay = day.day; showSampleDayMap();", context);
    const breakfast = markers.filter((marker) => marker.options.icon.className.includes("daily-map__marker--breakfast"));
    assert.equal(breakfast.length, day.date === "2026-10-07" ? 0 : 6);
    if (day.date !== "2026-10-07") {
      const onimaru = trip.places.find((place) => place.id === "restaurant-onimaru-kyoto");
      const markers = breakfast.filter((marker) => marker.popup.includes(onimaru.nameZh));
      assert.equal(markers.length, 1);
      assert.deepEqual(Array.from(markers[0].point), [onimaru.geo.lat, onimaru.geo.lng]);
    }
    assert.equal(route.length, { "2026-10-07": 5, "2026-10-08": 10, "2026-10-09": 6 }[day.date]);
    const dinner = day.schedule.find((item) => item.type === "restaurant" && item.bookingId);
    const place = trip.places.find((place) => place.id === dinner.placeId);
    const dinnerMarkers = markers.filter((marker) => marker.options.icon.className.includes("daily-map__marker--dinner"));
    assert.equal(dinnerMarkers.length, 1);
    assert.equal(dinnerMarkers[0].options.icon.html, "<span>晚</span>");
    assert.ok(dinnerMarkers[0].popup.includes(place.nameZh));
    assert.ok(dinnerMarkers[0].popup.includes(dinner.time));
    assert.deepEqual(Array.from(dinnerMarkers[0].point), [place.geo.lat, place.geo.lng]);
    assert.equal(markers.filter((marker) => marker.point[0] === place.geo.lat && marker.point[1] === place.geo.lng).length, 1);
    for (const marker of breakfast) {
      assert.ok(route.every((point) => point[0] !== marker.point[0] || point[1] !== marker.point[1]));
    }
  }
});

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
  for (const day of days) {
    const dinner = day.schedule.find((item) => item.type === "restaurant");
    const booking = trip.bookingsAndTickets.find((item) => item.id === dinner.bookingId);
    const markup = vm.runInContext(`dayCard(trip.days.find(day => day.date === '${day.date}'), new Set())`, context);
    const breakfast = day.schedule.find((item) => item.type === "breakfast-options");
    const breakfastMarkup = markup.slice(markup.indexOf('<ol class="schedule">'), markup.indexOf('<details class="optional-place-group">'));
    assert.match(breakfastMarkup, /早餐可选/);
    assert.equal((breakfastMarkup.match(/class="schedule-map-link schedule-map-link--breakfast"/g) || []).length, 5);
    for (const id of breakfast.placeIds) {
      const place = trip.places.find((place) => place.id === id);
      assert.ok(breakfastMarkup.includes(place.addressJa));
      assert.ok(breakfastMarkup.includes(`<small>${place.breakfastMenu}</small>`));
    }
    assert.match(markup, /<ol class="schedule">\s*<li class="schedule-item">\s*<span class="schedule-time">18:00<\/span>/);
    assert.ok(markup.includes(dinner.text));
    assert.ok(markup.includes(booking.addressJa));
    assert.match(markup, /<summary class="schedule-text">预约详情<\/summary>/);
    assert.match(markup, /预约姓名：陈女士 · 登记电话：07042277782/);
    assert.ok(markup.includes(booking.restaurantPhone));
  }
  click(buttons[1]);
  assert.equal(maps[0].removed, true);
  for (const [index, map] of maps.entries()) {
    assert.equal(map.canvas, nodes.get(`#day-map-${days[index].date}`));
    assert.equal(map.points.length, 22);
    assert.equal(map.markers.length, 22);
    const hotels = map.markers.filter((marker) => marker.options.icon.className.includes("daily-map__marker--hotel"));
    assert.equal(hotels.length, 1);
    assert.match(hotels[0].popup, /大阪东急卓越酒店/);
    assert.deepEqual(Array.from(hotels[0].point), [34.6805454, 135.5001614]);
    assert.equal(map.markers.filter((marker) => marker.options.icon.html === "<span>游</span>").length, 6);
    assert.equal(map.markers.filter((marker) => marker.options.icon.html === "<span>购</span>").length, 9);
    const breakfasts = map.markers.filter((marker) => marker.options.icon.className.includes("daily-map__marker--breakfast"));
    assert.equal(breakfasts.length, 5);
    for (const marker of breakfasts) {
      assert.equal(marker.options.icon.html, "<span>早</span>");
      assert.match(marker.popup, /早餐可选/);
    }
    const dinner = days[index].schedule.find((item) => item.type === "restaurant");
    const place = trip.places.find((place) => place.id === dinner.placeId);
    const dinners = map.markers.filter((marker) => marker.options.icon.className.includes("daily-map__marker--dinner"));
    assert.equal(dinners.length, 1);
    assert.equal(dinners[0].options.icon.html, "<span>晚</span>");
    assert.ok(dinners[0].popup.includes(place.nameZh));
    assert.ok(dinners[0].popup.includes(dinner.time));
    assert.deepEqual(Array.from(dinners[0].point), [place.geo.lat, place.geo.lng]);
    assert.ok(map.points.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 34.66 && lat < 34.71 && lng > 135.49 && lng < 135.55));
  }
  click(buttons[1]);
  click(buttons[1]);
  assert.equal(maps.length, 2);
  assert.equal(maps[1].invalidations, 1);
  click(buttons[0]);
  assert.equal(maps[1].removed, true);
  assert.equal(maps[2].markers.length, 22);
});
