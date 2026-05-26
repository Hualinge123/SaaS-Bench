/*
 * *
 *  Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import { createStore } from './createStore';
import { buildInspirationUploadPath } from '@/utils/inspiration-workspace-path';

export interface FileValue {
  path: string;
  name: string;
  file?: File;
}

interface PlaceholderState {
  // placeholderId -> 用户输入的文本内容
  textValues: Record<string, string>;
  // placeholderId -> 已上传的文件信息
  fileValues: Record<string, FileValue>;
  workspacePath: string | null;

  setTextValue: (id: string, value: string) => void;
  getTextValue: (id: string) => string;
  setFileValue: (id: string, file: FileValue) => void;
  getFileValue: (id: string) => FileValue | null;
  setWorkspacePath: (path: string | null) => void;
  removeFileValue: (id: string) => void;
  clearPlaceholder: (id: string) => void;
  clearAll: () => void;
}

export const usePlaceholderStore = createStore('PlaceholderStore', (set, get) => ({
  textValues: {},
  fileValues: {},
  workspacePath: null,

  setTextValue: (id, value) => {
    set((state) => ({
      textValues: {
        ...state.textValues,
        [id]: value,
      },
    }), 'setTextValue');
  },

  getTextValue: (id) => {
    return get().textValues[id] ?? '';
  },

  setFileValue: (id, file) => {
    set((state) => ({
      fileValues: {
        ...state.fileValues,
        [id]: file,
      },
    }), 'setFileValue');
  },

  getFileValue: (id) => {
    return get().fileValues[id] ?? null;
  },

  setWorkspacePath: (path) => {
    const workspacePath = path?.trim() || null;
    set((state) => {
      const fileEntries = Object.entries(state.fileValues);
      if (fileEntries.length === 0) return { workspacePath };

      const fileValues = Object.fromEntries(
        fileEntries.map(([id, file]) => [
          id,
          {
            ...file,
            path: buildInspirationUploadPath(workspacePath ?? '', file.name),
          },
        ]),
      );
      return { workspacePath, fileValues };
    }, 'setWorkspacePath');
  },

  removeFileValue: (id) => {
    set((state) => {
      const newFileValues = { ...state.fileValues };
      delete newFileValues[id];
      return { fileValues: newFileValues };
    }, 'removeFileValue');
  },

  clearPlaceholder: (id) => {
    set((state) => {
      const newTextValues = { ...state.textValues };
      const newFileValues = { ...state.fileValues };
      delete newTextValues[id];
      delete newFileValues[id];
      return { textValues: newTextValues, fileValues: newFileValues };
    }, 'clearPlaceholder');
  },

  clearAll: () => {
    set({ textValues: {}, fileValues: {}, workspacePath: null }, 'clearAll');
  },
}));
