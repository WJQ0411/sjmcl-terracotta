// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

import type { ExtensionFactory, ExtensionFactoryApi } from "./types/host";
import { ExtensionUISlotKey } from "./types/host";
import { createConsolePage } from "./pages/console-page";
import { createSettingsPage } from "./pages/settings-page";
import { createHomeStatusWidget } from "./widgets/home-status";

(function registerTerracottaExtension(factory: ExtensionFactory) {
  const token = document.currentScript?.dataset?.extensionToken || "";

  if (!token) {
    throw new Error("Missing extension activation token");
  }

  if (typeof window.registerExtension !== "function") {
    throw new Error("SJMCL host is unavailable");
  }

  window.registerExtension(factory, token);
})(function createExtension(api: ExtensionFactoryApi) {
  const host = api.getHostContext();
  const consoleRoute = `/extension/${api.identifier}/console`;

  return {
    homeWidget: {
      key: "terracotta-status",
      title: "陶瓦联机",
      description: "一键开房 / 加入 Terracotta 联机房间",
      defaultWidth: 320,
      minWidth: 260,
      maxWidth: 420,
      Component: createHomeStatusWidget(api),
    },
    settingsPage: {
      Component: createSettingsPage(api),
    },
    pages: [
      {
        routePath: "console",
        Component: createConsolePage(api, false),
      },
      {
        routePath: "console-standalone",
        isStandAlone: true,
        Component: createConsolePage(api, true),
      },
    ],
    slots: {
      [ExtensionUISlotKey.InstanceWorldItemMenuOperations]: {
        getItems(context) {
          if (!context.instanceId) return [];
          return [
            {
              icon: "link",
              label: "用陶瓦联机分享",
              onClick: () => {
                void host.actions.navigate(consoleRoute);
              },
            },
          ];
        },
      },
    },
    dispose() {
      /* state lives in the host; nothing to release */
    },
  };
});
