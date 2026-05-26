/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 * ExcelJS does not evaluate formulas; cached values must exist in the file (see
 * https://github.com/exceljs/exceljs#formula-value ). When `<v>` is missing, this
 * module evaluates formulas via fast-formula-parser (~280 Excel functions).
 */

import type { Cell, Worksheet } from 'exceljs';
import FormulaParser, { FormulaError } from 'fast-formula-parser';

const MAX_PASS = (rows: number, cols: number) => Math.max(64, rows * cols * 2);

type ScalarValue = number | string | boolean | null;

export function colLettersToIndex(letters: string): number {
  let n = 0;
  const u = letters.toUpperCase();
  for (let i = 0; i < u.length; i += 1) {
    n = n * 26 + (u.charCodeAt(i) - 64);
  }
  return n;
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function parseKey(key: string): { row: number; col: number } {
  const [rowStr, colStr] = key.split(':');
  return { row: parseInt(rowStr, 10), col: parseInt(colStr, 10) };
}

function normalizeFormulaText(formula: string): string {
  return formula.replace(/^=/u, '').trim();
}

function formulaString(cell: Cell): string | undefined {
  const f = cell.formula;
  return typeof f === 'string' && f.length > 0 ? f : undefined;
}

function seedScalarFromCell(cell: Cell): ScalarValue | undefined {
  const v = cell.value;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v;
  if (!v || typeof v !== 'object') return undefined;
  if (!('formula' in v) && !('sharedFormula' in v)) return undefined;
  const r = (v as { result?: unknown }).result;
  if (typeof r === 'number' && Number.isFinite(r)) return r;
  if (typeof r === 'string') return r;
  if (typeof r === 'boolean') return r;
  return undefined;
}

function parseResultToScalar(result: unknown): ScalarValue | undefined {
  if (typeof result === 'number' && Number.isFinite(result)) return result;
  if (typeof result === 'string') return result;
  if (typeof result === 'boolean') return result;
  if (result instanceof FormulaError) return result.name;
  return undefined;
}

function createParser(values: Map<string, ScalarValue>, sheetName: string): FormulaParser {
  return new FormulaParser({
    onCell: ({ row, col }) => values.get(cellKey(row, col)),
    onRange: (ref) => {
      const arr: ScalarValue[][] = [];
      for (let row = ref.from.row; row <= ref.to.row; row += 1) {
        const inner: ScalarValue[] = [];
        for (let col = ref.from.col; col <= ref.to.col; col += 1) {
          inner.push(values.get(cellKey(row, col)) ?? null);
        }
        arr.push(inner);
      }
      return arr;
    },
    onVariable: () => {
      throw new FormulaError('#NAME?');
    },
  });
}

function evaluateFormulas(
  values: Map<string, ScalarValue>,
  formulas: Map<string, string>,
  sheetName: string,
  maxPass: number,
): void {
  const parser = createParser(values, sheetName);
  for (let pass = 0; pass < maxPass; pass += 1) {
    let progressed = false;
    for (const [key, rawFormula] of formulas) {
      if (values.has(key)) continue;
      const { row, col } = parseKey(key);
      try {
        const result = parser.parse(normalizeFormulaText(rawFormula), { row, col, sheet: sheetName });
        const scalar = parseResultToScalar(result);
        if (scalar != null) {
          values.set(key, scalar);
          progressed = true;
        }
      } catch {
        // Unsupported or not yet ready — retry on a later pass.
      }
    }
    if (!progressed) break;
  }
}

function collectWorksheetFormulas(worksheet: Worksheet): {
  values: Map<string, ScalarValue>;
  formulas: Map<string, string>;
  maxRow: number;
  maxCol: number;
} {
  const maxRow = worksheet.actualRowCount;
  const maxCol = worksheet.actualColumnCount;
  const values = new Map<string, ScalarValue>();
  const formulas = new Map<string, string>();

  for (let r = 1; r <= maxRow; r += 1) {
    for (let c = 1; c <= maxCol; c += 1) {
      const cell = worksheet.getCell(r, c);
      const key = cellKey(r, c);
      const fs = formulaString(cell);
      if (fs) formulas.set(key, fs);
      const seeded = seedScalarFromCell(cell);
      if (seeded != null) values.set(key, seeded);
    }
  }

  return { values, formulas, maxRow, maxCol };
}

/**
 * Fill `cache` with numeric values: literals, stored formula results, then iterative
 * evaluation of supported formula shapes until fixed point.
 */
export function buildWorksheetNumericCache(worksheet: Worksheet): Map<string, number> {
  const { values, formulas, maxRow, maxCol } = collectWorksheetFormulas(worksheet);
  if (maxRow === 0 || maxCol === 0) return new Map();

  evaluateFormulas(values, formulas, worksheet.name, MAX_PASS(maxRow, maxCol));

  const cache = new Map<string, number>();
  for (const [key, scalar] of values) {
    if (typeof scalar === 'number' && Number.isFinite(scalar)) cache.set(key, scalar);
  }
  return cache;
}

/** When ExcelJS has no cached `result`, try the numeric resolution map. */
export function inferFormulaNumeric(cell: Cell, cache: Map<string, number>): number | undefined {
  const { row, col } = cell.fullAddress;
  const cached = cache.get(cellKey(row, col));
  if (cached != null) return cached;

  const fs = formulaString(cell);
  if (!fs) return undefined;

  const values = new Map<string, ScalarValue>();
  for (const [key, num] of cache) values.set(key, num);

  const parser = createParser(values, cell.fullAddress.sheetName);
  try {
    const result = parser.parse(normalizeFormulaText(fs), {
      row,
      col,
      sheet: cell.fullAddress.sheetName,
    });
    const scalar = parseResultToScalar(result);
    return typeof scalar === 'number' && Number.isFinite(scalar) ? scalar : undefined;
  } catch {
    return undefined;
  }
}
