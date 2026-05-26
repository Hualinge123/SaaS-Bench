import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUsageStatsPageFromDataset, fetchUsageStatsPage } from '../usageStats';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getUserId: vi.fn(() => 'test-user'),
}));

vi.mock('@/utils/api-client', () => ({
  API_URL: 'http://test-api',
  apiFetch: (...args: unknown[]) => mocks.fetch(...args),
}));

vi.mock('@/utils/userId', () => ({
  getUserId: () => mocks.getUserId(),
}));

describe('usageStats service', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.getUserId.mockClear();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('fetches threads and sessions, then filters and paginates by range on the frontend', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const threadOneSessions = [
      {
        id: 'session-1',
        updatedAt: 1_699_999_999_000,
        lastUsage: {
          inputTokens: 45_000,
          outputTokens: 12_000,
          cacheReadTokens: 30_000,
          costUsd: 0.42,
        },
      },
    ];
    const threadTwoSessions = [
      {
        id: 'session-2-old',
        updatedAt: 1_699_700_000_000,
        lastUsage: {
          inputTokens: 11_000,
        },
      },
      {
        id: 'session-2-new',
        updatedAt: 1_699_999_998_000,
        lastUsage: {
          outputTokens: 4_000,
        },
      },
    ];
    const threadThreeSessions = [
      {
        id: 'session-3',
        updatedAt: 1_699_000_000_000,
        lastUsage: {
          inputTokens: 999,
          outputTokens: 1,
        },
      },
    ];

    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'thread-1', title: '' },
          { id: 'thread-2', title: '你好' },
          { id: 'thread-3', title: 'too old' },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => threadOneSessions,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => threadTwoSessions,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => threadThreeSessions,
      });

    const result = await fetchUsageStatsPage({ page: 1, pageSize: 1, range: 'today' });

    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/threads',
      expect.objectContaining({
        timeoutMs: 3_600_000,
      }),
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/threads/thread-1/sessions',
      expect.objectContaining({
        timeoutMs: 3_600_000,
      }),
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      3,
      '/api/threads/thread-2/sessions',
      expect.objectContaining({
        timeoutMs: 3_600_000,
      }),
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/threads/thread-3/sessions',
      expect.objectContaining({
        timeoutMs: 3_600_000,
      }),
    );
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'thread-1',
      sessionName: '未命名对话',
      totalTokensUsed: 57_000,
      inputTokensUsed: 45_000,
      outputTokensUsed: 12_000,
    });
  });

  it('sums input and output tokens across all sessions inside the selected range', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: [{ id: 'thread-1', title: 'A' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessions: [
            {
              id: 's1',
              updatedAt: 1_699_999_990_000,
              lastUsage: { inputTokens: 10_000, outputTokens: 2_000 },
            },
            {
              id: 's2',
              updatedAt: 1_699_999_999_000,
              lastUsage: { inputTokens: 20_000, outputTokens: 3_000 },
            },
            {
              id: 's3',
              updatedAt: 1_699_800_000_000,
              lastUsage: { inputTokens: 99_999, outputTokens: 99_999 },
            },
          ],
        }),
      });

    const result = await fetchUsageStatsPage({ page: 1, pageSize: 6, range: 'today' });

    expect(result.items[0]).toMatchObject({
      id: 'thread-1',
      inputTokensUsed: 30_000,
      outputTokensUsed: 5_000,
      totalTokensUsed: 35_000,
    });
  });

  it('sorts by the latest usage timestamp inside the selected range', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: [
            { id: 'thread-1', title: 'A' },
            { id: 'thread-2', title: 'B' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessions: [{ id: 's1', updatedAt: 1_699_999_990_000, lastUsage: { inputTokens: 100 } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessions: [{ id: 's2', updatedAt: 1_699_999_999_000, lastUsage: { inputTokens: 200 } }],
        }),
      });

    const result = await fetchUsageStatsPage({ page: 1, pageSize: 6, range: 'today' });

    expect(result.items.map((item) => item.id)).toEqual(['thread-2', 'thread-1']);
  });

  it('uses the local start of day for the today range instead of a rolling 24-hour window', () => {
    const now = new Date(2024, 0, 10, 15, 30, 0, 0).getTime();
    const dataset = {
      threads: [
        { id: 'thread-today', title: 'today hit' },
        { id: 'thread-yesterday', title: 'yesterday hit' },
      ],
      sessionsByThreadId: {
        'thread-today': [
          {
            id: 's-today',
            updatedAt: new Date(2024, 0, 10, 0, 30, 0, 0).getTime(),
            lastUsage: { inputTokens: 100, outputTokens: 50 },
          },
        ],
        'thread-yesterday': [
          {
            id: 's-yesterday',
            updatedAt: new Date(2024, 0, 9, 23, 30, 0, 0).getTime(),
            lastUsage: { inputTokens: 999, outputTokens: 1 },
          },
        ],
      },
    };

    const result = buildUsageStatsPageFromDataset(dataset, { page: 1, pageSize: 6, range: 'today' }, now);

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'thread-today',
        inputTokensUsed: 100,
        outputTokensUsed: 50,
        totalTokensUsed: 150,
      }),
    ]);
  });

  it('uses usageByDay buckets for today instead of session updatedAt', () => {
    const now = Date.UTC(2026, 4, 19, 12, 0, 0, 0);
    const dataset = {
      threads: [{ id: 'thread-1', title: 'bucket-thread' }],
      sessionsByThreadId: {
        'thread-1': [
          {
            id: 's1',
            updatedAt: now - 10 * 24 * 60 * 60 * 1000,
            lastUsageAt: now - 2 * 60 * 60 * 1000,
            usageByDay: {
              '2026-05-19': { inputTokens: 100, outputTokens: 40 },
            },
          },
        ],
      },
    };

    const result = buildUsageStatsPageFromDataset(dataset, { page: 1, pageSize: 10, range: 'today' }, now);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'thread-1',
        inputTokensUsed: 100,
        outputTokensUsed: 40,
        totalTokensUsed: 140,
      }),
    ]);
  });

  it('falls back to synthetic bucket from updatedAt when legacy session lacks lastUsageAt', () => {
    const now = Date.UTC(2026, 4, 19, 12, 0, 0, 0);
    const dataset = {
      threads: [{ id: 'thread-1', title: 'legacy-thread' }],
      sessionsByThreadId: {
        'thread-1': [
          {
            id: 'legacy-session',
            updatedAt: Date.UTC(2026, 4, 19, 1, 0, 0, 0),
            totalUsage: { inputTokens: 300, outputTokens: 90 },
          },
        ],
      },
    };

    const result = buildUsageStatsPageFromDataset(dataset, { page: 1, pageSize: 10, range: 'today' }, now);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'thread-1',
        inputTokensUsed: 300,
        outputTokensUsed: 90,
        totalTokensUsed: 390,
      }),
    ]);
  });

  it('sorts by latest usage timestamp in range instead of updatedAt', () => {
    const now = Date.UTC(2026, 4, 19, 12, 0, 0, 0);
    const dataset = {
      threads: [
        { id: 'thread-1', title: 'older usage, newer update' },
        { id: 'thread-2', title: 'newer usage' },
      ],
      sessionsByThreadId: {
        'thread-1': [
          {
            id: 's1',
            updatedAt: now,
            lastUsageAt: now - 2 * 60 * 60 * 1000,
            usageByDay: {
              '2026-05-19': { inputTokens: 100 },
            },
          },
        ],
        'thread-2': [
          {
            id: 's2',
            updatedAt: now - 5 * 60 * 60 * 1000,
            lastUsageAt: now - 1 * 60 * 60 * 1000,
            usageByDay: {
              '2026-05-19': { inputTokens: 200 },
            },
          },
        ],
      },
    };

    const result = buildUsageStatsPageFromDataset(dataset, { page: 1, pageSize: 10, range: 'today' }, now);
    expect(result.items.map((item) => item.id)).toEqual(['thread-2', 'thread-1']);
  });

  it('does not use an out-of-range lastUsageAt for sorting or occurredAt', () => {
    const now = Date.UTC(2026, 4, 19, 12, 0, 0, 0);
    const dataset = {
      threads: [
        { id: 'thread-1', title: 'has newer out-of-range usage' },
        { id: 'thread-2', title: 'has newer in-range usage' },
      ],
      sessionsByThreadId: {
        'thread-1': [
          {
            id: 's1',
            updatedAt: Date.UTC(2026, 4, 25, 8, 0, 0, 0),
            lastUsageAt: Date.UTC(2026, 4, 25, 8, 0, 0, 0),
            usageByDay: {
              '2026-05-18': { inputTokens: 100 },
              '2026-05-25': { inputTokens: 50 },
            },
          },
        ],
        'thread-2': [
          {
            id: 's2',
            updatedAt: Date.UTC(2026, 4, 19, 10, 0, 0, 0),
            lastUsageAt: Date.UTC(2026, 4, 19, 10, 0, 0, 0),
            usageByDay: {
              '2026-05-19': { inputTokens: 200 },
            },
          },
        ],
      },
    };

    const result = buildUsageStatsPageFromDataset(dataset, { page: 1, pageSize: 10, range: '3d' }, now);

    expect(result.items.map((item) => item.id)).toEqual(['thread-2', 'thread-1']);
    expect(result.items[0].occurredAt).toBe(new Date(Date.UTC(2026, 4, 19, 10, 0, 0, 0)).toLocaleString());
    expect(result.items[1].occurredAt).toBe(new Date('2026-05-18T23:59:59.999+08:00').toLocaleString());
  });

  it('uses the latest matched day when a session has multiple in-range buckets', () => {
    const now = Date.UTC(2026, 4, 19, 12, 0, 0, 0);
    const dataset = {
      threads: [{ id: 'thread-1', title: 'multi-bucket' }],
      sessionsByThreadId: {
        'thread-1': [
          {
            id: 's1',
            usageByDay: {
              '2026-05-17': { inputTokens: 10 },
              '2026-05-18': { inputTokens: 20 },
              '2026-05-19': { inputTokens: 30 },
            },
          },
        ],
      },
    };

    const result = buildUsageStatsPageFromDataset(dataset, { page: 1, pageSize: 10, range: '3d' }, now);

    expect(result.items[0].occurredAt).toBe(new Date('2026-05-19T23:59:59.999+08:00').toLocaleString());
    expect(result.items[0].inputTokensUsed).toBe(60);
  });

  it('throws the api error message when the thread request fails', async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'threads failed' }),
    });

    await expect(fetchUsageStatsPage({ page: 1, pageSize: 6, range: 'today' })).rejects.toThrow('threads failed');
  });
});
