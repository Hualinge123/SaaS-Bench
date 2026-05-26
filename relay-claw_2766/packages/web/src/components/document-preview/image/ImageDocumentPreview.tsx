/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useMemo, useState } from 'react';

interface ImageDocumentPreviewProps {
  contentBase64: string;
  mimeType: string;
  title: string;
}

/** 纯图片预览组件：将 base64 图片数据渲染为 img 元素，默认适应容器大小。 */
export function ImageDocumentPreview({ contentBase64, mimeType, title }: ImageDocumentPreviewProps) {
  const [imgError, setImgError] = useState(false);

  const dataUrl = useMemo(() => {
    if (!contentBase64) return null;
    return `data:${mimeType};base64,${contentBase64}`;
  }, [contentBase64, mimeType]);

  if (!dataUrl || imgError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-600">
        无法预览该图片
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-[var(--border-default,#E5E5E5)] bg-[var(--surface-neutral-white,#fff)] bg-[image:--checkerboard-bg]"
      style={{
        // 棋盘格背景，便于查看透明图片
        ['--checkerboard-bg' as string]:
          'repeating-conic-gradient(#F0F0F0 0% 25%, transparent 0% 50%) 0 0 / 16px 16px',
      }}
    >
      <img
        src={dataUrl}
        alt={title}
        onError={() => setImgError(true)}
        draggable={false}
        className="max-h-full max-w-full select-none object-contain"
      />
    </div>
  );
}
