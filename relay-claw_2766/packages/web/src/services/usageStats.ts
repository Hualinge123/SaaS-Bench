'use client';

import { SESSION_USAGE_TIMEZONE, toDateBucketAtTimezone } from '@openjiuwen/relay-shared/types';
import { apiFetch } from '@/utils/api-client';

export type UsageRange = 'today' | '3d' | '7d' | '30d';

interface ThreadSummary {
  id: string;
  title?: string | null;
}

interface SessionSummary {
  id: string;
  updatedAt?: number;
  lastUsageAt?: number;
  lastUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    costUsd?: number;
  };
  totalUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    costUsd?: number;
  };
  usageByDay?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      costUsd?: number;
    }
  >;
}

export interface UsageStatsDataset {
  threads: Array<{
    id: string;
    title?: string | null;
  }>;
  sessionsByThreadId: Record<
    string,
    Array<{
      id: string;
      updatedAt?: number;
      lastUsageAt?: number;
      lastUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        costUsd?: number;
      };
      totalUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        costUsd?: number;
      };
      usageByDay?: Record<
        string,
        {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadTokens?: number;
          costUsd?: number;
        }
      >;
    }>
  >;
}

export interface UsageStatsItem {
  id: string;
  sessionName: string;
  totalTokensUsed: number | null;
  inputTokensUsed: number | null;
  outputTokensUsed: number | null;
  occurredAt: string;
}

export interface UsageStatsPageResult {
  items: UsageStatsItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UsageStatsPageQuery {
  page: number;
  pageSize: number;
  range: UsageRange;
}

export interface UsageStatsFetchOptions {
  signal?: AbortSignal;
}

const DEFAULT_USAGE_STATS_TIMEOUT_MS = 60 * 60 * 1000;

async function fetchUsageStatsResponse(path: string, signal?: AbortSignal): Promise<Response> {
  return await apiFetch(path, { signal, timeoutMs: DEFAULT_USAGE_STATS_TIMEOUT_MS });
}

const RANGE_TO_DAY_COUNT: Record<UsageRange, number> = {
  today: 1,
  '3d': 3,
  '7d': 7,
  '30d': 30,
};

interface UsageSnapshot {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

interface SessionRangeContribution {
  inputTokensUsed: number | null;
  outputTokensUsed: number | null;
  latestUsageTimestampInRange: number | null;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
    if (typeof payload.detail === 'string' && payload.detail.trim().length > 0) {
      return payload.detail;
    }
  } catch {
    // Ignore JSON parse errors and fallback to generic message.
  }

  return `Server error: ${response.status}`;
}

function normalizeThreads(payload: unknown): ThreadSummary[] {
  if (Array.isArray(payload)) {
    return payload as ThreadSummary[];
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as { threads?: unknown[] }).threads)) {
    return (payload as { threads: ThreadSummary[] }).threads;
  }

  return [];
}

function normalizeSessions(payload: unknown): SessionSummary[] {
  if (Array.isArray(payload)) {
    return payload as SessionSummary[];
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as { sessions?: unknown[] }).sessions)) {
    return (payload as { sessions: SessionSummary[] }).sessions;
  }

  return [];
}

function addUsageSnapshots(base: UsageSnapshot | undefined, delta: UsageSnapshot | undefined): UsageSnapshot | undefined {
  if (!base && !delta) return undefined;

  const merged: UsageSnapshot = {
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
      ? { costUsd: (base?.costUsd ?? 0) + (delta?.costUsd ?? 0) }
      : {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function buildRangeDayKeys(now: number, range: UsageRange): string[] {
  const dayCount = RANGE_TO_DAY_COUNT[range];
  const result: string[] = [];
  for (let offset = 0; offset < dayCount; offset += 1) {
    result.push(toDateBucketAtTimezone(now - offset * 24 * 60 * 60 * 1000, SESSION_USAGE_TIMEZONE));
  }
  return result;
}

function toLocalDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function getThreadTitle(thread: ThreadSummary): string {
  const title = thread.title?.trim();
  return title && title.length > 0 ? title : '未命名对话';
}

function buildSyntheticUsageByDay(session: SessionSummary): Record<string, UsageSnapshot> | undefined {
  const legacyUsage = session.totalUsage ?? session.lastUsage;
  const legacyUsageAt = session.lastUsageAt ?? session.updatedAt;
  if (!legacyUsage || typeof legacyUsageAt !== 'number') return undefined;
  return {
    [toDateBucketAtTimezone(legacyUsageAt, SESSION_USAGE_TIMEZONE)]: legacyUsage,
  };
}

function getSessionUsageByDay(session: SessionSummary): Record<string, UsageSnapshot> | undefined {
  return session.usageByDay ?? buildSyntheticUsageByDay(session);
}

function getDayBucketTimestamp(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;

  const [, year, month, date] = match;
  const timestamp = Date.parse(`${year}-${month}-${date}T23:59:59.999+08:00`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sumUsageKey(snapshot: UsageSnapshot | undefined, key: 'inputTokens' | 'outputTokens'): number | null {
  const value = snapshot?.[key];
  return typeof value === 'number' ? value : null;
}

function resolveSessionRangeContribution(session: SessionSummary, dayKeys: string[]): SessionRangeContribution {
  const usageByDay = getSessionUsageByDay(session);
  if (!usageByDay) {
    return {
      inputTokensUsed: null,
      outputTokensUsed: null,
      latestUsageTimestampInRange: null,
    };
  }

  let mergedUsage: UsageSnapshot | undefined;
  let matched = false;
  let latestMatchedDay: string | null = null;
  for (const day of dayKeys) {
    const snapshot = usageByDay[day];
    if (!snapshot) continue;
    mergedUsage = addUsageSnapshots(mergedUsage, snapshot);
    matched = true;
    if (latestMatchedDay == null) {
      latestMatchedDay = day;
    }
  }

  if (!matched) {
    return {
      inputTokensUsed: null,
      outputTokensUsed: null,
      latestUsageTimestampInRange: null,
    };
  }

  const hasRealUsageByDay = session.usageByDay != null;
  let latestUsageTimestampInRange: number | null = null;

  if (!hasRealUsageByDay) {
    latestUsageTimestampInRange =
      typeof session.lastUsageAt === 'number'
        ? session.lastUsageAt
        : typeof session.updatedAt === 'number'
          ? session.updatedAt
          : latestMatchedDay != null
            ? getDayBucketTimestamp(latestMatchedDay)
            : null;
  } else {
    latestUsageTimestampInRange =
      latestMatchedDay != null ? getDayBucketTimestamp(latestMatchedDay) : null;
    if (latestMatchedDay != null && typeof session.lastUsageAt === 'number') {
      const lastUsageDay = toDateBucketAtTimezone(session.lastUsageAt, SESSION_USAGE_TIMEZONE);
      if (lastUsageDay === latestMatchedDay) {
        latestUsageTimestampInRange = session.lastUsageAt;
      }
    }
  }

  return {
    inputTokensUsed: sumUsageKey(mergedUsage, 'inputTokens'),
    outputTokensUsed: sumUsageKey(mergedUsage, 'outputTokens'),
    latestUsageTimestampInRange,
  };
}

export function buildUsageStatsPageFromDataset(
  dataset: UsageStatsDataset,
  query: UsageStatsPageQuery,
  now = Date.now(),
): UsageStatsPageResult {
  const dayKeys = buildRangeDayKeys(now, query.range);

  const filteredItems = dataset.threads
    .map((thread) => {
      const sessions = dataset.sessionsByThreadId[thread.id] ?? [];
      let latestUsageTimestampInRange: number | null = null;
      let inputTotal = 0;
      let outputTotal = 0;
      let hasInput = false;
      let hasOutput = false;

      for (const session of sessions) {
        const contribution = resolveSessionRangeContribution(session, dayKeys);
        if (typeof contribution.inputTokensUsed === 'number') {
          inputTotal += contribution.inputTokensUsed;
          hasInput = true;
        }
        if (typeof contribution.outputTokensUsed === 'number') {
          outputTotal += contribution.outputTokensUsed;
          hasOutput = true;
        }
        if (
          typeof contribution.latestUsageTimestampInRange === 'number' &&
          (latestUsageTimestampInRange == null || contribution.latestUsageTimestampInRange > latestUsageTimestampInRange)
        ) {
          latestUsageTimestampInRange = contribution.latestUsageTimestampInRange;
        }
      }

      if (latestUsageTimestampInRange == null) {
        return null;
      }

      const inputTokensUsed = hasInput ? inputTotal : null;
      const outputTokensUsed = hasOutput ? outputTotal : null;
      const totalTokensUsed =
        inputTokensUsed == null && outputTokensUsed == null
          ? null
          : (inputTokensUsed ?? 0) + (outputTokensUsed ?? 0);

      return {
        sortKey: latestUsageTimestampInRange,
        item: {
          id: thread.id,
          sessionName: getThreadTitle(thread),
          totalTokensUsed,
          inputTokensUsed,
          outputTokensUsed,
          occurredAt: toLocalDateTime(latestUsageTimestampInRange),
        } satisfies UsageStatsItem,
      };
    })
    .filter((entry): entry is { sortKey: number; item: UsageStatsItem } => entry != null)
    .sort((left, right) => right.sortKey - left.sortKey)
    .map((entry) => entry.item);

  const startIndex = Math.max(0, (query.page - 1) * query.pageSize);
  const items = filteredItems.slice(startIndex, startIndex + query.pageSize);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: filteredItems.length,
  };
}

export async function fetchUsageStatsDataset(options?: UsageStatsFetchOptions): Promise<UsageStatsDataset> {
  const threadsResponse = await fetchUsageStatsResponse('/api/threads', options?.signal);
  if (!threadsResponse.ok) {
    throw new Error(await readApiError(threadsResponse));
  }

  const threads = normalizeThreads(await threadsResponse.json());
  const sessionEntries = await Promise.all(
    threads.map(async (thread) => {
      const sessionsResponse = await fetchUsageStatsResponse(`/api/threads/${thread.id}/sessions`, options?.signal);
      if (!sessionsResponse.ok) {
        throw new Error(await readApiError(sessionsResponse));
      }

      const sessions = normalizeSessions(await sessionsResponse.json());
      return [thread.id, sessions] as const;
    }),
  );

  return {
    threads,
    sessionsByThreadId: Object.fromEntries(sessionEntries),
  };
}

export async function fetchUsageStatsPage(query: UsageStatsPageQuery): Promise<UsageStatsPageResult> {
  const dataset = await fetchUsageStatsDataset();
  return buildUsageStatsPageFromDataset(dataset, query);
}
