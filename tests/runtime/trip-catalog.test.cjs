const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "../../dist");
const source = fs.readFileSync(path.join(root, "trip-catalog.js"), "utf8");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "trips.json"), "utf8"));
function api(trips) {
  const context = vm.createContext({ window: {}, URL, fetch: async () => ({ ok: true, json: async () => structuredClone(trips) }) });
  vm.runInContext(source, context);
  return context.window.TravelCatalog;
}

test("every collection entry opens existing data with the same storage identity", async () => {
  for (const entry of catalog) {
    const selected = await api(catalog).selected(`http://localhost/trip.html?trip=${entry.id}`);
    const data = JSON.parse(fs.readFileSync(path.join(root, selected.data), "utf8"));
    assert.equal(data.metadata.tripId, selected.id);
    assert.equal(data.trip.startDate, selected.startDate);
    assert.equal(data.trip.endDate, selected.endDate);
    assert.ok(fs.existsSync(path.join(root, selected.cover)));
  }
});

test("adding a new catalog entry selects its own data without changing the original trip", async () => {
  const next = { ...catalog[0], id: "test-next-trip", startDate: "2027-01-01", data: "/trips/test-next-trip.json" };
  const service = api([...catalog, next]);
  assert.equal((await service.load())[0].id, next.id);
  assert.equal((await service.selected("http://localhost/trip.html?trip=test-next-trip")).data, next.data);
  assert.equal((await service.selected("http://localhost/trip.html")).id, "shanghai-japan-2026");
  await assert.rejects(service.selected("http://localhost/trip.html?trip=missing"), /不在集合/);
});

test("catalog rejects duplicate identities and off-site or parent-relative data sources", async () => {
  await assert.rejects(api([catalog[0], catalog[0]]).load(), /唯一/);
  for (const data of ["https://example.com/trip.json", "//example.com/trip.json", "/../trip.json", "/api/trip?id=x"]) {
    await assert.rejects(api([{ ...catalog[0], data }]).load(), /站内/);
  }
});
