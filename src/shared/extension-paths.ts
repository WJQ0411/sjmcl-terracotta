// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Resolving absolute paths inside the extension directory.
 *
 * The host does not expose the extension root directly, and `plugin:path|*`
 * commands are not guaranteed to be allowed for extensions. `api.resolveAssetUrl`
 * is part of the documented extension API though: it converts
 * `<extensionRoot>/<relativePath>` through Tauri's `convertFileSrc`, so the
 * absolute path can be recovered from the resulting asset URL:
 *
 *   asset://localhost/home/me/.local/share/SJMCL/UserContent/Extensions/id/a.png
 *   http://asset.localhost/C%3A%5CUsers%5Cme%5CAppData%5CRoaming%5CSJMCL%5C...%5Ca.png
 */
import type { ExtensionFactoryApi } from "../types/host";

const LOCAL_AUTHORITIES = new Set(["localhost", "127.0.0.1", "::1", "asset.localhost"]);

/**
 * Normalizes anything that looks like a URL into a plain local filesystem path.
 *
 * Some hosts hand back asset URLs with an unexpected scheme (e.g. `smb://`), and
 * `open_path` / `write_file` only accept plain paths — passing `smb://...` ends
 * up as "no such file". This strips scheme + authority, decodes percent escapes
 * and fixes Windows drive prefixes.
 */
export function normalizeLocalPath(value: string): string | null {
  if (typeof value !== "string") return null;
  let path = value.trim();
  if (!path) return null;

  // Strip any number of scheme://authority prefixes.
  for (let guard = 0; guard < 3; guard += 1) {
    const match = path.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/([\s\S]*)$/);
    if (!match) break;
    const rest = match[2];
    if (rest.startsWith("/") || rest.startsWith("\\")) {
      // smb:///home/x, file:///home/x
      path = rest;
      continue;
    }
    const slash = rest.search(/[\\/]/);
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    const remainder = slash === -1 ? "" : rest.slice(slash);
    if (slash !== -1 && !LOCAL_AUTHORITIES.has(authority.toLowerCase())) {
      // Remote host in the URL: best effort, keep the path part.
      path = remainder;
    } else if (slash !== -1) {
      path = remainder;
    } else {
      path = `/${authority}`;
    }
  }

  if (path.includes("%")) {
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep the raw text */
    }
  }

  // Windows: "/C:/Users/x" -> "C:/Users/x"
  if (/^\/[a-zA-Z]:[\\/]/.test(path)) path = path.slice(1);

  if (!path || path.includes("://")) return null;
  return path;
}

/** Extracts the (still percent-encoded) absolute file path from an asset URL. */
export function assetUrlToPath(url: string): string | null {
  if (!url || !/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(url.trim())) return null;
  const path = normalizeLocalPath(url);
  return path && isAbsoluteLocalPath(path) ? path : null;
}

/** True for `/abs/path`, `C:\path` and `\\server\share`. */
export function isAbsoluteLocalPath(value: string): boolean {
  return (
    typeof value === "string" &&
    (value.startsWith("/") ||
      /^[a-zA-Z]:[\\/]/.test(value) ||
      value.startsWith("\\\\"))
  );
}

/** Minimal dirname that understands both separators. */
export function dirnameOf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index > 0 ? normalized.slice(0, index) : normalized;
}

/** Joins path segments, keeping the separator style of the base path. */
export function joinPath(base: string, ...parts: string[]): string {
  const separator = base.includes("\\") ? "\\" : "/";
  const head = base.replace(/[\\/]+$/, "");
  const tail = parts
    .filter(Boolean)
    .map((part) =>
      part
        .split(/[\\/]+/)
        .filter((segment) => Boolean(segment) && segment !== ".")
        .join(separator)
    )
    .filter(Boolean);
  return [head, ...tail].join(separator);
}

/**
 * Recovers the extension root directory. Strategy order:
 * 1. asset URL of a known file (`sjmcl.ext.json`) — documented API, no extra
 *    permissions required;
 * 2. `plugin:path|resolve_directory` + `plugin:path|join`, with a few argument
 *    spellings for compatibility with host revisions.
 */
export async function resolveExtensionRoot(
  api: ExtensionFactoryApi,
  host: ReturnType<ExtensionFactoryApi["getHostContext"]>
): Promise<string | null> {
  try {
    const assetUrl = api.resolveAssetUrl("sjmcl.ext.json");
    const assetPath = assetUrlToPath(assetUrl);
    if (assetPath) {
      const rootDir = normalizeLocalPath(dirnameOf(assetPath));
      if (rootDir && isAbsoluteLocalPath(rootDir)) return rootDir;
    }
  } catch {
    /* fall through to the path plugin */
  }

  const directoryKinds = ["AppData", "appData"];
  for (const kind of directoryKinds) {
    for (const payload of [{ directory: kind }, { dir: kind }, { path: kind }]) {
      try {
        const root = await host.actions.invoke<string>(
          "plugin:path|resolve_directory",
          payload as Record<string, unknown>
        );
        if (!root || typeof root !== "string") continue;
        const parts = ["UserContent", "Extensions", api.identifier];
        try {
          const joined = await host.actions.invoke<string>("plugin:path|join", {
            paths: [root, ...parts],
          });
          if (joined) {
            const normalized = normalizeLocalPath(joined);
            if (normalized && isAbsoluteLocalPath(normalized)) return normalized;
          }
        } catch {
          const normalized = normalizeLocalPath(joinPath(root, ...parts));
          if (normalized && isAbsoluteLocalPath(normalized)) return normalized;
        }
      } catch {
        /* try the next spelling */
      }
    }
  }

  return null;
}

/**
 * Absolute path of a file inside `<extensionRoot>/data`, or null when the host
 * refuses to reveal the extension directory.
 */
export async function resolveExtensionDataFile(
  api: ExtensionFactoryApi,
  host: ReturnType<ExtensionFactoryApi["getHostContext"]>,
  relativePath: string
): Promise<string | null> {
  const root = await resolveExtensionRoot(api, host);
  if (!root) return null;
  return normalizeLocalPath(joinPath(root, "data", ...relativePath.split(/[\\/]+/)));
}
