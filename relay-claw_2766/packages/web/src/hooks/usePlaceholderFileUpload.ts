/*
 * *
 *  Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import { useCallback } from 'react';
import { apiFetch } from '@/utils/api-client';
import {
  buildDefaultInspirationWorkspacePath,
  buildInspirationUploadPath,
} from '@/utils/inspiration-workspace-path';
import { usePlaceholderStore } from '../stores/placeholderStore';

async function resolveDefaultWorkspacePath(): Promise<string | null> {
  try {
    const response = await apiFetch('/api/projects/cwd');
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    const workspaceRoot = typeof data?.workspacePath === 'string' ? data.workspacePath.trim() : '';
    return buildDefaultInspirationWorkspacePath(workspaceRoot) || null;
  } catch {
    return null;
  }
}

/**
 * 复用现有附件上传机制
 * 存储路径格式: {workspacePath}/upload/{filename}
 */
export function usePlaceholderFileUpload() {
  const setFileValue = usePlaceholderStore((s) => s.setFileValue);
  const removeFileValue = usePlaceholderStore((s) => s.removeFileValue);
  const setWorkspacePath = usePlaceholderStore((s) => s.setWorkspacePath);
  const workspacePath = usePlaceholderStore((s) => s.workspacePath);

  const uploadFile = useCallback(
    async (placeholderId: string, file: File): Promise<{ path: string; name: string }> => {
      const resolvedWorkspacePath = workspacePath?.trim() || (await resolveDefaultWorkspacePath());
      if (resolvedWorkspacePath) {
        setWorkspacePath(resolvedWorkspacePath);
      }
      const storedPath = buildInspirationUploadPath(resolvedWorkspacePath ?? '', file.name);

      setFileValue(placeholderId, {
        path: storedPath,
        name: file.name,
        file, // Store the actual File object for sending
      });

      return { path: storedPath, name: file.name };
    },
    [setFileValue, setWorkspacePath, workspacePath],
  );

  const deleteFile = useCallback(
    (placeholderId: string) => {
      removeFileValue(placeholderId);
    },
    [removeFileValue],
  );

  return {
    uploadFile,
    deleteFile,
  };
}
