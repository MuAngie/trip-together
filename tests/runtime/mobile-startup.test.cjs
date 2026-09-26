const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (name) => fs.readFileSync(path.join(__dirname, "../../dist", name), "utf8");
const data = JSON.parse(source("trip-data.json"));

test("opening the HTML as a file explains the local preview path without fetching trip data", async () => {
  const heading = { textContent: "" };
  const detail = { textContent: "", append(link) { this.link = link; } };
  const error = {
    hidden: true,
    querySelector: (selector) => selector === "strong" ? heading : detail
  };
  const context = vm.createContext({
    fetch: () => { throw new Error("file preview should not fetch"); },
    document: {
      querySelector: () => error,
      createElement: () => ({}),
      addEventListener() {}
    },
    window: { location: { protocol: "file:", hash: "#ledger" } }
  });
  vm.runInContext(source("app.js"), context);
  await vm.runInContext("init()", context);
  assert.equal(error.hidden, false);
  assert.match(heading.textContent, /本地预览/);
  assert.match(detail.textContent, /npm run preview/);
  assert.equal(detail.link.href, "http://127.0.0.1:4173/#ledger");
});

for (const crypto of [undefined, {}]) {
  test(`wallet loads and saves separate entries without randomUUID or Object.hasOwn (crypto ${crypto ? "present" : "absent"})`, async () => {
    const handlers = {};
    const controls = new Map();
    const form = {
      id: "wallet-form",
      elements: { kind: { value: "expense" } },
      querySelector(selector) {
        if (!controls.has(selector)) controls.set(selector, {});
        return controls.get(selector);
      }
    };
    const root = {
      innerHTML: "",
      querySelector: (selector) => selector === "#wallet-form" ? form : null,
      querySelectorAll: () => [],
      setAttribute() {},
      addEventListener: (type, handler) => { handlers[type] = handler; }
    };
    const entries = JSON.parse(JSON.stringify(data.walletSeed.entries));
    const adapter = {
      load: async () => ({ walletEntries: entries }),
      applyChange: async (_collection, entry) => {
        entries.push(entry);
        return { walletEntries: entries };
      }
    };
    const context = vm.createContext({
      crypto,
      document: { querySelector: () => root },
      window: { TravelRuntimeStorage: { createAdapter: () => adapter } },
      FormData: class {
        get(name) {
          return { kind: "expense", amount: "100", category: "餐饮", note: "测试", date: "2026-10-08" }[name];
        }
      }
    });
    vm.runInContext("Object.hasOwn = undefined;", context);
    vm.runInContext(source("wallet.js"), context);
    const wallet = context.window.TravelWallet;
    await wallet.init({ data, config: data.config });
    assert.match(root.innerHTML, /600,000 日元/);
    for (let i = 0; i < 2; i++) {
      await handlers.submit({ target: form, preventDefault() {} });
    }
    assert.equal(entries.length, 6);
    assert.notEqual(entries[4].id, entries[5].id);
    assert.equal(wallet.calculate(entries, data.walletSeed.families).balance, 599800);
    assert.match(root.innerHTML, /已保存/);
    assert.throws(() => wallet.validateEntry({ kind: "toString" }, data.walletSeed.families));
  });
}

test("wallet startup failure stays in wallet while itinerary, CNY ledger and countdowns continue", async () => {
  const nodes = new Map(["#wallet-root", "#ledger-root", "#loading-error"].map((id) => [id, { hidden: true, textContent: "" }]));
  const calls = [];
  const context = vm.createContext({
    URL,
    calls,
    console: { error() {} },
    CustomEvent: class {},
    fetch: async () => ({ ok: true, json: async () => data }),
    document: {
      querySelector: (selector) => nodes.get(selector),
      addEventListener() {},
      dispatchEvent() {}
    },
    window: {
      location: { origin: "https://example.test" },
      TravelWallet: { init: async () => { throw new Error("wallet startup failed"); } },
      TravelLedger: { init: async () => { calls.push("ledger"); } }
    }
  });
  vm.runInContext(source("app.js"), context);
  for (const name of ["applyModuleConfig", "preloadDefaultRouteMap", "renderHero", "renderFlights", "setupRouteExplorer", "setupPlaceMap", "setupTicketDialog", "createRuntimeAdapters", "loadSharedState", "renderTimeline", "renderRental", "renderTravelPrep", "startCountdowns"]) {
    vm.runInContext(`${name} = () => calls.push("${name}");`, context);
  }
  await vm.runInContext("init()", context);
  assert.ok(calls.includes("renderTimeline"));
  assert.ok(calls.includes("ledger"));
  assert.ok(calls.includes("startCountdowns"));
  assert.equal(nodes.get("#loading-error").hidden, true);
  assert.match(nodes.get("#wallet-root").textContent, /公共钱包.*刷新/);
});
