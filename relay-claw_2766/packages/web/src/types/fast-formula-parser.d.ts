declare module 'fast-formula-parser' {
  export class FormulaError extends Error {
    details?: unknown;
    get error(): string;
    name: string;
    constructor(error: string, msg?: string, details?: unknown);
    static readonly DIV0: FormulaError;
    static readonly NA: FormulaError;
    static readonly NAME: FormulaError;
    static readonly NULL: FormulaError;
    static readonly NUM: FormulaError;
    static readonly REF: FormulaError;
    static readonly VALUE: FormulaError;
  }

  export interface CellRef {
    sheet?: string;
    row: number;
    col: number;
  }

  export interface RangeRef {
    sheet?: string;
    from: { row: number; col: number };
    to: { row: number; col: number };
  }

  export interface FormulaParserOptions {
    onCell?: (ref: CellRef) => unknown;
    onRange?: (ref: RangeRef) => unknown[][];
    onVariable?: (name: string, sheetName?: string) => CellRef | RangeRef;
    functions?: Record<string, (...args: unknown[]) => unknown>;
    functionsNeedContext?: Record<string, (context: unknown, ...args: unknown[]) => unknown>;
  }

  export default class FormulaParser {
    constructor(options?: FormulaParserOptions);
    parse(formula: string, position: CellRef, allowArray?: boolean): unknown;
    parseAsync(formula: string, position: CellRef, allowArray?: boolean): Promise<unknown>;
  }

  export const MAX_ROW: number;
  export const MAX_COLUMN: number;
}
