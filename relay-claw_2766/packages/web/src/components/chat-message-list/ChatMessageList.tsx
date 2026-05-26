/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import type { Rect, Virtualizer } from '@tanstack/react-virtual';
import { useCallback, type ReactNode, type RefObject } from 'react';
import type { AskUserQuestionAnswer, PendingAskUserQuestion } from '@/stores/chat-types';
import type { ChatMessage as ChatMessageData } from '@/stores/chatStore';
import { AskUserQuestionCard } from '../AskUserQuestionCard';
import { ChatEmptyState } from '../ChatEmptyState';
import { OutlinePreviewCard } from '../outline-preview/OutlinePreviewCard';
import { CenteredLoadingState } from '../shared/CenteredLoadingState';

const ESTIMATED_MESSAGE_HEIGHT = 180;
const MIN_MEASURED_MESSAGE_HEIGHT = 24;
const DEFAULT_SCROLL_RECT_HEIGHT = 800;
const MAX_SCROLL_RECT_VIEWPORT_MULTIPLIER = 1.5;

function getMaxScrollRectHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_SCROLL_RECT_HEIGHT;
  return Math.max(DEFAULT_SCROLL_RECT_HEIGHT, window.innerHeight * MAX_SCROLL_RECT_VIEWPORT_MULTIPLIER);
}

function boundScrollRect(rect: Rect): Rect {
  const height = Number.isFinite(rect.height) ? rect.height : DEFAULT_SCROLL_RECT_HEIGHT;
  const boundedHeight = Math.min(Math.max(height, 1), getMaxScrollRectHeight());

  if (boundedHeight === rect.height) return rect;
  return { ...rect, height: boundedHeight };
}

interface ChatMessageListProps {
  messages: ChatMessageData[];
  isLoadingHistory: boolean;
  hasMore: boolean;
  pendingIntentRecognitionMessage: ChatMessageData | null;
  stoppedIntentRecognitionMessage: ChatMessageData | null;
  pendingQuestion: PendingAskUserQuestion | null;
  scrollContainerRef: RefObject<HTMLDivElement>;
  messagesEndRef: RefObject<HTMLDivElement>;
  renderMessage: (message: ChatMessageData) => ReactNode;
  onAgentsClick: () => void;
  onChannelsClick: () => void;
  onAskUserQuestionSubmit: (payload: {
    request_id: string;
    source?: string;
    answers: AskUserQuestionAnswer[];
  }) => void | Promise<void>;
}

export function ChatMessageList({
  messages,
  isLoadingHistory,
  hasMore,
  pendingIntentRecognitionMessage,
  stoppedIntentRecognitionMessage,
  pendingQuestion,
  scrollContainerRef,
  messagesEndRef,
  renderMessage,
  onAgentsClick,
  onChannelsClick,
  onAskUserQuestionSubmit,
}: ChatMessageListProps) {
  const observeBoundedElementRect = useCallback(
    (
      instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
      callback: (rect: Rect) => void,
    ): void | (() => void) => {
      return observeElementRect(instance, (rect) => {
        callback(boundScrollRect(rect));
      });
    },
    [],
  );

  const messageVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: messages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    getItemKey: (index) => messages[index]?.id ?? index,
    initialRect: { width: 0, height: DEFAULT_SCROLL_RECT_HEIGHT },
    observeElementRect: observeBoundedElementRect,
    measureElement: (element) => {
      const measuredHeight = element.getBoundingClientRect().height;
      return measuredHeight >= MIN_MEASURED_MESSAGE_HEIGHT ? measuredHeight : ESTIMATED_MESSAGE_HEIGHT;
    },
    overscan: 8,
  });

  const virtualItems = messageVirtualizer.getVirtualItems();
  const firstVirtualIndex = virtualItems[0]?.index ?? -1;
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  return (
    <>
      {isLoadingHistory && (
        <div className="absolute flex items-center justify-center w-full h-[90%]">
          <CenteredLoadingState />
        </div>
      )}
      {!hasMore && messages.length > 0 && (
        <div className="text-center py-3 text-xs text-gray-300 hidden">没有更多消息...</div>
      )}
      {messages.length === 0 && !isLoadingHistory ? (
        <ChatEmptyState onAgentsClick={onAgentsClick} onChannelsClick={onChannelsClick} />
      ) : (
        <div
          className="relative w-full"
          data-testid="chat-message-list-virtual-spacer"
          data-virtual-count={virtualItems.length}
          data-total-count={messages.length}
          data-first-index={firstVirtualIndex}
          data-last-index={lastVirtualIndex}
          style={{ height: `${messageVirtualizer.getTotalSize()}px` }}
        >
          {virtualItems.map((virtualItem) => {
            const message = messages[virtualItem.index];
            if (!message) return null;

            return (
              <div
                key={virtualItem.key}
                ref={messageVirtualizer.measureElement}
                data-index={virtualItem.index}
                data-testid="chat-message-list-virtual-row"
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {renderMessage(message)}
              </div>
            );
          })}
        </div>
      )}
      {pendingIntentRecognitionMessage && renderMessage(pendingIntentRecognitionMessage)}
      {!pendingIntentRecognitionMessage && stoppedIntentRecognitionMessage && renderMessage(stoppedIntentRecognitionMessage)}
      {pendingQuestion && (
        <div className="chat-layout-rail" style={{ paddingLeft: '44px' }}>
          {pendingQuestion.questions[0]?.preview ? (
            <OutlinePreviewCard
              requestId={pendingQuestion.requestId}
              source={pendingQuestion.source}
              questions={pendingQuestion.questions}
              onSubmit={onAskUserQuestionSubmit}
            />
          ) : (
            <AskUserQuestionCard
              requestId={pendingQuestion.requestId}
              source={pendingQuestion.source}
              questions={pendingQuestion.questions}
              expiresAtMs={pendingQuestion.expiresAtMs}
              onSubmit={onAskUserQuestionSubmit}
              onCancel={onAskUserQuestionSubmit}
            />
          )}
        </div>
      )}
      <div ref={messagesEndRef} />
    </>
  );
}
