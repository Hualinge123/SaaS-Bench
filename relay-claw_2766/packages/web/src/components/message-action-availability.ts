import type { AgentStatusType, ChatMessage } from '@/stores/chat-types';

type AgentInvocationLike = {
  invocationId?: string | null;
};

type CanEditUserMessagesArgs = {
  messages: ChatMessage[];
  hasActiveInvocation: boolean;
  targetAgents: string[];
  agentStatuses?: Record<string, AgentStatusType>;
  agentInvocations?: Record<string, AgentInvocationLike | undefined>;
};

function hasCurrentAgentInvocation(
  agentId: string | undefined,
  args: Pick<CanEditUserMessagesArgs, 'hasActiveInvocation' | 'targetAgents' | 'agentInvocations'>,
): boolean {
  if (!agentId) return false;
  if (!args.hasActiveInvocation) return false;
  return Boolean(args.agentInvocations?.[agentId]?.invocationId) || args.targetAgents.includes(agentId);
}

function isBlockingAgentStatus(status: AgentStatusType): boolean {
  return status === 'pending' || status === 'streaming';
}

function isCurrentlyEffectiveAssistantStreaming(
  message: ChatMessage,
  args: Pick<CanEditUserMessagesArgs, 'hasActiveInvocation' | 'targetAgents' | 'agentInvocations'>,
): boolean {
  return (
    message.type === 'assistant' && Boolean(message.isStreaming) && hasCurrentAgentInvocation(message.agentId, args)
  );
}

export function canEditUserMessagesForState(args: CanEditUserMessagesArgs): boolean {
  if (args.hasActiveInvocation) return false;
  if (args.messages.some((message) => isCurrentlyEffectiveAssistantStreaming(message, args))) return false;

  return !Object.entries(args.agentStatuses ?? {}).some(
    ([agentId, status]) => isBlockingAgentStatus(status) && hasCurrentAgentInvocation(agentId, args),
  );
}
