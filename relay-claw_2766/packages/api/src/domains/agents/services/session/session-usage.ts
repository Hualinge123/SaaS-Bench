/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import type { SessionUsageSnapshot } from '@openjiuwen/relay-shared';
import type { TokenUsage } from '../types.js';

function roundCostUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function toSessionUsageSnapshot(usage: TokenUsage): SessionUsageSnapshot | undefined {
  const snapshot: SessionUsageSnapshot = {
    ...(usage.inputTokens != null ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens != null ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.cacheReadTokens != null ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.costUsd != null ? { costUsd: roundCostUsd(usage.costUsd) } : {}),
  };

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

export function mergeSessionUsage(
  base: SessionUsageSnapshot | undefined,
  delta: SessionUsageSnapshot | undefined,
): SessionUsageSnapshot | undefined {
  if (!base && !delta) return undefined;

  const merged: SessionUsageSnapshot = {
    ...(base?.inputTokens != null || delta?.inputTokens != null
      ? { inputTokens: (base?.inputTokens ?? 0) + (delta?.inputTokens ?? 0) }
      : {}),
    ...(base?.outputTokens != null || delta?.outputTokens != null
      ? { outputTokens: (base?.outputTokens ?? 0) + (delta?.outputTokens ?? 0) }
      : {}),
    ...(base?.cacheReadTokens != null || delta?.cacheReadTokens != null
      ? { cacheReadTokens: (base?.cacheReadTokens ?? 0) + (delta?.cacheReadTokens ?? 0) }
      : {}),
    ...(base?.costUsd != null || delta?.costUsd != null
      ? { costUsd: roundCostUsd((base?.costUsd ?? 0) + (delta?.costUsd ?? 0)) }
      : {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function mergeUsageByDay(
  base: Record<string, SessionUsageSnapshot> | undefined,
  day: string,
  delta: SessionUsageSnapshot | undefined,
): Record<string, SessionUsageSnapshot> | undefined {
  if (!delta) return base;

  const next = { ...(base ?? {}) };
  next[day] = mergeSessionUsage(next[day], delta) ?? delta;
  return next;
}
