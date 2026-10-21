import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../dist/trip-photos.js", import.meta.url), "utf8");
function fixture(fetch, initialToken = "") {
  const nodes = new Map();
  const element = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent: "", disabled: false, hidden: false, dataset: {}, listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      replaceChildren() {}
    });
    return nodes.get(selector);
  };
  const album = {
    dataset: { tripId: "shanghai-japan-2026" }, querySelector: element,
    querySelectorAll: () => [".album-add", ".album-refresh", ".album-more"].map(element)
  };
  const session = new Map(initialToken ? [["travel-plan:editor-token:shanghai-japan-2026", initialToken]] : []);
  let localOpens = 0, prompts = 0;
  const window = { prompt() { prompts++; return "new-password"; } };
  const context = vm.createContext({
    window, fetch, URL, Date, Intl,
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
