// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

import type { ExtensionFactoryApi } from "../types/host";
import type { ReactLike } from "../types/react";
import { useTerracottaSettings } from "../shared/settings";

export function createSettingsPage(api: ExtensionFactoryApi) {
  const React = api.React as unknown as ReactLike;
  const { Badge, Button, HStack, Input, Switch, Text, VStack } = api.ChakraUI;
  const { OptionItem, OptionItemGroup } = api.Components;
  const host = api.getHostContext();

  return function SettingsPage() {
    const { settings, hasLoaded, writeSettings } = useTerracottaSettings(api);
    const [portText, setPortText] = React.useState("");
    const [nameText, setNameText] = React.useState("");
    const [nodesText, setNodesText] = React.useState("");
    const [savedAt, setSavedAt] = React.useState<string | null>(null);

    React.useEffect(
      function syncFromSettings() {
        if (!hasLoaded) return;
        setPortText(settings.port ? String(settings.port) : "");
        setNameText(settings.playerName);
        setNodesText(settings.publicNodes);
      },
      [hasLoaded, settings]
    );

    const save = React.useCallback(
      async function save(patch: Parameters<typeof writeSettings>[0]) {
        await writeSettings(patch);
        setSavedAt(new Date().toLocaleTimeString());
      },
      [writeSettings]
    );

    const items = [
      React.createElement(
        OptionItem,
        {
          key: "port",
          title: "陶瓦联机接口端口",
          description:
            "默认 11451，连接时优先尝试；不通再读陶瓦联机 --hmcl 启动时写的端口文件与锁文件，全程不扫描端口。",
          isChildrenIndependent: true,
        },
        React.createElement(Input, {
          size: "sm",
          width: "120px",
          placeholder: "11451",
          value: portText,
          onChange: (event: { target: { value: string } }) =>
            setPortText(event.target.value.replace(/[^\d]/g, "")),
          onBlur: () =>
            void save({ port: portText ? Number(portText) : 11451 }),
        })
      ),
      React.createElement(
        OptionItem,
        {
          key: "core",
          title: "core 路径（固定）",
          description:
            "下载与启动都用这个路径，不再单独选择目录。下载会直接覆盖这里的可执行文件。",
          isChildrenIndependent: true,
        },
        React.createElement(
          HStack,
          { spacing: 2, align: "center" },
          React.createElement(
            Text,
            { fontSize: "xs", className: "secondary-text", wordBreak: "break-all" },
            settings.downloadedVersion
              ? `data/core（已下载 ${settings.downloadedVersion}）`
              : "data/core"
          ),
          React.createElement(
            Button,
            {
              size: "xs",
              variant: "ghost",
              onClick: () =>
                void host.actions.openExternalLink(
                  "https://github.com/burningtnt/Terracotta/releases/latest"
                ),
            },
            "发布页"
          )
        )
      ),
      React.createElement(
        OptionItem,
        {
          key: "playerMode",
          title: "使用自定义昵称",
          description: "默认跟随启动器当前选中的账号昵称。开启后使用下面填写的昵称。",
          isChildrenIndependent: true,
        },
        React.createElement(
          HStack,
          { spacing: 2 },
          React.createElement(Input, {
            size: "sm",
            width: "160px",
            placeholder: "Steve",
            isDisabled: settings.playerMode !== "custom",
            value: nameText,
            onChange: (event: { target: { value: string } }) => setNameText(event.target.value),
            onBlur: () => void save({ playerName: nameText.trim() }),
          }),
          React.createElement(Switch, {
            isChecked: settings.playerMode === "custom",
            isDisabled: !hasLoaded,
            onChange: () =>
              void save({
                playerMode: settings.playerMode === "custom" ? "launcher" : "custom",
              }),
          })
        )
      ),
      React.createElement(
        OptionItem,
        {
          key: "nodes",
          title: "额外公共节点（可选）",
          description:
            "每行一个 EasyTier 公共节点地址，用于加速或在中继不可用时兜底。一般无需填写。",
          isChildrenIndependent: true,
        },
        React.createElement(Input, {
          size: "sm",
          width: "320px",
          placeholder: "tcp://public.easytier.top:11010",
          value: nodesText,
          onChange: (event: { target: { value: string } }) => setNodesText(event.target.value),
          onBlur: () => void save({ publicNodes: nodesText }),
        })
      ),
    ];

    return React.createElement(
      VStack,
      { align: "stretch", spacing: 4, className: "content-full-y" },
      React.createElement(
        OptionItemGroup,
        {
          title: "陶瓦联机连接设置",
          description:
            "扩展不会启动或修改 Minecraft 本身，只负责调用陶瓦联机的本地接口并把联机码展示出来。",
          items,
        }
      ),
      React.createElement(
        HStack,
        { spacing: 3, align: "center", wrap: "wrap" },
        React.createElement(
          Button,
          {
            size: "sm",
            variant: "outline",
            onClick: () =>
              void host.actions.openExternalLink(
                "https://github.com/burningtnt/Terracotta/releases/latest"
              ),
          },
          settings.downloadedVersion
            ? `已下载 ${settings.downloadedVersion} · 查看最新发布`
            : "打开发布页（latest）"
        ),
        React.createElement(
          Button,
          {
            size: "sm",
            variant: "ghost",
            onClick: () =>
              void host.actions.openExternalLink(
                `https://mc.sjtu.cn/sjmcl/dev/extension/`
              ),
          },
          "扩展开发文档"
        ),
        savedAt
          ? React.createElement(
              Badge,
              { colorScheme: "green", variant: "subtle" },
              `已保存 ${savedAt}`
            )
          : null
      ),
      React.createElement(
        Text,
        { fontSize: "xs", className: "secondary-text" },
        "控制台的“下载最新版”会读取 GitHub 上的 latest release，把对应平台的压缩包解压后直接写入 core 路径 data/core/，启动按钮也用它。"
      ),
      React.createElement(
        Text,
        { fontSize: "xs", className: "secondary-text" },
        `配套版本 v${"0.2.0"} · 联机能力由 Terracotta 提供（AGPL-3.0-or-later），本扩展同样以 AGPL-3.0-or-later 发布。`
      )
    );
  };
}
