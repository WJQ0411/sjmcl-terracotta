// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

import type { ExtensionFactoryApi } from "../types/host";
import type { ReactLike } from "../types/react";
import { useTerracottaSession } from "../shared/session";

export function createHomeStatusWidget(api: ExtensionFactoryApi) {
  const React = api.React as unknown as ReactLike;
  const { Badge, Button, Code, HStack, Spinner, Text, VStack } =
    api.ChakraUI;
  const host = api.getHostContext();

  return function HomeStatusWidget() {
    const session = useTerracottaSession(api);
    const { room, status, actions } = session;
    const roomCode = room?.room ?? "";
    const consoleRoute = `/extension/${api.identifier}/console`;

    const badge = (() => {
      if (status === "discovering") {
        return React.createElement(Badge, { colorScheme: "blue" }, "检测中");
      }
      if (status === "online") {
        return React.createElement(
          Badge,
          { colorScheme: room?.state === "host-ok" || room?.state === "guest-ok" ? "green" : "gray" },
          session.stateText
        );
      }
      if (status === "offline") {
        return React.createElement(Badge, { colorScheme: "orange" }, "已断开");
      }
      return React.createElement(Badge, { colorScheme: "gray" }, "未连接");
    })();

    return React.createElement(
      VStack,
      { align: "stretch", spacing: 2, h: "100%" },
      React.createElement(
        HStack,
        { justify: "space-between", align: "center" },
        React.createElement(
          HStack,
          { spacing: 2, align: "center" },
          React.createElement(Text, { fontSize: "sm", fontWeight: "bold" }, "陶瓦联机"),
          badge
        ),
        status === "discovering" ? React.createElement(Spinner, { size: "xs" }) : null
      ),
      roomCode
        ? React.createElement(
            HStack,
            { spacing: 2, align: "center" },
            React.createElement(
              Code,
              { fontSize: "sm", px: 2, py: 1, borderRadius: "md" },
              roomCode
            ),
            React.createElement(
              Button,
              { size: "xs", variant: "ghost", onClick: () => void actions.copy(roomCode) },
              "复制"
            )
          )
        : React.createElement(
            Text,
            { fontSize: "xs", className: "secondary-text" },
            status === "online"
              ? "陶瓦联机已就绪，去控制台开房或加入房间。"
              : "启动陶瓦联机后即可一键开房 / 加入。"
          ),
      session.error
        ? React.createElement(
            Text,
            { fontSize: "xs", color: "orange.500", noOfLines: 2 },
            session.error
          )
        : null,
      React.createElement(
        HStack,
        { spacing: 2, mt: "auto", pt: 1 },
        React.createElement(
          Button,
          {
            size: "xs",
            colorScheme: "orange",
            onClick: () => void host.actions.navigate(consoleRoute),
          },
          "打开控制台"
        ),
        status === "online"
          ? React.createElement(
              Button,
              { size: "xs", variant: "outline", onClick: () => void actions.startHosting() },
              "开房"
            )
          : React.createElement(
              Button,
              { size: "xs", variant: "outline", onClick: () => void actions.discover() },
              "检测"
            )
      )
    );
  };
}
