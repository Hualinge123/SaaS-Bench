/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { createStore } from './createStore';
import {
  DEFAULT_THEME,
  persistTheme,
  readThemeFromDocument,
  resolvePersistedTheme,
  type ThemeType,
} from '@/utils/theme-persistence';

export type { ThemeType } from '@/utils/theme-persistence';

interface ThemeStore {
  theme: ThemeType;
  isLoaded: boolean;
  setTheme: (theme: ThemeType) => void;
  toggleTheme: () => void;
  initializeTheme: () => void;
}

export const useThemeStore = createStore('ThemeStore', (set, get) => ({
  theme: readThemeFromDocument() ?? DEFAULT_THEME,
  isLoaded: false,

  setTheme: (newTheme: ThemeType) => {
    persistTheme(newTheme);
    set({ theme: newTheme }, 'setTheme');
  },

  toggleTheme: () => {
    const { theme } = get();
    const newTheme = theme === 'business' ? 'warm' : theme === 'warm' ? 'dark' : 'business';
    get().setTheme(newTheme);
  },

  initializeTheme: () => {
    const theme = resolvePersistedTheme();
    set({ theme, isLoaded: true }, 'initializeTheme');
  },
}));
