// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Live check against the real Terracotta repository: resolves the latest
 * release, downloads the archive for this machine and unpacks it. Network
 * required, so it is not part of `npm test`.
 *
 * Usage: node scripts/live-download-test.mjs [--dry-run]
 */
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".test");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/shared/terracotta-download.ts")],
  outfile: path.join(outDir, "download.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node18"],
  logLevel: "silent",
});

const dl = await import(path.join(outDir, "download.mjs"));
const dryRun = process.argv.includes("--dry-run");

const release = await fetch(dl.LATEST_RELEASE_API, {
  headers: { Accept: "application/vnd.github+json", "User-Agent": "sjmcl-terracotta-ci" },
}).then((response) => {
  if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
  return response.json();
});

const target = dl.detectTarget(process.env.FAKE_UA ?? "linux x86_64");
const asset = dl.pickAsset(release.assets ?? [], target);
console.log(`latest: ${release.tag_name}`);
console.log(`target: ${target.os}-${target.arch}`);
console.log(`asset:  ${asset ? `${asset.name} (${dl.formatBytes(asset.size)})` : "none"}`);
if (!asset) throw new Error("no matching asset for this platform");

if (dryRun) {
  rmSync(outDir, { recursive: true, force: true });
  process.exit(0);
}

const started = Date.now();
const archive = new Uint8Array(
  await fetch(asset.browser_download_url).then((response) => {
    if (!response.ok) throw new Error(`download HTTP ${response.status}`);
    return response.arrayBuffer();
  })
);
const payload = dl.unpackRelease(archive);
const base64 = dl.toBase64(payload.data);
writeFileSync(path.join(outDir, "unpacked.bin"), payload.data);
writeFileSync(path.join(outDir, "unpacked.b64"), base64);

const head = Buffer.from(payload.data.subarray(0, 4));
console.log(`downloaded: ${dl.formatBytes(archive.length)} in ${Date.now() - started} ms`);
console.log(`unpacked:   ${payload.name} (${dl.formatBytes(payload.data.length)})`);
console.log(`magic:      ${head.toString("hex")} ${head.toString("hex") === "7f454c46" ? "(ELF)" : ""}`);
console.log(`base64:     ${dl.formatBytes(base64.length)}`);

if (payload.data.length < 1_000_000) {
  throw new Error("unpacked binary looks suspiciously small");
}

rmSync(outDir, { recursive: true, force: true });
console.log("live download test passed");
