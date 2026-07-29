// Deterministic, code-only parser for Pulau Sambu / RSUP packing-list TEXT
// (extracted from the PDF's text layer — see services/pdfText.ts). No AI, no image reading.
//
// This is the reliable "worker" in the code-vs-AI cross-check (services/crossCheck.ts).
// It is a PURE function of a text string, so it is fully unit-testable with no PDF/network.
//
// Design notes:
// - Each item's header row in the extracted text is a single jammed line, e.g.
//     "1MC-ARG-PRM-001221.000Piece19.00020.000"
//   = <line_no><item_number><qty(3dp)><UOM><nett(3dp)><gross(3dp)>
// - Description spans the following line(s); the item ends at its "NPBB:" line.
// - Every reconciliation number carries 3 decimals, which lets us split jammed pairs safely.

export interface ParsedItem {
  line_no: number;
  item_number: string;
  quantity: string;      // kept as printed (e.g. "1.000")
  uom: string;
  nett_weight: number;
  gross_weight: number;
  description: string;
  npbb_ref: string;
}

export interface ParsedPackingList {
  items: ParsedItem[];
  printed_nett_total: number | null;
  printed_gross_total: number | null;
  packages: number | null;
  pages_total: number | null;
  parse_errors: string[]; // error reporting: things that looked wrong while parsing
}

// Strict header: line_no, item code, qty(3dp), UOM(letters), nett(3dp), gross(3dp).
const HEADER = /^(\d{1,3})(MC-ARG-PRM-\d{5})(\d+\.\d{3})([A-Za-z]+)(\d+\.\d{3})(\d+\.\d{3})$/;
// Loose "this looks like an item row" detector, used only for error reporting.
const LOOKS_LIKE_ITEM = /^\d{1,3}MC-ARG-PRM-\d{3,}/;

const toNum = (s: string): number => parseFloat(String(s).replace(/,/g, ''));

// Lines that are page furniture (repeated headers), never item descriptions.
const NOISE = /^(PACKING LIST|Date\b|PL No\b|Customer\b|To :|Ship|Telephone|Contact\b|No$|Item Number$|Item Description$|Quantity\b|Printed By\b|Page \d)/;

export function parsePackingListText(text: string): ParsedPackingList {
  const parse_errors: string[] = [];
  const items: ParsedItem[] = [];
  let cur: ParsedItem | null = null;
  let collectingDesc = false;

  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Match on a whitespace-stripped copy so we handle BOTH extractor styles:
    // jammed ("1MC-ARG-PRM-001221.000Piece19.00020.000") and spaced
    // ("1 MC-ARG-PRM-00122 1.000 Piece 19.000 20.000").
    const compact = line.replace(/\s+/g, '');

    const m = compact.match(HEADER);
    if (m) {
      cur = {
        line_no: parseInt(m[1], 10),
        item_number: m[2],
        quantity: m[3],
        uom: m[4],
        nett_weight: toNum(m[5]),
        gross_weight: toNum(m[6]),
        description: '',
        npbb_ref: '',
      };
      items.push(cur);
      collectingDesc = true;
      continue;
    }

    if (cur && compact.startsWith('NPBB:')) {
      cur.npbb_ref = line;
      collectingDesc = false;
      continue;
    }

    if (LOOKS_LIKE_ITEM.test(compact)) {
      // Looked like an item row but didn't parse cleanly — report it rather than swallow it.
      parse_errors.push(`Unparsed item-like line: "${line.slice(0, 80)}"`);
      continue;
    }

    if (cur && collectingDesc && !NOISE.test(line)) {
      cur.description = (cur.description + ' ' + line).trim();
    }
  }

  // Footer totals
  const totM = text.match(/Sub Total[\s\S]{0,60}?([\d,]+\.\d{3})\s*([\d,]+\.\d{3})/);
  const pkgM = text.match(/(\d+)\s*PACKAGES/);
  const pagesM = [...text.matchAll(/Page \d+\/(\d+)/g)].pop();

  const printed_nett_total = totM ? toNum(totM[1]) : null;
  const printed_gross_total = totM ? toNum(totM[2]) : null;
  const packages = pkgM ? parseInt(pkgM[1], 10) : null;
  const pages_total = pagesM ? parseInt(pagesM[1], 10) : null;

  // Error reporting
  if (items.length === 0) parse_errors.push('No line items found in text.');
  if (printed_nett_total == null) parse_errors.push('Printed Sub Total (nett) not found — cannot totals-check.');
  const lineNos = items.map(i => i.line_no);
  const dupes = lineNos.filter((n, i) => lineNos.indexOf(n) !== i);
  if (dupes.length) parse_errors.push(`Duplicate line numbers parsed: ${[...new Set(dupes)].join(', ')}`);

  return { items, printed_nett_total, printed_gross_total, packages, pages_total, parse_errors };
}
