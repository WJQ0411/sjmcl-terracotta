// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Tests for extension path resolution, including the asset-URL fallback that
 * fixes "core path not found" after a download.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".test");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/shared/extension-paths.ts")],
  outfile: path.join(outDir, "extension-paths.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node18"],
  logLevel: "silent",
});

const paths = await import(path.join(outDir, "extension-paths.mjs"));

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
};

const linuxUrl =
  "asset://localhost/home/jack/.local/share/SJMCL/UserContent/Extensions/io.github.wjq0411.sjmcl-terracotta/sjmcl.ext.json";
check(
  "linux asset url decoded",
  paths.assetUrlToPath(linuxUrl) ===
    "/home/jack/.local/share/SJMCL/UserContent/Extensions/io.github.wjq0411.sjmcl-terracotta/sjmcl.ext.json",
  paths.assetUrlToPath(linuxUrl)
);
check(
  "dirname gives extension root",
  paths.dirnameOf(paths.assetUrlToPath(linuxUrl)) ===
    "/home/jack/.local/share/SJMCL/UserContent/Extensions/io.github.wjq0411.sjmcl-terracotta"
);

const encodedUrl =
  "asset://localhost/home/jack/My%20Games/SJMCL/UserContent/Extensions/x.y.z/sjmcl.ext.json";
check(
  "percent encoded spaces",
  paths.assetUrlToPath(encodedUrl).includes("My Games"),
  paths.assetUrlToPath(encodedUrl)
);

const windowsUrl =
  "http://asset.localhost/C%3A%5CUsers%5Cjack%5CAppData%5CRoaming%5CSJMCL%5CUserContent%5CExtensions%5Cx.y.z%5Csjmcl.ext.json";
check(
  "windows asset url decoded without leading slash",
  paths.assetUrlToPath(windowsUrl) ===
    "C:\\Users\\jack\\AppData\\Roaming\\SJMCL\\UserContent\\Extensions\\x.y.z\\sjmcl.ext.json",
  paths.assetUrlToPath(windowsUrl)
);
check("bad url rejected", paths.assetUrlToPath("not-a-url") === null);

check(
  "join keeps posix separator",
  paths.joinPath("/a/b", "data", "core/terracotta") === "/a/b/data/core/terracotta"
);
check(
  "join keeps windows separator",
  paths.joinPath("C:\\a\\b", "data", "core/terracotta") ===
    "C:\\a\\b\\data\\core\\terracotta"
);
check("join strips duplicate separators", paths.joinPath("/a/", "/data/", "x") === "/a/data/x");

const host = { actions: { invoke: async () => { throw new Error("not allowed"); } } };
const api = {
  identifier: "io.github.wjq0411.sjmcl-terracotta",
  resolveAssetUrl: (p) => `${linuxUrl.replace("sjmcl.ext.json", p)}`,
};
const dataFile = await paths.resolveExtensionDataFile(api, host, "core/terracotta");
check(
  "data file resolved through asset url",
  dataFile ===
    "/home/jack/.local/share/SJMCL/UserContent/Extensions/io.github.wjq0411.sjmcl-terracotta/data/core/terracotta",
  String(dataFile)
);

const windowsApi = {
  identifier: "x.y.z",
  resolveAssetUrl: (p) => windowsUrl.replace("sjmcl.ext.json", p),
};
const windowsData = await paths.resolveExtensionDataFile(windowsApi, host, "core/terracotta.exe");
check(
  "windows data file resolved through asset url",
  windowsData ===
    "C:\\Users\\jack\\AppData\\Roaming\\SJMCL\\UserContent\\Extensions\\x.y.z\\data\\core\\terracotta.exe",
  String(windowsData)
);

// When the asset URL is unusable, the path plugin is used as a fallback.
const brokenApi = {
  identifier: "x.y.z",
  resolveAssetUrl: () => {
    throw new Error("asset unavailable");
  },
};
const pluginHost = {
  actions: {
    invoke: async (command, payload) => {
      if (command === "plugin:path|resolve_directory" && payload.directory === "AppData") {
        return "/home/jack/.local/share/SJMCL";
      }
      if (command === "plugin:path|join") {
        return (payload.paths ?? []).join("/");
      }
      throw new Error("unsupported");
    },
  },
};
const fallback = await paths.resolveExtensionDataFile(brokenApi, pluginHost, "core/terracotta");
check(
  "falls back to path plugin",
  fallback ===
    "/home/jack/.local/share/SJMCL/UserContent/Extensions/x.y.z/data/core/terracotta",
  String(fallback)
);

const nothingApi = { identifier: "x.y.z", resolveAssetUrl: () => "" };
const nothing = await paths.resolveExtensionDataFile(nothingApi, host, "core/terracotta");
check("returns null when nothing works", nothing === null);

rmSync(outDir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall path tests passed");
