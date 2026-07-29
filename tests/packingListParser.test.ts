import { describe, it, expect } from 'vitest';
import { parsePackingListText } from '../services/packingListParser';

// A small synthetic sample that mimics the JAMMED text a PDF text-layer extractor produces.
const SAMPLE = [
  'PACKING LIST',
  'Date : 16-06-2026',
  'PL No : SO26060535',
  '1MC-ARG-PRM-001221.000Piece19.00020.000',
  'END BEARING PN. 200 - 15 - 4.5.6.7.8.9,PART OF',
  'PRESS MACHINE',
  'NPBB:04053/COM/032026 (RSUP-DP)',
  '2MC-ARG-PRM-00049100.000PCS40.00041.000',
  'CAGE BARS LONG OIL EXPELLER',
  'NPBB:04053/COM/032026 (RSUP-DP)',
  'Sub Total',
  'TOTAL PACKING',
  '59.00061.000',
  '4 PACKAGES',
  'Page 1/12',
].join('\n');

describe('parsePackingListText', () => {
  it('parses every item row with the right columns', () => {
    const r = parsePackingListText(SAMPLE);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({
      line_no: 1, item_number: 'MC-ARG-PRM-00122', quantity: '1.000', uom: 'Piece',
      nett_weight: 19, gross_weight: 20,
    });
    expect(r.items[1]).toMatchObject({ line_no: 2, item_number: 'MC-ARG-PRM-00049', uom: 'PCS', nett_weight: 40, gross_weight: 41 });
  });

  it('joins multi-line descriptions and captures the NPBB ref', () => {
    const r = parsePackingListText(SAMPLE);
    expect(r.items[0].description).toBe('END BEARING PN. 200 - 15 - 4.5.6.7.8.9,PART OF PRESS MACHINE');
    expect(r.items[0].npbb_ref).toBe('NPBB:04053/COM/032026 (RSUP-DP)');
  });

  it('reads the printed totals, package count and page total', () => {
    const r = parsePackingListText(SAMPLE);
    expect(r.printed_nett_total).toBe(59);
    expect(r.printed_gross_total).toBe(61);
    expect(r.packages).toBe(4);
    expect(r.pages_total).toBe(12);
  });

  it('reports NO parse errors on clean input', () => {
    expect(parsePackingListText(SAMPLE).parse_errors).toEqual([]);
  });

  // ── error-reporting paths ──────────────────────────────────────────────
  it('reports an item-like line that fails to parse (e.g. a corrupted row)', () => {
    const bad = SAMPLE.replace('2MC-ARG-PRM-00049100.000PCS40.00041.000', '2MC-ARG-PRM-00049GARBAGE');
    const r = parsePackingListText(bad);
    expect(r.parse_errors.some(e => e.includes('Unparsed item-like line'))).toBe(true);
  });

  it('reports empty input', () => {
    const r = parsePackingListText('');
    expect(r.items).toHaveLength(0);
    expect(r.parse_errors.some(e => e.includes('No line items found'))).toBe(true);
  });

  it('reports missing printed totals', () => {
    const noTotals = SAMPLE.split('\n').filter(l => !/Sub Total|TOTAL PACKING|59\.00061\.000/.test(l)).join('\n');
    const r = parsePackingListText(noTotals);
    expect(r.parse_errors.some(e => e.includes('Printed Sub Total'))).toBe(true);
  });

  it('also parses the SPACED extractor style (browser pdfjs output)', () => {
    const spaced = [
      '1 MC-ARG-PRM-00122 1.000 Piece 19.000 20.000',
      'END BEARING',
      'NPBB:04053/COM/032026 (RSUP-DP)',
      '2 MC-ARG-PRM-00049 100.000 PCS 40.000 41.000',
      'CAGE BARS',
      'NPBB:04053/COM/032026 (RSUP-DP)',
      'Sub Total TOTAL PACKING 59.000 61.000 4 PACKAGES',
      'Page 1/12',
    ].join('\n');
    const r = parsePackingListText(spaced);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ line_no: 1, item_number: 'MC-ARG-PRM-00122', nett_weight: 19, gross_weight: 20 });
    expect(r.printed_nett_total).toBe(59);
    expect(r.parse_errors).toEqual([]);
  });

  it('flags duplicate line numbers', () => {
    const dup = SAMPLE.replace('2MC-ARG-PRM-00049100.000PCS40.00041.000', '1MC-ARG-PRM-00049100.000PCS40.00041.000');
    const r = parsePackingListText(dup);
    expect(r.parse_errors.some(e => e.includes('Duplicate line numbers'))).toBe(true);
  });
});
