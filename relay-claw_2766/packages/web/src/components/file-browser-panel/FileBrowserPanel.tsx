/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fileNameFromPath,
  inferLocalGeneratedFileKind,
  type LocalGeneratedFile,
  resolvedLocalPreviewMatchesSendFilePath,
} from '@/components/cli-output/local-generated-files';
import { useChatStore } from '@/stores/chatStore';
import { FileBrowserPreviewPane } from './FileBrowserPreviewPane';
import { FileBrowserSidebar } from './FileBrowserSidebar';
import { FileBrowserTabBar } from './FileBrowserTabBar';
import type { FileBrowserPanelProps } from './file-browser-panel-types';
import { openLocalProjectFolder, resolveFolderPath } from './file-browser-utils';
import { TaskListPanel } from './TaskListPanel';
import { useFileBrowserState } from './useFileBrowserState';
import { useWorkspaceFiles } from './useWorkspaceFiles';

/** Panel width below which the sidebar collapses into the preview header dropdown. */
const SIDEBAR_COLLAPSE_WIDTH = 960;

function fileBrowserPanelRootClass(isFullScreen: boolean, useAnchoredFullScreen: boolean): string {
  if (!isFullScreen) {
    return 'flex h-full min-h-0 w-full flex-col bg-white';
  }
  if (useAnchoredFullScreen) {
    return 'absolute inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-white shadow-[0_4px_16px_rgba(0,0,0,0.1)] rounded-xl mt-2';
  }
  return 'fixed inset-0 z-[100] flex h-screen min-h-0 w-screen flex-col overflow-hidden bg-white shadow-[0_4px_16px_rgba(0,0,0,0.1)]';
}

export function FileBrowserPanel({
  artifacts,
  projectPath,
  threadId,
  onClose,
  fullScreenContainerRef,
}: FileBrowserPanelProps) {
  const fileBrowserInitialPath = useChatStore((s) => s.fileBrowserInitialPath);
  const fileBrowserInitialTab = useChatStore((s) => s.fileBrowserInitialTab);
  const clearInitialPathAndTab = useChatStore((s) => s.openFileBrowserPanel);

  useEffect(() => {
    if (fileBrowserInitialPath || fileBrowserInitialTab) {
      clearInitialPathAndTab();
    }
  }, [fileBrowserInitialPath, fileBrowserInitialTab, clearInitialPathAndTab]);

  const { activeTab, selectedFilePath, setActiveTab, setSelectedFilePath } = useFileBrowserState(
    artifacts,
    fileBrowserInitialPath,
  );

  // workspace tab 激活时加载，或者 selectedFilePath 不在 artifacts 时也提前加载
  // 后者用于从 artifacts tab 点链接跳转到非产物文件时，避免切 tab 后有一帧空白
  const needWorkspaceEntries =
    activeTab === 'workspace' ||
    (!!selectedFilePath && !artifacts.some((a) => resolvedLocalPreviewMatchesSendFilePath(selectedFilePath, a.path)));
  const { entries: workspaceEntries, status: workspaceStatus } = useWorkspaceFiles(needWorkspaceEntries ? projectPath : '');

  const containerRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [isPreviewFullScreen, setIsPreviewFullScreen] = useState(false);
  const useAnchoredFullScreen = fullScreenContainerRef != null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.offsetWidth;
      setIsNarrow(width < SIDEBAR_COLLAPSE_WIDTH);
    });
    observer.observe(el);
    setIsNarrow(el.offsetWidth < SIDEBAR_COLLAPSE_WIDTH);
    return () => observer.disconnect();
  }, []);

  const selectedFile: LocalGeneratedFile | null = (() => {
    if (!selectedFilePath) return null;
    // 1. 优先在工作产物列表里找
    const artifact = artifacts.find((a) => resolvedLocalPreviewMatchesSendFilePath(selectedFilePath, a.path));
    if (artifact) return artifact;
    // 2. 在已加载的 workspaceEntries 里找
    const wsEntry = workspaceEntries.find((e) => e.path === selectedFilePath);
    if (wsEntry) {
      // 找到了但是目录，不能预览
      if (wsEntry.isDirectory) return null;
      return {
        name: wsEntry.name || fileNameFromPath(wsEntry.path),
        path: wsEntry.path,
        kind: inferLocalGeneratedFileKind(wsEntry.path, wsEntry.name),
      };
    }
    // 3. workspaceEntries 还在加载中（loading/idle）：不等目录树，直接用路径构造，先预览
    //    目录树加载完成后 wsEntry 会命中，会走上面的分支（效果一致，无感知）
    if (workspaceStatus === 'loading' || workspaceStatus === 'idle') {
      const name = fileNameFromPath(selectedFilePath);
      if (!name) return null;
      return {
        name,
        path: selectedFilePath,
        kind: inferLocalGeneratedFileKind(selectedFilePath, name),
      };
    }
    return null; // 已加载完但找不到，文件不存在
  })();

  const handleSelect = useCallback((path: string) => {
    setSelectedFilePath(path);
    // 如果目标路径不在工作产物列表里，切换到「全部文件」tab 以便正确加载
    const inArtifacts = artifacts.some((a) => resolvedLocalPreviewMatchesSendFilePath(path, a.path));
    if (!inArtifacts) {
      setActiveTab('workspace');
    }
  }, [setSelectedFilePath, setActiveTab, artifacts]);

  const resolvedProjectPath = projectPath && projectPath !== 'default' ? projectPath : '';

  const handleOpenFolderFromTabBar = useCallback(async () => {
    if (!selectedFile || selectedFile.isVirtual) return;
    const folder = resolveFolderPath(selectedFile.path);
    await openLocalProjectFolder(folder, resolvedProjectPath || undefined);
  }, [resolvedProjectPath, selectedFile]);

  const handleTogglePreviewFullscreen = useCallback(() => {
    setIsPreviewFullScreen((v) => !v);
  }, []);

  const isFilesTab = activeTab === 'artifacts' || activeTab === 'workspace';

  return (
    <div ref={containerRef} className={fileBrowserPanelRootClass(isPreviewFullScreen, useAnchoredFullScreen)}>
      <FileBrowserTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onClose={onClose}
        showFileActions={isFilesTab}
        canOpenFolder={!!selectedFile && !selectedFile.isVirtual}
        isFullScreen={isPreviewFullScreen}
        onOpenFolder={handleOpenFolderFromTabBar}
        onToggleFullscreen={handleTogglePreviewFullscreen}
      />

      {activeTab === 'tasks' ? (
        <TaskListPanel />
      ) : (
        <div className="flex min-h-0 flex-1">
          <FileBrowserSidebar
            isNarrow={isNarrow}
            activeTab={activeTab}
            artifacts={artifacts}
            projectPath={projectPath}
            selectedFilePath={selectedFilePath}
            onSelect={handleSelect}
          />
          <FileBrowserPreviewPane
            isNarrow={isNarrow}
            selectedFile={selectedFile}
            artifacts={artifacts}
            threadId={threadId}
            projectPath={projectPath}
            activeTab={activeTab}
            onSelectFile={handleSelect}
            onClose={onClose}
          />
        </div>
      )}
    </div>
  );
}
