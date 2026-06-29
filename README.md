# Pluckd — Logistics Document Extraction App

> Built by Zhenghe Logistics. Entirely designed, architected, and written by [Claude](https://claude.ai) (Anthropic).

Pluckd is an internal AI-powered document extraction tool that processes logistics PDFs and exports structured data as CSV. It uses Claude (`claude-sonnet-4-6`) to read and extract data from complex, multi-format shipping documents — no separate OCR engine, no templates, no manual entry.

---

## How It Works

1. Upload one or more PDF files (drag & drop or file picker)
2. Claude reads each document and extracts structured data
3. Results appear in a filterable table, organised by document type
4. Export individual CSVs per document type, or download everything as a ZIP

PDFs are **chunked client-side** with `pdf-lib`, then each chunk is sent to Claude through a **Vercel serverless function** (`api/extract.ts`) that keeps the Anthropic API key server-side — the browser never sees the key. Responses are streamed (to survive long extractions) and parsed with `jsonrepair`. Extracted data is persisted in Supabase.

---

## Document Types

### Accounts Team
| Type | Description |
|---|---|
| **Payment Voucher / GL** | Extracts PSS invoice number, carrier/forwarder invoice number, BL number, payable amount, total payable, and itemised charges |

### Shipping Department (Logistics)
| Type | Description |
|---|---|
| **Logistics Local Charges Report** | BL number, carrier/forwarder, PSS invoice number, freight term, destination, container type/qty, and all SGD charges (THC, seal fee, BL fee, ENS/AMS/SCMC, others, total) |
| **Outward Permit Declaration** | BL, carrier, consignee, container, seal, vessel/voyage, HS code, description, net weight, value, currency, pack qty/unit, gross weight |
| **Export Permit Declaration (PSS)** | Line-item extraction: HS code, qty, UOM, item description, product of origin, nett weight, amount, currency, PO number, invoice number — supports PSS/RSUP shipments and Schutz-format proforma invoices. Also the path used for **packing lists** (see *Extraction Reliability* below) |

### Transport Team
| Type | Description |
|---|---|
| **Allied Report** | Container/booking number, DHC in/out, DHE in/out, data admin fee, washing, repair, detention, demurrage |
| **CDAS Report** | Same charge categories as Allied, keyed by container number |
| **CRM Billing** | Container billing management with charge validation, billing status tracking, and archive support |

---

## Extraction Reliability — completeness self-check (in progress)

Long packing lists exposed a class of **silent-failure** bugs: a chunk (or an entire file in a
multi-file packing list) could fail transiently or be dropped during de-duplication, and the app
would **save the partial result with no warning**. Because every document is different, we can't grade
output against a fixed answer key — so instead **each document is checked against its own internal
evidence** (see [`docs/extraction-plan.md`](docs/extraction-plan.md)):

- **Contiguous line numbers** (`1..N`) — a gap means a dropped row.
- **Page count** (`Page X/N` footer) — confirms no page is missing.
- **Totals reconciliation** — captured line weights must sum to the document's own printed Sub Total.

If a check fails, the missing part is re-fetched; if it still can't be completed, the document is
flagged **INCOMPLETE** rather than silently saved.

| File | Purpose |
|---|---|
| [`services/completeness.ts`](services/completeness.ts) | The self-check logic (pure functions: row gaps, page count, totals reconciliation, chunk merge) |
| [`tests/completeness.test.ts`](tests/completeness.test.ts) | Unit tests proving it catches dropped rows **and** misread numbers (runs with no API key) |
| [`tests/fixtures/SO26060535/expected.json`](tests/fixtures/SO26060535/expected.json) | A transcribed sample used as a **code test**, not a production answer key |
| [`scripts/packingListSpike.ts`](scripts/packingListSpike.ts) | Live end-to-end runner: PDF → Claude (parallel chunks) → self-check → re-fetch → verdict. See [`scripts/README-packing-list-spike.md`](scripts/README-packing-list-spike.md) |

```bash
# self-check logic only (no API key needed):
npx vitest run tests/completeness.test.ts

# full live test on a real PDF (needs your Anthropic key):
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx scripts/packingListSpike.ts "PL - SO26060535 - 1-8.pdf" "PL - SO26060535 - 9-12.pdf"
```

**Reader policy:** Claude stays the reader (it's the existing engine). No third-party Document AI
(Google / AWS Textract / ChatGPT). If poor scans ever cause *misreads* (the totals won't reconcile
even after re-fetch), the only sanctioned remedies are image pre-processing or self-hosted OCR
(Tesseract) — never a SaaS document-AI vendor.

---

## Features

- **Role-based access** — Three teams (Accounts, Shipping Department, Transport) each see only their relevant document types and tabs
- **Drag & drop uploads** — Drop multiple PDFs at once; each is queued and processed in parallel
- **Re-process button** — Re-run extraction on any already-processed file without re-uploading
- **ZIP export** — Download all extracted CSVs and a processing log in one zip file, with each document type as its own CSV
- **Custom extraction rules** — Freeform rules panel that injects additional instructions into Claude's extraction prompt (persisted in localStorage)
- **CRM Billing tab** — Full billing lifecycle: import container charges from Allied/CDAS reports, validate charges, mark as billed, archive records
- **Voucher PDF generation** — Generate formatted payment voucher PDFs for Allied and CDAS reports directly from the UI
- **Auto update detection** — Polls for new deployments every 10 minutes; shows a banner prompting users to refresh when a new version is live
- **Admin role switcher** — Admin users can toggle between all three team roles from the sidebar for testing
- **Supabase persistence** — Extracted documents are saved to Supabase and reloaded on next session; no data loss on refresh

---

## Tech Stack

- **React + TypeScript** — UI and state
- **Vite** — Build tooling
- **Tailwind CSS v3** — Styling (PostCSS build plugin, not CDN)
- **Anthropic SDK** (`@anthropic-ai/sdk`) — Claude API calls via Vercel serverless functions (`api/`)
- **Vercel serverless functions** — `api/extract.ts`, `api/enrichPSS.ts`, `api/templateChat.ts` (each `maxDuration: 300`s)
- **pdf-lib** — Client-side PDF chunking
- **jsonrepair** — Tolerant JSON parsing for Claude responses
- **JSZip** — Client-side ZIP generation
- **docx** — Word document generation for vouchers
- **Supabase** — Auth, document storage, CRM billing records
- **Sentry** (`@sentry/react`) — Error monitoring
- **Vitest** — Unit tests

---

## Running Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Environment variables:
   - **Server-side (Vercel project → Settings → Environment Variables):**
     ```
     ANTHROPIC_API_KEY=your_anthropic_key
     ```
   - **Client-side (`.env.local`):**
     ```
     VITE_SUPABASE_URL=your_supabase_url
     VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
     ```

3. Run the dev server:
   ```bash
   npm run dev          # Vite UI
   # the api/ routes are Vercel functions — use `vercel dev` to run them locally
   ```

4. Run tests:
   ```bash
   npm test
   ```

---

## Project Structure

```
api/            Vercel serverless functions (extract, enrichPSS, templateChat)
components/     React UI (results table, tabs, CRM billing, modals)
hooks/          useFileProcessor (extraction orchestration), useAuth, useCrmBilling
services/       claudeService (pipeline), completeness (self-check brain), supabase, voucher generators
prompts/        Role-based system prompts (base, accounts, logistics) + buildPrompt
scripts/        packingListSpike (live completeness runner)
tests/          Vitest unit tests + fixtures
docs/           extraction-plan (the packing-list reliability plan)
config.ts       Roles, view columns, validation rules
types.ts        DocumentData and per-document-type interfaces
```

---

## Changelog

| Version | Change |
|---|---|
| 2026-06 | Completeness self-check brain for packing lists (`services/completeness.ts`) + live spike runner + tests; documented in `docs/extraction-plan.md` |
| 2026-06 | README accuracy: Claude is called via Vercel serverless functions (server-side `ANTHROPIC_API_KEY`), not the browser SDK |
| — | PSS in ZIP export + re-process button |
| — | Schutz-format Proforma Invoice extraction for Export Permit PSS |
| — | Remove Templates feature (replaced by hardcoded document types) |
| — | Export Permit Declaration (PSS) tab for Shipping Department |
| — | Fuel surcharge merged into DHC for Allied and CDAS extraction |
| — | Mass delete for CRM billing tab |
| — | Streaming API for 32k token extractions |
| — | Deep Ledger design system (Manrope font, `#091426` primary, `#00668a` secondary) |
| — | Allied + CDAS voucher PDF generation |
| — | CRM Billing tab with charge validation and archive |
