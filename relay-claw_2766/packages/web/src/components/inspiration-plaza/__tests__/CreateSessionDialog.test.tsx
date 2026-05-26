/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateSessionDialog } from '../components/CreateSessionDialog';

const mockApiFetch = vi.hoisted(() => vi.fn());
const mockGetAgentById = vi.hoisted(() => vi.fn());
const mockGetExpertById = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api-client', () => ({
  API_URL: 'http://localhost:3002',
  apiFetch: mockApiFetch,
}));

vi.mock('@/hooks/useAgentData', () => ({
  useAgentData: vi.fn(() => ({ getAgentById: mockGetAgentById })),
}));

vi.mock('@/hooks/useExpertCatalog', () => ({
  useExpertCatalog: vi.fn(() => ({ getExpertById: mockGetExpertById })),
}));

function createThreadsResponse() {
  return {
    ok: true,
    json: async () => ({
      threads: [
        {
          id: 'thread-1',
          title: '需求讨论',
          lastActiveAt: Date.now(),
          participants: ['agent-1'],
        },
        {
          id: 'thread-2',
          title: '周报整理',
          lastActiveAt: Date.now() - 1000,
          participants: [],
        },
      ],
    }),
  };
}

describe('CreateSessionDialog', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();
  const onCreateNew = vi.fn();
  const onSelectExisting = vi.fn();

  beforeEach(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onClose.mockClear();
    onCreateNew.mockClear();
    onSelectExisting.mockClear();
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue(createThreadsResponse());
    mockGetExpertById.mockReset();
    mockGetExpertById.mockReturnValue(undefined);
    mockGetAgentById.mockReturnValue({
      avatar: '',
      color: { primary: '#1476FF' },
      displayName: '智能体一',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('renders search, refresh, sessions, and ordered actions', async () => {
    await act(async () => {
      root.render(
        React.createElement(CreateSessionDialog, {
          open: true,
          onClose,
          onCreateNew,
          onSelectExisting,
        }),
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('选择会话');
    expect(document.body.querySelector('input')?.getAttribute('placeholder')).toBe('搜索会话');
    const refreshButton = document.body.querySelector('button[aria-label="刷新会话列表"]');
    expect(refreshButton).not.toBeNull();
    expect(refreshButton?.querySelector('img')?.getAttribute('src')).toBe('/icons/icon-refresh.svg');
    expect(document.body.textContent).toContain('需求讨论');
    expect(document.body.textContent).toContain('周报整理');

    const actionLabels = Array.from(document.body.querySelectorAll('[data-testid="create-session-dialog-actions"] button'))
      .map((button) => button.textContent?.trim());
    expect(actionLabels).toEqual(['取消', '新建会话', '确定']);
  });

  it('uses the requested session card padding and selected border', async () => {
    await act(async () => {
      root.render(
        React.createElement(CreateSessionDialog, {
          open: true,
          onClose,
          onCreateNew,
          onSelectExisting,
        }),
      );
      await Promise.resolve();
    });

    const firstSession = document.body.querySelector('[data-testid="session-option-thread-1"]');
    expect(firstSession?.className).toContain('px-6');
    expect(firstSession?.className).toContain('py-3');
    expect(firstSession?.className).toContain('bg-[#FAFAFA]');
    expect(firstSession?.className).toContain('border-[#F0F0F0]');

    act(() => {
      firstSession?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(firstSession?.className).toContain('border-[#1476FF]');
  });

  it('renders session cards with title over agent and time metadata like thread history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 4, 25, 10, 30, 0));
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        threads: [
          {
            id: 'thread-history',
            title: '历史会话',
            lastActiveAt: new Date(2026, 4, 25, 9, 5, 0).getTime(),
            participants: ['agent-1'],
          },
        ],
      }),
    });

    await act(async () => {
      root.render(
        React.createElement(CreateSessionDialog, {
          open: true,
          onClose,
          onCreateNew,
          onSelectExisting,
        }),
      );
      await Promise.resolve();
    });

    const session = document.body.querySelector('[data-testid="session-option-thread-history"]');
    const body = session?.querySelector('[data-testid="session-option-body"]');
    const metaRow = session?.querySelector('[data-testid="session-option-meta-row"]');
    const agentInfo = session?.querySelector('[data-testid="session-option-agent-info"]');
    const timeInfo = session?.querySelector('[data-testid="session-option-time-info"]');
    const titleTooltip = session?.querySelector('[data-testid="session-option-title-tooltip"]');
    const agentTooltip = session?.querySelector('[data-testid="session-option-agent-tooltip"]');

    expect(body?.className).toContain('flex-col');
    expect(session?.querySelector('[data-testid="session-option-title"]')?.textContent).toBe('历史会话');
    expect(metaRow?.className).toContain('justify-between');
    expect(agentInfo?.textContent).toBe('智能体一');
    expect(agentInfo?.textContent).not.toBe('1 个参与智能体');
    expect(timeInfo?.textContent).toBe('09:05');
    expect(titleTooltip).not.toBeNull();
    expect(agentTooltip).not.toBeNull();
    expect(session?.querySelector('[data-testid="session-option-title"]')?.getAttribute('title')).toBeNull();
    expect(agentInfo?.getAttribute('title')).toBeNull();
  });

  it('confirms selected existing sessions and creates new sessions through callbacks', async () => {
    await act(async () => {
      root.render(
        React.createElement(CreateSessionDialog, {
          open: true,
          onClose,
          onCreateNew,
          onSelectExisting,
        }),
      );
      await Promise.resolve();
    });

    act(() => {
      document.body.querySelector('[data-testid="session-option-thread-1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === '确定')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelectExisting).toHaveBeenCalledWith('thread-1');
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await act(async () => {
      root.render(
        React.createElement(CreateSessionDialog, {
          open: true,
          onClose,
          onCreateNew,
          onSelectExisting,
        }),
      );
      await Promise.resolve();
    });

    act(() => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === '新建会话')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCreateNew).toHaveBeenCalledWith('__new__');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables new sessions and shows the reason only from the new-session hover tip', async () => {
    vi.useFakeTimers();
    const disabledReason = '该灵感包含智能体广场智能体，需要先选择已有会话并召唤后使用';

    await act(async () => {
      root.render(
        React.createElement(CreateSessionDialog, {
          open: true,
          onClose,
          onCreateNew,
          onSelectExisting,
          newSessionDisabledReason: disabledReason,
        } as React.ComponentProps<typeof CreateSessionDialog>),
      );
      await Promise.resolve();
    });

    const newSessionButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '新建会话',
    ) as HTMLButtonElement | undefined;

    expect(newSessionButton?.disabled).toBe(true);
    expect(document.body.textContent).not.toContain(disabledReason);
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

    await act(async () => {
      newSessionButton?.parentElement?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(200);
    });

    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(disabledReason);

    act(() => {
      newSessionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCreateNew).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('renders plaza expert avatars in the session logo like the thread history', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        threads: [
          {
            id: 'thread-expert',
            title: '专家会话',
            lastActiveAt: Date.now(),
            participants: ['expert-product'],
            invitedExpertIds: ['expert-architecture'],
          },
        ],
      }),
    });
    mockGetAgentById.mockReturnValue(null);
    mockGetExpertById.mockImplementation((id: string) => {
      if (id === 'expert-product') {
        return {
          expertId: 'expert-product',
          displayName: '产品专家',
          avatar: '/avatars/product-expert.png',
          color: { primary: '#E67E22' },
        };
      }
      if (id === 'expert-architecture') {
        return {
          expertId: 'expert-architecture',
          displayName: '架构专家',
          avatar: '/avatars/architecture-expert.png',
          color: { primary: '#7AAEFF' },
        };
      }
      return undefined;
    });

    await act(async () => {
      root.render(
        React.createElement(CreateSessionDialog, {
          open: true,
          onClose,
          onCreateNew,
          onSelectExisting,
        }),
      );
      await Promise.resolve();
    });

    const expertSession = document.body.querySelector('[data-testid="session-option-thread-expert"]');
    const avatars = Array.from(expertSession?.querySelectorAll('img') ?? []);

    expect(avatars.map((avatar) => avatar.getAttribute('src'))).toEqual([
      '/avatars/product-expert.png',
      '/avatars/architecture-expert.png',
    ]);
    expect(document.body.textContent).not.toContain('expert-product');
  });

  it('refreshes the session list without clearing the search box', async () => {
    await act(async () => {
      root.render(
        React.createElement(CreateSessionDialog, {
          open: true,
          onClose,
          onCreateNew,
          onSelectExisting,
        }),
      );
      await Promise.resolve();
    });

    const input = document.body.querySelector('input')!;
    act(() => {
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '需求' }));
      Object.defineProperty(input, 'value', { value: '需求', configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      document.body.querySelector('button[aria-label="刷新会话列表"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector('input')?.getAttribute('value') ?? (document.body.querySelector('input') as HTMLInputElement)?.value).toBe('需求');
  });
});
