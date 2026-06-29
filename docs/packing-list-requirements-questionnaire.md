# Packing-List Requirements Questionnaire (shipping-team session)

**Purpose.** Get the *complete* requirement for packing-list extraction **once**, in writing, signed
off — so we stop the "you forgot field X" cat-and-mouse where fields get patched in reactively.

**Why it's built this way.** The shipping team can't read a schema and won't list fields in the
abstract. So this script is **destination-first**: we don't ask "what do you need," we ask to *see
where the data goes* and reverse-engineer the spec from there. Three moves run through the whole
session:

1. **"Show me the spreadsheet/system you paste this into."** Its columns *are* the real field list.
2. **"Circle every value you use on a printout."** Anything uncircled is officially out of scope —
   that's the sign-off leverage.
3. **"Show me every other kind of packing list you'll ever send."** Record explicitly: *anything not
   shown today is a change request later, not a bug.*

**How to run it.** Sit with the owner, a printout of a real packing list (e.g. `SO26060535`), and
their actual destination spreadsheet/system open. Fill in answers inline. At the end, get the owner to
sign off Section 13.

---

## Section 1 — Purpose & destination (reverse-engineer the real spec)
- 1.1 After a packing list is extracted, **what is the very next thing you do** with the result? (paste into Excel? key into a system? email it?) **Show me the actual file/screen.**
- 1.2 **Which exact columns** in that destination get filled from the packing list? Walk them left→right; for each, point at where it comes from on the PDF.
- 1.3 What happens to it downstream — customs filing? billing? inventory? a report to whom?
- 1.4 Which values are **must-have** (work stops without them) vs **nice-to-have**?
- 1.5 Which columns do you currently fill **by hand** because the tool doesn't give them? *(These are the silent misses driving the complaints.)*
- 1.6 Does anything/anyone downstream have a **required format** for the output?

## Section 2 — Header fields (walk the top of a real PL)
For each: needed? exact source label? desired format? what if it's missing/blank?
- 2.1 Date — keep `DD-MM-YYYY` as printed, or convert? to what?
- 2.2 PL No *(is this the key you track the whole shipment by?)*
- 2.3 Shipment Date
- 2.4 Shipment Term (e.g. "CIF PULAU BURUNG") — split into Incoterm + place, or keep whole?
- 2.5 Customer name + full address
- 2.6 Ship-to name + full address — ever different from Customer? need both?
- 2.7 Contact name / 2.8 Telephone — which party's? both?
- 2.9 Shipping Via (e.g. "NUSANTARA 2501 / 735SN") — split vessel/voyage or keep whole?
- 2.10 Country of Origin
- 2.11 Remarks / PO references — can there be **more than two**? exact format? need each PO separately?
- 2.12 "Printed By" / approver / stamp — needed at all?

## Section 3 — Footer totals & summary
- 3.1 Total Nett Weight / 3.2 Total Gross Weight — used? for what?
- 3.3 **Total Packages** (e.g. "4 PACKAGES") — needed?
- 3.4 Sub Total row — same as totals, or distinct?
- 3.5 Should we **verify** that line items sum to these totals and flag mismatches? *(Recommended — yes.)*

## Section 4 — Line-item fields (walk one row, then the exceptions)
For each: needed? source column? desired format?
- 4.1 Line No — keep original numbering? must it stay continuous after files are merged?
- 4.2 **Item Number** (e.g. `MC-ARG-PRM-00129`) — is this a key you match/look up elsewhere?
- 4.3 Item Description — keep multi-line verbatim, or collapse to one line?
- 4.4 Embedded **Part No** ("PN. 200-8-20.18") inside the description — pull as its own field, or leave in the text?
- 4.5 Quantity — keep `6.000`, or strip to `6`?
- 4.6 UOM — see Section 5.
- 4.7 Nett Weight (per line) — needed per line, or only the total?
- 4.8 Gross Weight (per line) — needed per line, or only the total?
- 4.9 **NPBB reference** (`NPBB:04053/COM/032026 (RSUP-DP)`) — see Section 6.

## Section 5 — Units & number formats (high-error-rate zone)
- 5.1 Give the **complete master list** of UOMs that can ever appear.
- 5.2 Same doc mixes `Piece` / `PCS` / `UNIT` — normalize to ONE canonical value, or keep exactly as printed? If normalizing, give the canonical form for each.
- 5.3 Weight unit always KGS? ever lbs / MT?
- 5.4 Number format — always `1,758.000` (comma-thousands, dot-decimal)? Ever European `1.758,000`?
- 5.5 Do trailing zeros matter (`9.000` vs `9`)?

## Section 6 — Identifiers, matching keys & NPBB
- 6.1 **NPBB** — is it a **per-line** attribute, or a **group/batch label** covering a run of lines? (It changes mid-page — e.g. rows 60→61 on `SO26060535`.) Which do you need it stored as?
- 6.2 What does the NPBB number mean to you / what do you do with it?
- 6.3 Item Number — used to look anything up (price master? product DB?)? If so, where?
- 6.4 PO references — how do they link to line items (whole-doc, or per-row)?

## Section 7 — The known traps (seeded from `SO26060535` — get rulings)
- 7.1 **Repeated Item Numbers.** `00129` appears at rows 41/42/71; `00122` at 1/51 — different qty/NPBB. **Merge to one row, or keep every occurrence?** Show me the output you want.
- 7.2 **Gross = Nett** (rows 16, 17) — valid (zero packaging), or flag as an error?
- 7.3 **Multi-line wrapped descriptions** — always join with a space, or are line breaks ever meaningful?
- 7.4 **Sub Total / TOTAL PACKING rows** — confirm: capture as totals, NEVER as a line item.
- 7.5 Any other summary/section rows that appear on other packing lists?
- 7.6 Blank/missing cells — leave empty, or is a blank ever meaningful (e.g. "same as above")?

## Section 8 — The document universe (kill future surprises)
- 8.1 How many different PL **layouts/templates** exist? **Get a real PDF of EVERY one.**
- 8.2 Other **suppliers/origins** with different PL structures? Examples of each.
- 8.3 Any **non-English** labels, alternate date/number formats, or currencies?
- 8.4 Are PLs ever **scanned/photographed/stamped-and-rescanned** (vs clean digital PDFs)? *(Decides whether image clean-up is ever needed.)*
- 8.5 Page-count range — smallest and largest PL you've seen?
- 8.6 **Recorded statement (read aloud, get agreement):** *"Is this every format you will ever send? Anything not shown today is a change request, not a defect."*

## Section 9 — Multi-file / splitting
- 9.1 Why do PLs arrive split (e.g. 1-8 / 9-12)? A file-size limit on their side?
- 9.2 Always split the same way, or unpredictable?
- 9.3 Confirm merge key = **PL No**. Can one PL No ever cover **unrelated** shipments?
- 9.4 Could pages arrive **out of order**, or with **overlap/duplicates**?

## Section 10 — Acceptance / "definition of done"
- 10.1 Provide **3–5 real PLs with hand-verified expected values** (these become our regression tests).
- 10.2 For each must-have field, what makes an answer **"correct" vs "wrong"**?
- 10.3 Acceptable **error rate**? Acceptable **turnaround time** per document?

## Section 11 — Volume, failure & escalation
- 11.1 How many PLs per day / week? Peak?
- 11.2 Today, when an extraction is wrong/empty, **how do you find out** — any alert, or by eye?
- 11.3 Who should be **notified on failure**, and how?
- 11.4 What's the **cost** of a missed/wrong field (re-work, customs delay, fine)?

## Section 12 — Output & integration
- 12.1 How do you want the result delivered — on-screen table, CSV download, or straight into a system?
- 12.2 Exact **column order & headers** you want in the export?
- 12.3 One row per line item, or one row per document with items nested?
- 12.4 File naming / where it lands?

## Section 13 — Change governance & sign-off (so this never recurs)
- 13.1 Who is the single **sign-off owner** for this field spec? __________________________
- 13.2 Agreed process: future needs are logged as **change requests against this signed baseline**, not urgent fixes.
- 13.3 **Sign-off:** Name __________________  Role __________________  Date __________

---

## Appendix — what we already see on `SO26060535` (confirm/correct, don't re-derive)
Easier for the team to confirm than to invent:
- **Header present:** Date, PL No, Shipment Date, Shipment Term, Customer, Ship-to, Contact, Telephone, Shipping Via, Country of Origin (China), Remarks → 2 POs (`PSV26-04-1060`, `PSV26-04-1112`).
- **Footer totals:** Nett `1,758.000` / Gross `1,938.000` / **4 PACKAGES**.
- **Body:** 78 line items across 12 pages / 2 files. Columns: No, Item Number, Description (multi-line), Quantity, UOM, Nett Weight, Gross Weight, NPBB.
- **Traps observed:** repeated item numbers (§7.1), mid-page NPBB change (§6.1), mixed UOM (§5.2), gross = nett rows (§7.2), wrapped descriptions (§7.3), summary rows (§7.4), split files (§9).
