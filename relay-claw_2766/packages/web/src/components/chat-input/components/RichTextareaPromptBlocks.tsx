/*
 * *
 *  Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import {
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { FilePlaceholder, ParsedPrompt, TextPlaceholder } from '@/utils/promptParser';
import { usePromptBlockKeyboardNavigation } from '../hooks/usePromptBlockKeyboardNavigation';
import { FilePlaceholderBlock } from './FilePlaceholderBlock';
import {
  buildRichTextareaSegments,
  renderRichTextareaSegments,
  type RichQuickActionOption,
  type RichSkillOption,
  serializeRichTextareaNode,
  serializeRichTextareaNodeSignature,
} from './rich-textarea-token-rendering';
import { TextPlaceholderBlock } from './TextPlaceholderBlock';

export interface RichTextareaPromptBlocksProps {
  parsed: ParsedPrompt;
  activePlaceholderId: string | null;
  onFocus: (id: string) => void;
  onBlur: () => void;
  onDelete: (id: string) => void;
  onTabNext: (currentId: string) => void;
  onInput?: (e: FormEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  skillOptions?: RichSkillOption[];
  quickActionOptions?: RichQuickActionOption[];
  className?: string;
  style?: CSSProperties;
}

function placeCaretFromClick(e: MouseEvent<HTMLSpanElement>): void {
  e.stopPropagation();
  const selection = window.getSelection();
  if (!selection) return;

  let range: Range | null = null;
  if (typeof document.caretRangeFromPoint === 'function') {
    range = document.caretRangeFromPoint(e.clientX, e.clientY);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    }
  }

  if (!range) {
    range = document.createRange();
    range.selectNodeContents(e.currentTarget);
    range.collapse((e.currentTarget.textContent ?? '').length === 0);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

interface RichPromptFixedBlockProps {
  blockIndex: number;
  content: string;
  skillOptions: RichSkillOption[];
  quickActionOptions: RichQuickActionOption[];
  isTerminalCaretTarget?: boolean;
}

function RichPromptFixedBlock({
  blockIndex,
  content,
  skillOptions,
  quickActionOptions,
  isTerminalCaretTarget = false,
}: RichPromptFixedBlockProps) {
  const blockRef = useRef<HTMLSpanElement>(null);
  const segments = useMemo(
    () => buildRichTextareaSegments(content, skillOptions, quickActionOptions, { allowTerminalMention: true }),
    [content, quickActionOptions, skillOptions],
  );
  const segmentSignature = useMemo(
    () =>
      segments
        .map((segment) => {
          if (segment.type === 'text') return `t:${segment.text}`;
          if (segment.type === 'mention') return `m:${segment.text}`;
          if (segment.type === 'skill') return `s:${segment.token}`;
          return `q:${segment.token}`;
        })
        .join(''),
    [segments],
  );

  useLayoutEffect(() => {
    const el = blockRef.current;
    if (!el) return;

    const currentText = Array.from(el.childNodes)
      .map((node) => serializeRichTextareaNode(node))
      .join('');
    const currentSignature = Array.from(el.childNodes)
      .map((node) => serializeRichTextareaNodeSignature(node))
      .join('');
    if (currentText === content && currentSignature === segmentSignature) return;

    renderRichTextareaSegments(el, segments);
  }, [content, segments, segmentSignature]);

  return (
    <span
      ref={blockRef}
      contentEditable
      suppressContentEditableWarning
      className={
        isTerminalCaretTarget
          ? 'inline-block min-w-[1px] align-baseline outline-none focus:outline-none'
          : 'outline-none focus:outline-none'
      }
      data-block-index={blockIndex}
      onClick={placeCaretFromClick}
    />
  );
}

export const RichTextareaPromptBlocks = forwardRef<HTMLDivElement, RichTextareaPromptBlocksProps>(
  function RichTextareaPromptBlocks(
    {
      parsed,
      activePlaceholderId,
      onFocus,
      onBlur,
      onDelete,
      onTabNext,
      onInput,
      onKeyDown,
      onPaste,
      onScroll,
      skillOptions = [],
      quickActionOptions = [],
      className,
      style,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => containerRef.current as HTMLDivElement);

    const handleFocus = useCallback((id: string) => onFocus(id), [onFocus]);
    const handleBlur = useCallback(() => onBlur(), [onBlur]);
    const handleDelete = useCallback((id: string) => onDelete(id), [onDelete]);
    const handleTabNext = useCallback((currentId: string) => onTabNext(currentId), [onTabNext]);

    usePromptBlockKeyboardNavigation({ containerRef, parsed, onFocus, onBlur, onDelete: handleDelete });

    return (
      <div
        ref={containerRef}
        className={className ? `${className} outline-none` : 'outline-none'}
        style={style}
        tabIndex={0}
        role="textbox"
        aria-multiline="true"
        onInput={onInput}
        onKeyDown={(e) => {
          if (e.defaultPrevented) return;
          onKeyDown?.(e);
        }}
        onPaste={onPaste}
        onScroll={onScroll}
      >
        {parsed.blocks.map((block, index) => {
          if (block.type === 'fixed') {
            return (
              <RichPromptFixedBlock
                key={`fixed-${index}`}
                blockIndex={index}
                content={block.content}
                skillOptions={skillOptions}
                quickActionOptions={quickActionOptions}
                isTerminalCaretTarget={index === parsed.blocks.length - 1 && block.content.length === 0}
              />
            );
          }

          if (block.type === 'placeholder') {
            const placeholder = block.placeholder;
            const isActive = placeholder.id === activePlaceholderId;

            if (placeholder.type === 'text') {
              return (
                <TextPlaceholderBlock
                  key={placeholder.id}
                  placeholder={placeholder as TextPlaceholder}
                  isActive={isActive}
                  skillOptions={skillOptions}
                  quickActionOptions={quickActionOptions}
                  onFocus={() => handleFocus(placeholder.id)}
                  onBlur={handleBlur}
                  onDelete={() => handleDelete(placeholder.id)}
                  onTabNext={() => handleTabNext(placeholder.id)}
                />
              );
            }

            if (placeholder.type === 'file') {
              return (
                <FilePlaceholderBlock
                  key={placeholder.id}
                  placeholder={placeholder as FilePlaceholder}
                  isActive={isActive}
                  onFocus={() => handleFocus(placeholder.id)}
                  onBlur={handleBlur}
                  onDelete={() => handleDelete(placeholder.id)}
                  onTabNext={() => handleTabNext(placeholder.id)}
                />
              );
            }
          }

          return null;
        })}
      </div>
    );
  },
);
