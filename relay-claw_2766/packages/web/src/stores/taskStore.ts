/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { createStore } from './createStore';

export interface TaskItem {
  id: string;
  threadId: string;
  title: string;
  ownerAgentId: string | null;
  status: 'todo' | 'doing' | 'blocked' | 'done';
  why: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface TaskState {
  tasks: TaskItem[];
  setTasks: (tasks: TaskItem[]) => void;
  addTask: (task: TaskItem) => void;
  updateTask: (task: TaskItem) => void;
  removeTask: (taskId: string) => void;
  clearTasks: () => void;
}

export const useTaskStore = createStore('TaskStore', (set) => ({
  tasks: [],

  setTasks: (tasks) => set({ tasks }, 'setTasks'),

  addTask: (task) =>
    set((state) => {
      if (state.tasks.some((t) => t.id === task.id)) return state;
      return { tasks: [...state.tasks, task] };
    }, 'addTask'),

  updateTask: (task) =>
    set((state) => {
      const exists = state.tasks.some((t) => t.id === task.id);
      if (exists) {
        return { tasks: state.tasks.map((t) => (t.id === task.id ? task : t)) };
      }
      // Upsert: task_updated for unknown task → insert it
      return { tasks: [...state.tasks, task] };
    }, 'updateTask'),

  removeTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    }), 'removeTask'),

  clearTasks: () => set({ tasks: [] }, 'clearTasks'),
}));
