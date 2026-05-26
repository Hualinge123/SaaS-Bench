import type { CSSProperties } from 'react';
import type { InspirationTemplate } from '../types';
import { Button } from '@/components/shared/Button';
import { MarkdownContent } from '@/components/MarkdownContent';

interface TemplateCardTooltipProps {
  template: InspirationTemplate | null;
  style: CSSProperties | null;
  arrowLeft?: number | null;
  onApply: (templateId: string) => void;
  onAfterApply?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const TOOLTIP_WIDTH = 400;

export function TemplateCardTooltip({ template, style, arrowLeft, onApply, onAfterApply, onMouseEnter, onMouseLeave }: TemplateCardTooltipProps) {
  if (!template || !style) return null;

  return (
    <div
      style={{ width: TOOLTIP_WIDTH, ...style, maxHeight: 300, zIndex: 50 }}
      className="absolute rounded-lg border border-[var(--tooltip-border)] bg-[var(--tooltip-surface)] p-4  overflow-tooltip shadow-[var(--tooltip-shadow)]"
      data-template-preview-tooltip="1"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{template.title}</h3>
      <div className="mt-3 max-h-[212px] overflow-y-auto">
        <MarkdownContent
          content={template.content}
          className="text-[12px] leading-[1.55] text-[var(--text-secondary)] [&_h2]:mb-3 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:text-[var(--text-primary)] [&_h3]:mb-2 [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_ul]:mb-3 [&_ul]:space-y-1.5"
          disableCommandPrefix
        />
      </div>
      <div className="flex justify-end">
        <Button
          variant="major"
          onClick={() => {
            onApply(template.id);
            onAfterApply?.();
          }}
        >
          插入模板
        </Button>
      </div>
      <div
        aria-hidden="true"
        data-template-preview-tooltip-arrow="1"
        className="absolute -bottom-[6px] h-3 w-3 rotate-45 border-r border-b border-[var(--tooltip-border)] bg-[var(--tooltip-surface)]"
        style={{ left: (arrowLeft ?? TOOLTIP_WIDTH / 2) - 8 }}
      />
    </div>
  );
}
