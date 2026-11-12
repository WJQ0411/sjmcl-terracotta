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

await build({
  entryPoints: [path.join(root, "src/shared/port-source.ts")],
  outfile: path.join(outDir, "port-source.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node18"],
  logLevel: "silent",
});

const client = await import(path.join(outDir, "client.mjs"));
const ports = await import(path.join(outDir, "port-source.mjs"));

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

console.log("port sources");
check("settings port wins", ports.isValidPort(24000));
check("port 0 rejected", !ports.isValidPort(0));
check("port 70000 rejected", !ports.isValidPort(70000));
check(
  "lock file decodes big endian port",
  ports.decodeLockPort(new Uint8Array([0xb1, 0x25])) === 45349,
  String(ports.decodeLockPort(new Uint8Array([0xb1, 0x25])))
);
check("short lock payload ignored", ports.decodeLockPort(new Uint8Array([1])) === null);
check(
  "array payload normalized",
  ports.decodeLockPort(ports.toBytes([0x5d, 0xc0])) === 24000
);
check(
  "array-like payload normalized",
  ports.decodeLockPort(ports.toBytes({ 0: 0x5d, 1: 0xc0 })) === 24000
);
check("port file parsed", ports.parsePortFile('{"port":45821}') === 45821);
check("broken port file ignored", ports.parsePortFile("nope") === null);
check(
  "lock candidates include temp dir",
  ports.lockFileCandidates("/var/folders/xx").includes(
    "/var/folders/xx/terracotta/terracotta.lock"
  )
);
check(
  "hmcl command quotes spaces",
  ports.hmclLaunchCommand("/opt/Terracotta App/terracotta", "/a b/port.json") ===
    '"/opt/Terracotta App/terracotta" --hmcl "/a b/port.json"'
);

console.log("port candidate ordering");
const fakeDeps = (portFileRaw, lockBytes) => ({
  readPortFile: async () => {
    if (portFileRaw === null) throw new Error("missing");
    return portFileRaw;
  },
  invoke: async (command) => {
    if (command === "plugin:path|resolve_directory") return "/tmp";
    if (lockBytes) return lockBytes;
    throw new Error("no lock file");
  },
});
const ordered = await ports.collectPortCandidates(fakeDeps('{"port":45821}', new Uint8Array([0x2d, 0x03])), {
  port: 11451,
  cachedPort: 36000,
});
check(
  "default port first, then file, then lock, then remembered",
  ordered.map((item) => `${item.port}:${item.source}`).join("|") ===
    "11451:settings|45821:portFile|11523:lockFile|36000:remembered",
  ordered.map((item) => `${item.port}:${item.source}`).join("|")
);
const noFile = await ports.collectPortCandidates(fakeDeps(null, null), {
  port: 11451,
  cachedPort: 0,
});
check("only preferred port when nothing else exists", noFile.length === 1 && noFile[0].port === 11451);
const dedup = await ports.collectPortCandidates(fakeDeps('{"port":11451}', null), {
  port: 11451,
  cachedPort: 11451,
});
check("duplicates removed", dedup.length === 1 && dedup[0].source === "settings");

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
