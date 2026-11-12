// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Render smoke test.
 *
 * Loads the built extension entry the same way the SJMCL host does (a global
 * `registerExtension` plus `document.currentScript.dataset.extensionToken`),
 * then renders every contribution with React so template/JSX or hook mistakes
 * surface before the extension ever reaches the launcher.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".test");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(outDir, "entry.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node18"],
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  logLevel: "silent",
});

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
};

// ------------------------------------------------------------- host emulation
let factory = null;
globalThis.window = {
  registerExtension(nextFactory, token) {
    if (token !== "test-token") throw new Error("bad token");
    factory = nextFactory;
  },
};
globalThis.document = { currentScript: { dataset: { extensionToken: "test-token" } } };

await import(path.join(outDir, "entry.mjs"));
check("registers through window.registerExtension", typeof factory === "function");

const chakra = new Proxy(
  {},
  {
    get: (_target, name) => {
      const Component = (props = {}) => {
        const { children, ...rest } = props;
        const clean = {};
        for (const [key, value] of Object.entries(rest)) {
          if (["isOpen", "isChecked", "isDisabled", "isLoading", "onChange", "onClick", "value", "placeholder", "width", "size", "colorScheme", "variant", "spacing", "align", "justify", "wrap", "flex", "p", "px", "py", "pt", "mt", "h", "bg", "borderWidth", "borderColor", "borderRadius", "overflow", "fontSize", "fontWeight", "noOfLines", "_dark", "key"].includes(key)) continue;
          clean[key] = typeof value === "string" ? value : undefined;
        }
        const content = Array.isArray(props.items) ? props.items : children;
        return React.createElement("div", { "data-chakra": String(name), ...clean }, content);
      };
      Component.displayName = `Chakra(${String(name)})`;
      return Component;
    },
  }
);

const hostState = new Map();
const api = {
  React,
  ChakraUI: chakra,
  Components: chakra,
  identifier: "io.github.wjq0411.sjmcl-terracotta",
  resolveAssetUrl: (p) => `asset://${p}`,
  getHostContext: () => ({
    actions: {
      request: async () => {
        throw new Error("offline");
      },
      readFile: async () => {
        throw new Error("missing");
      },
      writeFile: async () => {},
      invoke: async () => ({}),
      navigate: async () => {},
      openExternalLink: async () => {},
      openWindow: () => {},
      logger: { info() {} },
    },
    state: {
      useExtensionState: (key, initial) => {
        const [value, setValue] = React.useState(
          hostState.has(key) ? hostState.get(key) : initial
        );
        const setter = React.useCallback(
          (next) => {
            const resolved = typeof next === "function" ? next(hostState.get(key) ?? initial) : next;
            hostState.set(key, resolved);
            setValue(resolved);
          },
          [initial, key]
        );
        return [value, setter];
      },
    },
  }),
  useHostData: () => ({
    config: {},
    selectedPlayer: { name: "Steve" },
    selectedInstance: { name: "1.21.5" },
    playerList: [],
    instanceList: [],
    routeQuery: {},
  }),
};

const registration = factory(api);
check("factory returns contributions", !!registration);
check("home widget declared", registration.homeWidget?.title === "陶瓦联机");
check("settings page declared", typeof registration.settingsPage?.Component === "function");
check("console page declared", registration.pages?.some((p) => p.routePath === "console"));
check("standalone page declared", registration.pages?.some((p) => p.isStandAlone === true));
check(
  "world slot declared",
  typeof registration.slots?.["ui.instance.world.item_menu_operations"]?.getItems === "function"
);

function render(label, Component, props) {
  try {
    const html = renderToString(React.createElement(Component, props));
    check(`renders ${label}`, html.length > 0, "empty output");
    return html;
  } catch (error) {
    check(`renders ${label}`, false, error.stack?.split("\n").slice(0, 3).join(" "));
    return "";
  }
}

const homeHtml = render("home widget", registration.homeWidget.Component);
check("home widget shows title", homeHtml.includes("陶瓦联机"));
const consoleHtml = render(
  "console page",
  registration.pages.find((p) => p.routePath === "console").Component
);
check("console page shows connect action", consoleHtml.includes("连接陶瓦联机"), consoleHtml.slice(0, 160));
const settingsHtml = render("settings page", registration.settingsPage.Component);
check("settings page keeps the port setting", settingsHtml.includes("陶瓦联机接口端口"));

const items = registration.slots["ui.instance.world.item_menu_operations"].getItems({
  instanceId: "abc",
  summary: {},
  save: {},
});
check("world slot returns share action", items.length === 1 && items[0].label.includes("陶瓦"));

rmSync(outDir, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nrender smoke test passed");
