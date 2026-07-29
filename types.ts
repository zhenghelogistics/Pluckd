export interface LogisticsParties {
  shipper_supplier?: string | null;
  consignee_buyer?: string | null;
  notify_party?: string | null;
}

export interface DocumentMetadata {
  reference_number?: string | null;
  related_reference_number?: string | null; // e.g. BL Number on a Voucher
  date?: string | null;
  currency?: string | null;
  incoterms?: string | null;
  parties?: LogisticsParties;
}

export interface LogisticsDetails {
  vessel_name?: string | null;
  voyage_number?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  container_numbers?: string[];
  marks_and_numbers?: string | null;
}

export interface LineItemCharge {
  description?: string | null;
  amount?: number | null;
}

export interface DocumentFinancials {
  total_amount?: number | null;
  total_tax_amount?: number | null;
  line_item_charges?: LineItemCharge[];
}

export interface CargoItem {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
  hs_code?: string | null;
}

export interface CargoDetails {
  total_gross_weight?: number | null;
  total_net_weight?: number | null;
  total_packages?: number | null;
  weight_unit?: string | null;
  line_items?: CargoItem[];
}

export interface BLEntry {
  bl_number?: string | null;
  pss_invoice_number?: string | null;
  amount?: string | null;
}

export interface PaymentVoucherDetails {
  pss_invoice_number?: string | null;
  carrier_invoice_number?: string | null;
  bl_number?: string | null;
  payable_amount?: string | null;
  total_payable_amount?: string | null;
  charges_summary?: string | null;
  repair?: string | null;
  detention?: string | null;
  payment_to?: string | null;
  payment_method?: string | null;
  bl_entries?: BLEntry[] | null;
}

export interface LogisticsLocalCharges {
  bl_number?: string | null;
  carrier_forwarder?: string | null;
  pss_invoice_number?: string | null;
  freight_term?: string | null;
  place_of_destination?: string | null;
  container_type?: string | null;
  container_qty?: string | null;
  thc_amount?: string | null;
  seal_fee?: string | null;
  bl_fee?: string | null;
  bl_printed_fee?: string | null;
  ens_ams_fee?: string | null;
  other_charges?: string | null;
  remarks?: string | null;
  total_payable_amount?: string | null;
}

export interface OutwardPermitDeclaration {
  permit_number?: string | null;
  exporter?: string | null;
  consignee?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  total_fob_value?: string | null;
  gst_amount?: string | null;
  // Shipping team extraction fields
  bl_number?: string | null;
  carrier?: string | null;
  container_no?: string | null;
  seal_no?: string | null;
  container_type?: string | null;
  final_destination_port?: string | null;
  vessel_name?: string | null;
  voyage?: string | null;
  hs_code?: string | null;
  description?: string | null;
  net_weight_kgs?: string | null;
  item_price_amount?: string | null;
  item_price_currency?: string | null;
  total_outer_pack_qty?: string | null;
  total_outer_pack_unit?: string | null;
  gross_weight_amount?: string | null;
  gross_weight_unit?: string | null;
  // Description cross-check fields
  invoice_description?: string | null;
  packing_list_description?: string | null;
  bl_description?: string | null;
  po_description?: string | null;
  description_match?: string | null;
  country_of_origin?: string | null;
  // Read by dedup/normalize in claudeService (may be present in raw Claude output)
  factory?: string | null;
  products?: { description?: string | null }[] | null;
}

export interface AlliedReport {
  container_booking_no?: string | null;
  invoice_date?: string | null;
  dhc_in?: string | null;
  dhc_out?: string | null;
  dhe_in?: string | null;
  dhe_out?: string | null;
  data_admin_fee?: string | null;
  washing?: string | null;
  repair?: string | null;
  detention?: string | null;
  demurrage?: string | null;
  fuel_surcharge?: string | null;
  fuel_surcharge_label?: string | null;
  dynamic_price_factor?: string | null;
  dynamic_price_factor_label?: string | null;
}

export interface CdasReport {
  container_number?: string | null;
  invoice_date?: string | null;
  dhc_in?: string | null;
  dhc_out?: string | null;
  dhe_in?: string | null;
  dhe_out?: string | null;
  data_admin_fee?: string | null;
  washing?: string | null;
  repair?: string | null;
  detention?: string | null;
  demurrage?: string | null;
  fuel_surcharge?: string | null;
  fuel_surcharge_label?: string | null;
}

export interface ExportPermitPSSItem {
  hs_code?: string | null;
  quantity?: string | null;
  uom?: string | null;
  item_description?: string | null;
  product_of_origin?: string | null;
  nett_weight?: string | null;
  nett_weight_unit?: string | null;
  amount?: string | null;
  currency?: string | null;
  po_number?: string | null;
  invoice_number?: string | null;
}

export interface ExportPermitPSS {
  items?: ExportPermitPSSItem[] | null;
}

export interface DocumentData {
  document_type: string;
  metadata: DocumentMetadata;
  logistics_details: LogisticsDetails;
  financials: DocumentFinancials;
  cargo_details: CargoDetails;
  payment_voucher_details?: PaymentVoucherDetails;
  logistics_local_charges?: LogisticsLocalCharges;
  outward_permit_declaration?: OutwardPermitDeclaration;
  allied_report?: AlliedReport;
  cdas_report?: CdasReport;
  export_permit_pss?: ExportPermitPSS;
}

export interface TemplateField {
  key: string;
  label: string;
  hint: string;
}

export interface ExtractionTemplate {
  id: string;
  user_id: string;
  name: string;
  document_hint: string;
  fields: TemplateField[];
  is_active: boolean;
  created_at: string;
}

// Wrapper for the API response which now returns a list
export interface ExtractionResponse {
  documents: DocumentData[];
}

export type ExtractionStatus = 'complete' | 'partial' | 'failed';

export interface ChunkDiagnostic {
  chunkIndex: number;
  pages: string;
  status: 'success' | 'failed';
  durationMs: number;
  docsReturned: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface ExtractionResult {
  status: ExtractionStatus;
  documents: DocumentData[];
  warnings: string[];
  chunkDiagnostics: ChunkDiagnostic[];
}

export interface ProcessedFile {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'warning';
  docType?: string;          // tab active at upload time — determines chunking template
  data?: DocumentData[];
  errorMessage?: string;
  validationErrors?: string[];
  extractionWarnings?: string[];
  failedChunkIndices?: number[];
  uploadedAt?: string; // ISO string from Supabase created_at
  stage?: string; // Current extraction stage shown during processing
  progress?: number; // 0–100 percentage shown during processing
  // CRM Billing fields
  billing_status?: 'unbilled' | 'billed';
  billed_at?: string | null;
  billing_remarks?: string | null;
  charge_validations?: Record<string, boolean>;
}

export enum FileStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error',
  WARNING = 'warning'
}