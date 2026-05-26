/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useHtmlWithLocalImages } from './useHtmlWithLocalImages';

/**
 * 注入到 iframe 里的脚本：
 * 1. 链接拦截：内部相对路径 <a> 点击通过 postMessage 交由外层处理
 * 2. 视口自检：如果 window.innerHeight/innerWidth 为 0（layout 时机问题），
 *    通知父窗口重新设置 srcdoc
 */
const LINK_INTERCEPTOR_SCRIPT = `<script>
(function () {
  // 1. 链接拦截
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!el) return;
    var href = el.getAttribute('href');
    if (!href) return;
    if (/^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) return;
    e.preventDefault();
    window.parent.postMessage({ type: 'office-claw-html-navigate', href: href }, '*');
  });

  // 2. 视口自检：检测并报告视口尺寸异常
  function checkViewport() {
    if (window.innerHeight === 0 || window.innerWidth === 0) {
      window.parent.postMessage({ type: 'office-claw-html-viewport-fix' }, '*');
    }
  }
  // 多时机检测，确保覆盖各种 layout 场景
  checkViewport();
  document.addEventListener('DOMContentLoaded', checkViewport);
  setTimeout(checkViewport, 0);
  setTimeout(checkViewport, 100);
})();
<\/script>`;

/**
 * Renders a **single** HTML file from disk in an isolated frame (general preview, not PPT Studio).
 * - `baseDir` + `projectPath`：将 HTML 中的相对路径本地图片替换为 base64
 * - 注入脚本：链接拦截 + 视口自检
 *
 * ## srcdoc 设置策略（双重保险）
 *
 * **主路径**：`useLayoutEffect` 里先 `void el.offsetHeight` 触发强制 reflow，
 * 使浏览器在设置 srcdoc 之前完成 flex layout 计算，确保 iframe 视口尺寸正确。
 *
 * **保底路径**：iframe 内注入的脚本检测 `window.innerHeight/innerWidth`，
 * 若为 0 则向父窗口发 `office-claw-html-viewport-fix` 消息；
 * 父窗口收到后延迟 50ms 重设 srcdoc（此时 flex layout 一定已完成）。
 * 最多重设 3 次，防止异常情况下无限循环。
 */
export function HtmlDocumentPreview({
  html,
  title,
  baseDir,
  projectPath,
}: {
  html: string;
  title: string;
  /** HTML 文件所在目录的绝对路径，用于解析相对路径图片 */
  baseDir?: string;
  /** 项目根路径，传给 read-local-binary-preview API */
  projectPath?: string;
}) {
  const processedHtml = useHtmlWithLocalImages(html, baseDir, projectPath);

  // 在 </body> 前（或末尾）注入脚本
  const srcDoc = useMemo(() => {
    if (processedHtml.includes('</body>')) {
      return processedHtml.replace('</body>', `${LINK_INTERCEPTOR_SCRIPT}</body>`);
    }
    return processedHtml + LINK_INTERCEPTOR_SCRIPT;
  }, [processedHtml]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 用 ref 在保底回调里获取最新 srcDoc 和控制重载次数，避免闭包过期
  const srcDocRef = useRef(srcDoc);
  const reloadCountRef = useRef(0);

  // 主路径：DOM mutation 后、paint 前设置 srcdoc
  // void el.offsetHeight 强制浏览器同步 reflow（forced synchronous layout），
  // 确保 flex 高度在 srcdoc 设置前已计算完成，iframe 视口有正确尺寸
  useLayoutEffect(() => {
    reloadCountRef.current = 0; // 切换文件时重置保底计数器
    srcDocRef.current = srcDoc;
    const el = iframeRef.current;
    if (!el) return;
    // biome-ignore lint/suspicious/noVoid: 故意读取 offsetHeight 触发强制 reflow
    void el.offsetHeight;
    el.srcdoc = srcDoc;
  }, [srcDoc]);

  // 保底路径：监听 iframe 内脚本发来的视口异常消息
  // 延迟 50ms 后重设 srcdoc（此时 layout 一定已完成）
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'office-claw-html-viewport-fix') return;
      if (reloadCountRef.current >= 3) return; // 防止无限循环
      reloadCountRef.current++;
      setTimeout(() => {
        const el = iframeRef.current;
        if (el) el.srcdoc = srcDocRef.current;
      }, 50);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []); // 只挂载一次，通过 ref 访问最新值

  return (
    <iframe
      ref={iframeRef}
      title={title}
      className="absolute inset-0 box-border h-full w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-neutral-white,#fff)]"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
    />
  );
}
