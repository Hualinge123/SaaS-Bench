/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import type { LocalGeneratedFile } from '../local-generated-files';
import { formatFileSizeLabel, formatLocalGeneratedFileKindLabel } from '../local-generated-files';

export function LocalGeneratedFileMetaSubtitle({
  file,
  sizeBytes,
  className,
}: {
  file: Pick<LocalGeneratedFile, 'kind'>;
  sizeBytes: number | null;
  className?: string;
}) {
  const formatLabel = formatLocalGeneratedFileKindLabel(file.kind);
  const sizeLabel =
    sizeBytes != null && Number.isFinite(sizeBytes) ? formatFileSizeLabel(sizeBytes) : '';

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`.trim()}>
      <span>{formatLabel}</span>
      {sizeLabel ? (
        <>
          <span className="inline-block h-[10px] w-px shrink-0 bg-[#dbdbdb]" aria-hidden />
          <span>{sizeLabel}</span>
        </>
      ) : null}
    </span>
  );
}
