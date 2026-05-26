/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MessageFeedbackVote } from '@/hooks/useMessageFeedback';
import type { ChatMessage } from '@/stores/chatStore';
import { useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';
import { getUserId } from '@/utils/userId';
import { ConfirmDialog } from './ConfirmDialog';
import { MessageFeedbackActions } from './MessageFeedbackActions';
import { MessageCopyButton } from './shared/MessageCopyButton';
import { MessageEditButton } from './shared/MessageEditButton';
import { getAssistantMessageCompletedTimestamp } from '@/components/chat-message/utils/message-time';
import { MESSAGE_TOOLBAR_META_COLOR, MessageSentTime } from './shared/message-toolbar-meta';

type DialogState =
  | { type: 'none' }
  | { type: 'soft-delete' }
  | { type: 'hard-delete'; threadTitle: string | null }
  | { type: 'edit'; editedContent: string }
  | { type: 'branch-confirm'; editedContent: string }
  | { type: 'branch-direct' };

interface MessageActionsProps {
  message: ChatMessage;
  threadId: string;
  isLastCopyVisible?: boolean;
  isFeedbackAlwaysVisible?: boolean;
  feedbackValue?: MessageFeedbackVote | null;
  onSubmitFeedback?: (messageId: string, vote: MessageFeedbackVote, reason?: string) => Promise<void>;
  canEditUserMessage?: boolean;
  onEditUserMessage?: (content: string) => void;
  children: React.ReactNode;
}

function isCopyableMessage(message: ChatMessage): boolean {
  if ((message.type !== 'user' && message.type !== 'assistant') || !message.content.trim()) {
    return false;
  }
  if (message.type === 'assistant' && message.isStreaming) return false;
  if (message.type === 'user' && message.agentId) return false;
  return true;
}

function hasPersistedFeedbackId(message: ChatMessage): boolean {
  return (
    !message.id.startsWith('msg-') &&
    !message.id.startsWith('draft-') &&
    !message.id.startsWith('bg-') &&
    !message.id.startsWith('intent-recognition-stopped-')
  );
}

function isEditableUserMessage(
  message: ChatMessage,
  enabled: boolean,
  onEditUserMessage?: (content: string) => void,
): boolean {
  return (
    message.type === 'user' &&
    !message.agentId &&
    enabled &&
    Boolean(onEditUserMessage) &&
    Boolean(message.content.trim())
  );
}

export function MessageActions({
  message,
  threadId,
  isLastCopyVisible = false,
  isFeedbackAlwaysVisible = false,
  feedbackValue,
  onSubmitFeedback,
  canEditUserMessage = false,
  onEditUserMessage,
  children,
}: MessageActionsProps) {
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const removeMessage = useChatStore((s) => s.removeMessage);
  const navigate = useNavigate();
  const isUser = message.type === 'user' && !message.agentId;
  const isAssistant = message.type === 'assistant' && Boolean(message.agentId);
  const canCopy = isCopyableMessage(message);
  const canFeedback =
    canCopy &&
    isAssistant &&
    Boolean(onSubmitFeedback) &&
    hasPersistedFeedbackId(message);
  const canEdit = isEditableUserMessage(message, canEditUserMessage, onEditUserMessage);
  const shouldIndentAssistantCopy = isAssistant;
  const showSentTime = (isUser || isAssistant) && !message.isStreaming;
  const toolbarTime = isAssistant
    ? getAssistantMessageCompletedTimestamp(message)
    : message.timestamp;

  const hasToolbarLeadingActions = canFeedback || canCopy;

  const handleEdit = useCallback(() => {
    setDialog({ type: 'edit', editedContent: message.content });
  }, [message.content]);

  const handleBranchDirect = useCallback(() => setDialog({ type: 'branch-direct' }), []);
  const handleEditUserMessage = useCallback(() => {
    onEditUserMessage?.(message.content);
  }, [message.content, onEditUserMessage]);

  const confirmSoftDelete = useCallback(async () => {
    setDialog({ type: 'none' });
    try {
      const res = await apiFetch(`/api/messages/${message.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: getUserId(), mode: 'soft' }),
      });
      if (res.ok) removeMessage(message.id);
    } catch {
      /* socket event will sync if needed */
    }
  }, [message.id, removeMessage]);

  const confirmHardDelete = useCallback(async () => {
    if (dialog.type !== 'hard-delete') return;
    const confirmTitle = dialog.threadTitle ?? '确认删除';
    setDialog({ type: 'none' });
    try {
      const res = await apiFetch(`/api/messages/${message.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: getUserId(), mode: 'hard', confirmTitle }),
      });
      if (res.ok) removeMessage(message.id);
    } catch {
      /* socket event will sync if needed */
    }
  }, [dialog, message.id, removeMessage]);

  const handleBranchConfirm = useCallback(() => {
    if (dialog.type !== 'edit') return;
    setDialog({ type: 'branch-confirm', editedContent: dialog.editedContent });
  }, [dialog]);

  const confirmBranch = useCallback(async () => {
    if (dialog.type !== 'branch-confirm') return;
    const { editedContent } = dialog;
    setDialog({ type: 'none' });
    try {
      const res = await apiFetch(`/api/threads/${threadId}/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromMessageId: message.id,
          editedContent: editedContent !== message.content ? editedContent : undefined,
          userId: getUserId(),
        }),
      });
      if (res.ok) {
        const { threadId: newThreadId } = await res.json();
        navigate(`/thread/${newThreadId}`);
      }
    } catch {
      /* show error in future */
    }
  }, [dialog, message.id, message.content, threadId, navigate]);

  const branchingRef = useRef(false);
  const confirmBranchDirect = useCallback(async () => {
    if (branchingRef.current) return;
    branchingRef.current = true;
    setDialog({ type: 'none' });
    try {
      const res = await apiFetch(`/api/threads/${threadId}/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromMessageId: message.id, userId: getUserId() }),
      });
      if (res.ok) {
        const { threadId: newThreadId } = await res.json();
        navigate(`/thread/${newThreadId}`);
      }
    } catch {
      /* show error in future */
    } finally {
      branchingRef.current = false;
    }
  }, [message.id, threadId, navigate]);

  const close = useCallback(() => setDialog({ type: 'none' }), []);

  return (
    <div className="chat-layout-rail group relative">
      {children}
      {(canCopy || canFeedback || canEdit || showSentTime) && (
        <div
          data-testid="message-actions-toolbar"
          className={`mt-[8px] mb-[8px] flex items-center gap-1 ${isUser ? 'justify-end' : 'justify-start'} ${
            shouldIndentAssistantCopy ? 'pl-11' : ''
          }`}
        >
          {canFeedback && (
            <MessageFeedbackActions
              messageId={message.id}
              catId={message.agentId}
              alwaysVisible={isFeedbackAlwaysVisible}
              value={feedbackValue}
              onSubmit={onSubmitFeedback!}
              iconColor={MESSAGE_TOOLBAR_META_COLOR}
            />
          )}
          {canCopy && (
            <MessageCopyButton
              text={message.content}
              alwaysVisible={isLastCopyVisible}
              className="!m-0"
              iconColor={MESSAGE_TOOLBAR_META_COLOR}
            />
          )}
          {canEdit && (
            <MessageEditButton
              alwaysVisible={isLastCopyVisible}
              onClick={handleEditUserMessage}
              className="!m-0"
              iconColor={MESSAGE_TOOLBAR_META_COLOR}
            />
          )}
          {showSentTime && (
            <MessageSentTime
              timestamp={toolbarTime}
              alwaysVisible={isLastCopyVisible}
              offsetAfterCopy={hasToolbarLeadingActions}
              testId={isUser ? 'user-message-sent-time' : 'assistant-message-sent-time'}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={dialog.type === 'soft-delete'}
        title="删除消息"
        message="确认删除此消息？删除后可恢复。"
        confirmLabel="删除"
        color="danger"
        onConfirm={confirmSoftDelete}
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog.type === 'hard-delete'}
        title="永久删除"
        message="此操作不可恢复。请输入会话标题以确认。"
        requireInput={dialog.type === 'hard-delete' ? (dialog.threadTitle ?? '确认删除') : undefined}
        inputPlaceholder={dialog.type === 'hard-delete' && dialog.threadTitle ? '输入会话标题' : '输入 "确认删除"'}
        confirmLabel="永久删除"
        color="danger"
        onConfirm={confirmHardDelete}
        onCancel={close}
      />

      {dialog.type === 'edit' && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-base font-semibold mb-2">编辑消息</h3>
            <textarea
              value={dialog.editedContent}
              onChange={(e) => setDialog({ ...dialog, editedContent: e.target.value })}
              className="ui-textarea w-full rounded-lg px-3 py-2 text-sm mb-4 h-32"
            />
            <div className="flex justify-end gap-2">
              <button onClick={close} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                取消
              </button>
              <button
                onClick={handleBranchConfirm}
                disabled={!dialog.editedContent.trim()}
                className="px-4 py-2 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={dialog.type === 'branch-confirm'}
        title="创建分支"
        message="编辑将从此消息创建一个新的会话分支。原会话保留不变。是否继续？"
        confirmLabel="创建分支"
        onConfirm={confirmBranch}
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog.type === 'branch-direct'}
        title="从这里分支"
        message="将从此消息创建一个新的会话分支，复制到这条消息为止的所有历史。原会话保留不变。"
        confirmLabel="创建分支"
        onConfirm={confirmBranchDirect}
        onCancel={close}
      />
    </div>
  );
}
