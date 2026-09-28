const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const browserAnchors of [false, true]) {
  test(`switching from a long itinerary keeps the clicked date in place (browser anchoring ${browserAnchors})`, () => {
    let scrollY = 3400;
    let previousHidden = false;
    const frames = [];
    const style = { scrollBehavior: "" };
    const previousDetail = {
      get hidden() { return previousHidden; },
      set hidden(value) {
        if (browserAnchors && value && !previousHidden) scrollY -= 3000;
        previousHidden = value;
      }
    };
    const nextDetail = { hidden: true };
    const button = (day, expanded) => ({
      expanded,
      getAttribute() { return String(this.expanded); },
      setAttribute(_name, value) { this.expanded = value === "true"; },
      closest() { return { dataset: { day: String(day) } }; },
      getBoundingClientRect() { return { top: 900 + (previousHidden ? 0 : 3000) - scrollY }; }
    });
    const previousButton = button(8, true);
    const nextButton = button(9, false);
    const timeline = {
      innerHTML: "",
      querySelectorAll(selector) {
        return selector === ".day-toggle" ? [previousButton, nextButton] : [previousDetail, nextDetail];
      }
    };
    const nodes = new Map([
      ["#timeline", timeline], ["#day-count", {}],
      ["#day-detail-8", previousDetail], ["#day-detail-9", nextDetail]
    ]);
    const context = vm.createContext({
      document: {
        documentElement: { style },
        querySelector: (selector) => nodes.get(selector),
        addEventListener() {}
      },
      window: {
        scrollBy(_x, y) {
          assert.equal(style.scrollBehavior, "auto");
          scrollY = Math.max(0, scrollY + y);
        }
      },
      requestAnimationFrame: (callback) => frames.push(callback)
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../dist/app.js"), "utf8"), context);
    vm.runInContext("currentTripDay = () => 8; dayCard = () => ''; state.data = { days: [{ day: 8 }, { day: 9 }] }; renderTimeline();", context);
    const beforeTop = nextButton.getBoundingClientRect().top;
    timeline.onclick({ isTrusted: true, target: {
      closest: (selector) => selector === ".day-toggle" ? nextButton : null
    } });
    frames.forEach((callback) => callback());
    assert.equal(previousDetail.hidden, true);
    assert.equal(nextDetail.hidden, false);
    assert.equal(nextButton.expanded, true);
    assert.equal(nextButton.getBoundingClientRect().top, beforeTop);
    assert.equal(style.scrollBehavior, "");
  });
}
