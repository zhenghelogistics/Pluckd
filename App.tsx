import React, { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useFileProcessor } from './hooks/useFileProcessor';
import ResultsTable from './components/ResultsTable';
import CrmBillingTab from './components/CrmBillingTab';
import ExportPermitTab from './components/ExportPermitTab';
import { generatePVPdfFromScratch, generateRVPdfFromScratch } from './services/voucherPdfService';
import { mergePackingListsByPlNo } from './services/mergePackingLists';
import DeveloperNotes from './components/DeveloperNotes';
import LoginScreen from './components/LoginScreen';
import CustomRulesPanel from './components/CustomRulesPanel';
import { FileStatus, DocumentData } from './types';
import { AppConfig, labelFor } from './config';
import { UserRole } from './users';
// @ts-ignore
import JSZip from 'jszip';
import ConfirmationModal from './components/ConfirmationModal';
import ToastStack, { Toast } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import { LumaSpin } from './components/ui/luma-spin';
import {
  User, LogOut, Upload, Zap, Download, FileText, Loader2,
  FolderOpen, LayoutDashboard, Receipt, FileCheck2, CreditCard,
  Anchor, Package, ShoppingCart, Code2, ClipboardList, ScrollText,
} from 'lucide-react';

declare const __COMMIT_HASH__: string;

const CUSTOM_RULES_STORAGE_KEY = 'zhenghe_custom_rules';

const TAB_ICONS: Record<string, React.ReactNode> = {
  'All Files': <FolderOpen size={15} />,
  'All': <LayoutDashboard size={15} />,
  'Logistics Local Charges Report': <Receipt size={15} />,
  'Outward Permit Declaration': <FileCheck2 size={15} />,
  'Payment Voucher/GL': <CreditCard size={15} />,
  'Bill of Lading': <Anchor size={15} />,
  'Commercial Invoice': <FileText size={15} />,
  'Packing List': <Package size={15} />,
  'Purchase Order': <ShoppingCart size={15} />,
  'Developer Notes': <Code2 size={15} />,
  'CRM Billing': <ClipboardList size={15} />,
  'Export Permit Declaration (PSS)': <ScrollText size={15} />,
};

const TAB_SHORT_LABEL: Record<string, string> = {
  'All Files': 'All',
  'All': 'All',
  'Logistics Local Charges Report': 'LCR',
  'Outward Permit Declaration': 'Export Team Permits',
  'Export Permit Declaration (PSS)': 'Import Team Permits',
  'Payment Voucher/GL': 'PV/GL',
  'Bill of Lading': 'BL',
  'CDAS Report': 'CDAS',
  'Allied Report': 'Allied',
  'Commercial Invoice': 'Invoice',
  'Packing List': 'PL',
  'Purchase Order': 'PO',
};

function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = (message: string) => {
    const timestamp = new Date().toISOString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const [customRules, setCustomRules] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_RULES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  useEffect(() => {
    localStorage.setItem(CUSTOM_RULES_STORAGE_KEY, JSON.stringify(customRules));
  }, [customRules]);

  const [isDragging, setIsDragging] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pvCurrencyModal, setPvCurrencyModal] = useState(false);
  const [pvExportDocs, setPvExportDocs] = useState<DocumentData[] | null>(null);
  const [pvExportType, setPvExportType] = useState<'pv' | 'rv'>('pv');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = (message: string, type: 'error' | 'success' = 'error') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
  };
  const dismissToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  const {
    userRole, setUserRole, isAdmin, isSessionLoading,
    activeTab, setActiveTab, tabs, handleLogin, handleLogout, getTeamName,
  } = useAuth(() => { setLogs([]); });

  const {
    files, isProcessing, containerRecords,
    deleteModalOpen, setDeleteModalOpen,
    addFilesToQueue, processFiles, handleReprocess, handleRetryFailedChunks,
    handleIncotermUpdate, handleFreightTermUpdate, handlePSSNumberUpdate,
    handleDeleteFile, handleBulkDelete, confirmDeleteFile,
    handleContainerRecordUpdate, handleContainerRecordDelete, handleContainerRecordDeleteMany,
  } = useFileProcessor({ customRules, userRole, addLog, activeTab });

  // Deploy update detection
  useEffect(() => {
    const mainScript = document.querySelector<HTMLScriptElement>('script[src*="/assets/"]');
    if (!mainScript) return;
    const currentPath = new URL(mainScript.src).pathname;
    const check = async () => {
      try {
        const res = await fetch(`/?_=${Date.now()}`, { cache: 'no-store' });
        const html = await res.text();
        if (!html.includes(currentPath)) setUpdateAvailable(true);
      } catch { /* ignore */ }
    };
    const id = setInterval(check, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    addFilesToQueue(Array.from(event.target.files));
    event.target.value = '';
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); addFilesToQueue(Array.from(e.dataTransfer.files)); };

  const handleGenerateVouchers = (docs: DocumentData[], type: 'pv' | 'rv' = 'pv') => {
    setPvExportDocs(docs);
    setPvExportType(type);
    setPvCurrencyModal(true);
  };

  const handlePVCurrencySelect = async (currency: 'SGD' | 'USD') => {
    setPvCurrencyModal(false);
    const docsToExport = pvExportDocs;
    setPvExportDocs(null);
    if (!docsToExport || docsToExport.length === 0) return;
    setIsGeneratingPdf(true);
    try {
      const isRv = pvExportType === 'rv';
      const blob = isRv
        ? await generateRVPdfFromScratch(docsToExport, currency)
        : await generatePVPdfFromScratch(docsToExport, currency, userRole === 'accounts');
      const docType = docsToExport[0]?.document_type;
      const filename = isRv
        ? `receipt_voucher_${currency}.pdf`
        : docType === 'CDAS Report'
          ? `cdas_voucher_${currency}.pdf`
          : docType === 'Allied Report'
            ? `allied_voucher_${currency}.pdf`
            : docsToExport.length === 1
              ? `voucher_${docsToExport[0].payment_voucher_details?.pss_invoice_number || 'export'}_${currency}.pdf`
              : `payment_vouchers_${currency}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast('Failed to generate voucher PDF. Check console.');
      console.error(err);
    } finally { setIsGeneratingPdf(false); }
  };

  const downloadReport = async () => {
    const allDocuments: { data: DocumentData; filename: string }[] = [];
    files.forEach(f => {
      if ((f.status === FileStatus.COMPLETED || f.status === FileStatus.WARNING) && f.data) {
        f.data.forEach(doc => allDocuments.push({ data: doc, filename: f.file.name }));
      }
    });
    if (allDocuments.length === 0) return;

    // Cross-file merge: packing-list files sharing a PL No are combined into one logical doc
    // (rows unioned, Country of Origin back-filled, mis-placed NPBB-in-PO cleaned) before export.
    const PSS_TYPE = 'Export Permit Declaration (PSS)';
    const pssEntries = allDocuments.filter(e => e.data.document_type === PSS_TYPE);
    if (pssEntries.length) {
      const nonPss = allDocuments.filter(e => e.data.document_type !== PSS_TYPE);
      const mergedEntries = mergePackingListsByPlNo(pssEntries.map(e => e.data)).map(d => {
        const pl = (d.metadata?.reference_number || '').trim().toUpperCase();
        const filename = [...new Set(
          pssEntries.filter(e => (e.data.metadata?.reference_number || '').trim().toUpperCase() === pl && pl !== '')
                    .map(e => e.filename)
        )].join(' + ') || pssEntries[0].filename;
        return { data: d, filename };
      });
      allDocuments.length = 0;
      allDocuments.push(...nonPss, ...mergedEntries);
    }

    const zip = new JSZip();
    const groups: Record<string, { data: DocumentData; filename: string }[]> = {};
    allDocuments.forEach(item => {
      const type = item.data.document_type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    });

    const safe = (v: any) => `"${String(v || '').replace(/"/g, '""')}"`;

    const generateCSVForType = (type: string, list: { data: DocumentData; filename: string }[]) => {
      let headers: string[] = [];
      switch (type) {
        case 'Logistics Local Charges Report': headers = ['A. BL NUMBER','B. CARRIER / FORWARDER','C. PSS INVOICE NUMBER','D. FREIGHT TERM','E. PLACE OF DESTINATION','F. CNTR TYPE','G. CONTAINER QTY','H. (SGD) THC','I. (SGD) SEAL FEE','J. (SGD) BL FEE','K. (SGD) BL PRINTED FEE','L. (SGD) ENS / AMS / SCMC','M. (SGD) OTHERS CHARGES','N. REMARKS','O. TOTAL AMOUNT','Source File']; break;
        case 'Outward Permit Declaration': headers = ['BL Number','Carrier','Consignee','Container No','Seal No','Ctnr Type','Final Destination','Vessel Name','Voyage','HS Code','Description','Net Weight','Value Amount','Value Currency','Total Outer Pack Qty','Total Outer Pack Unit','Gross Weight Amount','Gross Weight Unit','Source File']; break;
        case 'Payment Voucher/GL': headers = ["PSS's Invoice #","Carrier/Forwarder Inv #","BL Number","Payable Amount","Total Payable Amount","Charges","Source File"]; break;
        case 'Bill of Lading': headers = ['BL Number','Shipper','Consignee','Notify Party','Vessel','Voyage','POL','POD','Source File']; break;
        case 'Commercial Invoice': headers = ['Invoice Number','Supplier','Buyer','Incoterms','Total Amount','Currency','Date','Source File']; break;
        case 'Allied Report': headers = ['Container/Booking No','DHC In','DHC Out','DHE In','DHE Out','Data Admin Fee','Washing','Repair','Detention','Demurrage','Source File']; break;
        case 'CDAS Report': headers = ['Container Number','DHC In','DHC Out','DHE In','DHE Out','Data Admin Fee','Washing','Repair','Detention','Demurrage','Source File']; break;
        case 'Export Permit Declaration (PSS)': headers = ['A. HS Code','B. Qty','C. UOM','D. Item Description','E. Product of Origin','F. Nett Weight (KGS)','G. Nett Wt Unit','H. Amount','I. Currency','J. PO Number','K. Invoice Number','Source File']; break;
        default: headers = ['Document Type','Reference Number','Date','Entity','Total Amount','Source File'];
      }

      const rows = list.map(({ data: d, filename }) => {
        const m = d.metadata || {};
        const p = m.parties || {};
        const fin = d.financials || {};
        const log = d.logistics_details || {};

        switch (type) {
          case 'Logistics Local Charges Report': {
            const l = d.logistics_local_charges || {};
            return [safe(l.bl_number||m.reference_number),safe(l.carrier_forwarder),safe(l.pss_invoice_number),safe(l.freight_term),safe(l.place_of_destination),safe(l.container_type),safe(l.container_qty),safe(l.thc_amount),safe(l.seal_fee),safe(l.bl_fee),safe(l.bl_printed_fee),safe(l.ens_ams_fee),safe(l.other_charges),safe(l.remarks),safe(l.total_payable_amount),safe(filename)].join(',');
          }
          case 'Outward Permit Declaration': {
            const opd = d.outward_permit_declaration || {};
            return [safe(opd.bl_number),safe(opd.carrier),safe(opd.consignee),safe(opd.container_no),safe(opd.seal_no),safe(opd.container_type),safe(opd.final_destination_port),safe(opd.vessel_name),safe(opd.voyage),safe(opd.hs_code),safe(opd.description),safe(opd.net_weight_kgs),safe(opd.item_price_amount),safe(opd.item_price_currency),safe(opd.total_outer_pack_qty),safe(opd.total_outer_pack_unit),safe(opd.gross_weight_amount),safe(opd.gross_weight_unit),safe(filename)].join(',');
          }
          case 'Payment Voucher/GL': {
            const pv = d.payment_voucher_details || {};
            const charges = pv.charges_summary || fin.line_item_charges?.map(c => `${c.description}: ${c.amount}`).join('; ') || '';
            const stripCurr = (v?: string | number | null) => String(v ?? '').replace(/SGD\s*/gi, '').replace(/USD\s*/gi, '').trim();
            if (pv.bl_entries && pv.bl_entries.length > 0) {
              const carrierParts = (pv.carrier_invoice_number || m.reference_number || '').split(',').map((s: string) => s.trim());
              const pssParts = (pv.pss_invoice_number || '').split(',').map((s: string) => s.trim());
              return pv.bl_entries.map((entry: { bl_number?: string; pss_invoice_number?: string; amount?: string }, i: number) => {
                const carrierInv = carrierParts[i] || carrierParts[0] || '';
                const pssInv = entry.pss_invoice_number || pssParts[i] || '';
                return [safe(pssInv),safe(carrierInv),safe(entry.bl_number||pv.bl_number||m.related_reference_number),safe(stripCurr(entry.amount||pv.payable_amount||fin.total_amount)),safe(stripCurr(pv.total_payable_amount)),safe(charges),safe(filename)].join(',');
              }).join('\n');
            }
            return [safe(pv.pss_invoice_number),safe(pv.carrier_invoice_number||m.reference_number),safe(pv.bl_number||m.related_reference_number),safe(stripCurr(pv.payable_amount||fin.total_amount)),safe(stripCurr(pv.total_payable_amount)),safe(charges),safe(filename)].join(',');
          }
          case 'Bill of Lading':
            return [safe(m.reference_number),safe(p.shipper_supplier),safe(p.consignee_buyer),safe(p.notify_party),safe(log.vessel_name),safe(log.voyage_number),safe(log.port_of_loading),safe(log.port_of_discharge),safe(filename)].join(',');
          case 'Commercial Invoice':
            return [safe(m.reference_number),safe(p.shipper_supplier),safe(p.consignee_buyer),safe(m.incoterms),safe(fin.total_amount),safe(m.currency),safe(m.date),safe(filename)].join(',');
          case 'Allied Report': {
            const ar = d.allied_report || {};
            return [safe(ar.container_booking_no),safe(ar.dhc_in),safe(ar.dhc_out),safe(ar.dhe_in),safe(ar.dhe_out),safe(ar.data_admin_fee),safe(ar.washing),safe(ar.repair),safe(ar.detention),safe(ar.demurrage),safe(filename)].join(',');
          }
          case 'CDAS Report': {
            const cs = d.cdas_report || {};
            return [safe(cs.container_number),safe(cs.dhc_in),safe(cs.dhc_out),safe(cs.dhe_in),safe(cs.dhe_out),safe(cs.data_admin_fee),safe(cs.washing),safe(cs.repair),safe(cs.detention),safe(cs.demurrage),safe(filename)].join(',');
          }
          case 'Export Permit Declaration (PSS)': {
            const items = d.export_permit_pss?.items ?? [];
            if (items.length === 0) return [safe(''),safe(''),safe(''),safe(''),safe(''),safe(''),safe(''),safe(''),safe(''),safe(''),safe(''),safe(filename)].join(',');
            return items.map(item =>
              [safe(item.hs_code),safe(item.quantity),safe(item.uom),safe(item.item_description),safe(item.product_of_origin),safe(item.nett_weight),safe(item.nett_weight_unit||'KGS'),safe(item.amount),safe(item.currency),safe(item.po_number),safe(item.invoice_number),safe(filename)].join(',')
            ).join('\n');
          }
          default:
            return [safe(d.document_type),safe(m.reference_number),safe(m.date),safe(p.shipper_supplier),safe(fin.total_amount),safe(filename)].join(',');
        }
      });

      return [headers.join(','), ...rows].join('\n');
    };

    Object.keys(groups).forEach(type => {
      zip.file(`${type.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`, generateCSVForType(type, groups[type]));
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url; link.download = AppConfig.export.zipFilename;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog('Exported ZIP Report');
  };

  const downloadLogs = () => {
    if (logs.length === 0) return;
    const blob = new Blob([logs.join('\n')], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = AppConfig.export.logFilename;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const pendingCount = files.filter(f => f.status === FileStatus.PENDING).length;
  const completedCount = files.filter(f => f.status === FileStatus.COMPLETED || f.status === FileStatus.WARNING).length;
  const processingCount = files.filter(f => f.status === FileStatus.PROCESSING).length;
  const errorCount = files.filter(f => f.status === FileStatus.ERROR).length;
  const processingFile = files.find(f => f.status === FileStatus.PROCESSING);
  const chunkProgress = processingFile?.progress ?? 0;
  const chunkStage = processingFile?.stage ?? 'Analysing…';
  const hasFiles = files.length > 0;

  if (isSessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <div className="text-center">
          <LumaSpin color="white" />
          <p className="text-surface-container text-sm">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!userRole) return <LoginScreen onLogin={handleLogin} />;

  const mainTabs = tabs.filter(t => t !== 'Developer Notes');
  const hasDevNotes = tabs.includes('Developer Notes');

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {updateAvailable && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-primary to-primary-container text-white text-center py-2 text-sm font-medium shadow-md">
          A new version is available.{' '}
          <button onClick={() => { window.location.replace(window.location.pathname + '?_r=' + Date.now()); }} className="underline font-semibold hover:text-blue-200">
            Click here to refresh
          </button>
        </div>
      )}

      {/* ─── Sidebar ─── */}
      <aside className="w-56 bg-primary flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-primary-container/50">
          <div className="flex items-center gap-3">
            <img src="/pluckd.png" alt="Pluckd" className="h-8 w-auto object-contain flex-shrink-0" style={{ filter: 'brightness(0) invert(1)' }} />
            <div>
              <p className="text-white font-bold text-sm leading-none">Pluckd</p>
              <p className="text-surface-container text-xs mt-0.5">By Zhenghe Logistics</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
          <p className="px-3 mb-2 text-[0.6875rem] font-medium text-surface-container uppercase tracking-[0.05em]">Documents</p>
          {mainTabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-left ${activeTab === tab ? 'bg-primary-container text-white' : 'text-surface-container hover:bg-primary-container/60 hover:text-white'}`}
            >
              <span className="flex-shrink-0">{TAB_ICONS[tab] || <FileText size={15} />}</span>
              <span className="truncate text-xs">{labelFor(tab)}</span>
            </button>
          ))}
          {hasDevNotes && (
            <>
              <div className="my-3 border-t border-primary-container/50" />
              <button
                onClick={() => setActiveTab('Developer Notes')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-left ${activeTab === 'Developer Notes' ? 'bg-primary-container text-white' : 'text-surface-container hover:bg-primary-container/60 hover:text-white'}`}
              >
                <Code2 size={15} className="flex-shrink-0" />
                <span className="text-xs">Developer Notes</span>
              </button>
            </>
          )}
        </nav>

        <div className="px-2 py-3 border-t border-primary-container/50">
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
            <div className="w-7 h-7 bg-secondary/20 border border-secondary/30 rounded-full flex items-center justify-center flex-shrink-0">
              <User size={13} className="text-secondary-container" />
            </div>
            <div className="min-w-0">
              <p className="text-surface-lowest text-xs font-medium truncate">{getTeamName(userRole)}</p>
              <p className="text-surface-container text-xs">Active session</p>
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-1 px-1 mb-1">
              {([UserRole.ACCOUNTS, UserRole.LOGISTICS, UserRole.TRANSPORT] as UserRole[]).map(role => (
                <button
                  key={role}
                  onClick={() => { setUserRole(role); localStorage.setItem('userRole', role); }}
                  className={`flex-1 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${userRole === role ? 'bg-secondary text-white' : 'bg-primary-container/40 text-surface-container hover:text-white'}`}
                >
                  {role === UserRole.ACCOUNTS ? 'Acct' : role === UserRole.LOGISTICS ? 'Log' : 'Tpt'}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-surface-container hover:bg-primary-container/60 hover:text-white text-xs transition-colors cursor-pointer"
          >
            <LogOut size={13} />
            Sign Out
          </button>
          <p className="px-3 pb-2 text-surface-container/60 text-[10px]">build {__COMMIT_HASH__}</p>
        </div>
      </aside>

      {/* ─── Main Area ─── */}
      <ErrorBoundary>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-surface-lowest px-6 py-3 flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-sm font-semibold text-primary">{labelFor(activeTab)}</h1>
              <p className="text-xs text-[#4a5568]">AI-powered logistics document extraction</p>
            </div>
            <div className="flex items-center gap-2">
              {hasFiles && (
                <div className="flex items-center gap-3 pr-3 mr-1">
                  <div className="text-center">
                    <p className="text-base font-bold text-primary leading-none">{files.length}</p>
                    <p className="text-xs text-[#4a5568]">Files</p>
                  </div>
                  <div className="text-center">
                    <p className="text-base font-bold text-secondary leading-none">{completedCount}</p>
                    <p className="text-xs text-[#4a5568]">Done</p>
                  </div>
                  {pendingCount > 0 && (
                    <div className="text-center">
                      <p className="text-base font-bold text-amber-500 leading-none">{pendingCount}</p>
                      <p className="text-xs text-[#4a5568]">Pending</p>
                    </div>
                  )}
                  {errorCount > 0 && (
                    <div className="text-center">
                      <p className="text-base font-bold text-red-500 leading-none">{errorCount}</p>
                      <p className="text-xs text-[#4a5568]">Errors</p>
                    </div>
                  )}
                </div>
              )}

              <label htmlFor="file-upload" className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-low text-primary text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={14} />
                Select PDFs
                <input id="file-upload" type="file" accept="application/pdf" multiple className="sr-only" onChange={handleFileChange} disabled={isProcessing} />
              </label>

              <button onClick={processFiles} disabled={isProcessing || pendingCount === 0} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity cursor-pointer">
                {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                {isProcessing ? 'Processing...' : `Process as ${TAB_SHORT_LABEL[activeTab] ?? activeTab}${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
              </button>

              <button onClick={downloadReport} disabled={completedCount === 0} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity cursor-pointer">
                <Download size={14} />
                Export
              </button>


              {activeTab === 'CDAS Report' && (() => {
                const docs = files.flatMap(f => (f.status === FileStatus.COMPLETED || f.status === FileStatus.WARNING) ? (f.data ?? []).filter(d => d.document_type === 'CDAS Report') : []);
                return docs.length > 0 ? (
                  <button onClick={() => handleGenerateVouchers(docs)} disabled={isGeneratingPdf} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-secondary to-primary-container text-white text-xs font-semibold disabled:opacity-70 disabled:cursor-not-allowed transition-opacity cursor-pointer">
                    {isGeneratingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                    {isGeneratingPdf ? 'Generating...' : 'Export CDAS Voucher'}
                  </button>
                ) : null;
              })()}

              {activeTab === 'Allied Report' && (() => {
                const docs = files.flatMap(f => (f.status === FileStatus.COMPLETED || f.status === FileStatus.WARNING) ? (f.data ?? []).filter(d => d.document_type === 'Allied Report') : []);
                return docs.length > 0 ? (
                  <button onClick={() => handleGenerateVouchers(docs)} disabled={isGeneratingPdf} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-secondary to-primary-container text-white text-xs font-semibold disabled:opacity-70 disabled:cursor-not-allowed transition-opacity cursor-pointer">
                    {isGeneratingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                    {isGeneratingPdf ? 'Generating...' : 'Export Allied Voucher'}
                  </button>
                ) : null;
              })()}

              {activeTab === 'Payment Voucher/GL' && (() => {
                const docs = files.flatMap(f => (f.status === FileStatus.COMPLETED || f.status === FileStatus.WARNING) ? (f.data ?? []).filter(d => d.document_type === 'Payment Voucher/GL') : []);
                return docs.length > 0 ? (
                  <>
                    <button onClick={() => handleGenerateVouchers(docs, 'pv')} disabled={isGeneratingPdf} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-secondary to-primary-container text-white text-xs font-semibold disabled:opacity-70 disabled:cursor-not-allowed transition-opacity cursor-pointer">
                      {isGeneratingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                      {isGeneratingPdf ? 'Generating...' : 'Export Vouchers PDF'}
                    </button>
                    <button onClick={() => handleGenerateVouchers(docs, 'rv')} disabled={isGeneratingPdf} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-secondary to-primary-container text-white text-xs font-semibold disabled:opacity-70 disabled:cursor-not-allowed transition-opacity cursor-pointer">
                      {isGeneratingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                      {isGeneratingPdf ? 'Generating...' : 'Export Receipt PDF'}
                    </button>
                  </>
                ) : null;
              })()}

              <button onClick={downloadLogs} disabled={logs.length === 0} title="Download Logs" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-low text-primary text-xs font-medium hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                <FileText size={14} />
              </button>
            </div>
          </div>

          {isProcessing && (
            <div className="mt-3 pb-1">
              <div className="flex items-center justify-between text-xs text-[#4a5568] mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin" />
                  {chunkProgress > 0 ? chunkStage : `Processing ${processingCount} file${processingCount !== 1 ? 's' : ''}...`}
                </span>
                <span>{chunkProgress > 0 ? `${chunkProgress}%` : `${completedCount} of ${files.length} complete`}</span>
              </div>
              <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                <div className="h-full bg-secondary rounded-full transition-all duration-500" style={{ width: `${chunkProgress > 0 ? chunkProgress : (files.length > 0 ? (completedCount / files.length) * 100 : 0)}%` }} />
              </div>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-auto p-5">
          <CustomRulesPanel rules={customRules} onRulesChange={setCustomRules} />

          {activeTab === 'Developer Notes' ? (
            <DeveloperNotes />
          ) : activeTab === 'CRM Billing' ? (
            <CrmBillingTab records={containerRecords} onRecordUpdate={handleContainerRecordUpdate} onRecordDelete={handleContainerRecordDelete} onRecordDeleteMany={handleContainerRecordDeleteMany} />
          ) : activeTab === 'Export Permit Declaration (PSS)' ? (
            <ExportPermitTab files={files} />
          ) : !hasFiles ? (
            <div
              onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload-drop')?.click()}
              className={`flex flex-col items-center justify-center min-h-96 rounded-2xl border-2 border-dashed transition-all cursor-pointer select-none ${isDragging ? 'border-secondary bg-secondary-fixed/20 scale-[1.01]' : 'border-outline/40 bg-surface-lowest hover:border-secondary/40 hover:bg-surface-low'}`}
            >
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-5 transition-colors ${isDragging ? 'bg-secondary-fixed' : 'bg-surface-container'}`}>
                <Upload size={28} className={isDragging ? 'text-secondary' : 'text-[#4a5568]'} />
              </div>
              <p className="text-primary font-semibold text-base mb-1">{isDragging ? 'Drop your PDFs here' : 'Upload PDF Documents'}</p>
              <p className="text-[#4a5568] text-sm mb-5">Drag & drop files here, or click to browse</p>
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-sm font-semibold pointer-events-none">
                <Upload size={15} />
                Browse Files
              </div>
              <p className="text-[#4a5568] text-xs mt-4">PDF files only</p>
              <input id="file-upload-drop" type="file" accept="application/pdf" multiple className="sr-only" onChange={handleFileChange} disabled={isProcessing} />
            </div>
          ) : (
            <ResultsTable
              files={files}
              onUpdateIncoterm={handleIncotermUpdate}
              onUpdateFreightTerm={handleFreightTermUpdate}
              onUpdatePSSNumber={handlePSSNumberUpdate}
              onDeleteFile={handleDeleteFile}
              onBulkDelete={handleBulkDelete}
              onGenerateVoucher={handleGenerateVouchers}
              onReprocessFile={handleReprocess}
              onRetryFailedChunks={handleRetryFailedChunks}
              isGeneratingPdf={isGeneratingPdf}
              activeTab={activeTab}
              userRole={userRole}
            />
          )}
        </main>
      </div>
      </ErrorBoundary>

      <ConfirmationModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmDeleteFile}
        title="Delete Document"
        message="Are you sure you want to delete this document? This action cannot be undone and will remove it for all users."
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Currency selection modal for PV export/preview */}
      {pvCurrencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setPvCurrencyModal(false); setPvExportDocs(null); }}>
          <div className="bg-surface rounded-2xl shadow-xl p-8 flex flex-col items-center gap-6 min-w-[300px]" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-primary">Select Currency</h2>
            <p className="text-sm text-secondary text-center">Which currency should the Payment Voucher be generated in?</p>
            <div className="flex gap-4 w-full">
              <button
                onClick={() => handlePVCurrencySelect('SGD')}
                className="flex-1 py-3 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 transition-colors"
              >
                SGD
              </button>
              <button
                onClick={() => handlePVCurrencySelect('USD')}
                className="flex-1 py-3 rounded-xl border-2 border-primary text-primary font-bold text-sm hover:bg-primary/10 transition-colors"
              >
                USD
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
