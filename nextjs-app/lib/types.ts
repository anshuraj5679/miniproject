export interface WarrantyItem {
  itemId: string;
  productName?: string;
  model?: string;
  invoiceNo?: string;
  purchaseDate?: string;
  purchasePrice?: number;
  quantity?: number;
  unitPrice?: number;
  gstAmount?: number;
  warrantyMonths?: number;
  warrantyStart?: string;
  warrantyEnd?: string;
  serialNumber?: string;
  serviceCenters: string[];
  extendedWarrantyPurchased?: boolean;
  notes?: string;
}

export interface ClaimReadiness {
  score: number;
  label: string;
  summary: string;
  factors: Record<string, number>;
  missing: string[];
}

export interface ComplianceCheck {
  field: string;
  status: string;
  detail: string;
}

export interface ComplianceAlert {
  code: string;
  severity: string;
  message: string;
}

export interface GSTINCompliance {
  value?: string | null;
  present: boolean;
  valid_format: boolean;
  valid_checksum: boolean;
  state_code?: string | null;
  pan?: string | null;
  pan_valid_format: boolean;
}

export interface InvoiceCompliance {
  invoice_number?: string | null;
  invoice_date?: string | null;
  total_amount?: number | null;
  detected_pincode?: string | null;
  irn_detected: boolean;
  irn_value?: string | null;
  qr_detected: boolean;
  einvoice_requirement_signal: string;
  days_since_invoice?: number | null;
  late_reporting_risk: boolean;
}

export interface TaxValidation {
  taxable_amount?: number | null;
  gst_amount?: number | null;
  gst_rate?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
  split_total?: number | null;
  expected_gst_amount?: number | null;
  reported_gst_amount?: number | null;
  delta?: number | null;
  within_tolerance?: boolean | null;
  tax_split_mode: string;
  tolerance: number;
}

export interface DocumentCompliance {
  country: string;
  framework: string;
  status: 'pass' | 'watch' | 'risk' | string;
  score: number;
  gstin: GSTINCompliance;
  invoice: InvoiceCompliance;
  tax_validation: TaxValidation;
  rule46_checks: ComplianceCheck[];
  alerts: ComplianceAlert[];
  computed_at: string;
}

export interface Document {
  docId: string;
  userId: string;
  title: string;
  category?: string;
  items: WarrantyItem[];
  createdAt: string;
  updatedAt: string;
  rawText?: string;
  status?: string;
  sellerName?: string;
  ocrConfidence?: number;
  isVerified: boolean;
  source?: string;
  assignedByMerchantId?: string;
  assignedByMerchantName?: string;
  assignedByMerchantCustomId?: string;
  consumerCustomId?: string;
  taxableAmount?: number;
  gstAmount?: number;
  gstRate?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  extractionConfidence?: Record<string, number>;
  reviewStatus?: string;
  reviewRequired?: boolean;
  lowConfidenceFields?: string[];
  claimReadiness?: ClaimReadiness;
  deadlineBand?: string;
  compliance?: DocumentCompliance;
}

export interface Reminder {
  reminderId: string;
  docId: string;
  title: string;
  triggerAt: string;
  triggerType: string;
  deliveryChannels: string[];
  status: string;
}

export interface InAppNotification {
  notificationId: string;
  docId: string;
  userId: string;
  channel?: string;
  eventType?: string;
  type: string;
  title: string;
  message: string;
  triggerAt: string;
  readAt?: string;
  status: string;
}

export interface NotificationPreference {
  userId: string;
  email: string;
  fullName?: string;
  locale: string;
  timezone: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  smsNumber?: string;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappNumber?: string;
  alertDays: number[];
  claimAlertDays: number[];
  updatedAt?: string;
}

export interface ExtractionReview {
  reviewId: string;
  documentId: string;
  userId: string;
  status: string;
  fieldConfidences: Record<string, number>;
  lowConfidenceFields: string[];
  extractedFields: Record<string, unknown>;
  confirmedFields: Record<string, unknown>;
  reviewerUserId?: string;
  reviewNotes?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: ChatSource[];
}

export interface ChatSource {
  docId: string;
  chunk: string;
  score: number;
}

export interface User {
  userId: string;
  email: string;
  name?: string;
  userType?: UserType;
  customId?: string;
  picture?: string;
  provider?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type UserType = 'consumer' | 'merchant';

export interface MerchantActivity {
  activityId: string;
  merchantUserId: string;
  consumerUserId?: string;
  consumerCustomId?: string;
  consumerName?: string;
  documentId: string;
  billId: string;
  title: string;
  vendor: string;
  amount?: number;
  category?: string;
  source: string;
  action: 'uploaded' | 'generated' | 'reassigned' | string;
  createdAt: string;
}

export interface MerchantManualBillPayload {
  merchantUserId: string;
  merchantName?: string;
  merchantCustomId?: string;
  consumerUserId: string;
  consumerCustomId?: string;
  consumerName?: string;
  consumerEmail?: string;
  productName: string;
  category?: string;
  billId?: string;
  vendor?: string;
  purchaseDate?: string;
  totalAmount?: number;
  warrantyMonths?: number;
  serialNumber?: string;
  notes?: string;
}

