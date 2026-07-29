// Cross-file merge for packing lists (Export Permit Declaration (PSS)).
//
// Problem it solves: a packing list often arrives as TWO separate uploads (e.g. pages 1-8 and
// 9-12). The PO list / Country of Origin / printed totals are only on the LAST page, so the rows
// from the first file come back with no origin and NPBB refs wrongly in the PO column.
//
// This merges PSS documents that share the same PL No (metadata.reference_number) into ONE logical
// packing list, unions their line items, and cleans the shared fields:
//   - back-fills product_of_origin onto every row from whichever half has it,
//   - strips NPBB references that were mis-placed in the po_number column.
// It is PURE and NON-DESTRUCTIVE (returns new objects) — intended for display/export time.

import { DocumentData, ExportPermitPSSItem, ExportPermitPSS } from '../types';

const PSS = 'Export Permit Declaration (PSS)';

const unionItemsByLineNo = (groups: ExportPermitPSSItem[][]): ExportPermitPSSItem[] => {
  const all = groups.flat();
  const allHaveLineNo = all.length > 0 && all.every((i) => typeof i.line_no === 'number');
  if (!allHaveLineNo) return all; // can't key safely — concatenate (files don't overlap)
  const byLine = new Map<number, ExportPermitPSSItem>();
  for (const it of all) byLine.set(it.line_no as number, it); // later-wins per line (no doubling)
  return [...byLine.values()].sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0));
};

// Back-fill origin from any row that has it; drop NPBB refs that landed in the PO column.
const cleanItems = (items: ExportPermitPSSItem[]): ExportPermitPSSItem[] => {
  const origin = items.find((i) => i.product_of_origin && i.product_of_origin.trim())?.product_of_origin ?? null;
  return items.map((i) => ({
    ...i,
    product_of_origin: i.product_of_origin && i.product_of_origin.trim() ? i.product_of_origin : origin,
    po_number: i.po_number && /^NPBB/i.test(i.po_number.trim()) ? null : (i.po_number ?? null),
  }));
};

export function mergePackingListsByPlNo(docs: DocumentData[]): DocumentData[] {
  const pss = docs.filter((d) => d.document_type === PSS);
  if (pss.length === 0) return docs;
  const others = docs.filter((d) => d.document_type !== PSS);

  const groups = new Map<string, DocumentData[]>();
  let anon = 0;
  for (const d of pss) {
    const pl = (d.metadata?.reference_number || '').trim().toUpperCase();
    const key = pl || `__nokey_${anon++}`; // docs with no PL No are never merged together
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const merged: DocumentData[] = [];
  for (const group of groups.values()) {
    const items = cleanItems(unionItemsByLineNo(group.map((d) => d.export_permit_pss?.items ?? [])));
    // Keep the totals from whichever half printed them (the last-page half).
    const withTotals = group.find((d) => d.export_permit_pss?.printed_nett_total != null)?.export_permit_pss;
    const base = group[0];
    const pss: ExportPermitPSS = { ...(withTotals ?? base.export_permit_pss ?? {}), items };
    merged.push({ ...base, export_permit_pss: pss });
  }

  return [...others, ...merged];
}
