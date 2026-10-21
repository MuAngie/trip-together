(() => {
  "use strict";
  let database;
  let configuration;
  const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_ORIGINAL = 25 * 1024 * 1024;

  function openDatabase() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open("travel-collection-photos", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("photos")) {
          const store = request.result.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
          store.createIndex("tripId", "tripId");
        }
        if (!request.result.objectStoreNames.contains("originals")) request.result.createObjectStore("originals", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => { database = null; throw error; });
    return database;
  }

  async function transaction(mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["photos", "originals"], mode);
      const request = operation(tx.objectStore("photos"), tx);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("照片未保存"));
    });
  }

  async function list(tripId) {
    const photos = await transaction("readonly", (store) => store.index("tripId").getAll(tripId));
    for (const photo of photos) {
      photo.originalAvailable = Boolean(photo.expiresAt && Date.now() < Date.parse(photo.expiresAt));
      if (photo.expiresAt && !photo.originalAvailable && photo.blob?.size) {
        await transaction("readwrite", (_, tx) => tx.objectStore("originals").delete(photo.id));
      }
    }
    return photos;
  }
  const save = (tripId, original, blob) => transaction("readwrite", (store, tx) => {
    const uploadedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + RETENTION_MS).toISOString();
    const request = store.add({ tripId, name: original.name, blob, uploadedAt, expiresAt });
    request.onsuccess = () => tx.objectStore("originals").put({ id: request.result, blob: original });
    return request;
  });
  const remove = (id) => transaction("readwrite", (store, tx) => {
    tx.objectStore("originals").delete(id);
    return store.delete(id);
  });
  const originalBlob = (id) => transaction("readonly", (_, tx) => tx.objectStore("originals").get(id));

  async function getConfiguration() {
    if (!configuration) configuration = fetch("/api/photos/config", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("无法确认相册保存位置，请刷新重试");
      const config = await response.json();
      if (!["local", "cloud", "unavailable"].includes(config.mode)) throw new Error("相册配置不正确");
      return config;
    }).catch((error) => { configuration = null; throw error; });
    return configuration;
  }

  async function resize(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("无法读取这张照片，请使用 JPG、PNG 或 WebP 格式"));
        image.src = url;
      });
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#f2f5f2";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("照片转换失败")), "image/jpeg", .88));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function mount(album) {
    const tripId = album.dataset.tripId;
    const input = album.querySelector(".album-input");
    const add = album.querySelector(".album-add");
    const grid = album.querySelector(".album-grid");
    const message = album.querySelector(".album-message");
    const refresh = album.querySelector(".album-refresh");
    const more = album.querySelector(".album-more");
    const note = album.querySelector(".album-note");
    const tokenKey = `travel-plan:editor-token:${encodeURIComponent(tripId)}`;
    const endpoint = `/api/photos/${encodeURIComponent(tripId)}`;
    let mode, token = "", photos = [], cursor = null, busy = false;
    try { token = sessionStorage.getItem(tokenKey) || ""; } catch { /* Private browsing can disable session storage. */ }
    let urls = [];
    const notify = (text, error = false) => {
      message.textContent = text;
      message.dataset.error = String(error);
    };
    const objectUrl = (blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
    function authorize() {
      if (mode !== "cloud" || token) return true;
      token = String(window.prompt("请输入团队密码，查看或上传旅行照片") || "").trim();
      try { if (token) sessionStorage.setItem(tokenKey, token); } catch { /* Keep the token in memory for this page. */ }
      return Boolean(token);
    }
    async function api(path = "", options = {}) {
      const response = await fetch(endpoint + path, { ...options, cache: "no-store", headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) {
        if (response.status === 401) {
          token = "";
          try { sessionStorage.removeItem(tokenKey); } catch { /* No persistent token. */ }
          refresh.textContent = "输入团队密码";
        }
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "照片操作失败，请重试");
      }
      return response;
    }
    async function run(action) {
      if (busy) return;
      busy = true;
      album.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      try { await action(); }
      catch (error) { notify(error.message || "照片操作失败，请重试", true); }
      finally {
        busy = false;
        album.querySelectorAll("button").forEach((button) => { button.disabled = button !== refresh && (!mode || mode === "unavailable"); });
      }
    }
    async function render(append = false) {
      const previousCount = photos.length;
      if (mode === "local") photos = await list(tripId);
      else {
        const page = await (await api(append && cursor ? `?cursor=${encodeURIComponent(cursor)}` : "")).json();
        photos = append ? [...photos, ...page.photos] : page.photos;
        cursor = page.cursor;
      }
      if (!append) {
        urls.forEach((url) => URL.revokeObjectURL(url));
        urls = [];
        grid.replaceChildren();
      }
      album.querySelector(".album-count").textContent = photos.length ? `${photos.length} 张${cursor ? "（还有更多）" : ""}` : "";
      album.querySelector(".album-empty").hidden = photos.length > 0;
      more.hidden = !cursor;
      refresh.textContent = "刷新相册";
      const thumbnails = (append ? photos.slice(previousCount) : photos).map(async (photo) => {
        const figure = document.createElement("figure");
        const link = document.createElement("a");
        link.target = "_blank";
        link.rel = "noopener";
        link.setAttribute("aria-label", `查看照片：${photo.name}（新窗口）`);
        const image = document.createElement("img");
        image.alt = photo.name;
        image.loading = "lazy";
        link.append(image);
        const caption = document.createElement("figcaption");
        const name = document.createElement("span");
        name.textContent = photo.name;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "album-remove";
        button.textContent = "移除";
        button.setAttribute("aria-label", `移除照片：${photo.name}`);
        button.addEventListener("click", async () => {
          if (busy || !window.confirm(`移除“${photo.name}”的${mode === "cloud" ? "共享" : "本机"}浏览版与原图？设备相册里的原文件不会删除。`)) return;
          await run(async () => {
            if (!authorize()) return;
            if (mode === "local") await remove(photo.id);
            else await api(`/${photo.id}`, { method: "DELETE" });
            await render(); notify("照片已移除");
          });
        });
        caption.append(name, button);
        const status = document.createElement("p");
        status.className = "album-retention";
        status.textContent = photo.originalAvailable
          ? `原图保留至 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(photo.expiresAt))}`
          : photo.expiresAt ? "原图已到期 · 浏览版长期保留" : "本机旧照片 · 仅有浏览版";
        const download = document.createElement("button");
        download.type = "button";
        download.className = "album-download";
        download.textContent = photo.originalAvailable ? "下载原图" : "下载浏览版";
        download.addEventListener("click", () => run(async () => {
          if (!authorize()) return;
          const wantsOriginal = photo.originalAvailable && Date.now() < Date.parse(photo.expiresAt);
          const blob = mode === "local"
            ? wantsOriginal ? (await originalBlob(photo.id))?.blob : photo.blob
            : await (await api(`/${photo.id}/${wantsOriginal ? "original" : "preview"}`)).blob();
          if (!blob) throw new Error("文件暂时无法读取，请刷新相册");
          const anchor = document.createElement("a");
          anchor.href = objectUrl(blob);
          anchor.download = wantsOriginal ? photo.name : `${photo.name.replace(/\.[^.]+$/, "")}-浏览版.jpg`;
          document.body.append(anchor); anchor.click(); anchor.remove();
        }));
        figure.append(link, caption, status, download);
        grid.append(figure);
        try {
          const blob = mode === "local" ? photo.blob : await (await api(`/${photo.id}/preview`)).blob();
          image.src = link.href = objectUrl(blob);
        } catch (error) { image.alt = "照片加载失败，请刷新相册"; throw error; }
      });
      const results = await Promise.allSettled(thumbnails);
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    }
    add.addEventListener("click", () => { if (!busy && ["local", "cloud"].includes(mode) && authorize()) input.click(); });
    refresh.addEventListener("click", () => run(async () => {
      if (!mode || mode === "unavailable") { configuration = null; await initialize(); return; }
      if (authorize()) { await render(); notify("相册已更新"); }
    }));
    more.addEventListener("click", () => run(() => render(true)));
    input.addEventListener("change", async () => {
      const files = [...input.files];
      if (!files.length) return;
      await run(async () => {
        let saved = 0;
        const failures = [];
        for (const file of files) {
          notify(`正在${mode === "cloud" ? "上传" : "保存"} ${saved + failures.length + 1} / ${files.length}…`);
          try {
            if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请转换为 JPG、PNG 或 WebP 后上传");
            if (!file.size || file.size > MAX_ORIGINAL) throw new Error("原图上限为 25 MB");
            const preview = await resize(file);
            if (preview.size > 3 * 1024 * 1024) throw new Error("浏览版超过 3 MB，请选择较小的照片");
            if (mode === "local") await save(tripId, file, preview);
            else {
              const form = new FormData();
              form.append("original", file, file.name);
              form.append("preview", preview, "preview.jpg");
              await api("", { method: "POST", body: form });
            }
            saved++;
          } catch (error) { failures.push(`${file.name}：${error.message}`); }
        }
        await render();
        notify(`已${mode === "cloud" ? "上传" : "保存到本机"} ${saved} 张。${failures.join("；")}`, failures.length > 0);
      });
      input.value = "";
    });

    async function initialize() {
      mode = (await getConfiguration()).mode;
      if (mode === "unavailable") {
        note.textContent = "共享相册尚未开通，暂时无法上传照片。";
        album.querySelector(".album-empty").hidden = true;
        return;
      }
      note.textContent = mode === "local"
        ? "本地预览：照片仅存此浏览器。原图保留 30 天，满期后在下次打开相册时清理；浏览版继续保留。清除网站数据会移除照片，请保留原文件。"
        : "团队共享相册：原图保留 30 天，到期后仅保留浏览版，请另存原文件。原先仅存浏览器的照片不会自动上传。";
      note.textContent += " 支持 JPG、PNG、WebP，每张原图上限 25 MB。";
      if (mode === "cloud" && !token) {
        refresh.textContent = "输入团队密码";
        album.querySelector(".album-empty").hidden = true;
        return;
      }
      await render();
    }
    await run(initialize);
  }

  window.TripPhotos = Object.freeze({ mount });
})();
