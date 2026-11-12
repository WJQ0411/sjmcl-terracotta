// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 WJQ0411

/**
 * Minimal typed view of the host-injected React runtime.
 *
 * `api.React` is declared as `Record<string, any>` upstream, which makes generic
 * hook calls untyped. This interface gives the extension just enough typing for
 * the hooks it uses.
 */
export type SetStateAction<T> = T | ((prev: T) => T);

export interface ReactLike {
  useState<T>(initial: T | (() => T)): [T, (value: SetStateAction<T>) => void];
  useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  useMemo<T>(factory: () => T, deps: unknown[]): T;
  useCallback<T extends (...args: any[]) => any>(fn: T, deps: unknown[]): T;
  useRef<T>(initial: T): { current: T };
  createElement(type: any, props?: any, ...children: any[]): any;
  Fragment: any;
}
