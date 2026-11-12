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

/** Extracts the (still percent-encoded) absolute file path from an asset URL. */
export function assetUrlToPath(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();

  const match = trimmed.match(
    /^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/(?:[^/]*)\/(.*)$/
  );
  if (!match) return null;

  const encodedPath = `/${match[1]}`;
  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedPath);
  } catch {
    decoded = encodedPath;
  }

  // Windows asset URLs look like /C:/Users/... — drop the leading slash.
  if (/^\/[a-zA-Z]:[\\/]/.test(decoded)) decoded = decoded.slice(1);
  return decoded || null;
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
    .map((part) => part.split(/[\\/]+/).filter(Boolean).join(separator));
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
    if (assetPath) return dirnameOf(assetPath);
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
          if (joined) return joined;
        } catch {
          return joinPath(root, ...parts);
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
  return joinPath(root, "data", ...relativePath.split(/[\\/]+/));
}
