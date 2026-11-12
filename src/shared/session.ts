// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

import type { ExtensionFactoryApi } from "../types/host";
import type { ReactLike } from "../types/react";
import {
  discoverPort,
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
  parsePublicNodes,
  resolvePlayerName,
  useTerracottaSettings,
  type TerracottaSettings,
} from "./settings";

const PORT_STATE_KEY = "terracottaPort";
const ONLINE_STATE_KEY = "terracottaOnline";

export type SessionStatus = "unknown" | "discovering" | "online" | "offline";

export interface TerracottaSession {
  settings: TerracottaSettings;
  settingsLoaded: boolean;
  port: number;
  status: SessionStatus;
  meta: TerracottaMeta | null;
  room: TerracottaState | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
  progress: { scanned: number; total: number } | null;
  playerName?: string;
  stateText: string;
  actions: {
    discover: (silent?: boolean) => Promise<void>;
    startHosting: () => Promise<void>;
    join: (code: string) => Promise<void>;
    leave: () => Promise<void>;
    launchApp: () => Promise<void>;
    openDownload: () => Promise<void>;
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
  const [meta, setMeta] = React.useState<TerracottaMeta | null>(null);
  const [room, setRoom] = React.useState<TerracottaState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [discovering, setDiscovering] = React.useState(false);
  const [progress, setProgress] = React.useState<
    { scanned: number; total: number } | null
  >(null);

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
      setError(null);
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

  const discover = React.useCallback(
    async function discover(silent = false) {
      setDiscovering(true);
      setError(null);
      if (!silent) setNotice("正在查找陶瓦联机的本地接口…");
      setProgress({ scanned: 0, total: 1 });
      try {
        const found = await discoverPort({
          doFetch,
          platform: navigator.userAgent,
          preferredPorts: [settings.port, settings.cachedPort],
          onProgress: (scanned, total) => setProgress({ scanned, total }),
        });
        if (!found) {
          setOnline(false);
          setPort(0);
          setError(
            "没有找到正在运行的陶瓦联机。请先启动陶瓦联机（或在上方设置里填写可执行文件路径后点“启动陶瓦联机”）。"
          );
          return;
        }
        const foundMeta = await fetchMeta(found, doFetch);
        setPort(found);
        setMeta(foundMeta);
        setOnline(true);
        setError(null);
        if (found !== settings.cachedPort) {
          void writeSettings({ cachedPort: found });
        }
        setNotice(`已连接陶瓦联机 v${foundMeta?.version ?? "?"}（端口 ${found}）`);
        const snapshot = await fetchState(found, doFetch);
        setRoom(snapshot);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDiscovering(false);
        setProgress(null);
      }
    },
    [doFetch, setOnline, setPort, settings.cachedPort, settings.port, writeSettings]
  );

  const autoDiscoverRef = React.useRef(false);
  React.useEffect(
    function autoDiscoverOnce() {
      if (!hasLoaded || autoDiscoverRef.current) return;
      if (!settings.autoDiscover && !settings.port && !settings.cachedPort) return;
      autoDiscoverRef.current = true;
      if (port && online) return;
      void discover(true);
    },
    [discover, hasLoaded, online, port, settings.autoDiscover, settings.cachedPort, settings.port]
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
      await startHost(port, {
        player: playerName,
        publicNodes: parsePublicNodes(settings),
      }, doFetch);
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
        await joinRoom(port, {
          code,
          player: playerName,
          publicNodes: parsePublicNodes(settings),
        }, doFetch);
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
      setError("还没有配置陶瓦联机可执行文件路径，请在设置页填写。");
      return;
    }
    try {
      await host.actions.invoke("plugin:opener|open_path", { path: target });
      setNotice("已请求系统启动陶瓦联机，稍等几秒后点击“重新检测”。");
    } catch (err) {
      setError(
        `启动失败：${err instanceof Error ? err.message : String(err)}。可手动运行陶瓦联机后再检测。`
      );
    }
  }, [host, settings.terracottaPath]);

  const openDownload = React.useCallback(async () => {
    try {
      await host.actions.openExternalLink(
        "https://github.com/burningtnt/Terracotta/releases"
      );
    } catch {
      /* user dismissed the confirmation dialog */
    }
  }, [host]);

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

  const status: SessionStatus = discovering
    ? "discovering"
    : online
      ? "online"
      : port
        ? "offline"
        : "unknown";

  return {
    settings,
    settingsLoaded: hasLoaded,
    port,
    status,
    meta,
    room,
    error,
    notice,
    busy,
    progress,
    playerName,
    stateText: room ? stateLabel(room.state) : status === "online" ? "空闲" : "未连接",
    actions: {
      discover,
      startHosting,
      join,
      leave,
      launchApp,
      openDownload,
      copy,
      refresh,
      writeSettings,
    },
  };
}
