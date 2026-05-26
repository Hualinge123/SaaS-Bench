/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWorksheetNumericCache, colLettersToIndex, inferFormulaNumeric } from '../xlsx/xlsxFormulaFallback';
import { parseXlsxBase64ToSheets } from '../xlsx/xlsxWorkbook';

function cellValue(cache: Map<string, number>, row: number, col: number): number | undefined {
  return cache.get(`${row}:${col}`);
}

async function buildSheetFromGrid(
  grid: Array<Array<string | number | { formula: string; result?: number }>>,
): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      const entry = grid[r][c];
      const cell = worksheet.getCell(r + 1, c + 1);
      if (typeof entry === 'object' && entry !== null && 'formula' in entry) {
        cell.value = entry.result == null ? { formula: entry.formula } : { formula: entry.formula, result: entry.result };
      } else {
        cell.value = entry;
      }
    }
  }
  return worksheet;
}

describe('xlsxFormulaFallback', () => {
  it('maps column letters to 1-based indices', () => {
    expect(colLettersToIndex('A')).toBe(1);
    expect(colLettersToIndex('F')).toBe(6);
    expect(colLettersToIndex('AA')).toBe(27);
  });

  it('evaluates AVERAGE when cached <v> is missing', async () => {
    const worksheet = await buildSheetFromGrid([
      ['区域', '1月', '2月', '3月', '总计', '月均'],
      ['华东', 12500, 13800, 15200, { formula: 'SUM(B2:D2)' }, { formula: 'AVERAGE(B2:D2)' }],
      ['华南', 9800, 10500, 11200, { formula: 'SUM(B3:D3)' }, { formula: 'AVERAGE(B3:D3)' }],
      ['华北', 8600, 9200, 10100, { formula: 'SUM(B4:D4)' }, { formula: 'AVERAGE(B4:D4)' }],
      ['合计', { formula: 'SUM(B2:B4)' }, { formula: 'SUM(C2:C4)' }, { formula: 'SUM(D2:D4)' }, { formula: 'SUM(E2:E4)' }, { formula: 'AVERAGE(B5:D5)' }],
    ]);

    const cache = buildWorksheetNumericCache(worksheet);

    expect(cellValue(cache, 2, 5)).toBe(41500);
    expect(cellValue(cache, 2, 6)).toBeCloseTo(13833.333333333334, 8);
    expect(cellValue(cache, 3, 6)).toBeCloseTo(10500, 8);
    expect(cellValue(cache, 5, 2)).toBe(30900);
    expect(cellValue(cache, 5, 5)).toBe(100900);
    expect(cellValue(cache, 5, 6)).toBeCloseTo(33633.333333333336, 8);
  });

  it('evaluates IF and division formulas without cached results', async () => {
    const worksheet = await buildSheetFromGrid([
      [100, 200, { formula: 'IF(A1=0,0,B1/A1-1)' }],
      [0, 50, { formula: 'IF(A2=0,0,B2/A2-1)' }],
    ]);

    const cache = buildWorksheetNumericCache(worksheet);
    expect(cellValue(cache, 1, 3)).toBeCloseTo(1, 8);
    expect(cellValue(cache, 2, 3)).toBe(0);
  });

  it('inferFormulaNumeric resolves a single formula against an existing cache', async () => {
    const worksheet = await buildSheetFromGrid([
      [10, 20, 30, { formula: 'AVERAGE(A1:C1)' }],
    ]);
    const cache = buildWorksheetNumericCache(worksheet);
    const cell = worksheet.getCell(1, 4);
    expect(inferFormulaNumeric(cell, cache)).toBe(20);
  });

  it('parseXlsxBase64ToSheets displays evaluated AVERAGE in preview text', async () => {
    const worksheet = await buildSheetFromGrid([
      ['区域', '1月', '2月', '3月', '月均'],
      ['华东', 12500, 13800, 15200, { formula: 'AVERAGE(B2:D2)' }],
    ]);
    const workbook = worksheet.workbook;
    const buffer = await workbook.xlsx.writeBuffer();
    const b64 = Buffer.from(buffer).toString('base64');

    const sheets = await parseXlsxBase64ToSheets(b64);
    expect(sheets[0]?.rows[1]?.[4]?.text).toMatch(/13833/);
  });
});
