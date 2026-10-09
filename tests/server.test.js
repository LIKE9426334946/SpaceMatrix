import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { rotateTensor } from "../public/rotation.js";

test("HTTP CRUD, validation, SSE, concurrent updates and restart persistence", async (t) => {
  const data = await mkdtemp(path.join(tmpdir(), "spacematrix-test-"));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  let child;
  async function start() {
    child = spawn(process.execPath, ["backend/server.js"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        DATA_DIR: data,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server startup timeout")),
        10000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code) reject(new Error(`Server exited ${code}`));
      });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
  t.after(async () => {
    await stop();
    await rm(data, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const request = async (route, method = "GET", value) => {
    const res = await fetch(base + route, {
      method,
      headers: { "Content-Type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    return [res.status, await res.json()];
  };
  await start();
  assert.equal((await request("/api/health"))[0], 200);
  assert.equal((await fetch(base + "/admin")).status, 200);
  assert.equal(
    (await fetch(base + "/vendor/build/three.module.js")).status,
    200,
  );
  assert.equal((await fetch(base + "/backend/data/scene.json")).status, 404);
  const [initialStatus, initial] = await request("/api/scene");
  assert.equal(initialStatus, 200);
  assert.equal(initial.objects.length, 1);
  const abort = new AbortController();
  const sse = await fetch(base + "/api/events", { signal: abort.signal });
  const reader = sse.body.getReader();
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /event: scene/,
  );
  const input = {
    name: "batch",
    shape: [2, 3, 4, 5],
    highlight: "a[:,0,...]",
    color: "#c0c0c0",
    highlightColor: "#6662e8",
  };
  const [createdStatus, created] = await request("/api/objects", "POST", input);
  assert.equal(createdStatus, 201);
  assert.equal(created.objects.length, 2);
  const id = created.objects.at(-1).id;
  assert.match(new TextDecoder().decode((await reader.read()).value), /batch/);
  const [rotationStatus, rotated] = await request(
    `/api/objects/${id}/rotate`,
    "POST",
    { direction: "up" },
  );
  assert.equal(rotationStatus, 200);
  assert.deepEqual(
    rotated.objects.at(-1),
    rotateTensor(created.objects.at(-1), "up"),
  );
  assert.deepEqual(rotated.transition, {
    type: "rotate",
    objectId: id,
    direction: "up",
    fromRevision: created.revision,
  });
  const rotationEvent = new TextDecoder().decode((await reader.read()).value);
  assert.match(rotationEvent, /"type":"rotate"/);
  assert.match(rotationEvent, /"direction":"up"/);
  assert.equal(
    (await request("/api/scene"))[1].transition,
    undefined,
    "snapshots do not replay animations",
  );
  assert.equal(
    (
      await request(`/api/objects/${id}/rotate`, "POST", {
        direction: "invalid",
      })
    )[0],
    400,
  );
  assert.equal(
    (
      await request("/api/objects/missing/rotate", "POST", { direction: "up" })
    )[0],
    404,
  );
  abort.abort();
  await reader.cancel().catch(() => {});
  const invalid = await request("/api/objects/" + id, "PATCH", { shape: [21] });
  assert.equal(invalid[0], 400);
  assert.equal((await request("/api/scene"))[1].revision, rotated.revision);
  assert.equal(
    (
      await request("/api/objects", "POST", { ...input, highlight: "a[99]" })
    )[0],
    400,
  );
  const crossSite = await fetch(base + "/api/objects/" + id, {
    method: "DELETE",
    headers: { Origin: "https://example.com" },
  });
  assert.equal(crossSite.status, 403);
  await Promise.all([
    request("/api/objects/" + id, "PATCH", { name: "renamed" }),
    request("/api/objects/" + id, "PATCH", { highlight: "a[1,...]" }),
  ]);
  await Promise.all([
    request(`/api/objects/${id}/rotate`, "POST", { direction: "left" }),
    request(`/api/objects/${id}/rotate`, "POST", { direction: "left" }),
  ]);
  const saved = (await request("/api/scene"))[1];
  assert.equal(saved.objects.at(-1).name, "renamed");
  assert.deepEqual(saved.objects.at(-1).shape, [2, 4, 3, 5]);
  assert.equal(saved.objects.at(-1).highlight, "a[1, :, :, :]");
  assert.deepEqual(
    JSON.parse(await readFile(path.join(data, "scene.json"), "utf8")),
    saved,
  );
  await stop();
  await start();
  assert.deepEqual((await request("/api/scene"))[1], saved);
  assert.equal((await request("/api/objects/" + id, "DELETE"))[0], 200);
  assert.equal(
    (await request("/api/objects/" + initial.objects[0].id, "DELETE"))[0],
    200,
  );
  assert.equal((await request("/api/scene"))[1].objects.length, 0);
  assert.equal((await request("/api/objects/" + id, "DELETE"))[0], 404);
});
