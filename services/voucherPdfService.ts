import { PDFDocument, StandardFonts, TextAlignment, PDFName, PDFBool, rgb, PDFPage } from 'pdf-lib';
import type { DocumentData } from '../types';

function shortenInvoiceList(raw: string | null | undefined): string {
  if (!raw) return '';
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return raw;
  let prefix = parts[0];
  for (let i = 1; i < parts.length; i++) {
    while (prefix.length > 0 && !parts[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  // Only shorten if prefix is long enough to be a real series (not coincidental overlap)
  // and all suffixes are at least 2 chars
  if (prefix.length < 8) return raw;
  if (parts.some(p => p.slice(prefix.length).length < 2)) return raw;
  return [parts[0], ...parts.slice(1).map(p => p.slice(prefix.length))].join(', ');
}

function stripCurrency(val: string | null | undefined): string {
  if (!val) return '';
  return val.replace(/SGD\s*/gi, '').replace(/USD\s*/gi, '').trim();
}

function detectCurrency(val: string | null | undefined): 'SGD' | 'USD' {
  if (val && /USD/i.test(val)) return 'USD';
  return 'SGD';
}

export async function generateCDASVoucherPdf(docs: DocumentData[]): Promise<Blob> {
  const templateBytes = await fetch('/ZHL_Payment_Voucher_CDASUPDATED.pdf').then(r => r.arrayBuffer());
  // Load directly — do not copy to a new doc so AcroForm is preserved (editable in Acrobat)
  const templateDoc = await PDFDocument.load(templateBytes);
  const form = templateDoc.getForm();

  const setField = (name: string, value: string, fontSize = 11.5) => {
    try {
      const field = form.getTextField(name);
      field.setFontSize(fontSize);
      field.setAlignment(TextAlignment.Left);
      if (fontSize <= 9) {
        // Dense row — multiline, expand field height downward to fit wrapped text
        field.enableMultiline();
        for (const widget of field.acroField.getWidgets()) {
          const r = widget.getRectangle();
          const charsPerLine = Math.max(1, Math.floor(r.width / (fontSize * 0.55)));
          const lines = Math.max(1, Math.ceil(value.length / charsPerLine));
          const newHeight = lines * (fontSize * 1.4) + 4;
          const extra = Math.max(0, newHeight - r.height);
          widget.setRectangle({ x: r.x, y: r.y - extra + 2, width: r.width, height: newHeight });
        }
      } else {
        // Normal row — anchor to top of field so text sits flush on the form line
        for (const widget of field.acroField.getWidgets()) {
          const r = widget.getRectangle();
          const h = fontSize + 4;
          widget.setRectangle({ x: r.x, y: r.y + r.height - h + 2, width: r.width, height: h });
        }
      }

      field.setText(value);
    } catch { /* field not in template — skip */ }
  };

  const parse = (v: string | null | undefined) => parseFloat(v?.replace(/[^0-9.]/g, '') || '0') || 0;

  // Aggregate all CDAS entries by charge type
  type ContainerEntry = { container: string; amount: number };
  let dhcTotal = 0;
  let adminTotal = 0;
  let washingTotal = 0;
  const washingEntries: ContainerEntry[] = [];
  let repairTotal = 0;
  const repairEntries: ContainerEntry[] = [];
  let detentionTotal = 0;
  const detentionEntries: ContainerEntry[] = [];
  let demurrageTotal = 0;
  const demurrageEntries: ContainerEntry[] = [];
  let fuelSurchargeTotal = 0;

  for (const doc of docs) {
    const c = doc.cdas_report;
    if (!c) continue;
    // DHC + DHE lumped together, no container breakdown
    dhcTotal   += parse(c.dhc_in) + parse(c.dhc_out) + parse(c.dhe_in) + parse(c.dhe_out);
    fuelSurchargeTotal += parse(c.fuel_surcharge);
    // Admin fee lump, no breakdown
    adminTotal += parse(c.data_admin_fee);
    // Washing: per-container amount shown
    const w = parse(c.washing);
    if (w > 0) { washingTotal += w; if (c.container_number) washingEntries.push({ container: c.container_number, amount: w }); }
    // Repair: per-container amount shown
    const r = parse(c.repair);
    if (r > 0) { repairTotal += r; if (c.container_number) repairEntries.push({ container: c.container_number, amount: r }); }
    // Detention: per-container amount shown
    const det = parse(c.detention);
    if (det > 0) { detentionTotal += det; if (c.container_number) detentionEntries.push({ container: c.container_number, amount: det }); }
    // Demurrage: per-container amount shown
    const dem = parse(c.demurrage);
    if (dem > 0) { demurrageTotal += dem; if (c.container_number) demurrageEntries.push({ container: c.container_number, amount: dem }); }
  }

  const containerDetail = (entries: ContainerEntry[]) =>
    entries.map(e => `${e.container} $${e.amount}/-`).join(', ');

  const fuelLabel = docs.find(d => d.cdas_report?.fuel_surcharge_label)?.cdas_report?.fuel_surcharge_label || 'FUEL SURCHARGE';

  const rows: { desc: string; amount: number }[] = [];
  if (dhcTotal > 0)           rows.push({ desc: 'DHC', amount: dhcTotal });
  if (fuelSurchargeTotal > 0) rows.push({ desc: fuelLabel, amount: fuelSurchargeTotal });
  if (adminTotal > 0)         rows.push({ desc: 'ADMIN FEE', amount: adminTotal });
  if (washingTotal > 0)    rows.push({ desc: washingEntries.length ? `WASHING - ${containerDetail(washingEntries)}` : 'WASHING', amount: washingTotal });
  if (repairTotal > 0)     rows.push({ desc: repairEntries.length ? `REPAIR - ${containerDetail(repairEntries)}` : 'REPAIR', amount: repairTotal });
  if (detentionTotal > 0)  rows.push({ desc: detentionEntries.length ? `DETENTION - ${containerDetail(detentionEntries)}` : 'DETENTION', amount: detentionTotal });
  if (demurrageTotal > 0)  rows.push({ desc: demurrageEntries.length ? `DEMURRAGE - ${containerDetail(demurrageEntries)}` : 'DEMURRAGE', amount: demurrageTotal });

  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

  // Date: YYYY-MM-DD → "17 MARCH 2026"
  const rawDate = docs[0]?.cdas_report?.invoice_date || docs[0]?.metadata?.date || '';
  const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const dateDisplay = rawDate
    ? (() => { const [y, m, d] = rawDate.split('-'); return `${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}`; })()
    : '';

  setField('ref', ''); // ZHL internal batch ref — blank, fill manually
  setField('Payment To', 'CDAS LOGISTICS ALLIANCE LTD');
  setField('Date', dateDisplay);
  setField('CASH CHEQUE No', 'CIMB - GIRO');

  const CDAS_MAX_ROWS = 6;
  rows.slice(0, CDAS_MAX_ROWS - 1).forEach((row, i) => {
    setField(`row${i + 1}_desc`, row.desc, row.desc.length > 40 ? 7.5 : 11.5);
    setField(`SGD USDRow${i + 1}`, row.amount.toFixed(2));
  });
  const cdasOverflow = rows.slice(CDAS_MAX_ROWS - 1);
  if (cdasOverflow.length === 1) {
    setField(`row${CDAS_MAX_ROWS}_desc`, cdasOverflow[0].desc, cdasOverflow[0].desc.length > 40 ? 7.5 : 11.5);
    setField(`SGD USDRow${CDAS_MAX_ROWS}`, cdasOverflow[0].amount.toFixed(2));
  } else if (cdasOverflow.length > 1) {
    const combinedDesc = cdasOverflow.map(r => r.desc).join('; ');
    const combinedAmount = cdasOverflow.reduce((s, r) => s + r.amount, 0);
    setField(`row${CDAS_MAX_ROWS}_desc`, combinedDesc, 7.5);
    setField(`SGD USDRow${CDAS_MAX_ROWS}`, combinedAmount.toFixed(2));
  }

  setField('SGD  USD Total', grandTotal.toFixed(2));
  try { form.getCheckBox('sgd_check').check(); } catch { /* skip */ }

  // Embed a standard font so appearance streams render in all PDF viewers
  const font = await templateDoc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  // Clear NeedAppearances so Adobe Acrobat uses our pre-generated streams
  // instead of regenerating them with fonts it cannot find (which produces blank fields)
  (form.acroForm.dict as any).set(PDFName.of('NeedAppearances'), PDFBool.False);

  // Save templateDoc directly — preserves AcroForm so fields remain editable in Acrobat
  const bytes = await templateDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function generateAlliedVoucherPdf(docs: DocumentData[]): Promise<Blob> {
  const templateBytes = await fetch('/ZHL_Payment_Voucher_ALLIEDUPDTAED.pdf').then(r => r.arrayBuffer());
  const templateDoc = await PDFDocument.load(templateBytes);
  const form = templateDoc.getForm();

  const setField = (name: string, value: string, fontSize = 11.5) => {
    try {
      const field = form.getTextField(name);
      field.setFontSize(fontSize);
      field.setAlignment(TextAlignment.Left);
      if (fontSize <= 9) {
        field.enableMultiline();
        for (const widget of field.acroField.getWidgets()) {
          const r = widget.getRectangle();
          const charsPerLine = Math.max(1, Math.floor(r.width / (fontSize * 0.55)));
          const lines = Math.max(1, Math.ceil(value.length / charsPerLine));
          const newHeight = lines * (fontSize * 1.4) + 4;
          const extra = Math.max(0, newHeight - r.height);
          widget.setRectangle({ x: r.x, y: r.y - extra + 2, width: r.width, height: newHeight });
        }
      } else {
        for (const widget of field.acroField.getWidgets()) {
          const r = widget.getRectangle();
          const h = fontSize + 4;
          widget.setRectangle({ x: r.x, y: r.y + r.height - h + 2, width: r.width, height: h });
        }
      }
      field.setText(value);
    } catch { /* field not in template — skip */ }
  };

  const parse = (v: string | null | undefined) => parseFloat(v?.replace(/[^0-9.]/g, '') || '0') || 0;

  type ContainerEntry = { container: string; amount: number };
  let dhcTotal = 0;
  let dheTotal = 0;
  let adminTotal = 0;
  let washingTotal = 0;
  const washingEntries: ContainerEntry[] = [];
  let repairTotal = 0;
  const repairEntries: ContainerEntry[] = [];
  let detentionTotal = 0;
  const detentionEntries: ContainerEntry[] = [];
  let demurrageTotal = 0;
  const demurrageEntries: ContainerEntry[] = [];
  let fuelSurchargeTotal = 0;
  let dynamicPriceFactorTotal = 0;

  for (const doc of docs) {
    const a = doc.allied_report;
    if (!a) continue;
    dhcTotal  += parse(a.dhc_in) + parse(a.dhc_out);
    dheTotal  += parse(a.dhe_in) + parse(a.dhe_out);
    adminTotal += parse(a.data_admin_fee);
    fuelSurchargeTotal += parse(a.fuel_surcharge);
    dynamicPriceFactorTotal += parse(a.dynamic_price_factor);
    const w = parse(a.washing);
    if (w > 0) { washingTotal += w; if (a.container_booking_no) washingEntries.push({ container: a.container_booking_no, amount: w }); }
    const r = parse(a.repair);
    if (r > 0) { repairTotal += r; if (a.container_booking_no) repairEntries.push({ container: a.container_booking_no, amount: r }); }
    const det = parse(a.detention);
    if (det > 0) { detentionTotal += det; if (a.container_booking_no) detentionEntries.push({ container: a.container_booking_no, amount: det }); }
    const dem = parse(a.demurrage);
    if (dem > 0) { demurrageTotal += dem; if (a.container_booking_no) demurrageEntries.push({ container: a.container_booking_no, amount: dem }); }
  }

  const containerDetail = (entries: ContainerEntry[]) =>
    entries.map(e => `${e.container} $${e.amount}/-`).join(', ');

  const fuelLabel = docs.find(d => d.allied_report?.fuel_surcharge_label)?.allied_report?.fuel_surcharge_label || 'FUEL SURCHARGE';
  const dpfLabel  = docs.find(d => d.allied_report?.dynamic_price_factor_label)?.allied_report?.dynamic_price_factor_label || 'DYNAMIC PRICE FACTOR';

  const rows: { desc: string; amount: number }[] = [];
  if (dhcTotal > 0)               rows.push({ desc: 'DHC', amount: dhcTotal });
  if (fuelSurchargeTotal > 0)     rows.push({ desc: fuelLabel, amount: fuelSurchargeTotal });
  if (dynamicPriceFactorTotal > 0) rows.push({ desc: dpfLabel, amount: dynamicPriceFactorTotal });
  if (dheTotal > 0)               rows.push({ desc: 'DHE', amount: dheTotal });
  if (adminTotal > 0)      rows.push({ desc: 'ADMIN FEE', amount: adminTotal });
  if (washingTotal > 0)    rows.push({ desc: washingEntries.length ? `WASHING - ${containerDetail(washingEntries)}` : 'WASHING', amount: washingTotal });
  if (repairTotal > 0)     rows.push({ desc: repairEntries.length ? `REPAIR - ${containerDetail(repairEntries)}` : 'REPAIR', amount: repairTotal });
  if (detentionTotal > 0)  rows.push({ desc: detentionEntries.length ? `DETENTION - ${containerDetail(detentionEntries)}` : 'DETENTION', amount: detentionTotal });
  if (demurrageTotal > 0)  rows.push({ desc: demurrageEntries.length ? `DEMURRAGE - ${containerDetail(demurrageEntries)}` : 'DEMURRAGE', amount: demurrageTotal });

  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

  const rawDate = docs[0]?.allied_report?.invoice_date || docs[0]?.metadata?.date || '';
  const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const dateDisplay = rawDate
    ? (() => { const [y, m, d] = rawDate.split('-'); return `${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}`; })()
    : '';

  setField('ref', '');
  setField('Payment To', 'ALLIED CONTAINER (E&M) PTE LTD');
  setField('Date', dateDisplay);
  setField('CASH CHEQUE No', 'CIMB - GIRO');

  const ALLIED_MAX_ROWS = 6;
  rows.slice(0, ALLIED_MAX_ROWS - 1).forEach((row, i) => {
    setField(`row${i + 1}_desc`, row.desc, row.desc.length > 40 ? 7.5 : 11.5);
    setField(`SGD USDRow${i + 1}`, row.amount.toFixed(2));
  });
  const alliedOverflow = rows.slice(ALLIED_MAX_ROWS - 1);
  if (alliedOverflow.length === 1) {
    setField(`row${ALLIED_MAX_ROWS}_desc`, alliedOverflow[0].desc, alliedOverflow[0].desc.length > 40 ? 7.5 : 11.5);
    setField(`SGD USDRow${ALLIED_MAX_ROWS}`, alliedOverflow[0].amount.toFixed(2));
  } else if (alliedOverflow.length > 1) {
    const combinedDesc = alliedOverflow.map(r => r.desc).join('; ');
    const combinedAmount = alliedOverflow.reduce((s, r) => s + r.amount, 0);
    setField(`row${ALLIED_MAX_ROWS}_desc`, combinedDesc, 7.5);
    setField(`SGD USDRow${ALLIED_MAX_ROWS}`, combinedAmount.toFixed(2));
  }

  setField('SGD  USD Total', grandTotal.toFixed(2));
  try { form.getCheckBox('sgd_check').check(); } catch { /* skip */ }

  const font = await templateDoc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  (form.acroForm.dict as any).set(PDFName.of('NeedAppearances'), PDFBool.False);

  const bytes = await templateDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function generateVoucherPdf(docs: DocumentData[]): Promise<Blob> {
  const templateBytes = await fetch('/ZHL_Payment_Voucher_Updated.pdf').then(r => r.arrayBuffer());

  const fillTemplate = async (doc: DocumentData): Promise<PDFDocument> => {
    const templateDoc = await PDFDocument.load(templateBytes);
    const form = templateDoc.getForm();

    const pv = doc.payment_voucher_details;

    const currencySource = pv?.total_payable_amount || pv?.payable_amount;
    const currency      = detectCurrency(currencySource);
    const amount        = stripCurrency(pv?.payable_amount);
    const total         = stripCurrency(pv?.total_payable_amount) || stripCurrency(pv?.payable_amount);
    const paymentTo     = pv?.payment_to || doc.metadata?.parties?.shipper_supplier || '';
    const carrierInv    = pv?.carrier_invoice_number || '';
    const blNum         = pv?.bl_number || '';
    const pssNum        = pv?.pss_invoice_number || '';
    const charges       = pv?.charges_summary || '';

    const pssDisplay = pssNum.startsWith('#') ? pssNum : (pssNum ? `#${pssNum}` : '');
    const blPssLine = [
      blNum      ? `BL. ${blNum}`    : '',
      pssDisplay ? `(${pssDisplay})` : '',
    ].filter(Boolean).join(' ');

    const today = new Date();
    const autoDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

    // ── Fill form fields by name — no coordinate guessing ──
    const setField = (name: string, value: string, fontSize = 11.5) => {
      const field = form.getTextField(name);
      field.setFontSize(fontSize);
      field.setAlignment(TextAlignment.Left);
      // Shrink field height to just fit the text so it sits on the form line
      // instead of floating in the middle of a tall field box.
      for (const widget of field.acroField.getWidgets()) {
        const r = widget.getRectangle();
        widget.setRectangle({ x: r.x, y: r.y, width: r.width, height: fontSize + 4 });
      }
      field.setText(value);
    };

    if (paymentTo)           setField('Payment To', paymentTo);
    setField('Date', autoDate);

    if (carrierInv) setField('row1_desc', `Payment Inv.  ${shortenInvoiceList(carrierInv)}`);

    if (pv?.bl_entries && pv.bl_entries.length > 0) {
      // Combined PV: populate one row per BL entry (rows 2–6)
      pv.bl_entries.forEach((entry, i) => {
        const rowNum = i + 2;
        if (rowNum > 6) return;
        const pssDisp = entry.pss_invoice_number
          ? (entry.pss_invoice_number.startsWith('#') ? entry.pss_invoice_number : `#${entry.pss_invoice_number}`)
          : '';
        const blLine = [entry.bl_number ? `BL. ${entry.bl_number}` : '', pssDisp ? `(${pssDisp})` : ''].filter(Boolean).join(' ');
        if (blLine) setField(`row${rowNum}_desc`, blLine);
        if (entry.amount) setField(`SGD USDRow${rowNum}`, stripCurrency(entry.amount));
      });
    } else {
      // Single BL
      if (blPssLine) setField('row2_desc', blPssLine);
      if (blPssLine && amount) setField('SGD USDRow2', amount);
    }

    if (charges) setField('charges', charges);

    // 'SGD  USD Total' has a double space — exact field name from Acrobat
    if (total) setField('SGD  USD Total', total);

    setField('CASH CHEQUE No', 'UOB SGD FAST / GIRO PAYMENT');

    // Currency checkboxes share their name between header row and total row,
    // so one check() call ticks both simultaneously.
    if (currency === 'SGD') {
      form.getCheckBox('sgd_check').check();
    } else {
      form.getCheckBox('usd_check').check();
    }

    // Embed a standard font so appearance streams render in all PDF viewers
    const font = await templateDoc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);
    // Clear NeedAppearances so Adobe Acrobat uses our pre-generated streams
    (form.acroForm.dict as any).set(PDFName.of('NeedAppearances'), PDFBool.False);

    return templateDoc;
  };

  if (docs.length === 1) {
    // Single PV: save templateDoc directly — AcroForm preserved, fully editable in Acrobat
    const filled = await fillTemplate(docs[0]);
    const bytes = await filled.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  // Multiple PVs: merge pages into one PDF.
  // copyPages does not transfer AcroForm so fields become static,
  // but the multi-page layout is correct.
  const outputDoc = await PDFDocument.create();
  for (const doc of docs) {
    const filled = await fillTemplate(doc);
    const [page] = await outputDoc.copyPages(filled, [0]);
    outputDoc.addPage(page);
  }

  const bytes = await outputDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// ─── FROM-SCRATCH PV GENERATOR ───────────────────────────────────────────────
// Draws a Payment Voucher from scratch — no fixed row limit, no template file.

const NAVY = rgb(0, 0.188, 0.529); // ZHL navy #003087

export async function generatePVPdfFromScratch(
  docs: DocumentData[],
  currency: 'SGD' | 'USD',
  showChecklist = false,
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // URL-encode spaces so fetch works correctly across all browsers/environments
  let logo: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null;
  for (const path of [
    '/Zhenghe%20Logistics%20Logo%20Blue.png',
    '/Zhenghe%20Logistics%20Logo-02.png',
  ]) {
    try {
      const r = await fetch(path);
      if (!r.ok) continue;
      logo = await pdfDoc.embedPng(await r.arrayBuffer());
      break;
    } catch { /* try next */ }
  }

  const W = 595.28, H = 841.89;
  const ML = 38, MR_X = 557;
  const CW = MR_X - ML;

  const ITEM_W = 32;
  const AMT_W  = 100;
  const X_ITEM = ML;
  const X_DESC = ML + ITEM_W;
  const X_AMT  = MR_X - AMT_W;
  const DESC_W = X_AMT - X_DESC;

  const ROW_H  = 22;
  const HDR_H  = 20;
  const HEADER_H = 58;
  const STRIPE_W = 16;
  // Reserve enough space for: total row + cash/cheque + signatures + checklist (right col)
  const FOOTER_RESERVE = 195;

  const dt = (p: PDFPage, text: string, x: number, y: number, sz: number, f: typeof fontR, c = NAVY) =>
    p.drawText(text, { x, y, size: sz, font: f, color: c });

  const dl = (p: PDFPage, x1: number, y1: number, x2: number, y2: number, w = 0.7, c = NAVY) =>
    p.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: c });

  const dr = (p: PDFPage, x: number, y: number, w: number, h: number, fill?: ReturnType<typeof rgb>, bw = 0) =>
    p.drawRectangle({ x, y, width: w, height: h, ...(fill ? { color: fill } : {}), ...(bw ? { borderColor: NAVY, borderWidth: bw } : {}) });

  const chkbox = (p: PDFPage, x: number, y: number, checked: boolean, onDark = false) => {
    const boxFill = rgb(1, 1, 1);
    p.drawRectangle({ x, y, width: 9, height: 9, color: boxFill, borderColor: onDark ? boxFill : NAVY, borderWidth: 0.8 });
    if (checked) {
      const xColor = onDark ? NAVY : NAVY;
      dl(p, x + 1.5, y + 1.5, x + 7.5, y + 7.5, 1.0, xColor);
      dl(p, x + 7.5, y + 1.5, x + 1.5, y + 7.5, 1.0, xColor);
    }
  };

  const wrapLine = (text: string, maxW: number, sz: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word;
      if (fontR.widthOfTextAtSize(test, sz) <= maxW) { cur = test; }
      else { if (cur) lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  // ── Collect rows ──
  // singleLine: true means auto-shrink font to fit on one line instead of wrapping
  interface PVRow { desc: string; amount: string | null; singleLine?: boolean }
  const rows: PVRow[] = [];
  let payTo     = '';
  let totalStr  = '';
  let payMethod = 'UOB SGD FAST / GIRO PAYMENT';

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  let dateStr = `${dd}/${mm}/${today.getFullYear()}`;

  const parseAmt = (v: string | null | undefined) => parseFloat(v?.replace(/[^0-9.]/g, '') || '0') || 0;
  const fmt = (n: number) => n.toFixed(2);
  const MONTHS_LONG = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const fmtLongDate = (raw: string) => {
    const [y, m, d] = raw.split('-');
    return `${parseInt(d)} ${MONTHS_LONG[parseInt(m) - 1]} ${y}`;
  };
  const addToMap = (m: Map<string, number>, key: string, val: number) => m.set(key, (m.get(key) ?? 0) + val);
  const mapDetail = (m: Map<string, number>) => [...m.entries()].map(([k, v]) => `${k} $${v}/-`).join(', ');
  const mapTotal  = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

  const docType = docs[0]?.document_type;

  if (docType === 'CDAS Report') {
    let dhcTotal = 0, adminTotal = 0, fuelTotal = 0;
    const washMap = new Map<string, number>();
    const repMap  = new Map<string, number>();
    const detMap  = new Map<string, number>();
    const demMap  = new Map<string, number>();
    let fuelLabel = 'EFS';

    for (const doc of docs) {
      const c = doc.cdas_report;
      if (!c) continue;
      dhcTotal   += parseAmt(c.dhc_in) + parseAmt(c.dhc_out) + parseAmt(c.dhe_in) + parseAmt(c.dhe_out);
      fuelTotal  += parseAmt(c.fuel_surcharge);
      adminTotal += parseAmt(c.data_admin_fee);
      if (c.fuel_surcharge_label) fuelLabel = c.fuel_surcharge_label;
      const k = c.container_number || '';
      const w = parseAmt(c.washing);   if (w   > 0 && k) addToMap(washMap, k, w);
      const r = parseAmt(c.repair);    if (r   > 0 && k) addToMap(repMap,  k, r);
      const det = parseAmt(c.detention); if (det > 0 && k) addToMap(detMap,  k, det);
      const dem = parseAmt(c.demurrage); if (dem > 0 && k) addToMap(demMap,  k, dem);
    }

    if (dhcTotal   > 0) rows.push({ desc: 'DHC',      amount: fmt(dhcTotal) });
    if (fuelTotal  > 0) rows.push({ desc: fuelLabel,   amount: fmt(fuelTotal) });
    if (adminTotal > 0) rows.push({ desc: 'ADMIN FEE', amount: fmt(adminTotal) });
    const wT = mapTotal(washMap); if (wT > 0) rows.push({ desc: washMap.size ? `WASHING - ${mapDetail(washMap)}`   : 'WASHING',   amount: fmt(wT) });
    const rT = mapTotal(repMap);  if (rT > 0) rows.push({ desc: repMap.size  ? `REPAIR - ${mapDetail(repMap)}`     : 'REPAIR',    amount: fmt(rT) });
    const dT = mapTotal(detMap);  if (dT > 0) rows.push({ desc: detMap.size  ? `DETENTION - ${mapDetail(detMap)}` : 'DETENTION', amount: fmt(dT) });
    const mT = mapTotal(demMap);  if (mT > 0) rows.push({ desc: demMap.size  ? `DEMURRAGE - ${mapDetail(demMap)}` : 'DEMURRAGE', amount: fmt(mT) });

    const grand = dhcTotal + fuelTotal + adminTotal + wT + rT + dT + mT;
    payTo     = 'CDAS LOGISTICS ALLIANCE LTD';
    totalStr  = fmt(grand);
    payMethod = 'CIMB - GIRO';
    const rawDate = docs[0]?.cdas_report?.invoice_date || docs[0]?.metadata?.date || '';
    if (rawDate) dateStr = fmtLongDate(rawDate);

  } else if (docType === 'Allied Report') {
    let dhcTotal = 0, dheTotal = 0, adminTotal = 0, fuelTotal = 0, dpfTotal = 0;
    const washMap = new Map<string, number>();
    const repMap  = new Map<string, number>();
    const detMap  = new Map<string, number>();
    const demMap  = new Map<string, number>();
    let fuelLabel = 'FUEL SURCHARGE';
    let dpfLabel  = 'DYNAMIC PRICE FACTOR';

    for (const doc of docs) {
      const a = doc.allied_report;
      if (!a) continue;
      dhcTotal   += parseAmt(a.dhc_in) + parseAmt(a.dhc_out);
      dheTotal   += parseAmt(a.dhe_in) + parseAmt(a.dhe_out);
      adminTotal += parseAmt(a.data_admin_fee);
      fuelTotal  += parseAmt(a.fuel_surcharge);
      dpfTotal   += parseAmt(a.dynamic_price_factor);
      if (a.fuel_surcharge_label)        fuelLabel = a.fuel_surcharge_label;
      if (a.dynamic_price_factor_label)  dpfLabel  = a.dynamic_price_factor_label;
      const k = a.container_booking_no || '';
      const w = parseAmt(a.washing);    if (w   > 0 && k) addToMap(washMap, k, w);
      const r = parseAmt(a.repair);     if (r   > 0 && k) addToMap(repMap,  k, r);
      const det = parseAmt(a.detention); if (det > 0 && k) addToMap(detMap,  k, det);
      const dem = parseAmt(a.demurrage); if (dem > 0 && k) addToMap(demMap,  k, dem);
    }

    if (dhcTotal   > 0) rows.push({ desc: 'DHC',      amount: fmt(dhcTotal) });
    if (fuelTotal  > 0) rows.push({ desc: fuelLabel,   amount: fmt(fuelTotal) });
    if (dpfTotal   > 0) rows.push({ desc: dpfLabel,    amount: fmt(dpfTotal) });
    if (dheTotal   > 0) rows.push({ desc: 'DHE',       amount: fmt(dheTotal) });
    if (adminTotal > 0) rows.push({ desc: 'ADMIN FEE', amount: fmt(adminTotal) });
    const wT = mapTotal(washMap); if (wT > 0) rows.push({ desc: washMap.size ? `WASHING - ${mapDetail(washMap)}`   : 'WASHING',   amount: fmt(wT) });
    const rT = mapTotal(repMap);  if (rT > 0) rows.push({ desc: repMap.size  ? `REPAIR - ${mapDetail(repMap)}`     : 'REPAIR',    amount: fmt(rT) });
    const dT = mapTotal(detMap);  if (dT > 0) rows.push({ desc: detMap.size  ? `DETENTION - ${mapDetail(detMap)}` : 'DETENTION', amount: fmt(dT) });
    const mT = mapTotal(demMap);  if (mT > 0) rows.push({ desc: demMap.size  ? `DEMURRAGE - ${mapDetail(demMap)}` : 'DEMURRAGE', amount: fmt(mT) });

    const grand = dhcTotal + dheTotal + adminTotal + fuelTotal + dpfTotal + wT + rT + dT + mT;
    payTo     = 'ALLIED CONTAINER (E&M) PTE LTD';
    totalStr  = fmt(grand);
    payMethod = 'CIMB - GIRO';
    const rawDate = docs[0]?.allied_report?.invoice_date || docs[0]?.metadata?.date || '';
    if (rawDate) dateStr = fmtLongDate(rawDate);

  } else {
    // Payment Voucher / GL
    const pvDocs = docs.filter(d => d.document_type === 'Payment Voucher/GL' && d.payment_voucher_details);

    for (const doc of pvDocs) {
      const pv = doc.payment_voucher_details!;
      if (pv.carrier_invoice_number)
        rows.push({ desc: `Payment Inv.  ${shortenInvoiceList(pv.carrier_invoice_number)}`, amount: null, singleLine: true });

      if (pv.bl_entries && pv.bl_entries.length > 0) {
        for (const e of pv.bl_entries) {
          const pssD = e.pss_invoice_number
            ? (e.pss_invoice_number.startsWith('#') ? e.pss_invoice_number : `#${e.pss_invoice_number}`)
            : '';
          const desc = [e.bl_number ? `BL. ${e.bl_number}` : '', pssD ? `(${pssD})` : ''].filter(Boolean).join(' ');
          rows.push({ desc, amount: e.amount ? stripCurrency(e.amount) : null });
        }
      } else if (pv.bl_number) {
        const pssD = pv.pss_invoice_number
          ? (pv.pss_invoice_number.startsWith('#') ? pv.pss_invoice_number : `#${pv.pss_invoice_number}`)
          : '';
        const desc = [pv.bl_number ? `BL. ${pv.bl_number}` : '', pssD ? `(${pssD})` : ''].filter(Boolean).join(' ');
        rows.push({ desc, amount: pv.payable_amount ? stripCurrency(pv.payable_amount) : null });
      }

      if (pv.charges_summary)
        rows.push({ desc: pv.charges_summary, amount: null, singleLine: true });
    }

    const firstPv = pvDocs[0]?.payment_voucher_details;
    payTo     = firstPv?.payment_to || pvDocs[0]?.metadata?.parties?.shipper_supplier || '';
    payMethod = firstPv?.payment_method || 'UOB SGD FAST / GIRO PAYMENT';

    // Always compute total from the actual row amounts so it stays in sync
    // even when the extraction's total_payable_amount is incomplete.
    let computedTotal = 0;
    for (const doc of pvDocs) {
      const pv = doc.payment_voucher_details!;
      if (pv.bl_entries && pv.bl_entries.length > 0) {
        for (const e of pv.bl_entries) computedTotal += parseAmt(e.amount);
      } else {
        computedTotal += parseAmt(pv.payable_amount);
      }
    }
    totalStr = computedTotal > 0 ? fmt(computedTotal) : stripCurrency(firstPv?.total_payable_amount || firstPv?.payable_amount || '');
  }

  // Pad to minimum 8 rows so all PV PDFs have a consistent table height
  const MIN_TABLE_ROWS = 8;
  while (rows.length < MIN_TABLE_ROWS) rows.push({ desc: '', amount: null });

  // ── Page header: navy left stripe + logo left-aligned + company name ──
  const drawHeader = (p: PDFPage): number => {
    let y = H - 20;

    // Outer bordered box
    dr(p, ML, y - HEADER_H, CW, HEADER_H, undefined, 1.2);
    // Left navy accent stripe
    dr(p, ML, y - HEADER_H, STRIPE_W, HEADER_H, NAVY);
    // Bottom thick stripe
    dr(p, ML, y - HEADER_H, CW, 5, NAVY);

    const logoX = ML + STRIPE_W + 8;
    if (logo) {
      const dims = logo.scaleToFit(CW - STRIPE_W - 24, HEADER_H - 10);
      p.drawImage(logo, {
        x: logoX + (CW - STRIPE_W - 16 - dims.width) / 2,
        y: y - HEADER_H + (HEADER_H - dims.height) / 2 + 2,
        width: dims.width,
        height: dims.height,
      });
    } else {
      dt(p, 'ZHENGHE LOGISTICS PTE LTD', logoX + 10, y - HEADER_H / 2 - 4, 14, fontB);
    }

    y -= HEADER_H + 8;

    // "Payment Voucher" title — no separator line below
    dt(p, 'Payment Voucher', ML, y - 13, 16, fontB);

    y -= 26;
    y -= 4;

    // Payment To / Ref / Date row — Ref: aligned horizontally with Date:
    dt(p, 'Payment To:', ML, y - 13, 9, fontB);
    dt(p, payTo, ML + 62, y - 13, 9, fontR);
    dl(p, ML + 62, y - 15, MR_X - 225, y - 15);
    dt(p, 'Ref:', MR_X - 220, y - 13, 9, fontB);
    dl(p, MR_X - 196, y - 15, MR_X - 130, y - 15);
    dt(p, 'Date:', MR_X - 120, y - 13, 9, fontB);
    dt(p, dateStr, MR_X - 95, y - 13, 9, fontR);
    dl(p, MR_X - 95, y - 15, MR_X, y - 15);

    y -= 22;

    // Table header row — navy fill, white text
    dr(p, ML, y - HDR_H, CW, HDR_H, NAVY);
    dl(p, X_DESC, y, X_DESC, y - HDR_H, 0.6, rgb(1, 1, 1));
    dl(p, X_AMT,  y, X_AMT,  y - HDR_H, 0.6, rgb(1, 1, 1));

    const hy = y - HDR_H + 6;
    const WHITE = rgb(1, 1, 1);
    dt(p, 'Item',        X_ITEM + 4, hy, 8, fontB, WHITE);
    dt(p, 'Description', X_DESC + 5, hy, 8, fontB, WHITE);

    const cx = X_AMT + 6;
    chkbox(p, cx,      hy - 1, currency === 'SGD', true);
    dt(p, 'SGD', cx + 12,     hy, 8, fontB, WHITE);
    chkbox(p, cx + 36, hy - 1, currency === 'USD', true);
    dt(p, 'USD', cx + 48,     hy, 8, fontB, WHITE);

    return y - HDR_H;
  };

  // ── Process checklist — fixed content, right column, drawn alongside footer ──
  const drawChecklist = (p: PDFPage, topY: number) => {
    const CL_W   = 268;
    const CL_X   = MR_X - CL_W;
    const REF_W  = 22;
    const STEP_W = 70;
    const REQ_W  = 143;
    const CHK_W  = CL_W - REF_W - STEP_W - REQ_W;
    const SH     = 19; // single-row height
    const DH     = 32; // double-row height

    const entries: { ref: string; step: string; req: string[] }[] = [
      { ref: '1', step: 'Authorization', req: ['Signed by Cindy /Tahir'] },
      { ref: '2', step: 'Coding',        req: ['Account code entered in system', 'Acct code:'] },
      { ref: '3', step: 'Tax',           req: ['GST 9% or Zero Rated', '[ ] GST 9%  [ ] ZERO RATED'] },
      { ref: '4', step: 'Fees',          req: ['Bank Charges recorded', '[ ] NA  [ ] $0.50  [ ] $0.20 other:'] },
      { ref: '5', step: 'Reference',     req: ['PV number written on document'] },
      { ref: '6', step: 'Filing',        req: ['Scanned and attached to system'] },
    ];
    const rowHeights = entries.map(e => e.req.length > 1 ? DH : SH);

    let cy = topY;

    // Header row
    dr(p, CL_X, cy - SH, CL_W, SH, undefined, 0.6);
    const col1 = CL_X + REF_W;
    const col2 = col1 + STEP_W;
    const col3 = col2 + REQ_W;
    [col1, col2, col3].forEach(cx => dl(p, cx, cy, cx, cy - SH, 0.5));
    const FSZ = 8;
    const hry = cy - SH + 6;
    dt(p, 'Ref',          CL_X + 3, hry, FSZ, fontB);
    dt(p, 'Process Step', col1 + 3, hry, FSZ, fontB);
    dt(p, 'Requirement',  col2 + 3, hry, FSZ, fontB);
    dt(p, 'Check',        col3 + 3, hry, FSZ, fontB);
    cy -= SH;

    for (let i = 0; i < entries.length; i++) {
      const e  = entries[i];
      const rh = rowHeights[i];
      dr(p, CL_X, cy - rh, CL_W, rh, undefined, 0.4);
      [col1, col2, col3].forEach(cx => dl(p, cx, cy, cx, cy - rh, 0.5));

      const mid = cy - rh / 2 - 3;
      dt(p, e.ref,  CL_X + (REF_W - fontR.widthOfTextAtSize(e.ref, FSZ)) / 2, mid, FSZ, fontR);
      dt(p, e.step, col1 + 3, mid, FSZ, fontB);

      if (e.req.length > 1) {
        dt(p, e.req[0], col2 + 3, cy - 10, FSZ, fontR);
        dt(p, e.req[1], col2 + 3, cy - 22, FSZ, fontR);
      } else {
        dt(p, e.req[0], col2 + 3, mid, FSZ, fontR);
      }

      // Checkbox in Check column
      dr(p, col3 + (CHK_W - 8) / 2, cy - rh / 2 - 4, 8, 8, rgb(1, 1, 1), 0.5);
      cy -= rh;
    }
  };

  // ── Footer: total row + cash/cheque + signatures (left) + checklist (right) ──
  const drawFooter = (p: PDFPage, y: number) => {
    dl(p, ML, y, MR_X, y, 0.8);

    // Total row (full width)
    dr(p, ML, y - ROW_H, CW, ROW_H, undefined, 0.8);
    dl(p, X_AMT, y, X_AMT, y - ROW_H);

    const ty = y - ROW_H + 7;
    const cx = X_AMT - 108;
    chkbox(p, cx,      ty - 1, currency === 'SGD');
    dt(p, 'SGD',  cx + 12,    ty, 8, fontB);
    chkbox(p, cx + 36, ty - 1, currency === 'USD');
    dt(p, 'USD',  cx + 48,    ty, 8, fontB);
    dt(p, 'Total', cx + 70,   ty, 8, fontB);

    if (totalStr) {
      const tw = fontB.widthOfTextAtSize(totalStr, 10);
      dt(p, totalStr, MR_X - tw - 5, ty, 10, fontB);
    }

    // LEFT COLUMN: Cash/cheque + approved/received
    let fy = y - ROW_H - 18;
    dt(p, 'CASH / CHEQUE No.:', ML, fy, 9, fontB);
    // underline stops before checklist column
    dl(p, ML + 109, fy - 2, MR_X - 212, fy - 2);
    dt(p, payMethod, ML + 112, fy, 9, fontR);

    fy -= 44;
    dt(p, 'Approved By:', ML, fy, 9, fontB);
    dl(p, ML, fy - 20, ML + 140, fy - 20);

    dt(p, 'Received By:', ML + 165, fy, 9, fontB);
    dl(p, ML + 165, fy - 20, ML + 305, fy - 20);

    // RIGHT COLUMN: process checklist pinned to bottom-right corner of page
    if (showChecklist) drawChecklist(p, 250);
  };

  // ── Render ──
  let page = pdfDoc.addPage([W, H]);
  let cursorY = drawHeader(page);

  for (const row of rows) {
    let FSZ = 9;
    let wrapped: string[];

    if (row.singleLine) {
      // Shrink font until the text fits on one line (min 6.5pt)
      while (FSZ > 6.5 && fontR.widthOfTextAtSize(row.desc, FSZ) > DESC_W - 10) FSZ -= 0.5;
      wrapped = [row.desc];
    } else {
      wrapped = wrapLine(row.desc, DESC_W - 10, FSZ);
    }

    const rh = Math.max(ROW_H, wrapped.length * (FSZ + 4) + 8);

    if (cursorY - rh < FOOTER_RESERVE) {
      page    = pdfDoc.addPage([W, H]);
      cursorY = drawHeader(page);
    }

    const rowBottom = cursorY - rh;

    dl(page, ML,     cursorY, ML,     rowBottom, 0.8);
    dl(page, MR_X,   cursorY, MR_X,   rowBottom, 0.8);
    dl(page, X_DESC, cursorY, X_DESC, rowBottom, 0.6);
    dl(page, X_AMT,  cursorY, X_AMT,  rowBottom, 0.6);
    dl(page, ML,     rowBottom, MR_X, rowBottom, 0.6);

    const textY = cursorY - FSZ - 5;
    // Item column intentionally blank — no row numbers
    wrapped.forEach((ln, i) => dt(page, ln, X_DESC + 5, textY - i * (FSZ + 3), FSZ, fontR));
    if (row.amount) {
      const aw = fontR.widthOfTextAtSize(row.amount, FSZ);
      dt(page, row.amount, MR_X - aw - 5, textY, FSZ, fontR);
    }

    cursorY = rowBottom;
  }

  drawFooter(page, cursorY);

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// Generates a preview PDF matching real OOCL data for team sign-off.
// Remove this export once the layout is approved and integrated into the live flow.
export async function generateTestPVPdf(currency: 'SGD' | 'USD' = 'SGD', showChecklist = true): Promise<Blob> {
  const dummy: any[] = [{
    document_type: 'Payment Voucher/GL',
    metadata: { reference_number: 'TEST', date: '2026-05-15', currency: 'SGD', incoterms: null, related_reference_number: null, parties: { shipper_supplier: null, consignee_buyer: null, notify_party: null } },
    payment_voucher_details: {
      carrier_invoice_number: '413 3721004, 413 3723136, 413 3723140, 413 3723388',
      payment_to: 'OOCL (SINGAPORE) PTE LTD',
      total_payable_amount: '10103.17 SGD',
      payment_method: 'UOB SGD FAST / GIRO PAYMENT',
      charges_summary: 'THC, SEALS, BL, O.F, AMS, EMERGENCY BAF, ORIG TRML',
      bl_entries: [
        { bl_number: 'OOLU2326622420', pss_invoice_number: '#26050654', amount: '1787.92 SGD' },
        { bl_number: 'OOLU2326002160', pss_invoice_number: '#26050579', amount: '1532.18 SGD' },
        { bl_number: 'OOLU2326002270', pss_invoice_number: '#26050578', amount: '1082.54 SGD' },
        { bl_number: 'OOLU2326001920', pss_invoice_number: '#26050575', amount: '2071.06 SGD' },
        { bl_number: 'OOLU2326617490', pss_invoice_number: '#26050649', amount: '1335.67 SGD' },
      ],
    },
  }];
  return generatePVPdfFromScratch(dummy, currency, showChecklist);
}
