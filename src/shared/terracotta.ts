// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Terracotta HTTP API client.
 *
 * Terracotta (陶瓦联机, https://github.com/burningtnt/Terracotta) exposes a small
 * local HTTP API used by launchers to drive rooms. The API listens on a random
 * loopback port, so the launcher side has to discover it first.
 *
 * Upstream endpoints (see src/server/states.rs and src/server/mod.rs):
 *   GET /meta                                -> build + easytier metadata
 *   GET /state                               -> current room state
 *   GET /state/scanning?room&player&public_nodes
 *   GET /state/guesting?room&player&public_nodes
 *   GET /state/ide                           -> back to idle
 *
 * This module is intentionally free of React and of SJMCL host APIs so it can be
 * unit tested in plain Node (see scripts/test.mjs).
 */

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface TerracottaMeta {
  version?: string;
  compile_timestamp?: string;
  easytier_version?: string;
  yggdrasil_port?: number;
  target_os?: string;
}

export type TerracottaRoomState =
  | "waiting"
  | "host-scanning"
  | "host-starting"
  | "host-ok"
  | "guest-connecting"
  | "guest-starting"
  | "guest-ok"
  | "unknown";

export interface TerracottaProfile {
  name?: string;
  uuid?: string;
}

export interface TerracottaState {
  state: TerracottaRoomState;
  index?: number;
  room?: string;
  profiles?: TerracottaProfile[];
  profile_index?: number;
  difficulty?: string;
  server?: { port?: number };
}

export class TerracottaError extends Error {
  readonly code: "not-running" | "http" | "invalid-code" | "busy" | "aborted";

  constructor(code: TerracottaError["code"], message: string) {
    super(message);
    this.name = "TerracottaError";
    this.code = code;
  }
}

export function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function timedSignal(ms: number, outer?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const abort = () => {
    clearTimeout(timer);
    controller.abort();
  };
  if (outer) {
    if (outer.aborted) abort();
    else outer.addEventListener("abort", abort, { once: true });
  }
  // Make sure the timer is released once the request settles.
  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
    },
    { once: true }
  );
  return controller.signal;
}

/** Reads `/meta` and validates that the responder really is Terracotta. */
export async function fetchMeta(
  port: number,
  doFetch: FetchLike,
  timeoutMs = 700
): Promise<TerracottaMeta | null> {
  try {
    const res = await doFetch(`${baseUrl(port)}/meta`, {
      signal: timedSignal(timeoutMs),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const parsed = JSON.parse(raw) as TerracottaMeta;
    // Guard against unrelated local web servers: a real Terracotta /meta always
    // carries a build version, and either the EasyTier version or a target OS.
    const looksLikeTerracotta =
      typeof parsed?.version === "string" &&
      (typeof parsed?.easytier_version === "string" ||
        typeof parsed?.target_os === "string");
    return looksLikeTerracotta ? parsed : null;
  } catch {
    return null;
  }
}

export async function fetchState(
  port: number,
  doFetch: FetchLike,
  timeoutMs = 2000
): Promise<TerracottaState> {
  let res;
  try {
    res = await doFetch(`${baseUrl(port)}/state`, {
      signal: timedSignal(timeoutMs),
    });
  } catch (error) {
    throw new TerracottaError(
      "not-running",
      `无法连接陶瓦联机（端口 ${port}）：${(error as Error).message}`
    );
  }
  if (!res.ok) {
    throw new TerracottaError("http", `陶瓦联机返回 HTTP ${res.status}`);
  }
  const raw = await res.text();
  const parsed = JSON.parse(raw) as TerracottaState;
  return { ...parsed, state: (parsed.state ?? "unknown") as TerracottaRoomState };
}

async function callStateEndpoint(
  port: number,
  path: string,
  doFetch: FetchLike
): Promise<void> {
  let res;
  try {
    res = await doFetch(`${baseUrl(port)}${path}`, {
      signal: timedSignal(4000),
    });
  } catch (error) {
    throw new TerracottaError(
      "not-running",
      `无法连接陶瓦联机（端口 ${port}）：${(error as Error).message}`
    );
  }
  if (!res.ok) {
    throw new TerracottaError(
      "http",
      `陶瓦联机拒绝了请求（HTTP ${res.status}）`
    );
  }
}

/**
 * Starts hosting. Terracotta then waits for a Minecraft LAN broadcast and maps
 * the discovered world to a new connection code.
 */
export async function startHost(
  port: number,
  options: { player?: string; room?: string; publicNodes?: string[] },
  doFetch: FetchLike
): Promise<void> {
  const query = new URLSearchParams();
  if (options.room) query.set("room", options.room);
  if (options.player) query.set("player", options.player);
  for (const node of options.publicNodes ?? []) query.append("public_nodes", node);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  await callStateEndpoint(port, `/state/scanning${suffix}`, doFetch);
}

/** Joins an existing room by connection code. */
export async function joinRoom(
  port: number,
  options: { code: string; player?: string; publicNodes?: string[] },
  doFetch: FetchLike
): Promise<void> {
  const code = normalizeRoomCode(options.code);
  if (!code) {
    throw new TerracottaError("invalid-code", "联机码格式不正确");
  }
  const query = new URLSearchParams({ room: code });
  if (options.player) query.set("player", options.player);
  for (const node of options.publicNodes ?? []) query.append("public_nodes", node);
  await callStateEndpoint(port, `/state/guesting?${query.toString()}`, doFetch);
}

/** Returns Terracotta to the idle state, closing the current room. */
export async function stopRoom(
  port: number,
  doFetch: FetchLike
): Promise<void> {
  await callStateEndpoint(port, "/state/ide", doFetch);
}

const ROOM_CODE_PATTERN = /U\/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/;

/**
 * Extracts a canonical `U/XXXX-XXXX-XXXX-XXXX` code out of arbitrary user input
 * (people paste codes together with chat text all the time).
 */
export function normalizeRoomCode(input: string): string | null {
  if (!input) return null;
  const upper = input.toUpperCase().replace(/\s+/g, "");
  const match = upper.match(ROOM_CODE_PATTERN);
  return match ? match[0] : null;
}

export function stateLabel(state: TerracottaRoomState): string {
  switch (state) {
    case "waiting":
      return "空闲";
    case "host-scanning":
      return "正在扫描局域网世界";
    case "host-starting":
      return "正在创建房间";
    case "host-ok":
      return "联机中（房主）";
    case "guest-connecting":
      return "正在连接房间";
    case "guest-starting":
      return "正在建立隧道";
    case "guest-ok":
      return "已加入房间";
    default:
      return "未知状态";
  }
}

export function stateColor(state: TerracottaRoomState): string {
  switch (state) {
    case "waiting":
      return "gray";
    case "host-scanning":
    case "host-starting":
    case "guest-connecting":
    case "guest-starting":
      return "blue";
    case "host-ok":
    case "guest-ok":
      return "green";
    default:
      return "gray";
  }
}
