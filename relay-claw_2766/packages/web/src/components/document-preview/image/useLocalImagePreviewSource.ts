/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';

export type ImagePreviewLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; contentBase64: string; mimeType: string }
  | { status: 'error'; message: string };

type ReadResponse = { error?: string; contentBase64?: string };

/** 根据文件扩展名推断 MIME 类型 */
function inferMimeType(path: string): string {
  const ext = path.trim().split(/[?#]/)[0]?.toLowerCase().match(/\.([^./\\]+)$/)?.[1] ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    ico: 'image/x-icon',
    avif: 'image/avif',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] ?? 'image/png';
}

async function fetchLocalImageBase64(
  path: string,
  projectPath: string | undefined,
  signal: AbortSignal,
): Promise<{ ok: true; contentBase64: string; mimeType: string } | { ok: false; message: string }> {
  const res = await apiFetch('/api/projects/read-local-binary-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      ...(projectPath && projectPath !== 'default' ? { projectPath } : {}),
    }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as ReadResponse | null;
  if (!res.ok) {
    const err = body?.error ?? `HTTP ${res.status}`;
    return { ok: false, message: err };
  }
  if (typeof body?.contentBase64 !== 'string' || !body.contentBase64.length) {
    return { ok: false, message: '无效的响应内容' };
  }
  return { ok: true, contentBase64: body.contentBase64, mimeType: inferMimeType(path) };
}

/** 加载图片文件的 base64 内容，用于嵌入式预览。 */
export function useLocalImagePreviewSource(
  resolvedPath: string | null,
  projectPath?: string | null,
  reloadRevision = 0,
  /** 用户点击「刷新」等触发的递增键，便于重新请求磁盘正文 */
  refreshNonce = 0,
): ImagePreviewLoadState {
  const [state, setState] = useState<ImagePreviewLoadState>({ status: 'idle' });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadRevision / refreshNonce 需触发重新读取磁盘
  useEffect(() => {
    if (!resolvedPath?.trim()) {
      setState({ status: 'idle' });
      return;
    }
    const path = resolvedPath.trim();
    const ac = new AbortController();
    setState({ status: 'loading' });

    void fetchLocalImageBase64(path, projectPath ?? undefined, ac.signal)
      .then((result) => {
        if (ac.signal.aborted) return;
        if (!result.ok) {
          setState({ status: 'error', message: result.message });
          return;
        }
        setState({ status: 'ok', contentBase64: result.contentBase64, mimeType: result.mimeType });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setState({ status: 'error', message: e instanceof Error ? e.message : '请求失败' });
      });

    return () => ac.abort();
  }, [resolvedPath, projectPath, reloadRevision, refreshNonce]);

  return state;
}
