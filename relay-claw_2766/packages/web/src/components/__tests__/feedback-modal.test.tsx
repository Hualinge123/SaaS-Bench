/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import FeedbackModal from '../FeedbackModal';

describe('FeedbackModal', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onClose = vi.fn<() => void>();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function renderOpen() {
    act(() => {
      root.render(React.createElement(FeedbackModal, { open: true, onClose }));
    });
    await flush();
  }

  async function changeInput(input: HTMLInputElement, value: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('limits the required feedback title to 64 characters without showing a counter', async () => {
    await renderOpen();

    const titleInput = document.body.querySelector('[data-testid="feedback-title"]') as HTMLInputElement | null;
    expect(titleInput).toBeTruthy();
    expect(titleInput?.maxLength).toBe(64);

    await changeInput(titleInput!, 'x'.repeat(120));

    expect(titleInput?.value).toHaveLength(64);
    expect(document.body.textContent).not.toContain('64/64');
  });

  it('shows app logs first and requires title plus agreement before submit', async () => {
    await renderOpen();

    const titleInput = document.body.querySelector('[data-testid="feedback-title"]') as HTMLInputElement | null;
    const auxiliaryOptions = document.body.querySelector('[data-testid="feedback-auxiliary-options"]');
    const agreementOptions = document.body.querySelector('[data-testid="feedback-agreement-options"]');
    expect(auxiliaryOptions?.className).toContain('flex-col');

    const auxiliaryCheckboxes = Array.from(auxiliaryOptions?.querySelectorAll('input[type="checkbox"]') ?? []) as HTMLInputElement[];
    expect(auxiliaryCheckboxes).toHaveLength(1);
    expect(auxiliaryCheckboxes[0]?.dataset.testid).toBe('feedback-attach-logs');
    expect(document.body.querySelector('[data-testid="feedback-attach-logs"]')).toBeTruthy();
    expect(agreementOptions).toBeTruthy();

    const serviceAgreementLink = agreementOptions?.querySelector('a[href*="developer_service_agreement"]') as HTMLAnchorElement | null;
    const privacyLink = agreementOptions?.querySelector('a[href*="sa_devprp"]') as HTMLAnchorElement | null;
    expect(serviceAgreementLink?.target).toBe('_blank');
    expect(privacyLink?.target).toBe('_blank');

    const submitButton = document.body.querySelector('[data-testid="feedback-submit"]') as HTMLButtonElement | null;
    expect(submitButton?.disabled).toBe(true);

    act(() => {
      submitButton?.click();
    });
    expect(onClose).not.toHaveBeenCalled();

    const agreementCheckbox = agreementOptions?.querySelector('[data-testid="feedback-agreement"]') as HTMLInputElement | null;
    await act(async () => {
      agreementCheckbox?.click();
    });

    expect(submitButton?.disabled).toBe(true);

    await changeInput(titleInput!, 'feedback title');

    expect(submitButton?.disabled).toBe(false);

    act(() => {
      submitButton?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides auxiliary info for suggestions but keeps the agreement visible', async () => {
    await renderOpen();

    const description = document.body.querySelector('[data-testid="feedback-description"]') as HTMLTextAreaElement | null;
    expect(description?.placeholder).toBe('问题描述：\n复现步骤：\n预期结果：');

    const suggestionButton = document.body.querySelector('[data-testid="feedback-type-suggestion"]') as HTMLButtonElement | null;
    expect(suggestionButton).toBeTruthy();

    await act(async () => {
      suggestionButton?.click();
    });

    expect(document.body.querySelector('[data-testid="feedback-auxiliary-options"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="feedback-attach-logs"]')).toBeNull();
    expect(description?.placeholder).toBe('请输入您的宝贵建议');
    expect(document.body.querySelector('[data-testid="feedback-contact"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="feedback-agreement-options"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="feedback-agreement"]')).toBeTruthy();
  });
});
