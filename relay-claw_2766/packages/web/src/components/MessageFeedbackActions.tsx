/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useCallback, useMemo, useState } from 'react';
import type { MessageFeedbackVote } from '@/hooks/useMessageFeedback';
import { useToastStore } from '@/stores/toastStore';
import type { CSSProperties } from 'react';
import { MessageToolbarMaskIcon } from './shared/message-toolbar-meta';
import { Button } from './shared/Button';
import { OverflowTooltip } from './shared/OverflowTooltip';

type FeedbackReaction = 'none' | 'like' | 'dislike';

type MessageFeedbackActionsProps = {
  messageId: string;
  catId?: string;
  alwaysVisible: boolean;
  value?: MessageFeedbackVote | null;
  onSubmit: (messageId: string, vote: MessageFeedbackVote, reason?: string) => Promise<void>;
  /** Default like/dislike glyph color (e.g. `#808080`). Active state keeps colored assets. */
  iconColor?: string;
};

const DISLIKE_DETAIL_MAX_LENGTH = 1000;

const DISLIKE_OPTIONS = [
  { label: '答案不准确', value: 'not_accurate' },
  { label: '回答速度慢', value: 'slow_response' },
  { label: '回答内容太长', value: 'too_long' },
  { label: '操作不便利', value: 'hard_to_use' },
  { label: '界面不美观', value: 'bad_ui' },
  { label: '内容有害', value: 'harmful_content' },
  { label: '工具技能太少', value: 'too_few_tools' },
  { label: '其他', value: 'other' },
] as const;

type DislikeReasonValue = (typeof DISLIKE_OPTIONS)[number]['value'];

const DISLIKE_LABEL_BY_VALUE = new Map(DISLIKE_OPTIONS.map((option) => [option.value, option.label]));

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
      <path d="M4.5 4.5L11.5 11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M11.5 4.5L4.5 11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function MessageFeedbackActions({
  messageId,
  catId,
  alwaysVisible,
  value,
  onSubmit,
  iconColor,
}: MessageFeedbackActionsProps) {
  const [isDislikeDialogOpen, setIsDislikeDialogOpen] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<DislikeReasonValue[]>([]);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  void catId;

  const reaction: FeedbackReaction = value === 1 ? 'like' : value === -1 ? 'dislike' : 'none';
  const visibilityClass = alwaysVisible
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto';
  const trimmedDetail = detail.trim();
  const canSubmit = (selectedReasons.length > 0 || trimmedDetail.length > 0) && !submitting;
  const detailCounter = useMemo(() => `${detail.length}/${DISLIKE_DETAIL_MAX_LENGTH}`, [detail.length]);

  const handleLike = useCallback(async () => {
    if (reaction === 'like' || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(messageId, 1);
    } catch {
      addToast({ type: 'error', title: '提交失败', message: '请稍后重试', duration: 2600 });
    } finally {
      setSubmitting(false);
    }
  }, [addToast, messageId, onSubmit, reaction, submitting]);

  const handleDetailChange = useCallback((next: string) => {
    setDetail(next.length > DISLIKE_DETAIL_MAX_LENGTH ? next.slice(0, DISLIKE_DETAIL_MAX_LENGTH) : next);
  }, []);

  const toggleReason = useCallback((value: DislikeReasonValue) => {
    setSelectedReasons((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }, []);

  const handleSubmitDislike = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const selectedReasonValue = selectedReasons.join(',');
      const selectedReasonLabel = selectedReasons
        .map((reason) => DISLIKE_LABEL_BY_VALUE.get(reason) ?? reason)
        .join(',');
      const reasonPayload = selectedReasonValue
        ? `values=${selectedReasonValue};labels=${selectedReasonLabel}`
        : '';
      const reason = reasonPayload && trimmedDetail ? `${reasonPayload};detail=${trimmedDetail}` : reasonPayload || trimmedDetail;
      await onSubmit(messageId, -1, reason);
      setIsDislikeDialogOpen(false);
      setSelectedReasons([]);
      setDetail('');
      addToast({ type: 'success', title: '反馈已提交', message: '', duration: 2400 });
    } catch (error) {
      addToast({
        type: 'error',
        title: '提交失败',
        message: error instanceof Error && error.message ? error.message : '网络异常',
        duration: 2600,
      });
    } finally {
      setSubmitting(false);
    }
  }, [addToast, canSubmit, messageId, onSubmit, selectedReasons, trimmedDetail]);

  return (
    <>
      <div className={`${visibilityClass} transition-opacity`}>
        <div className="message-feedback-actions">
          <OverflowTooltip content={reaction === 'like' ? '感谢点赞，我们会继续努力！' : '点赞'} forceShow className="relative inline-flex" gap={2}>
            <button
              type="button"
              onClick={() => void handleLike()}
              aria-label="点赞"
              disabled={submitting}
              className={`group/toolbar-btn inline-flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors hover:bg-[rgba(0,0,0,0.04)] focus-visible:bg-[rgba(0,0,0,0.04)] disabled:opacity-50 ${reaction === 'like' ? 'is-active-like' : ''}`}
              style={
                iconColor && reaction !== 'like'
                  ? ({ '--message-toolbar-icon-color': iconColor } as CSSProperties)
                  : undefined
              }
              data-testid="message-feedback-like"
            >
              {reaction === 'like' ? (
                <img src="/icons/chart/liked.svg" alt="" aria-hidden="true" className="message-feedback-icon h-4 w-4" />
              ) : iconColor ? (
                <MessageToolbarMaskIcon iconUrl="/icons/chart/like.svg" className="message-feedback-icon h-4 w-4" />
              ) : (
                <img src="/icons/chart/like.svg" alt="" aria-hidden="true" className="message-feedback-icon h-4 w-4" />
              )}
            </button>
          </OverflowTooltip>
          <OverflowTooltip content={reaction === 'dislike' ? '已点踩' : '点踩'} forceShow className="relative inline-flex" gap={2}>
            <button
              type="button"
              onClick={() => setIsDislikeDialogOpen(true)}
              aria-label="点踩"
              disabled={submitting}
              className={`group/toolbar-btn inline-flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors hover:bg-[rgba(0,0,0,0.04)] focus-visible:bg-[rgba(0,0,0,0.04)] disabled:opacity-50 ${reaction === 'dislike' ? 'is-active-dislike' : ''}`}
              style={
                iconColor && reaction !== 'dislike'
                  ? ({ '--message-toolbar-icon-color': iconColor } as CSSProperties)
                  : undefined
              }
              data-testid="message-feedback-dislike"
            >
              {reaction === 'dislike' ? (
                <img
                  src="/icons/chart/disliked.svg"
                  alt=""
                  aria-hidden="true"
                  className="message-feedback-icon h-4 w-4"
                />
              ) : iconColor ? (
                <MessageToolbarMaskIcon iconUrl="/icons/chart/dislike.svg" className="message-feedback-icon h-4 w-4 mt-[3px]" />
              ) : (
                <img src="/icons/chart/dislike.svg" alt="" aria-hidden="true" className="message-feedback-icon h-4 w-4" />
              )}
            </button>
          </OverflowTooltip>
        </div>
      </div>

      {isDislikeDialogOpen ? (
        <div className="message-feedback-dialog-mask" role="dialog" aria-modal="true" aria-label="点踩反馈弹窗">
          <div className="message-feedback-dialog">
            <div className="message-feedback-dialog-content relative">
              <div className="message-feedback-dialog-header">
                <h3 className="message-feedback-dialog-title">您的反馈对我们非常重要。</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onlyIcon
                  hasBorder={false}
                  aria-label="关闭"
                  onClick={() => setIsDislikeDialogOpen(false)}
                  className="message-feedback-dialog-close"
                >
                  <CloseIcon />
                </Button>
              </div>
              <div className="message-feedback-reason-grid">
                {DISLIKE_OPTIONS.map((reason) => (
                  <label key={reason.value} className="message-feedback-reason-option">
                    <input
                      type="checkbox"
                      name={`message-feedback-${messageId}`}
                      checked={selectedReasons.includes(reason.value)}
                      onChange={() => toggleReason(reason.value)}
                    />
                    <span>{reason.label}</span>
                  </label>
                ))}
              </div>
              <div className="message-feedback-detail-shell">
                <textarea
                  className="ui-textarea message-feedback-detail-input"
                  value={detail}
                  onChange={(event) => handleDetailChange(event.target.value)}
                  placeholder="请输入您的意见"
                />
                <span className="message-feedback-detail-counter">{detailCounter}</span>
              </div>
              <div className="message-feedback-dialog-actions">
                <Button variant="default" size="sm" onClick={handleSubmitDislike} disabled={!canSubmit}>
                  提交
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
