/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useMemo } from 'react';
import { countSendFileReadyHitsForResolvedPreviewPath } from '@/components/cli-output/local-generated-files';
import { buildMessageCliEvents } from '@/components/cli-output/toCliEvents';
import type { ChatMessage, CliEvent } from '@/stores/chat-types';
import { useChatStore } from '@/stores/chatStore';

const EMPTY_MESSAGES: readonly ChatMessage[] = [];

/** CLI timeline preserved in message order — matches chat bubble sequence. */
export function chronologicalCliEventsFromMessages(messages: readonly ChatMessage[]): CliEvent[] {
  const events: CliEvent[] = [];
  for (const m of messages) {
    events.push(...buildMessageCliEvents(m, { padUnmatchedToolResults: true }));
  }
  return events;
}

/** When send_file_ready fires again for the previewed path, this count increases so embedded fetch hooks can reload. */
export function useSendFilePreviewReloadRevision(threadId: string, resolvedPreviewPath: string | null | undefined): number {
  const messages = useChatStore((s) => {
    if (threadId === s.currentThreadId) return s.messages;
    return s.threadStates[threadId]?.messages ?? EMPTY_MESSAGES;
  });

  return useMemo(() => {
    if (!resolvedPreviewPath?.trim()) return 0;
    const cli = chronologicalCliEventsFromMessages(messages);
    return countSendFileReadyHitsForResolvedPreviewPath(cli, resolvedPreviewPath.trim());
  }, [messages, resolvedPreviewPath]);
}
