/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewThreadContainer } from '@/components/NewThreadContainer';

const mockNavigate = vi.fn();
const mockApiFetch = vi.fn();
const mockAddToast = vi.fn();
const mockSetCurrentThread = vi.fn();
const mockSetPendingNewThreadSend = vi.fn();
const mockAttachPendingNewThreadTarget = vi.fn();
const mockClearPendingNewThreadSend = vi.fn();
const mockSetPendingChatInsert = vi.fn();

type ChatInputProps = {
  onSend: (
    content: string,
    images?: File[],
    whisper?: unknown,
    deliveryMode?: unknown,
    sendOptions?: unknown,
  ) => void;
};

let latestChatInputProps: ChatInputProps | null = null;

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/utils/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector?: (state: { addToast: typeof mockAddToast }) => unknown) =>
    selector ? selector({ addToast: mockAddToast }) : { addToast: mockAddToast },
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setCurrentThread: mockSetCurrentThread,
      threads: [{ id: 'default' }],
      setPendingNewThreadSend: mockSetPendingNewThreadSend,
      attachPendingNewThreadTarget: mockAttachPendingNewThreadTarget,
      clearPendingNewThreadSend: mockClearPendingNewThreadSend,
      setPendingChatInsert: mockSetPendingChatInsert,
    }),
}));

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({}),
}));

vi.mock('@/components/ChatEmptyState', () => ({
  ChatEmptyState: () => null,
}));

vi.mock('@/components/chat-input/ChatInput', () => ({
  ChatInput: (props: ChatInputProps) => {
    latestChatInputProps = props;
    return React.createElement('div', { 'data-testid': 'chat-input-stub' });
  },
}));

vi.mock('@/components/DirectoryBrowserModal', () => ({
  DirectoryBrowserModal: () => null,
}));

describe('NewThreadContainer send failure recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    latestChatInputProps = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockNavigate.mockReset();
    mockApiFetch.mockReset();
    mockAddToast.mockReset();
    mockSetCurrentThread.mockReset();
    mockSetPendingNewThreadSend.mockReset();
    mockAttachPendingNewThreadTarget.mockReset();
    mockClearPendingNewThreadSend.mockReset();
    mockSetPendingChatInsert.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('restores input draft and shows toast when create-thread request fails', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'boom' }),
    });

    await act(async () => {
      root.render(React.createElement(NewThreadContainer));
    });

    expect(latestChatInputProps).toBeTruthy();

    await act(async () => {
      latestChatInputProps?.onSend('hello retry');
      await Promise.resolve();
    });

    expect(mockSetPendingNewThreadSend).toHaveBeenCalledTimes(1);
    expect(mockClearPendingNewThreadSend).toHaveBeenCalledTimes(1);
    expect(mockSetPendingChatInsert).toHaveBeenCalledWith({
      threadId: '__new__',
      text: 'hello retry',
      replaceAll: true,
    });
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        title: '创建会话失败',
      }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('restores attachments together with text when create-thread request fails', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'boom' }),
    });

    await act(async () => {
      root.render(React.createElement(NewThreadContainer));
    });

    const image = new File(['image-bytes'], 'mock.png', { type: 'image/png' });
    await act(async () => {
      latestChatInputProps?.onSend('with image', [image]);
      await Promise.resolve();
    });

    expect(mockSetPendingChatInsert).toHaveBeenCalledWith({
      threadId: '__new__',
      text: 'with image',
      images: [image],
      replaceAll: true,
    });
  });
});
