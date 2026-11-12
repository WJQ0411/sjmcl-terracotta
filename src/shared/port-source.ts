// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Loopback port sources for the Terracotta HTTP API.
 *
 * Terracotta binds a random loopback port (`port: 0` in Rocket). Instead of
 * scanning the whole port space, the launcher side reads the port directly from
 * one of the official sources:
 *
 * 1. the user-specified port (settings);
 * 2. the port file written by `terracotta --hmcl <file>` (this is exactly how
 *    HMCL integrates, and lets the launcher pick the file at startup);
 * 3. Terracotta's single-instance lock file (`<temp>/terracotta/terracotta.lock`,
 *    two bytes, big endian);
 * 4. the last port that worked (remembered between launches).
 */

export type PortSource = "settings" | "portFile" | "lockFile" | "remembered";

export interface ResolvedPort {
  port: number;
  source: PortSource;
}

export const PORT_FILE_NAME = "terracotta-port.json";

export function isValidPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

/** Decodes the two big-endian bytes Terracotta stores in `terracotta.lock`. */
export function decodeLockPort(bytes: Uint8Array | number[] | null): number | null {
  if (!bytes || bytes.length < 2) return null;
  const high = bytes[0] ?? 0;
  const low = bytes[1] ?? 0;
  const port = (high << 8) | low;
  return isValidPort(port) ? port : null;
}

/** Normalizes the payload returned by `plugin:fs|read_file` into bytes. */
export function toBytes(payload: unknown): Uint8Array | null {
  if (!payload) return null;
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload)) return Uint8Array.from(payload as number[]);
  if (typeof payload === "object") {
    const record = payload as Record<string, number>;
    const keys = Object.keys(record).filter((key) => /^\d+$/.test(key));
    if (keys.length > 0) {
      keys.sort((a, b) => Number(a) - Number(b));
      return Uint8Array.from(keys.map((key) => record[key] ?? 0));
    }
  }
  return null;
}

/** Parses `{"port": 12345}` written by `terracotta --hmcl <file>`. */
export function parsePortFile(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as { port?: unknown };
    return isValidPort(parsed?.port) ? (parsed.port as number) : null;
  } catch {
    return null;
  }
}

/**
 * Candidate lock file locations. Terracotta stores it in the system temp dir on
 * every platform except macOS, where it uses `~/terracotta`.
 */
export function lockFileCandidates(tempDir?: string | null): string[] {
  const candidates = new Set<string>();
  for (const dir of [tempDir, "/tmp"]) {
    if (!dir) continue;
    const base = dir.replace(/[\\/]+$/, "");
    candidates.add(`${base}/terracotta/terracotta.lock`);
  }
  candidates.add("/tmp/terracotta/terracotta.lock");
  return [...candidates];
}

/** Builds the copy-paste command that pins the port file at startup. */
export function hmclLaunchCommand(binaryPath: string, portFile: string): string {
  const quote = (value: string) =>
    /[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const bin = quote(binaryPath.trim() || "terracotta");
  return `${bin} --hmcl ${quote(portFile)}`;
}
