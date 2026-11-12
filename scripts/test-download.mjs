// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Offline tests for the release downloader: platform detection, asset picking,
 * tar.gz unpacking and base64 encoding.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
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

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

/** Builds a minimal ustar archive with one regular file. */
function makeTar(name, content) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("000644 ", 100, 8, "utf8");
  header.write("000000 ", 108, 8, "utf8");
  header.write("000000 ", 116, 8, "utf8");
  header.write(`${content.length.toString(8).padStart(11, "0")} `, 124, 12, "utf8");
  header.write("00000000000 ", 136, 12, "utf8");
  header.write("        ", 148, 8, "utf8");
  header.write("0", 156, 1, "utf8");
  header.write("ustar  \0", 257, 8, "utf8");
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding, Buffer.alloc(1024)]);
}

console.log("detectTarget");
check(
  "linux x86_64",
  dl.detectTarget("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36").os === "linux"
);
check(
  "windows x86_64",
  dl.detectTarget("Mozilla/5.0 (Windows NT 10.0; Win64; x64)").os === "windows"
);
check(
  "macos arm64",
  JSON.stringify(dl.detectTarget("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit arm64")) ===
    JSON.stringify({ os: "macos", arch: "arm64" })
);

const assets = [
  { name: "terracotta-0.4.2-linux-x86_64-pkg.tar.gz", browser_download_url: "a", size: 1 },
  { name: "terracotta-0.4.2-linux-arm64-pkg.tar.gz", browser_download_url: "b", size: 1 },
  { name: "terracotta-0.4.2-windows-x86_64-pkg.tar.gz", browser_download_url: "c", size: 1 },
  { name: "terracotta-0.4.2-macos-arm64-pkg.tar.gz", browser_download_url: "d", size: 1 },
  { name: "terracotta-0.4.2-android-x86_64.so", browser_download_url: "e", size: 1 },
];

console.log("pickAsset");
check(
  "linux x86_64 asset",
  dl.pickAsset(assets, { os: "linux", arch: "x86_64" })?.name === assets[0].name
);
check(
  "windows asset",
  dl.pickAsset(assets, { os: "windows", arch: "x86_64" })?.name === assets[2].name
);
check(
  "macos arm64 asset",
  dl.pickAsset(assets, { os: "macos", arch: "arm64" })?.name === assets[3].name
);
check(
  "android is never picked",
  dl.pickAsset(assets, { os: "android", arch: "x86_64" }) === null
);
check(
  "missing platform returns null",
  dl.pickAsset(assets, { os: "freebsd", arch: "arm64" }) === null
);

console.log("unpackRelease");
const payload = Buffer.from("FAKE-ELF-BINARY-PAYLOAD");
const archive = gzipSync(makeTar("terracotta-0.4.2-linux-x86_64", payload));
const unpacked = dl.unpackRelease(new Uint8Array(archive));
check("tar.gz unpacks", Buffer.from(unpacked.data).equals(payload));
check("entry name kept", unpacked.name === "terracotta-0.4.2-linux-x86_64");

let threw = null;
try {
  dl.unpackRelease(new Uint8Array(gzipSync(Buffer.alloc(2048))));
} catch (error) {
  threw = error;
}
check("empty archive throws", threw instanceof Error);

console.log("toBase64");
const bytes = new Uint8Array(70000);
for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
const encoded = dl.toBase64(bytes);
check("base64 roundtrip", Buffer.from(encoded, "base64").equals(Buffer.from(bytes)));
check("handles 32-bit chunks", encoded.length > 90000);

console.log("paths");
check("linux binary name", dl.localBinaryName("linux") === "terracotta");
check("windows binary name", dl.localBinaryName("windows") === "terracotta.exe");
check("core path", dl.coreBinaryRelativePath("linux") === "core/terracotta");
check("core dir constant", dl.CORE_DIR === "core");

rmSync(outDir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall downloader tests passed");
