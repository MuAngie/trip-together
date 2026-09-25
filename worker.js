const RECORD_COLLECTIONS = Object.freeze(["bills", "travelers", "todos", "tickets", "shopping", "walletEntries"]);
const COLLECTION_SET = new Set(RECORD_COLLECTIONS);
const API_PREFIX = "/api/trip/";
const MAX_CHANGES = 200;
const MAX_RECORD_BYTES = 32768;

function jsonResponse(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function errorResponse(status, message) {
  return jsonResponse({ error: message }, status);
}

function parseTripId(pathname) {
  if (!pathname.startsWith(API_PREFIX)) return null;
  const encoded = pathname.slice(API_PREFIX.length);
  if (!encoded || encoded.includes("/")) return "";
  try {
    const tripId = decodeURIComponent(encoded).trim();
    return tripId && tripId.length <= 120 && !tripId.includes("/") ? tripId : "";
  } catch {
    return "";
  }
}

function parseCollections(url) {
  const requested = String(url.searchParams.get("collections") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const collections = [...new Set(requested)];
  return collections.length && collections.every((collection) => COLLECTION_SET.has(collection))
    ? collections
    : null;
}

function emptySnapshot() {
  return {
    version: 1,
    settings: null,
    bills: [],
    travelers: [],
    todos: [],
    tickets: [],
    shopping: [],
    walletEntries: [],
    updatedAt: new Date().toISOString()
  };
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS runtime_trips (
      trip_id TEXT PRIMARY KEY,
      seeded_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS runtime_records (
      trip_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      record_id TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (trip_id, collection, record_id)
    )`)
  ]);
}

function seedRecords(data, tripId) {
  if (data?.metadata?.tripId !== tripId) return [];
  const records = [];
  const push = (collection, values) => {
    (Array.isArray(values) ? values : []).forEach((value, index) => {
      const id = String(value?.id || `${collection}-initial-${index + 1}`).trim();
      if (!id || !value || typeof value !== "object" || Array.isArray(value)) return;
      records.push({ collection, id, value: { ...value, id } });
    });
  };
  push("travelers", data.ledgerSeed?.travelers);
  push("bills", data.ledgerSeed?.bills);
  push("walletEntries", data.walletSeed?.entries);
  push("todos", data.preTrip?.todoItems || data.preTrip?.packingItems);
  push("shopping", data.preTrip?.shoppingItems);
  return records;
}

async function ensureSeeded(request, env, tripId) {
  const existing = await env.TRIP_DB.prepare("SELECT trip_id FROM runtime_trips WHERE trip_id = ?")
    .bind(tripId)
    .first();
  if (existing) return;

  let records = [];
  try {
    const seedUrl = new URL("/trip-data.json", request.url);
    const seedResponse = await env.ASSETS.fetch(new Request(seedUrl));
    if (seedResponse.ok) records = seedRecords(await seedResponse.json(), tripId);
  } catch {
    records = [];
  }

  const now = new Date().toISOString();
  const statements = records.map((record) => env.TRIP_DB.prepare(
    `INSERT INTO runtime_records (trip_id, collection, record_id, value, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (trip_id, collection, record_id)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(tripId, record.collection, record.id, JSON.stringify(record.value), now));
  statements.push(env.TRIP_DB.prepare(
    "INSERT OR IGNORE INTO runtime_trips (trip_id, seeded_at) VALUES (?, ?)"
  ).bind(tripId, now));
  await env.TRIP_DB.batch(statements);
}

async function loadSnapshot(db, tripId, collections) {
  const placeholders = collections.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT collection, value, updated_at FROM runtime_records
     WHERE trip_id = ? AND collection IN (${placeholders})
     ORDER BY collection, record_id`
  ).bind(tripId, ...collections).all();
  const snapshot = emptySnapshot();
  let newest = "";
  for (const row of result.results || []) {
    if (!COLLECTION_SET.has(row.collection)) continue;
    try {
      const value = JSON.parse(row.value);
      if (value && typeof value === "object" && !Array.isArray(value)) snapshot[row.collection].push(value);
      if (row.updated_at > newest) newest = row.updated_at;
    } catch {
      // Ignore a malformed row so one damaged record cannot hide the rest of the shared trip.
    }
  }
  if (newest) snapshot.updatedAt = newest;
  return snapshot;
}

async function secretsEqual(left, right) {
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(String(left || ""))),
    crypto.subtle.digest("SHA-256", encode.encode(String(right || "")))
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = aa.length ^ bb.length;
  for (let index = 0; index < Math.min(aa.length, bb.length); index += 1) difference |= aa[index] ^ bb[index];
  return difference === 0;
}

async function canEdit(request, env) {
  const expected = String(env.TRIP_EDIT_TOKEN || "");
  if (!expected) return false;
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(provided) && secretsEqual(provided, expected);
}

function validateChanges(rawChanges, collections) {
  if (!Array.isArray(rawChanges) || rawChanges.length > MAX_CHANGES) return null;
  const allowed = new Set(collections);
  const changes = [];
  for (const raw of rawChanges) {
    const op = raw?.op;
    const collection = String(raw?.collection || "");
    const id = String(raw?.id || "").trim();
    if (!["upsert", "delete"].includes(op) || !allowed.has(collection) || !id || id.length > 200) return null;
    if (collection === "walletEntries" && id === "wallet-initialized-v1") return null;
    if (op === "delete") {
      changes.push({ op, collection, id });
      continue;
    }
    if (!raw.value || typeof raw.value !== "object" || Array.isArray(raw.value)) return null;
    const value = { ...raw.value, id };
    if (collection === "walletEntries" && (
      !["expense", "contribution", "refund", "return"].includes(value.kind)
      || value.currency !== "JPY"
      || !Number.isSafeInteger(value.amountYen) || value.amountYen <= 0
      || typeof value.note !== "string" || value.note.length > 160
      || typeof value.date !== "string" || (value.date && !/^\d{4}-\d{2}-\d{2}$/.test(value.date))
      || (["contribution", "return"].includes(value.kind) && !value.familyId)
    )) return null;
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).byteLength > MAX_RECORD_BYTES) return null;
    changes.push({ op, collection, id, serialized });
  }
  return changes;
}

async function applyChanges(db, tripId, changes) {
  if (!changes.length) return;
  const now = new Date().toISOString();
  const statements = changes.map((change) => change.op === "delete"
    ? db.prepare(
      "DELETE FROM runtime_records WHERE trip_id = ? AND collection = ? AND record_id = ?"
    ).bind(tripId, change.collection, change.id)
    : db.prepare(
      `INSERT INTO runtime_records (trip_id, collection, record_id, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (trip_id, collection, record_id)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(tripId, change.collection, change.id, change.serialized, now));
  await db.batch(statements);
}

export async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const tripId = parseTripId(url.pathname);
  if (tripId === null) return null;
  if (!tripId) return errorResponse(400, "无效的旅行编号");
  if (!env.TRIP_DB) return errorResponse(503, "尚未绑定 D1 数据库");
  if (!env.ASSETS) return errorResponse(503, "尚未绑定静态资源");
  if (!["GET", "POST"].includes(request.method)) {
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  }
  const collections = parseCollections(url);
  if (!collections) return errorResponse(400, "无效的共享数据范围");

  await ensureSchema(env.TRIP_DB);
  await ensureSeeded(request, env, tripId);

  if (request.method === "POST") {
    if (!env.TRIP_EDIT_TOKEN) return errorResponse(503, "尚未设置团队编辑密码");
    if (!await canEdit(request, env)) return errorResponse(401, "团队编辑密码不正确");
    let payload;
    try {
      payload = await request.json();
    } catch {
      return errorResponse(400, "请求内容不是有效的 JSON");
    }
    const changes = validateChanges(payload?.changes, collections);
    if (!changes) return errorResponse(400, "共享数据修改无效");
    await applyChanges(env.TRIP_DB, tripId, changes);
  }

  return jsonResponse(await loadSnapshot(env.TRIP_DB, tripId, collections));
}

export default {
  async fetch(request, env) {
    try {
      const apiResponse = await handleApiRequest(request, env);
      if (apiResponse) return apiResponse;
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Trip Worker request failed", error);
      return errorResponse(500, "共享数据服务暂时不可用");
    }
  }
};
