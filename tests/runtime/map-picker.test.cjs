const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../dist/map-picker.js"), "utf8");
const window = {};
const document = { addEventListener() {} };
vm.runInNewContext(source, { window, document, URL, encodeURIComponent });

test("map choice builds three encoded search links from a known location", () => {
  const links = window.TravelMapPicker.linksFor({
    query: "ホテル日航プリンセス京都",
    queryZh: "京都日航公主酒店"
  });
  assert.equal(new URL(links.google).searchParams.get("query"), "ホテル日航プリンセス京都");
  assert.equal(new URL(links.amap).searchParams.get("keyword"), "京都日航公主酒店");
  assert.equal(new URL(links.baidu).searchParams.get("query"), "京都日航公主酒店");
  assert.equal(new URL(links.amap).searchParams.get("callnative"), "1");
});

test("an existing Amap place link is kept only for the Amap choice", () => {
  const links = window.TravelMapPicker.linksFor({
    query: "上海吴淞口国际邮轮码头",
    url: "https://www.amap.com/place/B00156EFOR"
  });
  assert.equal(links.amap, "https://www.amap.com/place/B00156EFOR");
  assert.match(links.google, /^https:\/\/www\.google\.com\/maps\/search\//);
  assert.match(links.baidu, /^https:\/\/api\.map\.baidu\.com\/place\/search/);
});

test("untrusted direct links are ignored and empty locations have no links", () => {
  const links = window.TravelMapPicker.linksFor({ query: "京都", url: "https://amap.com.evil.example/path" });
  assert.match(links.amap, /^https:\/\/uri\.amap\.com\/search/);
  assert.equal(window.TravelMapPicker.linksFor({ query: "  " }), null);
});

test("iPhone and iPad links search in the selected app without web fallbacks", () => {
  const place = { query: "おにまる 京都 & #", queryZh: "京都饭团 & #", url: "https://www.amap.com/place/B00156EFOR" };
  for (const device of [{ userAgent: "iPhone" }, { userAgent: "iPad" }, { platform: "MacIntel", maxTouchPoints: 5 }]) {
    const links = window.TravelMapPicker.linksFor(place, device);
    assert.equal(new URL(links.google).protocol, "comgooglemaps:");
    assert.equal(new URL(links.google).searchParams.get("q"), place.query);
    assert.equal(new URL(links.amap).protocol, "iosamap:");
    assert.equal(new URL(links.amap).searchParams.get("name"), place.queryZh);
    assert.equal(new URL(links.baidu).protocol, "baidumap:");
    assert.equal(new URL(links.baidu).searchParams.get("query"), place.queryZh);
  }
});

test("Android intents target each selected map app and do not fall back to a website", () => {
  const place = { query: "ホテル京都 & #Intent;end", queryZh: "京都酒店 & #Intent;end" };
  const links = window.TravelMapPicker.linksFor(place, { userAgent: "Mozilla/5.0 Android" });
  const expected = {
    google: { scheme: "https", package: "com.google.android.apps.maps", key: "query", query: place.query },
    amap: { scheme: "androidamap", package: "com.autonavi.minimap", key: "keywords", query: place.queryZh },
    baidu: { scheme: "baidumap", package: "com.baidu.BaiduMap", key: "query", query: place.queryZh }
  };
  for (const [provider, url] of Object.entries(links)) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "intent:");
    assert.equal(parsed.searchParams.get(expected[provider].key), expected[provider].query);
    assert.equal(parsed.hash, `#Intent;scheme=${expected[provider].scheme};package=${expected[provider].package};end`);
    assert.ok(!url.includes("browser_fallback_url"));
  }
});

test("mobile picker uses native links in the current tab so launching leaves no empty browser tab", () => {
  const links = Object.fromEntries(["google", "amap", "baidu"].map((provider) => [provider, {}]));
  const title = {};
  const intro = {};
  const panel = {
    hidden: true,
    querySelector(selector) {
      if (selector === "#place-map-title") return title;
      if (selector === ".place-map-sheet__intro") return intro;
      if (selector === "#place-map-close") return { focus() {} };
      return links[selector.match(/data-map-provider="(.*?)"/)[1]];
    }
  };
  const mobileWindow = {};
  vm.runInNewContext(source, {
    window: mobileWindow, URL, encodeURIComponent,
    navigator: { userAgent: "iPhone" },
    document: { addEventListener() {}, body: { style: {} }, querySelector: () => panel }
  });
  assert.equal(mobileWindow.TravelMapPicker.open({ label: "京都酒店", query: "京都ホテル" }), true);
  assert.equal(panel.hidden, false);
  assert.equal(title.textContent, "京都酒店");
  assert.equal(intro.textContent, "选择地图 App 查看地点");
  for (const link of Object.values(links)) {
    assert.equal(link.target, "_self");
    assert.ok(!link.href.startsWith("https:"));
  }
});

function gesturePicker(clipboardMode = "available", legacyResult = true) {
  const handlers = new Map();
  const copied = [];
  const fields = [];
  const status = { hidden: true };
  const trigger = { dataset: { mapQuery: "京都市下京区高橋町630番地", mapLabel: "京都酒店" }, closest() { return null; } };
  const nodes = Object.fromEntries(["#place-map-title", ".place-map-sheet__intro", "#place-map-close", '[data-map-provider="google"]', '[data-map-provider="amap"]', '[data-map-provider="baidu"]'].map(key => [key, { focus() {}, addEventListener() {} }]));
  const panel = { hidden: true, querySelector: selector => nodes[selector], addEventListener() {} };
  const document = {
    addEventListener(name, handler, capture) { handlers.set(name, { handler, capture }); },
    querySelector: selector => selector === "#map-copy-status" ? status : panel,
    body: { style: {}, append(field) { fields.push(field); } },
    createElement() { return { style: {}, select() {}, setSelectionRange() {}, remove() { this.removed = true; } }; },
    execCommand(command) {
      assert.equal(command, "copy");
      if (legacyResult) copied.push(fields.at(-1).value);
      return legacyResult;
    }
  };
  const navigator = { userAgent: "iPhone" };
  if (clipboardMode !== "missing") navigator.clipboard = { async writeText(text) {
    if (clipboardMode === "rejected") throw new Error("NotAllowedError");
    copied.push(text);
  } };
  vm.runInNewContext(source, { document, navigator, window: {}, URL, encodeURIComponent, setTimeout() { return 1; }, clearTimeout() {} });
  handlers.get("DOMContentLoaded").handler();
  return {
    copied, status, panel, fields, trigger,
    async emit(type, timeStamp, overrides = {}) {
      const event = { target: { closest: () => trigger }, button: 0, isPrimary: true, pointerId: 1, clientX: 20, clientY: 20, detail: 1, timeStamp,
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides };
      await handlers.get(type).handler(event);
      await new Promise(resolve => setImmediate(resolve));
      if (type === "click") assert.equal(handlers.get(type).capture, true);
      return event;
    }
  };
}

test("holding a location copies its address once, suppresses map opening, and preserves the next short tap", async () => {
  const picker = gesturePicker();
  await picker.emit("pointerdown", 0);
  await picker.emit("pointerup", 650);
  const click = await picker.emit("click", 650);
  assert.deepEqual(picker.copied, [picker.trigger.dataset.mapQuery]);
  assert.equal(picker.status.textContent, "已复制地点");
  assert.equal(picker.status.hidden, false);
  assert.equal(click.stopped, true);
  assert.equal(picker.panel.hidden, true);
  await picker.emit("pointerdown", 1000);
  await picker.emit("pointerup", 1100);
  await picker.emit("click", 1100);
  assert.equal(picker.panel.hidden, false);
  assert.equal(picker.copied.length, 1);
});

test("scrolling, pointer cancellation, and a second finger do not copy a location", async () => {
  for (const action of ["pointermove", "pointercancel", "pointerdown"]) {
    const picker = gesturePicker();
    await picker.emit("pointerdown", 0);
    await picker.emit(action, 300, { clientY: 50, isPrimary: false, pointerId: action === "pointerdown" ? 2 : 1 });
    await picker.emit("pointerup", 800);
    assert.deepEqual(picker.copied, []);
    assert.equal(picker.status.hidden, true);
  }
});

test("clipboard fallback supports local HTTP previews and rejected clipboard access without copying a URL", async () => {
  for (const mode of ["missing", "rejected"]) {
    const picker = gesturePicker(mode);
    picker.trigger.dataset.mapQuery = "https://www.amap.com/place/B00156EFOR";
    await picker.emit("pointerdown", 0);
    await picker.emit("pointerup", 700);
    assert.deepEqual(picker.copied, ["京都酒店"]);
    assert.equal(picker.fields.length, 1);
    assert.equal(picker.fields[0].removed, true);
    assert.equal(picker.status.textContent, "已复制地点");
  }
});

test("failed copying reports failure without opening the map or claiming success", async () => {
  const picker = gesturePicker("rejected", false);
  await picker.emit("pointerdown", 0);
  await picker.emit("pointerup", 700);
  await picker.emit("click", 700);
  assert.deepEqual(picker.copied, []);
  assert.match(picker.status.textContent, /复制失败/);
  assert.equal(picker.panel.hidden, true);
});
