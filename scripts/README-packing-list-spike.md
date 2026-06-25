# Packing-list "brain" spike — how to test it

This is a **standalone test**, separate from the web app. It does not touch the database, Supabase, or
the deployed site. It reads a packing-list PDF, asks Claude to transcribe it in small parallel chunks,
then runs the self-check (row numbering + page count + totals) and re-fetches any missing rows.

## What's here
- `services/completeness.ts` — the "brain": pure self-check functions (no API, no internet).
- `tests/completeness.test.ts` — proves the brain works on `SO26060535` (runs with no API key).
- `scripts/packingListSpike.ts` — the live runner: PDF → Claude → self-check → re-fetch → verdict.
- `tests/fixtures/SO26060535/expected.json` — the transcribed sample (a code test, not a prod answer key).

## 1. Test the brain only (no API key needed)
```bash
npm install
npx vitest run tests/completeness.test.ts
```
Expect 6 passing tests, including "catches dropped rows" and "catches a misread number."

## 2. Test the full loop on a real PDF (needs your Claude key)
```bash
export ANTHROPIC_API_KEY=sk-ant-...                       # your Anthropic key
npx tsx scripts/packingListSpike.ts "PL - SO26060535 - 1-8.pdf" "PL - SO26060535 - 9-12.pdf"
```
Pass one PDF, or several that belong to the same packing list (they're stitched in order).

### What you'll see
- progress per chunk (rows found),
- a **VERDICT**: rows captured vs expected, whether the nett/gross sums match the printed Sub Total,
  any missing rows, and ✅ COMPLETE or ⛔ INCOMPLETE,
- the captured rows printed out so you can eyeball accuracy.

The point: if Claude drops rows, you'll see the loop catch them and re-fetch; if it still can't, it says
**INCOMPLETE** instead of silently saving holes.

## Knobs (top of `scripts/packingListSpike.ts`)
- `CHUNK_PAGES` (default 4) — smaller = safer/faster per call, more calls.
- `CONCURRENCY` (default 3) — how many chunks read at once.
- `MAX_REFETCH` (default 2) — how many times to chase missing rows before flagging incomplete.

## Note
This spike uses Claude as the reader (your existing engine). No Google / ChatGPT / Document AI.
If, on bad scans, Claude *misreads numbers* (sums won't reconcile even after re-fetch), that's the
signal to add image clean-up or self-hosted OCR later — not a third-party document-AI vendor.
