/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';

/** 判断是否为需要走本地 API 的相对路径（非 http/https/data/blob/绝对路径） */
function isLocalRelativeSrc(src: string): boolean {
  if (!src) return false;
  if (src.startsWith('http://') || src.startsWith('https://')) return false;
  if (src.startsWith('data:') || src.startsWith('blob:')) return false;
  if (src.startsWith('/')) return false;
  return true;
}

/** 将 HTML 文件目录 + 相对路径合并为绝对路径，正确处理 ./ 和 ../
 *  不使用 URL API，避免中文路径被 percent-encode */
function resolveHtmlRelativePath(baseDir: string, relativeSrc: string): string {
  // react/浏览器可能对 src 做了 percent-encode，先 decode
  let src = relativeSrc;
  try { src = decodeURIComponent(relativeSrc); } catch { /* 保持原值 */ }

  const base = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = src.replace(/\\/g, '/');

  const parts = `${base}/${rel}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..') { stack.pop(); }
    else if (part !== '.') { stack.push(part); }
  }
  return stack.join('/');
}

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  ico: 'image/x-icon', avif: 'image/avif',
};

function inferMime(path: string): string {
  const ext = path.split(/[?#]/)[0]?.toLowerCase().match(/\.([^./\\]+)$/)?.[1] ?? '';
  return MIME_MAP[ext] ?? 'image/png';
}

/** 从 HTML 字符串提取所有相对路径的 img src */
function extractLocalImageSrcs(html: string): string[] {
  const srcs = new Set<string>();
  // 匹配 <img ... src="xxx"> 或 src='xxx'
  const imgRe = /<img\s[^>]*?src=(['"])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: 标准正则循环写法
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[2]?.trim();
    if (src && isLocalRelativeSrc(src)) srcs.add(src);
  }
  // 同时匹配 CSS background-image: url(...) 里的相对路径（可选，后续扩展）
  return [...srcs];
}

/** 从 HTML 里提取 <base href="..."> 里的目录路径（如果是绝对路径） */
function extractBaseHrefDir(html: string): string | null {
  const m = /<base\s[^>]*href=(['"])(.*?)\1/i.exec(html);
  if (!m || !m[2]) return null;
  const href = m[2].trim();
  // 只处理绝对路径（以 / 开头或 file:// 开头）
  if (href.startsWith('file://')) {
    const path = href.replace(/^file:\/\//, '');
    return path.replace(/\/+$/, '');
  }
  if (href.startsWith('/')) {
    return href.replace(/\/+$/, '');
  }
  return null;
}

/**
 * 将 HTML 中的相对路径本地图片批量替换为 base64 data URL，
 * 解决 iframe srcDoc 无法加载本地文件的问题。
 *
 * @param html      原始 HTML 字符串
 * @param baseDir   HTML 文件所在目录的绝对路径
 * @param projectPath 项目根路径（传给 read-local-binary-preview）
 * @returns 替换后的 HTML 字符串（异步）
 */
export function useHtmlWithLocalImages(
  html: string,
  baseDir: string | undefined,
  projectPath: string | undefined,
): string {
  const [processedHtml, setProcessedHtml] = useState(html);

  useEffect(() => {
    // 没有 baseDir 时无法解析相对路径，直接返回原始 HTML
    if (!baseDir) {
      setProcessedHtml(html);
      return;
    }

    const localSrcs = extractLocalImageSrcs(html);
    if (localSrcs.length === 0) {
      setProcessedHtml(html);
      return;
    }

    // 先立即重置为原始 HTML，防止切换文件时短暂显示旧文件内容
    setProcessedHtml(html);

    const ac = new AbortController();
    let cancelled = false;

    // 优先用 HTML 里的 <base href> 目录，否则用文件所在目录
    const baseHrefDir = extractBaseHrefDir(html);
    const effectiveBaseDir = baseHrefDir ?? baseDir;
    // 父目录（用于降级重试）
    const parentDir = effectiveBaseDir.replace(/\/[^/]+$/, '') || effectiveBaseDir;

    /** 发一次请求，返回 base64 data URL 或 null */
    async function fetchBase64(resolvedPath: string): Promise<string | null> {
      const res = await apiFetch('/api/projects/read-local-binary-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: resolvedPath,
          ...(projectPath && projectPath !== 'default' ? { projectPath } : {}),
        }),
        signal: ac.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { contentBase64?: string } | null;
      if (typeof body?.contentBase64 !== 'string' || !body.contentBase64) return null;
      const mime = inferMime(resolvedPath);
      return `data:${mime};base64,${body.contentBase64}`;
    }

    void (async () => {
      // 并发请求所有图片的 base64，404 时降级尝试父目录
      const results = await Promise.all(
        localSrcs.map(async (src) => {
          try {
            // 优先用 effectiveBaseDir 解析
            const resolvedPath = resolveHtmlRelativePath(effectiveBaseDir, src);
            let dataUrl = await fetchBase64(resolvedPath);
            // 降级：如果父目录不同，用父目录再试一次
            if (!dataUrl && parentDir !== effectiveBaseDir) {
              const fallbackPath = resolveHtmlRelativePath(parentDir, src);
              if (fallbackPath !== resolvedPath) {
                dataUrl = await fetchBase64(fallbackPath);
              }
            }
            return { src, dataUrl };
          } catch {
            return { src, dataUrl: null };
          }
        }),
      );

      if (cancelled) return;

      // 将 HTML 里所有匹配的 src 替换为 data URL
      let patched = html;
      for (const { src, dataUrl } of results) {
        if (!dataUrl) continue;
        // 替换双引号和单引号两种写法
        patched = patched
          .replace(new RegExp(`src="${escapeRegex(src)}"`, 'g'), `src="${dataUrl}"`)
          .replace(new RegExp(`src='${escapeRegex(src)}'`, 'g'), `src='${dataUrl}'`);
      }
      setProcessedHtml(patched);
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [html, baseDir, projectPath]);

  return processedHtml;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
