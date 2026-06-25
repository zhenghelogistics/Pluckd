import { describe, it, expect } from "vitest";
import {
  verifyPackingList,
  mergeCapturedItems,
  findMissingLineNumbers,
  type PackingListCapture,
  type PackingListItem,
} from "../services/completeness";
import fixture from "./fixtures/SO26060535/expected.json";

// The fixture is a faithfully-transcribed capture of SO26060535 (all 78 rows).
// Its only job is to prove the verification CODE works — it is NOT a production
// answer key (real documents are graded by these same self-checks, no fixture needed).
const fullCapture = (): PackingListCapture => ({
  pl_no: fixture.pl_no,
  pages_total: fixture.pages_total,
  pages_seen: [...fixture.pages_seen],
  printed_totals: { ...fixture.printed_totals },
  items: fixture.items.map((i) => ({ ...i })) as PackingListItem[],
});

describe("packing-list self-check (the 'brain')", () => {
  it("passes a complete, correct capture and matches the document's own printed totals", () => {
    const report = verifyPackingList(fullCapture());
    expect(report.complete).toBe(true);
    expect(report.found_rows).toBe(78);
    expect(report.missing_line_numbers).toEqual([]);
    // The document prints Sub Total 1,758.000 / 1,938.000 — our sums must equal them.
    expect(report.nett_sum).toBe(1758);
    expect(report.gross_sum).toBe(1938);
    expect(report.nett_matches_printed).toBe(true);
    expect(report.gross_matches_printed).toBe(true);
  });

  it("catches DROPPED rows (the 'lazy reader' giving up mid-table)", () => {
    const cap = fullCapture();
    // Simulate the reader skipping rows 56–62.
    cap.items = cap.items.filter((i) => i.line_no < 56 || i.line_no > 62);

    const report = verifyPackingList(cap);
    expect(report.complete).toBe(false);
    expect(report.missing_line_numbers).toEqual([56, 57, 58, 59, 60, 61, 62]);
    // And the totals no longer add up, an independent confirmation something is missing.
    expect(report.nett_matches_printed).toBe(false);
  });

  it("catches a trailing row dropped at the very end (numbering alone wouldn't notice)", () => {
    const cap = fullCapture();
    cap.items = cap.items.filter((i) => i.line_no !== 78); // drop the last row
    const report = verifyPackingList(cap, { expectedMax: 78 });
    expect(report.missing_line_numbers).toEqual([78]);
    // Even if we DIDN'T know it should be 78, the totals catch it:
    const reportNoHint = verifyPackingList({ ...cap });
    expect(reportNoHint.nett_matches_printed).toBe(false);
    expect(reportNoHint.complete).toBe(false);
  });

  it("catches a MISREAD number even when no rows are missing (the Road-B trigger)", () => {
    const cap = fullCapture();
    // Row 77 nett 30.2 misread as 80.2 (blurry scan): all rows present, but sum is wrong.
    const row = cap.items.find((i) => i.line_no === 77)!;
    row.nett_weight = 80.2;

    const report = verifyPackingList(cap);
    expect(report.missing_line_numbers).toEqual([]); // nothing dropped
    expect(report.nett_matches_printed).toBe(false); // but the math betrays the misread
    expect(report.complete).toBe(false);
  });

  it("merges overlapping chunks and de-duplicates by line number", () => {
    const cap = fullCapture();
    const chunkA = cap.items.filter((i) => i.line_no <= 40);
    const chunkB = cap.items.filter((i) => i.line_no >= 39); // overlaps 39,40
    const merged = mergeCapturedItems([chunkA, chunkB]);
    expect(merged.length).toBe(78);
    expect(findMissingLineNumbers(merged)).toEqual([]);
  });

  it("flags when no printed totals are available (weakest verification)", () => {
    const cap = fullCapture();
    cap.printed_totals = undefined;
    const report = verifyPackingList(cap);
    expect(report.nett_matches_printed).toBeNull();
    expect(report.issues.some((m) => m.includes("No printed totals"))).toBe(true);
  });
});
