/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { create as zustandCreate, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { devtools } from 'zustand/middleware';

const devtoolsEnabled =
  typeof import.meta !== 'undefined' && Boolean((import.meta as ImportMeta).env?.DEV);

/** Zustand set with Redux DevTools action label as the second argument. */
export type StoreSet<T> = {
  (
    partial: T | Partial<T> | ((state: T) => T | Partial<T>),
    action: string,
  ): void;
};

function applySet<T>(
  rawSet: (partial: unknown, replace?: boolean, action?: string | { type: string }) => void,
  storeName: string,
  partial: unknown,
  action: string,
): void {
  const type = devtoolsEnabled ? `${storeName}/${action}` : undefined;
  if (type) {
    rawSet(partial, false, type);
    return;
  }
  rawSet(partial);
}

function wrapSet<T>(storeName: string, rawSet: StoreApi<T>['setState']): StoreSet<T> {
  return (partial, action) => applySet(rawSet, storeName, partial, action);
}

/**
 * Create a Zustand store with Redux DevTools integration (development only).
 *
 * Pass a short action name as the second argument to every `set()` call, e.g.
 * `set({ count: 1 }, 'increment')` → DevTools action `OfficeClaw/MyStore/increment`.
 */
export function createStore<T extends object>(
  name: string,
  initializer: (set: StoreSet<T>, get: () => T, api: StoreApi<T>) => T,
): UseBoundStore<StoreApi<T>> {
  const storeName = `OfficeClaw/${name}`;
  const creator: StateCreator<T, [], []> = (rawSet, get, api) =>
    initializer(wrapSet(storeName, rawSet), get, api);

  if (devtoolsEnabled) {
    return zustandCreate<T>()(devtools(creator, { name: storeName }));
  }
  return zustandCreate<T>()(creator);
}
