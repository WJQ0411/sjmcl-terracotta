// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

import type { ExtensionFactoryApi } from "../types/host";
import { useTerracottaSession } from "../shared/session";
import { stateColor } from "../shared/terracotta";

export function createConsolePage(api: ExtensionFactoryApi, standalone: boolean) {
  const React = api.React;
  const { Badge, Box, Button, Code, Divider, HStack, Input, Spinner, Text, VStack } =
    api.ChakraUI;

  return function ConsolePage() {
    const session = useTerracottaSession(api);
    const [joinCode, setJoinCode] = React.useState("");
    const { room, status, actions } = session;

    const state = room?.state ?? "unknown";
    const isHosting =
      state === "host-ok" || state === "host-starting" || state === "host-scanning";
    const isGuesting =
      state === "guest-ok" ||
      state === "guest-connecting" ||
      state === "guest-starting";
    const roomCode = room?.room ?? "";
    const profiles = room?.profiles ?? [];

    const statusBadge = (() => {
      if (status === "discovering") {
        return React.createElement(Badge, { colorScheme: "blue" }, "检测中");
      }
      if (status === "online") {
        return React.createElement(
          Badge,
          { colorScheme: stateColor(state) },
          session.stateText
        );
      }
      if (status === "offline") {
        return React.createElement(Badge, { colorScheme: "orange" }, "已断开");
      }
      return React.createElement(Badge, { colorScheme: "gray" }, "未连接");
    })();

    const alert = (message: string, tone: "error" | "info") =>
      React.createElement(
        Box,
        {
          p: 3,
          borderRadius: "md",
          fontSize: "sm",
          bg: tone === "error" ? "red.50" : "blue.50",
          color: tone === "error" ? "red.600" : "blue.700",
          _dark: {
            bg: tone === "error" ? "rgba(254,178,178,0.16)" : "rgba(144,205,244,0.16)",
            color: tone === "error" ? "red.200" : "blue.200",
          },
        },
        message
      );

    const setupCard = React.createElement(
      VStack,
      { align: "stretch", spacing: 3 },
      React.createElement(
        Text,
        { fontSize: "sm", className: "secondary-text" },
        "插件通过陶瓦联机自带的本地 HTTP 接口工作，不会修改、也不会打包陶瓦联机的任何文件。请先启动陶瓦联机，再点击重新检测。"
      ),
      React.createElement(
        HStack,
        { spacing: 2, wrap: "wrap" },
        React.createElement(
          Button,
          {
            size: "sm",
            colorScheme: "orange",
            onClick: () => void actions.launchApp(),
            isDisabled: !session.settings.terracottaPath.trim(),
          },
          "启动陶瓦联机"
        ),
        React.createElement(
          Button,
          {
            size: "sm",
            variant: "outline",
            isLoading: status === "discovering",
            onClick: () => void actions.discover(),
          },
          "重新检测"
        ),
        React.createElement(
          Button,
          {
            size: "sm",
            variant: "solid",
            colorScheme: "green",
            isLoading: !!session.downloadStage,
            onClick: () => void actions.downloadTerracotta(),
          },
          session.settings.downloadedVersion
            ? `更新到最新版（已下载 ${session.settings.downloadedVersion}）`
            : "下载最新版到配置目录"
        ),
        React.createElement(
          Button,
          { size: "sm", variant: "ghost", onClick: () => void actions.openReleasePage() },
          "打开发布页"
        )
      ),
      session.downloadStage
        ? React.createElement(
            Text,
            { fontSize: "xs", className: "secondary-text" },
            `${session.downloadStage} 下载内容会存到扩展数据目录 terracotta/ 下，完成后自动填入可执行文件路径。`
          )
        : null,
      session.chmodHint
        ? React.createElement(
            HStack,
            { spacing: 2, align: "center", wrap: "wrap" },
            React.createElement(
              Text,
              { fontSize: "xs", className: "secondary-text" },
              "非 Windows 平台还需给它执行权限："
            ),
            React.createElement(
              Code,
              { fontSize: "xs", px: 2, py: 1, borderRadius: "sm" },
              session.chmodHint
            ),
            React.createElement(
              Button,
              { size: "xs", variant: "ghost", onClick: () => void actions.copy(session.chmodHint ?? "") },
              "复制命令"
            ),
            React.createElement(
              Button,
              { size: "xs", variant: "ghost", onClick: () => void actions.openDataFolder() },
              "打开数据目录"
            )
          )
        : null,
      !session.settings.terracottaPath.trim()
        ? React.createElement(
            Text,
            { fontSize: "xs", className: "secondary-text" },
            "提示：下载后会自动填入可执行文件路径；也可以在设置页手动填写，之后这里就能一键启动。"
          )
        : null,
      session.progress
        ? React.createElement(
            VStack,
            { align: "stretch", spacing: 1 },
            React.createElement(
              Text,
              { fontSize: "xs", className: "secondary-text" },
              `正在扫描本地端口 ${session.progress.scanned} / ${session.progress.total}`
            ),
            React.createElement(
              Box,
              {
                h: "4px",
                borderRadius: "full",
                bg: "blackAlpha.100",
                overflow: "hidden",
              },
              React.createElement(Box, {
                h: "100%",
                bg: "orange.400",
                width: `${Math.min(
                  100,
                  Math.round(
                    (session.progress.scanned /
                      Math.max(1, session.progress.total)) *
                      100
                  )
                )}%`,
              })
            )
          )
        : null
    );

    const idleCards = React.createElement(
      HStack,
      { align: "stretch", spacing: 4, wrap: "wrap" },
      React.createElement(
        Box,
        {
          flex: "1 1 260px",
          borderWidth: "1px",
          borderColor: "blackAlpha.100",
          borderRadius: "lg",
          p: 4,
        },
        React.createElement(
          VStack,
          { align: "stretch", spacing: 3 },
          React.createElement(Text, { fontWeight: "bold" }, "我开房间"),
          React.createElement(
            Text,
            { fontSize: "sm", className: "secondary-text" },
            "先进入存档，按 ESC → “对局域网开放”，再回来点下面的按钮。"
          ),
          React.createElement(
            Button,
            {
              size: "sm",
              colorScheme: "orange",
              isLoading: session.busy,
              onClick: () => void actions.startHosting(),
            },
            "创建联机房间"
          )
        )
      ),
      React.createElement(
        Box,
        {
          flex: "1 1 260px",
          borderWidth: "1px",
          borderColor: "blackAlpha.100",
          borderRadius: "lg",
          p: 4,
        },
        React.createElement(
          VStack,
          { align: "stretch", spacing: 3 },
          React.createElement(Text, { fontWeight: "bold" }, "我加入房间"),
          React.createElement(Input, {
            size: "sm",
            placeholder: "U/XXXX-XXXX-XXXX-XXXX",
            value: joinCode,
            onChange: (event: { target: { value: string } }) =>
              setJoinCode(event.target.value.toUpperCase()),
          }),
          React.createElement(
            Button,
            {
              size: "sm",
              colorScheme: "blue",
              isLoading: session.busy,
              onClick: () => void actions.join(joinCode),
            },
            "加入"
          )
        )
      )
    );

    const roomPanel = React.createElement(
      VStack,
      { align: "stretch", spacing: 3 },
      React.createElement(
        Text,
        { fontSize: "sm", className: "secondary-text" },
        state === "host-ok"
          ? "把联机码发给朋友，他们在这台启动器里输入即可进入你的世界。"
          : state === "host-starting" || state === "host-scanning"
            ? "正在等待局域网世界广播…请确认已经“对局域网开放”。"
            : "正在建立 P2P 连接，稍后会出现在多人游戏列表里。"
      ),
      React.createElement(
        HStack,
        { spacing: 3, align: "center" },
        roomCode
          ? React.createElement(
              Code,
              { fontSize: "xl", px: 3, py: 2, borderRadius: "md" },
              roomCode
            )
          : React.createElement(Spinner, { size: "sm" }),
        roomCode
          ? React.createElement(
              Button,
              { size: "sm", onClick: () => void actions.copy(roomCode) },
              "复制联机码"
            )
          : null
      ),
      profiles.length
        ? React.createElement(
            VStack,
            { align: "stretch", spacing: 1 },
            React.createElement(
              Text,
              { fontSize: "xs", className: "secondary-text" },
              "房间内玩家"
            ),
            React.createElement(
              HStack,
              { spacing: 2, wrap: "wrap" },
              ...profiles.map((profile, index) =>
                React.createElement(
                  Badge,
                  { key: `${profile.name ?? "player"}-${index}`, variant: "subtle" },
                  profile.name ?? "未知玩家"
                )
              )
            )
          )
        : null,
      state === "guest-ok"
        ? React.createElement(
            Text,
            { fontSize: "sm" },
            "连接成功：回到游戏 → 多人游戏 → 直接加入“陶瓦联机”房间。"
          )
        : null,
      state === "guest-starting"
        ? React.createElement(
            Text,
            { fontSize: "xs", className: "secondary-text" },
            `连接难度：${room?.difficulty ?? "UNKNOWN"}`
          )
        : null,
      React.createElement(
        Button,
        {
          size: "sm",
          variant: "outline",
          colorScheme: "red",
          isLoading: session.busy,
          onClick: () => void actions.leave(),
        },
        isGuesting ? "断开房间" : "关闭房间"
      )
    );

    return React.createElement(
      VStack,
      { align: "stretch", spacing: 4, className: "content-full-y" },
      React.createElement(
        HStack,
        { justify: "space-between", align: "center" },
        React.createElement(
          HStack,
          { spacing: 2, align: "center" },
          React.createElement(Text, { fontSize: "lg", fontWeight: "bold" }, "陶瓦联机"),
          statusBadge,
          session.port
            ? React.createElement(
                Text,
                { fontSize: "xs", className: "secondary-text" },
                `端口 ${session.port}${session.meta?.version ? ` · v${session.meta.version}` : ""}`
              )
            : null
        ),
        React.createElement(
          HStack,
          { spacing: 2 },
          session.playerName
            ? React.createElement(
                Text,
                { fontSize: "xs", className: "secondary-text" },
                `昵称 ${session.playerName}`
              )
            : null,
          React.createElement(
            Button,
            { size: "xs", variant: "ghost", onClick: () => void actions.refresh() },
            "刷新"
          )
        )
      ),
      session.error ? alert(session.error, "error") : null,
      session.notice ? alert(session.notice, "info") : null,
      status !== "online" ? setupCard : null,
      status === "online" && !isHosting && !isGuesting ? idleCards : null,
      status === "online" && (isHosting || isGuesting) ? roomPanel : null,
      React.createElement(Divider, null),
      React.createElement(
        Text,
        { fontSize: "xs", className: "secondary-text" },
        `由 Terracotta（陶瓦联机）提供联机能力，版权归其作者所有，遵循 AGPL-3.0-or-later；本扩展仅通过其本地 HTTP 接口通信。${
          standalone ? " · 独立窗口模式" : ""
        }`
      )
    );
  };
}
