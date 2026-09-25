import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png" };

createServer(async (request, response) => {
  try {
    const relative = request.url === "/" ? "index.html" : request.url.slice(1).split("?")[0];
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error("Invalid path");
    let body = await readFile(file);
    if (relative === "trip-data.json") {
      const data = JSON.parse(body);
      data.config.persistence.mode = "local";
      body = JSON.stringify(data);
    }
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch (_) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(4173, "0.0.0.0", () => console.log("Local URL: http://127.0.0.1:4173 (same-network devices can use this computer's LAN address)"));
