/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import type {
  DispatchExecutionDigest,
  ExternalProject,
  IntentCard,
  NeedAuditFrame,
  RefluxPattern,
  ResolutionItem,
  Slice,
} from '@openjiuwen/relay-shared';
import { createStore } from './createStore';

interface ExternalProjectState {
  projects: ExternalProject[];
  activeProjectId: string | null;
  intentCards: IntentCard[];
  auditFrame: NeedAuditFrame | null;
  executionDigests: DispatchExecutionDigest[];
  resolutions: ResolutionItem[];
  slices: Slice[];
  refluxPatterns: RefluxPattern[];
  loading: boolean;
  error: string | null;
  setProjects: (projects: ExternalProject[]) => void;
  setActiveProjectId: (id: string | null) => void;
  setIntentCards: (cards: IntentCard[]) => void;
  setAuditFrame: (frame: NeedAuditFrame | null) => void;
  setExecutionDigests: (digests: DispatchExecutionDigest[]) => void;
  setResolutions: (resolutions: ResolutionItem[]) => void;
  setSlices: (slices: Slice[]) => void;
  setRefluxPatterns: (patterns: RefluxPattern[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useExternalProjectStore = createStore('ExternalProjectStore', (set) => ({
  projects: [],
  activeProjectId: null,
  intentCards: [],
  auditFrame: null,
  executionDigests: [],
  resolutions: [],
  slices: [],
  refluxPatterns: [],
  loading: false,
  error: null,
  setProjects: (projects) => set({ projects }, 'setProjects'),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }, 'setActiveProjectId'),
  setIntentCards: (intentCards) => set({ intentCards }, 'setIntentCards'),
  setAuditFrame: (auditFrame) => set({ auditFrame }, 'setAuditFrame'),
  setExecutionDigests: (executionDigests) => set({ executionDigests }, 'setExecutionDigests'),
  setResolutions: (resolutions) => set({ resolutions }, 'setResolutions'),
  setSlices: (slices) => set({ slices }, 'setSlices'),
  setRefluxPatterns: (refluxPatterns) => set({ refluxPatterns }, 'setRefluxPatterns'),
  setLoading: (loading) => set({ loading }, 'setLoading'),
  setError: (error) => set({ error }, 'setError'),
}));
