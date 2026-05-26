/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';

type CollectionStatus = 'idle' | 'collecting' | 'ready' | 'error';

export interface SupportLogArchive {
  fileName: string;
  fileCount: number | null;
  objectUrl: string;
}

function readFileName(response: Response): string {
  const headerName = response.headers.get('X-Log-Archive-Filename');
  if (headerName?.trim()) return headerName.trim();
  const contentDisposition = response.headers.get('Content-Disposition') ?? '';
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? 'officeclaw-logs.zip';
}

export function useSupportLogCollector() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CollectionStatus>('idle');
  const [archive, setArchive] = useState<SupportLogArchive | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetArchive = useCallback(() => {
    setArchive((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
  }, []);

  const collect = useCallback(async () => {
    resetArchive();
    setOpen(true);
    setStatus('collecting');
    setError(null);
    try {
      const response = await apiFetch('/api/support/logs/archive', {
        method: 'POST',
        timeoutMs: 5 * 60 * 1000,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || '日志收集失败');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const rawCount = response.headers.get('X-Log-Archive-File-Count');
      const parsedCount = rawCount === null ? Number.NaN : Number.parseInt(rawCount, 10);
      setArchive({
        fileName: readFileName(response),
        fileCount: Number.isFinite(parsedCount) ? parsedCount : null,
        objectUrl,
      });
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : '日志收集失败');
      setStatus('error');
    }
  }, [resetArchive]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => () => resetArchive(), [resetArchive]);

  return {
    open,
    status,
    archive,
    error,
    collect,
    close,
  };
}
