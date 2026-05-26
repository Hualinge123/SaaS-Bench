/*
 * *
 *  Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDefaultInspirationWorkspacePath,
  buildInspirationUploadPath,
  formatInspirationWorkspaceTimestamp,
  promptHasFilePlaceholder,
} from '../inspiration-workspace-path';

describe('inspiration workspace paths', () => {
  it('formats the default workspace timestamp with the same YYYYMMDDHHmmss rule as the backend', () => {
    const date = new Date(2026, 3, 5, 6, 7, 8);

    expect(formatInspirationWorkspaceTimestamp(date)).toBe('20260405060708');
  });

  it('builds a default inspiration workspace under the backend workspace root', () => {
    const date = new Date(2026, 3, 5, 6, 7, 8);

    expect(buildDefaultInspirationWorkspacePath('/opt/OfficeClaw/workspace', date)).toBe(
      '/opt/OfficeClaw/workspace/20260405060708',
    );
  });

  it('builds upload paths under the selected workspace without the legacy fixed upload root', () => {
    expect(buildInspirationUploadPath('/repo/current', '客户 数据.xlsx')).toBe('/repo/current/upload/客户 数据.xlsx');
    expect(buildInspirationUploadPath('/repo/current/', '../bad:name?.pdf')).toBe('/repo/current/upload/.._bad_name_.pdf');
  });

  it('detects file placeholders in inspiration prompts', () => {
    expect(promptHasFilePlaceholder('请参考 {{file:上传数据:document:[xlsx]}} 生成报告')).toBe(true);
    expect(promptHasFilePlaceholder('请填写 {{主题}} 后生成报告')).toBe(false);
  });
});
