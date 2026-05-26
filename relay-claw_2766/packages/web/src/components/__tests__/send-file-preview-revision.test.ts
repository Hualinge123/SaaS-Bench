/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { describe, expect, it } from 'vitest';
import {
  comparableLocalPathKey,
  countSendFileReadyHitsForResolvedPreviewPath,
  resolvedLocalPreviewMatchesSendFilePath,
} from '@/components/cli-output/local-generated-files';
import type { CliEvent } from '@/stores/chat-types';

function sendFileReadyEvent(id: string, paths: string[], timestamp = 1): CliEvent {
  return {
    id,
    kind: 'send_file_ready',
    timestamp,
    paths,
    detail: JSON.stringify({ type: 'send_file_ready', paths }),
  };
}

describe('send_file_ready reload revision helpers', () => {
  it('normalizes comparable path keys consistently', () => {
    expect(comparableLocalPathKey(`D:\\A\\b\\c.docx`)).toBe('d:/a/b/c.docx');
    expect(comparableLocalPathKey('workspace/out/x.md')).toBe('workspace/out/x.md');
  });

  it('matches resolved preview to relative send_file workspace path suffix', () => {
    expect(
      resolvedLocalPreviewMatchesSendFilePath(`/proj/workspace/out/x.docx`, `workspace/out/x.docx`),
    ).toBe(true);
  });

  it('matches absolute send_file path to same resolved preview', () => {
    expect(
      resolvedLocalPreviewMatchesSendFilePath(`C:\\Users\\me\\out\\x.docx`, `C:/Users/me/out/x.docx`),
    ).toBe(true);
  });

  it('counts multiple send_file events for the same logical file', () => {
    const events: CliEvent[] = [
      sendFileReadyEvent('a', ['workspace/out/x.docx'], 10),
      sendFileReadyEvent('b', ['workspace/out/x.docx'], 20),
    ];
    expect(countSendFileReadyHitsForResolvedPreviewPath(events, `/repo/workspace/out/x.docx`)).toBe(2);
  });
});
