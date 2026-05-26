/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import UserSettingsModal from '../UserSettingsModal';
import { apiFetch } from '@/utils/api-client';

type WebViewMessageEvent = {
  data?: unknown;
};

const mockApiFetch = vi.mocked(apiFetch);
const postMessage = vi.fn();
let messageListener: ((event: WebViewMessageEvent) => void) | null = null;

vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}));

beforeAll(() => {
  (globalThis as { React?: typeof React }).React = React;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { React?: typeof React }).React;
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe('UserSettingsModal desktop close action setting', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    postMessage.mockReset();
    messageListener = null;
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as Response);
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        webview: {
          postMessage,
          addEventListener: vi.fn((_eventName: 'message', listener: (event: WebViewMessageEvent) => void) => {
            messageListener = listener;
          }),
          removeEventListener: vi.fn(),
        },
      },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: undefined,
    });
  });

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function renderModal() {
    act(() => {
      root.render(
        <UserSettingsModal
          open
          onClose={vi.fn()}
          keepAwakeEnabled={false}
          isKeepAwakeLoading={false}
          isKeepAwakeSaving={false}
          onToggleKeepAwake={vi.fn()}
          theme='business'
          onSelectTheme={vi.fn()}
          onOpenPrivacyDeclaration={vi.fn()}
          versionInfo={null}
        />,
      );
    });
  }

  it('syncs and updates the desktop close action from general settings', async () => {
    renderModal();
    await flush();

    const select = document.body.querySelector(
      '[data-testid="user-settings-desktop-close-action-select"]',
    ) as HTMLSelectElement | null;
    expect(select).toBeTruthy();
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: 'desktop.closeAction.sync' }));

    act(() => {
      messageListener?.({ data: { type: 'desktop.closeAction.state', value: 'exit' } });
    });
    expect(select?.value).toBe('exit');

    act(() => {
      if (select) {
        select.value = 'minimize';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ type: 'desktop.closeAction.set', value: 'minimize' }),
    );
  });
});
