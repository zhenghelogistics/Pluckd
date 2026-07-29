import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock external dependencies so the service module can be imported without
// a real Anthropic key or pdf-lib browser APIs.
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
vi.mock('pdf-lib', () => ({ PDFDocument: { load: vi.fn() } }));
vi.mock('jsonrepair', () => ({ jsonrepair: (s: string) => s }));

beforeAll(() => {
  (import.meta as any).env = {};
});

import {
  validateDocumentData,
  mergeSameSupplierPVs,
  deduplicateByContainer,
  deduplicateDocuments,
} from '../services/claudeService';
import type { DocumentData } from '../types';

// Build a PSS (packing-list) doc with the given line items.
const makePss = (ref: string, items: { line_no: number; nett_weight: string }[]): DocumentData => ({
  document_type: 'Export Permit Declaration (PSS)',
  metadata: { reference_number: ref, date: '2026-06-16' },
  logistics_details: {},
  financials: {},
  cargo_details: {},
  export_permit_pss: { items: items.map((i) => ({ line_no: i.line_no, nett_weight: i.nett_weight })) },
});

// ─── Helpers ───────────────────────────────────────────────────────────────

const makeDoc = (overrides: Partial<DocumentData> = {}): DocumentData => ({
  document_type: 'Bill of Lading',
  metadata: { reference_number: 'BL-001', date: '2025-01-01' },
  logistics_details: {},
  financials: {},
  cargo_details: {},
  ...overrides,
});

const makePV = (paymentTo: string, invoiceNo: string, amount: string): DocumentData => ({
  document_type: 'Payment Voucher/GL',
  metadata: { reference_number: invoiceNo, date: '2025-01-01' },
  logistics_details: {},
  financials: {},
  cargo_details: {},
  payment_voucher_details: {
    payment_to: paymentTo,
    carrier_invoice_number: invoiceNo,
    payable_amount: amount,
    total_payable_amount: amount,
    pss_invoice_number: null,
    bl_number: null,
    charges_summary: 'THC',
    bl_entries: [],
  },
});

const makeAllied = (containerNo: string, dhcIn?: string): DocumentData => ({
  document_type: 'Allied Report',
  metadata: { reference_number: containerNo, date: '2025-01-01' },
  logistics_details: {},
  financials: {},
  cargo_details: {},
  allied_report: {
    container_booking_no: containerNo,
    dhc_in: dhcIn ?? null,
    dhc_out: null,
    dhe_in: null,
    dhe_out: null,
    data_admin_fee: null,
    washing: null,
    repair: null,
    detention: null,
    demurrage: null,
  },
});

// ─── validateDocumentData ──────────────────────────────────────────────────

describe('validateDocumentData', () => {
  it('returns no errors for a valid document', () => {
    const errors = validateDocumentData([makeDoc()]);
    expect(errors).toHaveLength(0);
  });

  it('flags missing document_type', () => {
    const doc = makeDoc({ document_type: '' });
    const errors = validateDocumentData([doc]);
    expect(errors.some(e => e.includes('document_type'))).toBe(true);
  });

  it('flags missing reference_number for types that require it', () => {
    const doc = makeDoc({
      document_type: 'Commercial Invoice',
      metadata: { reference_number: '', date: '2025-01-01' },
    });
    const errors = validateDocumentData([doc]);
    expect(errors.some(e => e.includes('metadata.reference_number'))).toBe(true);
  });

  it('does NOT flag missing reference_number for Logistics Local Charges Report', () => {
    const doc = makeDoc({
      document_type: 'Logistics Local Charges Report',
      metadata: { reference_number: '', date: '2025-01-01' },
    });
    const errors = validateDocumentData([doc]);
    expect(errors.some(e => e.includes('metadata.reference_number'))).toBe(false);
  });

  it('flags an invalid date format', () => {
    const doc = makeDoc({ metadata: { reference_number: 'X', date: '01/01/2025' } });
    const errors = validateDocumentData([doc]);
    expect(errors.some(e => e.includes('Invalid date format'))).toBe(true);
  });

  it('accepts a valid YYYY-MM-DD date', () => {
    const doc = makeDoc({ metadata: { reference_number: 'X', date: '2025-12-31' } });
    const errors = validateDocumentData([doc]);
    expect(errors.filter(e => e.includes('date'))).toHaveLength(0);
  });
});

// ─── mergeSameSupplierPVs ──────────────────────────────────────────────────

describe('mergeSameSupplierPVs', () => {
  it('leaves a single PV unchanged', () => {
    const pv = makePV('MSC', 'INV-001', '100.00 SGD');
    const result = mergeSameSupplierPVs([pv]);
    expect(result).toHaveLength(1);
    expect(result[0].payment_voucher_details?.carrier_invoice_number).toBe('INV-001');
  });

  it('merges two PVs from the same supplier into one', () => {
    const pv1 = makePV('MSC', 'INV-001', '100.00 SGD');
    const pv2 = makePV('MSC', 'INV-002', '200.00 SGD');
    const result = mergeSameSupplierPVs([pv1, pv2]);
    expect(result.filter(d => d.document_type === 'Payment Voucher/GL')).toHaveLength(1);
    const merged = result[0].payment_voucher_details!;
    expect(merged.carrier_invoice_number).toContain('INV-001');
    expect(merged.carrier_invoice_number).toContain('INV-002');
  });

  it('keeps PVs from different suppliers separate', () => {
    const pv1 = makePV('MSC', 'INV-001', '100.00 SGD');
    const pv2 = makePV('ONE', 'INV-002', '200.00 SGD');
    const result = mergeSameSupplierPVs([pv1, pv2]);
    expect(result.filter(d => d.document_type === 'Payment Voucher/GL')).toHaveLength(2);
  });

  it('does not touch non-PV documents', () => {
    const bl = makeDoc({ document_type: 'Bill of Lading' });
    const pv = makePV('MSC', 'INV-001', '100.00 SGD');
    const result = mergeSameSupplierPVs([bl, pv]);
    expect(result).toHaveLength(2);
    expect(result.some(d => d.document_type === 'Bill of Lading')).toBe(true);
  });

  it('is case-insensitive when matching supplier names', () => {
    const pv1 = makePV('msc', 'INV-001', '100.00 SGD');
    const pv2 = makePV('MSC', 'INV-002', '200.00 SGD');
    const result = mergeSameSupplierPVs([pv1, pv2]);
    expect(result.filter(d => d.document_type === 'Payment Voucher/GL')).toHaveLength(1);
  });
});

// ─── deduplicateByContainer ────────────────────────────────────────────────

describe('deduplicateByContainer', () => {
  it('returns non-Allied/CDAS docs untouched', () => {
    const bl = makeDoc({ document_type: 'Bill of Lading' });
    const result = deduplicateByContainer([bl]);
    expect(result).toHaveLength(1);
    expect(result[0].document_type).toBe('Bill of Lading');
  });

  it('deduplicates Allied Reports with the same container number', () => {
    const a1 = makeAllied('TCKU1234567', '50.00');
    const a2 = makeAllied('TCKU1234567', '50.00');
    const result = deduplicateByContainer([a1, a2]);
    const allied = result.filter(d => d.document_type === 'Allied Report');
    expect(allied).toHaveLength(1);
  });

  it('keeps Allied Reports with different container numbers separate', () => {
    const a1 = makeAllied('TCKU1234567');
    const a2 = makeAllied('MSCU9876543');
    const result = deduplicateByContainer([a1, a2]);
    const allied = result.filter(d => d.document_type === 'Allied Report');
    expect(allied).toHaveLength(2);
  });

  it('does NOT mix up container data between different companies', () => {
    // This is the critical regression guard mentioned in the brief
    const a1 = makeAllied('AAAU0000001', '100.00');
    const a2 = makeAllied('BBBU9999999', '999.00');
    const result = deduplicateByContainer([a1, a2]);
    const byContainer = Object.fromEntries(
      result
        .filter(d => d.document_type === 'Allied Report')
        .map(d => [d.allied_report!.container_booking_no!, d.allied_report!.dhc_in])
    );
    expect(byContainer['AAAU0000001']).toBe('100.00');
    expect(byContainer['BBBU9999999']).toBe('999.00');
  });
});

// ─── deduplicateDocuments: PSS same-reference stitch (fixes the "file vanishes" bug) ──

describe('deduplicateDocuments — PSS stitch instead of drop', () => {
  it('STITCHES two files of the same packing list instead of dropping one', () => {
    const fileA = makePss('SO26060535', [
      { line_no: 1, nett_weight: '19' }, { line_no: 2, nett_weight: '40' }, { line_no: 3, nett_weight: '10' },
    ]);
    const fileB = makePss('SO26060535', [
      { line_no: 4, nett_weight: '39' }, { line_no: 5, nett_weight: '41' },
    ]);
    const out = deduplicateDocuments([fileA, fileB]).filter(d => d.document_type === 'Export Permit Declaration (PSS)');
    expect(out).toHaveLength(1);
    expect(out[0].export_permit_pss!.items!.map(i => i.line_no)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does NOT double rows when the same file is merged twice (retry safety)', () => {
    const f = makePss('SO26060535', [{ line_no: 1, nett_weight: '19' }, { line_no: 2, nett_weight: '40' }]);
    const out = deduplicateDocuments([f, JSON.parse(JSON.stringify(f))]).filter(d => d.document_type === 'Export Permit Declaration (PSS)');
    expect(out).toHaveLength(1);
    expect(out[0].export_permit_pss!.items).toHaveLength(2);
  });

  it('keeps different packing lists (different reference) separate', () => {
    const a = makePss('SO26060535', [{ line_no: 1, nett_weight: '19' }]);
    const b = makePss('SO26060999', [{ line_no: 1, nett_weight: '5' }]);
    expect(deduplicateDocuments([a, b]).filter(d => d.document_type === 'Export Permit Declaration (PSS)')).toHaveLength(2);
  });
});
