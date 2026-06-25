/**
 * Live spike: the "brain" wired to the existing Claude integration.
 *
 * Proves the four moves end-to-end on a REAL packing-list PDF:
 *   Move 1 (faithful capture) — ask Claude to transcribe everything, not a field list.
 *   Move 3 (read in strips)   — slice the PDF into small page chunks, read in parallel.
 *   Move 4 (self-check)       — verify row numbering + page count + totals; re-fetch gaps.
 *
 * It does NOT touch the app, the database, or Supabase. It just reads PDFs and prints a verdict.
 *
 * Run:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npx tsx scripts/packingListSpike.ts "PL - SO26060535 - 1-8.pdf" "PL - SO26060535 - 9-12.pdf"
 *
 * Pass one PDF, or several that belong to the same packing list (they get stitched in order).
 */
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { jsonrepair } from "jsonrepair";
import { readFile } from "node:fs/promises";
import {
  verifyPackingList,
  mergeCapturedItems,
  type PackingListItem,
  type PrintedTotals,
} from "../services/completeness";

const MODEL = "claude-sonnet-4-6";
const CHUNK_PAGES = 4;     // small strips => fast, no 5-min timeout, no token cut-off
const CONCURRENCY = 3;     // parallel chunk reads
const MAX_REFETCH = 2;     // how many times we go back for missing rows before giving up

const CAPTURE_PROMPT = `You are transcribing a shipping PACKING LIST exactly as printed.
Copy EVERY numbered line item you can see. Do not skip, summarise, merge, or stop early.
Return ONLY valid JSON (no markdown, no commentary) in EXACTLY this shape:
{
  "pl_no": string|null,
  "page_total": number|null,
  "printed_totals": { "nett": number|null, "gross": number|null, "packages": number|null },
  "items": [
    { "line_no": number, "item_number": string|null, "quantity": string|null, "uom": string|null,
      "nett_weight": number|null, "gross_weight": number|null, "description": string|null, "npbb_ref": string|null }
  ]
}
Rules:
- line_no is the integer in the "No" column.
- weights are numbers (e.g. 19.000 -> 19, 30.200 -> 30.2).
- join a multi-line item description into ONE line with single spaces.
- npbb_ref is the full "NPBB:..." text for that item.
- page_total is the Y in the "Page X/Y" footer.
- printed_totals ONLY from a "Sub Total" / "TOTAL PACKING" block if it appears in THESE pages, else null.
- if a value is absent, use null. Never invent values.`;

interface ChunkCapture {
  pl_no?: string | null;
  page_total?: number | null;
  printed_totals?: PrintedTotals;
  items: PackingListItem[];
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Split one PDF (as bytes) into base64 chunks of CHUNK_PAGES pages each. */
async function chunkPdf(bytes: Uint8Array): Promise<string[]> {
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const chunks: string[] = [];
  for (let start = 0; start < total; start += CHUNK_PAGES) {
    const out = await PDFDocument.create();
    const idxs = Array.from({ length: Math.min(CHUNK_PAGES, total - start) }, (_, k) => start + k);
    const pages = await out.copyPages(src, idxs);
    pages.forEach((p) => out.addPage(p));
    const b64 = Buffer.from(await out.save()).toString("base64");
    chunks.push(b64);
  }
  return chunks;
}

function parseJson(text: string): ChunkCapture {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const obj = JSON.parse(jsonrepair(cleaned));
  return { ...obj, items: Array.isArray(obj.items) ? obj.items : [] };
}

async function readChunk(base64: string, extraInstruction = ""): Promise<ChunkCapture> {
  let text = "";
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0,
    system: [{ type: "text", text: CAPTURE_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: extraInstruction || "Transcribe this chunk now. JSON only." },
        ],
      },
    ],
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") text += ev.delta.text;
  }
  return parseJson(text);
}

/** Run async tasks with a small concurrency cap. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

async function main() {
  const files = process.argv.slice(2);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("✗ Set ANTHROPIC_API_KEY first:  export ANTHROPIC_API_KEY=sk-ant-...");
    process.exit(1);
  }
  if (files.length === 0) {
    console.error('✗ Usage: npx tsx scripts/packingListSpike.ts "file1.pdf" ["file2.pdf" ...]');
    process.exit(1);
  }

  // Move 3: slice every file into strips, in file order (this stitches split PDFs).
  const allChunks: string[] = [];
  for (const f of files) allChunks.push(...(await chunkPdf(await readFile(f))));
  console.log(`→ ${files.length} file(s), ${allChunks.length} chunk(s) of up to ${CHUNK_PAGES} pages, reading ${CONCURRENCY} at a time…`);

  const t0 = Date.now();
  const captures = await pool(allChunks, CONCURRENCY, async (c, i) => {
    const cap = await readChunk(c);
    console.log(`  • chunk ${i + 1}/${allChunks.length}: ${cap.items.length} rows`);
    return cap;
  });

  // Merge everything and pull the header/totals from whichever chunk saw them.
  let items = mergeCapturedItems(captures.map((c) => c.items));
  const printed_totals =
    captures.map((c) => c.printed_totals).find((t) => t && (t.nett != null || t.gross != null)) ?? {};
  const pages_total = captures.map((c) => c.page_total).find((n) => typeof n === "number") ?? null;
  const pl_no = captures.map((c) => c.pl_no).find(Boolean) ?? null;

  // Move 4: self-check. Expected row count = the highest line number anyone saw.
  let expectedMax = items.length ? Math.max(...items.map((i) => i.line_no)) : 0;
  let report = verifyPackingList(
    { pl_no, pages_total, pages_seen: Array.from({ length: allChunks.length * CHUNK_PAGES }, (_, k) => k + 1), printed_totals, items },
    { expectedMax }
  );

  // Re-fetch only the missing rows, up to MAX_REFETCH times.
  for (let attempt = 1; report.missing_line_numbers.length && attempt <= MAX_REFETCH; attempt++) {
    const want = report.missing_line_numbers;
    console.log(`↻ refetch ${attempt}: asking again for rows ${want.join(", ")}`);
    const patches = await pool(allChunks, CONCURRENCY, (c) =>
      readChunk(c, `Return JSON ONLY for these line numbers if present on these pages: ${want.join(", ")}. Same shape as instructed.`)
    );
    items = mergeCapturedItems([items, ...patches.map((p) => p.items)]);
    report = verifyPackingList({ pl_no, pages_total, pages_seen: report.missing_pages.length ? [] : undefined, printed_totals, items }, { expectedMax });
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n──────── VERDICT ────────");
  console.log(`PL No:            ${pl_no ?? "(none)"}`);
  console.log(`Rows captured:    ${report.found_rows} / expected ${report.expected_rows}`);
  console.log(`Nett sum:         ${report.nett_sum}  (printed ${printed_totals.nett ?? "?"})  ${report.nett_matches_printed === true ? "✓" : report.nett_matches_printed === false ? "✗" : "—"}`);
  console.log(`Gross sum:        ${report.gross_sum}  (printed ${printed_totals.gross ?? "?"})  ${report.gross_matches_printed === true ? "✓" : report.gross_matches_printed === false ? "✗" : "—"}`);
  if (report.missing_line_numbers.length) console.log(`Missing rows:     ${report.missing_line_numbers.join(", ")}`);
  if (report.duplicate_line_numbers.length) console.log(`Duplicate rows:   ${report.duplicate_line_numbers.join(", ")}`);
  console.log(`Time:             ${secs}s`);
  console.log(report.complete ? "✅ COMPLETE — safe to save." : "⛔ INCOMPLETE — would be flagged, NOT silently saved.");
  if (!report.complete) report.issues.forEach((m) => console.log(`   - ${m}`));

  // Print the captured rows so you can eyeball accuracy.
  console.log("\n(captured rows)");
  for (const it of items) console.log(`  ${String(it.line_no).padStart(2)}  ${it.item_number ?? ""}  ${it.quantity ?? ""} ${it.uom ?? ""}  n=${it.nett_weight ?? ""} g=${it.gross_weight ?? ""}  ${it.description ?? ""}`);
}

main().catch((e) => {
  console.error("✗ Spike failed:", e?.message ?? e);
  process.exit(1);
});
