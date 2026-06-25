# Packing-list extractor — the plan (plain version)

## The problem (the "bad-memory waiter")
We tell the AI "grab these specific fields." It grabs only those. Later the shipping team asks for a
field we never listed — so it's missing, we patch the prompt, and the prompt bloats forever. That's the
cat-and-mouse: nobody ever wrote down the full order, so we keep guessing and getting caught out.

Three things make it worse:
1. **Shrinking photocopy** — even when the AI grabs a lot, our own app crops it down before showing it.
2. **5-minute kitchen** — Vercel kills jobs over 5 minutes, and there's a cap on how much the AI can
   write at once (go over and the answer is chopped off).
3. **Lazy reader** — the AI gets bored partway down a long table and stops/skips rows, and nothing
   checks whether all rows came back. Add scans (pictures, not text) and it misreads/drops more.

## The goal
Copy the **entire** packing list — header, all rows, totals — exactly as printed. Nothing dropped or
changed. Split files stitched into one. "Is everything there, exactly as written?" is the whole test.

## The fix — four moves
1. **📸 Photocopy, don't shop.** Tell the AI to copy everything it sees, not a field list. New requests
   are already in the copy — we just show them. No re-training the AI.
2. **🖼️ Stop cropping.** Keep/show the full copy in our app; new fields become a toggle, not a rewrite.
3. **🍞 Read in strips, in parallel.** Slice into small page chunks read at once — no timeout, no
   chopped answers, and faster. Glue back together.
4. **🧾 Each document grades itself** (the big one). No fixed answer key (every PDF differs). Instead use
   the document's own evidence: contiguous row numbers (1..N), the "Page x/N" footer, and the printed
   Sub Total that the line weights must add up to. Detect a gap or bad sum → re-fetch just that part →
   if still wrong, flag INCOMPLETE and alert (Sentry). Never silently save holes.

## The reader: keep Claude (no new vendor)
The app already reads with Claude — there is no Google / ChatGPT / Document AI in it. `pdf-lib` only
slices; Claude reads. Document AI / Textract are rejected. All the new value is the **brain we build
around Claude** (moves 3 + 4). If bad scans cause *misreads* (sums won't reconcile even after re-fetch),
the allowed fixes are image clean-up or self-hosted OCR (Tesseract) — never a SaaS document-AI vendor.

## How "missing vs misread" decides everything
- **Missing rows** → the re-fetch loop fixes it for free (Claude is enough).
- **Misread numbers** → re-asking misreads again; the sum-check detects it; *that* is the only trigger
  to add image clean-up / self-hosted OCR. So we never overspend on a hunch.

## Proven so far
- `services/completeness.ts` + `tests/completeness.test.ts` — the self-check brain; 6/6 tests pass,
  including catching dropped rows and a misread number, verified on `SO26060535` (line weights sum to
  exactly the printed 1,758.000 / 1,938.000).
- `scripts/packingListSpike.ts` — the live loop (PDF → Claude → self-check → re-fetch → verdict).

## Still to do
- Run the live spike on real *scanned* production PDFs (needs API key + PDFs) to learn missing-vs-misread.
- The shipping-team requirements questionnaire (gets the full order once, signed off).
- Integrate the four moves into the app so it can be tested on the website.
