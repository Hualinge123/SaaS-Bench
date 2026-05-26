import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageList } from '@/components/chat-message-list/ChatMessageList';
import type { ChatMessage as ChatMessageData } from '@/stores/chatStore';

const { observeElementRectMock, useVirtualizerMock } = vi.hoisted(() => ({
  observeElementRectMock: vi.fn(),
  useVirtualizerMock: vi.fn(() => ({
    getVirtualItems: () =>
      Array.from({ length: 12 }, (_, index) => ({
        key: `message-${index}`,
        index,
        start: index * 180,
        end: (index + 1) * 180,
        size: 180,
        lane: 0,
      })),
    getTotalSize: () => 500 * 180,
    measureElement: vi.fn(),
  })),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: useVirtualizerMock,
  observeElementRect: observeElementRectMock,
}));

function createMessage(index: number): ChatMessageData {
  return {
    id: `message-${index}`,
    type: 'user',
    content: `message ${index}`,
    timestamp: index,
  } as ChatMessageData;
}

describe('ChatMessageList virtualization', () => {
  let scrollContainer: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    scrollContainer = document.createElement('div');
    scrollContainer.style.height = '800px';
    scrollContainer.style.overflowY = 'auto';
    document.body.appendChild(scrollContainer);
    root = createRoot(scrollContainer);
  });

  afterEach(() => {
    act(() => root.unmount());
    scrollContainer.remove();
    useVirtualizerMock.mockClear();
    observeElementRectMock.mockReset();
  });

  it('renders only the visible message window for long histories', () => {
    const messages = Array.from({ length: 500 }, (_, index) => createMessage(index));
    const scrollContainerRef = { current: scrollContainer };
    const messagesEndRef = { current: null };

    act(() => {
      root.render(
        <ChatMessageList
          messages={messages}
          isLoadingHistory={false}
          hasMore={false}
          pendingIntentRecognitionMessage={null}
          stoppedIntentRecognitionMessage={null}
          pendingQuestion={null}
          scrollContainerRef={scrollContainerRef}
          messagesEndRef={messagesEndRef}
          renderMessage={(message) => <div data-testid="rendered-message">{message.id}</div>}
          onAgentsClick={() => {}}
          onChannelsClick={() => {}}
          onAskUserQuestionSubmit={() => {}}
        />,
      );
    });

    const renderedMessages = scrollContainer.querySelectorAll('[data-testid="rendered-message"]');
    const virtualRows = scrollContainer.querySelectorAll('[data-testid="chat-message-list-virtual-row"]');
    const spacer = scrollContainer.querySelector('[data-testid="chat-message-list-virtual-spacer"]') as HTMLDivElement | null;

    expect(renderedMessages.length).toBeGreaterThan(0);
    expect(renderedMessages.length).toBeLessThan(messages.length);
    expect(virtualRows.length).toBe(renderedMessages.length);
    expect(spacer?.style.height).toBe(`${messages.length * 180}px`);
  });

  it('bounds abnormal scroll viewport measurements so virtualization does not render the whole history', () => {
    const messages = Array.from({ length: 500 }, (_, index) => createMessage(index));
    const scrollContainerRef = { current: scrollContainer };
    const messagesEndRef = { current: null };

    act(() => {
      root.render(
        <ChatMessageList
          messages={messages}
          isLoadingHistory={false}
          hasMore={false}
          pendingIntentRecognitionMessage={null}
          stoppedIntentRecognitionMessage={null}
          pendingQuestion={null}
          scrollContainerRef={scrollContainerRef}
          messagesEndRef={messagesEndRef}
          renderMessage={(message) => <div data-testid="rendered-message">{message.id}</div>}
          onAgentsClick={() => {}}
          onChannelsClick={() => {}}
          onAskUserQuestionSubmit={() => {}}
        />,
      );
    });

    const options = useVirtualizerMock.mock.calls[0]?.[0] as
      | {
          observeElementRect: (
            instance: never,
            callback: (rect: { width: number; height: number }) => void,
          ) => void | (() => void);
        }
      | undefined;
    const callback = vi.fn();
    if (!options) throw new Error('useVirtualizer was not called');
    observeElementRectMock.mockImplementationOnce((_instance, rectCallback: (rect: { width: number; height: number }) => void) => {
      rectCallback({ width: 640, height: 100_000 });
    });

    options.observeElementRect({} as never, callback);

    expect(callback).toHaveBeenCalledWith({
      width: 640,
      height: Math.max(800, window.innerHeight * 1.5),
    });
  });
});
