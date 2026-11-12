// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Terracotta release downloader.
 *
 * Upstream ships one `terracotta-<version>-<os>-<arch>-pkg.tar.gz` per platform
 * that contains a single executable. The launcher extension resolves the latest
 * release through the GitHub API, downloads the matching archive into the
 * extension data directory and unpacks the binary there, so the launcher can
 * (optionally) start it later.
 */
import { gunzipSync } from "fflate";

export const LATEST_RELEASE_API =
  "https://api.github.com/repos/burningtnt/Terracotta/releases/latest";
export const LATEST_RELEASE_PAGE =
  "https://github.com/burningtnt/Terracotta/releases/latest";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface LatestRelease {
  tag_name: string;
  name?: string;
  html_url?: string;
  assets: ReleaseAsset[];
}

export type TargetOs = "windows" | "macos" | "linux" | "freebsd" | "android";
export type TargetArch = "x86_64" | "arm64" | "riscv64" | "loongarch64" | "x86";

export interface ReleaseTarget {
  os: TargetOs;
  arch: TargetArch;
}

export function detectTarget(userAgent: string): ReleaseTarget {
  const ua = userAgent.toLowerCase();

  let os: TargetOs = "linux";
  if (ua.includes("windows") || ua.includes("win32")) os = "windows";
  else if (ua.includes("mac os") || ua.includes("macintosh")) os = "macos";
  else if (ua.includes("freebsd")) os = "freebsd";
  else if (ua.includes("android")) os = "android";

  let arch: TargetArch = "x86_64";
  if (ua.includes("aarch64") || ua.includes("arm64")) arch = "arm64";
  else if (ua.includes("riscv64")) arch = "riscv64";
  else if (ua.includes("loongarch64")) arch = "loongarch64";
  else if (/i686|i386|x86(?![_a-z])/.test(ua)) arch = "x86";

  return { os, arch };
}

/**
 * Picks the release asset for a target. Asset names look like
 * `terracotta-0.4.2-linux-x86_64-pkg.tar.gz`; Android ships `.so` files that
 * cannot be launched as a desktop process, so they are ignored.
 */
export function pickAsset(
  assets: ReleaseAsset[],
  target: ReleaseTarget
): ReleaseAsset | null {
  const wanted = `-${target.os}-${target.arch}-pkg.tar.gz`;
  const exact = assets.find((asset) => asset.name.endsWith(wanted));
  if (exact) return exact;

  // The 32-bit x86 build is published as `x86` for Windows and as `i686` for
  // other platforms in some versions.
  if (target.arch === "x86") {
    return (
      assets.find((asset) => asset.name.endsWith(`-${target.os}-i686-pkg.tar.gz`)) ??
      null
    );
  }

  return null;
}

function readOctal(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let i = offset; i < offset + length; i += 1) {
    const char = bytes[i];
    if (char === 0 || char === 32) continue;
    if (char < 48 || char > 55) break;
    value = value * 8 + (char - 48);
  }
  return value;
}

function readName(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let i = offset; i < offset + length; i += 1) {
    const char = bytes[i];
    if (char === 0) break;
    text += String.fromCharCode(char);
  }
  return text.trim();
}

export interface ExtractedFile {
  name: string;
  data: Uint8Array;
}

/**
 * Extracts the payload from a (ustar) tar archive. Terracotta archives contain a
 * single file, so the largest regular entry wins.
 */
export function extractTarPayload(tar: Uint8Array): ExtractedFile | null {
  let offset = 0;
  let best: ExtractedFile | null = null;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    let empty = true;
    for (let i = 0; i < 512; i += 1) {
      if (header[i] !== 0) {
        empty = false;
        break;
      }
    }
    if (empty) break;

    const name = readName(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const type = header[156];
    const dataStart = offset + 512;
    const isRegularFile = type === 0 || type === 48;

    if (isRegularFile && size > 0) {
      const data = tar.subarray(dataStart, Math.min(dataStart + size, tar.length));
      if (!best || data.length > best.data.length) best = { name, data };
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return best;
}

/** Unpacks a Terracotta `*-pkg.tar.gz` archive into the bundled executable. */
export function unpackRelease(archive: Uint8Array): ExtractedFile {
  const tar = gunzipSync(archive);
  const payload = extractTarPayload(tar);
  if (!payload) {
    throw new Error("压缩包里没有找到可执行文件");
  }
  return payload;
}

/** Base64 encoder that works with multi-megabyte binaries. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Fixed directory (inside the extension `data/`) that holds the Terracotta core
 * executable. There is no user-selectable download path.
 */
export const CORE_DIR = "core";

/** File name used inside the core directory. */
export function localBinaryName(os: TargetOs): string {
  return os === "windows" ? "terracotta.exe" : "terracotta";
}

/** Relative path (inside `data/`) of the Terracotta core executable. */
export function coreBinaryRelativePath(os: TargetOs): string {
  return `${CORE_DIR}/${localBinaryName(os)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
