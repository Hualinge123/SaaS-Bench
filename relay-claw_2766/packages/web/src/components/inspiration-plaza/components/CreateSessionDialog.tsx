/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppModal } from '@/components/AppModal';
import { Button } from '@/components/shared/Button';
import { OverflowTooltip } from '@/components/shared/OverflowTooltip';
import { SearchInput } from '@/components/shared/SearchInput';
import { formatRelativeTime } from '@/components/thread-sidebar/thread-utils';
import { useAgentData } from '@/hooks/useAgentData';
import { useExpertCatalog } from '@/hooks/useExpertCatalog';
import type { Thread } from '@/stores/chat-types';
import { apiFetch } from '@/utils/api-client';
import { SessionAvatarGroup } from './SessionAvatarGroup';

const HOME_DRAFT_THREAD_ID = '__new__';

interface SessionItem {
  id: string;
  title: string | null;
  lastActiveAt: number;
  participants: string[];
  invitedExpertIds: string[];
}

interface CreateSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateNew: (threadId: string) => void;
  onSelectExisting: (threadId: string) => void;
  newSessionDisabledReason?: string;
}

function normalizeStoredThreadTitleOrNull(title: string | null | undefined): string | null {
  if (!title) return null;
  const trimmed = title.trim();
  return trimmed === '' ? null : trimmed;
}

function getSessionTitle(session: SessionItem): string {
  return session.title ?? (session.id === 'default' ? '大厅' : '未命名会话');
}

function getSessionAgentInfo(
  session: SessionItem,
  resolveParticipantById: (id: string) => { displayName?: string } | null | undefined,
): string {
  const participantIds = Array.from(new Set([...session.participants, ...session.invitedExpertIds]));
  const names = participantIds.map((id) => resolveParticipantById(id)?.displayName ?? id).filter(Boolean);
  return names.length > 0 ? names.join(', ') : '暂无智能体';
}

export function CreateSessionDialog({
  open,
  onClose,
  onCreateNew,
  onSelectExisting,
  newSessionDisabledReason,
}: CreateSessionDialogProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { getAgentById } = useAgentData();
  const { getExpertById } = useExpertCatalog();
  const isNewSessionDisabled = Boolean(newSessionDisabledReason);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/threads');
      if (!res.ok) return;
      const data = await res.json();
      const nextSessions = ((data.threads ?? []) as Thread[])
        .map((thread) => ({
          id: thread.id,
          title: normalizeStoredThreadTitleOrNull(thread.title),
          lastActiveAt: thread.lastActiveAt,
          participants: thread.participants ?? [],
          invitedExpertIds: thread.invitedExpertIds ?? [],
        }))
        .filter((session) => session.id !== 'default')
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
      setSessions(nextSessions);
    } catch {
      // Keep the existing list visible when refresh fails.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setSearchKeyword('');
    void loadSessions();
  }, [loadSessions, open]);

  const filteredSessions = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return sessions;
    return sessions.filter((session) => {
      const title = getSessionTitle(session).toLowerCase();
      return title.includes(keyword);
    });
  }, [searchKeyword, sessions]);

  const handleNewSession = () => {
    if (isNewSessionDisabled) return;
    onCreateNew(HOME_DRAFT_THREAD_ID);
    onClose();
  };

  const handleConfirm = () => {
    if (!selectedId) return;
    onSelectExisting(selectedId);
    onClose();
  };

  const resolveParticipantById = useCallback(
    (id: string) => getAgentById(id) ?? getExpertById(id),
    [getAgentById, getExpertById],
  );

  return (
    <AppModal
      open={open}
      onClose={onClose}
      disableBackdropClose
      title="选择会话"
      panelClassName="w-[560px]"
      bodyClassName="p-0"
      zIndexClassName="z-[120]"
    >
      <div className="flex flex-col">
        <div className="flex items-center gap-2 pt-4 pb-3">
          <SearchInput
            value={searchKeyword}
            onChange={(value) => setSearchKeyword(value)}
            onClear={() => setSearchKeyword('')}
            placeholder="搜索会话"
            wrapperClassName="flex-1"
          />
          <Button
            variant="default"
            size="md"
            onlyIcon
            hasBorder
            aria-label="刷新会话列表"
            className="shrink-0"
            iconLeft={<img src="/icons/icon-refresh.svg" alt="" className="h-4 w-4" />}
            onClick={() => void loadSessions()}
            loading={isLoading}
          />
        </div>

        <div className="max-h-[360px] overflow-y-auto pb-3">
          {isLoading && sessions.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--text-secondary)]">加载会话中...</div>
          ) : null}
          {!isLoading && sessions.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--text-secondary)]">暂无会话，可新建会话</div>
          ) : null}
          {!isLoading && sessions.length > 0 && filteredSessions.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--text-secondary)]">暂无匹配会话</div>
          ) : null}
          <div className="space-y-2">
            {filteredSessions.map((session) => {
              const displayTitle = getSessionTitle(session);
              const isSelected = selectedId === session.id;
              const avatarParticipantIds = Array.from(new Set([...session.participants, ...session.invitedExpertIds]));
              const agentInfo = getSessionAgentInfo(session, resolveParticipantById);
              const relativeTime = formatRelativeTime(session.lastActiveAt, true);
              return (
                <button
                  key={session.id}
                  type="button"
                  data-testid={`session-option-${session.id}`}
                  onClick={() => setSelectedId(session.id)}
                  className={[
                    'flex w-full items-center gap-3 rounded-lg border px-6 py-3 text-left transition-colors',
                    isSelected ? 'border-[#1476FF]' : 'border-[#F0F0F0]',
                    'bg-[#FAFAFA] hover:bg-[var(--surface-hover)]',
                  ].join(' ')}
                >
                  <SessionAvatarGroup
                    participants={avatarParticipantIds}
                    getAgentById={getAgentById}
                    getExpertById={getExpertById}
                    size={32}
                  />
                  <div data-testid="session-option-body" className="flex min-w-0 flex-1 flex-col">
                    <div data-testid="session-option-title-tooltip" className="min-w-0">
                      <OverflowTooltip content={displayTitle} className="min-w-0">
                        <span
                          data-testid="session-option-title"
                          className="block truncate text-sm font-medium text-[var(--text-primary)]"
                        >
                          {displayTitle}
                        </span>
                      </OverflowTooltip>
                    </div>
                    <div data-testid="session-option-meta-row" className="mt-1 flex min-w-0 items-center justify-between gap-3">
                      <div data-testid="session-option-agent-tooltip" className="min-w-0 flex-1">
                        <OverflowTooltip content={agentInfo} className="min-w-0">
                          <span
                            data-testid="session-option-agent-info"
                            className="block truncate text-xs text-[var(--text-secondary)]"
                          >
                            {agentInfo}
                          </span>
                        </OverflowTooltip>
                      </div>
                      <div
                        data-testid="session-option-time-info"
                        className="shrink-0 whitespace-nowrap text-xs text-[var(--text-tertiary)]"
                      >
                        {relativeTime}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div
          data-testid="create-session-dialog-actions"
          className="flex items-center justify-end gap-2 px-4 py-3"
        >
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button variant="default" size="md" onClick={onClose}>
              取消
            </Button>
            {newSessionDisabledReason ? (
              <OverflowTooltip content={newSessionDisabledReason} forceShow className="inline-flex shrink-0">
                <span className="inline-flex shrink-0">
                  <Button
                    variant="default"
                    size="md"
                    onClick={handleNewSession}
                    disabled={isNewSessionDisabled}
                  >
                    新建会话
                  </Button>
                </span>
              </OverflowTooltip>
            ) : (
              <span className="inline-flex shrink-0">
                <Button
                  variant="default"
                  size="md"
                  onClick={handleNewSession}
                  disabled={isNewSessionDisabled}
                >
                  新建会话
                </Button>
              </span>
            )}
            <Button variant="major" size="md" onClick={handleConfirm} disabled={!selectedId}>
              确定
            </Button>
          </div>
        </div>
      </div>
    </AppModal>
  );
}
