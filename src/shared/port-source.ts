// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Loopback port for the Terracotta HTTP API.
 *
 * Terracotta binds a random loopback port (`port: 0` in Rocket) and offers no
 * `--port` switch; the supported way to publish the port is
 * `terracotta --hmcl <file>`, which writes `{"port": 12345}` into that file.
 *
 * The extension therefore has exactly one source of truth: the port file inside
 * its own data directory (`data/terracotta-port.json`). Launch Terracotta with
 * the command the console prints, then the port is simply read back — no port
 * setting, no scanning.
 */

export const PORT_FILE_NAME = "terracotta-port.json";

export function isValidPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
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

export interface PortFileDeps {
  /** Reads `data/terracotta-port.json`; should throw when the file is absent. */
  readPortFile: () => Promise<string>;
}

/**
 * Reads the port Terracotta published for this launch. Returns null when the
 * file is missing or malformed (i.e. Terracotta has not been started with
 * `--hmcl` yet).
 */
export async function readPortFromFile(
  deps: PortFileDeps
): Promise<number | null> {
  try {
    return parsePortFile(await deps.readPortFile());
  } catch {
    return null;
  }
}

/** Builds the copy-paste command that pins the port file at startup. */
export function hmclLaunchCommand(binaryPath: string, portFile: string): string {
  const quote = (value: string) =>
    /[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const bin = quote(binaryPath.trim() || "terracotta");
  return `${bin} --hmcl ${quote(portFile)}`;
}

/**
 * Full background launch command for the user to paste into a terminal.
 *
 * The extension deliberately does not spawn Terracotta itself: the Tauri opener
 * resolves paths through its own asset protocol, which on some setups hands back
 * an `smb://...` URL and fails with "no such file". A shell command bypasses
 * that layer entirely and keeps Terracotta alive after the launcher closes.
 */
export function backgroundLaunchCommand(
  binaryPath: string,
  portFile: string,
  platform = "linux"
): string {
  const bin = (binaryPath || "terracotta").trim();
  const port = (portFile || "").trim();

  if (/win/i.test(platform)) {
    const ps = (value: string) => `'${value.replace(/'/g, "''")}'`;
    return `Start-Process -FilePath ${ps(bin)} -ArgumentList '--hmcl',${ps(port)}`;
  }

  const quote = (value: string) =>
    /[\s"'$`\\]/.test(value) ? `"${value.replace(/(["$`\\])/g, "\\$1")}"` : value;
  return `nohup ${quote(bin)} --hmcl ${quote(port)} >/dev/null 2>&1 &`;
}
