/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import type { CSSProperties } from 'react';
import { MessageToolbarMaskIcon } from './message-toolbar-meta';
import { OverflowTooltip } from './OverflowTooltip';

type MessageEditButtonProps = {
  alwaysVisible: boolean;
  onClick: () => void;
  className?: string;
  iconColor?: string;
};

export function MessageEditButton({ alwaysVisible, onClick, className, iconColor }: MessageEditButtonProps) {
  const visibilityClass = alwaysVisible
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto';

  return (
    <div
      data-testid="message-edit-button-wrapper"
      className={`mt-[8px] mb-[8px] ${visibilityClass} transition-opacity ${className ?? ''}`.trim()}
    >
      <OverflowTooltip content="编辑" forceShow className="relative inline-flex" gap={2}>
        <button
          type="button"
          aria-label="编辑"
          onClick={onClick}
          className="group/toolbar-btn inline-flex h-6 w-6 items-center justify-center rounded-[8px] transition-colors hover:bg-[rgba(0,0,0,0.04)] focus-visible:bg-[rgba(0,0,0,0.04)]"
          style={iconColor ? ({ '--message-toolbar-icon-color': iconColor } as CSSProperties) : undefined}
          data-testid="message-edit-button"
        >
          <MessageToolbarMaskIcon iconUrl="/icons/edit.svg" className="h-4 w-4" />
        </button>
      </OverflowTooltip>
    </div>
  );
}
