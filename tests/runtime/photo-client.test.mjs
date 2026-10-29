import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../dist/trip-photos.js", import.meta.url), "utf8");
function fixture(fetch, initialToken = "") {
  const nodes = new Map();
  const created = [];
  const makeElement = () => ({
    textContent: "", disabled: false, hidden: false, dataset: {}, listeners: {}, children: [], files: [], value: "", clicks: 0,
    addEventListener(type, handler) { this.listeners[type] = handler; },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute() {},
    click() { this.clicks++; },
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob(callback) { callback(new Blob(["preview"], { type: "image/jpeg" })); }
  });
  const element = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, makeElement());
    return nodes.get(selector);
  };
  const album = {
    dataset: { tripId: "shanghai-japan-2026" }, querySelector: element,
    querySelectorAll: () => [...[".album-add", ".album-refresh", ".album-more", ".album-upload", ".album-clear"].map(element), ...created.filter((node) => node.tag === "button")]
  };
  const session = new Map(initialToken ? [["travel-plan:editor-token:shanghai-japan-2026", initialToken]] : []);
  let localOpens = 0, prompts = 0;
  const window = { prompt() { prompts++; return "new-password"; } };
  const context = vm.createContext({
    window, fetch, URL, Date, Intl, File, FormData,
    document: { createElement(tag) { const node = { ...makeElement(), tag }; created.push(node); return node; } },
    Image: class {
      naturalWidth = 2400;
      naturalHeight = 1600;
      set src(value) { Promise.resolve().then(() => this.onload()); }
    },
    sessionStorage: { getItem: (key) => session.get(key), setItem: (key, value) => session.set(key, value), removeItem: (key) => session.delete(key) },
    indexedDB: { open() { localOpens++; throw new Error("Unexpected local storage access"); } }
  });
  vm.runInContext(source, context);
  return { element, session, mount: () => window.TripPhotos.mount(album), localOpens: () => localOpens, prompts: () => prompts };
}

test("unconfigured cloud and configuration failures disable uploads without saving locally", async () => {
  for (const response of [Response.json({ mode: "unavailable" }), new Response("Unavailable", { status: 503 }), Response.json({ mode: "unexpected" })]) {
    const view = fixture(async () => response);
    await view.mount();
    assert.equal(view.element(".album-add").disabled, true);
    assert.equal(view.element(".album-refresh").disabled, false);
    assert.equal(view.localOpens(), 0);
    assert.equal(view.prompts(), 0);
    assert.match(view.element(".album-note").textContent + view.element(".album-message").textContent, /尚未开通|保存位置|配置不正确/);
  }
});

const photo = (name, type = "image/jpeg") => new File(["photo-bytes"], name, { type, lastModified: 100 });
async function select(view, files) {
  view.element(".album-input").files = files;
  await view.element(".album-input").listeners.change();
}

test("photo picker requests images and multiple selection without forcing the camera", () => {
  const collection = readFileSync(new URL("../../dist/collection.js", import.meta.url), "utf8");
  const input = collection.match(/<input class="album-input"[^>]+>/)[0];
  assert.match(input, /accept="image\/\*"/);
  assert.match(input, /\bmultiple\b/);
  assert.doesNotMatch(input, /\bcapture\b/);
});

test("single and multiple picks accumulate without uploading, and only confirmation sends the batch", async () => {
  const uploaded = [];
  const view = fixture(async (url, options) => {
    if (options?.method === "POST") { uploaded.push(options.body.get("original").name); return Response.json({}, { status: 201 }); }
    return Response.json(url.endsWith("/config") ? { mode: "cloud" } : { photos: [], cursor: null });
  });
  await view.mount();
  view.element(".album-add").listeners.click();
  assert.equal(view.element(".album-input").clicks, 1);
  assert.equal(view.prompts(), 0, "a password dialog must not consume the picker tap");
  await select(view, [photo("one.jpg")]);
  await select(view, [photo("two.jpg"), photo("three.jpg"), photo("one.jpg")]);
  await select(view, []); // Canceling the native picker must keep prior selections.
  assert.deepEqual(uploaded, []);
  assert.equal(view.element(".album-pending-list").children.length, 3);
  assert.equal(view.element(".album-upload").textContent, "上传 3 张照片");
  assert.equal(view.element(".album-input").value, "");
  await view.element(".album-upload").listeners.click();
  assert.deepEqual(uploaded, ["one.jpg", "two.jpg", "three.jpg"]);
  assert.equal(view.prompts(), 1);
  assert.equal(view.element(".album-pending").hidden, true);
  assert.equal(view.element(".album-upload").disabled, true);
});

test("pending photos can be removed or cleared before upload", async () => {
  const view = fixture(async () => Response.json({ mode: "cloud" }));
  await view.mount();
  await select(view, [photo("one.jpg"), photo("two.jpg")]);
  view.element(".album-pending-list").children[0].children[1].listeners.click();
  assert.equal(view.element(".album-pending-list").children.length, 1);
  assert.equal(view.element(".album-pending-list").children[0].children[0].textContent, "two.jpg");
  view.element(".album-clear").listeners.click();
  assert.equal(view.element(".album-pending").hidden, true);
  assert.equal(view.element(".album-upload").disabled, true);
});

test("failed uploads remain for retry while successful files are not uploaded again", async () => {
  const uploaded = [];
  let fail = true;
  const view = fixture(async (url, options) => {
    if (options?.method === "POST") {
      const name = options.body.get("original").name;
      uploaded.push(name);
      if (name === "two.jpg" && fail) return Response.json({ error: "暂时失败" }, { status: 503 });
      return Response.json({}, { status: 201 });
    }
    return Response.json(url.endsWith("/config") ? { mode: "cloud" } : { photos: [], cursor: null });
  });
  await view.mount();
  await select(view, [photo("one.jpg"), photo("two.jpg")]);
  await view.element(".album-upload").listeners.click();
  assert.equal(view.element(".album-pending-list").children.length, 1);
  assert.match(view.element(".album-message").textContent, /已上传 1 张.*未成功/);
  fail = false;
  await view.element(".album-upload").listeners.click();
  assert.deepEqual(uploaded, ["one.jpg", "two.jpg", "two.jpg"]);
});

test("Android files missing MIME type are normalized while unsupported and oversized files stay out of the batch", async () => {
  const uploaded = [];
  const view = fixture(async (url, options) => {
    if (options?.method === "POST") { uploaded.push(options.body.get("original")); return Response.json({}, { status: 201 }); }
    return Response.json(url.endsWith("/config") ? { mode: "cloud" } : { photos: [], cursor: null });
  });
  await view.mount();
  await select(view, [photo("android.JPG", ""), photo("unsupported.heic", "image/heic"), new File([new Uint8Array(25 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" })]);
  assert.equal(view.element(".album-pending-list").children.length, 1);
  assert.match(view.element(".album-message").textContent, /unsupported.heic/);
  assert.match(view.element(".album-message").textContent, /huge.jpg/);
  await view.element(".album-upload").listeners.click();
  assert.equal(uploaded[0].type, "image/jpeg");
  assert.equal(await uploaded[0].text(), "photo-bytes");
});

test("a running batch cannot be submitted twice or cleared", async () => {
  let finishUpload;
  const uploaded = [];
  const view = fixture(async (url, options) => {
    if (options?.method === "POST") {
      uploaded.push(options.body.get("original").name);
      return new Promise((resolve) => { finishUpload = () => resolve(Response.json({}, { status: 201 })); });
    }
    return Response.json(url.endsWith("/config") ? { mode: "cloud" } : { photos: [], cursor: null });
  });
  await view.mount();
  await select(view, [photo("one.jpg")]);
  const running = view.element(".album-upload").listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.element(".album-upload").disabled, true);
  await view.element(".album-upload").listeners.click();
  view.element(".album-clear").listeners.click();
  assert.equal(view.element(".album-pending-list").children.length, 1);
  finishUpload();
  await running;
  assert.deepEqual(uploaded, ["one.jpg"]);
});

test("cloud album waits for an explicit password action before requesting photos", async () => {
  const requests = [];
  const view = fixture(async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.endsWith("/config") ? { mode: "cloud" } : { photos: [], cursor: null });
  });
  await view.mount();
  assert.equal(requests.length, 1);
  assert.equal(view.prompts(), 0);
  assert.equal(view.element(".album-refresh").textContent, "输入团队密码");
  await view.element(".album-refresh").listeners.click();
  assert.equal(view.prompts(), 1);
  assert.equal(requests[1].options.headers.authorization, "Bearer new-password");
  assert.equal(view.element(".album-message").textContent, "相册已更新");
  assert.equal(view.localOpens(), 0);
});

test("rejected saved passwords are cleared and can be retried", async () => {
  const view = fixture(async (url) => url.endsWith("/config")
    ? Response.json({ mode: "cloud" })
    : Response.json({ error: "请使用正确的团队密码打开相册" }, { status: 401 }), "expired-password");
  await view.mount();
  assert.equal(view.session.size, 0);
  assert.equal(view.element(".album-refresh").textContent, "输入团队密码");
  assert.equal(view.element(".album-refresh").disabled, false);
  assert.equal(view.element(".album-message").dataset.error, "true");
  assert.equal(view.localOpens(), 0);
});
