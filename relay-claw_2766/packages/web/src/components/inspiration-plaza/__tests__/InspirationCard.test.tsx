/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspirationCard } from '../components/InspirationCard';
import type { InspirationTemplateListItem } from '../types';

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSetPendingChatInsert = vi.hoisted(() => vi.fn());
const mockApiFetch = vi.hoisted(() => vi.fn());
const mockFetchSkillOptionsWithCache = vi.hoisted(() => vi.fn());
interface MockAgentRow {
  id: string;
  displayName: string;
  mentionPatterns: string[];
  color: { primary: string; secondary: string };
  avatar: string;
  roleDescription: string;
  provider: string;
  defaultModel: string;
  source: string;
  roster: null;
}

const mockAgentRows = vi.hoisted(() => ({ value: [] as MockAgentRow[] }));
const mockExpertRows = vi.hoisted(() => ({
  value: [] as Array<{
    expertId: string;
    displayName: string;
    avatar: string;
    mentionPatterns: string[];
    roleDescription: string;
    category: string;
  }>,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(() => mockNavigate),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn((selector) => selector({ setPendingChatInsert: mockSetPendingChatInsert })),
}));

vi.mock('@/hooks/useAgentData', () => ({
  useAgentData: vi.fn(() => ({
    agents: mockAgentRows.value,
    getAgentById: vi.fn((id: string) => mockAgentRows.value.find((agent) => agent.id === id) ?? null),
  })),
}));

vi.mock('@/hooks/useExpertCatalog', () => ({
  useExpertCatalog: vi.fn(() => ({
    experts: mockExpertRows.value,
    isLoading: false,
    refresh: vi.fn(async () => mockExpertRows.value),
    getExpertById: vi.fn((id: string) => mockExpertRows.value.find((expert) => expert.expertId === id)),
  })),
}));

vi.mock('@/utils/api-client', () => ({
  API_URL: 'http://localhost:3002',
  apiFetch: mockApiFetch,
}));

vi.mock('@/utils/skill-options-cache', () => ({
  fetchSkillOptionsWithCache: mockFetchSkillOptionsWithCache,
}));

const mockTemplate: InspirationTemplateListItem = {
  id: 'tpl-001',
  name: '测试模板',
  imagePath: '/images/test.png',
  description: '这是一个测试用的模板描述',
  isFeatured: false,
  skills: [{ id: 'skill-1', name: '测试技能' }],
  agents: [{ id: 'agent-1', name: '测试智能体', catId: 'office' }],
  tags: ['消息推送', '定时任务'],
};

const defaultThumbnailPath = '/images/inspiration-products/default.svg';

describe('InspirationCard', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onClick = vi.fn();

  beforeEach(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onClick.mockClear();
    mockNavigate.mockClear();
    mockSetPendingChatInsert.mockClear();
    mockFetchSkillOptionsWithCache.mockReset();
    mockFetchSkillOptionsWithCache.mockResolvedValue([]);
    mockAgentRows.value = [];
    mockExpertRows.value = [];
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ threads: [] }),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('renders template name, description, and tags in the card info area', async () => {
    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: mockTemplate, onClick }));
    });

    expect(container.textContent).toContain('测试模板');
    expect(container.textContent).toContain('这是一个测试用的模板描述');
    expect(container.textContent).toContain('消息推送');
    expect(container.textContent).toContain('定时任务');
    expect(container.textContent).not.toContain('这是一个测试模板的标题');
  });

  it('calls onClick when card is clicked', async () => {
    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: mockTemplate, onClick }));
    });

    const card = container.querySelector('.cursor-pointer');
    act(() => {
      card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClick).toHaveBeenCalledWith(mockTemplate);
  });

  it('uses the refactored card structure and spacing tokens', async () => {
    const imageTemplate: InspirationTemplateListItem = {
      ...mockTemplate,
      isFeatured: true,
      tags: ['精选', '图片'],
    };

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: imageTemplate, onClick }));
    });

    const card = container.querySelector('[data-testid="inspiration-card"]');
    expect(card?.className).toContain('w-full');
    expect(card?.className).toContain('max-w-[490px]');
    expect(card?.className).toContain('rounded-2xl');
    expect(card?.className).toContain('border-[#E6E6E6]');
    expect(card?.className).toContain('hover:shadow-');
    expect(card?.className).not.toContain('ui-card');
    expect(card?.className).not.toContain('translate');
    expect(card?.className).not.toContain('p-');

    const preview = container.querySelector('[data-testid="inspiration-card-preview"]');
    expect(preview?.className).toBe('h-[168px] overflow-hidden bg-[var(--surface-muted)]');
    expect(preview?.className).toContain('h-[168px]');
    expect(preview?.className).not.toContain('bg-cover');
    expect(preview?.className).not.toContain('bg-center');
    const previewImage = preview?.querySelector('img');
    expect(previewImage?.getAttribute('src')).toBe(imageTemplate.imagePath);
    expect(previewImage?.className).toContain('w-full');

    const content = container.querySelector('[data-testid="inspiration-card-content"]');
    expect(content?.className).toContain('p-4');
    expect(content?.className).not.toContain('gap-4');

    const title = container.querySelector('[data-testid="inspiration-card-title"]');
    expect(title?.className).toContain('mb-1');

    const description = container.querySelector('[data-testid="inspiration-card-description"]');
    expect(description?.className).toContain('mb-3');
    expect(description?.className).toContain('line-clamp-2');

    expect(container.querySelector('[data-testid="inspiration-card-text-preview"]')).toBeNull();
  });

  it('renders document product thumbnails with the blue product layout assets', async () => {
    const wordTemplate: InspirationTemplateListItem = {
      ...mockTemplate,
      imagePath: defaultThumbnailPath,
      tags: ['文档', '文档处理'],
    };

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: wordTemplate, onClick }));
    });

    const preview = container.querySelector('[data-testid="inspiration-card-preview"]') as HTMLElement | null;
    expect(preview?.className).toContain('h-[168px]');
    expect(preview?.style.backgroundImage).toContain('/images/inspiration/blue-bg.png');
    expect(preview?.textContent).toContain(wordTemplate.name);
    expect(preview?.textContent).toContain(wordTemplate.description);

    const layout = container.querySelector('[data-testid="inspiration-card-product-layout"]');
    expect(layout?.className).toContain('p-4');

    const icon = container.querySelector('[data-testid="inspiration-card-product-icon"]');
    expect(icon?.getAttribute('src')).toBe('/icons/inspiration/icon-word.svg');
    expect(icon?.className).toContain('h-4');
    expect(icon?.className).toContain('w-4');

    const title = container.querySelector('[data-testid="inspiration-card-product-title"]');
    expect(title?.className).toContain('truncate');
    expect(title?.className).toContain('text-[13px]');

    const description = container.querySelector('[data-testid="inspiration-card-product-description"]');
    expect(description?.className).toContain('line-clamp-2');
    expect(description?.className).toContain('text-[11px]');

    const tagRow = container.querySelector('[data-testid="inspiration-card-preview-tags"]');
    expect(tagRow?.className).toContain('scale-[0.7]');
    expect(tagRow?.className).toContain('flex-nowrap');
    expect(tagRow?.className).toContain('overflow-hidden');
    expect(container.querySelector('[data-testid="inspiration-card-preview-tag"]')?.className).toContain('text-[11px]');

    const example = container.querySelector('[data-testid="inspiration-card-product-example"]');
    expect(example?.getAttribute('src')).toBe('/images/inspiration/doc-example.png');
    expect(example?.className).toContain('h-[136px]');
    expect(example?.className).toContain('w-[138px]');
  });

  it('uses a returned thumbnail image even when the template has product type tags', async () => {
    const wordTemplateWithThumbnail: InspirationTemplateListItem = {
      ...mockTemplate,
      imagePath: '/api/inspiration/thumbnails/custom-word.png',
      tags: ['文档', '文档处理'],
    };

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: wordTemplateWithThumbnail, onClick }));
    });

    const preview = container.querySelector('[data-testid="inspiration-card-preview"]');
    expect(preview?.className).toBe('h-[168px] overflow-hidden bg-[var(--surface-muted)]');
    expect(container.querySelector('[data-testid="inspiration-card-product-layout"]')).toBeNull();

    const previewImage = preview?.querySelector('img');
    expect(previewImage?.getAttribute('src')).toBe('/api/inspiration/thumbnails/custom-word.png');
    expect(previewImage?.className).toContain('object-cover');
  });

  it.each([
    {
      tags: ['表格', '数据分析'],
      background: '/images/inspiration/green-bg.png',
      icon: '/icons/inspiration/icon-excel.svg',
      example: '/images/inspiration/excel-example.png',
    },
    {
      tags: ['Markdown', '金融服务'],
      background: '/images/inspiration/purple-bg.png',
      icon: '/icons/inspiration/icon-markdown.svg',
      example: '/images/inspiration/markdown-example.png',
    },
  ])('renders $tags product thumbnails with their configured assets', async ({ tags, background, icon, example }) => {
    const productTemplate: InspirationTemplateListItem = {
      ...mockTemplate,
      imagePath: defaultThumbnailPath,
      tags,
    };

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: productTemplate, onClick }));
    });

    const preview = container.querySelector('[data-testid="inspiration-card-preview"]') as HTMLElement | null;
    expect(preview?.style.backgroundImage).toContain(background);
    expect(container.querySelector('[data-testid="inspiration-card-product-icon"]')?.getAttribute('src')).toBe(icon);
    expect(container.querySelector('[data-testid="inspiration-card-product-example"]')?.getAttribute('src')).toBe(
      example,
    );
  });

  it('renders scheduled templates as orange message-push thumbnails before markdown styling', async () => {
    const scheduledTemplate: InspirationTemplateListItem = {
      ...mockTemplate,
      imagePath: defaultThumbnailPath,
      tags: ['消息推送', '定时任务'],
    };

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: scheduledTemplate, onClick }));
    });

    const preview = container.querySelector('[data-testid="inspiration-card-preview"]') as HTMLElement | null;
    expect(preview?.className).toContain('h-[168px]');
    expect(preview?.style.backgroundImage).toContain('/images/inspiration/orange-bg.png');

    expect(container.querySelector('[data-testid="inspiration-card-product-icon"]')).toBeNull();

    const example = container.querySelector('[data-testid="inspiration-card-product-example"]');
    expect(example?.getAttribute('src')).toBe('/images/inspiration/task-bg.png');
  });

  it('renders template tags with the shared compact tag style', async () => {
    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: mockTemplate, onClick }));
    });

    const tag = container.querySelector('[data-testid="inspiration-card-tag"]');
    expect(tag?.textContent).toContain('消息推送');
    expect(tag?.className).toContain('rounded-[2px]');
    expect(tag?.className).toContain('px-1');
    expect(tag?.className).not.toContain('font-medium');
    expect(tag?.className).not.toContain('font-semibold');
    expect(tag?.className).not.toContain('font-bold');
  });

  it('renders legacy lowercase html product tags as uppercase HTML', async () => {
    const htmlTemplate: InspirationTemplateListItem = {
      ...mockTemplate,
      tags: ['html', '数据可视化'],
    };

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: htmlTemplate, onClick }));
    });

    const tag = container.querySelector('[data-testid="inspiration-card-tag"]');
    expect(tag?.textContent).toBe('HTML');
    expect(tag?.getAttribute('title')).toBe('HTML');
    expect(tag?.className).toContain('text-[#F23030]');
  });

  it('renders template tags in requested order with label-specific colors', async () => {
    const featuredTemplate: InspirationTemplateListItem = {
      ...mockTemplate,
      isFeatured: true,
      tags: ['精选', '消息推送', '定时任务'],
    };

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: featuredTemplate, onClick }));
    });

    const tagRow = container.querySelector('.tag-row');
    const labels = Array.from(tagRow?.querySelectorAll('span[title]') ?? []).map((tag) => tag.getAttribute('title'));
    expect(labels).toEqual(['精选', '消息推送', '定时任务']);

    expect(container.querySelector('[data-testid="inspiration-card-tag"]')?.className).toContain('text-[#C25700]');
    expect(container.querySelector('[data-testid="inspiration-tag-messagePush"]')?.className).toContain(
      'text-[#832FD6]',
    );
    expect(container.querySelector('[data-testid="inspiration-tag-category"]')?.className).toContain('text-[#191919]');
  });

  it('uses a componentized 14px create-same text button on hover', async () => {
    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: mockTemplate, onClick }));
    });

    const createSameButton = container.querySelector('[data-testid="inspiration-create-same-button"]');
    expect(createSameButton?.textContent).toContain('创建同款');
    expect(createSameButton?.className).toContain('text-sm');
    expect(createSameButton?.className).toContain('text-[#1476FF]');
  });

  it('opens create-same dialog without entering detail when create-same is clicked', async () => {
    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: mockTemplate, onClick }));
    });

    const createSameButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('创建同款'),
    );

    await act(async () => {
      createSameButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onClick).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('选择会话');
  });

  it('fetches detail data before creating the same flow from a list item', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (String(url).includes('/api/inspiration/templates/tpl-001')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            code: 0,
            message: 'success',
            data: {
              ...mockTemplate,
              prompt: '这是一条测试提示词',
              productPath: null,
              product: null,
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ threads: [] }),
      });
    });

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: mockTemplate, onClick }));
    });

    const createSameButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('创建同款'),
    );

    await act(async () => {
      createSameButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === '新建会话')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/inspiration/templates/tpl-001');
    expect(mockSetPendingChatInsert).toHaveBeenCalledWith({
      threadId: '__new__',
      text: '[[quick_action:定时任务]]\n这是一条测试提示词',
      inspirationData: {
        prompt: '这是一条测试提示词',
        skills: mockTemplate.skills,
        agents: mockTemplate.agents,
        templateId: 'tpl-001',
      },
    });
  });

  it('adds matching skill tokens and agent mentions when creating same from a list card', async () => {
    mockFetchSkillOptionsWithCache.mockResolvedValue([{ name: 'lidan-writing-framework' }]);
    mockAgentRows.value = [
      {
        id: 'office',
        displayName: '通用助手',
        mentionPatterns: ['@office'],
        color: { primary: '#1476ff', secondary: '#eff6ff' },
        avatar: '',
        roleDescription: '通用助手',
        provider: 'openai',
        defaultModel: '',
        source: 'seed',
        roster: null,
      },
    ];
    const detailSkills = [
      { id: 'lidan-writing-framework', name: '李诞七步写作框架' },
      { id: 'future-skill', name: '待预置技能' },
    ];
    const detailAgents = [
      { id: 'office', name: '通用助手', catId: 'office' },
      { id: 'future-agent', name: '待预置智能体', catId: 'future-agent' },
    ];

    mockApiFetch.mockImplementation((url: string) => {
      if (String(url).includes('/api/inspiration/templates/tpl-001')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            code: 0,
            message: 'success',
            data: {
              ...mockTemplate,
              prompt: '这是一条测试提示词',
              skills: detailSkills,
              agents: detailAgents,
              productPath: null,
              product: null,
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ threads: [] }),
      });
    });

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: mockTemplate, onClick }));
    });

    const createSameButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('创建同款'),
    );
    await act(async () => {
      createSameButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === '新建会话')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSetPendingChatInsert).toHaveBeenCalledWith({
      threadId: '__new__',
      text: '[[quick_action:定时任务]] @office [[skill:lidan-writing-framework]]\n这是一条测试提示词',
      suppressMentionMenu: true,
      mentionRefs: [{ catId: 'office', mention: '@office' }],
      inspirationData: {
        prompt: '这是一条测试提示词',
        skills: detailSkills,
        agents: detailAgents,
        templateId: 'tpl-001',
      },
    });
  });

  it('summons plaza experts into an existing session before filling an inspiration prompt', async () => {
    const expertTemplate: InspirationTemplateListItem = {
      ...mockTemplate,
      id: 'tpl-expert-003',
      name: '专家协同评审',
      agents: [
        { id: 'expert-product', name: '产品专家', catId: 'expert-product' },
        { id: 'expert-architecture', name: '架构专家', catId: 'expert-architecture' },
        { id: 'expert-development', name: '开发工程师', catId: 'expert-development' },
      ],
      tags: ['Markdown', '专家团思辨'],
    };
    mockExpertRows.value = [
      {
        expertId: 'expert-product',
        displayName: '产品专家',
        avatar: '/avatars/assistant.svg',
        mentionPatterns: ['@产品专家'],
        roleDescription: '产品评审',
        category: 'product',
      },
      {
        expertId: 'expert-architecture',
        displayName: '架构专家',
        avatar: '/avatars/assistant.svg',
        mentionPatterns: ['@架构专家'],
        roleDescription: '架构设计',
        category: 'product',
      },
      {
        expertId: 'expert-development',
        displayName: '开发工程师',
        avatar: '/avatars/assistant.svg',
        mentionPatterns: ['@开发工程师'],
        roleDescription: '开发落地',
        category: 'product',
      },
    ];
    mockApiFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === '/api/threads') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            threads: [
              {
                id: 'thread-1',
                title: '需求讨论',
                lastActiveAt: Date.now(),
                participants: [],
              },
            ],
          }),
        });
      }
      if (String(url).includes('/api/inspiration/templates/tpl-expert-003')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            code: 0,
            message: 'success',
            data: {
              ...expertTemplate,
              prompt: '请一起评审购物车凑单推荐模块',
              skills: [],
              agents: expertTemplate.agents,
              productPath: null,
              product: null,
            },
          }),
        });
      }
      if (
        String(url) === '/api/threads/thread-1/experts/expert-product/invite' ||
        String(url) === '/api/threads/thread-1/experts/expert-architecture/invite' ||
        String(url) === '/api/threads/thread-1/experts/expert-development/invite'
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true }),
      });
    });

    await act(async () => {
      root.render(React.createElement(InspirationCard, { template: expertTemplate, onClick }));
    });

    const createSameButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('创建同款'),
    );
    await act(async () => {
      createSameButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const newSessionButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '新建会话',
    ) as HTMLButtonElement | undefined;
    expect(newSessionButton?.disabled).toBe(true);
    expect(document.body.textContent).not.toContain('需要先选择已有会话');

    await act(async () => {
      document.body.querySelector('[data-testid="session-option-thread-1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === '确定')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const inviteCalls = mockApiFetch.mock.calls.filter(([url, init]) =>
      String(url).includes('/api/threads/thread-1/experts/') && init?.method === 'POST',
    );
    expect(inviteCalls.map(([url]) => String(url))).toEqual([
      '/api/threads/thread-1/experts/expert-product/invite',
      '/api/threads/thread-1/experts/expert-architecture/invite',
      '/api/threads/thread-1/experts/expert-development/invite',
    ]);
    expect(mockSetPendingChatInsert).toHaveBeenCalledWith({
      threadId: 'thread-1',
      text: '[[quick_action:专家团思辨]] @产品专家 @架构专家 @开发工程师\n请一起评审购物车凑单推荐模块',
      suppressMentionMenu: true,
      mentionRefs: [
        { catId: 'expert-product', mention: '@产品专家' },
        { catId: 'expert-architecture', mention: '@架构专家' },
        { catId: 'expert-development', mention: '@开发工程师' },
      ],
      inspirationData: {
        prompt: '请一起评审购物车凑单推荐模块',
        skills: [],
        agents: expertTemplate.agents,
        templateId: 'tpl-expert-003',
      },
    });
    expect(mockNavigate).toHaveBeenCalledWith('/thread/thread-1');
  });
});
