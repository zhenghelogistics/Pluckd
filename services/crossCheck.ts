// Cross-check layer: compare the deterministic CODE reading against the AI reading of the
// same document, row by row. Agreement = high confidence; disagreement = a pinpointed,
// actionable error report ("row 45, nett: code=30.5 AI=80.5") instead of a vague warning.
//
// Pure function — no I/O — so it is fully unit-testable.

export interface CrossCheckRow {
  line_no: number;
  item_number?: string | null;
  quantity?: string | null;
  uom?: string | null;
  nett_weight?: number | null;
  gross_weight?: number | null;
}

export interface Disagreement {
  line_no: number;
  field: string;
  code: string | number | null | undefined;
  ai: string | number | null | undefined;
}

export interface CrossCheckReport {
  matched: number;              // rows present on both sides that agree on every compared field
  disagreements: Disagreement[]; // field-level differences, pinpointed
  missing_in_ai: number[];      // line numbers the code found but the AI did not (AI dropped them)
  missing_in_code: number[];    // line numbers the AI found but the code did not
  total_issues: number;
  ok: boolean;                  // true only when there are zero issues
  report_lines: string[];       // human-readable error report, ready to show/log
}

const DEFAULT_FIELDS: (keyof CrossCheckRow)[] = ['item_number', 'quantity', 'uom', 'nett_weight', 'gross_weight'];

// Normalise so "30.5" === 30.5 and trimming/case don't cause false disagreements.
const norm = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return String(v).trim().toUpperCase();
};

export function crossCheck(
  codeRows: CrossCheckRow[],
  aiRows: CrossCheckRow[],
  fields: (keyof CrossCheckRow)[] = DEFAULT_FIELDS
): CrossCheckReport {
  const codeBy = new Map<number, CrossCheckRow>();
  const aiBy = new Map<number, CrossCheckRow>();
  for (const r of codeRows) codeBy.set(r.line_no, r);
  for (const r of aiRows) aiBy.set(r.line_no, r);

  const allNos = [...new Set([...codeBy.keys(), ...aiBy.keys()])].sort((a, b) => a - b);

  const disagreements: Disagreement[] = [];
  const missing_in_ai: number[] = [];
  const missing_in_code: number[] = [];
  let matched = 0;

  for (const n of allNos) {
    const c = codeBy.get(n);
    const a = aiBy.get(n);
    if (c && !a) { missing_in_ai.push(n); continue; }
    if (a && !c) { missing_in_code.push(n); continue; }
    if (!c || !a) continue;

    let rowHadDiff = false;
    for (const f of fields) {
      // Skip a field only when BOTH sides are empty for it.
      if (norm(c[f]) === '' && norm(a[f]) === '') continue;
      if (norm(c[f]) !== norm(a[f])) {
        disagreements.push({ line_no: n, field: String(f), code: c[f] as any, ai: a[f] as any });
        rowHadDiff = true;
      }
    }
    if (!rowHadDiff) matched++;
  }

  const total_issues = disagreements.length + missing_in_ai.length + missing_in_code.length;

  const report_lines: string[] = [];
  report_lines.push(`${matched} row(s) matched exactly.`);
  for (const n of missing_in_ai) report_lines.push(`Row ${n}: MISSING in AI reading (code found it).`);
  for (const n of missing_in_code) report_lines.push(`Row ${n}: MISSING in code reading (AI found it).`);
  for (const d of disagreements) report_lines.push(`Row ${d.line_no}: ${d.field} — code=${d.code} AI=${d.ai}`);

  return {
    matched,
    disagreements,
    missing_in_ai,
    missing_in_code,
    total_issues,
    ok: total_issues === 0,
    report_lines,
  };
}
