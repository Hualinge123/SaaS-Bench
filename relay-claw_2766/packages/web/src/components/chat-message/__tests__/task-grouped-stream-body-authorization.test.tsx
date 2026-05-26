/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import type { TaskRunPersistExtra } from '@openjiuwen/relay-shared';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthPendingRequest } from '@/hooks/useAuthorization';
import { bubbleExpandStorageKey, writeBubbleExpandPref } from '@/lib/chat-bubble-expand-prefs';
import type { ChatMessage as ChatMessageType } from '@/stores/chatStore';
import type { CliEvent } from '@/stores/chat-types';

vi.mock('@/components/cli-output/cli-output-block', () => ({
  CliOutputBlock: ({
    events,
    authorizationRequests,
  }: {
    events: CliEvent[];
    authorizationRequests?: AuthPendingRequest[];
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'cli-output-block',
        'data-event-ids': events.map((event) => event.id).join(','),
        'data-auth-count': String(authorizationRequests?.length ?? 0),
      },
      authorizationRequests?.map((request) =>
        React.createElement('span', { key: request.requestId, 'data-testid': 'authorization-card' }, request.reason),
      ),
    ),
}));

vi.mock('@/components/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => React.createElement('span', null, content),
}));

const { TaskGroupedStreamBody } = await import('../components/TaskGroupedStreamBody');

const message = {
  id: 'message-auth-placement',
  type: 'assistant',
  agentId: 'codex',
  content: '',
  timestamp: 1000,
} as ChatMessageType;

const pendingAuthRequest: AuthPendingRequest = {
  requestId: 'auth-1',
  agentId: 'codex',
  threadId: 'thread-1',
  action: 'shell_command',
  reason: 'Need approval',
  createdAt: 2001,
};

const taskRuns: TaskRunPersistExtra = {
  v: 1,
  segments: [
    {
      taskId: 'task-a',
      title: 'First task',
      thinking: '',
      text: '',
      toolEvents: [{ id: 'tool-a', type: 'tool_use', label: 'Read', timestamp: 1000 }],
    },
    {
      taskId: 'task-b',
      title: 'Second task',
      thinking: '',
      text: '',
      toolEvents: [{ id: 'tool-b', type: 'tool_use', label: 'Shell', timestamp: 2000 }],
    },
  ],
};

describe('TaskGroupedStreamBody authorization placement', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('passes pending authorization only to the last visible tool block', () => {
    act(() => {
      root.render(
        React.createElement(TaskGroupedStreamBody, {
          threadId: 'thread-1',
          taskRuns,
          message,
          cliStatus: 'streaming',
          pendingAuthRequests: [pendingAuthRequest],
          onAuthRespond: vi.fn(),
        }),
      );
    });

    const blocks = Array.from(container.querySelectorAll('[data-testid="cli-output-block"]'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.getAttribute('data-event-ids')).toContain('tool-a');
    expect(blocks[0]?.getAttribute('data-auth-count')).toBe('0');
    expect(blocks[1]?.getAttribute('data-event-ids')).toContain('tool-b');
    expect(blocks[1]?.getAttribute('data-auth-count')).toBe('1');
    expect(container.querySelectorAll('[data-testid="authorization-card"]')).toHaveLength(1);
  });

  it('reveals the last tool task when its persisted state is collapsed and authorization is pending', () => {
    writeBubbleExpandPref(bubbleExpandStorageKey('thread-1', message.id, 'task:task-b:1'), false);

    act(() => {
      root.render(
        React.createElement(TaskGroupedStreamBody, {
          threadId: 'thread-1',
          taskRuns,
          message,
          cliStatus: 'streaming',
          pendingAuthRequests: [pendingAuthRequest],
          onAuthRespond: vi.fn(),
        }),
      );
    });

    const blocks = Array.from(container.querySelectorAll('[data-testid="cli-output-block"]'));
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.getAttribute('data-event-ids')).toContain('tool-b');
    expect(blocks[1]?.getAttribute('data-auth-count')).toBe('1');
    expect(container.querySelectorAll('[data-testid="authorization-card"]')).toHaveLength(1);
  });
});
