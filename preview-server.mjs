import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };

createServer(async (request, response) => {
  try {
    if (request.url === "/api/photos/config") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ mode: "local" }));
      return;
    }
    const relative = request.url.split("?")[0] === "/" ? "index.html" : request.url.slice(1).split("?")[0];
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error("Invalid path");
    let body = await readFile(file);
    if (extname(file) === ".json" && relative !== "trips.json") {
      const data = JSON.parse(body);
      if (data.config?.persistence) {
        data.config.persistence.mode = "local";
        body = JSON.stringify(data);
      }
    }
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch (_) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(4173, "127.0.0.1", () => console.log("Local URL: http://127.0.0.1:4173"));
