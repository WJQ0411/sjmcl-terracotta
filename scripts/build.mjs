// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, "sjmcl.ext.json"), "utf8"));
const outDir = path.join(root, "build", manifest.identifier);
const packageMode = process.argv.includes("--package");

// Keep the launcher-side runtime data (settings.json) across rebuilds.
const dataDir = path.join(outDir, "data");
const backup = path.join(root, ".cache-data");
if (existsSync(dataDir)) {
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(backup, { recursive: true });
  execFileSync("cp", ["-a", `${dataDir}/.`, backup]);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "frontend"), { recursive: true });

const result = await build({
  entryPoints: [path.join(root, "src/index.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2017"],
  write: false,
  charset: "utf8",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  minifyWhitespace: packageMode,
  minifySyntax: packageMode,
  logLevel: "info",
});

const bundled = result.outputFiles[0].text.replace(
  /^(?:\uFEFF)?(?:"use strict"|'use strict');\s*/,
  ""
);
writeFileSync(path.join(outDir, "frontend/index.js"), bundled);
writeFileSync(
  path.join(outDir, "sjmcl.ext.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);

for (const asset of ["icon.png", "README.md"]) {
  const from = path.join(root, asset);
  if (existsSync(from)) copyFileSync(from, path.join(outDir, asset));
}
if (existsSync(path.join(root, "assets"))) {
  execFileSync("cp", ["-a", path.join(root, "assets"), path.join(outDir, "assets")]);
}

if (existsSync(backup)) {
  mkdirSync(dataDir, { recursive: true });
  execFileSync("cp", ["-a", `${backup}/.`, dataDir]);
  rmSync(backup, { recursive: true, force: true });
}

const archive = path.join(root, "build", `${manifest.identifier}-${manifest.version}.sjmclx`);
if (packageMode) {
  rmSync(archive, { force: true });
  execFileSync("zip", ["-qr", archive, manifest.identifier], {
    cwd: path.join(root, "build"),
  });
}

const size = (readFileSync(path.join(outDir, "frontend/index.js")).length / 1024).toFixed(1);
console.log(`\n[build] ${manifest.identifier} v${manifest.version}`);
console.log(`[build] frontend/index.js  ${size} KB`);
console.log(`[build] output: ${outDir}`);
if (packageMode) console.log(`[build] package: ${archive}`);
