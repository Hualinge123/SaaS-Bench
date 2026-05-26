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

describe('MessageActions copy button', () => {
  let container: HTMLDivElement;
  let root: Root;
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('keeps the last copyable message icon visible and keeps non-last as hover-reveal classes', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        <div>
          <MessageActions
            message={{ id: 'm1', type: 'assistant', agentId: 'codex', content: 'first', timestamp: Date.now() }}
            threadId="thread-1"
            isLastCopyVisible={false}
          >
            <div>assistant message 1</div>
          </MessageActions>
          <MessageActions
            message={{ id: 'm2', type: 'assistant', agentId: 'codex', content: 'last', timestamp: Date.now() }}
            threadId="thread-1"
            isLastCopyVisible
          >
            <div>assistant message 2</div>
          </MessageActions>
        </div>,
      );
    });

    const wrappers = container.querySelectorAll('[data-testid="message-copy-button-wrapper"]');
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0]?.className).toContain('mt-[8px]');
    expect(wrappers[0]?.className).toContain('mb-[8px]');
    expect(wrappers[0]?.className).toContain('group-hover:opacity-100');
    expect(wrappers[0]?.className).toContain('opacity-0');
    expect(wrappers[1]?.className).toContain('opacity-100');
    expect(wrappers[1]?.className).not.toContain('group-hover:opacity-100');
  });

  it('does not show tooltip on message hover and only shows it on icon hover', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        <MessageActions
          message={{ id: 'm1', type: 'assistant', agentId: 'codex', content: 'copy me', timestamp: Date.now() }}
          threadId="thread-1"
          isLastCopyVisible
        >
          <div data-testid="message-shell">assistant message</div>
        </MessageActions>,
      );
    });

    const messageShell = container.querySelector('[data-testid="message-shell"]') as HTMLDivElement | null;
    const messageGroup = messageShell?.closest('.group') as HTMLDivElement | null;
    expect(messageGroup).not.toBeNull();

    await act(async () => {
      messageGroup?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

    const copyButton = container.querySelector('[data-testid="message-copy-button"]') as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(150);
    });
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
  });

  it('switches copy state after click and restores after 1.5s', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        <MessageActions
          message={{ id: 'm1', type: 'assistant', agentId: 'codex', content: 'copy me', timestamp: Date.now() }}
          threadId="thread-1"
          isLastCopyVisible
        >
          <div>assistant message</div>
        </MessageActions>,
      );
    });

    const copyButton = container.querySelector('[data-testid="message-copy-button"]') as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();
    const initialLabel = copyButton?.getAttribute('aria-label');

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      copyButton?.click();
    });

    expect(clipboardWriteText).toHaveBeenCalledWith('copy me');
    expect(copyButton?.getAttribute('aria-label')).not.toBe(initialLabel);

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(copyButton?.getAttribute('aria-label')).toBe(initialLabel);
  });

  it('renders a user edit button after copy and calls back with the message content', async () => {
    const { MessageActions } = await import('@/components/MessageActions');
    const onEditUserMessage = vi.fn();
    const message = { id: 'm-user', type: 'user' as const, content: 'revise this', timestamp: Date.now() };

    await act(async () => {
      root.render(
        <MessageActions
          message={message}
          threadId="thread-1"
          isLastCopyVisible
          canEditUserMessage
          onEditUserMessage={onEditUserMessage}
        >
          <div>user message</div>
        </MessageActions>,
      );
    });

    const copyWrapper = container.querySelector('[data-testid="message-copy-button-wrapper"]');
    const editWrapper = container.querySelector('[data-testid="message-edit-button-wrapper"]');
    const editButton = container.querySelector('[data-testid="message-edit-button"]') as HTMLButtonElement | null;
    const copyButton = container.querySelector('[data-testid="message-copy-button"]') as HTMLButtonElement | null;
    expect(copyWrapper).not.toBeNull();
    expect(editWrapper).not.toBeNull();
    expect(copyButton).not.toBeNull();
    expect(editButton).not.toBeNull();
    expect(editButton?.getAttribute('aria-label')).toBe('编辑');
    expect(editButton?.style.getPropertyValue('--message-toolbar-icon-color')).toBe(
      copyButton?.style.getPropertyValue('--message-toolbar-icon-color'),
    );
    const toolbarChildren = Array.from(copyWrapper?.parentElement?.children ?? []);
    const copyIndex = toolbarChildren.indexOf(copyWrapper as Element);
    const editIndex = toolbarChildren.indexOf(editWrapper as Element);
    const sentTimeIndex = toolbarChildren.findIndex(
      (child) => child.getAttribute('data-testid') === 'user-message-sent-time',
    );
    expect(editIndex).toBe(copyIndex + 1);
    expect(sentTimeIndex).toBeGreaterThan(editIndex);

    await act(async () => {
      editButton?.click();
    });

    expect(onEditUserMessage).toHaveBeenCalledTimes(1);
    expect(onEditUserMessage).toHaveBeenCalledWith('revise this');
  });

  it('does not render a user edit button while current output is streaming', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        <MessageActions
          message={{ id: 'm-user', type: 'user', content: 'revise later', timestamp: Date.now() }}
          threadId="thread-1"
          isLastCopyVisible
          canEditUserMessage={false}
          onEditUserMessage={vi.fn()}
        >
          <div>user message</div>
        </MessageActions>,
      );
    });

    expect(container.querySelector('[data-testid="message-copy-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="message-edit-button"]')).toBeNull();
  });

  it('does not render an edit button for assistant messages', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        <MessageActions
          message={{ id: 'm-assistant', type: 'assistant', agentId: 'codex', content: 'answer', timestamp: Date.now() }}
          threadId="thread-1"
          isLastCopyVisible
          canEditUserMessage
          onEditUserMessage={vi.fn()}
        >
          <div>assistant message</div>
        </MessageActions>,
      );
    });

    expect(container.querySelector('[data-testid="message-copy-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="message-edit-button"]')).toBeNull();
  });

  it('does not render a copy button while an assistant message is still streaming', async () => {
    const { MessageActions } = await import('@/components/MessageActions');

    await act(async () => {
      root.render(
        <MessageActions
          message={{
            id: 'm-streaming',
            type: 'assistant',
            agentId: 'codex',
            content: 'partial content',
            isStreaming: true,
            timestamp: Date.now(),
          }}
          threadId="thread-1"
          isLastCopyVisible
        >
          <div>streaming assistant message</div>
        </MessageActions>,
      );
    });

    expect(container.querySelector('[data-testid="message-copy-button-wrapper"]')).toBeNull();
    expect(container.querySelector('[data-testid="message-copy-button"]')).toBeNull();
  });
});
