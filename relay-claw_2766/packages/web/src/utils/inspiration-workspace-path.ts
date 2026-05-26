/*
 * *
 *  Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

const FILE_PLACEHOLDER_RE = /\{\{file:/;
const TRAILING_PATH_SEPARATORS_RE = /[/\\]+$/;
const FORBIDDEN_FILE_NAME_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatInspirationWorkspaceTimestamp(date = new Date()): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

export function buildDefaultInspirationWorkspacePath(workspaceRoot: string, date = new Date()): string {
  const trimmedRoot = workspaceRoot.trim().replace(TRAILING_PATH_SEPARATORS_RE, '');
  if (!trimmedRoot) return '';
  return `${trimmedRoot}/${formatInspirationWorkspaceTimestamp(date)}`;
}

export function sanitizeInspirationUploadFileName(fileName: string): string {
  const cleaned = fileName.trim().replace(FORBIDDEN_FILE_NAME_CHARS_RE, '_');
  return cleaned || 'upload';
}

export function buildInspirationUploadPath(workspacePath: string, fileName: string): string {
  const trimmedWorkspace = workspacePath.trim().replace(TRAILING_PATH_SEPARATORS_RE, '');
  const sanitizedFileName = sanitizeInspirationUploadFileName(fileName);
  if (!trimmedWorkspace) return `upload/${sanitizedFileName}`;
  return `${trimmedWorkspace}/upload/${sanitizedFileName}`;
}

export function promptHasFilePlaceholder(prompt: string): boolean {
  return FILE_PLACEHOLDER_RE.test(prompt);
}
