import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/stores/chat-types';
import { canEditUserMessagesForState } from '../message-action-availability';

const userMessage: ChatMessage = {
  id: 'user-1',
  type: 'user',
  content: 'revise this',
  timestamp: 1,
};

const staleStreamingAssistant: ChatMessage = {
  id: 'assistant-1',
  type: 'assistant',
  agentId: 'office',
  content: 'stopped',
  timestamp: 2,
  isStreaming: true,
};

describe('canEditUserMessagesForState', () => {
  it('allows editing when an assistant message only has stale isStreaming', () => {
    expect(
      canEditUserMessagesForState({
        messages: [userMessage, staleStreamingAssistant],
        hasActiveInvocation: false,
        targetAgents: [],
        agentStatuses: {},
        agentInvocations: {},
      }),
    ).toBe(true);
  });

  it('blocks editing when assistant streaming is still tied to a current invocation', () => {
    expect(
      canEditUserMessagesForState({
        messages: [userMessage, staleStreamingAssistant],
        hasActiveInvocation: true,
        targetAgents: ['office'],
        agentStatuses: {},
        agentInvocations: { office: { invocationId: 'inv-1' } },
      }),
    ).toBe(false);
  });

  it('allows editing when agentStatuses only contain stale streaming status', () => {
    expect(
      canEditUserMessagesForState({
        messages: [userMessage],
        hasActiveInvocation: false,
        targetAgents: [],
        agentStatuses: { office: 'streaming' },
        agentInvocations: {},
      }),
    ).toBe(true);
  });

  it('allows editing when agentInvocations only contain stale invocation ids', () => {
    expect(
      canEditUserMessagesForState({
        messages: [userMessage, staleStreamingAssistant],
        hasActiveInvocation: false,
        targetAgents: [],
        agentStatuses: { office: 'streaming' },
        agentInvocations: { office: { invocationId: 'stale-invocation' } },
      }),
    ).toBe(true);
  });

  it('blocks editing while the thread has an active invocation', () => {
    expect(
      canEditUserMessagesForState({
        messages: [userMessage],
        hasActiveInvocation: true,
        targetAgents: ['office'],
        agentStatuses: {},
        agentInvocations: {},
      }),
    ).toBe(false);
  });
});
