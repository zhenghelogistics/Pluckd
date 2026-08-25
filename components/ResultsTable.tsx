import React, { useState, useEffect } from 'react';
import { ProcessedFile, FileStatus, DocumentData } from '../types';
import { AppConfig, labelFor } from '../config';

const TAB_SHORT_LABEL: Record<string, string> = {
  'All Files': 'All',
  'All': 'All',
  'Logistics Local Charges Report': 'LCR',
  'Outward Permit Declaration': 'OPD',
  'Export Permit Declaration (PSS)': 'PSS',
  'Payment Voucher/GL': 'PV/GL',
  'Bill of Lading': 'BL',
  'CDAS Report': 'CDAS',
  'Allied Report': 'Allied',
  'Commercial Invoice': 'Invoice',
  'Packing List': 'PL',
  'Purchase Order': 'PO',
};
import { CheckCircle, AlertTriangle, Clock, XCircle, Loader2, Trash2, FileText, RefreshCw, Copy } from 'lucide-react';
import { LumaSpin } from './ui/luma-spin';
import { UserRole } from '../users';

interface ResultsTableProps {
  files: ProcessedFile[];
  onUpdateIncoterm: (fileId: string, docIndex: number, value: string) => void;
  onUpdateFreightTerm: (fileId: string, docIndex: number, value: string) => void;
  onUpdatePSSNumber?: (fileId: string, docIndex: number, entryIndex: number, value: string) => void;
  onDeleteFile: (fileId: string) => void;
  onBulkDelete: (ids: string[]) => void;
  onGenerateVoucher?: (docs: DocumentData[]) => void;
  onReprocessFile?: (id: string) => void;
  onRetryFailedChunks?: (id: string) => void;
  isGeneratingPdf?: boolean;
  activeTab: string;
  userRole: UserRole | null;
}

const ResultsTable: React.FC<ResultsTableProps> = ({ files, onUpdateIncoterm, onUpdateFreightTerm, onUpdatePSSNumber, onDeleteFile, onBulkDelete, onGenerateVoucher, onReprocessFile, onRetryFailedChunks, isGeneratingPdf, activeTab, userRole }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [errorPopover, setErrorPopover] = useState<{ fileId: string; errors: string[] } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyErrorReport = (file: ProcessedFile) => {
    const time = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
    const report = [
      '--- PLUCKD ERROR REPORT ---',
      `File:    ${file.file.name}`,
      `Time:    ${time}`,
      `Message: ${file.errorMessage || 'Processing failed'}`,
      `Stage:   ${file.stage || 'unknown'}`,
      '---------------------------',
      'Paste this into Claude Code to get a fix.',
    ].join('\n');
    navigator.clipboard.writeText(report).then(() => {
      setCopiedId(file.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (allIds: string[]) => {
    const allSelected = allIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  if (files.length === 0) {
    return null;
  }

  // We need to flatten the files structure for display, because 1 file might = 3 documents
  const flattenedRows: { file: ProcessedFile; data: DocumentData; docIndex: number }[] = [];

  files.forEach(file => {
    if (file.status === FileStatus.COMPLETED || file.status === FileStatus.WARNING) {
      if (file.data && file.data.length > 0) {
        file.data.forEach((doc, index) => {
          flattenedRows.push({ file, data: doc, docIndex: index });
        });
      } else {
        // Fallback if no docs found but status is complete (rare)
      }
    } else {
      // For pending/processing/error, we just show one row per file
      // We create a dummy data object for display purposes if needed, or handle in render
    }
  });

  // Helper to render status badge
  const renderStatusBadge = (status: FileStatus, validationErrors?: string[], fileId?: string, extractionWarnings?: string[]) => {
    switch (status) {
      case FileStatus.COMPLETED:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary-fixed text-on-secondary-container">
            <CheckCircle size={14} className="mr-1" />
            Done
          </span>
        );
      case FileStatus.WARNING: {
        const hasExtractionWarnings = extractionWarnings && extractionWarnings.length > 0;
        const allWarnings = [...(extractionWarnings ?? []), ...(validationErrors ?? [])];
        return (
          <button
            type="button"
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
              hasExtractionWarnings
                ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
            onClick={() => {
              if (fileId && allWarnings.length > 0) {
                setErrorPopover(prev => prev?.fileId === fileId ? null : { fileId, errors: allWarnings });
              }
            }}
          >
            <AlertTriangle size={14} className="mr-1" />
            {hasExtractionWarnings ? 'Incomplete' : 'Warning'}
            {allWarnings.length > 0 && ` (${allWarnings.length})`}
          </button>
        );
      }
      case FileStatus.PROCESSING:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary-fixed text-secondary">
            <Loader2 size={14} className="mr-1 animate-spin" />
            Processing
          </span>
        );
      case FileStatus.PENDING:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-container text-[#4a5568]">
            <Clock size={14} className="mr-1" />
            Pending
          </span>
        );
      case FileStatus.ERROR:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircle size={14} className="mr-1" />
            Error
          </span>
        );
      default:
        return null;
    }
  };

  // Helper to render specific cell data based on type
  const renderDynamicCell = (header: string, data: DocumentData, fileId: string, docIndex: number) => {
    switch (header) {
      // Logistics Team Specifics
      case 'A. BL NUMBER': return data.logistics_local_charges?.bl_number || data.metadata?.reference_number || '-';
      case 'B. CARRIER / FORWARDER': return data.logistics_local_charges?.carrier_forwarder || '-';
      case 'C. PSS INVOICE NUMBER': return data.logistics_local_charges?.pss_invoice_number || '-';
      case 'D. FREIGHT TERM': {
        const currentFreightTerm = data.logistics_local_charges?.freight_term || '';
        return (
          <select
            value={currentFreightTerm}
            onChange={(e) => onUpdateFreightTerm(fileId, docIndex, e.target.value)}
            className="block w-28 rounded-md border border-outline/20 py-1 pl-2 pr-6 text-xs text-primary focus:ring-2 focus:ring-secondary/20 focus:border-secondary sm:text-xs sm:leading-6 outline-none"
          >
            <option value="">Select</option>
            <option value="PREPAID">PREPAID</option>
            <option value="COLLECT">COLLECT</option>
          </select>
        );
      }
      case 'E. PLACE OF DESTINATION': return data.logistics_local_charges?.place_of_destination || '-';
      case 'F. CNTR TYPE': return data.logistics_local_charges?.container_type || '-';
      case 'G. CONTAINER QTY': return data.logistics_local_charges?.container_qty || '-';
      case 'H. (SGD) THC': return data.logistics_local_charges?.thc_amount || '-';
      case 'I. (SGD) SEAL FEE': return data.logistics_local_charges?.seal_fee || '-';
      case 'J. (SGD) BL FEE': return data.logistics_local_charges?.bl_fee || '-';
      case 'K. (SGD) BL PRINTED FEE': return data.logistics_local_charges?.bl_printed_fee || '-';
      case 'L. (SGD) ENS / AMS / SCMC': return data.logistics_local_charges?.ens_ams_fee || '-';
      case 'M. (SGD) OTHERS CHARGES': return data.logistics_local_charges?.other_charges || '-';
      case 'N. REMARKS': return data.logistics_local_charges?.remarks || '-';
      case 'O. TOTAL AMOUNT': return data.logistics_local_charges?.total_payable_amount || '-';

      // Payment Voucher Specifics
      case "PSS's Invoice #": return data.payment_voucher_details?.pss_invoice_number || '-';
      case "Carrier/Forwarder Inv #": return data.payment_voucher_details?.carrier_invoice_number || data.metadata?.reference_number || '-';
      case "BL Number": return data.payment_voucher_details?.bl_number || data.metadata?.related_reference_number || data.metadata?.reference_number || '-';
      case "Payable Amount": {
        const raw = data.payment_voucher_details?.payable_amount || (data.financials?.total_amount ? `${data.financials.total_amount.toLocaleString()} ${data.metadata?.currency || ''}` : '-');
        return typeof raw === 'string' ? raw.replace(/SGD\s*/gi, '').trim() || '-' : raw;
      }
      case "Total Payable Amount": {
        const raw = data.payment_voucher_details?.total_payable_amount || '-';
        return typeof raw === 'string' ? raw.replace(/SGD\s*/gi, '').trim() || '-' : raw;
      }
      case "Charges": return data.payment_voucher_details?.charges_summary || data.financials?.line_item_charges?.map(c => `${c.description}: ${c.amount}`).join('; ') || '-';
      
      // Outward Permit Declaration
      case 'BL number': return data.outward_permit_declaration?.bl_number || '-';
      case 'Carrier': return data.outward_permit_declaration?.carrier || '-';
      case 'Consignee': return data.outward_permit_declaration?.consignee || data.metadata?.parties?.consignee_buyer || '-';
      case 'Container No': return data.outward_permit_declaration?.container_no || '-';
      case 'Seal No': return data.outward_permit_declaration?.seal_no || '-';
      case 'Ctnr Type': return data.outward_permit_declaration?.container_type || '-';
      case 'Final Destination (Port Code)': return data.outward_permit_declaration?.final_destination_port || '-';
      case 'Vessel Name': return data.outward_permit_declaration?.vessel_name || '-';
      case 'Voyage': return data.outward_permit_declaration?.voyage || '-';
      case 'HS code': return data.outward_permit_declaration?.hs_code || '-';
      case 'Description': return data.outward_permit_declaration?.description || '-';
      case 'Net Weight': return data.outward_permit_declaration?.net_weight_kgs || `${data.cargo_details?.total_net_weight || ''} ${data.cargo_details?.weight_unit || ''}`.trim() || '-';
      case 'Value Amount': return data.outward_permit_declaration?.item_price_amount || '-';
      case 'Value Currency': return data.outward_permit_declaration?.item_price_currency || '-';
      case 'Total Outer Pack Qty': return data.outward_permit_declaration?.total_outer_pack_qty || '-';
      case 'Total Outer Pack Unit': return data.outward_permit_declaration?.total_outer_pack_unit || '-';
      case 'Gross Weight Amount': return data.outward_permit_declaration?.gross_weight_amount || '-';
      case 'Gross Weight Unit': return data.outward_permit_declaration?.gross_weight_unit || '-';

      // Allied Report
      case 'Container/Booking No': return data.allied_report?.container_booking_no || '-';
      case 'DHC In': return data.allied_report?.dhc_in || data.cdas_report?.dhc_in || '-';
      case 'DHC Out': return data.allied_report?.dhc_out || data.cdas_report?.dhc_out || '-';
      case 'DHE In': return data.allied_report?.dhe_in || data.cdas_report?.dhe_in || '-';
      case 'DHE Out': return data.allied_report?.dhe_out || data.cdas_report?.dhe_out || '-';
      case 'Data Admin Fee': return data.allied_report?.data_admin_fee || data.cdas_report?.data_admin_fee || '-';
      case 'Repair': return data.payment_voucher_details?.repair || data.allied_report?.repair || data.cdas_report?.repair || '-';
      case 'Detention': return data.payment_voucher_details?.detention || data.allied_report?.detention || data.cdas_report?.detention || '-';
      case 'Demurrage': return data.allied_report?.demurrage || data.cdas_report?.demurrage || '-';
      case 'Washing': return data.allied_report?.washing || data.cdas_report?.washing || '-';
      case 'Fuel Surcharge': {
        const amt = data.allied_report?.fuel_surcharge || data.cdas_report?.fuel_surcharge;
        const lbl = data.allied_report?.fuel_surcharge_label || data.cdas_report?.fuel_surcharge_label;
        return amt ? (lbl ? `${amt} (${lbl})` : amt) : '-';
      }
      case 'Dyn. Price Factor': {
        const amt = data.allied_report?.dynamic_price_factor;
        const lbl = data.allied_report?.dynamic_price_factor_label;
        return amt ? (lbl ? `${amt} (${lbl})` : amt) : '-';
      }

      // CDAS Report container number
      case 'Container Number': return data.cdas_report?.container_number || '-';

      // Bill of Lading Specifics
      // BL Number is already handled above in Payment Voucher section
      case 'Shipper': return data.metadata?.parties?.shipper_supplier || '-';
      case 'Vessel/Voyage': return `${data.logistics_details?.vessel_name || ''} ${data.logistics_details?.voyage_number || ''}`.trim() || '-';
      case 'POL': return data.logistics_details?.port_of_loading || data.outward_permit_declaration?.port_of_loading || '-';
      case 'POD': return data.logistics_details?.port_of_discharge || data.outward_permit_declaration?.port_of_discharge || '-';

      // Commercial Invoice Specifics
      case 'Invoice #': return data.metadata?.reference_number || '-';
      case 'Supplier': return data.metadata?.parties?.shipper_supplier || '-';
      case 'Buyer': return data.metadata?.parties?.consignee_buyer || '-';
      case 'Total Amount': return data.financials?.total_amount?.toLocaleString() || '-';
      case 'Currency': return data.metadata?.currency || '-';
      case 'Incoterms':
        const currentIncoterm = data.metadata?.incoterms || '';
        const isCustomValue = currentIncoterm && !AppConfig.validation.incotermsList.includes(currentIncoterm);
        return (
           <select
            value={currentIncoterm}
            onChange={(e) => onUpdateIncoterm(fileId, docIndex, e.target.value)}
            className="block w-24 rounded-md border border-outline/20 py-1 pl-2 pr-6 text-xs text-primary focus:ring-2 focus:ring-secondary/20 focus:border-secondary sm:text-xs sm:leading-6 outline-none"
          >
            <option value="">Select</option>
            {isCustomValue && <option value={currentIncoterm}>{currentIncoterm}</option>}
            {AppConfig.validation.incotermsList.map(term => (
              <option key={term} value={term}>{term}</option>
            ))}
          </select>
        );

      // Packing List
      case 'Ref #': return data.metadata?.reference_number || '-';
      case 'Seller': return data.metadata?.parties?.shipper_supplier || '-';
      case 'Total Packages': return data.cargo_details?.total_packages || '-';
      case 'Gross Weight': return `${data.cargo_details?.total_gross_weight || ''} ${data.cargo_details?.weight_unit || ''}`;
      case 'Marks': return data.logistics_details?.marks_and_numbers || '-';

      // PO
      case 'PO Number': return data.metadata?.reference_number || '-';
      case 'Date': return data.metadata?.date || '-';
      case 'Delivery Date': return '-'; 
      
      // Default
      default: return '-';
    }
  };

  // Filter based on active tab
  const displayRows = activeTab === 'All' 
    ? flattenedRows 
    : flattenedRows.filter(row => row.data.document_type === activeTab);

  // Special handling for "All Files" tab - Show one row per FILE, not per document
  if (activeTab === 'All Files') {
    const allFileIds = files.map(f => f.id);
    const allSelected = allFileIds.length > 0 && allFileIds.every(id => selectedIds.has(id));

    return (
      <div className="space-y-2">
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 bg-red-50 rounded-lg">
            <span className="text-sm text-red-700 font-medium">{selectedIds.size} selected</span>
            <button
              type="button"
              onClick={() => onBulkDelete(Array.from(selectedIds))}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-md transition-colors"
            >
              <Trash2 size={13} /> Delete Selected
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-red-500 hover:text-red-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="overflow-hidden rounded-xl bg-surface-lowest shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-surface-low">
                <tr>
                  <th scope="col" className="px-3 py-3 pl-4">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => handleSelectAll(allFileIds)}
                      className="rounded border-outline/30 text-red-600 focus:ring-red-500 cursor-pointer"
                    />
                  </th>
                  {['File Name', 'Status', 'Document Types Found', 'Upload Date', 'Actions'].map(header => (
                    <th key={header} scope="col" className="px-3 py-3 text-left text-xs font-semibold text-[#4a5568] uppercase tracking-wider">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-surface-lowest">
                {files.map(file => {
                  const typesFound = file.data
                    ? Array.from(new Set(file.data.map(d => labelFor(d.document_type)))).join(', ')
                    : '-';
                  return (
                    <tr key={file.id} className={`hover:bg-surface-low transition-colors ${selectedIds.has(file.id) ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-3.5 pl-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(file.id)}
                          onChange={() => toggleSelect(file.id)}
                          className="rounded border-outline/30 text-red-600 focus:ring-red-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 pr-3 text-sm font-medium text-primary max-w-xs">
                        <div className="flex flex-col gap-1">
                          <span className="truncate">{file.file.name}</span>
                          {file.docType && file.docType !== 'All Files' && file.docType !== 'All' && (
                            <span className="inline-flex w-fit items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary-fixed/30 text-secondary border border-secondary/20">
                              {TAB_SHORT_LABEL[file.docType] ?? file.docType}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-sm">
                        <div className="relative inline-block">
                          {renderStatusBadge(file.status as FileStatus, file.validationErrors, file.id, file.extractionWarnings)}
                          {errorPopover?.fileId === file.id && (
                            <div className="absolute z-50 left-0 top-full mt-1 w-80 bg-surface-lowest border border-amber-100 rounded-lg shadow-lg p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-amber-700">
                                  {file.extractionWarnings?.length ? 'Some entries may be missing' : 'Warnings'}
                                </span>
                                <button type="button" onClick={() => setErrorPopover(null)} className="text-outline hover:text-primary text-xs">✕</button>
                              </div>
                              <ul className="space-y-1 mb-3">
                                {errorPopover.errors.map((e, i) => (
                                  <li key={i} className="text-xs text-primary bg-amber-50 rounded px-2 py-1">{e}</li>
                                ))}
                              </ul>
                              {file.extractionWarnings?.length > 0 && file.file.size > 0 && (onRetryFailedChunks || onReprocessFile) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setErrorPopover(null);
                                    if (onRetryFailedChunks && file.failedChunkIndices?.length) {
                                      onRetryFailedChunks(file.id);
                                    } else if (onReprocessFile) {
                                      onReprocessFile(file.id);
                                    }
                                  }}
                                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                                >
                                  <RefreshCw size={12} />
                                  {file.failedChunkIndices?.length
                                    ? `Retry ${file.failedChunkIndices.length} failed batch${file.failedChunkIndices.length > 1 ? 'es' : ''}`
                                    : 'Retry extraction'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-sm text-[#4a5568] max-w-xs">
                        {file.status === FileStatus.ERROR
                          ? (
                            <div className="flex items-start gap-2">
                              <span className="text-red-500 text-xs font-mono leading-snug">{file.errorMessage || 'Processing failed — try re-uploading'}</span>
                              <button
                                type="button"
                                title="Copy error report"
                                onClick={() => copyErrorReport(file)}
                                className="shrink-0 text-outline hover:text-secondary transition-colors cursor-pointer mt-0.5"
                              >
                                {copiedId === file.id ? <CheckCircle size={13} className="text-secondary" /> : <Copy size={13} />}
                              </button>
                            </div>
                          )
                          : typesFound}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-sm text-[#4a5568]">{new Date().toLocaleDateString()}</td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-sm text-right">
                        <div className="flex items-center justify-end gap-2">
                          {file.file.size > 0 && onReprocessFile && (
                            <button
                              type="button"
                              title="Re-run extraction"
                              onClick={(e) => { e.stopPropagation(); onReprocessFile(file.id); }}
                              className="text-outline hover:text-secondary cursor-pointer transition-colors"
                            >
                              <RefreshCw size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDeleteFile(file.id); }}
                            className="text-outline hover:text-red-600 cursor-pointer transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Also include processing/error files in "All" view only
  const processingFiles = activeTab === 'All' ? files.filter(f => f.status !== FileStatus.COMPLETED && f.status !== FileStatus.WARNING) : [];

  if (displayRows.length === 0 && processingFiles.length === 0) {
    return (
      <div className="text-center text-sm text-[#4a5568] py-12 border-2 border-dashed border-outline/30 rounded-xl bg-surface-lowest">
        No documents found for <span className="font-medium text-primary">{activeTab}</span>
      </div>
    );
  }

  // Determine Columns
  let dynamicHeaders: string[] = [];
  
  // Strict Role-Based Column Selection
  if (activeTab === 'All Files') {
     dynamicHeaders = ['File Name', 'Status', 'Document Types Found', 'Upload Date', 'Actions'];
  } else if (activeTab !== 'All' && AppConfig.views[activeTab as keyof typeof AppConfig.views]) {
    dynamicHeaders = [...AppConfig.views[activeTab as keyof typeof AppConfig.views].columns, 'Actions'];
  } else {
    // Fallback for 'All' or unknown tabs (though 'All' should be hidden for strict roles)
    dynamicHeaders = ['Type', 'Ref #', 'Date', 'Entity', 'Amount/Details', 'Source File', 'Status', 'Actions']; 
  }

  const allVisibleIds = Array.from(new Set(displayRows.map(r => r.file.id)));
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selectedIds.has(id));

  return (
    <div className="space-y-2">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-50 rounded-lg">
          <span className="text-sm text-red-700 font-medium">{selectedIds.size} file(s) selected</span>
          <button
            type="button"
            onClick={() => onBulkDelete(Array.from(selectedIds))}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-md transition-colors"
          >
            <Trash2 size={13} /> Delete Selected
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-red-500 hover:text-red-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    <div className="overflow-hidden rounded-xl bg-surface-lowest shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-surface-low">
            <tr>
              <th scope="col" className="px-3 py-3 pl-4">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => handleSelectAll(allVisibleIds)}
                  className="rounded border-outline/30 text-red-600 focus:ring-red-500 cursor-pointer"
                />
              </th>
              {dynamicHeaders.map(header => (
                 <th key={header} scope="col" className="px-3 py-3 text-left text-xs font-semibold text-[#4a5568] uppercase tracking-wider">
                   {header}
                 </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-surface-lowest">
            {/* Render Processing Files first (if in All tab) */}
            {processingFiles.map(file => (
              <tr key={file.id}>
                <td colSpan={dynamicHeaders.length + 1} className="py-8 px-4">
                  {file.status === FileStatus.ERROR ? (
                    <div className="flex items-center gap-2 justify-center text-sm text-red-500">
                      <XCircle size={14} />
                      {file.errorMessage || 'Unknown Error'}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 w-full max-w-xs">
                      <LumaSpin color="#091426" />
                      <p className="text-sm font-medium text-primary">{file.stage || 'Analysis in progress'}</p>
                      {file.progress != null && (
                        <div className="w-full">
                          <div className="flex justify-between text-xs text-[#4a5568] mb-1">
                            <span>{file.file.name}</span>
                            <span>{file.progress}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-surface-low rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-500"
                              style={{ width: `${file.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {file.progress == null && <p className="text-xs text-[#4a5568]">{file.file.name}</p>}
                    </div>
                  )}
                </td>
              </tr>
            ))}

            {/* Render Completed/Warning Rows */}
            {displayRows.map((row) => {
              const uniqueKey = `${row.file.id}-${row.docIndex}`;
              const d = row.data;
              const blEntries = activeTab === 'Payment Voucher/GL' ? (d.payment_voucher_details?.bl_entries ?? []) : [];
              const isCombined = blEntries.length > 1;

              return (
              <React.Fragment key={uniqueKey}>
              <tr className={`transition-colors ${selectedIds.has(row.file.id) ? 'bg-red-50' : isCombined ? 'bg-secondary-fixed/20 hover:bg-secondary-fixed/40' : 'hover:bg-surface-low'}`}>
                <td className="px-3 py-3.5 pl-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.file.id)}
                    onChange={() => toggleSelect(row.file.id)}
                    className="rounded border-outline/30 text-red-600 focus:ring-red-500 cursor-pointer"
                  />
                </td>
                {activeTab === 'All' && userRole !== 'logistics' ? (
                   // Generic Row for "All" view
                   <>
                    <td className="whitespace-nowrap py-3.5 pr-3 text-sm font-medium text-primary">{labelFor(d.document_type)}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-[#4a5568]">{d.metadata?.reference_number || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-[#4a5568]">{d.metadata?.date || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-[#4a5568]" title={d.metadata?.parties?.shipper_supplier || ''}>
                      {d.metadata?.parties?.shipper_supplier ? d.metadata.parties.shipper_supplier.substring(0, 15) + '...' : '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-[#4a5568]">
                       {d.financials?.total_amount ? d.financials.total_amount : d.cargo_details?.total_gross_weight ? `${d.cargo_details.total_gross_weight} kg` : '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-xs text-outline">
                       {row.file.file.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm">
                      {renderStatusBadge(row.file.status as FileStatus)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteFile(row.file.id);
                        }}
                        className="text-outline hover:text-red-600 cursor-pointer transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                   </>
                ) : (
                  // Specific Row for Typed view OR Logistics View
                  <>
                    {dynamicHeaders.slice(0, -1).map((header, idx) => (
                      <td key={idx} className="whitespace-nowrap px-3 py-3.5 text-sm text-[#4a5568] first:pl-4 sm:first:pl-5">
                        {renderDynamicCell(header, d, row.file.id, row.docIndex)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-right">
                      <div className="flex items-center justify-end gap-2">
                        {activeTab === 'Payment Voucher/GL' && d && (<>
                          {onGenerateVoucher && (
                            <button
                              type="button"
                              title="Download PDF voucher"
                              disabled={isGeneratingPdf}
                              onClick={(e) => { e.stopPropagation(); onGenerateVoucher([d]); }}
                              className="text-outline hover:text-secondary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            >
                              {isGeneratingPdf ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                            </button>
                          )}
                        </>)}
                        {(activeTab === 'Allied Report' || activeTab === 'CDAS Report') && onGenerateVoucher && (() => {
                          const fileDocs = (row.file.data ?? []).filter(doc => doc.document_type === activeTab);
                          return fileDocs.length > 0 ? (
                            <button
                              type="button"
                              title={`Download ${activeTab} payment voucher for this file`}
                              disabled={isGeneratingPdf}
                              onClick={(e) => { e.stopPropagation(); onGenerateVoucher(fileDocs); }}
                              className="text-outline hover:text-secondary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            >
                              {isGeneratingPdf ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                            </button>
                          ) : null;
                        })()}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteFile(row.file.id);
                          }}
                          className="text-outline hover:text-red-600 cursor-pointer transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
              {/* Child rows for each BL entry in a combined PV */}
              {isCombined && blEntries.map((entry, ei) => (
                <tr key={`${uniqueKey}-entry-${ei}`} className="bg-secondary-fixed/10 hover:bg-secondary-fixed/20 border-l-2 border-secondary-container">
                  <td className="px-3 py-2 pl-4" />
                  {/* PSS's Invoice # — editable inline when missing */}
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[#4a5568] pl-8">
                    <span className="text-secondary mr-1">↳</span>
                    {entry.pss_invoice_number ? (
                      entry.pss_invoice_number
                    ) : onUpdatePSSNumber ? (
                      <input
                        type="text"
                        placeholder="#SI number"
                        defaultValue=""
                        onBlur={e => { const v = e.target.value.trim(); if (v) onUpdatePSSNumber(row.file.id, row.docIndex, ei, v.startsWith('#') ? v : `#${v}`); }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-24 px-1.5 py-0.5 text-xs border border-dashed border-outline/40 rounded bg-transparent text-primary placeholder:text-outline/50 focus:outline-none focus:border-secondary"
                      />
                    ) : '-'}
                  </td>
                  {/* Carrier/Forwarder Inv # — not on individual entry */}
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-outline">-</td>
                  {/* BL Number */}
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[#4a5568]">{entry.bl_number || '-'}</td>
                  {/* Payable Amount */}
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[#4a5568]">{entry.amount || '-'}</td>
                  {/* Total Payable Amount — same as amount at entry level */}
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-outline">-</td>
                  {/* Charges — not at entry level */}
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-outline">-</td>
                  {/* Actions — individual voucher download */}
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                    {onGenerateVoucher && (() => {
                      const singleDoc: DocumentData = {
                        ...d,
                        payment_voucher_details: {
                          ...d.payment_voucher_details,
                          carrier_invoice_number: entry.pss_invoice_number || null,
                          bl_number: entry.bl_number || null,
                          pss_invoice_number: entry.pss_invoice_number || null,
                          payable_amount: entry.amount || null,
                          total_payable_amount: entry.amount || null,
                          bl_entries: null,
                        },
                      };
                      return (
                        <button
                          type="button"
                          title={`PDF voucher for ${entry.pss_invoice_number || entry.bl_number || 'this entry'}`}
                          disabled={isGeneratingPdf}
                          onClick={(e) => { e.stopPropagation(); onGenerateVoucher([singleDoc]); }}
                          className="text-secondary-container hover:text-secondary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                        >
                          {isGeneratingPdf ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                        </button>
                      );
                    })()}
                    </div>
                  </td>
                </tr>
              ))}
              </React.Fragment>
            )})}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
};

export default ResultsTable;