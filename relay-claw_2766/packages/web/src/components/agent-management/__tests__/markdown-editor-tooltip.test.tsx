import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '@/components/agent-management/components/MarkdownEditor';
import type { InspirationTemplate } from '@/components/agent-management/types';

const templates: InspirationTemplate[] = [
  {
    id: 'template-1',
    title: '模板一',
    description: '用于测试 hover 预览',
    content: '### 行为\n- 预览内容',
  },
];

describe('MarkdownEditor template tooltip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('shows template preview tooltip on hover with arrow aligned to card center', async () => {
    const editorSurfaceRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    const editorTextareaRef = { current: null } as React.RefObject<HTMLTextAreaElement | null>;

    await act(async () => {
      root.render(
        <MarkdownEditor
          activeTab="persona"
          activeWorkingDraft=""
          editorSurfaceRef={editorSurfaceRef}
          editorTextareaRef={editorTextareaRef}
          isPersonaEmpty
          onApplyTemplate={vi.fn()}
          onAfterApplyTemplate={vi.fn()}
          onDraftChange={vi.fn()}
          onNextTemplatePage={vi.fn()}
          onPrevTemplatePage={vi.fn()}
          templatePage={0}
          templatePageCount={1}
          visibleTemplates={templates}
          appliedTemplateKey={0}
        />,
      );
    });

    const card = container.querySelector('button[data-template-card="1"]') as HTMLButtonElement | null;
    expect(card).not.toBeNull();

    await act(async () => {
      card?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    const tooltip = container.querySelector('[data-template-preview-tooltip="1"]') as HTMLDivElement | null;
    expect(tooltip).not.toBeNull();
    expect(Number.parseFloat(tooltip?.style.top ?? '0')).toBeLessThan(0);
    expect(container.querySelector('[data-template-preview-tooltip-arrow="1"]')).not.toBeNull();
  });
});
