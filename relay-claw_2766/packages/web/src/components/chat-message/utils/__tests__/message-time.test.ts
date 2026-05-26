/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatUserMessageSentTime,
  getAssistantMessageCompletedTimestamp,
} from '../message-time';

describe('formatUserMessageSentTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('omits year for timestamps in the current year', () => {
    expect(formatUserMessageSentTime(new Date('2026-05-22T19:35:00').getTime())).toBe('05/22 19:35');
  });

  it('includes year for timestamps in a previous year', () => {
    expect(formatUserMessageSentTime(new Date('2025-05-22T19:35:00').getTime())).toBe('2025/05/22 19:35');
  });
});

describe('getAssistantMessageCompletedTimestamp', () => {
  it('prefers stream.completedAt when present', () => {
    expect(
      getAssistantMessageCompletedTimestamp({
        timestamp: 1_000,
        extra: { stream: { completedAt: 9_000, durationMs: 2_000 } },
      }),
    ).toBe(9_000);
  });

  it('uses timestamp + durationMs when completedAt is absent', () => {
    expect(
      getAssistantMessageCompletedTimestamp({
        timestamp: 1_000,
        extra: { stream: { durationMs: 4_500 } },
      }),
    ).toBe(5_500);
  });

  it('falls back to bubble timestamp when no completion metadata', () => {
    expect(getAssistantMessageCompletedTimestamp({ timestamp: 3_000 })).toBe(3_000);
  });
});
