/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

export type InspirationTagTone =
  | 'html'
  | 'featured'
  | 'document'
  | 'spreadsheet'
  | 'markdown'
  | 'image'
  | 'messagePush'
  | 'category'
  | 'skill'
  | 'agent';

interface InspirationTagProps {
  label: string;
  tone?: InspirationTagTone;
  iconSrc?: string;
  testId?: string;
}

const TONE_CLASSES: Record<InspirationTagTone, string> = {
  html: 'bg-[#F23030]/[0.1] text-[#F23030]',
  featured: 'bg-[#C25700]/[0.1] text-[#C25700]',
  document: 'bg-[#1476FF]/[0.1] text-[#1476FF]',
  spreadsheet: 'bg-[#029931]/[0.1] text-[#029931]',
  markdown: 'bg-[#4349D0]/[0.1] text-[#4349D0]',
  image: 'bg-[#0083C7]/[0.1] text-[#0083C7]',
  messagePush: 'bg-[#832FD6]/[0.1] text-[#832FD6]',
  category: 'bg-[#191919]/[0.1] text-[#191919]',
  skill: 'bg-[#1476FF]/[0.1] text-[#1476FF]',
  agent: 'bg-[var(--accent-secondary)]/[0.1] text-[var(--accent-secondary)]',
};

export function getInspirationTagTone(label: string): InspirationTagTone {
  if (label === '精选') return 'featured';
  if (label === '文档') return 'document';
  if (label === '表格') return 'spreadsheet';
  if (label === 'Markdown') return 'markdown';
  if (label.toLowerCase() === 'html') return 'html';
  if (label === '图片') return 'image';
  if (label === '消息推送') return 'messagePush';
  return 'category';
}

export function getInspirationTagDisplayLabel(label: string): string {
  return label.toLowerCase() === 'html' ? 'HTML' : label;
}

export function getInspirationTagToneClass(tone: InspirationTagTone): string {
  return TONE_CLASSES[tone];
}

export function InspirationTag({ label, tone, iconSrc, testId }: InspirationTagProps) {
  const resolvedTone = tone ?? getInspirationTagTone(label);
  const displayLabel = getInspirationTagDisplayLabel(label);

  return (
    <span
      className={[
        'inline-flex max-w-[120px] items-center rounded-[2px] px-1 text-xs font-normal',
        TONE_CLASSES[resolvedTone],
      ].join(' ')}
      title={displayLabel}
      data-testid={testId ?? `inspiration-tag-${resolvedTone}`}
    >
      {iconSrc ? (
        <img
          src={iconSrc}
          alt=""
          className="mr-1 h-3 w-3 shrink-0"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
      <span className="truncate">{displayLabel}</span>
    </span>
  );
}
