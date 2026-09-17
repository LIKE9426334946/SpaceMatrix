import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseShape, selectRegion } from "../public/tensor.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_DIR || path.join(root, "backend/data");
const dataFile = path.join(dataDir, "scene.json");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3044);
await mkdir(dataDir, { recursive: true });
const initial = {
  revision: 1,
  objects: [
    {
      id: randomUUID(),
      name: "tensor_01",
      shape: [3, 3, 3],
      color: "#bbc6de",
      highlight: "a[0, :, :]",
      highlightColor: "#6662e8",
    },
  ],
};
let state;
try {
  state = JSON.parse(await readFile(dataFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = initial;
  await writeFile(dataFile, JSON.stringify(state, null, 2));
}
const clients = new Set();
let writeQueue = Promise.resolve();

function validateObject(value) {
  const name = String(value.name ?? "").trim();
  if (!name || name.length > 60) throw new Error("对象名称需要 1–60 个字符。");
  const shape = parseShape(value.shape);
  const highlight = String(value.highlight ?? "").trim();
  selectRegion(shape, highlight);
  const color = value.color ?? "#bbc6de";
  const highlightColor = value.highlightColor ?? "#6662e8";
  if (![color, highlightColor].every((c) => /^#[a-f\d]{6}$/i.test(c)))
    throw new Error("颜色格式不正确。");
  return { name, shape, color, highlight, highlightColor };
}

function mutate(action) {
  const pending = writeQueue.then(async () => {
    const next = structuredClone(state);
    action(next);
    next.revision++;
    await writeFile(`${dataFile}.tmp`, JSON.stringify(next, null, 2));
    await rename(`${dataFile}.tmp`, dataFile);
    state = next;
    for (const client of clients)
      client.write(`event: scene\ndata: ${JSON.stringify(state)}\n\n`);
    return state;
  });
  writeQueue = pending.catch(() => {});
  return pending;
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768)
      throw Object.assign(new Error("请求内容过大。"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new Error("请求需要有效 JSON。");
  }
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  try {
    const url = new URL(req.url, "http://localhost");
    const route = decodeURIComponent(url.pathname);
    if (route === "/api/health" && req.method === "GET")
      return json(res, 200, { status: "ok" });
    if (route === "/api/scene" && req.method === "GET")
      return json(res, 200, state);
    if (route === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(
        `retry: 2000\nevent: scene\ndata: ${JSON.stringify(state)}\n\n`,
      );
      clients.add(res);
      const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 20000);
      req.on("close", () => {
        clients.delete(res);
        clearInterval(heartbeat);
      });
      return;
    }
    if (
      route.startsWith("/api/") &&
      ["POST", "PATCH", "DELETE"].includes(req.method)
    ) {
      // Reject cross-origin browser writes without introducing user accounts.
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        return json(res, 403, { error: "不接受跨站写入。" });
      if (req.headers["sec-fetch-site"] === "cross-site")
        return json(res, 403, { error: "不接受跨站写入。" });
      if (route === "/api/objects" && req.method === "POST") {
        const object = validateObject(await body(req));
        const saved = await mutate((next) =>
          next.objects.push({ id: randomUUID(), ...object }),
        );
        return json(res, 201, saved);
      }
      const match = route.match(/^\/api\/objects\/([\w-]+)$/);
      if (match && ["PATCH", "DELETE"].includes(req.method)) {
        const patch = req.method === "PATCH" ? await body(req) : null;
        const saved = await mutate((next) => {
          const index = next.objects.findIndex((o) => o.id === match[1]);
          if (index < 0)
            throw Object.assign(new Error("这个对象已被删除。"), {
              status: 404,
            });
          if (patch)
            next.objects[index] = {
              id: match[1],
              ...validateObject({ ...next.objects[index], ...patch }),
            };
          else next.objects.splice(index, 1);
        });
        return json(res, 200, saved);
      }
    }
    if (route.startsWith("/api/"))
      return json(res, 404, { error: "接口不存在。" });
    if (!["GET", "HEAD"].includes(req.method))
      return json(res, 405, { error: "不支持这个请求方法。" });
    const relative =
      route === "/" || route === "/admin" || route === "/admin/"
        ? "index.html"
        : route.slice(1);
    const vendor = relative.startsWith("vendor/");
    const base = vendor
      ? path.join(root, "node_modules/three")
      : path.join(root, "public");
    const filename = path.resolve(base, vendor ? relative.slice(7) : relative);
    if (!filename.startsWith(`${base}${path.sep}`))
      return json(res, 404, { error: "文件不存在。" });
    let content;
    try {
      content = await readFile(filename);
    } catch (error) {
      if (["ENOENT", "EISDIR"].includes(error.code))
        return json(res, 404, { error: "文件不存在。" });
      throw error;
    }
    res.writeHead(200, {
      "Content-Type":
        mime[path.extname(filename)] || "application/octet-stream",
      "Cache-Control": vendor ? "public, max-age=86400" : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent)
      json(res, error.status || (error.code ? 500 : 400), {
        error: error.code ? "保存失败，请检查服务器存储。" : error.message,
      });
    else res.end();
  }
});
server.listen(PORT, HOST, () =>
  console.log(`SpaceMatrix: http://${HOST}:${PORT}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const client of clients) client.end();
    server.close(() => process.exit(0));
  });
