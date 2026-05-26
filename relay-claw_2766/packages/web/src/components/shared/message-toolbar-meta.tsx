/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import type { CSSProperties } from 'react';
import { formatUserMessageSentTime } from '@/components/chat-message/utils/message-time';

export const MESSAGE_TOOLBAR_META_COLOR = '#808080';
export const MESSAGE_TOOLBAR_ICON_HOVER_COLOR = '#000000';

const MASK_ICON_STYLE_BASE: CSSProperties = {
  maskSize: 'contain',
  maskRepeat: 'no-repeat',
  maskPosition: 'center',
  WebkitMaskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
};

/** Parent button needs `group/toolbar-btn`; optional `--message-toolbar-icon-color` on button. */
export function MessageToolbarMaskIcon({ iconUrl, className = 'h-4 w-4' }: { iconUrl: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`message-toolbar-mask-icon shrink-0 ${className}`}
      style={{
        ...MASK_ICON_STYLE_BASE,
        maskImage: `url(${iconUrl})`,
        WebkitMaskImage: `url(${iconUrl})`,
      }}
    />
  );
}

/** Match MessageCopyButton hover-reveal (last message in thread stays visible). */
export function messageMetaHoverRevealClass(alwaysVisible: boolean): string {
  return alwaysVisible
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto';
}

export function maskedToolbarIconStyle(iconUrl: string, color: string): CSSProperties {
  return {
    ...MASK_ICON_STYLE_BASE,
    backgroundColor: color,
    maskImage: `url(${iconUrl})`,
    WebkitMaskImage: `url(${iconUrl})`,
  };
}

type MessageSentTimeProps = {
  timestamp: number;
  alwaysVisible: boolean;
  offsetAfterCopy: boolean;
  testId: string;
};

export function MessageSentTime({ timestamp, alwaysVisible, offsetAfterCopy, testId }: MessageSentTimeProps) {
  return (
    <time
      dateTime={new Date(timestamp).toISOString()}
      className={`text-xs leading-none shrink-0 transition-opacity ${messageMetaHoverRevealClass(alwaysVisible)} ${
        offsetAfterCopy ? 'ml-[4px]' : ''
      }`}
      style={{ color: MESSAGE_TOOLBAR_META_COLOR }}
      data-testid={testId}
    >
      {formatUserMessageSentTime(timestamp)}
    </time>
  );
}
