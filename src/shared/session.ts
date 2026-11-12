// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

import type { ExtensionFactoryApi } from "../types/host";
import type { ReactLike } from "../types/react";
import {
  fetchMeta,
  fetchState,
  joinRoom,
  normalizeRoomCode,
  startHost,
  stateLabel,
  stopRoom,
  TerracottaError,
  type TerracottaMeta,
  type TerracottaState,
} from "./terracotta";
import {
  PORT_FILE_NAME,
  decodeLockPort,
  hmclLaunchCommand,
  isValidPort,
  lockFileCandidates,
  parsePortFile,
  toBytes,
  type PortSource,
  type ResolvedPort,
} from "./port-source";
import {
  LATEST_RELEASE_API,
  LATEST_RELEASE_PAGE,
  binaryRelativePath,
  detectTarget,
  formatBytes,
  pickAsset,
  toBase64,
  unpackRelease,
  type LatestRelease,
} from "./terracotta-download";
import {
  parsePublicNodes,
  resolvePlayerName,
  useTerracottaSettings,
  type TerracottaSettings,
} from "./settings";

const PORT_STATE_KEY = "terracottaPort";
const ONLINE_STATE_KEY = "terracottaOnline";

/** Resolves an absolute path for a file inside `<extension>/data`. */
async function resolveExtensionDataFile(
  api: ExtensionFactoryApi,
  host: ReturnType<ExtensionFactoryApi["getHostContext"]>,
  relativePath: string
): Promise<string | null> {
  const parts = [
    "UserContent",
    "Extensions",
    api.identifier,
    "data",
    ...relativePath.split("/"),
  ];
  try {
    const appData = await host.actions.invoke<string>(
      "plugin:path|resolve_directory",
      { directory: "AppData" }
    );
    if (!appData) return null;
    try {
      return await host.actions.invoke<string>("plugin:path|join", {
        paths: [appData, ...parts],
      });
    } catch {
      const separator = appData.includes("\\") ? "\\" : "/";
      return [appData.replace(/[\\/]+$/, ""), ...parts].join(separator);
    }
  } catch {
    return null;
  }
}

/**
 * Reads the API port directly, without scanning: explicit setting first, then
 * the `--hmcl` port file, then Terracotta's single-instance lock file, and
 * finally the last port that worked.
 */
async function readConfiguredPort(
  host: ReturnType<ExtensionFactoryApi["getHostContext"]>,
  settings: TerracottaSettings
): Promise<ResolvedPort | null> {
  if (isValidPort(settings.port)) {
    return { port: settings.port, source: "settings" };
  }

  try {
    const port = parsePortFile(await host.actions.readFile(PORT_FILE_NAME));
    if (port) return { port, source: "portFile" };
  } catch {
    /* port file not written yet */
  }

  let tempDir: string | null = null;
  try {
    tempDir = await host.actions.invoke<string>("plugin:path|resolve_directory", {
      directory: "Temp",
    });
  } catch {
    tempDir = null;
  }

  for (const candidate of lockFileCandidates(tempDir)) {
    try {
      const raw = await host.actions.invoke("plugin:fs|read_file", {
        path: candidate,
      });
      const port = decodeLockPort(toBytes(raw));
      if (port) return { port, source: "lockFile" };
    } catch {
      /* lock file missing or not readable */
    }
  }

  if (isValidPort(settings.cachedPort)) {
    return { port: settings.cachedPort, source: "remembered" };
  }

  return null;
}

const SOURCE_HINT: Record<PortSource, string> = {
  settings: "设置项",
  portFile: PORT_FILE_NAME,
  lockFile: "陶瓦联机锁文件",
  remembered: "上次使用",
};

export type SessionStatus = "unknown" | "connecting" | "online" | "offline";

export interface TerracottaSession {
  settings: TerracottaSettings;
  settingsLoaded: boolean;
  port: number;
  portSource: PortSource | null;
  status: SessionStatus;
  meta: TerracottaMeta | null;
  room: TerracottaState | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
  downloadStage: string | null;
  chmodHint: string | null;
  playerName?: string;
  stateText: string;
  /** Copy-paste command that pins the port file for the next launch. */
  portFileCommand: string | null;
  actions: {
    connect: (portOverride?: number) => Promise<void>;
    startHosting: () => Promise<void>;
    join: (code: string) => Promise<void>;
    leave: () => Promise<void>;
    launchApp: () => Promise<void>;
    downloadTerracotta: () => Promise<void>;
    openReleasePage: () => Promise<void>;
    openDataFolder: () => Promise<void>;
    copy: (text: string) => Promise<void>;
    refresh: () => Promise<void>;
    writeSettings: (patch: Partial<TerracottaSettings>) => Promise<TerracottaSettings>;
  };
}

export function useTerracottaSession(api: ExtensionFactoryApi): TerracottaSession {
  const React = api.React as unknown as ReactLike;
  const host = api.getHostContext();
  const hostData = api.useHostData();
  const { settings, hasLoaded, writeSettings } = useTerracottaSettings(api);

  const [port, setPort] = host.state.useExtensionState<number>(PORT_STATE_KEY, 0);
  const [online, setOnline] = host.state.useExtensionState<boolean>(
    ONLINE_STATE_KEY,
    false
  );
  const [portSource, setPortSource] = React.useState<PortSource | null>(null);
  const [meta, setMeta] = React.useState<TerracottaMeta | null>(null);
  const [room, setRoom] = React.useState<TerracottaState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [downloadStage, setDownloadStage] = React.useState<string | null>(null);
  const [chmodHint, setChmodHint] = React.useState<string | null>(null);
  const [portFileCommand, setPortFileCommand] = React.useState<string | null>(null);

  const selectedPlayerName = (hostData.selectedPlayer as { name?: string } | undefined)
    ?.name;
  const playerName = resolvePlayerName(settings, selectedPlayerName);

  const doFetch = React.useCallback(
    (input: string, init?: { signal?: AbortSignal }) =>
      host.actions.request(input, init as RequestInit),
    [host]
  );

  const refresh = React.useCallback(async () => {
    if (!port) return;
    try {
      const snapshot = await fetchState(port, doFetch);
      setRoom(snapshot);
      setOnline(true);
    } catch (err) {
      setOnline(false);
      setRoom(null);
      if (err instanceof TerracottaError) setError(err.message);
      else setError(String(err));
    }
  }, [doFetch, port, setOnline]);

  React.useEffect(
    function pollState() {
      if (!port || !online) return;
      let cancelled = false;
      const timer = setInterval(() => {
        if (cancelled) return;
        void refresh();
      }, 1200);
      return function cleanup() {
        cancelled = true;
        clearInterval(timer);
      };
    },
    [online, port, refresh]
  );

  const connect = React.useCallback(
    async function connect(portOverride?: number) {
      setConnecting(true);
      setError(null);
      setNotice(null);
      try {
        const resolved: ResolvedPort | null = isValidPort(portOverride)
          ? { port: portOverride, source: "settings" }
          : await readConfiguredPort(host, settings);

        if (!resolved) {
          setOnline(false);
          setPort(0);
          setError(
            "还没拿到陶瓦联机的接口端口。请在设置里填写端口，或用下面的 --hmcl 方式启动陶瓦联机，让扩展直接读取端口文件。"
          );
          return;
        }

        const found = await fetchMeta(resolved.port, doFetch);
        if (!found) {
          setOnline(false);
          setPort(resolved.port);
          setPortSource(resolved.source);
          setError(
            `端口 ${resolved.port}（来源：${SOURCE_HINT[resolved.source]}）没有响应。请确认陶瓦联机已启动，或更新端口设置。`
          );
          return;
        }

        setPort(resolved.port);
        setPortSource(resolved.source);
        setMeta(found);
        setOnline(true);
        setError(null);
        setNotice(
          `已连接陶瓦联机 v${found.version ?? "?"}（端口 ${resolved.port}，来源：${SOURCE_HINT[resolved.source]}）`
        );
        if (resolved.port !== settings.port) {
          void writeSettings({ cachedPort: resolved.port });
        }
        const snapshot = await fetchState(resolved.port, doFetch);
        setRoom(snapshot);
      } catch (err) {
        setOnline(false);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setConnecting(false);
      }
    },
    [doFetch, host, setOnline, setPort, settings, writeSettings]
  );

  const autoConnectRef = React.useRef(false);
  React.useEffect(
    function autoConnectOnce() {
      if (!hasLoaded || autoConnectRef.current) return;
      autoConnectRef.current = true;
      if (!settings.port && !settings.cachedPort) return;
      if (port && online) return;
      void connect();
    },
    [connect, hasLoaded, online, port, settings.cachedPort, settings.port]
  );

  React.useEffect(
    function buildPortFileCommand() {
      let cancelled = false;
      void resolveExtensionDataFile(api, host, PORT_FILE_NAME).then((absolute) => {
        if (cancelled) return;
        setPortFileCommand(
          hmclLaunchCommand(
            settings.terracottaPath || "terracotta",
            absolute ?? `<扩展数据目录>/${PORT_FILE_NAME}`
          )
        );
      });
      return function cleanup() {
        cancelled = true;
      };
    },
    [api, host, settings.terracottaPath]
  );

  const startHosting = React.useCallback(async () => {
    if (!port) {
      setError("请先连接陶瓦联机");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await startHost(
        port,
        { player: playerName, publicNodes: parsePublicNodes(settings) },
        doFetch
      );
      setNotice("已开始扫描局域网世界，请在游戏内按 ESC → “对局域网开放”。");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [doFetch, playerName, port, refresh, settings]);

  const join = React.useCallback(
    async (code: string) => {
      if (!port) {
        setError("请先连接陶瓦联机");
        return;
      }
      if (!normalizeRoomCode(code)) {
        setError("联机码格式不正确，应形如 U/ABCD-1234-EFGH-5678");
        return;
      }
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await joinRoom(
          port,
          { code, player: playerName, publicNodes: parsePublicNodes(settings) },
          doFetch
        );
        setNotice("正在加入房间，连接成功后游戏多人列表里会出现联机房间。");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [doFetch, playerName, port, refresh, settings]
  );

  const leave = React.useCallback(async () => {
    if (!port) return;
    setBusy(true);
    try {
      await stopRoom(port, doFetch);
      setNotice("已关闭当前房间。");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [doFetch, port, refresh]);

  const launchApp = React.useCallback(async () => {
    const target = settings.terracottaPath.trim();
    if (!target) {
      setError("还没有配置陶瓦联机可执行文件路径，请先在设置页填写或下载。");
      return;
    }
    try {
      await host.actions.invoke("plugin:opener|open_path", { path: target });
      setNotice("已请求系统启动陶瓦联机，稍等几秒后点“重新连接”。");
    } catch (err) {
      setError(
        `启动失败：${err instanceof Error ? err.message : String(err)}。可手动运行陶瓦联机后再连接。`
      );
    }
  }, [host, settings.terracottaPath]);

  const openReleasePage = React.useCallback(async () => {
    try {
      await host.actions.openExternalLink(LATEST_RELEASE_PAGE);
    } catch {
      /* user dismissed the confirmation dialog */
    }
  }, [host]);

  const openDataFolder = React.useCallback(async () => {
    const target = await resolveExtensionDataFile(api, host, ".");
    try {
      await host.actions.invoke("plugin:opener|open_path", {
        path: target ?? ".",
      });
    } catch (err) {
      setError(
        `打不开扩展数据目录：${err instanceof Error ? err.message : String(err)}`
      );
    }
  }, [api, host]);

  /**
   * Resolves the newest Terracotta release, downloads the archive for this
   * platform and unpacks it into the extension data directory.
   */
  const downloadTerracotta = React.useCallback(async () => {
    setError(null);
    setNotice(null);
    setChmodHint(null);
    try {
      setDownloadStage("获取最新版本…");
      const releaseResponse = await host.actions.request(LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" },
      } as RequestInit);
      if (!releaseResponse.ok) {
        throw new Error(`GitHub API 返回 HTTP ${releaseResponse.status}`);
      }
      const release = (await releaseResponse.json()) as LatestRelease;
      const target = detectTarget(navigator.userAgent);
      const asset = pickAsset(release.assets ?? [], target);
      if (!asset) {
        throw new Error(
          `最新版 ${release.tag_name} 没有 ${target.os}-${target.arch} 的压缩包`
        );
      }

      setDownloadStage(`下载 ${asset.name}（${formatBytes(asset.size)}）…`);
      const binaryResponse = await host.actions.request(
        asset.browser_download_url
      );
      if (!binaryResponse.ok) {
        throw new Error(`下载失败：HTTP ${binaryResponse.status}`);
      }
      const archive = new Uint8Array(await binaryResponse.arrayBuffer());

      setDownloadStage("解压…");
      const payload = unpackRelease(archive);
      setDownloadStage("写入扩展数据目录…");
      const relativePath = binaryRelativePath(target.os);
      await host.actions.writeFile(
        relativePath,
        toBase64(payload.data),
        "base64"
      );

      const absolutePath = await resolveExtensionDataFile(
        api,
        host,
        relativePath
      );
      await writeSettings({
        terracottaPath: absolutePath ?? settings.terracottaPath,
        downloadedVersion: release.tag_name,
      });
      setNotice(
        absolutePath
          ? `已下载陶瓦联机 ${release.tag_name} → ${absolutePath}`
          : `已下载陶瓦联机 ${release.tag_name} 到扩展数据目录（${relativePath}），请在设置里填写它的绝对路径`
      );
      if (target.os !== "windows") {
        setChmodHint(
          absolutePath
            ? `chmod +x "${absolutePath}"`
            : `chmod +x <扩展数据目录>/${relativePath}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadStage(null);
    }
  }, [api, host, settings.terracottaPath, writeSettings]);

  const copy = React.useCallback(
    async (text: string) => {
      if (!text) return;
      try {
        await host.actions.invoke("plugin:clipboard-manager|write_text", { text });
        setNotice("已复制到剪贴板");
      } catch {
        try {
          await navigator.clipboard.writeText(text);
          setNotice("已复制到剪贴板");
        } catch (err) {
          setError(`复制失败：${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
    [host]
  );

  const status: SessionStatus = connecting
    ? "connecting"
    : online
      ? "online"
      : port
        ? "offline"
        : "unknown";

  return {
    settings,
    settingsLoaded: hasLoaded,
    port,
    portSource,
    status,
    meta,
    room,
    error,
    notice,
    busy,
    downloadStage,
    chmodHint,
    playerName,
    stateText: room ? stateLabel(room.state) : status === "online" ? "空闲" : "未连接",
    portFileCommand,
    actions: {
      connect,
      startHosting,
      join,
      leave,
      launchApp,
      downloadTerracotta,
      openReleasePage,
      openDataFolder,
      copy,
      refresh,
      writeSettings,
    },
  };
}
