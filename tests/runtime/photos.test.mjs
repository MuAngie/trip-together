import test from "node:test";
import assert from "node:assert/strict";
import worker from "../../worker.js";

const TRIP = "shanghai-japan-2026";
const BASE = `https://trip.example/api/photos/${TRIP}`;
const JPEG = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217]);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

class MemoryR2 {
  objects = new Map();
  writes = [];
  failOriginal = false;
  failCommit = false;
  badPreview = false;
  async put(key, body, options = {}) {
    this.writes.push(key);
    if ((this.failOriginal && key.startsWith("originals/")) || (this.failCommit && options.customMetadata?.ready === "true")) throw new Error("Simulated storage failure");
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    const object = { key, size: bytes.length, etag: String(this.writes.length), bytes, ...structuredClone(options) };
    this.objects.set(key, object);
    return object;
  }
  async head(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return { ...object, size: this.badPreview && key.startsWith("previews/") ? 0 : object.size };
  }
  async get(key) {
    const object = this.objects.get(key);
    return object ? { ...object, body: new Blob([object.bytes]).stream() } : null;
  }
  async delete(key) { this.objects.delete(key); }
  async list({ prefix, limit, cursor }) {
    const matching = [...this.objects.values()].filter((object) => object.key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key));
    const start = Number(cursor || 0);
    return { objects: matching.slice(start, start + limit), truncated: start + limit < matching.length, cursor: String(start + limit) };
  }
}

function environment() {
  return {
    TRIP_PHOTOS: new MemoryR2(), TRIP_EDIT_TOKEN: "test-team-password",
    ASSETS: { fetch: async () => Response.json([{ id: TRIP }, { id: "other-trip" }]) }
  };
}
function request(path = "", options = {}, token = "test-team-password") {
  return new Request(BASE + path, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers } });
}
function upload(original = new File([PNG], "京都原图.png", { type: "image/png" }), preview = new File([JPEG], "preview.jpg", { type: "image/jpeg" })) {
  const form = new FormData();
  if (original) form.append("original", original);
  if (preview) form.append("preview", preview);
  form.append("expiresAt", "2099-01-01T00:00:00Z");
  return { method: "POST", body: form };
}
async function addPhoto(env) {
  const response = await worker.fetch(request("", upload()), env);
  assert.equal(response.status, 201);
  return response.json();
}

test("photo storage verifies the browsing copy first and preserves original bytes and filename", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-18T02:00:00Z"));
  const env = environment();
  const photo = await addPhoto(env);
  assert.equal(photo.expiresAt, "2026-11-17T02:00:00.000Z");
  assert.equal(photo.name, "京都原图.png");
  assert.deepEqual(env.TRIP_PHOTOS.writes.map((key) => key.split("/")[0]), ["previews", "originals", "previews"]);
  const downloaded = await worker.fetch(request(`/${photo.id}/original`), env);
  assert.equal(downloaded.headers.get("content-type"), "image/png");
  assert.equal(downloaded.headers.get("cache-control"), "no-store");
  assert.match(downloaded.headers.get("content-disposition"), /attachment; filename\*=UTF-8''/);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), PNG);
});

test("at the 30-day boundary original download expires while the browsing copy remains", async (t) => {
  const start = Date.parse("2026-10-18T02:00:00Z");
  let now = start;
  t.mock.method(Date, "now", () => now);
  const env = environment();
  const photo = await addPhoto(env);
  now = start + 30 * 86400000 - 1;
  assert.equal((await worker.fetch(request(`/${photo.id}/original`), env)).status, 200);
  now++;
  assert.equal((await worker.fetch(request(`/${photo.id}/original`), env)).status, 410);
  assert.equal((await worker.fetch(request(`/${photo.id}/preview`), env)).status, 200);
  const listing = await (await worker.fetch(request(), env)).json();
  assert.equal(listing.photos[0].originalAvailable, false);
  // R2's originals/-only lifecycle performs physical deletion independently.
  await env.TRIP_PHOTOS.delete(`originals/${TRIP}/${photo.id}`);
  assert.equal((await worker.fetch(request(`/${photo.id}/preview`), env)).status, 200);
});

test("listing, images, uploads and removal all require the team password", async () => {
  const env = environment();
  const photo = await addPhoto(env);
  for (const [path, options] of [["", {}], ["", upload()], [`/${photo.id}/preview`, {}], [`/${photo.id}/original`, {}], [`/${photo.id}`, { method: "DELETE" }]]) {
    assert.equal((await worker.fetch(request(path, options, "wrong"), env)).status, 401);
  }
  assert.equal(env.TRIP_PHOTOS.objects.size, 2);
});

test("a failed preview verification never stores an original", async () => {
  const env = environment();
  env.TRIP_PHOTOS.badPreview = true;
  assert.equal((await worker.fetch(request("", upload()), env)).status, 503);
  assert.equal(env.TRIP_PHOTOS.writes.some((key) => key.startsWith("originals/")), false);
  assert.equal(env.TRIP_PHOTOS.objects.size, 0);
});

test("incomplete uploads are rolled back and never listed as completed photos", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const flag of ["failOriginal", "failCommit"]) {
    const env = environment();
    env.TRIP_PHOTOS[flag] = true;
    assert.equal((await worker.fetch(request("", upload()), env)).status, 500);
    assert.equal(env.TRIP_PHOTOS.objects.size, 0);
    assert.deepEqual((await (await worker.fetch(request(), env)).json()).photos, []);
  }
});

test("photo operations are isolated by trip and pagination does not drop photos", async () => {
  const env = environment();
  const photo = await addPhoto(env);
  for (let index = 0; index < 25; index++) {
    await env.TRIP_PHOTOS.put(`previews/${TRIP}/test-${index}`, JPEG, { customMetadata: { ready: "true", name: `Photo ${index}`, expiresAt: photo.expiresAt } });
  }
  const first = await (await worker.fetch(request(), env)).json();
  const second = await (await worker.fetch(request(`?cursor=${first.cursor}`), env)).json();
  assert.equal(first.photos.length, 24);
  assert.equal(second.photos.length, 2);
  assert.equal(second.cursor, null);
  const other = `https://trip.example/api/photos/other-trip/${photo.id}`;
  const headers = { authorization: "Bearer test-team-password" };
  assert.equal((await worker.fetch(new Request(`${other}/original`, { headers }), env)).status, 404);
  await worker.fetch(new Request(other, { method: "DELETE", headers }), env);
  assert.equal((await worker.fetch(request(`/${photo.id}/original`), env)).status, 200);
  assert.equal((await worker.fetch(new Request("https://trip.example/api/photos/missing", { headers }), env)).status, 404);
});

test("invalid types, missing browsing copies and oversized bodies are rejected", async () => {
  const env = environment();
  assert.equal((await worker.fetch(request("", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" } }), env)).status, 400);
  assert.equal((await worker.fetch(request("", upload(null)), env)).status, 400);
  assert.equal((await worker.fetch(request("", upload(undefined, null)), env)).status, 400);
  const fakeJpeg = new File(["<svg></svg>"], "fake.jpg", { type: "image/jpeg" });
  assert.equal((await worker.fetch(request("", upload(fakeJpeg)), env)).status, 415);
  const large = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" });
  assert.equal((await worker.fetch(request("", upload(large)), env)).status, 413);
  assert.equal((await worker.fetch(request("", { ...upload(), headers: { "content-length": String(30 * 1024 * 1024), "content-type": "multipart/form-data; boundary=test" } }), env)).status, 413);
  assert.equal(env.TRIP_PHOTOS.objects.size, 0);
});

test("removal deletes both variants and unconfigured cloud mode never claims local success", async () => {
  const env = environment();
  const photo = await addPhoto(env);
  assert.equal((await worker.fetch(request(`/${photo.id}`, { method: "DELETE" }), env)).status, 204);
  assert.equal(env.TRIP_PHOTOS.objects.size, 0);
  delete env.TRIP_PHOTOS;
  const config = await worker.fetch(new Request("https://trip.example/api/photos/config"), env);
  assert.deepEqual(await config.json(), { mode: "unavailable" });
  assert.equal((await worker.fetch(request("", upload()), env)).status, 503);
});
