'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type DesktopCloseAction = 'ask' | 'minimize' | 'exit';

type DesktopCloseActionStateMessage = {
  type?: string;
  value: DesktopCloseAction;
};

type WebViewMessageEvent = {
  data?: unknown;
};

type WebViewBridge = {
  postMessage(message: string): void;
  addEventListener?(eventName: 'message', listener: (event: WebViewMessageEvent) => void): void;
  removeEventListener?(eventName: 'message', listener: (event: WebViewMessageEvent) => void): void;
};

declare global {
  interface Window {
    chrome?: {
      webview?: WebViewBridge;
    };
  }
}

const CLOSE_ACTION_SYNC_MESSAGE = 'desktop.closeAction.sync';
const CLOSE_ACTION_SET_MESSAGE = 'desktop.closeAction.set';
const CLOSE_ACTION_STATE_MESSAGE = 'desktop.closeAction.state';

function getWebViewBridge(): WebViewBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.chrome?.webview ?? null;
}

function isCloseAction(value: unknown): value is DesktopCloseAction {
  return value === 'ask' || value === 'minimize' || value === 'exit';
}

function isCloseActionStateMessage(value: unknown): value is DesktopCloseActionStateMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as DesktopCloseActionStateMessage;
  return message.type === CLOSE_ACTION_STATE_MESSAGE && isCloseAction(message.value);
}

export function useDesktopCloseActionSetting(enabled: boolean) {
  const [closeAction, setCloseActionState] = useState<DesktopCloseAction>('ask');
  const isDesktopHost = useMemo(() => getWebViewBridge() !== null, []);

  useEffect(() => {
    if (!enabled || !isDesktopHost) {
      return;
    }

    const webview = getWebViewBridge();
    if (!webview) {
      return;
    }

    const handleMessage = (event: WebViewMessageEvent) => {
      if (!isCloseActionStateMessage(event.data)) {
        return;
      }

      setCloseActionState(event.data.value);
    };

    webview.addEventListener?.('message', handleMessage);
    webview.postMessage(JSON.stringify({ type: CLOSE_ACTION_SYNC_MESSAGE }));

    return () => {
      webview.removeEventListener?.('message', handleMessage);
    };
  }, [enabled, isDesktopHost]);

  const setCloseAction = useCallback(
    (value: DesktopCloseAction) => {
      setCloseActionState(value);
      getWebViewBridge()?.postMessage(JSON.stringify({ type: CLOSE_ACTION_SET_MESSAGE, value }));
    },
    [],
  );

  return {
    closeAction,
    isDesktopHost,
    setCloseAction,
  };
}
