/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/chatStore', () => ({
  useChatStore: (selector: (state: { removeMessage: (id: string) => void }) => unknown) =>
    selector({ removeMessage: () => {} }),
}));

vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ threadId: 't2' }) })),
}));

vi.mock('@/utils/userId', () => ({
  getUserId: () => 'alice',
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

describe('MessageActions position', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('places user copy button row below the bubble and right-aligned', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        // eslint-disable-next-line react/no-children-prop -- createElement in test
        React.createElement(MessageActions, {
          message: {
            id: 'msg-user-1',
            type: 'user',
            content: 'hi',
            timestamp: Date.now(),
          },
          threadId: 'thread-1',
          isLastCopyVisible: true,
          // biome-ignore lint/correctness/noChildrenProp: createElement in test
          children: React.createElement('div', null, 'user message'),
        }),
      );
    });

    const toolbar = container.querySelector('[data-testid="message-actions-toolbar"]') as HTMLDivElement | null;
    expect(toolbar).not.toBeNull();
    expect(toolbar?.className).toContain('mt-[8px]');
    expect(toolbar?.className).toContain('mb-[8px]');
    expect(toolbar?.className).toContain('justify-end');
    const wrapper = container.querySelector('[data-testid="message-copy-button-wrapper"]');
    expect(wrapper).not.toBeNull();
    const sentTime = container.querySelector('[data-testid="user-message-sent-time"]') as HTMLElement | null;
    expect(sentTime).not.toBeNull();
    expect(sentTime?.textContent).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(sentTime?.style.color).toBe('rgb(128, 128, 128)');
    expect(sentTime?.className).toContain('opacity-100');
    const legacyToolbar = container.querySelector('div.absolute.right-1');
    expect(legacyToolbar).toBeNull();
  });

  it('hides user sent time until message hover when not the last copyable message', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        React.createElement(MessageActions, {
          message: {
            id: 'msg-user-1',
            type: 'user',
            content: 'hi',
            timestamp: Date.now(),
          },
          threadId: 'thread-1',
          isLastCopyVisible: false,
          children: React.createElement('div', null, 'user message'),
        }),
      );
    });

    const sentTime = container.querySelector('[data-testid="user-message-sent-time"]') as HTMLElement | null;
    expect(sentTime?.className).toContain('opacity-0');
    expect(sentTime?.className).toContain('group-hover:opacity-100');
  });

  it('renders assistant completed time from stream metadata, not bubble start timestamp', async () => {
    const { MessageActions } = await import('@/components/MessageActions');
    const start = new Date('2026-05-22T10:00:00').getTime();
    const completedAt = new Date('2026-05-22T10:05:30').getTime();

    await act(async () => {
      root.render(
        React.createElement(MessageActions, {
          message: {
            id: 'msg-assistant-1',
            type: 'assistant',
            agentId: 'codex',
            content: 'hello',
            timestamp: start,
            extra: { stream: { completedAt } },
          },
          threadId: 'thread-1',
          isLastCopyVisible: true,
          children: React.createElement('div', null, 'assistant message'),
        }),
      );
    });

    const sentTime = container.querySelector('[data-testid="assistant-message-sent-time"]');
    expect(sentTime?.textContent).toBe('05/22 10:05');
  });

  it('places assistant copy button row below the bubble and left-aligned', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        // eslint-disable-next-line react/no-children-prop -- createElement in test
        React.createElement(MessageActions, {
          message: {
            id: 'msg-assistant-1',
            type: 'assistant',
            agentId: 'codex',
            content: 'hello',
            timestamp: Date.now(),
          },
          threadId: 'thread-1',
          isLastCopyVisible: true,
          // biome-ignore lint/correctness/noChildrenProp: createElement in test
          children: React.createElement('div', null, 'assistant message'),
        }),
      );
    });

    const toolbar = container.querySelector('[data-testid="message-actions-toolbar"]') as HTMLDivElement | null;
    expect(toolbar).not.toBeNull();
    expect(toolbar?.className).toContain('justify-start');
    const wrapper = container.querySelector('[data-testid="message-copy-button-wrapper"]');
    expect(wrapper).not.toBeNull();
    const sentTime = container.querySelector('[data-testid="assistant-message-sent-time"]') as HTMLElement | null;
    expect(sentTime).not.toBeNull();
    expect(sentTime?.className).toContain('opacity-100');
    expect(sentTime?.className).toContain('ml-[12px]');
    const legacyToolbar = container.querySelector('div.absolute.right-1');
    expect(legacyToolbar).toBeNull();
  });

  it('hides assistant sent time until message hover when not the last copyable message', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        React.createElement(MessageActions, {
          message: {
            id: 'msg-assistant-1',
            type: 'assistant',
            agentId: 'codex',
            content: 'hello',
            timestamp: Date.now(),
          },
          threadId: 'thread-1',
          isLastCopyVisible: false,
          onSubmitFeedback: async () => {},
          children: React.createElement('div', null, 'assistant message'),
        }),
      );
    });

    const sentTime = container.querySelector('[data-testid="assistant-message-sent-time"]') as HTMLElement | null;
    expect(sentTime?.className).toContain('opacity-0');
    expect(sentTime?.className).toContain('group-hover:opacity-100');
    const feedbackWrap = container.querySelector('[data-testid="message-feedback-like"]')?.parentElement?.parentElement
      ?.parentElement;
    expect(feedbackWrap?.className).toContain('opacity-0');
    expect(feedbackWrap?.className).toContain('group-hover:opacity-100');
  });
});
