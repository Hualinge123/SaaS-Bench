import { EmptyDataState } from '../../shared/EmptyDataState';

type EmptyStateProps = {
  title: string;
  description?: string;
  showTemplates?: boolean;
  templateCards?: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  onTemplateClick?: (templateId: string) => void;
  emptyTemplateSectionExpanded?: boolean;
  onToggleTemplates?: () => void;
};

export function EmptyState({
  title,
  description,
  showTemplates,
  templateCards,
  onTemplateClick,
  emptyTemplateSectionExpanded,
  onToggleTemplates,
}: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-[320px] flex-col">
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <EmptyDataState title={title} />
          {description && (
            <p className="mt-2 text-[12px] text-[var(--text-muted)]">{description}</p>
          )}
        </div>
      </div>
      {showTemplates && templateCards && templateCards.length > 0 && (
        <div className="w-full px-6 pb-6 pt-5">
          <div className="flex justify-center">
            <button
              type="button"
              className={`inline-flex items-center gap-1 text-[14px] text-[var(--schedule-empty-state-text-secondary)]`}
              onClick={onToggleTemplates}
              aria-expanded={emptyTemplateSectionExpanded}
              data-testid="scheduled-task-empty-template-toggle"
            >
              <span>热门模板推荐</span>
              <svg
                className={['h-4 w-4 transition-transform', emptyTemplateSectionExpanded ? 'rotate-180' : ''].join(' ')}
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M5 12.5L10 7.5L15 12.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          {emptyTemplateSectionExpanded ? (
            <div className="mt-3 grid grid-cols-4 gap-4">
              {templateCards.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => onTemplateClick?.(template.id)}
                  className={`flex h-[214px] min-h-[214px] w-full flex-col items-start gap-5 rounded-[24px] border border-[var(--schedule-empty-state-border)] bg-[var(--schedule-empty-state-bg-faint)] px-6 pb-7 pt-7 text-left transition-colors`}
                  data-testid={`scheduled-task-empty-template-${template.id}`}
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-[var(--schedule-empty-state-bg-solid)]">
                    <img src="/icons/schedule.svg" alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />
                  </span>
                  <span className="block w-full text-[16px] font-bold leading-6 text-[var(--schedule-empty-state-text-primary)]">
                    {template.title}
                  </span>
                  <span
                    className="block w-full overflow-hidden text-[14px] leading-5 text-[var(--schedule-empty-state-text-secondary)]"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {template.description}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}