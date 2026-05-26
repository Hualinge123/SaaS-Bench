/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { memo } from 'react';
import { ChatMessage } from '@/components/chat-message';
import type { AgentData } from '@/hooks/useAgentData';
import type { AuthPendingRequest, RespondScope } from '@/hooks/useAuthorization';
import type { MessageFeedbackVote } from '@/hooks/useMessageFeedback';
import type { ChatMessage as ChatMessageData } from '@/stores/chatStore';
import { MessageActions } from '../MessageActions';

interface ChatMessageRowProps {
  message: ChatMessageData;
  threadId: string;
  getAgentById: (id: string) => AgentData | undefined;
  suppressedGeneratedFileNames?: string[];
  pendingAuthRequests?: AuthPendingRequest[];
  onAuthRespond?: (requestId: string, granted: boolean, scope: RespondScope, reason?: string) => void | Promise<void>;
  onOpenSecurityManagement?: () => void;
  isLastCopyVisible: boolean;
  isFeedbackAlwaysVisible: boolean;
  feedbackValue: MessageFeedbackVote | null;
  onSubmitFeedback?: (messageId: string, vote: MessageFeedbackVote, reason?: string) => Promise<void>;
  canEditUserMessage: boolean;
  onEditUserMessage?: (content: string) => void;
}

function ChatMessageRowInner({
  message,
  threadId,
  getAgentById,
  suppressedGeneratedFileNames,
  pendingAuthRequests,
  onAuthRespond,
  onOpenSecurityManagement,
  isLastCopyVisible,
  isFeedbackAlwaysVisible,
  feedbackValue,
  onSubmitFeedback,
  canEditUserMessage,
  onEditUserMessage,
}: ChatMessageRowProps) {
  return (
    <MessageActions
      message={message}
      threadId={threadId}
      isLastCopyVisible={isLastCopyVisible}
      isFeedbackAlwaysVisible={isFeedbackAlwaysVisible}
      feedbackValue={feedbackValue}
      onSubmitFeedback={onSubmitFeedback}
      canEditUserMessage={canEditUserMessage}
      onEditUserMessage={onEditUserMessage}
    >
      <ChatMessage
        message={message}
        threadId={threadId}
        getAgentById={getAgentById}
        suppressedGeneratedFileNames={suppressedGeneratedFileNames}
        pendingAuthRequests={pendingAuthRequests}
        onAuthRespond={onAuthRespond}
        onOpenSecurityManagement={onOpenSecurityManagement}
      />
    </MessageActions>
  );
}

function areChatMessageRowPropsEqual(prev: ChatMessageRowProps, next: ChatMessageRowProps): boolean {
  return (
    prev.message === next.message &&
    prev.threadId === next.threadId &&
    prev.getAgentById === next.getAgentById &&
    prev.suppressedGeneratedFileNames === next.suppressedGeneratedFileNames &&
    prev.pendingAuthRequests === next.pendingAuthRequests &&
    prev.onAuthRespond === next.onAuthRespond &&
    prev.onOpenSecurityManagement === next.onOpenSecurityManagement &&
    prev.isLastCopyVisible === next.isLastCopyVisible &&
    prev.isFeedbackAlwaysVisible === next.isFeedbackAlwaysVisible &&
    prev.feedbackValue === next.feedbackValue &&
    prev.onSubmitFeedback === next.onSubmitFeedback &&
    prev.canEditUserMessage === next.canEditUserMessage &&
    prev.onEditUserMessage === next.onEditUserMessage
  );
}

export const ChatMessageRow = memo(ChatMessageRowInner, areChatMessageRowPropsEqual);
ChatMessageRow.displayName = 'ChatMessageRow';
