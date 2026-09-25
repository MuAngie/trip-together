const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function load(relative) {
  const module = { exports: {} };
  return new Function("module", `${fs.readFileSync(path.join(__dirname, relative), "utf8")}\nreturn module.exports;`)(module);
}
const wallet = load("../../dist/wallet.js");
const runtime = load("../../dist/runtime-storage.js");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../../dist/trip-data.json"), "utf8"));
const { entries, families } = data.walletSeed;
const record = (kind, amountYen, extra = {}) => ({ id: "test", kind, amountYen, currency: "JPY", note: "测试", date: "2026-10-07", ...extra });

test("confirmed contributions total 600,000 JPY with no invented payment date", () => {
  const stats = wallet.calculate(entries, families);
  assert.equal(stats.balance, 600000);
  assert.equal(stats.netExpense, 0);
  assert.deepEqual(stats.members.map((member) => member.contributed), [200000, 200000, 200000]);
  assert.ok(entries.filter((entry) => entry.kind === "contribution").every((entry) => entry.date === ""));
});

test("expenses, merchant refunds, extra contributions and family returns reconcile", () => {
  const stats = wallet.calculate([...entries,
    record("expense", 18000), record("refund", 3000),
    record("contribution", 10000, { familyId: families[0].id }),
    record("return", 5000, { familyId: families[0].id })
  ], families);
  assert.equal(stats.netExpense, 15000);
  assert.equal(stats.balance, 590000);
  assert.equal(stats.members[0].remaining, 200000);
  assert.equal(stats.members.reduce((sum, member) => sum + member.remaining, 0), stats.balance);
});

test("editing and deleting expenses recalculate balance; yen rounding conserves money", () => {
  assert.equal(wallet.calculate([...entries, record("expense", 18000)], families).balance, 582000);
  assert.equal(wallet.calculate([...entries, record("expense", 12000)], families).balance, 588000);
  assert.equal(wallet.calculate(entries, families).balance, 600000);
  const stats = wallet.calculate([...entries, record("expense", 100)], families);
  assert.deepEqual(stats.members.map((member) => member.share), [34, 33, 33]);
  assert.equal(stats.members.reduce((sum, member) => sum + member.remaining, 0), 599900);
  assert.equal(wallet.calculate([...entries, record("expense", 600001)], families).balance, -1);
});

test("invalid yen amounts, currency, family and dates are rejected", () => {
  for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => wallet.validateEntry(record("expense", amount), families));
  }
  for (const extra of [{ currency: "CNY" }, { date: "2026-02-30" }, { date: "invalid" }]) {
    assert.throws(() => wallet.validateEntry(record("expense", 100, extra), families));
  }
  assert.throws(() => wallet.validateEntry(record("contribution", 100, { familyId: "unknown" }), families));
});

test("local wallet preserves CNY bills and never restores deleted opening contributions", async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const ledger = runtime.createLocalAdapter({ tripId: "test", storage, collections: ["bills"] });
  await ledger.save({ bills: data.ledgerSeed.bills });
  const adapter = runtime.createLocalAdapter({ tripId: "test", storage, collections: ["walletEntries"] });
  await wallet.initializeLocal(adapter, entries);
  await adapter.applyChange("walletEntries", "wallet-opening-chen-feng", "delete");
  const snapshot = await wallet.initializeLocal(adapter, entries);
  assert.equal(wallet.calculate(snapshot.walletEntries, families).balance, 400000);
  assert.deepEqual(snapshot.bills, data.ledgerSeed.bills);
  await ledger.save({ bills: data.ledgerSeed.bills });
  assert.equal((await adapter.load()).walletEntries.length, 3);
});

test("actual migration SQL is atomic, repeatable, and preserves existing CNY and wallet entries", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE runtime_records (trip_id TEXT, collection TEXT, record_id TEXT, value TEXT, updated_at TEXT, PRIMARY KEY(trip_id, collection, record_id))");
    const insert = db.prepare("INSERT INTO runtime_records VALUES ('shanghai-japan-2026', ?, ?, ?, '')");
    insert.run("bills", "old-cny", JSON.stringify(data.ledgerSeed.bills[0]));
    insert.run("walletEntries", "expense-test", JSON.stringify(record("expense", 18000, { id: "expense-test" })));
    const sql = fs.readFileSync(path.join(__dirname, "../../migrations/20260925-public-wallet.sql"), "utf8");
    db.exec(sql);
    db.exec(sql);
    const read = () => db.prepare("SELECT value FROM runtime_records WHERE collection='walletEntries'").all().map((row) => JSON.parse(row.value));
    assert.equal(read().length, 5);
    assert.equal(wallet.calculate(read(), families).balance, 582000);
    assert.deepEqual(read().filter((entry) => entry.id !== "expense-test").sort((a, b) => a.id.localeCompare(b.id)), [...entries].sort((a, b) => a.id.localeCompare(b.id)));
    db.exec("DELETE FROM runtime_records WHERE record_id='wallet-opening-chen-feng'");
    db.exec(sql);
    assert.equal(read().length, 4);
    assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM runtime_records WHERE collection='bills'").get().value), data.ledgerSeed.bills[0]);
  } finally { db.close(); }
});
