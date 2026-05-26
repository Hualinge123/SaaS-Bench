/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFeedbackActions } from '../MessageFeedbackActions';

describe('MessageFeedbackActions', () => {
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('shows a thank-you tip after liking a message', async () => {
    const onSubmit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    act(() => {
      root.render(
        React.createElement(MessageFeedbackActions, {
          messageId: 'message-1',
          alwaysVisible: true,
          onSubmit,
        }),
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="message-feedback-like"]') as HTMLButtonElement | null)?.click();
    });

    expect(onSubmit).toHaveBeenCalledWith('message-1', 1);
    act(() => {
      root.render(
        React.createElement(MessageFeedbackActions, {
          messageId: 'message-1',
          alwaysVisible: true,
          value: 1,
          onSubmit,
        }),
      );
    });

    const likeButton = container.querySelector('[data-testid="message-feedback-like"]') as HTMLButtonElement | null;
    act(() => {
      likeButton?.parentElement?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(160);
    });

    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('感谢点赞，我们会继续努力！');
  });
});
