import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentManagementView, type AgentManagementViewProps } from '../AgentManagementView';
import type { AgentData } from '@/hooks/useAgentData';

vi.mock('../components/ListGrid', () => ({
  ListGrid: () => <div data-testid="list-grid">list-grid</div>,
}));

vi.mock('../components/Toolbar', () => ({
  Toolbar: () => <div data-testid="toolbar">toolbar</div>,
}));

vi.mock('../components/DetailContent', () => ({
  DetailContent: () => <div data-testid="detail-content">detail-content</div>,
}));

vi.mock('../components/DetailSkillsSection', () => ({
  DetailSkillsSection: () => <div data-testid="detail-skills">detail-skills</div>,
}));

vi.mock('../components/SoulConfig', () => ({
  SoulConfig: () => <div data-testid="soul-config">soul-config</div>,
}));

vi.mock('../components/FormContent', () => ({
  FormContent: () => <div data-testid="form-content">form-content</div>,
}));

const agent = {
  id: 'agent-1',
  name: 'agent-1',
  displayName: '测试智能体',
  color: { primary: '#000000', secondary: '#ffffff' },
  mentionPatterns: ['@agent-1'],
  provider: 'relayclaw',
  defaultModel: 'gpt-5',
  avatar: '',
  roleDescription: 'desc',
  personality: 'personality',
  teamStrengths: '',
  source: 'runtime',
} satisfies AgentData;

function buildProps(overrides: Partial<AgentManagementViewProps> = {}): AgentManagementViewProps {
  return {
    agents: [agent],
    filteredAgents: [agent],
    searchQuery: '',
    sourceFilter: 'all',
    selectedAgent: null,
    currentView: 'list',
    formMode: 'create',
    editingAgent: null,
    previousView: null,
    prefillData: null,
    loading: false,
    onSearchChange: vi.fn(),
    onClearSearch: vi.fn(),
    onSourceFilterChange: vi.fn(),
    onRefresh: vi.fn(),
    onSelectAgent: vi.fn(),
    onOpenCreate: vi.fn(),
    onOpenEdit: vi.fn(),
    onDeleteAgent: vi.fn(),
    onCancel: vi.fn(),
    onSaveSuccess: vi.fn(),
    onBackToDetail: vi.fn(),
    onBackToList: vi.fn(),
    ...overrides,
  };
}

describe('AgentManagementView layout', () => {
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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('keeps the detail view inside a flexed overflow-hidden shell with its own scroll region', async () => {
    await act(async () => {
      root.render(<AgentManagementView {...buildProps({ currentView: 'detail', selectedAgent: agent })} />);
    });

    const shell = container.firstElementChild as HTMLElement | null;
    expect(shell?.className).toContain('flex-1');
    expect(shell?.className).toContain('overflow-hidden');

    const detailView = shell?.firstElementChild as HTMLElement | null;
    expect(detailView?.className).toContain('flex-1');
    expect(detailView?.className).toContain('overflow-hidden');

    const scrollRegion = detailView?.querySelector('.overflow-auto') as HTMLElement | null;
    expect(scrollRegion?.className).toContain('flex-1');
    expect(scrollRegion?.className).toContain('overflow-auto');
  });

  it('keeps the form view inside a flexed overflow-hidden shell', async () => {
    await act(async () => {
      root.render(<AgentManagementView {...buildProps({ currentView: 'form' })} />);
    });

    const shell = container.firstElementChild as HTMLElement | null;
    expect(shell?.className).toContain('flex-1');
    expect(shell?.className).toContain('overflow-hidden');

    const formView = shell?.firstElementChild as HTMLElement | null;
    expect(formView?.className).toContain('flex');
    expect(formView?.className).toContain('flex-1');
    expect(formView?.className).toContain('overflow-hidden');
    expect(formView?.querySelector('[data-testid="form-content"]')).not.toBeNull();
  });
});
