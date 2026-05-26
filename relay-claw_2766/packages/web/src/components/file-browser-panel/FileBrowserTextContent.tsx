/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { HtmlDocumentPreview } from '@/components/document-preview/HtmlDocumentPreview';
import { HtmlPreviewToolbarActions } from '@/components/document-preview/HtmlPreviewToolbar';
import { MarkdownDocumentPreview } from '@/components/document-preview/MarkdownDocumentPreview';
import { PreviewCopyButton } from '@/components/document-preview/PreviewToolbarShared';
import { useEmbeddedTextPreviewSource } from '@/components/document-preview/useEmbeddedTextPreviewSource';
import { useSendFilePreviewReloadRevision } from '@/components/document-preview/useSendFilePreviewReloadRevision';
import { usePreviewShellExtraHeaderSetter } from './FileBrowserPreviewShellHeaderActionsContext';
import { useChatStore } from '@/stores/chatStore';

interface FileBrowserTextContentProps {
  path: string;
  kind: 'markdown' | 'html';
  displayName: string;
  threadId: string;
  projectPath?: string;
  /** HTML 内 <a> 点击时切换预览文件（不改变 tab，直接在当前面板切换） */
  onSelectFile?: (path: string) => void;
}

/**
 * Renders markdown or html file content without a PreviewPanelShell wrapper.
 * Intended to be used inside FileBrowserPreviewPane's shared shell.
 */
export function FileBrowserTextContent({
  path,
  kind,
  displayName,
  threadId,
  projectPath,
  onSelectFile,
}: FileBrowserTextContentProps) {
  const setShellHeaderActions = usePreviewShellExtraHeaderSetter();
  const reloadRevision = useSendFilePreviewReloadRevision(threadId, path);
  const [htmlRefreshNonce, setHtmlRefreshNonce] = useState(0);
  const load = useEmbeddedTextPreviewSource(path, projectPath, reloadRevision, kind === 'html' ? htmlRefreshNonce : 0);
  /** 文件所在目录（markdown/html 都需要用于解析相对路径图片） */
  const baseDir = path.replace(/[\\/][^\\/]*$/, '') || undefined;

  const bumpHtmlRefresh = useCallback(() => setHtmlRefreshNonce((n) => n + 1), []);
  const contentSig = load.status === 'ok' ? load.content : '';
  const openFileBrowserPanelWithFile = useChatStore((s) => s.openFileBrowserPanelWithFile);

  // 监听 HTML iframe 内链接点击的 postMessage，解析为绝对路径后打开文件预览
  useEffect(() => {
    if (kind !== 'html' || !baseDir) return;
    const handler = (e: MessageEvent) => {
      if (!e.data || e.data.type !== 'office-claw-html-navigate') return;
      const href = String(e.data.href ?? '').trim();
      if (!href) return;
      // 解码可能被 percent-encode 的中文路径
      let decoded = href;
      try { decoded = decodeURIComponent(href); } catch { /* 保持原值 */ }
      // 合并为绝对路径（同 resolveRelativePath 逻辑）
      const parts = `${baseDir.replace(/\\/g, '/')}/${decoded.replace(/\\/g, '/')}`.split('/');
      const stack: string[] = [];
      for (const p of parts) {
        if (p === '..') { stack.pop(); }
        else if (p !== '.') { stack.push(p); }
      }
      const absolutePath = stack.join('/');
      if (!absolutePath) return;
      // 优先用面板级回调（不改变 tab），兜底用 store action
      if (onSelectFile) {
        onSelectFile(absolutePath);
      } else {
        openFileBrowserPanelWithFile(absolutePath);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [kind, baseDir, onSelectFile, openFileBrowserPanelWithFile]);

  useLayoutEffect(() => {
    if (!setShellHeaderActions) return;
    if (load.status !== 'ok') {
      setShellHeaderActions(null);
      return;
    }
    if (kind === 'markdown') {
      setShellHeaderActions(<PreviewCopyButton text={contentSig} copyKindLabel="Markdown" />);
    } else {
      setShellHeaderActions(
        <HtmlPreviewToolbarActions
          html={contentSig}
          filePath={path}
          projectPath={projectPath}
          onRefresh={bumpHtmlRefresh}
        />,
      );
    }
    return () => setShellHeaderActions(null);
  }, [setShellHeaderActions, load.status, kind, contentSig, path, projectPath, bumpHtmlRefresh]);

  if (load.status === 'loading' || load.status === 'idle') {
    return <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">加载中…</div>;
  }
  if (load.status === 'error') {
    return <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-600">{load.message}</div>;
  }
  if (kind === 'markdown') {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <MarkdownDocumentPreview source={load.content} baseDir={baseDir} projectPath={projectPath} onSelectFile={onSelectFile} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <HtmlDocumentPreview html={load.content} title={displayName} baseDir={baseDir} projectPath={projectPath} />
      </div>
    </div>
  );
}
