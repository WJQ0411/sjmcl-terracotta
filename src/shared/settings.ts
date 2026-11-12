// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

import type { ExtensionFactoryApi } from "../types/host";
import type { ReactLike } from "../types/react";
import { normalizeLocalPath } from "./extension-paths";

export interface TerracottaSettings {
  /**
   * Loopback port used to reach Terracotta. Read straight from `data/settings.json`
   * (no UI); defaults to 11451.
   */
  port: number;
  /** Last port that actually answered, retried after the preferred port. */
  cachedPort: number;
  /** "launcher" follows the SJMCL selected account, "custom" uses playerName. */
  playerMode: "launcher" | "custom";
  playerName: string;
  /** Extra EasyTier public nodes, one per line. */
  publicNodes: string;
  /** Terracotta version fetched into the extension data directory. */
  downloadedVersion: string;
  /** Absolute path of the core executable, cached once the host reveals it. */
  corePath: string;
}

const SETTINGS_FILE = "settings.json";
const SETTINGS_STATE_KEY = "terracottaSettings";
const SETTINGS_READY_STATE_KEY = "terracottaSettingsReady";

/** Default API port: tried first, before the port file / lock file. */
export const DEFAULT_PORT = 11451;

export const DEFAULT_SETTINGS: TerracottaSettings = {
  port: DEFAULT_PORT,
  cachedPort: 0,
  playerMode: "launcher",
  playerName: "",
  publicNodes: "",
  downloadedVersion: "",
  corePath: "",
};

let initPromise: Promise<TerracottaSettings> | null = null;

function toPort(value: unknown): number {
  const port = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (typeof port !== "number" || !Number.isFinite(port)) return 0;
  if (port < 1 || port > 65535) return 0;
  return Math.trunc(port);
}

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function toAbsolutePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = normalizeLocalPath(value);
  return normalized && isAbsoluteLocalPath(normalized) ? normalized : "";
}

export function normalizeSettings(parsed: unknown): TerracottaSettings {
  const value =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  const mode = value.playerMode === "custom" ? "custom" : "launcher";

  return {
    // Older versions stored 0 for "auto"; treat that as the new default port.
    port: toPort(value.port) || DEFAULT_PORT,
    cachedPort: toPort(value.cachedPort),
    playerMode: mode,
    playerName: typeof value.playerName === "string" ? value.playerName : "",
    publicNodes: typeof value.publicNodes === "string" ? value.publicNodes : "",
    downloadedVersion:
      typeof value.downloadedVersion === "string" ? value.downloadedVersion : "",
    // Drop stale/broken values (e.g. a URL with an smb:// prefix) on load.
    corePath: toAbsolutePath(value.corePath),
  };
}

async function writeSettingsFile(
  host: ReturnType<ExtensionFactoryApi["getHostContext"]>,
  next: TerracottaSettings
) {
  const normalized = normalizeSettings(next);
  await host.actions.writeFile(
    SETTINGS_FILE,
    `${JSON.stringify(normalized, null, 2)}\n`
  );
}

async function readSettingsFile(
  host: ReturnType<ExtensionFactoryApi["getHostContext"]>
): Promise<TerracottaSettings> {
  try {
    const raw = await host.actions.readFile(SETTINGS_FILE);
    const next = normalizeSettings(JSON.parse(raw));
    if (raw !== `${JSON.stringify(next, null, 2)}\n`) {
      await writeSettingsFile(host, next);
    }
    return next;
  } catch {
    await writeSettingsFile(host, DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
}

/** Resolves the player name Terracotta should advertise for this launcher session. */
export function resolvePlayerName(
  settings: TerracottaSettings,
  selectedPlayerName?: string
): string | undefined {
  if (settings.playerMode === "custom") {
    const trimmed = settings.playerName.trim();
    return trimmed || undefined;
  }
  const name = selectedPlayerName?.trim();
  return name || undefined;
}

export function parsePublicNodes(settings: TerracottaSettings): string[] {
  return settings.publicNodes
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function useTerracottaSettings(api: ExtensionFactoryApi) {
  const React = api.React as unknown as ReactLike;
  const host = api.getHostContext();
  const [settings, setSettings] = host.state.useExtensionState<TerracottaSettings>(
    SETTINGS_STATE_KEY,
    DEFAULT_SETTINGS
  );
  const [hasLoaded, setHasLoaded] = host.state.useExtensionState(
    SETTINGS_READY_STATE_KEY,
    false
  );

  React.useEffect(
    function loadOnce() {
      if (hasLoaded) return;
      let cancelled = false;
      if (!initPromise) {
        initPromise = readSettingsFile(api.getHostContext());
      }
      void initPromise.then(function apply(loaded) {
        if (cancelled) return;
        setSettings(loaded);
        setHasLoaded(true);
      });
      return function cleanup() {
        cancelled = true;
      };
    },
    [api, hasLoaded, setHasLoaded, setSettings]
  );

  const writeSettings = React.useCallback(
    async function writeSettings(patch: Partial<TerracottaSettings>) {
      const next = normalizeSettings({ ...settings, ...patch });
      setSettings(next);
      setHasLoaded(true);
      await writeSettingsFile(api.getHostContext(), next);
      return next;
    },
    [api, setSettings, setHasLoaded, settings]
  );

  return { settings, hasLoaded, writeSettings };
}
