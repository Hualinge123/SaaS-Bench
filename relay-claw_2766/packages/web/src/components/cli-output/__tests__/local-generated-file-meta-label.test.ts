/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { describe, expect, it } from 'vitest';
import {
  formatFileSizeLabel,
  formatLocalFileMetaSubtitle,
  formatLocalGeneratedFileKindLabel,
} from '../local-generated-files';

describe('local generated file meta label', () => {
  it('maps kinds to display format names', () => {
    expect(formatLocalGeneratedFileKindLabel('xlsx')).toBe('Excel');
    expect(formatLocalGeneratedFileKindLabel('docx')).toBe('Word');
    expect(formatLocalGeneratedFileKindLabel('ppt')).toBe('PowerPoint');
  });

  it('formats size as compact MB', () => {
    expect(formatFileSizeLabel(Math.round(2.6 * 1024 * 1024))).toBe('2.6MB');
  });

  it('joins format and size with pipe', () => {
    expect(formatLocalFileMetaSubtitle({ kind: 'xlsx' }, Math.round(2.6 * 1024 * 1024))).toBe('Excel | 2.6MB');
  });

  it('shows format only when size is unknown', () => {
    expect(formatLocalFileMetaSubtitle({ kind: 'xlsx' }, null)).toBe('Excel');
  });
});
