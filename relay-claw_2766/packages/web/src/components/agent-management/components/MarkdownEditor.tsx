import { useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { InspirationTemplate } from '../types';
import { MaskIcon } from '@/components/shared/MaskIcon';
import { TemplateCardTooltip } from './TemplateCardTooltip';

export interface MarkdownEditorProps {
  activeTab: 'persona' | 'collab';
  activeWorkingDraft: string;
  editorSurfaceRef: React.RefObject<HTMLDivElement | null>;
  editorTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  isPersonaEmpty: boolean;
  onApplyTemplate: (templateId: string) => void;
  onAfterApplyTemplate?: () => void;
  onDraftChange: (value: string) => void;
  onNextTemplatePage: () => void;
  onPrevTemplatePage: () => void;
  templatePage: number;
  templatePageCount: number;
  visibleTemplates: InspirationTemplate[];
  appliedTemplateKey?: number;
}

const TOOLTIP_WIDTH = 400;
const TOOLTIP_HEIGHT = 300;
const GAP = 16;
const ARROW_SAFE_MARGIN = 16;

export function MarkdownEditor({
  activeTab,
  activeWorkingDraft,
  editorSurfaceRef,
  editorTextareaRef,
  isPersonaEmpty,
  onApplyTemplate,
  onAfterApplyTemplate,
  onDraftChange,
  onNextTemplatePage,
  onPrevTemplatePage,
  templatePage,
  templatePageCount,
  visibleTemplates,
  appliedTemplateKey,
}: MarkdownEditorProps) {
  const showTemplates = activeTab === 'persona';
  const templatesContainerRef = useRef<HTMLDivElement>(null);
  const [hoveredTemplate, setHoveredTemplate] = useState<InspirationTemplate | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);
  const [tooltipArrowLeft, setTooltipArrowLeft] = useState<number | null>(null);
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);
  const hideTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div
      data-testid={isPersonaEmpty ? 'agent-tab-empty-editor' : 'agent-tab-editor'}
      className="relative flex min-h-0 flex-1 flex-col p-4 h-full"
    >
      <div ref={editorSurfaceRef as React.RefObject<HTMLDivElement>} className="min-h-0 flex-1">
        <textarea
          ref={editorTextareaRef as React.RefObject<HTMLTextAreaElement>}
          value={activeWorkingDraft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="请输入你的智能体人格、语气、规则描述，或选择下方模板自动生成"
          className="ui-textarea ui-textarea-plain block h-full min-h-0 w-full resize-none overflow-y-auto rounded-none text-[12px] leading-7"
          data-testid="agent-tab-textarea"
        />
      </div>

      {showTemplates ? (
        <div className={`${isPersonaEmpty ? 'mt-4' : 'mt-4'} flex shrink-0 flex-col ${isPersonaEmpty ? '' : 'hidden'}`}>
          <div className="mx-auto w-full">
            <div className="mb-2 flex items-center justify-between gap-3 text-[12px] text-[var(--text-muted)]">
              <span>灵魂模板</span>
              {templatePageCount > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onPrevTemplatePage}
                    disabled={templatePage === 0}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-muted)] transition enabled:hover:bg-[var(--surface-card-muted)] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="上一页模板"
                  >
                    <MaskIcon name="chevronLeft" className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onNextTemplatePage}
                    disabled={templatePage >= templatePageCount - 1}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-muted)] transition enabled:hover:bg-[var(--surface-card-muted)] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="下一页模板"
                  >
                    <MaskIcon name="chevronRight" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>

            <div
              ref={templatesContainerRef}
              onMouseOver={(e) => {
                const btn = (e.target as HTMLElement).closest('button[data-template-card]') as HTMLButtonElement | null;
                if (btn && visibleTemplates.some((t) => btn.dataset.templateId === t.id)) {
                  const template = visibleTemplates.find((t) => btn.dataset.templateId === t.id)!;
                  const cardRect = btn.getBoundingClientRect();
                  const containerRect = templatesContainerRef.current!.getBoundingClientRect();
                  const availableWidth = containerRect.width > 0 ? containerRect.width : TOOLTIP_WIDTH;
                  const tooltipWidth = Math.min(TOOLTIP_WIDTH, availableWidth);
                  const centeredLeft = cardRect.left - containerRect.left + cardRect.width / 2 - tooltipWidth / 2;
                  let adjustedLeft = centeredLeft;
                  if (adjustedLeft < 0) {
                    adjustedLeft = 0;
                  }
                  const overflowRight = adjustedLeft + tooltipWidth - containerRect.width;
                  if (overflowRight > 0) {
                    adjustedLeft -= overflowRight;
                  }
                  const cardCenterX = cardRect.left - containerRect.left + cardRect.width / 2;
                  const rawArrowLeft = cardCenterX - adjustedLeft;
                  const arrowLeft = Math.max(
                    ARROW_SAFE_MARGIN,
                    Math.min(rawArrowLeft, tooltipWidth - ARROW_SAFE_MARGIN),
                  );
                  const topAbove = cardRect.top - TOOLTIP_HEIGHT - GAP;
                  const fixedLeft = containerRect.left + adjustedLeft;
                  setTooltipStyle({ position: 'fixed', left: fixedLeft, top: topAbove, width: tooltipWidth });
                  setTooltipArrowLeft(arrowLeft);
                  setHoveredTemplate(template);
                }
              }}
              onMouseLeave={() => {
                if (!isTooltipHovered && hideTooltipTimerRef.current === null) {
                  hideTooltipTimerRef.current = setTimeout(() => {
                    setHoveredTemplate(null);
                    setTooltipStyle(null);
                    setTooltipArrowLeft(null);
                    hideTooltipTimerRef.current = null;
                  }, 400);
                }
              }}
              className="relative flex flex-nowrap justify-between gap-3"
            >
              {visibleTemplates.map((template) => (
                <button
                  key={`${template.id}-${appliedTemplateKey}`}
                  data-template-card="1"
                  data-template-id={template.id}
                  type="button"
                  onMouseEnter={() => {
                    if (hideTooltipTimerRef.current) {
                      clearTimeout(hideTooltipTimerRef.current);
                      hideTooltipTimerRef.current = null;
                    }
                  }}
                  onMouseLeave={() => {
                    if (hideTooltipTimerRef.current) {
                      clearTimeout(hideTooltipTimerRef.current);
                      hideTooltipTimerRef.current = null;
                    }
                  }}
                  className="flex-1 h-[98px]  rounded-[8px] border border-[var(--border-default)] bg-[var(--surface-panel)] px-4 py-4 text-left transition-[border-color,background-color,box-shadow] hover:border-[var(--card-hover-border)] hover:bg-[var(--card-hover-bg)] hover:shadow-[var(--card-hover-shadow)]"
                >
                  <div className="text-[14px] font-semibold text-[var(--text-primary)]">{template.title}</div>
                  <div className="mt-2 line-clamp-2 text-[12px] leading-5 text-[var(--text-muted)]">{template.description}</div>
                </button>
              ))}

              <TemplateCardTooltip
                template={hoveredTemplate}
                style={tooltipStyle}
                arrowLeft={tooltipArrowLeft}
                onApply={onApplyTemplate}
                onAfterApply={onAfterApplyTemplate}
                onMouseEnter={() => {
                  if (hideTooltipTimerRef.current) {
                    clearTimeout(hideTooltipTimerRef.current);
                    hideTooltipTimerRef.current = null;
                  }
                  setIsTooltipHovered(true);
                }}
                onMouseLeave={() => {
                  setIsTooltipHovered(false);
                  setHoveredTemplate(null);
                  setTooltipStyle(null);
                  setTooltipArrowLeft(null);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
