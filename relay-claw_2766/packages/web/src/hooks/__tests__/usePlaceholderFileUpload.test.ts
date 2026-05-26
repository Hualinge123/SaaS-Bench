/*
 * *
 *  Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaceholderStore } from '@/stores/placeholderStore';
import { usePlaceholderFileUpload } from '../usePlaceholderFileUpload';

const mockApiFetch = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

type PlaceholderUploadApi = ReturnType<typeof usePlaceholderFileUpload>;

let container: HTMLDivElement;
let root: Root;
let uploadApi: PlaceholderUploadApi | null = null;

function PlaceholderUploadHarness() {
  uploadApi = usePlaceholderFileUpload();
  return null;
}

describe('usePlaceholderFileUpload', () => {
  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  beforeEach(() => {
    mockApiFetch.mockReset();
    usePlaceholderStore.getState().clearAll();
    uploadApi = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlaceholderStore.getState().clearAll();
  });

  it('stores file placeholder uploads under the active workspace upload directory', async () => {
    usePlaceholderStore.getState().setWorkspacePath('/repo/workspace/20260405060708');
    const file = new File(['content'], '客户 数据.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    act(() => {
      root.render(React.createElement(PlaceholderUploadHarness));
    });

    let uploaded: Awaited<ReturnType<PlaceholderUploadApi['uploadFile']>> | undefined;

    await act(async () => {
      uploaded = await uploadApi?.uploadFile('ph_0', file);
    });

    expect(uploaded).toEqual({
      path: '/repo/workspace/20260405060708/upload/客户 数据.xlsx',
      name: '客户 数据.xlsx',
    });
    expect(usePlaceholderStore.getState().fileValues.ph_0).toMatchObject({
      path: '/repo/workspace/20260405060708/upload/客户 数据.xlsx',
      name: '客户 数据.xlsx',
      file,
    });
  });

  it('rewrites existing placeholder file paths when the active workspace changes', async () => {
    usePlaceholderStore.getState().setWorkspacePath('/repo/workspace/20260405060708');
    const file = new File(['content'], 'report.pdf', { type: 'application/pdf' });

    act(() => {
      root.render(React.createElement(PlaceholderUploadHarness));
    });
    await act(async () => {
      await uploadApi?.uploadFile('ph_0', file);
    });

    act(() => {
      usePlaceholderStore.getState().setWorkspacePath('/repo/selected-workspace');
    });

    expect(usePlaceholderStore.getState().fileValues.ph_0).toMatchObject({
      path: '/repo/selected-workspace/upload/report.pdf',
      name: 'report.pdf',
      file,
    });
  });

  it('creates a default workspace path before storing uploads when no workspace is active', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ workspacePath: '/repo/workspace' }),
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 3, 5, 6, 7, 8));
    const file = new File(['content'], 'report.pdf', { type: 'application/pdf' });

    try {
      act(() => {
        root.render(React.createElement(PlaceholderUploadHarness));
      });

      let uploaded: Awaited<ReturnType<PlaceholderUploadApi['uploadFile']>> | undefined;
      await act(async () => {
        uploaded = await uploadApi?.uploadFile('ph_0', file);
      });

      expect(mockApiFetch).toHaveBeenCalledWith('/api/projects/cwd');
      expect(uploaded).toEqual({
        path: '/repo/workspace/20260405060708/upload/report.pdf',
        name: 'report.pdf',
      });
      expect(usePlaceholderStore.getState().workspacePath).toBe('/repo/workspace/20260405060708');
      expect(usePlaceholderStore.getState().fileValues.ph_0).toMatchObject({
        path: '/repo/workspace/20260405060708/upload/report.pdf',
        name: 'report.pdf',
        file,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
