import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownEditor } from './MarkdownEditor';
import { INSPIRATION_TEMPLATES, buildTemplateMarkdown } from '../constants';

function getTemplatePageSize(): number {
  if (typeof window === 'undefined') return 3;
  const width = window.innerWidth;
  if (width < 1280) return 1;
  if (width < 1600) return 2;
  if (width < 1920) return 3;
  return 4;
}

interface MarkdownEditorWrapperProps {
  activeWorkingDraft: string;
  onDraftChange: (value: string) => void;
}

export function MarkdownEditorWrapper({
  activeWorkingDraft,
  onDraftChange,
}: MarkdownEditorWrapperProps) {
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [templatePage, setTemplatePage] = useState(0);
  const [appliedTemplateKey, setAppliedTemplateKey] = useState(0);
  const [templatePageSize, setTemplatePageSize] = useState(getTemplatePageSize);

  useEffect(() => {
    const handleResize = () => setTemplatePageSize(getTemplatePageSize());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const templatePageCount = Math.max(1, Math.ceil(INSPIRATION_TEMPLATES.length / templatePageSize));
  const visibleTemplates = INSPIRATION_TEMPLATES.slice(
    templatePage * templatePageSize,
    templatePage * templatePageSize + templatePageSize,
  );

  useEffect(() => {
    setTemplatePage((p) => Math.min(Math.max(0, templatePageCount - 1), p));
  }, [templatePageCount]);

  const handleApplyTemplate = useCallback(
    (templateId: string) => {
      const template = INSPIRATION_TEMPLATES.find((t) => t.id === templateId);
      if (!template) return;

      const markdown = buildTemplateMarkdown(template);
      const existing = activeWorkingDraft.trim();
      onDraftChange(existing ? `${existing}\n\n${markdown}` : markdown);
      setAppliedTemplateKey((k) => k + 1);
    },
    [activeWorkingDraft, onDraftChange],
  );

  const handleAfterApplyTemplate = useCallback(() => {
    setAppliedTemplateKey((k) => k + 1);
  }, []);

  return (
    <MarkdownEditor
      activeTab="persona"
      activeWorkingDraft={activeWorkingDraft}
      editorSurfaceRef={editorSurfaceRef}
      editorTextareaRef={editorTextareaRef}
      isPersonaEmpty={!activeWorkingDraft.trim()}
      onApplyTemplate={handleApplyTemplate}
      onAfterApplyTemplate={handleAfterApplyTemplate}
      onDraftChange={onDraftChange}
      onNextTemplatePage={() => setTemplatePage((p) => Math.min(templatePageCount - 1, p + 1))}
      onPrevTemplatePage={() => setTemplatePage((p) => Math.max(0, p - 1))}
      templatePage={templatePage}
      templatePageCount={templatePageCount}
      visibleTemplates={visibleTemplates}
      appliedTemplateKey={appliedTemplateKey}
    />
  );
}
