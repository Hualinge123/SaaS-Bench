/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RichTextarea } from '@/components/chat-input/components/RichTextarea';

beforeAll(() => {
  (globalThis as { React?: typeof React }).React = React;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { React?: typeof React }).React;
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderRichTextarea(onValueChange: (next: string) => void) {
  function TestHarness() {
    const [value, setValue] = useState('');

    return (
      <RichTextarea
        value={value}
        placeholder="paste"
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
      />
    );
  }

  act(() => {
    root.render(<TestHarness />);
  });

  return container.querySelector('[role="textbox"]') as HTMLDivElement;
}

function setCaretToEnd(element: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('RichTextarea paste formatting', () => {
  it('preserves newlines and indentation when pasting plain text', () => {
    const onValueChange = vi.fn();
    const textbox = renderRichTextarea(onValueChange);
    const pasted = '    def hello():\r\n        print("hi")\r\n';

    act(() => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => (type === 'text/plain' ? pasted : ''),
        },
      });
      textbox.dispatchEvent(event);
    });

    expect(onValueChange).toHaveBeenCalled();
    expect(onValueChange.mock.calls.at(-1)?.[0]).toBe('    def hello():\n        print("hi")\n');
    expect(container.textContent).toContain('    def hello():');
    expect(container.textContent).toContain('        print("hi")');
  });

  it('shows the placeholder when pasted content is deleted to a browser empty sentinel', () => {
    const onValueChange = vi.fn();
    const textbox = renderRichTextarea(onValueChange);

    act(() => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => (type === 'text/plain' ? 'hello' : ''),
        },
      });
      textbox.dispatchEvent(event);
    });

    act(() => {
      textbox.replaceChildren(document.createTextNode('\u00A0'));
      textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    });

    expect(onValueChange.mock.calls.at(-1)?.[0]).toBe('');
    expect(container.textContent).toContain('paste');
  });

  it('shows the placeholder when only zero-width format characters remain after deleting pasted text', () => {
    const onValueChange = vi.fn();
    const textbox = renderRichTextarea(onValueChange);

    act(() => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => (type === 'text/plain' ? 'hello\u200D' : ''),
        },
      });
      textbox.dispatchEvent(event);
    });

    act(() => {
      textbox.replaceChildren(document.createTextNode('\u200D'));
      textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    });

    expect(onValueChange.mock.calls.at(-1)?.[0]).toBe('');
    expect(container.textContent).toContain('paste');
  });

  it('fast-clears browser-empty content after selecting and deleting a large paste', async () => {
    const onValueChange = vi.fn();
    const textbox = renderRichTextarea(onValueChange);
    const pasted = 'large line\n'.repeat(1000);

    act(() => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => (type === 'text/plain' ? pasted : ''),
        },
      });
      textbox.dispatchEvent(event);
    });

    act(() => {
      textbox.replaceChildren();
      textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    });

    expect(onValueChange.mock.calls.at(-1)?.[0]).toBe('');
    expect(container.textContent).toContain('paste');

    Object.defineProperty(textbox, 'scrollHeight', { configurable: true, value: 2400 });
    act(() => {
      textbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(textbox.textContent).toBe(pasted);
    const selection = window.getSelection();
    expect(selection?.isCollapsed).toBe(true);
    expect(selection?.focusOffset).toBe(pasted.length);
    expect(textbox.scrollTop).toBe(2400);
  });

  it('keeps single-character backspace fast on large plain text', () => {
    const onValueChange = vi.fn();
    const textbox = renderRichTextarea(onValueChange);
    const pasted = 'large line\n'.repeat(1000);
    const next = pasted.slice(0, -1);

    act(() => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => (type === 'text/plain' ? pasted : ''),
        },
      });
      textbox.dispatchEvent(event);
    });

    act(() => {
      setCaretToEnd(textbox);
      textbox.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
      textbox.textContent = next;
      setCaretToEnd(textbox);
      textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    });

    expect(onValueChange.mock.calls.at(-1)?.[0]).toBe(next);
  });
});
