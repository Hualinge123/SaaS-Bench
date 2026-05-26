/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { describe, expect, it } from 'vitest';
import { extractOutlinePages, replaceOutlinePageLine } from '../outline-parser';

const SAMPLE_NEW_OUTLINE = `# 大纲：介绍上海

**受众**：普通大众
**总页数**：5
**叙事主线**：从城市概况出发，展现上海的历史底蕴、经济实力与旅游魅力
**输入类型**：topic
**搜索模式**：auto

## 已搜索来源

| URL | 简要评分 | 覆盖维度 |
|-----|----------|----------|
| https://baike.baidu.com/item/上海市/127743 | A | 城市概况、历史、经济、文化 |

## 页面规划

### P1: 封面
- **类型**：intro
- **研究需求**：❌
- **标题**：上海——东方明珠，魅力之都
- **内容概要**：封面页，展示上海城市主题，配以标志性建筑剪影
- **研究查询**：-
- **数据需求**：-

### P2: 城市概况
- **类型**：data
- **研究需求**：✅
- **标题**：上海是中国最大的经济中心城市，常住人口近2500万
- **内容概要**：介绍上海的地理位置、行政地位、人口规模
- **研究查询**："上海人口 2024", "Shanghai GDP 2025"
- **数据需求**：常住人口数量、GDP总量

### P3: 历史文化
- **类型**：case
- **研究需求**：✅
- **标题**：上海拥有6000年文明史，是海派文化的发源地
- **内容概要**：讲述上海历史演变，海派文化特色
- **研究查询**："上海历史沿革", "海派文化特点"
- **数据需求**：历史关键时间节点

### P4: 经济发展
- **类型**：data
- **研究需求**：✅
- **标题**：2025年上海GDP突破5.6万亿元，稳居中国城市首位
- **内容概要**：展示上海的经济实力
- **研究查询**："上海GDP 2025"
- **数据需求**：GDP总量及增速

### P5: 旅游景点
- **类型**：case
- **研究需求**：✅
- **标题**：外滩、东方明珠、豫园等景点吸引数千万游客
- **内容概要**：介绍上海必游景点
- **研究查询**："上海必去景点"
- **数据需求**：年接待游客数量
`;

const SAMPLE_NO_PAGE_PLAN = `# 大纲：测试

## 其他章节

无页面规划部分。
`;

describe('extractOutlinePages', () => {
  it('should extract P lines from 页面规划 section', () => {
    const pages = extractOutlinePages(SAMPLE_NEW_OUTLINE);

    expect(pages.length).toBe(5);
    expect(pages[0]?.displayText).toBe('P1: 封面');
    expect(pages[1]?.displayText).toBe('P2: 城市概况');
    expect(pages[2]?.displayText).toBe('P3: 历史文化');
    expect(pages[3]?.displayText).toBe('P4: 经济发展');
    expect(pages[4]?.displayText).toBe('P5: 旅游景点');
  });

  it('should sort pages by pageNumber', () => {
    const pages = extractOutlinePages(SAMPLE_NEW_OUTLINE);
    const pageNumbers = pages.map((p) => p.pageNumber);
    expect(pageNumbers).toEqual([1, 2, 3, 4, 5]);
  });

  it('should preserve ### prefix in fullLine', () => {
    const pages = extractOutlinePages(SAMPLE_NEW_OUTLINE);
    expect(pages[0]?.fullLine).toBe('### P1: 封面');
  });

  it('should return empty array when no 页面规划 section', () => {
    const pages = extractOutlinePages(SAMPLE_NO_PAGE_PLAN);
    expect(pages).toEqual([]);
  });

  it('should handle empty text', () => {
    const pages = extractOutlinePages('');
    expect(pages).toEqual([]);
  });

  it('should handle text with only whitespace', () => {
    const pages = extractOutlinePages('   \n\n   ');
    expect(pages).toEqual([]);
  });
});

describe('replaceOutlinePageLine', () => {
  it('should replace page heading line with ### prefix preserved', () => {
    const pages = extractOutlinePages(SAMPLE_NEW_OUTLINE);
    const page = pages[0];
    if (!page) {
      expect.fail('Page not found');
      return;
    }

    const newText = replaceOutlinePageLine(SAMPLE_NEW_OUTLINE, page, 'P1: 新封面');
    expect(newText).toContain('### P1: 新封面');
    expect(newText).not.toContain('### P1: 封面');
  });

  
  it('should preserve other pages when replacing one', () => {
    const pages = extractOutlinePages(SAMPLE_NEW_OUTLINE);
    const page = pages[2]; // P3
    if (!page) {
      expect.fail('Page not found');
      return;
    }

    const newText = replaceOutlinePageLine(SAMPLE_NEW_OUTLINE, page, 'P3: 新历史文化');
    expect(newText).toContain('### P1: 封面'); // P1 unchanged
    expect(newText).toContain('### P2: 城市概况'); // P2 unchanged
    expect(newText).toContain('### P3: 新历史文化'); // P3 changed
    expect(newText).toContain('### P4: 经济发展'); // P4 unchanged
  });

  it('should handle Chinese colon in new page name', () => {
    const pages = extractOutlinePages(SAMPLE_NEW_OUTLINE);
    const page = pages[0];
    if (!page) {
      expect.fail('Page not found');
      return;
    }

    const newText = replaceOutlinePageLine(SAMPLE_NEW_OUTLINE, page, 'P1: 新封面：副标题');
    expect(newText).toContain('### P1: 新封面：副标题');
  });
});