// Browser-side PDF text-layer extraction via pdfjs-dist.
// Returns the document's embedded text (empty string if the PDF is a pure scan with no text layer).
// Used as the reliable "code reader" that feeds services/packingListParser.ts and the cross-check.
//
// NOTE: this module pulls in pdfjs — import it DYNAMICALLY at call sites (not at module top of
// claudeService) so unit tests never have to load the pdfjs worker.
import * as pdfjs from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL for the worker.
// @ts-ignore - `?url` is a Vite import suffix, not a real module path
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl as string;

export interface PdfTextResult {
  text: string;
  pages: number;
  error?: string;
}

export async function extractPdfText(file: File): Promise<PdfTextResult> {
  try {
    const data = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data }).promise;
    let text = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it: any) => ('str' in it ? it.str : '')).join(' ') + '\n';
    }
    return { text, pages: doc.numPages };
  } catch (e: any) {
    return { text: '', pages: 0, error: e?.message || 'PDF text extraction failed' };
  }
}
