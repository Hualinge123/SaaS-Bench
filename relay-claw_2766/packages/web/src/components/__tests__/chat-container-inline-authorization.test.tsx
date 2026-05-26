/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatContainer, scrollPendingAuthorizationCardIntoView } from '@/components/ChatContainer';
import type { AuthPendingRequest } from '@/hooks/useAuthorization';

type MockMessage = {
  id: string;
  type: 'assistant' | 'user';
  agentId?: string;
  content: string;
  timestamp: number;
  toolEvents?: Array<{ id: string; type: 'tool_use'; label: string; timestamp: number }>;
  isStreaming?: boolean;
};

type MockStoreState = {
  messages: MockMessage[];
  isLoading: boolean;
  hasActiveInvocation: boolean;
  intentMode: null;
  targetAgents: string[];
  agentStatuses: Record<string, string>;
  agentInvocations: Record<string, unknown>;
  setCurrentThread: ReturnType<typeof vi.fn>;
  viewMode: 'single';
  setViewMode: ReturnType<typeof vi.fn>;
  clearUnread: ReturnType<typeof vi.fn>;
  confirmUnreadAck: ReturnType<typeof vi.fn>;
  armUnreadSuppression: ReturnType<typeof vi.fn>;
  uiThinkingExpandedByDefault: boolean;
  splitPaneThreadIds: string[];
  setSplitPaneThreadIds: ReturnType<typeof vi.fn>;
  setSplitPaneTarget: ReturnType<typeof vi.fn>;
  threads: Array<{ id: string; projectPath?: string }>;
  setCurrentProject: ReturnType<typeof vi.fn>;
  showVoteModal: boolean;
  setShowVoteModal: ReturnType<typeof vi.fn>;
  addMessage: ReturnType<typeof vi.fn>;
  consumePendingNewThreadSend: ReturnType<typeof vi.fn>;
  setPendingChatInsert: ReturnType<typeof vi.fn>;
};

const createMockStoreState = (): MockStoreState => ({
  messages: [],
  isLoading: false,
  hasActiveInvocation: false,
  intentMode: null,
  targetAgents: [],
  agentStatuses: {},
  agentInvocations: {},
  setCurrentThread: vi.fn(),
  viewMode: 'single',
  setViewMode: vi.fn(),
  clearUnread: vi.fn(),
  confirmUnreadAck: vi.fn(),
  armUnreadSuppression: vi.fn(),
  uiThinkingExpandedByDefault: false,
  splitPaneThreadIds: [],
  setSplitPaneThreadIds: vi.fn(),
  setSplitPaneTarget: vi.fn(),
  threads: [{ id: 'thread-1', projectPath: 'D:\\workspace\\thread-1' }],
  setCurrentProject: vi.fn(),
  showVoteModal: false,
  setShowVoteModal: vi.fn(),
  addMessage: vi.fn(),
  consumePendingNewThreadSend: vi.fn(() => null),
  setPendingChatInsert: vi.fn(),
});

const { mockChatMessages, mockGlobalAuthorizationCard } = vi.hoisted(() => ({
  mockChatMessages: vi.fn(
    ({
      message,
      pendingAuthRequests,
    }: {
      message: MockMessage;
      pendingAuthRequests?: AuthPendingRequest[];
    }) =>
      React.createElement(
        'div',
        {
          'data-testid': `chat-message-${message.id}`,
          'data-auth-count': String(pendingAuthRequests?.length ?? 0),
        },
        pendingAuthRequests && pendingAuthRequests.length > 0
          ? React.createElement('div', { 'data-authorization-card': 'true' }, message.id)
          : message.id,
      ),
  ),
  mockGlobalAuthorizationCard: vi.fn(() =>
    React.createElement('div', { 'data-testid': 'global-authorization-card' }),
  ),
}));

const mockFollowLayoutChangeIfPinned = vi.fn();
const mockScrollToBottom = vi.fn();
const mockClaimScrollPosition = vi.fn();
const mockReleaseScrollPositionClaim = vi.fn();
const mockScrollContainerRef: { current: HTMLElement | null } = { current: null };

let mockState = createMockStoreState();
let mockPending: AuthPendingRequest[] = [];

vi.mock('@/stores/chatStore', () => ({
  useChatStore: (selector?: (state: MockStoreState) => unknown) => (selector ? selector(mockState) : mockState),
}));

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: () => ({ clearTasks: vi.fn() }),
}));
vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({ cancelInvocation: vi.fn() }),
}));
vi.mock('@/hooks/useAgentMessages', () => ({
  useAgentMessages: () => ({
    handleAgentMessage: vi.fn(),
    handleStop: vi.fn(),
    resetRefs: vi.fn(),
    resetRefsForThreadSwitch: vi.fn(),
    resetTimeout: vi.fn(),
    clearDoneTimeout: vi.fn(),
  }),
}));
vi.mock('@/hooks/useChatHistory', () => ({
  useChatHistory: () => ({
    handleScroll: vi.fn(),
    scrollContainerRef: mockScrollContainerRef,
    messagesEndRef: { current: null },
    scrollToBottom: mockScrollToBottom,
    followLayoutChangeIfPinned: mockFollowLayoutChangeIfPinned,
    claimScrollPosition: mockClaimScrollPosition,
    releaseScrollPositionClaim: mockReleaseScrollPositionClaim,
    isLoadingHistory: false,
    hasMore: false,
  }),
}));
vi.mock('@/hooks/useSendMessage', () => ({
  useSendMessage: () => ({ handleSend: vi.fn(), uploadStatus: null, uploadError: null }),
}));
vi.mock('@/hooks/useAuthorization', () => ({
  useAuthorization: () => ({
    pending: mockPending,
    respond: vi.fn(),
    handleAuthRequest: vi.fn(),
    handleAuthResponse: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSplitPaneKeys', () => ({ useSplitPaneKeys: vi.fn() }));
vi.mock('@/hooks/useChatSocketCallbacks', () => ({
  useChatSocketCallbacks: () => ({}),
}));
vi.mock('@/hooks/useAgentData', () => ({
  useAgentData: () => ({
    agents: [{ id: 'codex', roster: { available: true }, color: { primary: '#000', secondary: '#fff' } }],
    getAgentById: (id: string) => ({ id, displayName: id, color: { primary: '#000', secondary: '#fff' } }),
  }),
}));
vi.mock('@/hooks/useVoiceAutoPlay', () => ({ useVoiceAutoPlay: vi.fn() }));
vi.mock('@/hooks/useVoiceStream', () => ({ useVoiceStream: vi.fn() }));
vi.mock('@/hooks/useVadInterrupt', () => ({ useVadInterrupt: vi.fn() }));
vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: (_key: string, initialValue: number) => [initialValue, vi.fn(), vi.fn()],
}));
vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({ threads: [], islogin: true, isskip: false }),
    }),
  ),
}));
vi.mock('@/utils/userId', () => ({ getUserId: () => 'test-user', setIsSkipAuth: vi.fn() }));

vi.mock('@/components/A2ACollapsible', () => ({ A2ACollapsible: () => null }));
vi.mock('@/components/agent-management/AgentManagement', () => ({ AgentManagement: () => null }));
vi.mock('@/components/AuthorizationCard', () => ({ AuthorizationCard: mockGlobalAuthorizationCard }));
vi.mock('@/components/OfficeClawHub', () => ({ OfficeClawHub: () => null }));
vi.mock('@/components/ChannelsPanel', () => ({ ChannelsPanel: () => null }));
vi.mock('@/components/ChatContainerHeader', () => ({ ChatContainerHeader: () => null }));
vi.mock('@/components/ChatEmptyState', () => ({ ChatEmptyState: () => null }));
vi.mock('@/components/chat-input/ChatInput', () => ({ ChatInput: () => null }));
vi.mock('@/components/chat-message', () => ({ ChatMessage: mockChatMessages }));
vi.mock('@/components/HubListModal', () => ({ HubListModal: () => null }));
vi.mock('@/components/MessageActions', () => ({
  MessageActions: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/MobileStatusSheet', () => ({ MobileStatusSheet: () => null }));
vi.mock('@/components/ModelsPanel', () => ({ ModelsPanel: () => null }));
vi.mock('@/components/ParallelStatusBar', () => ({ ParallelStatusBar: () => null }));
vi.mock('@/components/QueuePanel', () => ({ QueuePanel: () => null }));
vi.mock('@/components/RightContentHeader', () => ({ RightContentHeader: () => null }));
vi.mock('@/components/ScrollToBottomButton', () => ({ ScrollToBottomButton: () => null }));
vi.mock('@/components/ScheduledTasksPanel', () => ({ ScheduledTasksPanel: () => null }));
vi.mock('@/components/SecurityManagementModal', () => ({ default: () => null }));
vi.mock('@/components/skills-panel/SkillsPanel', () => ({ SkillsPanel: () => null }));
vi.mock('@/components/SplitPaneView', () => ({ SplitPaneView: () => null }));
vi.mock('@/components/ThinkingIndicator', () => ({ ThinkingIndicator: () => null }));
vi.mock('@/components/ThreadExecutionBar', () => ({ ThreadExecutionBar: () => null }));
vi.mock('@/components/ThreadSidebar', () => ({ ThreadSidebar: () => null }));
vi.mock('@/components/workspace/ResizeHandle', () => ({ ResizeHandle: () => null }));

describe('ChatContainer inline authorization placement', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockState = createMockStoreState();
    mockPending = [];
    mockChatMessages.mockClear();
    mockGlobalAuthorizationCard.mockClear();
    mockFollowLayoutChangeIfPinned.mockClear();
    mockScrollToBottom.mockClear();
    mockClaimScrollPosition.mockClear();
    mockReleaseScrollPositionClaim.mockClear();
    mockScrollContainerRef.current = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('passes pending authorization only to the matching assistant message and does not render a global card', () => {
    mockState.messages = [
      {
        id: 'assistant-old',
        type: 'assistant',
        agentId: 'codex',
        content: 'previous result',
        timestamp: 1000,
        toolEvents: [{ id: 'tool-old', type: 'tool_use', label: 'Read', timestamp: 1000 }],
      },
      {
        id: 'assistant-active',
        type: 'assistant',
        agentId: 'codex',
        content: 'active result',
        timestamp: 2000,
        isStreaming: true,
        toolEvents: [{ id: 'tool-active', type: 'tool_use', label: 'Shell', timestamp: 2000 }],
      },
      {
        id: 'assistant-no-tools',
        type: 'assistant',
        agentId: 'codex',
        content: 'text only',
        timestamp: 3000,
      },
    ];
    mockPending = [
      {
        requestId: 'auth-1',
        agentId: 'codex',
        threadId: 'thread-1',
        action: 'shell_command',
        reason: 'Need approval',
        createdAt: 2100,
      },
    ];

    act(() => {
      root.render(React.createElement(ChatContainer, { threadId: 'thread-1' }));
    });

    expect(mockGlobalAuthorizationCard).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="global-authorization-card"]')).toBeNull();

    const authCountByMessageId = new Map(
      mockChatMessages.mock.calls.map(([props]) => [props.message.id as string, props.pendingAuthRequests?.length ?? 0]),
    );

    expect(authCountByMessageId.get('assistant-active')).toBe(1);
    expect(authCountByMessageId.get('assistant-old')).toBe(0);
    expect(authCountByMessageId.get('assistant-no-tools')).toBe(0);
  });

  it('claims scroll instead of requesting bottom follow when a new inline authorization card appears', () => {
    mockState.messages = [
      {
        id: 'assistant-active',
        type: 'assistant',
        agentId: 'codex',
        content: 'active result',
        timestamp: 2000,
        isStreaming: true,
        toolEvents: [{ id: 'tool-active', type: 'tool_use', label: 'Shell', timestamp: 2000 }],
      },
    ];

    act(() => {
      root.render(React.createElement(ChatContainer, { threadId: 'thread-1' }));
    });

    mockFollowLayoutChangeIfPinned.mockClear();

    expect(mockFollowLayoutChangeIfPinned).not.toHaveBeenCalled();

    mockPending = [
      {
        requestId: 'auth-1',
        agentId: 'codex',
        threadId: 'thread-1',
        action: 'shell_command',
        reason: 'Need approval',
        createdAt: 2100,
      },
    ];

    act(() => {
      root.render(React.createElement(ChatContainer, { threadId: 'thread-1' }));
    });

    expect(mockFollowLayoutChangeIfPinned).not.toHaveBeenCalled();
    expect(mockClaimScrollPosition).toHaveBeenCalledTimes(1);
  });

  it('scrolls to the inline authorization card when pending approval is present', () => {
    const scrollIntoView = vi.fn();
    const scrollContainer = document.createElement('div');
    const pendingAuthorizationCard = document.createElement('div');
    pendingAuthorizationCard.setAttribute('data-authorization-card', 'true');
    pendingAuthorizationCard.scrollIntoView = scrollIntoView;
    scrollContainer.appendChild(pendingAuthorizationCard);

    expect(scrollPendingAuthorizationCardIntoView(scrollContainer)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('keeps scroll ownership when scrolling to the rendered authorization card', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    mockState.messages = [
      {
        id: 'assistant-active',
        type: 'assistant',
        agentId: 'codex',
        content: 'active result',
        timestamp: 2000,
        isStreaming: true,
        toolEvents: [{ id: 'tool-active', type: 'tool_use', label: 'Shell', timestamp: 2000 }],
      },
    ];
    mockPending = [
      {
        requestId: 'auth-1',
        agentId: 'codex',
        threadId: 'thread-1',
        action: 'shell_command',
        reason: 'Need approval',
        createdAt: 2100,
      },
    ];

    act(() => {
      root.render(React.createElement(ChatContainer, { threadId: 'thread-1' }));
    });
    act(() => {
      for (const callback of rafCallbacks.splice(0)) callback(0);
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(mockClaimScrollPosition).toHaveBeenCalledTimes(1);
  });

  it('returns to the bottom when the inline authorization card is gone', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    mockState.messages = [
      {
        id: 'assistant-active',
        type: 'assistant',
        agentId: 'codex',
        content: 'active result',
        timestamp: 2000,
        isStreaming: true,
        toolEvents: [{ id: 'tool-active', type: 'tool_use', label: 'Shell', timestamp: 2000 }],
      },
    ];
    mockPending = [
      {
        requestId: 'auth-1',
        agentId: 'codex',
        threadId: 'thread-1',
        action: 'shell_command',
        reason: 'Need approval',
        createdAt: 2100,
      },
    ];

    act(() => {
      root.render(React.createElement(ChatContainer, { threadId: 'thread-1' }));
    });
    act(() => {
      for (const callback of rafCallbacks.splice(0)) callback(0);
    });

    mockPending = [];
    act(() => {
      root.render(React.createElement(ChatContainer, { threadId: 'thread-1' }));
    });

    expect(mockReleaseScrollPositionClaim).toHaveBeenCalledTimes(1);
    expect(mockScrollToBottom).toHaveBeenCalledWith('smooth');
  });

  it('does not claim scroll when pending approval has no inline authorization card host', () => {
    mockState.messages = [
      {
        id: 'assistant-no-tools',
        type: 'assistant',
        agentId: 'codex',
        content: 'text only',
        timestamp: 2000,
      },
    ];
    mockPending = [
      {
        requestId: 'auth-1',
        agentId: 'codex',
        threadId: 'thread-1',
        action: 'shell_command',
        reason: 'Need approval',
        createdAt: 2100,
      },
    ];

    act(() => {
      root.render(React.createElement(ChatContainer, { threadId: 'thread-1' }));
    });

    expect(mockClaimScrollPosition).not.toHaveBeenCalled();
    expect(mockScrollToBottom).not.toHaveBeenCalled();
  });
});
