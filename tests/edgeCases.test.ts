// Edge-case suite: the "hostile input" tests.
//
// The existing suites check that the happy paths work. These check what happens when
// the input is WRONG — because every field here comes from Claude's JSON, which is
// cast (`as ExtractionResponse`) and never validated at runtime. Anything Claude can
// emit, this code will receive: numbers where strings are declared, nulls, empty
// arrays, duplicated rows from chunk overlap, and truncated output.
//
// Rule for this file: each test states the real-world scenario that produces the input.

import { describe, it, expect } from "vitest";
import {
  verifyPackingList,
  findMissingLineNumbers,
  findDuplicateLineNumbers,
  findMissingPages,
  mergeCapturedItems,
} from "../services/completeness";
import {
  deduplicateDocuments,
  deduplicateByContainer,
  validateDocumentData,
  mergeSameSupplierPVs,
} from "../services/claudeService";
import { mergePackingListsByPlNo } from "../services/mergePackingLists";
import { parsePackingListText } from "../services/packingListParser";

// ---------------------------------------------------------------------------
// 1. The silent-failure class: "Done" when nothing was actually extracted.
// ---------------------------------------------------------------------------
describe("silent failure — empty and near-empty captures", () => {
  it("an EMPTY capture is never complete (reader returned nothing at all)", () => {
    // Scenario: Claude returns {"documents":[]} or an items array of []. Before the
    // guard this scored complete:true with zero issues — a clean pass on no data.
    const report = verifyPackingList({ items: [], printed_totals: {} });
    expect(report.complete).toBe(false);
    expect(report.found_rows).toBe(0);
    expect(report.issues.join(" ")).toMatch(/empty table/i);
  });

  it("an empty capture with NO printed_totals object is also not complete", () => {
    const report = verifyPackingList({ items: [] });
    expect(report.complete).toBe(false);
  });

  it("raises the no-printed-totals warning for an empty {} as well as undefined", () => {
    // A reader that never found a "Sub Total" line returns {}, not undefined.
    const withEmptyObj = verifyPackingList({
      items: [{ line_no: 1, nett_weight: 5 }],
      printed_totals: {},
    });
    expect(withEmptyObj.issues.some((i) => i.includes("No printed totals"))).toBe(true);
  });

  it("a single captured row still verifies normally (not treated as empty)", () => {
    const report = verifyPackingList({
      items: [{ line_no: 1, nett_weight: 10 }],
      printed_totals: { nett: 10 },
    });
    expect(report.complete).toBe(true);
    expect(report.found_rows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Wrong-typed values from Claude (the cast is a lie).
// ---------------------------------------------------------------------------
describe("hostile types — Claude emits numbers where strings are declared", () => {
  const lcr = (extra: Record<string, unknown>) =>
    ({
      document_type: "Logistics Local Charges Report",
      metadata: { reference_number: "R1", date: "2026-01-01" },
      logistics_local_charges: {
        bl_number: "BL123",
        pss_invoice_number: "INV9",
        ...extra,
      },
    }) as never;

  it("does NOT crash when a charge field arrives as a raw number", () => {
    // Scenario: chunk overlap produces two LCR docs with the same BL+invoice, and
    // Claude emitted total_payable_amount: 1234.5 (a number, not "1234.5").
    // This used to throw "v.trim is not a function" and kill the whole extraction.
    const docs = [lcr({ thc_amount: "100" }), lcr({ total_payable_amount: 1234.5 })];
    expect(() => deduplicateDocuments(docs)).not.toThrow();
  });

  it("counts a numeric field as filled, so the richer duplicate still wins", () => {
    const sparse = lcr({});
    const rich = lcr({ thc_amount: 100, seal_fee: 20, bl_fee: 30 });
    const out = deduplicateDocuments([sparse, rich]) as never as Array<{
      logistics_local_charges: Record<string, unknown>;
    }>;
    expect(out).toHaveLength(1);
    expect(out[0].logistics_local_charges.thc_amount).toBe(100);
  });

  it("does not crash when an OPD field arrives as a number", () => {
    const opd = (extra: Record<string, unknown>) =>
      ({
        document_type: "Outward Permit Declaration",
        metadata: { reference_number: "P1", date: "2026-01-01" },
        outward_permit_declaration: {
          container_no: "ABCD1234567",
          factory: "PSG",
          ...extra,
        },
      }) as never;
    expect(() =>
      deduplicateDocuments([opd({}), opd({ total_fob_value: 5000, gst_amount: 0 })])
    ).not.toThrow();
  });

  it("treats a zero-valued numeric field as present, not missing", () => {
    // 0 is falsy — a naive truthiness filter would silently drop a real 0.00 charge.
    const a = lcr({});
    const b = lcr({ seal_fee: 0, bl_fee: 0 });
    const out = deduplicateDocuments([a, b]) as never as Array<{
      logistics_local_charges: Record<string, unknown>;
    }>;
    expect(out).toHaveLength(1);
    expect(out[0].logistics_local_charges.seal_fee).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Chunk-overlap duplication — the same page read twice.
// ---------------------------------------------------------------------------
describe("chunk overlap — the same rows arriving twice", () => {
  it("merging overlapping chunks never doubles a line", () => {
    const chunkA = [1, 2, 3, 4, 5].map((n) => ({ line_no: n, nett_weight: n }));
    const chunkB = [4, 5, 6, 7].map((n) => ({ line_no: n, nett_weight: n }));
    const merged = mergeCapturedItems([chunkA, chunkB]);
    expect(merged).toHaveLength(7);
    expect(findDuplicateLineNumbers(merged)).toEqual([]);
  });

  it("re-running the SAME chunk twice is idempotent (retry safety)", () => {
    const chunk = [1, 2, 3].map((n) => ({ line_no: n, nett_weight: n }));
    expect(mergeCapturedItems([chunk, chunk])).toHaveLength(3);
  });

  it("flags duplicates when they survive into a single capture", () => {
    const report = verifyPackingList({
      items: [
        { line_no: 1, nett_weight: 5 },
        { line_no: 1, nett_weight: 5 },
        { line_no: 2, nett_weight: 5 },
      ],
      printed_totals: { nett: 10 },
    });
    expect(report.duplicate_line_numbers).toEqual([1]);
    expect(report.issues.some((i) => i.includes("Duplicate"))).toBe(true);
  });

  it("a duplicated row inflates the weight sum and is caught by the total", () => {
    // The self-check's real value: even if numbering looks fine, the printed
    // Sub Total disagrees, so the double-count cannot pass silently.
    const report = verifyPackingList({
      items: [
        { line_no: 1, nett_weight: 10 },
        { line_no: 2, nett_weight: 10 },
        { line_no: 2, nett_weight: 10 },
      ],
      printed_totals: { nett: 20 },
    });
    expect(report.complete).toBe(false);
    expect(report.nett_matches_printed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Dropped / missing data — the core thing the brain must never miss.
// ---------------------------------------------------------------------------
describe("dropped rows and pages", () => {
  it("catches a gap in the middle", () => {
    expect(findMissingLineNumbers([1, 2, 5].map((n) => ({ line_no: n })))).toEqual([3, 4]);
  });

  it("catches rows dropped off the END when the true count is known", () => {
    // Numbering alone cannot see this — 1..3 looks contiguous. expectedMax pins it.
    expect(findMissingLineNumbers([1, 2, 3].map((n) => ({ line_no: n })), 5)).toEqual([4, 5]);
  });

  it("reports every page when the reader returned none", () => {
    expect(findMissingPages({ items: [], pages_total: 3, pages_seen: [] })).toEqual([1, 2, 3]);
  });

  it("returns no missing pages when pages_total is unknown (cannot assert)", () => {
    expect(findMissingPages({ items: [], pages_seen: [1] })).toEqual([]);
  });

  it("a missing page fails the check even if the rows present look contiguous", () => {
    const report = verifyPackingList({
      items: [
        { line_no: 1, nett_weight: 5 },
        { line_no: 2, nett_weight: 5 },
      ],
      pages_total: 2,
      pages_seen: [1],
      printed_totals: { nett: 10 },
    });
    expect(report.complete).toBe(false);
    expect(report.missing_pages).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// 5. Numeric edge cases in the weight reconciliation.
// ---------------------------------------------------------------------------
describe("weight reconciliation edge cases", () => {
  it("tolerates 3-decimal float drift", () => {
    const report = verifyPackingList({
      items: [
        { line_no: 1, nett_weight: 0.1 },
        { line_no: 2, nett_weight: 0.2 },
      ],
      printed_totals: { nett: 0.3 }, // 0.1 + 0.2 = 0.30000000000000004 in floating point
    });
    expect(report.nett_matches_printed).toBe(true);
  });

  it("treats a null weight as zero rather than NaN-ing the whole sum", () => {
    const report = verifyPackingList({
      items: [
        { line_no: 1, nett_weight: 10 },
        { line_no: 2, nett_weight: null },
      ],
      printed_totals: { nett: 10 },
    });
    expect(Number.isNaN(report.nett_sum)).toBe(false);
    expect(report.nett_sum).toBe(10);
  });

  it("catches a decimal-point misread (1234.5 read as 12345)", () => {
    const report = verifyPackingList({
      items: [{ line_no: 1, nett_weight: 12345 }],
      printed_totals: { nett: 1234.5 },
    });
    expect(report.complete).toBe(false);
    expect(report.issues.some((i) => i.includes("off by"))).toBe(true);
  });

  it("a printed total of 0 is still compared, not skipped as falsy", () => {
    const report = verifyPackingList({
      items: [{ line_no: 1, nett_weight: 5 }],
      printed_totals: { nett: 0 },
    });
    expect(report.nett_matches_printed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Validation and merge behaviour on malformed documents.
// ---------------------------------------------------------------------------
describe("validation on malformed documents", () => {
  it("does not crash on an empty document list", () => {
    expect(validateDocumentData([])).toEqual([]);
    expect(deduplicateDocuments([])).toEqual([]);
    expect(deduplicateByContainer([])).toEqual([]);
    expect(mergeSameSupplierPVs([])).toEqual([]);
    expect(mergePackingListsByPlNo([])).toEqual([]);
  });

  it("does not crash when a document has no sub-object at all", () => {
    const naked = [{ document_type: "Logistics Local Charges Report" }] as never;
    expect(() => deduplicateDocuments(naked)).not.toThrow();
    expect(() => deduplicateByContainer(naked)).not.toThrow();
  });

  it("keeps two DIFFERENT packing lists separate even under merge", () => {
    const pss = (ref: string) =>
      ({
        document_type: "Export Permit Declaration (PSS)",
        metadata: { reference_number: ref, date: "2026-01-01" },
        export_permit_pss: { items: [{ line_no: 1, hs_code: "1234" }] },
      }) as never;
    expect(mergePackingListsByPlNo([pss("PL-1"), pss("PL-2")])).toHaveLength(2);
  });

  it("flags a bad date format instead of accepting it", () => {
    const bad = [
      {
        document_type: "Bill of Lading",
        metadata: { reference_number: "BL1", date: "31/12/2026" },
      },
    ] as never;
    expect(validateDocumentData(bad).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Text parser on damaged input.
// ---------------------------------------------------------------------------
describe("packing-list text parser on damaged input", () => {
  it("reports empty input rather than returning a confident empty result", () => {
    const parsed = parsePackingListText("");
    expect(parsed.items).toHaveLength(0);
    expect(parsed.parse_errors.length).toBeGreaterThan(0);
  });

  it("does not crash on pure garbage (a scanned page with no text layer)", () => {
    expect(() => parsePackingListText("\u0000\u0001 ??? ###")).not.toThrow();
  });

  it("does not crash on very long single-line input", () => {
    expect(() => parsePackingListText("A".repeat(100_000))).not.toThrow();
  });
});
