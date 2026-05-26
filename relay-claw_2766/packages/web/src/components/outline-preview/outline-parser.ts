/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Outline parser - extract page heading lines from outline.md markdown content.
 * Used by OutlinePreviewCard to display structured P-lines from "页面规划" section.
 */

export interface OutlinePageItem {
  /** Page number (1, 2, 3...) */
  pageNumber: number;
  /** Display text with page prefix, e.g. "P1: 封面" */
  displayText: string;
  /** Original full line content (may include ### prefix) */
  fullLine: string;
  /** Line index in original text (0-based) */
  lineIndex: number;
}

/**
 * Extract page heading lines from outline.md content.
 *
 * Parse from "页面规划" section's ### P\d: xxx sub-headings.
 * Example: ### P1: 封面 -> displayText: "P1: 封面"
 *
 * @param text - Full outline.md markdown content
 * @returns Array of OutlinePageItem sorted by pageNumber
 */
export function extractOutlinePages(text: string): OutlinePageItem[] {
  const lines = text.split('\n');
  const pages: OutlinePageItem[] = [];
  let inPagePlanSection = false;

  // Match ### P1: 封面 pattern
  const headingPattern = /^###\s*P(\d+):\s*(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect entering "页面规划" section
    if (line.match(/^##\s*页面规划/)) {
      inPagePlanSection = true;
      continue;
    }

    // Detect leaving the section (encountering new ## heading)
    if (inPagePlanSection && line.match(/^##\s/) && !line.match(/^##\s*页面规划/)) {
      inPagePlanSection = false;
    }

    if (inPagePlanSection) {
      const match = line.match(headingPattern);
      if (match) {
        const pageNumber = parseInt(match[1], 10);
        const pageName = match[2].trim();
        pages.push({
          pageNumber,
          displayText: `P${pageNumber}: ${pageName}`,
          fullLine: line,
          lineIndex: i,
        });
      }
    }
  }

  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

/**
 * Replace a page heading line in the original text with new content.
 *
 * @param text - Original full text
 * @param page - OutlinePageItem to replace
 * @param newDisplayText - New display text (e.g. "P1: 新封面")
 * @returns Modified full text
 */
export function replaceOutlinePageLine(
  text: string,
  page: OutlinePageItem,
  newDisplayText: string,
): string {
  const lines = text.split('\n');

  // Extract page name from newDisplayText (remove P\d: prefix)
  const match = newDisplayText.match(/^P\d+:\s*(.+)$/);
  const newPageName = match ? match[1] : newDisplayText;

  // Preserve ### prefix if original line has it
  const hasH3Prefix = lines[page.lineIndex].startsWith('###');
  lines[page.lineIndex] = hasH3Prefix
    ? `### P${page.pageNumber}: ${newPageName}`
    : `P${page.pageNumber}: ${newPageName}`;

  return lines.join('\n');
}