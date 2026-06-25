// The "brain": deterministic completeness checks for packing-list extractions.
//
// Core idea (see docs/extraction-plan.md, "Move 4"): a packing list carries its own
// answer key inside it, so we never need a fixed expected output. We verify that an
// extraction agrees with the document itself:
//   1. Row numbers are contiguous 1..N (a gap = a dropped row).
//   2. All pages are present (footer "Page x/N").
//   3. Captured line weights sum to the document's own printed Sub Total.
//
// These rules are identical for every packing list; only the values differ.
// Pure functions only — no API calls, no I/O — so they are trivially unit-testable.

export interface PackingListItem {
  line_no: number;
  item_number?: string | null;
  quantity?: string | null;
  uom?: string | null;
  nett_weight?: number | null;
  gross_weight?: number | null;
  description?: string | null;
  npbb_ref?: string | null;
}

export interface PrintedTotals {
  nett?: number | null;     // "Sub Total" nett weight printed on the document
  gross?: number | null;    // "Sub Total" gross weight printed on the document
  packages?: number | null; // "TOTAL PACKING ... N PACKAGES"
}

export interface PackingListCapture {
  pl_no?: string | null;
  pages_total?: number | null;   // N from "Page x/N"
  pages_seen?: number[];         // distinct page numbers the reader actually returned
  items: PackingListItem[];
  printed_totals?: PrintedTotals;
}

export interface CompletenessReport {
  complete: boolean;
  expected_rows: number;          // highest line_no we believe should exist
  found_rows: number;             // distinct line numbers actually captured
  missing_line_numbers: number[]; // gaps to re-fetch
  duplicate_line_numbers: number[];
  missing_pages: number[];
  nett_sum: number;
  gross_sum: number;
  nett_matches_printed: boolean | null;  // null when no printed total to compare
  gross_matches_printed: boolean | null;
  issues: string[];               // human-readable reasons it failed
}

// Default weight tolerance: packing lists carry 3 decimals; allow tiny float drift.
const DEFAULT_WEIGHT_TOLERANCE = 0.01;

const distinct = (xs: number[]): number[] => Array.from(new Set(xs)).sort((a, b) => a - b);

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Gaps in the sequence 1..max(line_no). If expectedMax is given, check up to it instead. */
export function findMissingLineNumbers(items: PackingListItem[], expectedMax?: number): number[] {
  const present = new Set(items.map((i) => i.line_no).filter((n) => Number.isFinite(n)));
  const max = expectedMax ?? (present.size ? Math.max(...present) : 0);
  const missing: number[] = [];
  for (let n = 1; n <= max; n++) if (!present.has(n)) missing.push(n);
  return missing;
}

/** Line numbers that appear more than once (overlap from chunking, or a genuine repeat). */
export function findDuplicateLineNumbers(items: PackingListItem[]): number[] {
  const counts = new Map<number, number>();
  for (const i of items) counts.set(i.line_no, (counts.get(i.line_no) ?? 0) + 1);
  return distinct([...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n));
}

/** Pages 1..pages_total that the reader never returned. */
export function findMissingPages(capture: PackingListCapture): number[] {
  const total = capture.pages_total ?? 0;
  if (!total) return [];
  const seen = new Set(capture.pages_seen ?? []);
  const missing: number[] = [];
  for (let p = 1; p <= total; p++) if (!seen.has(p)) missing.push(p);
  return missing;
}

const sum = (items: PackingListItem[], key: "nett_weight" | "gross_weight"): number =>
  round3(items.reduce((acc, i) => acc + (typeof i[key] === "number" ? (i[key] as number) : 0), 0));

/**
 * Verify an extraction against the document's own internal evidence.
 * `expectedMax` lets callers pin the row count from a trustworthy source (e.g. an
 * OCR pass over just the "No." column); omit it to infer from the highest line_no.
 */
export function verifyPackingList(
  capture: PackingListCapture,
  opts: { weightTolerance?: number; expectedMax?: number } = {}
): CompletenessReport {
  const tol = opts.weightTolerance ?? DEFAULT_WEIGHT_TOLERANCE;
  const items = capture.items ?? [];

  const missing = findMissingLineNumbers(items, opts.expectedMax);
  const duplicates = findDuplicateLineNumbers(items);
  const missingPages = findMissingPages(capture);

  const foundRows = distinct(items.map((i) => i.line_no)).length;
  const expectedRows = opts.expectedMax ?? (items.length ? Math.max(...items.map((i) => i.line_no)) : 0);

  const nettSum = sum(items, "nett_weight");
  const grossSum = sum(items, "gross_weight");

  const printed = capture.printed_totals ?? {};
  const nettMatches = typeof printed.nett === "number" ? Math.abs(nettSum - printed.nett) <= tol : null;
  const grossMatches = typeof printed.gross === "number" ? Math.abs(grossSum - printed.gross) <= tol : null;

  const issues: string[] = [];
  if (missing.length) issues.push(`Missing line numbers: ${missing.join(", ")}`);
  if (duplicates.length) issues.push(`Duplicate line numbers: ${duplicates.join(", ")}`);
  if (missingPages.length) issues.push(`Missing pages: ${missingPages.join(", ")}`);
  if (nettMatches === false)
    issues.push(`Nett weight sum ${nettSum} != printed Sub Total ${printed.nett} (off by ${round3(nettSum - (printed.nett as number))})`);
  if (grossMatches === false)
    issues.push(`Gross weight sum ${grossSum} != printed Sub Total ${printed.gross} (off by ${round3(grossSum - (printed.gross as number))})`);
  if (nettMatches === null && grossMatches === null && !capture.printed_totals)
    issues.push("No printed totals captured — cannot run the sum self-check (weakest verification).");

  const complete =
    missing.length === 0 &&
    missingPages.length === 0 &&
    nettMatches !== false &&
    grossMatches !== false;

  return {
    complete,
    expected_rows: expectedRows,
    found_rows: foundRows,
    missing_line_numbers: missing,
    duplicate_line_numbers: duplicates,
    missing_pages: missingPages,
    nett_sum: nettSum,
    gross_sum: grossSum,
    nett_matches_printed: nettMatches,
    gross_matches_printed: grossMatches,
    issues,
  };
}

/**
 * Merge items captured across parallel chunks into one ordered list.
 * Later occurrences win (a targeted re-fetch should overwrite an earlier bad/missing read).
 */
export function mergeCapturedItems(chunks: PackingListItem[][]): PackingListItem[] {
  const byLine = new Map<number, PackingListItem>();
  for (const chunk of chunks) for (const item of chunk) byLine.set(item.line_no, item);
  return [...byLine.values()].sort((a, b) => a.line_no - b.line_no);
}
