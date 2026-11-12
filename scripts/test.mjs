// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Unit tests for the Terracotta client against a fake Terracotta HTTP API.
 *
 * Terracotta itself listens on a random loopback port, so the client is tested
 * through a stub server that mirrors the upstream routes in src/server/states.rs.
 */
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".test");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/shared/terracotta.ts")],
  outfile: path.join(outDir, "client.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node18"],
  logLevel: "silent",
});

const client = await import(path.join(outDir, "client.mjs"));

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- fake server
const state = {
  state: "waiting",
  index: 0,
  room: undefined,
  calls: [],
};

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  state.calls.push(`${url.pathname}${url.search}`);

  if (url.pathname === "/meta") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        version: "0.3.1",
        easytier_version: "2.4.5",
        target_os: "linux",
        yggdrasil_port: 25599,
      })
    );
    return;
  }

  if (url.pathname === "/state") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ state: state.state, index: state.index, room: state.room }));
    return;
  }

  if (url.pathname === "/state/scanning") {
    if (state.state !== "waiting") {
      res.writeHead(200);
      res.end();
      return;
    }
    state.state = "host-ok";
    state.room = "U/AB12-CD34-EF56-GH78";
    res.writeHead(200);
    res.end();
    return;
  }

  if (url.pathname === "/state/guesting") {
    const room = url.searchParams.get("room") ?? "";
    if (!/^U\/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(room)) {
      res.writeHead(400);
      res.end();
      return;
    }
    state.state = "guest-ok";
    state.room = room;
    res.writeHead(200);
    res.end();
    return;
  }

  if (url.pathname === "/state/ide") {
    state.state = "waiting";
    state.room = undefined;
    res.writeHead(200);
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const doFetch = (input, init) => fetch(input, init);

// ------------------------------------------------------------------- test cases
console.log("normalizeRoomCode");
check(
  "canonical code",
  client.normalizeRoomCode("U/ab12-cd34-ef56-gh78") === "U/AB12-CD34-EF56-GH78"
);
check(
  "code embedded in chat text",
  client.normalizeRoomCode("来玩！联机码 U/AB12-CD34-EF56-GH78 速进") ===
    "U/AB12-CD34-EF56-GH78"
);
check("garbage rejected", client.normalizeRoomCode("hello world") === null);
check("empty rejected", client.normalizeRoomCode("") === null);

console.log("fetchMeta");
const meta = await client.fetchMeta(port, doFetch);
check("detects terracotta", meta?.version === "0.3.1", JSON.stringify(meta));
const wrongMeta = await client.fetchMeta(port + 1, doFetch, 300);
check("closed port returns null", wrongMeta === null);

console.log("discoverPort");
const discovered = await client.discoverPort({
  doFetch,
  platform: "linux",
  preferredPorts: [port],
});
check("preferred port wins", discovered === port, String(discovered));
const notFound = await client.discoverPort({
  doFetch,
  platform: "linux",
  preferredPorts: [],
  concurrency: 64,
  signal: (() => {
    const c = new AbortController();
    setTimeout(() => c.abort(), 60);
    return c.signal;
  })(),
}).catch((error) => error);
check(
  "scan aborts cleanly",
  notFound instanceof client.TerracottaError && notFound.code === "aborted"
);

console.log("scanRanges");
const linux = client.scanRanges("linux");
check("linux starts with ephemeral range", linux[0][0] === 32768 && linux[0][1] === 60999);
const windows = client.scanRanges("windows");
check("windows starts with 49152", windows[0][0] === 49152);

console.log("room lifecycle");
await client.startHost(port, { player: "Steve" }, doFetch);
const hosted = await client.fetchState(port, doFetch);
check("host becomes host-ok", hosted.state === "host-ok", hosted.state);
check("room code surfaces", hosted.room === "U/AB12-CD34-EF56-GH78", hosted.room);
check(
  "player forwarded to terracotta",
  state.calls.some((call) => call.includes("player=Steve")),
  state.calls.join(" | ")
);

await client.stopRoom(port, doFetch);
const idle = await client.fetchState(port, doFetch);
check("stop returns to waiting", idle.state === "waiting", idle.state);

await client.joinRoom(port, { code: "u/ab12-cd34-ef56-gh78", player: "Alex" }, doFetch);
const joined = await client.fetchState(port, doFetch);
check("guest joins", joined.state === "guest-ok", joined.state);

const invalid = await client
  .joinRoom(port, { code: "nope" }, doFetch)
  .catch((error) => error);
check(
  "invalid code rejected before request",
  invalid instanceof client.TerracottaError && invalid.code === "invalid-code"
);

console.log("error handling");
const offline = await client
  .fetchState(port + 1, doFetch, 500)
  .catch((error) => error);
check("offline port raises not-running", offline?.code === "not-running", String(offline));

console.log("state labels");
check("label host-ok", client.stateLabel("host-ok").length > 0);
check("colour host-ok", client.stateColor("host-ok") === "green");

server.close();
rmSync(outDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
