/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { apiFetch } from '@/utils/api-client';

/** 判断是否为需要走本地 API 的相对路径（非 http/https/data/blob/绝对路径） */
function isLocalRelativePath(src: string): boolean {
  if (!src) return false;
  if (src.startsWith('http://') || src.startsWith('https://')) return false;
  if (src.startsWith('data:') || src.startsWith('blob:')) return false;
  if (src.startsWith('/')) return false;
  return true;
}

/** 将 markdown 文件目录 + 相对路径合并为绝对路径，正确处理 ./ 和 ../
 *  不使用 URL API，避免中文路径被 percent-encode */
function resolveRelativePath(baseDir: string, relativeSrc: string): string {
  const base = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const src = relativeSrc.replace(/\\/g, '/');
  const parts = `${base}/${src}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..') { stack.pop(); }
    else if (part !== '.') { stack.push(part); }
  }
  return stack.join('/');
}

type ImageLoadState =
  | { status: 'loading' }
  | { status: 'ok'; dataUrl: string }
  | { status: 'error' };

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  ico: 'image/x-icon', avif: 'image/avif',
};

/** 通过 API 加载本地相对路径图片并转为 base64 data URL，
 *  首次 404 时自动降级到父目录重试 */
function useLocalMarkdownImage(src: string, baseDir: string, projectPath?: string): ImageLoadState {
  const [state, setState] = useState<ImageLoadState>({ status: 'loading' });

  const resolvedPath = useMemo(() => {
    // react-markdown 会对非 ASCII 字符（如中文路径）做 percent-encode，需要先 decode
    let decodedSrc = src;
    try { decodedSrc = decodeURIComponent(src); } catch { /* 保持原值 */ }
    return resolveRelativePath(baseDir, decodedSrc);
  }, [baseDir, src]);

  // 父目录路径，用于降级重试
  const parentDir = useMemo(() => {
    const dir = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const idx = dir.lastIndexOf('/');
    return idx > 0 ? dir.slice(0, idx) : dir;
  }, [baseDir]);

  const fallbackPath = useMemo(() => {
    if (parentDir === baseDir) return null;
    let decodedSrc = src;
    try { decodedSrc = decodeURIComponent(src); } catch { /* 保持原值 */ }
    const p = resolveRelativePath(parentDir, decodedSrc);
    return p !== resolvedPath ? p : null;
  }, [parentDir, baseDir, src, resolvedPath]);

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });

    async function fetchBase64(path: string): Promise<string | null> {
      const res = await apiFetch('/api/projects/read-local-binary-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          ...(projectPath && projectPath !== 'default' ? { projectPath } : {}),
        }),
        signal: ac.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { contentBase64?: string } | null;
      if (typeof body?.contentBase64 !== 'string' || !body.contentBase64) return null;
      const ext = path.split(/[?#]/)[0]?.toLowerCase().match(/\.([^./\\]+)$/)?.[1] ?? '';
      const mime = MIME_MAP[ext] ?? 'image/png';
      return `data:${mime};base64,${body.contentBase64}`;
    }

    void (async () => {
      try {
        let dataUrl = await fetchBase64(resolvedPath);
        // 首次失败时降级到父目录重试
        if (!dataUrl && fallbackPath) {
          dataUrl = await fetchBase64(fallbackPath);
        }
        if (ac.signal.aborted) return;
        setState(dataUrl ? { status: 'ok', dataUrl } : { status: 'error' });
      } catch {
        if (ac.signal.aborted) return;
        setState({ status: 'error' });
      }
    })();

    return () => ac.abort();
  }, [resolvedPath, fallbackPath, projectPath]);

  return state;
}

/** 渲染单张本地相对路径图片 */
function MarkdownLocalImage({
  src,
  alt,
  baseDir,
  projectPath,
}: {
  src: string;
  alt?: string;
  baseDir: string;
  projectPath?: string;
}) {
  const imageState = useLocalMarkdownImage(src, baseDir, projectPath);

  if (imageState.status === 'loading') {
    return (
      <span className="inline-block h-6 w-20 animate-pulse rounded bg-gray-200 align-middle" aria-label={alt ?? '图片加载中'} />
    );
  }
  if (imageState.status === 'error') {
    return (
      <span className="inline-block rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-500">
        {alt ?? '图片加载失败'}
      </span>
    );
  }
  // biome-ignore lint/performance/noImgElement: markdown 内嵌图片，不使用 Next Image
  return <img src={imageState.dataUrl} alt={alt ?? ''} className="max-w-full" />;
}

export function MarkdownDocumentPreview({
  source,
  className,
  baseDir,
  projectPath,
  onSelectFile,
}: {
  source: string;
  className?: string;
  /** markdown 文件所在目录的绝对路径，用于解析相对路径图片 */
  baseDir?: string;
  /** 项目根路径，传给 read-local-binary-preview API */
  projectPath?: string;
  /** 点击相对路径链接时切换预览文件的回调（不改变 tab） */
  onSelectFile?: (path: string) => void;
}) {
  const components = useMemo<Components>(() => ({
    a: ({ href, children, ...props }) => {
      // 相对路径链接：有 onSelectFile 时拦截，否则 target="_blank"
      if (href && isLocalRelativePath(href) && baseDir && onSelectFile) {
        return (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              let decoded = href;
              try { decoded = decodeURIComponent(href); } catch { /* 保持原值 */ }
              const absolutePath = resolveRelativePath(baseDir, decoded);
              if (absolutePath) onSelectFile(absolutePath);
            }}
            {...props}
          >
            {children}
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => {
      if (baseDir && src && isLocalRelativePath(src)) {
        return <MarkdownLocalImage src={src} alt={alt} baseDir={baseDir} projectPath={projectPath} />;
      }
      // biome-ignore lint/performance/noImgElement: markdown 内嵌图片
      return <img src={src} alt={alt ?? ''} className="max-w-full" />;
    },
  }), [baseDir, projectPath, onSelectFile]);

  return (
    <div
      className={`markdown-content prose prose-base max-w-none font-sans break-words leading-relaxed ${className ?? ''}`}
    >
      <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkBreaks]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
