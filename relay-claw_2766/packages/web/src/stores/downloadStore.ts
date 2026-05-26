'use client';

import { createStore } from './createStore';

export type DownloadStatus = 'idle' | 'downloading' | 'success' | 'error' | 'cancelled' | 'installing';

export interface DownloadProgress {
  status: DownloadStatus;
  progress: number;
  totalBytes: number;
  receivedBytes: number;
  fileName: string;
  filePath: string | null;
  errorMessage: string | null;
  startTime: number | null;
  endTime: number | null;
}

export interface DownloadState {
  taskId: string;
  progress: DownloadProgress;
  isLoading: boolean;
  setTaskId: (taskId: string) => void;
  updateProgress: (progress: DownloadProgress) => void;
  setLoading: (loading: boolean) => void;
  setInstalling: () => void;
  reset: () => void;
}

const initialProgress: DownloadProgress = {
  status: 'idle',
  progress: 0,
  totalBytes: 0,
  receivedBytes: 0,
  fileName: '',
  filePath: null,
  errorMessage: null,
  startTime: null,
  endTime: null,
};

export const useDownloadStore = createStore('DownloadStore', (set) => ({
  taskId: '',
  progress: initialProgress,
  isLoading: false,

  setTaskId: (taskId) => set({ taskId }, 'setTaskId'),

  updateProgress: (progress) => set({ progress, isLoading: false }, 'updateProgress'),

  setLoading: (loading) => set({ isLoading: loading }, 'setLoading'),

  setInstalling: () => set({ progress: { ...initialProgress, status: 'installing' } }, 'setInstalling'),

  reset: () =>
    set({
      taskId: '',
      progress: initialProgress,
      isLoading: false,
    }, 'reset'),
}));
