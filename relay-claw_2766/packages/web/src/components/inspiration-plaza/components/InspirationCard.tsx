/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { type MouseEvent, useState } from 'react';
import { Button } from '@/components/shared/Button';
import { getNewSessionDisabledReasonForTemplate, useCreateSameFlow } from '../hooks/useCreateSameFlow';
import type { InspirationTemplateListItem } from '../types';
import { CreateSessionDialog } from './CreateSessionDialog';
import {
  getInspirationTagDisplayLabel,
  getInspirationTagTone,
  getInspirationTagToneClass,
  InspirationTag,
} from './InspirationTag';

const DEFAULT_INSPIRATION_THUMBNAIL = '/images/inspiration-products/default.svg';

interface InspirationCardProps {
  template: InspirationTemplateListItem;
  onClick: (template: InspirationTemplateListItem) => void;
}

interface ProductThumbnailTheme {
  label: string;
  backgroundColor: string;
  backgroundPath: string;
  iconPath?: string;
  examplePath: string;
  showIcon?: boolean;
}

const PRODUCT_THUMBNAIL_THEMES = {
  messagePush: {
    label: '消息推送',
    backgroundColor: '#FFF1E6',
    backgroundPath: '/images/inspiration/orange-bg.png',
    examplePath: '/images/inspiration/task-bg.png',
    showIcon: false,
  },
  word: {
    label: '文档',
    backgroundColor: '#EAF3FF',
    backgroundPath: '/images/inspiration/blue-bg.png',
    iconPath: '/icons/inspiration/icon-word.svg',
    examplePath: '/images/inspiration/doc-example.png',
  },
  excel: {
    label: '表格',
    backgroundColor: '#E8F8EF',
    backgroundPath: '/images/inspiration/green-bg.png',
    iconPath: '/icons/inspiration/icon-excel.svg',
    examplePath: '/images/inspiration/excel-example.png',
  },
  markdown: {
    label: 'Markdown',
    backgroundColor: '#F1ECFF',
    backgroundPath: '/images/inspiration/purple-bg.png',
    iconPath: '/icons/inspiration/icon-markdown.svg',
    examplePath: '/images/inspiration/markdown-example.png',
  },
} satisfies Record<string, ProductThumbnailTheme>;

function getProductThumbnailTheme(tags: string[]): ProductThumbnailTheme | null {
  if (tags.includes('消息推送')) return PRODUCT_THUMBNAIL_THEMES.messagePush;
  if (tags.includes('文档')) return PRODUCT_THUMBNAIL_THEMES.word;
  if (tags.includes('表格')) return PRODUCT_THUMBNAIL_THEMES.excel;
  if (tags.includes('Markdown')) return PRODUCT_THUMBNAIL_THEMES.markdown;
  return null;
}

function hasReturnedThumbnail(imagePath: string): boolean {
  const normalizedPath = imagePath.trim();
  return Boolean(normalizedPath) && normalizedPath !== DEFAULT_INSPIRATION_THUMBNAIL;
}

function InspirationProductThumbnail({
  template,
  theme,
}: {
  template: InspirationTemplateListItem;
  theme: ProductThumbnailTheme;
}) {
  const shouldShowIcon = theme.showIcon !== false && theme.iconPath;

  return (
    <div
      data-testid="inspiration-card-product-layout"
      className="grid h-full grid-cols-[minmax(0,1fr)_138px] items-center gap-3 p-4"
    >
      <div className="flex min-w-0 flex-col items-start justify-center">
        {shouldShowIcon ? (
          <img
            data-testid="inspiration-card-product-icon"
            src={theme.iconPath}
            alt={theme.label}
            className="mb-2 h-4 w-4 shrink-0"
          />
        ) : null}
        <div
          data-testid="inspiration-card-product-title"
          className="max-w-full truncate text-[13px] font-semibold leading-[19px] text-[#111827]"
          title={template.name}
        >
          {template.name}
        </div>
        <div
          data-testid="inspiration-card-product-description"
          className="mt-1 line-clamp-2 max-w-full text-[11px] leading-[17px] text-[#4B5563]"
          title={template.description}
        >
          {template.description}
        </div>
        <div
          data-testid="inspiration-card-preview-tags"
          className="mt-2 flex w-[142.857%] origin-top-left scale-[0.7] flex-nowrap gap-1 overflow-hidden"
        >
          {template.tags.map((tag, index) => {
            const tone = getInspirationTagTone(tag);
            const displayLabel = getInspirationTagDisplayLabel(tag);
            return (
              <span
                key={tag}
                data-testid={index === 0 ? 'inspiration-card-preview-tag' : undefined}
                className={[
                  'inline-flex min-w-0 max-w-[120px] shrink-0 items-center rounded-[2px] px-1 text-[11px] font-normal leading-4',
                  getInspirationTagToneClass(tone),
                ].join(' ')}
                title={displayLabel}
              >
                <span className="truncate whitespace-nowrap">{displayLabel}</span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="flex h-full w-[138px] items-center justify-center">
        <img
          data-testid="inspiration-card-product-example"
          src={theme.examplePath}
          alt={`${theme.label}示例`}
          className="h-[136px] w-[138px] object-contain"
        />
      </div>
    </div>
  );
}

export function InspirationCard({ template, onClick }: InspirationCardProps) {
  const [showDialog, setShowDialog] = useState(false);
  const createSame = useCreateSameFlow(template);
  const productThumbnailTheme = hasReturnedThumbnail(template.imagePath)
    ? null
    : getProductThumbnailTheme(template.tags);
  const newSessionDisabledReason = getNewSessionDisabledReasonForTemplate(template);

  const handleCreateSame = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setShowDialog(true);
  };

  const handleDoSameNew = (_threadId: string) => {
    void createSame({ kind: 'new' });
  };

  const handleDoSameExisting = (threadId: string) => {
    void createSame({ kind: 'existing', threadId });
  };

  return (
    <>
      <div
        data-testid="inspiration-card"
        onClick={() => onClick(template)}
        className="group w-full max-w-[490px] cursor-pointer overflow-hidden rounded-2xl border border-[#E6E6E6] bg-[var(--surface-card)] transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)]"
      >
        {productThumbnailTheme ? (
          <div
            data-testid="inspiration-card-preview"
            className="h-[168px] overflow-hidden bg-cover bg-center bg-[var(--surface-muted)]"
            style={{
              backgroundColor: productThumbnailTheme.backgroundColor,
              backgroundImage: `url(${productThumbnailTheme.backgroundPath})`,
            }}
          >
            <InspirationProductThumbnail template={template} theme={productThumbnailTheme} />
          </div>
        ) : (
          <div data-testid="inspiration-card-preview" className="h-[168px] overflow-hidden bg-[var(--surface-muted)]">
            <img
              src={template.imagePath || DEFAULT_INSPIRATION_THUMBNAIL}
              alt={template.name}
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.src = DEFAULT_INSPIRATION_THUMBNAIL;
              }}
            />
          </div>
        )}

        <div data-testid="inspiration-card-content" className="p-4">
          <h3
            data-testid="inspiration-card-title"
            className="mb-1 truncate text-sm font-semibold text-[var(--text-primary)]"
            title={template.name}
          >
            {template.name}
          </h3>

          <p
            data-testid="inspiration-card-description"
            className="mb-3 line-clamp-2 text-xs text-[var(--text-secondary)]"
            title={template.description}
          >
            {template.description}
          </p>

          <div className="flex min-h-[20px] flex-wrap gap-1">
            <div className="tag-row flex flex-wrap gap-1 group-hover:hidden">
              {template.tags.map((tag, index) => (
                <InspirationTag key={tag} label={tag} testId={index === 0 ? 'inspiration-card-tag' : undefined} />
              ))}
            </div>
            <div className="hidden group-hover:flex">
              <Button
                variant="ghost"
                size="sm"
                data-testid="inspiration-create-same-button"
                className="create-same-btn text-sm text-[#1476FF]"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 'auto',
                  minWidth: 0,
                  minHeight: 0,
                  padding: 0,
                  border: 0,
                  borderRadius: 0,
                  background: 'transparent',
                  color: '#1476FF',
                  fontSize: 14,
                  lineHeight: '20px',
                }}
                onClick={handleCreateSame}
              >
                创建同款
              </Button>
            </div>
          </div>
        </div>
      </div>

      <CreateSessionDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onCreateNew={handleDoSameNew}
        onSelectExisting={handleDoSameExisting}
        newSessionDisabledReason={newSessionDisabledReason}
      />
    </>
  );
}
