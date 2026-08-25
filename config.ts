export const AppConfig = {
  validation: {
    // Regex for YYYY-MM-DD
    dateFormat: /^\d{4}-\d{2}-\d{2}$/,
    // Critical fields that must be present for a "valid" extraction
    requiredFields: [
      'document_type',
      'metadata.reference_number',
      'metadata.date'
    ],
    // Standard Incoterms 2020 + common historical ones
    incotermsList: [
      'EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 
      'FAS', 'FOB', 'CFR', 'CIF'
    ]
  },
  export: {
    zipFilename: 'logistics_documents.zip',
    logFilename: 'processing_log.txt'
  },
  // Role Configuration
  roles: {
    accounts: {
      allowedTypes: ['All Files', 'Payment Voucher/GL'],
      defaultTab: 'Payment Voucher/GL'
    },
    logistics: {
      allowedTypes: ['All Files', 'Logistics Local Charges Report', 'Outward Permit Declaration', 'Export Permit Declaration (PSS)'],
      defaultTab: 'Logistics Local Charges Report'
    },
    transport: {
      allowedTypes: ['All Files', 'Allied Report', 'CDAS Report', 'CRM Billing'],
      defaultTab: 'Allied Report'
    }
  },
  // Define columns for different views
  views: {
    'All Files': {
      columns: ['File Name', 'Status', 'Document Types Found', 'Upload Date']
    },
    'Payment Voucher/GL': {
      columns: ["PSS's Invoice #", "Carrier/Forwarder Inv #", "BL Number", "Payable Amount", "Total Payable Amount", "Charges", "Repair", "Detention"],
    },
    'Bill of Lading': {
      columns: ['BL Number', 'Shipper', 'Consignee', 'Vessel/Voyage', 'POL', 'POD'],
    },
    'Logistics Local Charges Report': {
      columns: [
        'A. BL NUMBER', 'B. CARRIER / FORWARDER', 'C. PSS INVOICE NUMBER', 'D. FREIGHT TERM',
        'E. PLACE OF DESTINATION', 'F. CNTR TYPE', 'G. CONTAINER QTY', 'H. (SGD) THC',
        'I. (SGD) SEAL FEE', 'J. (SGD) BL FEE', 'K. (SGD) BL PRINTED FEE',
        'L. (SGD) ENS / AMS / SCMC', 'M. (SGD) OTHERS CHARGES', 'N. REMARKS', 'O. TOTAL AMOUNT'
      ]
    },
    'Outward Permit Declaration': {
      columns: [
        'BL number', 'Carrier', 'Consignee', 'Container No', 'Seal No', 'Ctnr Type',
        'Final Destination (Port Code)', 'Vessel Name', 'Voyage',
        'HS code', 'Description', 'Net Weight', 'Value Amount', 'Value Currency', 'Total Outer Pack Qty', 'Total Outer Pack Unit', 'Gross Weight Amount', 'Gross Weight Unit'
      ]
    },
    'Commercial Invoice': {
      columns: ['Invoice #', 'Supplier', 'Buyer', 'Incoterms', 'Total Amount', 'Currency'],
    },
    'Packing List': {
      columns: ['Ref #', 'Seller', 'Total Packages', 'Gross Weight', 'Net Weight', 'Marks'],
    },
    'Purchase Order': {
      columns: ['PO Number', 'Supplier', 'Date', 'Delivery Date', 'Total Amount'],
    },
    'Container Report': {
      columns: ['Container #', 'Type', 'Status', 'Charges', 'Washing Fees'],
    },
    'Allied Report': {
      columns: ['Container/Booking No', 'DHC In', 'DHC Out', 'DHE In', 'DHE Out', 'Data Admin Fee', 'Washing', 'Repair', 'Detention', 'Demurrage', 'Fuel Surcharge', 'Dyn. Price Factor'],
    },
    'CDAC Report': {
      columns: ['Container Number', 'Repair', 'Detention', 'Demurage', 'Admin Fees', 'Washing', 'DHC'],
    },
    'CDAS Report': {
      columns: ['Container Number', 'DHC In', 'DHC Out', 'DHE In', 'DHE Out', 'Data Admin Fee', 'Washing', 'Repair', 'Detention', 'Demurrage', 'Fuel Surcharge'],
    },
    'Export Permit Declaration (PSS)': {
      columns: ['A. HS Code', 'B. Qty', 'C. UOM', 'D. Item Description', 'E. Product of Origin', 'F. Nett Weight (KGS)', 'G. Nett Wt Unit', 'H. Amount', 'I. Currency', 'J. PO Number', 'K. Invoice Number'],
    },
  }

};

// Friendly names shown to users. Internal document_type keys stay the same everywhere
// (prompt, pipeline, stored data); only the on-screen label changes.
export const DISPLAY_LABELS: Record<string, string> = {
  'Outward Permit Declaration': 'Export Team Permits',
  'Export Permit Declaration (PSS)': 'Import Team Permits',
};

// Return the friendly label for a document type / tab, falling back to the key itself.
export const labelFor = (type: string): string => DISPLAY_LABELS[type] ?? type;