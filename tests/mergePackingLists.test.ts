import { describe, it, expect } from 'vitest';
import { mergePackingListsByPlNo } from '../services/mergePackingLists';
import type { DocumentData, ExportPermitPSSItem } from '../types';

const pss = (ref: string, items: ExportPermitPSSItem[], totals?: { nett?: number }): DocumentData => ({
  document_type: 'Export Permit Declaration (PSS)',
  metadata: { reference_number: ref, date: '2026-06-16' },
  logistics_details: {}, financials: {}, cargo_details: {},
  export_permit_pss: { items, printed_nett_total: totals?.nett ?? null },
});

describe('mergePackingListsByPlNo', () => {
  it('merges two files of the same PL into one, unioning rows in order', () => {
    const fileA = pss('SO26060535', [
      { line_no: 1, item_description: 'A', nett_weight: '19' },
      { line_no: 2, item_description: 'B', nett_weight: '40' },
    ]);
    const fileB = pss('SO26060535', [
      { line_no: 3, item_description: 'C', nett_weight: '10' },
    ], { nett: 69 });
    const out = mergePackingListsByPlNo([fileA, fileB]).filter(d => d.document_type === 'Export Permit Declaration (PSS)');
    expect(out).toHaveLength(1);
    expect(out[0].export_permit_pss!.items!.map(i => i.line_no)).toEqual([1, 2, 3]);
    expect(out[0].export_permit_pss!.printed_nett_total).toBe(69); // totals from the half that had them
  });

  it('back-fills Country of Origin onto rows that were missing it', () => {
    // file A rows (no origin) + file B rows (CHINA) — the split-file symptom.
    const fileA = pss('SO26060535', [{ line_no: 1, item_description: 'A', product_of_origin: null }]);
    const fileB = pss('SO26060535', [{ line_no: 2, item_description: 'B', product_of_origin: 'CHINA' }]);
    const out = mergePackingListsByPlNo([fileA, fileB])[0];
    expect(out.export_permit_pss!.items!.every(i => i.product_of_origin === 'CHINA')).toBe(true);
  });

  it('strips NPBB references that were mis-placed in the PO Number column', () => {
    const doc = pss('SO26060535', [
      { line_no: 1, po_number: 'NPBB:04053/COM/032026' },
      { line_no: 2, po_number: 'PSV26-04-1060' },
    ]);
    const out = mergePackingListsByPlNo([doc])[0].export_permit_pss!.items!;
    expect(out[0].po_number).toBeNull();          // NPBB stripped
    expect(out[1].po_number).toBe('PSV26-04-1060'); // real PO kept
  });

  it('keeps different PLs separate and leaves non-PSS docs untouched', () => {
    const a = pss('SO26060535', [{ line_no: 1 }]);
    const b = pss('SO26060999', [{ line_no: 1 }]);
    const bl: DocumentData = { document_type: 'Bill of Lading', metadata: { reference_number: 'BL1' }, logistics_details: {}, financials: {}, cargo_details: {} };
    const out = mergePackingListsByPlNo([a, b, bl]);
    expect(out.filter(d => d.document_type === 'Export Permit Declaration (PSS)')).toHaveLength(2);
    expect(out.filter(d => d.document_type === 'Bill of Lading')).toHaveLength(1);
  });

  it('does not double rows if the same file appears twice (retry safety)', () => {
    const f = pss('SO26060535', [{ line_no: 1 }, { line_no: 2 }]);
    const out = mergePackingListsByPlNo([f, JSON.parse(JSON.stringify(f))])[0];
    expect(out.export_permit_pss!.items).toHaveLength(2);
  });
});
