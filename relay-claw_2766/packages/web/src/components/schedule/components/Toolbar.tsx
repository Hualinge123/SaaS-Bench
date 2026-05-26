﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿'use client';

import { useEffect, useRef, useState } from 'react';
import { MaskIcon } from '@/components/shared/MaskIcon';

type ViewMode = 'card' | 'calendar';

type ToolbarProps = {
  viewMode: ViewMode;
  weekRangeText: string;
  onChangeView: (next: ViewMode) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onResetWeek: () => void;
  onCreateFromConversation: () => void;
  onCreateFromTemplate: () => void;
  onCreateCustom: () => void;
};

export function Toolbar({
  viewMode,
  weekRangeText,
  onChangeView,
  onPrevWeek,
  onNextWeek,
  onResetWeek,
  onCreateFromConversation,
  onCreateFromTemplate,
  onCreateCustom,
}: ToolbarProps) {
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isCreateMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (createMenuRef.current?.contains(event.target as Node)) return;
      setIsCreateMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isCreateMenuOpen]);

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <ViewToggle viewMode={viewMode} onChangeView={onChangeView} />
        {viewMode === 'calendar' ? (
          <WeekRangeSwitcher
            weekRangeText={weekRangeText}
            onPrevWeek={onPrevWeek}
            onNextWeek={onNextWeek}
            onResetWeek={onResetWeek}
          />
        ) : null}
      </div>
      <div ref={createMenuRef} className="relative">
        <button
          type="button"
          onClick={() => setIsCreateMenuOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={isCreateMenuOpen}
          data-testid="scheduled-task-toolbar-create"
          className="inline-flex h-[32px] min-h-[32px] min-w-[112px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap break-keep rounded-full border border-[var(--schedule-toolbar-border)] bg-[var(--schedule-toolbar-bg)] px-4 text-[12px] font-medium leading-none text-[var(--schedule-toolbar-text)]"
        >
          <span>创建定时任务</span>
          <svg
            className={`h-3.5 w-3.5 transition-transform ${isCreateMenuOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {isCreateMenuOpen ? (
          <div className={`absolute right-0 top-full z-20 mt-2 w-[160px] rounded-[12px] border border-[var(--schedule-menu-border)] bg-[var(--schedule-menu-bg)] p-2 shadow-[var(--schedule-dropdown-shadow)]`}>
            <button
              type="button"
              onClick={() => {
                setIsCreateMenuOpen(false);
                onCreateFromConversation();
              }}
              data-testid="scheduled-task-toolbar-create-conversation"
              className={`flex h-8 w-full items-center rounded-[8px] px-3 text-left text-[12px] font-medium text-[var(--schedule-menu-item-text)] transition-colors hover:bg-[var(--schedule-menu-item-hover-bg)]`}>
              从对话创建
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreateMenuOpen(false);
                onCreateFromTemplate();
              }}
              data-testid="scheduled-task-toolbar-create-template"
              className={`flex h-8 w-full items-center rounded-[8px] px-3 text-left text-[12px] font-medium text-[var(--schedule-menu-item-text)] transition-colors hover:bg-[var(--schedule-menu-item-hover-bg)]`}
            >
              从模板创建
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreateMenuOpen(false);
                onCreateCustom();
              }}
              data-testid="scheduled-task-toolbar-create-custom"
              className={`flex h-8 w-full items-center rounded-[8px] px-3 text-left text-[12px] font-medium text-[var(--schedule-menu-item-text)] transition-colors hover:bg-[var(--schedule-menu-item-hover-bg)]`}
            >
              自定义创建
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type ViewToggleProps = {
  viewMode: ViewMode;
  onChangeView: (next: ViewMode) => void;
};

function ViewToggle({ viewMode, onChangeView }: ViewToggleProps) {
  const base = 'inline-flex h-full min-w-[96px] items-center justify-center whitespace-nowrap px-[18px] text-[12px] leading-none';
  return (
    <div className={`inline-flex h-7 items-center rounded-[6px] border border-[var(--schedule-view-toggle-border)] bg-[var(--schedule-view-toggle-bg)]`}>
      <button
        type="button"
        onClick={() => onChangeView('calendar')}
        className={`${base} rounded-[6px] ${
          viewMode === 'calendar'
            ? `border border-[var(--schedule-view-toggle-border)] bg-[var(--schedule-active-view-button-bg)] font-semibold text-[var(--schedule-active-view-button-text)]`
            : `font-medium text-[var(--schedule-inactive-view-button-text)]`
        }`}
      >
        日历视图
      </button>
      <button
        type="button"
        onClick={() => onChangeView('card')}
        className={`${base} rounded-[6px] ${
          viewMode === 'card' ? `border border-[var(--schedule-view-toggle-border)] bg-[var(--schedule-active-view-button-bg)] font-semibold text-[var(--schedule-active-view-button-text)]` : `font-medium text-[var(--schedule-inactive-view-button-text)]`
        }`}
      >
        卡片视图
      </button>
    </div>
  );
}

type WeekRangeSwitcherProps = {
  weekRangeText: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onResetWeek: () => void;
};

function WeekRangeSwitcher({ weekRangeText, onPrevWeek, onNextWeek, onResetWeek }: WeekRangeSwitcherProps) {
  return (
    <div className="flex items-center gap-2">
      <div className={`inline-flex h-7 items-center gap-[31.5px] rounded-[6px] border border-[var(--schedule-week-switcher-border)] px-2`}>
        <button type="button" onClick={onPrevWeek} className={`inline-flex h-5 w-5 items-center justify-center text-[var(--schedule-week-switcher-icon)]`}>
          <MaskIcon name="chevronLeft" className="h-3.5 w-3.5" />
        </button>
        <span className="text-[12px] font-normal text-[var(--schedule-week-switcher-text)]">{weekRangeText}</span>
        <button type="button" onClick={onNextWeek} className={`inline-flex h-5 w-5 items-center justify-center text-[var(--schedule-week-switcher-icon)]`}>
          <MaskIcon name="chevronRight" className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={onResetWeek}
        className={`inline-flex h-7 min-h-[28px] min-w-[84px] shrink-0 items-center justify-center whitespace-nowrap break-keep rounded-[6px] border border-[var(--schedule-reset-button-border)] px-10 text-[12px] text-[var(--schedule-reset-button-text)] font-normal leading-none`}
      >
        回到本周
      </button>
    </div>
  );
}