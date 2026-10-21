const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ORIGINAL = 25 * 1024 * 1024;
const MAX_PREVIEW = 3 * 1024 * 1024;
const MAX_REQUEST = MAX_ORIGINAL + MAX_PREVIEW + 65536;
const JSON_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (data, status = 200) => Response.json(data, { status, headers: JSON_HEADERS });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

async function readUpload(request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) fail(400, "请选择照片后上传");
  if (!request.body) fail(400, "照片上传内容不完整，请重试");
  if (Number(request.headers.get("content-length")) > MAX_REQUEST) fail(413, "上传内容过大，原图上限为 25 MB");
  let received = 0;
  const bounded = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_REQUEST) fail(413, "上传内容过大，原图上限为 25 MB");
      controller.enqueue(chunk);
    }
  }));
  let form;
  try { form = await new Response(bounded, { headers: request.headers }).formData(); }
  catch (error) {
    if (received > MAX_REQUEST) fail(413, "上传内容过大，原图上限为 25 MB");
    fail(400, "照片上传内容不完整，请重试");
  }
  const original = form.get("original");
  const preview = form.get("preview");
  if (!(original instanceof File) || !(preview instanceof File)) fail(400, "原图与浏览版缺一不可");
  if (!original.size || original.size > MAX_ORIGINAL || !preview.size || preview.size > MAX_PREVIEW) {
    fail(413, "原图须小于 25 MB，浏览版须小于 3 MB");
  }
  for (const [file, isPreview] of [[original, false], [preview, true]]) {
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    const webp = new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
    if (isPreview ? file.type !== "image/jpeg" || !jpeg : !({ "image/jpeg": jpeg, "image/png": png, "image/webp": webp })[file.type]) {
      fail(415, "支持 JPG、PNG、WebP 原图，浏览版须为 JPEG");
    }
  }
  return { original, preview };
}

function photoInfo(object, tripId) {
  const data = object.customMetadata;
  const id = object.key.split("/").pop();
  return {
    id, name: data.name, uploadedAt: data.uploadedAt, expiresAt: data.expiresAt,
    originalAvailable: Date.now() < Date.parse(data.expiresAt),
    previewUrl: `/api/photos/${tripId}/${id}/preview`,
    originalUrl: `/api/photos/${tripId}/${id}/original`
  };
}

export async function handlePhotoRequest(request, env, canEdit) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/photos/")) return null;
  try {
    if (url.pathname === "/api/photos/config" && request.method === "GET") {
      return json({ mode: env.TRIP_PHOTOS && env.TRIP_EDIT_TOKEN ? "cloud" : "unavailable" });
    }
    const route = url.pathname.match(/^\/api\/photos\/([a-z0-9][a-z0-9-]{0,119})(?:\/([a-f0-9-]{36})(?:\/(preview|original))?)?$/);
    if (!route) fail(404, "照片地址无效");
    if (!env.TRIP_PHOTOS || !env.TRIP_EDIT_TOKEN) fail(503, "共享相册尚未开通，请稍后再试");
    if (!await canEdit(request, env)) fail(401, "请使用正确的团队密码打开相册");
    const [, tripId, id, variant] = route;
    const catalog = await env.ASSETS.fetch(new Request(new URL("/trips.json", request.url)));
    if (!catalog.ok) fail(503, "旅行列表暂时无法读取");
    if (!(await catalog.json()).some((trip) => trip.id === tripId)) fail(404, "这次旅行不在集合中");
    const bucket = env.TRIP_PHOTOS;
    const previewKey = `previews/${tripId}/${id}`;
    const originalKey = `originals/${tripId}/${id}`;

    if (!id && request.method === "GET") {
      const result = await bucket.list({ prefix: `previews/${tripId}/`, limit: 24,
        cursor: url.searchParams.get("cursor") || undefined, include: ["customMetadata"] });
      return json({ photos: result.objects.filter((item) => item.customMetadata?.ready === "true").map((item) => photoInfo(item, tripId)),
        cursor: result.truncated ? result.cursor : null });
    }
    if (!id && request.method === "POST") {
      const { original, preview } = await readUpload(request);
      const photoId = crypto.randomUUID();
      const uploadedAt = new Date(Date.now()).toISOString();
      const expiresAt = new Date(Date.now() + RETENTION_MS).toISOString();
      const metadata = { name: Array.from(original.name).slice(0, 160).join(""), uploadedAt, expiresAt, ready: "false" };
      const originalPath = `originals/${tripId}/${photoId}`;
      const previewPath = `previews/${tripId}/${photoId}`;
      const previewOptions = { httpMetadata: { contentType: "image/jpeg" }, customMetadata: metadata };
      try {
        const saved = await bucket.put(previewPath, preview.stream(), previewOptions);
        const verified = await bucket.head(previewPath);
        if (!saved || !verified || verified.etag !== saved.etag || verified.size !== preview.size) {
          fail(503, "浏览版保存未确认，原图尚未上传，请重试");
        }
        await bucket.put(originalPath, original.stream(), { httpMetadata: { contentType: original.type }, customMetadata: { uploadedAt, expiresAt } });
        const committed = await bucket.put(previewPath, preview.stream(), {
          ...previewOptions, customMetadata: { ...metadata, ready: "true" }
        });
        return json(photoInfo(committed, tripId), 201);
      } catch (error) {
        // Never leave a retained original without its verified browsing copy.
        await bucket.delete(originalPath);
        await bucket.delete(previewPath);
        throw error;
      }
    }
    if (id && !variant && request.method === "DELETE") {
      await bucket.delete(originalKey);
      await bucket.delete(previewKey);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
    if (id && variant && request.method === "GET") {
      const preview = await bucket.head(previewKey);
      if (preview?.customMetadata?.ready !== "true") fail(404, "照片不存在或尚未上传完成");
      if (variant === "original" && Date.now() >= Date.parse(preview.customMetadata.expiresAt)) {
        fail(410, "原图已满 30 天，请下载浏览版");
      }
      const object = await bucket.get(variant === "original" ? originalKey : previewKey);
      if (!object) fail(404, "照片文件暂时无法读取");
      const filename = variant === "original" ? preview.customMetadata.name : `${preview.customMetadata.name}.jpg`;
      return new Response(object.body, { headers: {
        ...JSON_HEADERS, "content-type": object.httpMetadata.contentType,
        "content-length": String(object.size),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      } });
    }
    return json({ error: "不支持此照片操作" }, 405);
  } catch (error) {
    if (!error.status) console.error("Photo request failed", error);
    return json({ error: error.status ? error.message : "相册服务暂时不可用，请重试" }, error.status || 500);
  }
}
