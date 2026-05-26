/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('session usage helpers', () => {
  it('mergeSessionUsage returns undefined when both inputs are empty', async () => {
    const { mergeSessionUsage } = await import('../dist/domains/agents/services/session/session-usage.js');
    assert.equal(mergeSessionUsage(undefined, undefined), undefined);
  });

  it('mergeSessionUsage adds numeric fields and rounds costUsd', async () => {
    const { mergeSessionUsage } = await import('../dist/domains/agents/services/session/session-usage.js');
    const merged = mergeSessionUsage(
      { inputTokens: 1000, outputTokens: 200, costUsd: 0.1234564 },
      { inputTokens: 300, outputTokens: 50, costUsd: 0.0000004 },
    );

    assert.deepEqual(merged, {
      inputTokens: 1300,
      outputTokens: 250,
      costUsd: 0.123457,
    });
  });

  it('mergeUsageByDay merges into an existing day bucket', async () => {
    const { mergeUsageByDay } = await import('../dist/domains/agents/services/session/session-usage.js');
    const merged = mergeUsageByDay(
      {
        '2026-05-19': { inputTokens: 100 },
      },
      '2026-05-19',
      { inputTokens: 50, outputTokens: 20 },
    );

    assert.deepEqual(merged, {
      '2026-05-19': { inputTokens: 150, outputTokens: 20 },
    });
  });

  it('toSessionUsageSnapshot keeps only persisted usage fields', async () => {
    const { toSessionUsageSnapshot } = await import('../dist/domains/agents/services/session/session-usage.js');
    const snapshot = toSessionUsageSnapshot({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      costUsd: 0.1,
      contextWindowSize: 200000,
      lastTurnInputTokens: 80,
    });

    assert.deepEqual(snapshot, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      costUsd: 0.1,
    });
  });
});
