import { describe, it, expect } from 'vitest';
import { crossCheck, type CrossCheckRow } from '../services/crossCheck';

const rows = (): CrossCheckRow[] => [
  { line_no: 1, item_number: 'MC-ARG-PRM-00122', quantity: '1.000', uom: 'Piece', nett_weight: 19, gross_weight: 20 },
  { line_no: 2, item_number: 'MC-ARG-PRM-00049', quantity: '100.000', uom: 'PCS', nett_weight: 40, gross_weight: 41 },
  { line_no: 3, item_number: 'MC-ARG-PRM-00015', quantity: '2.000', uom: 'PCS', nett_weight: 10, gross_weight: 11 },
];

describe('crossCheck', () => {
  it('reports OK when code and AI agree on everything', () => {
    const r = crossCheck(rows(), rows());
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(3);
    expect(r.total_issues).toBe(0);
  });

  it('normalises so "30.5" (string) and 30.5 (number), and case, are NOT false disagreements', () => {
    const code = [{ line_no: 1, uom: 'Piece', nett_weight: 30.5 }];
    const ai = [{ line_no: 1, uom: 'PIECE', nett_weight: '30.5' as any }];
    const r = crossCheck(code, ai, ['uom', 'nett_weight']);
    expect(r.ok).toBe(true);
  });

  it('pinpoints a misread NUMBER to the exact row and field', () => {
    const ai = rows(); ai[2] = { ...ai[2], nett_weight: 80.5 };
    const r = crossCheck(rows(), ai);
    expect(r.ok).toBe(false);
    expect(r.disagreements).toEqual([{ line_no: 3, field: 'nett_weight', code: 10, ai: 80.5 }]);
  });

  it('pinpoints a misread ITEM CODE', () => {
    const ai = rows(); ai[0] = { ...ai[0], item_number: 'MC-ARG-PRM-00016' };
    const r = crossCheck(rows(), ai);
    expect(r.disagreements[0]).toMatchObject({ line_no: 1, field: 'item_number' });
  });

  it('detects a row the AI DROPPED', () => {
    const ai = rows().filter(x => x.line_no !== 2);
    const r = crossCheck(rows(), ai);
    expect(r.missing_in_ai).toEqual([2]);
    expect(r.ok).toBe(false);
  });

  it('detects a row only the AI has (code missed it)', () => {
    const code = rows().filter(x => x.line_no !== 2);
    const r = crossCheck(code, rows());
    expect(r.missing_in_code).toEqual([2]);
  });

  it('produces a human-readable report', () => {
    const ai = rows().filter(x => x.line_no !== 2);
    ai[1] = { ...ai[1], nett_weight: 999 };
    const r = crossCheck(rows(), ai);
    expect(r.report_lines.some(l => l.includes('MISSING in AI'))).toBe(true);
    expect(r.report_lines.some(l => l.includes('nett_weight'))).toBe(true);
  });
});
