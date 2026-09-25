import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../../worker.js";
import { readFileSync } from "node:fs";

class MemoryStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.startsWith("SELECT trip_id FROM runtime_trips")) {
      return this.database.trips.has(this.values[0]) ? { trip_id: this.values[0] } : null;
    }
    throw new Error(`Unexpected first query: ${this.sql}`);
  }

  async all() {
    if (!this.sql.startsWith("SELECT collection, value, updated_at FROM runtime_records")) {
      throw new Error(`Unexpected all query: ${this.sql}`);
    }
    const [tripId, ...collections] = this.values;
    const results = [...this.database.records.values()]
      .filter((row) => row.trip_id === tripId && collections.includes(row.collection))
      .sort((left, right) => `${left.collection}:${left.record_id}`.localeCompare(`${right.collection}:${right.record_id}`));
    return { results };
  }

  async run() {
    if (this.sql.startsWith("CREATE TABLE")) return { success: true };
    if (this.sql.startsWith("INSERT OR IGNORE INTO runtime_trips")) {
      const [tripId, seededAt] = this.values;
      if (!this.database.trips.has(tripId)) this.database.trips.set(tripId, seededAt);
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO runtime_records")) {
      const [tripId, collection, recordId, value, updatedAt] = this.values;
      this.database.records.set(`${tripId}:${collection}:${recordId}`, {
        trip_id: tripId,
        collection,
        record_id: recordId,
        value,
        updated_at: updatedAt
      });
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM runtime_records")) {
      const [tripId, collection, recordId] = this.values;
      this.database.records.delete(`${tripId}:${collection}:${recordId}`);
      return { success: true };
    }
    throw new Error(`Unexpected run query: ${this.sql}`);
  }
}

class MemoryD1 {
  constructor() {
    this.trips = new Map();
    this.records = new Map();
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function createEnvironment() {
  const seed = {
    metadata: { tripId: "shared-trip" },
    ledgerSeed: {
      travelers: [{ id: "person-1", name: "旅行者" }],
      bills: [{ id: "bill-1", title: "酒店" }]
    },
    walletSeed: JSON.parse(readFileSync(new URL("../../dist/trip-data.json", import.meta.url), "utf8")).walletSeed,
    preTrip: {
      todoItems: [{ id: "todo-1", text: "带护照" }],
      shoppingItems: []
    }
  };
  return {
    TRIP_DB: new MemoryD1(),
    TRIP_EDIT_TOKEN: "team-password",
    ASSETS: {
      async fetch() {
        return Response.json(seed);
      }
    }
  };
}

test("the first D1 read seeds current shared trip data", async () => {
  const env = createEnvironment();
  const response = await handleApiRequest(new Request(
    "https://trip.example/api/trip/shared-trip?collections=travelers,bills,todos,shopping"
  ), env);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(snapshot.travelers[0].name, "旅行者");
  assert.equal(snapshot.bills[0].title, "酒店");
  assert.equal(snapshot.todos[0].text, "带护照");
});

test("D1 writes require the team editor password", async () => {
  const env = createEnvironment();
  const request = (token) => new Request(
    "https://trip.example/api/trip/shared-trip?collections=todos",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        changes: [{ op: "upsert", collection: "todos", id: "todo-2", value: { id: "todo-2", text: "带充电器" } }]
      })
    }
  );

  assert.equal((await handleApiRequest(request(""), env)).status, 401);
  assert.equal((await handleApiRequest(request("wrong"), env)).status, 401);
  const response = await handleApiRequest(request("team-password"), env);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.deepEqual(snapshot.todos.map((item) => item.id), ["todo-1", "todo-2"]);
});

test("a client can delete only a collection named in its allowlist", async () => {
  const env = createEnvironment();
  const response = await handleApiRequest(new Request(
    "https://trip.example/api/trip/shared-trip?collections=todos",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer team-password" },
      body: JSON.stringify({ changes: [{ op: "delete", collection: "bills", id: "bill-1" }] })
    }
  ), env);
  assert.equal(response.status, 400);
});

test("shared wallet seeds once, merges separate clients, and keeps CNY bills independent", async () => {
  const env = createEnvironment();
  const url = "https://trip.example/api/trip/shared-trip?collections=walletEntries";
  const read = () => handleApiRequest(new Request(url), env);
  const post = (changes, token = "team-password") => handleApiRequest(new Request(url, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ changes })
  }), env);
  const change = (id, amountYen) => ({ op: "upsert", collection: "walletEntries", id,
    value: { id, kind: "expense", currency: "JPY", amountYen, note: "集体用餐", date: "2026-10-07" }
  });
  assert.equal((await (await read()).json()).walletEntries.length, 4);
  assert.equal((await post([change("a", 18000)], "wrong")).status, 401);
  assert.equal((await post([change("a", -1)])).status, 400);
  assert.equal((await post([{ op: "delete", collection: "walletEntries", id: "wallet-initialized-v1" }])).status, 400);
  assert.equal((await post([change("a", 18000)])).status, 200);
  const saved = await (await post([change("b", 3000)])).json();
  assert.equal(saved.walletEntries.length, 6);
  await post([{ op: "delete", collection: "walletEntries", id: "wallet-opening-chen-feng" }]);
  assert.equal((await (await read()).json()).walletEntries.length, 5);
  const cny = await (await handleApiRequest(new Request("https://trip.example/api/trip/shared-trip?collections=bills"), env)).json();
  assert.equal(cny.bills[0].title, "酒店");
});
