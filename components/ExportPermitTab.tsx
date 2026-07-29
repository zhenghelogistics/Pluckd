import React, { useMemo } from 'react';
import { Download } from 'lucide-react';
import { ProcessedFile, FileStatus, ExportPermitPSSItem, DocumentData } from '../types';
import { mergePackingListsByPlNo } from '../services/mergePackingLists';

interface Props {
  files: ProcessedFile[];
}

const ExportPermitTab: React.FC<Props> = ({ files }) => {
  const items = useMemo(() => {
    // Gather every PSS doc across the processed files, remembering each doc's source filename.
    const docs: DocumentData[] = [];
    const fileOf = new Map<DocumentData, string>();
    for (const file of files) {
      if (file.status !== FileStatus.COMPLETED && file.status !== FileStatus.WARNING) continue;
      for (const doc of file.data ?? []) {
        if (doc.document_type !== 'Export Permit Declaration (PSS)') continue;
        docs.push(doc);
        fileOf.set(doc, file.file.name);
      }
    }
    // Cross-file merge: files sharing a PL No become one logical packing list (rows unioned,
    // Country of Origin back-filled, mis-placed NPBB-in-PO cleaned). Non-destructive.
    const merged = mergePackingListsByPlNo(docs);
    const result: (ExportPermitPSSItem & { _filename: string })[] = [];
    for (const doc of merged) {
      const pl = (doc.metadata?.reference_number || '').trim().toUpperCase();
      const srcNames = [...new Set(
        docs.filter(d => (d.metadata?.reference_number || '').trim().toUpperCase() === pl && pl !== '')
            .map(d => fileOf.get(d)!)
      )].join(' + ') || fileOf.get(doc) || '';
      for (const item of doc.export_permit_pss?.items ?? []) {
        result.push({ ...item, _filename: srcNames });
      }
    }
    return result;
  }, [files]);

  const exportCSV = () => {
    const headers = [
      'A. HS Code', 'B. Qty', 'C. UOM', 'D. Item Description', 'E. Product of Origin',
      'F. Nett Weight (KGS)', 'G. Nett Wt Unit', 'H. Amount', 'I. Currency',
      'J. PO Number', 'K. Invoice Number', 'Source File',
    ];
    const safe = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = items.map(item => [
      safe(item.hs_code),
      safe(item.quantity),
      safe(item.uom),
      safe(item.item_description),
      safe(item.product_of_origin),
      safe(item.nett_weight),
      safe(item.nett_weight_unit ?? 'KGS'),
      safe(item.amount),
      safe(item.currency),
      safe(item.po_number),
      safe(item.invoice_number),
      safe(item._filename),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export_permit_pss.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 rounded-xl border-2 border-dashed border-outline/30 bg-surface-lowest text-[#4a5568]">
        <p className="font-medium">No Export Permit Declaration (PSS) data extracted yet.</p>
        <p className="text-sm mt-1">Upload and process a PSS shipment bundle PDF (PO + Invoice + Packing List).</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#4a5568] font-medium">{items.length} line item{items.length !== 1 ? 's' : ''} extracted</p>
        <button
          onClick={exportCSV}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-xs font-semibold transition-colors cursor-pointer"
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl bg-surface-lowest shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-low">
              {[
                'A. HS Code', 'B. Qty', 'C. UOM', 'D. Item Description', 'E. Product of Origin',
                'F. Nett Weight (KGS)', 'G. Nett Wt Unit', 'H. Amount', 'I. Currency',
                'J. PO Number', 'K. Invoice Number',
              ].map(col => (
                <th key={col} className="text-left px-3 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className={`hover:bg-surface-low transition-colors ${i % 2 === 1 ? 'bg-surface-low/50' : ''}`}>
                <td className="px-3 py-2 text-primary font-mono">{item.hs_code ?? '—'}</td>
                <td className="px-3 py-2 text-primary">{item.quantity ?? '—'}</td>
                <td className="px-3 py-2 text-primary">{item.uom ?? '—'}</td>
                <td className="px-3 py-2 text-primary max-w-xs">{item.item_description ?? '—'}</td>
                <td className="px-3 py-2 text-primary">{item.product_of_origin ?? '—'}</td>
                <td className="px-3 py-2 text-primary">{item.nett_weight ?? '—'}</td>
                <td className="px-3 py-2 text-primary">{item.nett_weight_unit ?? 'KGS'}</td>
                <td className="px-3 py-2 text-primary">{item.amount ?? '—'}</td>
                <td className="px-3 py-2 text-primary">{item.currency ?? '—'}</td>
                <td className="px-3 py-2 text-primary font-mono">{item.po_number ?? '—'}</td>
                <td className="px-3 py-2 text-primary font-mono">{item.invoice_number ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExportPermitTab;
